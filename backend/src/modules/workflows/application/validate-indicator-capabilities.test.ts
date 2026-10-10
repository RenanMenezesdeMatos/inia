import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { FlowGraph } from "../domain/graph-schema.js"
import { collectIndicatorUses, isOperationalWindow, validateIndicatorCapabilities } from "./validate-indicator-capabilities.js"

const ORG = "org"

type Catalog = Record<string, { active?: boolean; daily?: boolean; official?: boolean }>

function catalogDb(catalog: Catalog): Database {
  return {
    query: vi.fn(async (_sql: string, params: unknown[]) => {
      const codes = params[1] as string[]
      const rows = codes.flatMap((code) => (catalog[code] ? [{ code, name: `Indicador ${code}`, active: catalog[code]!.active ?? true, daily_supported: catalog[code]!.daily ?? true, official_closure_supported: catalog[code]!.official ?? true }] : []))
      return { rows, rowCount: rows.length }
    }),
  } as unknown as Database
}

function graph(nodes: unknown[]): FlowGraph {
  return { nodes: nodes as FlowGraph["nodes"], edges: [] }
}

const condition = (historicalQuery: Record<string, unknown>) => ({ id: "c1", type: "condition", label: "Cond", position: { x: 0, y: 0 }, config: { comparator: "LT", thresholdNumeric: 1, historicalQuery } })
const ranking = (ranking: Record<string, unknown>) => ({ id: "s1", type: "select_employees", label: "Sel", position: { x: 0, y: 0 }, config: { selectionMode: "RANKING", ranking } })

describe("publish × capacidades do indicador (catálogo, nunca lista)", () => {
  it("isOperationalWindow: dias/semana são operacionais; mês+/fechamentos não", () => {
    expect(isOperationalWindow({ kind: "ROLLING_DAYS", days: 7 })).toBe(true)
    expect(isOperationalWindow({ kind: "CALENDAR", unit: "WEEK" })).toBe(true)
    expect(isOperationalWindow({ kind: "CALENDAR", unit: "MONTH" })).toBe(false)
    expect(isOperationalWindow({ kind: "CLOSURES", unit: "MONTH", count: 3 })).toBe(false)
    expect(isOperationalWindow(undefined)).toBe(false)
  })

  it("coleta toda referência a indicador do grafo e do gatilho — qualquer código, sem enum", () => {
    const uses = collectIndicatorUses(
      graph([
        condition({ kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "QUALQUER_CODIGO", aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 7 } }),
        ranking({ indicatorCode: "OUTRO", aggregation: "LATEST", period: { kind: "CALENDAR", unit: "MONTH" }, selection: "OPERATIONAL_QUARTILE", operationalQuartile: "Q4", count: 1 }),
        { id: "a1", type: "action", label: "Agente", position: { x: 0, y: 0 }, config: { actionType: "CALL_AGENT", agentId: "11111111-1111-4111-8111-111111111111", scheduledDataSource: { kind: "INDICATOR", indicatorCode: "TERCEIRO", period: "D1" } } },
      ]),
      { kind: "indicator", indicatorCode: "GATILHO" },
    )
    expect(uses.map((use) => [use.code, use.needsOperational, use.needsOfficial])).toEqual([
      ["QUALQUER_CODIGO", true, false],
      ["OUTRO", true, false],
      ["TERCEIRO", false, false],
      ["GATILHO", false, false],
    ])
  })

  it("indicador ativo e operacional com janela de 7 dias publica; desativado não entra em Workflow novo", async () => {
    const g = graph([condition({ kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "X", aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 7 } })])
    await expect(validateIndicatorCapabilities(catalogDb({ X: {} }), ORG, g, null)).resolves.toBeUndefined()
    await expect(validateIndicatorCapabilities(catalogDb({ X: { active: false } }), ORG, g, null)).rejects.toMatchObject({ code: "WORKFLOW_INDICATOR_INACTIVE", details: { nodeId: "c1" } })
    await expect(validateIndicatorCapabilities(catalogDb({}), ORG, g, null)).rejects.toMatchObject({ code: "INDICATOR_NOT_FOUND" })
  })

  it("indicador SEM medição operacional: janela de dias/semana e quartil operacional são rejeitados; mês civil e fechamentos passam", async () => {
    const db = catalogDb({ X: { daily: false } })
    await expect(validateIndicatorCapabilities(db, ORG, graph([condition({ kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "X", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 7 } })]), null)).rejects.toMatchObject({ code: "WORKFLOW_INDICATOR_NOT_OPERATIONAL" })
    await expect(validateIndicatorCapabilities(db, ORG, graph([ranking({ indicatorCode: "X", aggregation: "AVERAGE", period: { kind: "CALENDAR", unit: "MONTH" }, selection: "OPERATIONAL_QUARTILE", operationalQuartile: "Q4", count: 1 })]), null)).rejects.toMatchObject({ code: "WORKFLOW_INDICATOR_NOT_OPERATIONAL" })
    await expect(validateIndicatorCapabilities(db, ORG, graph([condition({ kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "X", aggregation: "AVERAGE", period: { kind: "CALENDAR", unit: "MONTH" } })]), null)).resolves.toBeUndefined()
    await expect(validateIndicatorCapabilities(db, ORG, graph([condition({ kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "X", aggregation: "AVERAGE", source: "INDICATOR_ACHIEVEMENT", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } })]), null)).resolves.toBeUndefined()
  })

  it("indicador SEM fechamento oficial: Atingimento/Quartil do indicador são rejeitados; Valor do indicador passa", async () => {
    const db = catalogDb({ X: { official: false } })
    await expect(validateIndicatorCapabilities(db, ORG, graph([condition({ kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "X", aggregation: "AVERAGE", source: "INDICATOR_ACHIEVEMENT", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } })]), null)).rejects.toMatchObject({ code: "WORKFLOW_INDICATOR_NO_OFFICIAL_CLOSURE" })
    await expect(validateIndicatorCapabilities(db, ORG, graph([{ id: "c2", type: "condition", label: "Q", position: { x: 0, y: 0 }, config: { comparator: "EQUALS", thresholdText: "Q4", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "X" } } }]), null)).rejects.toMatchObject({ code: "WORKFLOW_INDICATOR_NO_OFFICIAL_CLOSURE" })
    await expect(validateIndicatorCapabilities(db, ORG, graph([condition({ kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "X", aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 7 } })]), null)).resolves.toBeUndefined()
  })

  it("grafo sem indicador nunca consulta o catálogo", async () => {
    const db = catalogDb({})
    await validateIndicatorCapabilities(db, ORG, graph([]), { kind: "channel_flag", channelFlagId: "11111111-1111-4111-8111-111111111111" })
    expect(db.query).not.toHaveBeenCalled()
  })
})
