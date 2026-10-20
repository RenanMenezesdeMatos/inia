/**
 * PROVA contra o banco de TESTE real: liberação de acesso e primeiro login (migration 118), de ponta a ponta pela API —
 * habilitar (sem cadastro duplicado), senha temporária mostrada uma vez e guardada só como hash, troca obrigatória (bloqueio de
 * páginas/APIs, tentativa de contornar), política de senha, senha temporária vencida, nova senha temporária e desabilitar
 * revogando sessões, trava de tentativas, permissão e custódia validadas no servidor, auditoria sem credencial e contas
 * existentes intactas. Tudo numa transação desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run account-access-lifecycle-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword, verifyPassword } from "../../auth/infrastructure/password-hasher.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Liberação de acesso e primeiro login — prova Postgres", () => {
  beforeAll(async () => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL }); client = await pool.connect(); await client.query("begin") })
  afterAll(async () => { if (client) { await client.query("rollback"); client.release() } if (pool) await pool.end() })

  it("habilitar → senha temporária → troca obrigatória → ativo; nova temporária, vencida, desabilitar, trava, permissão e custódia", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [org.id])).rows[0]!.id
    const teamA = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Liberação A') returning id", [org.id, operation])).rows[0]!.id
    const teamB = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Liberação B') returning id", [org.id, operation])).rows[0]!.id
    const oldHash = await hashPassword("Antiga@2024")
    const person = async (name: string, teamId: string | null, withAccount: boolean) => {
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, job_title, team_id, matricula) values ($1, $2, 'OPERATOR', 'Assistente', $3, $4) returning id", [org.id, name, teamId, `PROOF-LIB-${name.replaceAll(" ", "-")}`])).rows[0]!.id
      const email = `${name.toLowerCase().replaceAll(" ", ".")}@proof-lib.inia.local`
      const accountId = withAccount ? (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [org.id, id, email, oldHash])).rows[0]!.id : null
      return { id, accountId, email }
    }
    const grant = (accountId: string, roleCode: string, scope: "ORGANIZATION" | "GROUP", teamId: string | null = null) =>
      client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())", [org.id, accountId, roleCode, scope, teamId])
    const geral = await person("Proof Lib Geral", null, true)
    await grant(geral.accountId!, "ADMINISTRADOR_GERAL", "ORGANIZATION")
    const adminA = await person("Proof Lib Admin A", teamA, true)
    await grant(adminA.accountId!, "ADMINISTRADOR", "GROUP", teamA)
    const geralNoGrupoA = await person("Proof Lib Geral Lotado A", teamA, true)
    await grant(geralNoGrupoA.accountId!, "ADMINISTRADOR_GERAL", "ORGANIZATION")
    const semPapel = await person("Proof Lib Sem Papel", teamA, true)
    const veterana = await person("Proof Lib Veterana", teamA, true)
    const larissa = await person("Proof Lib Larissa", teamA, false)
    const pessoaB = await person("Proof Lib Pessoa B", teamB, false)
    const peopleBefore = (await client.query<{ n: number }>("select count(*)::int n from people where organization_id = $1", [org.id])).rows[0]!.n

    // Dezenas de logins do mesmo IP em segundos: o limite por IP (testado em http-security.test.ts) não é o assunto desta prova.
    const app = createApp(client as never, { rateLimits: false })
    const login = (email: string, password: string) => request(app).post("/api/v1/auth/login").send({ email, password })
    const agentFor = async (email: string, password: string) => { const agent = request.agent(app); const response = await agent.post("/api/v1/auth/login").send({ email, password }); expect(response.status, email).toBe(200); return { agent, cookie: response.headers["set-cookie"]![0]!.split(";")[0]!, body: response.body.data } }
    const admin = (await agentFor(geral.email, "Antiga@2024")).agent

    // 1) Conta existente ANTES deste fluxo: entra como sempre, sem troca obrigatória.
    expect((await agentFor(veterana.email, "Antiga@2024")).body).toMatchObject({ passwordChangeRequired: false })

    // 2) Sem permissão (conta sem papel): lista e ações negadas no SERVIDOR.
    const leigo = (await agentFor(semPapel.email, "Antiga@2024")).agent
    expect((await leigo.get("/api/v1/admin/access/users")).status).toBe(403)
    expect((await leigo.post(`/api/v1/admin/access/users/${larissa.id}/enable`).send({ email: "larissa.proof@proof-lib.inia.local" })).status).toBe(403)
    expect((await leigo.post(`/api/v1/admin/access/accounts/${veterana.accountId}/temporary-password`)).status).toBe(403)
    expect((await leigo.post(`/api/v1/admin/access/accounts/${veterana.accountId}/disable`)).status).toBe(403)

    // 3) Lista: pessoas JÁ identificadas com a situação do acesso (sem conta = desabilitado).
    const listed = (await admin.get("/api/v1/admin/access/users?search=Proof%20Lib&pageSize=50")).body.data
    const statusOf = (personId: string) => listed.items.find((item: { personId: string }) => item.personId === personId)?.accessStatus
    expect([statusOf(larissa.id), statusOf(veterana.id), statusOf(pessoaB.id)]).toEqual(["DISABLED", "ACTIVE", "DISABLED"])
    expect(listed.items.find((item: { personId: string }) => item.personId === geral.id)).toMatchObject({ self: true })

    // 4) Habilitar: e-mail obrigatório sem conta; senha temporária UMA vez, sem cache; só o hash no banco; nenhum cadastro novo.
    expect((await admin.post(`/api/v1/admin/access/users/${larissa.id}/enable`).send({})).body.error.code).toBe("ACCESS_EMAIL_REQUIRED")
    const enabled = await admin.post(`/api/v1/admin/access/users/${larissa.id}/enable`).send({ email: "Larissa.Proof@proof-lib.inia.local" })
    expect(enabled.status).toBe(201)
    expect(enabled.headers["cache-control"]).toBe("no-store")
    const temporary = enabled.body.data.temporaryPassword as string
    expect(temporary).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/)
    const stored = (await client.query("select email, password_hash, password_change_required, temporary_password_expires_at, session_version from user_accounts where person_id = $1", [larissa.id])).rows[0]
    expect(stored).toMatchObject({ email: "larissa.proof@proof-lib.inia.local", password_change_required: true })
    expect(stored.password_hash).not.toContain(temporary)
    expect(await verifyPassword(temporary, stored.password_hash)).toBe(true)
    expect(new Date(stored.temporary_password_expires_at).getTime() - Date.now()).toBeGreaterThan((env.TEMPORARY_PASSWORD_TTL_HOURS - 1) * 3_600_000)
    expect((await client.query<{ n: number }>("select count(*)::int n from people where organization_id = $1", [org.id])).rows[0]!.n).toBe(peopleBefore)
    const larissaAccount = (await client.query<{ id: string }>("select id from user_accounts where person_id = $1", [larissa.id])).rows[0]!.id
    expect((await admin.post(`/api/v1/admin/access/users/${larissa.id}/enable`).send({})).body.error.code).toBe("ACCESS_ALREADY_ENABLED")

    // 5) Primeiro login com a temporária: só criar a senha (ou sair). Páginas/APIs protegidas e "contornos" bloqueados.
    const first = await agentFor("larissa.proof@proof-lib.inia.local", temporary)
    expect(first.body).toMatchObject({ passwordChangeRequired: true })
    const pending = first.agent
    for (const path of ["/api/v1/operator/overview", "/api/v1/notifications", "/api/v1/analytics/viewer", "/api/v1/admin/access/users", "/api/v1/admin/agents", "/api/v1/realtime/conversations/current"]) {
      const blocked = await pending.get(path)
      expect(blocked.status, path).toBe(403)
      expect(blocked.body.error.code, path).toBe("PASSWORD_CHANGE_REQUIRED")
    }
    expect((await pending.put("/api/v1/me/profile").field("preferredName", "Lari")).body.error.code).toBe("PASSWORD_CHANGE_REQUIRED")
    const me = (await pending.get("/api/v1/auth/me")).body.data
    expect(me).toMatchObject({ passwordChangeRequired: true, access: { permissions: [], roles: [], capabilities: { canAccessAdministration: false } } })
    expect(me).not.toHaveProperty("sv")
    // Política e regras da troca, validadas no servidor.
    expect((await pending.post("/api/v1/auth/password").send({ newPassword: "Cajueiro2026", confirmPassword: "Cajueiro2027" })).body.error.code).toBe("PASSWORD_CONFIRMATION_MISMATCH")
    expect((await pending.post("/api/v1/auth/password").send({ newPassword: "fraca", confirmPassword: "fraca" })).body.error).toMatchObject({ code: "PASSWORD_POLICY_VIOLATION", details: { violations: expect.arrayContaining([expect.objectContaining({ code: "TOO_SHORT" }), expect.objectContaining({ code: "MISSING_DIGIT" })]) } })
    expect((await pending.post("/api/v1/auth/password").send({ newPassword: temporary, confirmPassword: temporary })).body.error.code).toBe("PASSWORD_SAME_AS_TEMPORARY")
    // Outra sessão aberta com a mesma temporária (outro aparelho) — cai quando a troca termina.
    const otherDevice = (await agentFor("larissa.proof@proof-lib.inia.local", temporary)).cookie

    // 6) Troca bem-sucedida: temporária invalidada, conta ATIVA, acesso liberado conforme as permissões, outras sessões revogadas.
    const changed = await pending.post("/api/v1/auth/password").send({ newPassword: "Cajueiro2026", confirmPassword: "Cajueiro2026" })
    expect(changed.status).toBe(200)
    expect((await pending.get("/api/v1/auth/me")).body.data).toMatchObject({ passwordChangeRequired: false })
    expect((await pending.get("/api/v1/notifications")).status).toBe(200)
    expect((await pending.get("/api/v1/admin/agents")).status).toBe(403) // sem papel = sem administração (nada concedido a mais)
    const revoked = await request(app).get("/api/v1/auth/me").set("Cookie", otherDevice)
    expect([revoked.status, revoked.body.error.code]).toEqual([401, "SESSION_REVOKED"])
    expect((await login("larissa.proof@proof-lib.inia.local", temporary)).status).toBe(401)
    expect((await login("larissa.proof@proof-lib.inia.local", "Cajueiro2026")).body.data).toMatchObject({ passwordChangeRequired: false })
    expect((await client.query("select password_change_required, temporary_password_issued_at, temporary_password_expires_at, password_changed_at is not null changed from user_accounts where id = $1", [larissaAccount])).rows[0]).toEqual({ password_change_required: false, temporary_password_issued_at: null, temporary_password_expires_at: null, changed: true })
    expect((await pending.post("/api/v1/auth/password").send({ newPassword: "Outra2026x", confirmPassword: "Outra2026x" })).body.error.code).toBe("PASSWORD_CHANGE_NOT_REQUIRED")
    expect((await admin.get(`/api/v1/admin/access/users?search=Proof%20Lib%20Larissa`)).body.data.items[0]).toMatchObject({ accessStatus: "ACTIVE" })

    // 7) Nova senha temporária: a senha atual deixa de valer, sessões revogadas, troca obrigatória de novo.
    const activeSession = (await agentFor("larissa.proof@proof-lib.inia.local", "Cajueiro2026")).cookie
    const reissued = await admin.post(`/api/v1/admin/access/accounts/${larissaAccount}/temporary-password`)
    expect([reissued.status, reissued.headers["cache-control"]]).toEqual([201, "no-store"])
    expect((await request(app).get("/api/v1/notifications").set("Cookie", activeSession)).body.error.code).toBe("SESSION_REVOKED")
    expect((await login("larissa.proof@proof-lib.inia.local", "Cajueiro2026")).status).toBe(401)
    expect((await login("larissa.proof@proof-lib.inia.local", reissued.body.data.temporaryPassword)).body.data).toMatchObject({ passwordChangeRequired: true })
    // Gerar outra invalida a anterior.
    const third = (await admin.post(`/api/v1/admin/access/accounts/${larissaAccount}/temporary-password`)).body.data.temporaryPassword
    expect((await login("larissa.proof@proof-lib.inia.local", reissued.body.data.temporaryPassword)).status).toBe(401)

    // 8) Temporária vencida: não entra; sessão pendente aberta também cai.
    const pendingSession = (await agentFor("larissa.proof@proof-lib.inia.local", third)).cookie
    await client.query("update user_accounts set temporary_password_issued_at = now() - interval '4 days', temporary_password_expires_at = now() - interval '1 day' where id = $1", [larissaAccount])
    expect((await login("larissa.proof@proof-lib.inia.local", third)).body.error.code).toBe("TEMPORARY_PASSWORD_EXPIRED")
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", pendingSession)).body.error.code).toBe("TEMPORARY_PASSWORD_EXPIRED")
    expect((await request(app).post("/api/v1/auth/password").set("Cookie", pendingSession).send({ newPassword: "Cajueiro2026", confirmPassword: "Cajueiro2026" })).body.error.code).toBe("TEMPORARY_PASSWORD_EXPIRED")
    expect((await admin.get(`/api/v1/admin/access/users?search=Proof%20Lib%20Larissa`)).body.data.items[0]).toMatchObject({ accessStatus: "PENDING_PASSWORD_CHANGE", temporaryPasswordExpired: true })

    // 9) Desabilitar: sessões caem, login recusado mesmo com a senha certa; reabilitar sempre gera outra temporária.
    const fresh = (await admin.post(`/api/v1/admin/access/accounts/${larissaAccount}/temporary-password`)).body.data.temporaryPassword
    const beforeDisable = (await agentFor("larissa.proof@proof-lib.inia.local", fresh)).cookie
    expect((await admin.post(`/api/v1/admin/access/accounts/${larissaAccount}/disable`)).status).toBe(200)
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", beforeDisable)).body.error.code).toBe("SESSION_REVOKED")
    expect((await login("larissa.proof@proof-lib.inia.local", fresh)).body.error.code).toBe("ACCESS_DISABLED")
    expect((await admin.post(`/api/v1/admin/access/accounts/${larissaAccount}/temporary-password`)).body.error.code).toBe("ACCESS_NOT_ENABLED")
    expect((await admin.post(`/api/v1/admin/access/accounts/${larissaAccount}/disable`)).body.error.code).toBe("ACCESS_ALREADY_DISABLED")
    const reenabled = await admin.post(`/api/v1/admin/access/users/${larissa.id}/enable`).send({})
    expect(reenabled.status).toBe(201)
    expect((await login("larissa.proof@proof-lib.inia.local", fresh)).status).toBe(401)
    expect((await login("larissa.proof@proof-lib.inia.local", reenabled.body.data.temporaryPassword)).body.data).toMatchObject({ passwordChangeRequired: true })

    // 10) Escopo e custódia: Administrador do Grupo A não alcança o Grupo B (404) nem toma conta de um Administrador geral do
    //     próprio Grupo (403); ninguém altera o próprio acesso.
    const adminDoGrupo = (await agentFor(adminA.email, "Antiga@2024")).agent
    expect((await adminDoGrupo.post(`/api/v1/admin/access/users/${pessoaB.id}/enable`).send({ email: "b@proof-lib.inia.local" })).status).toBe(404)
    expect((await adminDoGrupo.get("/api/v1/admin/access/users?search=Proof%20Lib&pageSize=50")).body.data.items.map((item: { personId: string }) => item.personId)).not.toContain(pessoaB.id)
    expect((await adminDoGrupo.post(`/api/v1/admin/access/accounts/${geralNoGrupoA.accountId}/temporary-password`)).body.error.code).toBe("ACCESS_TARGET_MORE_PRIVILEGED")
    expect((await adminDoGrupo.post(`/api/v1/admin/access/accounts/${geralNoGrupoA.accountId}/disable`)).body.error.code).toBe("ACCESS_TARGET_MORE_PRIVILEGED")
    expect((await adminDoGrupo.post(`/api/v1/admin/access/accounts/${veterana.accountId}/temporary-password`)).status).toBe(201)
    expect((await admin.post(`/api/v1/admin/access/accounts/${geral.accountId}/temporary-password`)).body.error.code).toBe("ACCESS_SELF_CREDENTIAL")

    // 11) Trava de tentativas: a 5ª falha já bloqueia; nem a senha certa entra até a janela passar. Nada digitado é guardado.
    const codes: number[] = []
    for (let attempt = 0; attempt < 5; attempt += 1) codes.push((await login(semPapel.email, `errada-${attempt}`)).status)
    expect(codes).toEqual([401, 401, 401, 401, 429])
    const locked = await login(semPapel.email, "Antiga@2024")
    expect([locked.status, locked.body.error.code]).toEqual([429, "LOGIN_TOO_MANY_ATTEMPTS"])
    expect(new Date(locked.body.error.details.retryAt).getTime()).toBeGreaterThan(Date.now())
    const ghost = []
    for (let attempt = 0; attempt < 5; attempt += 1) ghost.push((await login("ninguem@proof-lib.inia.local", "x")).status)
    expect(ghost).toEqual([401, 401, 401, 401, 429]) // conta inexistente trava igual (não revela quem existe)
    const stray = await client.query("select count(*)::int n from auth_login_attempts where identifier_hash like '%@%' or identifier_hash like '%errada%'")
    expect(stray.rows[0].n).toBe(0)

    // 12) Pessoas: inativar a pessoa desabilita o acesso e revoga as sessões; reativar a pessoa NÃO reabilita o login antigo.
    const veteranaTemp = (await client.query<{ password_change_required: boolean }>("select password_change_required from user_accounts where id = $1", [veterana.accountId])).rows[0]!
    expect(veteranaTemp.password_change_required).toBe(true) // gerado pelo Admin A no passo 10
    await client.query("update user_accounts set password_hash = $2, password_change_required = false, temporary_password_issued_at = null, temporary_password_expires_at = null where id = $1", [veterana.accountId, oldHash])
    const veteranaSession = (await agentFor(veterana.email, "Antiga@2024")).cookie
    expect((await admin.patch(`/api/v1/admin/users/${veterana.id}`).send({ active: false })).status).toBe(200)
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", veteranaSession)).body.error.code).toBe("SESSION_REVOKED")
    expect((await admin.patch(`/api/v1/admin/users/${veterana.id}`).send({ active: true })).status).toBe(200)
    expect((await login(veterana.email, "Antiga@2024")).body.error.code).toBe("ACCESS_DISABLED")

    // 12b) Mudar de Grupo leva junto o Subgrupo antigo (achado AUTH-4): quem administra só o Grupo A deixa de alcançá-la.
    const subteamA = (await client.query<{ id: string }>("insert into subteams (organization_id, team_id, name) values ($1, $2, 'Proof Liberação A1') returning id", [org.id, teamA])).rows[0]!.id
    await client.query("update people set subteam_id = $2 where id = $1", [pessoaB.id, subteamA])
    await client.query("update people set team_id = $2 where id = $1", [pessoaB.id, teamA])
    expect((await admin.patch(`/api/v1/admin/users/${pessoaB.id}`).send({ teamId: teamB })).status).toBe(200)
    expect((await client.query<{ team_id: string; subteam_id: string | null }>("select team_id, subteam_id from people where id = $1", [pessoaB.id])).rows[0]).toEqual({ team_id: teamB, subteam_id: null })
    const adminDoA = (await agentFor(adminA.email, "Antiga@2024")).agent
    expect((await adminDoA.get(`/api/v1/admin/users/${pessoaB.id}`)).status).toBe(404)

    // 13) Auditoria: cada ação administrativa registrada, sem senha nem hash.
    const audit = await client.query<{ action: string; payload: Record<string, unknown> }>("select action, payload from audit_logs where entity_id = any($1::uuid[]) and action like 'ACCESS_%' order by created_at", [[larissaAccount, veterana.accountId]])
    const actions = audit.rows.map((row) => row.action)
    expect(actions).toEqual(expect.arrayContaining(["ACCESS_ENABLED", "ACCESS_PASSWORD_DEFINED", "ACCESS_TEMPORARY_PASSWORD_ISSUED", "ACCESS_DISABLED"]))
    const serialized = JSON.stringify(audit.rows)
    for (const secret of [temporary, third, fresh, "Cajueiro2026", "$2a$", "$2b$"]) expect(serialized).not.toContain(secret)
  })
})
