/**
 * PROVA contra um banco real com a migration 197: universo de atuação (B2B, B2C, B2X) de ponta a ponta. Tudo numa transação desfeita
 * no fim (banco intacto). Cenários do pedido: operador B2B, B2C e B2X; coordenador B2B do Grupo X/Subgrupo Y; gestor com todos os
 * universos; legado pendente; acesso cruzado por API/ID; ativação; vínculos entre universos; histórico ao trocar de operação.
 *   INIA_DB_PROOF=1 TEST_DATABASE_URL=postgresql://localhost:5432/<banco com a 197> npx vitest run operating-universe-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { loadViewerScope, visibleOperators } from "../../performance-analytics/application/viewer-scope.js"
import { loadAgentKnowledgeSnapshot } from "../../knowledge/application/retrieve-knowledge.js"
import { resolveEligibleOperatorIds, isOperatorEligibleForWorkflow } from "../../workflows/application/workflow-eligibility.js"
import { buildOperatorIdentity } from "../../assistant/application/build-operator-context.js"
import { renderAskingPersonProfile } from "../../assistant/domain/asking-person-profile.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Universo de atuação — prova Postgres", () => {
  beforeAll(async () => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL }); client = await pool.connect(); await client.query("begin") })
  afterAll(async () => { if (client) { await client.query("rollback"); client.release() } if (pool) await pool.end() })

  it("cadastro, ativação, chat, workflows, analytics, acesso cruzado e vínculos respeitam o universo", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!.id
    // Organização começa sem a exigência (estado da migration): nada filtrado.
    await client.query("update organizations set operating_universe_enforced_at = null where id = $1", [org])
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [org])).rows[0]!.id
    const teamX = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Universo X') returning id", [org, operation])).rows[0]!.id
    const subY = (await client.query<{ id: string }>("insert into subteams (organization_id, team_id, name) values ($1, $2, 'Proof Universo Y') returning id", [org, teamX])).rows[0]!.id
    const hash = await hashPassword("Proof@12345")
    const person = async (name: string, level: string, universe: string | null, reportsTo: string | null, withAccount = true) => {
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id, subteam_id, reports_to_id, operating_universe_override) values ($1,$2,$3,$4,$5,$6,$7) returning id", [org, name, level, teamX, subY, reportsTo, universe])).rows[0]!.id
      const email = `${name.toLowerCase().replaceAll(" ", "-")}@proof-universo.inia.local`
      const accountId = withAccount ? (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,$4) returning id", [org, id, email, hash])).rows[0]!.id : null
      return { id, accountId: accountId!, email }
    }
    const admin = await person("Proof Universo Admin", "ADMIN", "B2B", null)
    await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1,$2,'ADMINISTRADOR_GERAL','ORGANIZATION',now())", [org, admin.accountId])
    const gestor = await person("Proof Universo Gestor", "MANAGER", "B2B", null)
    const coord = await person("Proof Universo Coordenador", "COORDINATOR", "B2B", gestor.id)
    const opB2B = await person("Proof Universo Op B2B", "OPERATOR", "B2B", coord.id)
    const opB2C = await person("Proof Universo Op B2C", "OPERATOR", "B2C", coord.id)
    const opB2X = await person("Proof Universo Op B2X", "OPERATOR", "B2X", coord.id)
    const legado = await person("Proof Universo Op Legado", "OPERATOR", null, coord.id)
    // Gestor: permissão EXPLÍCITA para todos os universos, só na própria estrutura (abrangência organizacional do perfil).
    await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1,$2,'ACESSO_A_TODOS_OS_UNIVERSOS','MY_STRUCTURE',now())", [org, gestor.accountId])

    const app = createApp(client as never)
    const login = async (email: string) => { const agent = request.agent(app); expect((await agent.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200); return agent }
    const asAdmin = await login(admin.email)

    // /auth/me: universo vem do cadastro, resolvido no backend; o legado aparece como pendente.
    expect((await (await login(opB2C.email)).get("/api/v1/auth/me")).body.data).toMatchObject({ operatingUniverse: "B2C", operatingUniverseEnforced: false })
    expect((await (await login(legado.email)).get("/api/v1/auth/me")).body.data.operatingUniverse).toBeNull()
    // Ninguém muda o próprio universo.
    expect((await (await login(coord.email)).patch(`/api/v1/admin/users/${coord.id}`).send({ operatingUniverse: "B2C" })).status).toBe(403)

    // INIA: o universo entra como contexto estruturado do perfil do operador.
    const identity = await buildOperatorIdentity(client as never, org, opB2B.id)
    expect(renderAskingPersonProfile(identity!)).toContain("Universo de atuação: B2B")
    expect(renderAskingPersonProfile((await buildOperatorIdentity(client as never, org, legado.id))!)).toContain("pendente de classificação")

    // Antes da ativação: nada filtrado (o coordenador vê os 4 operadores, como hoje).
    const repository = new PgAnalyticsReadRepository(client as never)
    const session = (p: { id: string; accountId: string }, role: string) => ({ organizationId: org, personId: p.id, sub: p.accountId, role } as never)
    expect(visibleOperators(await loadViewerScope(repository, session(coord, "COORDINATOR"))).map((node) => node.id).sort()).toEqual([opB2B.id, opB2C.id, opB2X.id, legado.id].sort())

    // Prontidão: o legado pendente aparece e a ativação exige confirmar a contagem.
    const readiness = (await asAdmin.get("/api/v1/admin/operating-universe/readiness")).body.data
    expect(readiness.people.pending).toBeGreaterThan(0)
    const refused = await asAdmin.put("/api/v1/admin/operating-universe/enforcement").send({ enforce: true })
    expect([refused.status, refused.body.error.code]).toEqual([409, "OPERATING_UNIVERSE_ACTIVATION_UNCONFIRMED"])
    expect((await asAdmin.put("/api/v1/admin/operating-universe/enforcement").send({ enforce: true, acknowledgedPending: refused.body.error.details.pending })).status).toBe(200)

    // ATIVO — liderança vê a PRÓPRIA estrutura em qualquer universo (supervisor/coordenador pode liderar B2B e B2C): os quatro.
    expect(visibleOperators(await loadViewerScope(repository, session(coord, "COORDINATOR"))).map((node) => node.id).sort()).toEqual([opB2B.id, opB2C.id, opB2X.id, legado.id].sort())
    expect(visibleOperators(await loadViewerScope(repository, session(gestor, "MANAGER"))).map((node) => node.id).sort()).toEqual([opB2B.id, opB2C.id, opB2X.id, legado.id].sort())
    // Acesso cruzado por ID: quem não lidera nem tem papel não abre a ficha nem os indicadores de ninguém (parâmetro da tela não amplia).
    const outsider = await person("Proof Universo Coordenador Outro", "COORDINATOR", null, null)
    const asOutsider = await login(outsider.email)
    expect((await asOutsider.get(`/api/v1/supervisor/operators/${opB2C.id}`)).status).toBe(403)
    expect((await asOutsider.get(`/api/v1/analytics/indicators?subjectKind=EMPLOYEE&subjectId=${opB2C.id}`)).status).toBe(403)
    const asCoord = await login(coord.email)
    expect((await asCoord.get(`/api/v1/supervisor/operators/${opB2C.id}`)).status).not.toBe(403)

    // Cadastro novo: OPERADOR precisa de universo (exceção dele ou o do Grupo); o Grupo X ainda não tem. Liderança/fora da hierarquia não precisa.
    const created = await asAdmin.post("/api/v1/admin/users").send({ name: "Proof Universo Sem", role: "OPERATOR", teamId: teamX, matricula: "PROOF-UNIV-1", email: "sem@proof-universo.inia.local" })
    expect([created.status, created.body.error?.code]).toEqual([422, "OPERATING_UNIVERSE_REQUIRED"])
    expect((await asAdmin.post("/api/v1/admin/users").send({ name: "Proof Universo Fora", role: "ADMIN", email: "fora@proof-universo.inia.local" })).status).toBe(201)
    const withUniverse = await asAdmin.post("/api/v1/admin/users").send({ name: "Proof Universo Com", role: "OPERATOR", teamId: teamX, matricula: "PROOF-UNIV-2", email: "com@proof-universo.inia.local", operatingUniverse: "B2X" })
    expect(withUniverse.status).toBe(201)
    expect((await asAdmin.post("/api/v1/admin/knowledge").field("title", "Proof base sem universo").field("documentType", "PROCEDURE").field("content", "Procedimento de teste com texto suficiente.")).body.error.code).toBe("OPERATING_UNIVERSE_REQUIRED")
    // Regularização do legado: o administrador classifica; a primeira classificação preserva os vínculos e o caso legado recebe o universo.
    const legacyCase = (await client.query<{ id: string }>("insert into supervision_cases (organization_id, operator_id, team_id, title, summary, priority, indicator_code, indicator_value, indicator_target) values ($1,$2,$3,'Proof caso legado','x','P2','X','1','2') returning id", [org, legado.id, teamX])).rows[0]!.id
    expect((await client.query("select operating_universe from supervision_cases where id = $1", [legacyCase])).rows[0].operating_universe).toBeNull()
    // O Grupo é classificado (como viria na carga de Grupos): o operador sem exceção herda; quem tem exceção continua com a dele.
    expect((await asAdmin.put(`/api/v1/admin/operating-universe/units/TEAM/${teamX}`).send({ operatingUniverse: "B2B" })).status).toBe(200)
    expect((await client.query("select operating_universe, reports_to_id from people where id = $1", [legado.id])).rows[0]).toEqual({ operating_universe: "B2B", reports_to_id: coord.id })
    expect((await client.query("select operating_universe from people where id = $1", [opB2C.id])).rows[0].operating_universe).toBe("B2C")
    expect((await client.query("select operating_universe from supervision_cases where id = $1", [legacyCase])).rows[0].operating_universe).toBe("B2B")
    expect((await asAdmin.get(`/api/v1/admin/users/${legado.id}`)).body.data).toMatchObject({ operatingUniverse: "B2B", operatingUniverseOverride: null, operatingUniverseSource: "GROUP" })
    // Agora o operador novo do Grupo X entra sem exceção.
    expect((await asAdmin.post("/api/v1/admin/users").send({ name: "Proof Universo Herda", role: "OPERATOR", teamId: teamX, matricula: "PROOF-UNIV-3", email: "herda@proof-universo.inia.local" })).status).toBe(201)

    // Indicadores: a linha só conta se o indicador for do universo vigente da pessoa NA competência; trocar de operação não apaga o passado.
    const indicator = async (code: string, universe: string) => (await client.query<{ id: string }>("insert into indicator_definitions (organization_id, code, name, unit, desired_direction, operating_universe) values ($1,$2,$2,'PERCENT','HIGHER',$3) returning id", [org, code, universe])).rows[0]!.id
    const indB2B = await indicator("PROOF_UNIV_B2B", "B2B")
    const indB2C = await indicator("PROOF_UNIV_B2C", "B2C")
    for (const [ind, period] of [[indB2B, "2020-01"], [indB2C, "2020-01"]] as const) {
      await client.query("insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, source) values ($1,$2,$3,$4,50,'PROOF')", [org, opB2B.id, ind, period])
    }
    const codes = async () => (await repository.loadIndicatorPerformance(org, [opB2B.id], ["2020-01"])).map((row) => row.indicatorCode).sort()
    expect(await codes()).toEqual(["PROOF_UNIV_B2B"])
    // Exceção com vigência informada: a troca vale a partir da data, e 2020 continua B2B.
    await client.query("update people set operating_universe_override = 'B2C', operating_universe_effective_from = '2026-06-01' where id = $1", [opB2B.id])
    expect(await codes()).toEqual(["PROOF_UNIV_B2B"]) // 2020 continua no universo em que aconteceu

    // Workflows: a população do Workflow B2C só tem operadores B2C (pendente e outros universos fora).
    const population = { scopeType: "SUBTEAM", teamId: teamX, subteamId: subY, populationFilter: null, requireActiveAccess: false }
    const b2c = await resolveEligibleOperatorIds(client as never, org, { ...population, operatingUniverse: "B2C" })
    expect(b2c.sort()).toEqual([opB2B.id, opB2C.id].sort()) // opB2B mudou para B2C acima
    expect(await resolveEligibleOperatorIds(client as never, org, { ...population, operatingUniverse: null })).toEqual([])
    expect(await isOperatorEligibleForWorkflow(client as never, org, { ...population, operatingUniverse: "B2X" }, opB2C.id)).toBe(false)
    expect(await isOperatorEligibleForWorkflow(client as never, org, { ...population, operatingUniverse: "B2X" }, opB2X.id)).toBe(true)

    // Chat: o agente B2B só recupera bases B2B publicadas (a base B2C ligada a ele por engano fica fora; pendente também).
    const agent = (await client.query<{ id: string }>("insert into agents (organization_id, name, agent_type, objective, description, context_prompt, operating_universe) values ($1,'Proof agente B2B','CUSTOM','o','d','c','B2B') returning id", [org])).rows[0]!.id
    const base = async (title: string, universe: string | null) => {
      const id = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, operating_universe) values ($1,$2,'PROCEDURE',$3) returning id", [org, title, universe])).rows[0]!.id
      await client.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1,$2,1,'conteúdo','PUBLISHED','h')", [org, id])
      await client.query("insert into knowledge_document_org_scopes (knowledge_document_id, scope_type) values ($1,'ALL_TEAMS')", [id])
      await client.query("insert into agent_knowledge_documents (agent_id, knowledge_document_id) values ($1,$2)", [agent, id])
      return id
    }
    const kbB2B = await base("Proof base B2B", "B2B")
    await base("Proof base B2C", "B2C")
    await base("Proof base pendente", null)
    expect((await loadAgentKnowledgeSnapshot(client as never, agent)).documents.map((document) => document.id)).toEqual([kbB2B])

    // Vínculos: produto B2C não entra numa base B2B; mudar o universo de um recurso com vínculo de outro universo é recusado com a lista.
    const product = await asAdmin.post("/api/v1/admin/product-catalog/nodes").send({ kind: "PRODUCT", code: "PROOF_UNIV_PROD", name: "Proof produto" })
    expect(product.body.error.code).toBe("OPERATING_UNIVERSE_REQUIRED")
    const productB2C = (await asAdmin.post("/api/v1/admin/product-catalog/nodes").send({ kind: "PRODUCT", code: "PROOF_UNIV_PROD", name: "Proof produto", operatingUniverse: "B2C" })).body.data.id
    await client.query("insert into product_scope_assignments (organization_id, source_kind, source_id, node_ids, effective_from) values ($1,'KNOWLEDGE_DOCUMENT',$2,$3,now())", [org, kbB2B, [productB2C]])
    const conflict = await asAdmin.put(`/api/v1/admin/operating-universe/resources/PRODUCT/${productB2C}`).send({ operatingUniverse: "B2X" })
    expect([conflict.status, conflict.body.error.code]).toEqual([409, "OPERATING_UNIVERSE_LINK_CONFLICT"]) // a base B2B ligada continuaria em outro universo
    expect((await asAdmin.get("/api/v1/admin/operating-universe/readiness")).body.data.conflicts.some((item: { from: { id: string } }) => item.from.id === kbB2B)).toBe(true)
    const kbChange = await asAdmin.put(`/api/v1/admin/knowledge/${kbB2B}/operating-universe`).send({ operatingUniverse: "B2C" })
    expect([kbChange.status, kbChange.body.error.code]).toEqual([409, "OPERATING_UNIVERSE_LINK_CONFLICT"]) // o agente B2B que usa a base ficaria em outro universo
  })
})
