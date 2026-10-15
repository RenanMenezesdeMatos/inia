import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import type { PersonAvatarLoader } from "../../profile-preferences/application/person-presentation-loader.js"
import type { FollowUpItem } from "../domain/view-models.js"
import { fixtureOrg, IDS } from "../testing/fixture-org.js"
import { InMemoryAnalyticsRepository, ORG, person, type InMemoryOrg } from "../testing/in-memory-analytics-repository.js"
import { createAnalyticsRouter } from "./analytics-router.js"

const noDatabase = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database

/** App mínimo com o mesmo error handler de app.ts e uma sessão injetada por header — testa o
 * router (parsing, escopo, mapeamento de erro) sem depender de JWT/cookie nem de Postgres. */
function appAs(user: AuthTokenPayload | null, org: InMemoryOrg = fixtureOrg(), personAvatars?: PersonAvatarLoader) {
  const app = express()
  app.use((requestObject, _response, next) => {
    if (user) requestObject.user = user
    next()
  })
  app.use("/analytics", (requestObject, response, next) => (requestObject.user ? next() : response.status(401).json({ error: { code: "UNAUTHENTICATED" } })), // Relógio em outubro: a fixture fecha em 2026-09 e o guard central do fechamento oficial só
  // enxerga competências <= último mês fechado (em 15/09, setembro NÃO seria fechamento).
  createAnalyticsRouter(noDatabase, new InMemoryAnalyticsRepository(org), () => new Date("2026-10-05T12:00:00Z"), personAvatars))
  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof DomainError) return response.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
    if (error instanceof ZodError) return response.status(400).json({ error: { code: "VALIDATION_ERROR" } })
    void next
    return response.status(500).json({ error: { code: "INTERNAL_ERROR" } })
  }
  app.use(errorHandler)
  return app
}

