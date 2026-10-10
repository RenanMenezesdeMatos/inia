import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { fixtureOrg, IDS } from "../testing/fixture-org.js"
import { InMemoryAnalyticsRepository, ORG } from "../testing/in-memory-analytics-repository.js"
import { createAnalyticsRouter } from "./analytics-router.js"

const noDatabase = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database

/** App mínimo com o mesmo error handler de app.ts e uma sessão injetada por header — testa o
 * router (parsing, escopo, mapeamento de erro) sem depender de JWT/cookie nem de Postgres. */
function appAs(user: AuthTokenPayload | null) {
  const app = express()
  app.use((requestObject, _response, next) => {
    if (user) requestObject.user = user
    next()
  })
  app.use("/analytics", (requestObject, response, next) => (requestObject.user ? next() : response.status(401).json({ error: { code: "UNAUTHENTICATED" } })), // Relógio em outubro: a fixture fecha em 2026-09 e o guard central do fechamento oficial só
  // enxerga competências <= último mês fechado (em 15/09, setembro NÃO seria fechamento).
  createAnalyticsRouter(noDatabase, new InMemoryAnalyticsRepository(fixtureOrg()), () => new Date("2026-10-05T12:00:00Z")))
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
