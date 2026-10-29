import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { InMemoryAnalyticsRepository, ORG, person } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import { loadDiagnosticsAccess } from "../application/diagnostics-access-loader.js"
import { canViewDiagnostics } from "../domain/diagnostics-access.js"
import { createDiagnosticsRouter } from "./diagnostics-router.js"

const SUP = "00000000-0000-4000-8000-0000000000a1"
const OP_A = "00000000-0000-4000-8000-0000000000b1"
const OP_B = "00000000-0000-4000-8000-0000000000b2"
const OP_OTHER = "00000000-0000-4000-8000-0000000000c1"
const OP_INACTIVE = "00000000-0000-4000-8000-0000000000b3"
const ANALYST = "00000000-0000-4000-8000-0000000000d1"

const people = [
  person({ id: SUP, name: "Supervisora", role: "SUPERVISOR", teamId: "team-a" }),
  person({ id: OP_A, name: "Op A", role: "OPERATOR", reportsToId: SUP, teamId: "team-a" }),
  person({ id: OP_B, name: "Op B", role: "OPERATOR", reportsToId: SUP, teamId: "team-a" }),
  person({ id: OP_INACTIVE, name: "Op Inativo", role: "OPERATOR", reportsToId: SUP, teamId: "team-a", active: false }),
  person({ id: OP_OTHER, name: "Op Outra Equipe", role: "OPERATOR", teamId: "team-b" }),
  // Fora da hierarquia, com `indicators.view` só no Grupo B (papel de acesso, nunca cargo).
  person({ id: ANALYST, name: "Analista", role: "ADMIN" }),
]

const user = (personId: string, role: AuthTokenPayload["role"], sub = `acc-${personId}`): AuthTokenPayload => ({ sub, personId, organizationId: ORG, role, name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null })

function appAs(sessionUser: AuthTokenPayload) {
  const queries: { sql: string; params: unknown[] }[] = []
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params })
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Database
  const repository = new InMemoryAnalyticsRepository({ people, access: { [`acc-${ANALYST}`]: { "indicators.view": { teamIds: ["team-b"] } } } })
  const app = express()
  app.use((req, _res, next) => {
    req.user = sessionUser
    next()
  })
  app.use("/diagnostics", createDiagnosticsRouter(db, { repository }))
  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    void next
    if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code } })
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: (error as Error).message } })
  }
  app.use(errorHandler)
  return { app, queries }
}

describe("Diagnóstico — acesso por liderança ou indicators.view, recorte pelo escopo", () => {
  it("operador sem liderança nem permissão → 403 nas duas rotas, sem consultar escalonamentos", async () => {
    const { app, queries } = appAs(user(OP_A, "OPERATOR"))
    for (const path of ["/diagnostics", "/diagnostics/performance"]) {
      const response = await request(app).get(path)
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe("DIAGNOSTICS_ACCESS_DENIED")
    }
    expect(queries).toHaveLength(0)
  })

  it("quem lidera vê SÓ os escalonamentos dos operadores ativos da própria subárvore", async () => {
    const { app, queries } = appAs(user(SUP, "SUPERVISOR"))
    expect((await request(app).get("/diagnostics/performance")).status).toBe(200)
    const [query] = queries
    expect(query!.params[0]).toBe(ORG) // organização da sessão
    expect((query!.params[1] as string[]).sort()).toEqual([OP_A, OP_B].sort())
    expect(query!.sql).toContain("pe.operator_id = any($2::uuid[])")
  })

  it("indicators.view no Grupo B abre a área e recorta para o Grupo B — nunca a organização inteira", async () => {
    const { app, queries } = appAs(user(ANALYST, "ADMIN"))
    expect((await request(app).get("/diagnostics/performance")).status).toBe(200)
    expect(queries[0]!.params[1]).toEqual([OP_OTHER])
    expect((await request(app).get("/diagnostics")).status).toBe(200)
    expect(queries[1]!.params[0]).toBe(ORG)
  })

  it("o nível legado 'ADMIN' sozinho não abre nada (mesma pessoa, conta sem papel)", async () => {
    const { app, queries } = appAs(user(ANALYST, "ADMIN", "acc-sem-papel"))
    expect((await request(app).get("/diagnostics/performance")).status).toBe(403)
    expect(queries).toHaveLength(0)
  })
})

