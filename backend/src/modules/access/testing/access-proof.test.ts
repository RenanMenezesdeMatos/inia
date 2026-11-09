/**
 * PROVA contra o banco de TESTE real (V1.5.7): modelo de acesso (migration 081) de ponta a ponta — login real, guards por
 * permissão nas rotas da API, escopo de Grupo/Subgrupo, delegação, auditoria estruturada e o backfill do administrador
 * legado. Tudo numa transação desfeita no fim (banco intacto).
 * V1.5.8: Indicadores, Estrutura (dados de gestão), Calendário da equipe e a ficha do colaborador por permission + scope —
 * o nível hierárquico (inclusive o legado "ADMIN") não amplia nada; a visão operacional de quem lidera continua.
 *   INIA_DB_PROOF=1 npx vitest run access-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { assignRole, revokeRole } from "../application/access-service.js"
import { personIdsWithOrganizationWidePermission } from "../application/permission-holders.js"
import { createPostgresAccessRepository } from "../infrastructure/postgres-access-repository.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Modelo de acesso — prova Postgres (papéis × permissões × escopo)", () => {
  beforeAll(async () => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL }); client = await pool.connect(); await client.query("begin") })
  afterAll(async () => { if (client) { await client.query("rollback"); client.release() } if (pool) await pool.end() })

  it("cargo não concede; papel concede no escopo; API nega sem permissão; delegação e auditoria", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!
    // Backfill da 081: todo ADMIN legado com conta virou Administrador geral (organização) — nenhum admin perdeu acesso.
    const legacy = await client.query(`select count(*)::int n from user_accounts ua join people p on p.id = ua.person_id where p.role = 'ADMIN' and ua.organization_id = $1 and not exists (select 1 from access_role_assignments a where a.user_account_id = ua.id and a.revoked_at is null)`, [org.id])
    expect(legacy.rows[0].n).toBe(0)
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [org.id])).rows[0]!.id
    const teamA = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Grupo A') returning id", [org.id, operation])).rows[0]!.id
    const teamB = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Grupo B') returning id", [org.id, operation])).rows[0]!.id
    const hash = await hashPassword("Proof@12345")
    const person = async (name: string, level: string, teamId: string | null) => {
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, job_title, team_id) values ($1, $2, $3, $4, $5) returning id", [org.id, name, level, level === "SUPERVISOR" ? "Supervisor" : "Assistente", teamId])).rows[0]!.id
      const email = `${name.toLowerCase().replaceAll(" ", "-")}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [org.id, id, email, hash])).rows[0]!.id
      return { id, accountId, email }
    }
    const geral = await person("Proof Geral", "OPERATOR", null)
    await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, 'ADMINISTRADOR_GERAL', 'ORGANIZATION', now())", [org.id, geral.accountId])
    const supervisor = await person("Proof Supervisor Sem Papel", "SUPERVISOR", teamA)
    const assistente = await person("Proof Assistente QA", "OPERATOR", teamA)
    const adminA = await person("Proof Admin A", "SUPERVISOR", teamA)
    const pessoaB = await person("Proof Pessoa B", "OPERATOR", teamB)
    const deps = { repository: createPostgresAccessRepository(client), now: () => new Date() }
    const as = (p: { id: string; accountId: string }) => ({ organizationId: org.id, accountId: p.accountId, personId: p.id })
    await assignRole(deps, as(geral), { accountId: assistente.accountId, roleCode: "QA_DE_FEEDBACK", scope: { type: "GROUP", teamId: teamA } })
    const adminGrant = await assignRole(deps, as(geral), { accountId: adminA.accountId, roleCode: "ADMINISTRADOR", scope: { type: "GROUP", teamId: teamA } })

    const app = createApp(client as never)
    const login = async (email: string) => { const agent = request.agent(app); expect((await agent.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200); return agent }
    // Supervisor (cargo) sem papel: nada administrativo, nem pela UI nem por chamada manual à API.
    const sup = await login(supervisor.email)
    expect((await sup.get("/api/v1/auth/me")).body.data.access).toMatchObject({ permissions: [], capabilities: { canAccessAdministration: false, canReviewFeedback: false } })
    for (const path of ["/api/v1/admin/agents", "/api/v1/admin/workflows", "/api/v1/admin/users", "/api/v1/admin/qa-lab/runs", "/api/v1/admin/access/accounts"]) expect((await sup.get(path)).status, path).toBe(403)
    expect((await sup.post(`/api/v1/admin/access/accounts/${pessoaB.accountId}/roles`).send({ roleCode: "QA_DE_FEEDBACK", scope: { type: "ORGANIZATION" } })).status).toBe(403)
    // Assistente com QA: capability de QA, nenhuma administração.
    const qa = await login(assistente.email)
    expect((await qa.get("/api/v1/auth/me")).body.data.access.capabilities).toMatchObject({ canReviewFeedback: true, canAccessAdministration: false })
    expect((await qa.get("/api/v1/admin/agents")).status).toBe(403)
    // Admin do Grupo A: administra agentes e acessos só do Grupo A; QA Lab (organização) negado.
    const admin = await login(adminA.email)
    expect((await admin.get("/api/v1/admin/agents")).status).toBe(200)
    expect((await admin.get("/api/v1/admin/qa-lab/runs")).status).toBe(403)
    const visible = (await admin.get("/api/v1/admin/access/accounts?pageSize=100")).body.data.items.map((item: { collaborator: { name: string } }) => item.collaborator.name)
    expect(visible).toEqual(expect.arrayContaining(["Proof Assistente QA", "Proof Supervisor Sem Papel", "Proof Admin A"]))
    expect(visible).not.toContain("Proof Pessoa B")
    const escalate = await admin.post(`/api/v1/admin/access/accounts/${supervisor.accountId}/roles`).send({ roleCode: "ADMINISTRADOR", scope: { type: "ORGANIZATION" } })
    expect([escalate.status, escalate.body.error.code]).toEqual([403, "ACCESS_SCOPE_EXCEEDS_GRANTOR"])
    expect((await admin.post(`/api/v1/admin/access/accounts/${pessoaB.accountId}/roles`).send({ roleCode: "QA_DE_FEEDBACK", scope: { type: "GROUP", teamId: teamB } })).body.error.code).toBe("ACCESS_SCOPE_EXCEEDS_GRANTOR")
    expect((await admin.post(`/api/v1/admin/access/accounts/${adminA.accountId}/roles`).send({ roleCode: "QA_DE_FEEDBACK", scope: { type: "GROUP", teamId: teamA } })).body.error.code).toBe("ACCESS_SELF_ASSIGNMENT")
    const granted = await admin.post(`/api/v1/admin/access/accounts/${supervisor.accountId}/roles`).send({ roleCode: "QA_DE_FEEDBACK", scope: { type: "GROUP", teamId: teamA } })
    expect(granted.status).toBe(201)
    // O cargo de ninguém mudou.
    expect((await client.query("select role, job_title from people where id = $1", [supervisor.id])).rows[0]).toEqual({ role: "SUPERVISOR", job_title: "Supervisor" })
    // Auditoria estruturada (concessão com papel, permissões e escopo) e revogação que não apaga.
    const auditRow = (await client.query("select action, actor_id, payload from audit_logs where entity_type = 'access_role_assignment' and entity_id = $1", [granted.body.data.id])).rows[0]
    expect(auditRow).toMatchObject({ action: "ACCESS_ROLE_GRANTED", actor_id: adminA.id, payload: { roleCode: "QA_DE_FEEDBACK", recipientAccountId: supervisor.accountId, permissions: ["feedback_quality_review.view", "feedback_quality_review.decide"], scope: { type: "GROUP", teamId: teamA } } })
    await revokeRole(deps, as(geral), { accountId: adminA.accountId, assignmentId: adminGrant.id, reason: "prova" })
    expect((await admin.get("/api/v1/admin/agents")).status).toBe(403)
    expect((await client.query("select revoked_at is not null revoked from access_role_assignments where id = $1", [adminGrant.id])).rows[0]).toEqual({ revoked: true })
    expect((await client.query("select count(*)::int n from audit_logs where entity_id = $1 and action = 'ACCESS_ROLE_REVOKED'", [adminGrant.id])).rows[0].n).toBe(1)
  })

  it("Central de Dados: só Administrador geral e Administrador de dados; o Administrador perde a entrada e só o geral concede", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!
    const hash = await hashPassword("Proof@12345")
    const person = async (name: string) => {
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, $2, 'ADMIN') returning id", [org.id, name])).rows[0]!.id
      const email = `${name.toLowerCase().replaceAll(" ", "-")}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [org.id, id, email, hash])).rows[0]!.id
      return { id, accountId, email }
    }
    const grant = (accountId: string, roleCode: string) => client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, $3, 'ORGANIZATION', now())", [org.id, accountId, roleCode])
    const geral = await person("Proof Central Geral")
    await grant(geral.accountId, "ADMINISTRADOR_GERAL")
    const administrador = await person("Proof Central Administrador")
    await grant(administrador.accountId, "ADMINISTRADOR")
    const dados = await person("Proof Central Dados")
    const app = createApp(client as never, { rateLimits: false })
    const login = async (email: string) => { const agent = request.agent(app); expect((await agent.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200); return agent }

    const admin = await login(administrador.email)
    expect((await admin.get("/api/v1/admin/data-hub/sources")).status).toBe(403)
    expect((await admin.post("/api/v1/ingestion/interactions").send({})).status).toBe(403)
    expect((await admin.get("/api/v1/auth/me")).body.data.access.capabilities).toMatchObject({ canAccessAdministration: true, canManageDataHub: false })
    expect((await admin.post(`/api/v1/admin/access/accounts/${dados.accountId}/roles`).send({ roleCode: "ADMINISTRADOR_DE_DADOS", scope: { type: "ORGANIZATION" } })).body.error.code).toBe("ACCESS_ROLE_NOT_DELEGABLE")

    const general = await login(geral.email)
    expect((await general.post(`/api/v1/admin/access/accounts/${dados.accountId}/roles`).send({ roleCode: "ADMINISTRADOR_DE_DADOS", scope: { type: "GROUP", teamId: "00000000-0000-4000-8000-000000000000" } })).status).toBeGreaterThanOrEqual(400)
    expect((await general.post(`/api/v1/admin/access/accounts/${dados.accountId}/roles`).send({ roleCode: "ADMINISTRADOR_DE_DADOS", scope: { type: "ORGANIZATION" } })).status).toBe(201)

    const dataAdmin = await login(dados.email)
    expect((await dataAdmin.get("/api/v1/admin/data-hub/sources")).status).toBe(200)
    expect((await dataAdmin.get("/api/v1/auth/me")).body.data.access).toMatchObject({ permissions: ["data_hub.cancel_records", "data_hub.explore", "data_hub.manage"], capabilities: { canAccessAdministration: true, canManageDataHub: true, canExploreData: true, canManageConfiguration: false } })
    for (const path of ["/api/v1/admin/agents", "/api/v1/admin/workflows", "/api/v1/admin/users", "/api/v1/admin/qa-lab/runs", "/api/v1/admin/access/accounts"]) expect((await dataAdmin.get(path)).status, path).toBe(403)
    const holders = await personIdsWithOrganizationWidePermission(client, org.id, "data_hub.manage")
    expect(holders).toEqual(expect.arrayContaining([geral.id, dados.id]))
    expect(holders).not.toContain(administrador.id)
  })

  it("V1.5.8 — Indicadores, Estrutura, Calendário e ficha: permission + scope, nunca nível hierárquico; Supervisor mantém a visão operacional", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [org.id])).rows[0]!.id
    const team = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Financeiro') returning id", [org.id, operation])).rows[0]!.id
    const subteam = async (name: string) => (await client.query<{ id: string }>("insert into subteams (organization_id, team_id, name) values ($1, $2, $3) returning id", [org.id, team, name])).rows[0]!.id
    const contas = await subteam("Proof Contas")
    const cobranca = await subteam("Proof Cobrança")
    const hash = await hashPassword("Proof@12345")
    let n = 0
    const person = async (level: string, subteamId: string | null, reportsTo: string | null, roleCode?: string, scope?: { type: string; teamId?: string; subteamId?: string }, organizationId = org.id) => {
      n += 1
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id, subteam_id, reports_to_id) values ($1, $2, $3, $4, $5, $6) returning id", [organizationId, `Proof 158 ${level} ${n}`, level, subteamId ? team : null, subteamId, reportsTo])).rows[0]!.id
      const email = `proof-158-${n}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [organizationId, id, email, hash])).rows[0]!.id
      if (roleCode && scope) await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, subteam_id, granted_at) values ($1, $2, $3, $4, $5, $6, now())", [organizationId, accountId, roleCode, scope.type, scope.teamId ?? null, scope.subteamId ?? null])
      return { id, email }
    }
    const supContas = await person("SUPERVISOR", contas, null)
    const opContas = await person("OPERATOR", contas, supContas.id)
    const supCobranca = await person("SUPERVISOR", cobranca, null)
    const opCobranca = await person("OPERATOR", cobranca, supCobranca.id)
    const adminContas = await person("ADMIN", null, null, "ADMINISTRADOR", { type: "SUBGROUP", subteamId: contas })
    const legacyAdmin = await person("ADMIN", null, null)
    const accessAdmin = await person("ADMIN", null, null, "ADMINISTRADOR_DE_ACESSOS", { type: "ORGANIZATION" })
    const qa = await person("OPERATOR", null, null, "QA_DE_FEEDBACK", { type: "ORGANIZATION" })
    const geral = await person("OPERATOR", null, null, "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" })
    const otherOrg = (await client.query<{ id: string }>("insert into organizations (name, slug) values ('Proof Outra Org 158', 'proof-outra-org-158') returning id")).rows[0]!.id
    const outsider = await person("OPERATOR", null, null, undefined, undefined, otherOrg)

    const app = createApp(client as never)
    const login = async (email: string) => { const agent = request.agent(app); expect((await agent.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200); return agent }
    const probe = async (email: string) => {
      const agent = await login(email)
      const status = async (path: string) => (await agent.get(path)).status
      const metrics = async (leaderId: string) => (await agent.get(`/api/v1/people/${leaderId}/organization-structure`)).body.data?.subject?.managementMetrics ?? null
      return {
        capabilities: (await agent.get("/api/v1/auth/me")).body.data.access.capabilities,
        indicators: { contas: await status(`/api/v1/analytics/context?subjectKind=EMPLOYEE&subjectId=${opContas.id}`), cobranca: await status(`/api/v1/analytics/context?subjectKind=EMPLOYEE&subjectId=${opCobranca.id}`) },
        ficha: { contas: await status(`/api/v1/supervisor/operators/${opContas.id}`), cobranca: await status(`/api/v1/supervisor/operators/${opCobranca.id}`) },
        calendar: { contas: await status(`/api/v1/team-calendar?anchorId=${supContas.id}&from=2026-09-14&to=2026-09-16`), cobranca: await status(`/api/v1/team-calendar?anchorId=${supCobranca.id}&from=2026-09-14&to=2026-09-16`) },
        metrics: { contas: (await metrics(supContas.id)) !== null, cobranca: (await metrics(supCobranca.id)) !== null },
        outsider: await status(`/api/v1/analytics/context?subjectKind=EMPLOYEE&subjectId=${outsider.id}`),
      }
    }

    // Administrador com escopo SUBGROUP Contas: vê Contas; NÃO vê Cobrança por ser "Administrador".
    expect(await probe(adminContas.email)).toMatchObject({
      capabilities: { canViewIndicators: true, canViewStructureMetrics: true, canManageCalendar: true },
      indicators: { contas: 200, cobranca: 403 }, ficha: { contas: 200, cobranca: 403 }, calendar: { contas: 200, cobranca: 403 }, metrics: { contas: true, cobranca: false }, outsider: 403,
    })
    // Nível hierárquico legado "ADMIN" sem papel: nenhum bypass (nem por chamada HTTP manual).
    expect(await probe(legacyAdmin.email)).toMatchObject({
      capabilities: { canAccessAdministration: false, canViewIndicators: false, canViewStructureMetrics: false, canManageCalendar: false },
      indicators: { contas: 403, cobranca: 403 }, ficha: { contas: 403, cobranca: 403 }, calendar: { contas: 403, cobranca: 403 }, metrics: { contas: false, cobranca: false }, outsider: 403,
    })
    // Administrador de acessos e QA de feedback (organização inteira): administrar acessos / avaliar QA não dá Indicadores, Estrutura nem Calendário.
    for (const account of [accessAdmin, qa]) {
      expect(await probe(account.email), account.email).toMatchObject({
        capabilities: { canViewIndicators: false, canViewStructureMetrics: false, canManageCalendar: false },
        indicators: { contas: 403, cobranca: 403 }, ficha: { contas: 403, cobranca: 403 }, calendar: { contas: 403, cobranca: 403 }, metrics: { contas: false, cobranca: false },
      })
    }
    // Administrador geral: pelas permissions com escopo ORGANIZATION — e nunca outra organização.
    expect(await probe(geral.email)).toMatchObject({
      capabilities: { canViewIndicators: true, canViewStructureMetrics: true, canManageCalendar: true },
      indicators: { contas: 200, cobranca: 200 }, ficha: { contas: 200, cobranca: 200 }, calendar: { contas: 200, cobranca: 200 }, metrics: { contas: true, cobranca: true }, outsider: 403,
    })
    // Supervisor sem papel: a própria equipe (regra operacional) e os dados de gestão de líderes (regra de produto de quem
    // lidera); nada da equipe de outro Supervisor e nenhuma capability administrativa.
    expect(await probe(supContas.email)).toMatchObject({
      capabilities: { canAccessAdministration: false, canViewIndicators: false, canManageCalendar: false },
      indicators: { contas: 200, cobranca: 403 }, ficha: { contas: 200, cobranca: 403 }, calendar: { contas: 200, cobranca: 403 }, metrics: { contas: true, cobranca: true }, outsider: 403,
    })
    // Mudar o nível hierárquico (importação/cadastro) não mexe em acesso: o legado vira Diretor (sem ninguém abaixo) e continua sem visão de Contas nem de Cobrança.
    await client.query("update people set role = 'DIRECTOR' where id = $1", [legacyAdmin.id])
    expect((await probe(legacyAdmin.email)).indicators).toEqual({ contas: 403, cobranca: 403 })
  })

  it("V1.5.8a — QA de feedback: fora da hierarquia (sem cargo, grupo, subgrupo nem gestor) + QA_DE_FEEDBACK na ORGANIZAÇÃO → permitido; Supervisor sem o papel → 403; módulo desligado → 404 e features=false (nunca 'sem permissão')", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!
    const hash = await hashPassword("Proof@12345")
    const person = async (tag: string, level: string, reportsTo: string | null, roleCode?: string) => {
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, job_title, team_id, subteam_id, reports_to_id) values ($1, $2, $3, null, null, null, $4) returning id", [org.id, `Proof QA ${tag}`, level, reportsTo])).rows[0]!.id
      const email = `proof-qa-${tag}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [org.id, id, email, hash])).rows[0]!.id
      if (roleCode) await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, $3, 'ORGANIZATION', now())", [org.id, accountId, roleCode])
      return { id, email }
    }
    const outside = await person("fora", "ADMIN", null, "QA_DE_FEEDBACK")
    const supervisor = await person("sup", "SUPERVISOR", null)
    await person("op", "OPERATOR", supervisor.id) // o Supervisor LIDERA alguém — e mesmo assim não tem QA
    const login = async (app: ReturnType<typeof createApp>, email: string) => { const agent = request.agent(app); expect((await agent.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200); return agent }

    const on = createApp(client as never, { interactionFeedbackReview: true })
    const qa = await login(on, outside.email)
    expect((await qa.get("/api/v1/auth/me")).body.data).toMatchObject({ features: { interactionFeedbackQa: true }, access: { capabilities: { canReviewFeedback: true } } })
    const allowed = await qa.get("/api/v1/feedback-quality-reviews/access")
    expect([allowed.status, allowed.body.data]).toEqual([200, { canReview: true, canDecide: true, scopes: [{ scopeType: "ORGANIZATION", label: "Toda a organização" }] }])
    expect((await qa.get("/api/v1/feedback-quality-reviews")).status).toBe(200)
    const sup = await login(on, supervisor.email)
    expect((await sup.get("/api/v1/feedback-quality-reviews/access")).body.data).toEqual({ canReview: false, canDecide: false, scopes: [] })
    expect((await sup.get("/api/v1/feedback-quality-reviews")).status).toBe(403)

    // Módulo DESLIGADO: rota não existe (404) e o /auth/me diz isso explicitamente — a permissão continua lá, intacta.
    const off = createApp(client as never, { interactionFeedbackReview: false })
    const qaOff = await login(off, outside.email)
    expect((await qaOff.get("/api/v1/auth/me")).body.data).toMatchObject({ features: { interactionFeedbackQa: false }, access: { capabilities: { canReviewFeedback: true } } })
    expect((await qaOff.get("/api/v1/feedback-quality-reviews/access")).status).toBe(404)
  })
})
