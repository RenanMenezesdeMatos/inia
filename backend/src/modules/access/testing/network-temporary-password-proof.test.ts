/**
 * PROVA contra o banco de TESTE real, pela API: "Nova senha temporária" depende de QUEM GERENCIA A SENHA DA CONTA (23/11/2026).
 * Com o login pela rede ligado, a conta que entra pela matrícula (AD) não recebe senha temporária da INIA — a lista diz por quê e a API
 * recusa sem tocar na senha nem nas sessões; a conta de emergência (senha da INIA) continua com o fluxo de senha temporária. Desligado o
 * login pela rede, a mesma conta volta a ser local. Tudo numa transação desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run network-temporary-password-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Nova senha temporária × login pela rede (AD) — prova Postgres", () => {
  beforeAll(async () => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL }); client = await pool.connect(); await client.query("begin") })
  afterAll(async () => { if (client) { await client.query("rollback"); client.release() } if (pool) await pool.end() })

  it("conta AD: sem senha temporária na tela e na API; conta de emergência: fluxo preservado; desligado o login pela rede, volta a valer", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!
    await client.query("update organizations set network_login_enabled = false where id = $1", [org.id])
    const hash = await hashPassword("Antiga@2024")
    const person = async (name: string, emergency: boolean) => {
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, job_title, matricula) values ($1, $2, 'OPERATOR', 'Assistente', $3) returning id", [org.id, name, `PROOF-REDE-${name.replaceAll(" ", "-").toUpperCase()}`])).rows[0]!.id
      const email = `${name.toLowerCase().replaceAll(" ", ".")}@proof-rede.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash, emergency_local_access) values ($1, $2, $3, $4, $5) returning id", [org.id, id, email, hash, emergency])).rows[0]!.id
      return { id, accountId, email }
    }
    const admin = await person("Proof Rede Admin", true)
    await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, 'ADMINISTRADOR_GERAL', 'ORGANIZATION', now())", [org.id, admin.accountId])
    const operadora = await person("Proof Rede Operadora", false)
    const emergencia = await person("Proof Rede Emergencia", true)

    const app = createApp(client as never, { rateLimits: false })
    const agent = request.agent(app)
    expect((await agent.post("/api/v1/auth/login").send({ email: admin.email, password: "Antiga@2024" })).status).toBe(200)
    const list = async () => (await agent.get("/api/v1/admin/access/users").query({ search: "Proof Rede", pageSize: 50 })).body.data.items as { personId: string; canIssueTemporaryPassword: boolean; account: { credentialProvider: string } | null }[]
    const rowOf = (items: Awaited<ReturnType<typeof list>>, personId: string) => items.find((item) => item.personId === personId)!

    // Login pela rede DESLIGADO: todas as contas têm senha da INIA.
    let items = await list()
    expect(rowOf(items, operadora.id)).toMatchObject({ canIssueTemporaryPassword: true, account: { credentialProvider: "LOCAL" } })

    // Login com matrícula e senha de rede LIGADO: a operadora passa a autenticar pelo AD.
    await client.query("update organizations set network_login_enabled = true where id = $1", [org.id])
    items = await list()
    expect(rowOf(items, operadora.id)).toMatchObject({ canIssueTemporaryPassword: false, account: { credentialProvider: "NETWORK" } })
    expect(rowOf(items, emergencia.id)).toMatchObject({ canIssueTemporaryPassword: true, account: { credentialProvider: "LOCAL" } })

    const before = (await client.query<{ password_hash: string; session_version: number; password_change_required: boolean }>("select password_hash, session_version, password_change_required from user_accounts where id = $1", [operadora.accountId])).rows[0]!
    const refused = await agent.post(`/api/v1/admin/access/accounts/${operadora.accountId}/temporary-password`).send({})
    expect(refused.status).toBe(409)
    expect(refused.body.error).toMatchObject({ code: "ACCESS_PASSWORD_MANAGED_BY_NETWORK" })
    expect(refused.body.error.message).toMatch(/Active Directory/)
    // Nada mudou na conta: mesma senha, mesmas sessões, nenhuma troca obrigatória, nenhuma auditoria de emissão.
    expect((await client.query("select password_hash, session_version, password_change_required from user_accounts where id = $1", [operadora.accountId])).rows[0]).toEqual(before)
    expect((await client.query<{ n: number }>("select count(*)::int n from audit_logs where action = 'ACCESS_TEMPORARY_PASSWORD_ISSUED' and entity_id = $1", [operadora.accountId])).rows[0]!.n).toBe(0)

    // Conta de emergência (senha da INIA) continua com o fluxo de senha temporária.
    const issued = await agent.post(`/api/v1/admin/access/accounts/${emergencia.accountId}/temporary-password`).send({})
    expect(issued.status).toBe(201)
    expect(issued.body.data.temporaryPassword).toEqual(expect.any(String))

    // Desligado o login pela rede, a mesma conta volta a ser local e recebe senha temporária.
    await client.query("update organizations set network_login_enabled = false where id = $1", [org.id])
    expect((await agent.post(`/api/v1/admin/access/accounts/${operadora.accountId}/temporary-password`).send({})).status).toBe(201)
  })
})