function user(personId: string, role: AuthTokenPayload["role"]): AuthTokenPayload {
  return { sub: "acc", personId, organizationId: ORG, role, name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
}

describe("GET /analytics — autenticação e escopo via API", () => {
  it("sem sessão → 401 em todas as rotas", async () => {
    const app = appAs(null)
    for (const path of ["/analytics/context", "/analytics/indicators", "/analytics/team", "/analytics/team/members", "/analytics/follow-ups"]) {
      expect((await request(app).get(path)).status).toBe(401)
    }
  })

  it("Supervisor pedindo a equipe de outro supervisor pela query string → 403 de domínio, não 500", async () => {
    const response = await request(appAs(user(IDS.vanessa, "SUPERVISOR"))).get(`/analytics/indicators?subjectKind=SUPERVISOR_TEAM&subjectId=${IDS.bruno}&period=2026-09`)
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe("STRUCTURE_ACCESS_DENIED")
  })

  it("Gerente pedindo a estrutura do diretor ou um operador de outra gerência → 403", async () => {
    const app = appAs(user(IDS.managerA, "MANAGER"))
    expect((await request(app).get(`/analytics/team?subjectKind=DIRECTOR_STRUCTURE&subjectId=${IDS.director}`)).status).toBe(403)
    expect((await request(app).get(`/analytics/indicators?subjectKind=EMPLOYEE&subjectId=${IDS.op3}`)).status).toBe(403)
    expect((await request(app).get(`/analytics/team/members?subjectKind=SUPERVISOR_TEAM&subjectId=${IDS.bruno}`)).status).toBe(403)
  })

  it("Operador só recebe a própria visão EMPLOYEE; a aba de estrutura não existe pra ele", async () => {
    const app = appAs(user(IDS.op1, "OPERATOR"))
    const context = await request(app).get("/analytics/context")
    expect(context.body.data.capabilities).toMatchObject({ mode: "EMPLOYEE", canSeePrv: true, tabs: ["FOLLOW_UP", "INDICATORS", "STRUCTURE"] })
    const own = await request(app).get("/analytics/indicators?period=2026-09")
    expect(own.status).toBe(200)
    expect(own.body.data.prv.achievementPercent).toBe(105)
    expect((await request(app).get(`/analytics/indicators?subjectKind=EMPLOYEE&subjectId=${IDS.op2}`)).status).toBe(403)
    expect((await request(app).get("/analytics/team")).status).toBe(400) // sujeito EMPLOYEE não tem visão de estrutura
  })

  it("Administrador geral do setup (fora da hierarquia, indicators.view na organização): sem sujeito padrão, mas a ficha do colaborador devolve o fechamento oficial", async () => {
    const org = fixtureOrg()
    org.people.push(person({ id: "admin-setup", name: "Administração da INIA", role: "ADMIN" }))
    org.access = { acc: { "indicators.view": { organizationWide: true } } }
    const app = appAs(user("admin-setup", "ADMIN"), org)
    expect((await request(app).get("/analytics/context")).body.data.defaultSubject).toBeNull()
    const visited = await request(app).get(`/analytics/indicators?subjectKind=EMPLOYEE&subjectId=${IDS.op1}&period=2026-09`)
    expect(visited.status).toBe(200)
    expect(visited.body.data).toMatchObject({ mode: "EMPLOYEE", subject: { subject: { kind: "EMPLOYEE", employeeId: IDS.op1 } } })
    expect(visited.body.data.prv.achievementPercent).toBe(105)
    // Sem sujeito na query não há o que mostrar — por isso a tela só consulta com sujeito explícito ou padrão.
    const own = await request(app).get("/analytics/indicators?period=2026-09")
    expect(own.status).toBe(404)
    expect(own.body.error.code).toBe("NO_STRUCTURE")
  })

  it("viewer sem sujeito padrão: as competências do contexto vêm do escopo de acesso dele; quem tem estrutura continua com as da própria estrutura", async () => {
    const periodsOf = (body: { data: { availablePeriods: { period: string }[] } }) => body.data.availablePeriods.map((entry) => entry.period)
    const orgWide = fixtureOrg()
    orgWide.people.push(person({ id: "admin-setup", name: "Administração da INIA", role: "ADMIN" }))
    orgWide.access = { acc: { "indicators.view": { organizationWide: true } } }
    // Organização inteira: julho só existe para Ana (equipe da Vanessa) e precisa aparecer na ficha de qualquer pessoa.
    const admin = await request(appAs(user("admin-setup", "ADMIN"), orgWide)).get("/analytics/context")
    expect(admin.body.data.defaultSubject).toBeNull()
    expect(periodsOf(admin.body)).toEqual(["2026-09", "2026-08", "2026-07"])
    expect(admin.body.data.currentPeriod).toBe("2026-09")

    // Recorte do acesso: só o Grupo FATURAS (Caio tem agosto e setembro) — julho da Ana fica de fora.
    const teamScoped = fixtureOrg()
    teamScoped.people.push(person({ id: "admin-faturas", name: "Administração de Faturas", role: "ADMIN" }))
    teamScoped.access = { acc: { "indicators.view": { teamIds: [IDS.teamB] } } }
    expect(periodsOf((await request(appAs(user("admin-faturas", "ADMIN"), teamScoped)).get("/analytics/context")).body)).toEqual(["2026-09", "2026-08"])

    // Sem acesso nenhum, nada muda: só o último mês fechado.
    const noAccess = fixtureOrg()
    noAccess.people.push(person({ id: "admin-sem-acesso", name: "Sem acesso", role: "ADMIN" }))
    expect(periodsOf((await request(appAs(user("admin-sem-acesso", "ADMIN"), noAccess)).get("/analytics/context")).body)).toEqual(["2026-09"])

    // Supervisor (tem sujeito padrão): as competências da própria equipe, como antes — nunca as da organização.
    expect(periodsOf((await request(appAs(user(IDS.bruno, "SUPERVISOR"))).get("/analytics/context")).body)).toEqual(["2026-09", "2026-08"])
  })

  it("erros de entrada são claros: competência inválida, agrupamento inválido, tipo de sujeito desconhecido", async () => {
    const app = appAs(user(IDS.director, "DIRECTOR"))
    const period = await request(app).get("/analytics/indicators?period=2026-99")
    expect(period.status).toBe(400)
    expect(period.body.error.code).toBe("INVALID_PERIOD")
    const grouping = await request(app).get("/analytics/indicators/breakdown?groupBy=BANANA")
    expect(grouping.body.error.code).toBe("INVALID_GROUPING")
    expect((await request(app).get(`/analytics/indicators?subjectKind=BANANA&subjectId=${IDS.op1}`)).status).toBe(400)
    const comparison = await request(app).get("/analytics/indicators?period=2026-09&comparison=BANANA")
    expect(comparison.status).toBe(400)
    expect(comparison.body.error.code).toBe("INVALID_COMPARISON")
  })

  it("comparação operacional configurável: `comparison` aceita as opções do catálogo (semana, mês, bimestre, trimestre) tanto no colaborador quanto na estrutura", async () => {
    const app = appAs(user(IDS.director, "DIRECTOR"))
    for (const comparison of ["ROLLING_7_DAYS", "WEEK", "MONTH", "TWO_MONTHS", "QUARTER"]) {
      expect((await request(app).get(`/analytics/indicators?period=2026-09&comparison=${comparison}`)).status).toBe(200)
      expect((await request(app).get(`/analytics/indicators?subjectKind=EMPLOYEE&subjectId=${IDS.op1}&period=2026-09&comparison=${comparison}`)).status).toBe(200)
    }
  })

  it("Diretor: contexto com agrupamentos, dashboard consolidado, breakdown e drill-down até o operador", async () => {
    const app = appAs(user(IDS.director, "DIRECTOR"))
    const context = await request(app).get("/analytics/context")
    expect(context.body.data.capabilities.groupingOptions).toEqual(["SENIOR_MANAGER", "MANAGER", "COORDINATOR", "SUPERVISOR", "TEAM", "SUBTEAM"])
    expect(context.body.data.currentPeriod).toBe("2026-09")
    const dashboard = await request(app).get("/analytics/indicators?period=2026-09")
    expect(dashboard.body.data.mode).toBe("STRUCTURE")
    expect(dashboard.body.data).not.toHaveProperty("prv")
    const breakdown = await request(app).get("/analytics/indicators/breakdown?period=2026-09&groupBy=SUPERVISOR")
    expect(breakdown.body.data.groups.map((group: { label: string }) => group.label)).toEqual(["Bruno Supervisor", "Vanessa Supervisora"])
    const employee = await request(app).get(`/analytics/indicators?subjectKind=EMPLOYEE&subjectId=${IDS.op1}&period=2026-09`)
    expect(employee.body.data.mode).toBe("EMPLOYEE")
    expect(employee.body.data.breadcrumb).toHaveLength(6)
  })
})

describe("GET /analytics/follow-ups — feed da estrutura por cursor", () => {
  const item = (id: string, createdAt: string, overrides: Partial<FollowUpItem> = {}): FollowUpItem => ({
    id, kind: "FEEDBACK", category: "MONITORING", title: id, summary: "", detail: null, severity: null, operator: { personId: IDS.op1, name: "Ana Operadora" },
    caseId: null, createdAt, acknowledgedAt: null, feedback: null, ...overrides,
  })
  const feed = [
    item("00000000-0000-4000-8000-0000000000a1", "2026-09-20T10:00:00.000Z"),
    item("00000000-0000-4000-8000-0000000000a3", "2026-09-20T10:00:00.000Z", { operator: { personId: IDS.op2, name: "Bia Operadora" } }),
    item("00000000-0000-4000-8000-0000000000a2", "2026-09-20T10:00:00.000Z"),
    item("00000000-0000-4000-8000-0000000000a4", "2026-09-25T09:00:00.000Z", { kind: "ALERT", category: "WORKFLOW_OUTPUT" }),
    item("00000000-0000-4000-8000-0000000000a5", "2026-09-18T09:00:00.000Z", { acknowledgedAt: "2026-09-18T10:00:00.000Z" }),
  ]

  it("páginas pelo cursor somam o feed em ordem, sem repetir nem pular (empate no instante desempata por id), e a última vem sem cursor", async () => {
    const app = appAs(user(IDS.director, "DIRECTOR"), { ...fixtureOrg(), feed })
    const collected: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 5; page++) {
      const response: request.Response = await request(app).get(`/analytics/follow-ups?limit=2${cursor ? `&cursor=${cursor}` : ""}`)
      expect(response.status).toBe(200)
      expect(Object.keys(response.body.data).sort()).toEqual(["items", "nextCursor"])
      collected.push(...response.body.data.items.map((entry: FollowUpItem) => entry.id))
      cursor = response.body.data.nextCursor
      if (!cursor) break
    }
    expect(collected).toEqual(["a4", "a3", "a2", "a1", "a5"].map((suffix) => `00000000-0000-4000-8000-0000000000${suffix}`))
    expect(cursor).toBeNull()
  })

  it("\"aguardando ciência\" tira avisos e confirmados; cursor adulterado → 400 INVALID_CURSOR", async () => {
    const app = appAs(user(IDS.director, "DIRECTOR"), { ...fixtureOrg(), feed })
    const pending = await request(app).get("/analytics/follow-ups?ack=pending&limit=10")
    expect(pending.body.data.items.map((entry: FollowUpItem) => entry.id.slice(-2))).toEqual(["a3", "a2", "a1"])
    expect(pending.body.data.nextCursor).toBeNull()
    const invalid = await request(app).get("/analytics/follow-ups?cursor=bm9wZQ")
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe("INVALID_CURSOR")
  })
})