describe("Diagnóstico — projeção para a interface (/auth/me)", () => {
  it("mesma regra: liderança OU indicators.view", async () => {
    expect(canViewDiagnostics({ leadsActiveReports: false, hasIndicatorsGrant: false })).toBe(false)
    expect(canViewDiagnostics({ leadsActiveReports: true, hasIndicatorsGrant: false })).toBe(true)
    expect(canViewDiagnostics({ leadsActiveReports: false, hasIndicatorsGrant: true })).toBe(true)
    const db = (leads: boolean) => ({ query: async () => ({ rows: [{ leads }], rowCount: 1 }) }) as unknown as Database
    expect(await loadDiagnosticsAccess(db(false), { organizationId: ORG, personId: OP_A, canViewIndicators: false })).toBe(false)
    expect(await loadDiagnosticsAccess(db(true), { organizationId: ORG, personId: SUP, canViewIndicators: false })).toBe(true)
    expect(await loadDiagnosticsAccess(db(false), { organizationId: ORG, personId: ANALYST, canViewIndicators: true })).toBe(true)
  })
})

describe("Diagnóstico — memória do motor de feedback (agregados, drill-down e exportação no escopo)", () => {
  const ZERO_STATS = { calls: 0, assessed: 0, met: 0, not_met: 0, partial: 0, inconclusive: 0, not_applicable: 0, criteria: 0, people: 0, last_analysis: null, total: 0, usable: 0, insufficient: 0, path_incorrect: 0, path_assessed: 0 }
  function memoryApp(sessionUser: AuthTokenPayload) {
    const queries: { sql: string; params: unknown[] }[] = []
    const db = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params })
        // Agregados sem grupo devolvem uma linha de contagens zeradas; o resto, nada (sem dados no escopo).
        // (a memória é lida pelo status EFETIVO — conclusão confirmada, revisão concluída — numa subconsulta sobre call_criterion_assessments)
        const aggregateRow = /from call_criterion_assessments c where|call_criterion_assessments c0[\s\S]*?\) c where|from call_assessments a\s+where/.test(sql) && !/group by/.test(sql)
        return { rows: aggregateRow ? [ZERO_STATS] : [], rowCount: aggregateRow ? 1 : 0 }
      },
    } as unknown as Database
    const repository = new InMemoryAnalyticsRepository({ people, access: { [`acc-${ANALYST}`]: { "indicators.view": { teamIds: ["team-b"] } } } })
    const app = express()
    app.use((req, _res, next) => {
      req.user = sessionUser
      next()
    })
    app.use("/diagnostics", createDiagnosticsRouter(db, { repository }))
    const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
      void next
      if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code } })
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: (error as Error).message } })
    }
    app.use(errorHandler)
    return { app, queries }
  }
  const peopleParam = (queries: { params: unknown[] }[]) => (queries[0]!.params[1] as string[]).slice().sort()

  it("sem liderança nem indicators.view: 403 em agregados, detalhe e CSV — nenhuma consulta", async () => {
    const { app, queries } = memoryApp(user(OP_A, "OPERATOR"))
    for (const path of ["/diagnostics/memory/summary", "/diagnostics/memory/processes", `/diagnostics/memory/assessments/${OP_B}`, "/diagnostics/memory/export.csv"]) {
      expect((await request(app).get(path)).status).toBe(403)
    }
    expect(queries).toHaveLength(0)
  })

  it("quem lidera: toda consulta da memória leva a organização da sessão e SÓ as pessoas da própria subárvore", async () => {
    const { app, queries } = memoryApp(user(SUP, "SUPERVISOR"))
    const response = await request(app).get("/diagnostics/memory/summary?from=2026-09-01&to=2026-09-30&personId=" + OP_OTHER)
    expect(response.status).toBe(200)
    expect(response.body.data.method).toMatch(/Denominador = avaliadas/)
    for (const query of queries) {
      expect(query.params[0]).toBe(ORG)
      expect(query.params[1]).not.toContain(OP_OTHER)
    }
    expect(peopleParam(queries)).toEqual(expect.arrayContaining([OP_A, OP_B]))
    // Pedir alguém de fora do escopo pelo filtro não amplia nada: o conjunto visível continua sendo a condição.
    expect(queries[0]!.params[6]).toBe(OP_OTHER)
  })

  it("indicators.view no Grupo B: a memória recorta para o Grupo B", async () => {
    const { app, queries } = memoryApp(user(ANALYST, "ADMIN"))
    expect((await request(app).get("/diagnostics/memory/processes")).status).toBe(200)
    expect(queries[0]!.params[1]).toContain(OP_OTHER)
    expect(queries[0]!.params[1]).not.toContain(OP_A)
  })

  it("detalhe fora do escopo, de outra organização ou id inválido: 404 sem distinguir", async () => {
    const { app, queries } = memoryApp(user(SUP, "SUPERVISOR"))
    const missing = await request(app).get("/diagnostics/memory/assessments/11111111-1111-4111-8111-111111111111")
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe("DIAGNOSTIC_NOT_FOUND")
    expect(queries[0]!.params.slice(0, 2)).toEqual(["11111111-1111-4111-8111-111111111111", ORG])
    const before = queries.length
    expect((await request(app).get("/diagnostics/memory/indicators/nao-e-uuid")).status).toBe(404)
    expect(queries).toHaveLength(before)
  })

  it("CSV: período, filtros e método no cabeçalho; mesmo recorte de pessoas", async () => {
    const { app, queries } = memoryApp(user(SUP, "SUPERVISOR"))
    const response = await request(app).get("/diagnostics/memory/export.csv?view=people&groupBy=TEAM&from=2026-09-01&to=2026-09-30")
    expect(response.status).toBe(200)
    expect(response.headers["content-type"]).toMatch(/text\/csv/)
    expect(response.headers["content-disposition"]).toContain("diagnostico-people-2026-09-01-a-2026-09-30.csv")
    expect(response.text).toContain("# Período: 2026-09-01 a 2026-09-30")
    expect(response.text).toContain("Denominador = avaliadas")
    expect(response.text).toContain("Grupo/Pessoa;Chamadas;Avaliadas")
    expect(queries[0]!.params[1]).not.toContain(OP_OTHER)
  })

  it("CSV: filtro livre da URL com ';' e '=' nunca vira célula que a planilha leia como fórmula (C12, 4ª auditoria)", async () => {
    const { app } = memoryApp(user(SUP, "SUPERVISOR"))
    const response = await request(app).get(`/diagnostics/memory/export.csv?view=people&groupBy=TEAM&from=2026-09-01&to=2026-09-30&subject=${encodeURIComponent('x;=HYPERLINK("http://a.b";"c");y')}&status=${encodeURIComponent("+1")}&practiceKey=${encodeURIComponent("@SOMA(1)")}`)
    expect(response.status).toBe(200)
    // Separa as células como a planilha (";" fora de aspas) e confere que nenhuma começa com = + - @ TAB CR sem estar entre aspas.
    const cells = response.text.split(/\r\n/).flatMap((line) => line.match(/("([^"]|"")*"|[^;]*)(;|$)/g) ?? []).map((cell) => cell.replace(/;$/, ""))
    expect(cells.filter((cell) => /^[=+\-@\t\r]/.test(cell))).toEqual([])
    expect(response.text).toContain('"# Filtros:')
  })
})
