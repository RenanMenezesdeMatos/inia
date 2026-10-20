/**
 * PROVA contra o banco de TESTE real — exportação dos dados de uma pessoa (pedido do titular, LGPD art. 18). Fixture apagada no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run subject-data-export-proof
 *
 * Prova: a exportação acha sozinha (pelas chaves do banco) as tabelas ligadas à pessoa e às coisas dela (conta, chamada,
 * transcrição); senha/hash saem omitidos; a transcrição sai com o CPF do cliente mascarado; fica auditada; pela rota, só quem tem
 * a permissão na organização inteira exporta — os demais recebem 403.
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { exportSubjectData } from "../application/subject-data-export.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const PASSWORD = "Cajueiro-Prova-2026"
let pool: pg.Pool

describe.skipIf(!ENABLED)("Exportação dos dados do titular — prova Postgres", () => {
  const people: string[] = []
  const accounts: string[] = []
  let subject: string
  let admin: string
  let interactionId: string
  const email: Record<string, string> = {}

  async function account(personId: string, key: string, role?: string) {
    email[key] = `${key}-${personId.slice(0, 8)}@prova-exportacao.inia.local`
    const id = (await pool.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash, active, password_change_required) values ($1,$2,$3,$4,true,false) returning id", [ORG, personId, email[key], await hashPassword(PASSWORD)])).rows[0]!.id
    accounts.push(id)
    if (role) await pool.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1,$2,$3,'ORGANIZATION',now())", [ORG, id, role])
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 6 })
    const team = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 order by created_at, id limit 1", [ORG])).rows[0]!.id
    subject = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id, active) values ($1,'Titular Prova Exportação','OPERATOR',$2,true) returning id", [ORG, team])).rows[0]!.id
    admin = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id, active) values ($1,'Admin Prova Exportação','ADMIN',$2,true) returning id", [ORG, team])).rows[0]!.id
    people.push(subject, admin)
    await account(subject, "titular")
    await account(admin, "admin", "ADMINISTRADOR_GERAL")
    interactionId = (await pool.query<{ id: string }>(
      "insert into interactions (organization_id, operator_id, external_id, reason, started_at, ended_at, channel) values ($1,$2,$3,'Segunda via',now() - interval '1 hour', now() - interval '55 minutes','VOICE') returning id",
      [ORG, subject, `PROVA-EXPORT-${subject.slice(0, 8)}`],
    )).rows[0]!.id
    await pool.query("insert into transcripts (organization_id, interaction_id, content) values ($1,$2,$3)", [ORG, interactionId, "[00:10–00:20] CLIENTE: Meu CPF é 348.123.456-09."])
  })

  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from audit_logs where action = 'PERSONAL_DATA_EXPORTED' and entity_id = $1", [subject])
    await pool.query("delete from transcripts where interaction_id = $1", [interactionId])
    await pool.query("delete from interactions where id = $1", [interactionId])
    await pool.query("delete from access_role_assignments where user_account_id = any($1)", [accounts])
    await pool.query("delete from auth_login_attempts where account_id = any($1)", [accounts])
    await pool.query("delete from auth_session_activity where account_id = any($1)", [accounts])
    await pool.query("delete from user_accounts where id = any($1)", [accounts])
    await pool.query("delete from people where id = any($1)", [people])
    await pool.end()
  })

  it("acha pelas chaves do banco o que é da pessoa; omite senha/hash; mascara o CPF do cliente; audita", async () => {
    const data = await exportSubjectData(pool, { organizationId: ORG, personId: subject, actorPersonId: admin })
    expect(data.person).toMatchObject({ id: subject, name: "Titular Prova Exportação" })
    const section = (table: string) => data.sections.find((entry) => entry.table === table)
    expect(section("user_accounts")!.rows[0]).toMatchObject({ email: email.titular, password_hash: "[omitido]" })
    expect(section("interactions")!.rows.map((row) => row.id)).toContain(interactionId)
    const transcript = section("transcripts")!
    expect(transcript.via).toContain("interação (chamada) da pessoa")
    expect(transcript.rows[0]!.content).toBe("[00:10–00:20] CLIENTE: Meu CPF é [CPF].")
    expect(JSON.stringify(data)).not.toContain("348.123.456-09")
    const audit = await pool.query("select payload from audit_logs where action = 'PERSONAL_DATA_EXPORTED' and entity_id = $1 and actor_id = $2", [subject, admin])
    expect(audit.rowCount).toBeGreaterThanOrEqual(1)
  })

  it("pela rota: o titular (sem a permissão) recebe 403; o Administrador geral baixa o arquivo", async () => {
    const app = createApp(pool, { rateLimits: false })
    const login = async (key: string) => {
      const agent = request.agent(app)
      expect((await agent.post("/api/v1/auth/login").set("Origin", env.allowedOrigins[0]!).send({ email: email[key], password: PASSWORD })).status).toBe(200)
      return agent
    }
    expect((await (await login("titular")).get(`/api/v1/admin/people/${subject}/data-export`)).status).toBe(403)
    const adminAgent = await login("admin")
    expect((await adminAgent.get("/api/v1/auth/me")).body.data.access.capabilities.canExportSubjectData).toBe(true)
    const download = await adminAgent.get(`/api/v1/admin/people/${subject}/data-export`)
    expect(download.status).toBe(200)
    expect(download.headers["content-disposition"]).toContain(`dados-pessoa-${subject}`)
    expect(JSON.parse(download.text)).toMatchObject({ version: "SUBJECT_DATA_EXPORT_V1", person: { id: subject } })
  })
})