describe("GET /analytics — foto das pessoas pela apresentação", () => {
  /** Imagens do cadastro do cliente (as que o grafo em cache traz) e fotos escolhidas no perfil (`person_profile_preferences`). */
  const REGISTERED: Record<string, string> = { [IDS.managerA]: "https://cdn.cliente/roberto.jpg", [IDS.managerB]: "https://cdn.cliente/roberta.jpg", [IDS.op1]: "https://cdn.cliente/ana.jpg", [IDS.op2]: "https://cdn.cliente/bia.jpg" }
  const PROFILE: Record<string, string> = { [IDS.managerA]: "/api/v1/profile-images/foto-roberto", [IDS.op1]: "/api/v1/profile-images/foto-ana" }

  function setup(viewer: AuthTokenPayload) {
    const org = fixtureOrg()
    org.people = org.people.map((node) => ({ ...node, avatarUrl: REGISTERED[node.id] ?? null }))
    const calls: string[][] = []
    // Como a apresentação real: personalizada > corporativa > nenhuma.
    const loader: PersonAvatarLoader = async (organizationId, ids) => {
      expect(organizationId).toBe(ORG)
      calls.push(ids)
      return new Map(ids.map((id) => [id, PROFILE[id] ?? REGISTERED[id] ?? null]))
    }
    return { app: appAs(viewer, org, loader), calls }
  }
  const avatars = (people: { personId: string; avatarUrl: string | null }[]) => Object.fromEntries(people.map((person) => [person.personId, person.avatarUrl]))

  it("Equipe/Estrutura: o líder de cada unidade vem com a foto do perfil (senão a do cadastro), numa leitura em lote por request", async () => {
    const { app, calls } = setup(user(IDS.senior, "SENIOR_MANAGER"))
    const response = await request(app).get("/analytics/team?period=2026-09")
    expect(response.status).toBe(200)
    const leaders = response.body.data.units.map((unit: { leader: { personId: string; avatarUrl: string | null } }) => unit.leader)
    expect(avatars(leaders)).toEqual({ [IDS.managerA]: "/api/v1/profile-images/foto-roberto", [IDS.managerB]: "https://cdn.cliente/roberta.jpg" })
    expect(calls).toEqual([leaders.map((leader: { personId: string }) => leader.personId)])

    // Equipe de operadores (sem unidades): nenhuma leitura de foto — os membros vêm pela rota paginada.
    const supervisor = setup(user(IDS.vanessa, "SUPERVISOR"))
    expect((await request(supervisor.app).get("/analytics/team?period=2026-09")).body.data.units).toEqual([])
    expect(supervisor.calls).toEqual([])
  })

  it("membros da equipe: foto do perfil vence a do cadastro e só as pessoas da PÁGINA são lidas, uma vez", async () => {
    const { app, calls } = setup(user(IDS.vanessa, "SUPERVISOR"))
    const all = await request(app).get("/analytics/team/members?period=2026-09&sort=name")
    expect(avatars(all.body.data.items)).toEqual({ [IDS.op1]: "/api/v1/profile-images/foto-ana", [IDS.op2]: "https://cdn.cliente/bia.jpg" })
    expect(calls).toEqual([[IDS.op1, IDS.op2]])

    const firstPage = await request(app).get("/analytics/team/members?period=2026-09&sort=name&pageSize=1")
    expect(firstPage.body.data.total).toBe(2)
    expect(calls.at(-1)).toEqual([firstPage.body.data.items[0].personId])
  })

  it("membros de um indicador: foto do perfil vence a do cadastro, uma leitura em lote por request", async () => {
    const { app, calls } = setup(user(IDS.vanessa, "SUPERVISOR"))
    const response = await request(app).get("/analytics/indicators/NOTA_URA/members?period=2026-09")
    expect(response.status).toBe(200)
    expect(avatars(response.body.data.items)).toEqual({ [IDS.op1]: "/api/v1/profile-images/foto-ana", [IDS.op2]: "https://cdn.cliente/bia.jpg" })
    expect(calls).toHaveLength(1)
    expect([...calls[0]!].sort()).toEqual([IDS.op1, IDS.op2])
  })
})
