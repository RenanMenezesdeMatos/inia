import express from "express"
import request from "supertest"
import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * V1.5.13 — rota da aba "Resultados": organização da SESSÃO, Workflow fora do escopo = 404 sem distinguir, período local
 * padrão de 30 dias (hoje incluso), filtros repassados ao read model. O read model em si é provado contra o banco em
 * workflow-results-proof.
 */
const reader = vi.hoisted(() => ({ summary: vi.fn(), page: vi.fn(), detail: vi.fn() }))
vi.mock("../application/workflow-results-reader.js", () => ({ loadResultsSummary: reader.summary, loadResultsPage: reader.page, loadDispatchDetail: reader.detail }))
const scopes = vi.hoisted(() => ({ value: { unrestricted: false, allTeams: false, teamIds: new Set(["team-a"]), subteamIds: new Set() } as unknown }))
vi.mock("../../auth/application/manageable-scopes.js", async (importOriginal) => ({ ...(await importOriginal<object>()), getManageableScopes: async () => scopes.value }))

const { createWorkflowResultsRouter, resolveResultsPeriod } = await import("./workflow-results-router.js")

const WF_IN = "11111111-1111-4111-8111-111111111111"
const WF_OUT = "22222222-2222-4222-8222-222222222222"
const ROOT = "33333333-3333-4333-8333-333333333333"
const ORG = "44444444-4444-4444-8444-444444444444"

function app() {
  const queries: { sql: string; params: unknown[] }[] = []
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params })
      if (sql.includes("from workflows where id = $1 and organization_id = $2")) {
        if (params[0] === WF_IN && params[1] === ORG) return { rows: [{ scopeType: "TEAM", teamId: "team-a", subteamId: null }] }
        if (params[0] === WF_OUT && params[1] === ORG) return { rows: [{ scopeType: "TEAM", teamId: "team-b", subteamId: null }] }
        return { rows: [] }
      }
      if (sql.includes("from operations")) return { rows: [{ timezone: "America/Sao_Paulo" }] }
      return { rows: [] }
    }),
  } as unknown as Database
  const server = express()
  server.use((req, _res, next) => {
    ;(req as unknown as { user: unknown }).user = { organizationId: ORG, sub: "acc-1", personId: "p-1" }
    next()
  })
  server.use(createWorkflowResultsRouter(db))
  return { server, queries }
}

describe("V1.5.13 — rota de Resultados do Workflow", () => {
  it("período padrão = últimos 30 dias locais (hoje incluso), fim exclusivo no dia seguinte", () => {
    const period = resolveResultsPeriod("America/Sao_Paulo", new Date("2026-09-24T15:00:00Z"))
    expect(period).toMatchObject({ from: "2026-08-26", to: "2026-09-24" })
    expect(period.fromInstant.toISOString()).toBe("2026-08-26T03:00:00.000Z")
    expect(period.toInstant.toISOString()).toBe("2026-09-25T03:00:00.000Z")
    expect(resolveResultsPeriod("UTC", new Date(), "2026-09-10", "2026-09-01")).toMatchObject({ from: "2026-09-01", to: "2026-09-10" })
  })

  it("Workflow no escopo: repassa organização da sessão, escopo e filtros ao read model", async () => {
    reader.page.mockResolvedValueOnce({ items: [], total: 0, page: 2, pageSize: 10 })
    const response = await request(app().server).get(`/${WF_IN}/results?page=2&pageSize=10&status=COMPLETED,RUNNING&triggerKind=FLAG&collaborator=ana&from=2026-09-01&to=2026-09-10`)
    expect(response.status).toBe(200)
    const [, organizationId, workflowId, , filters, page, pageSize] = reader.page.mock.calls[0]!
    expect([organizationId, workflowId, page, pageSize]).toEqual([ORG, WF_IN, 2, 10])
    expect(filters).toMatchObject({ statuses: ["COMPLETED", "RUNNING"], triggerKinds: ["FLAG"], collaborator: "ana" })
    expect((filters as { from: Date }).from.toISOString()).toBe("2026-09-01T03:00:00.000Z")
  })

  it("J) Workflow fora do escopo de gestão, de outra organização ou id inválido = 404 sem distinguir; o read model nem roda", async () => {
    reader.summary.mockClear()
    reader.detail.mockClear()
    const { server } = app()
    for (const path of [`/${WF_OUT}/results/summary`, `/55555555-5555-4555-8555-555555555555/results/summary`, `/nao-uuid/results/summary`, `/${WF_OUT}/results/${ROOT}`]) {
      const response = await request(server).get(path)
      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe("WORKFLOW_NOT_FOUND")
    }
    expect(reader.summary).not.toHaveBeenCalled()
    expect(reader.detail).not.toHaveBeenCalled()
  })

  it("disparo inexistente (ou de outro Workflow) = 404 do disparo", async () => {
    reader.detail.mockResolvedValueOnce(null)
    const response = await request(app().server).get(`/${WF_IN}/results/${ROOT}`)
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe("WORKFLOW_DISPATCH_NOT_FOUND")
  })
})
