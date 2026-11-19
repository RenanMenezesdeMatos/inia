import { describe, expect, it } from "vitest"
import type { PendingActionsSummary } from "../../pending-actions/domain/view-models.js"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { InMemoryAnalyticsRepository } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import { CLOSURE, L, leaderUser, leadershipOrg } from "../testing/leadership-fixture.js"
import type { QueryTableCard } from "../domain/view-models.js"
import { calculate, parseCalculations, parseNumber } from "./arithmetic.js"
import { executeLeadershipTool, LEADERSHIP_TOOL_DECLARATIONS, type LeadershipToolDependencies } from "./leadership-toolset.js"

const NO_PENDING: PendingActionsSummary = { pending: [], history: [], pendingCount: 0 }

async function managerDeps(): Promise<LeadershipToolDependencies> {
  const repository = new InMemoryAnalyticsRepository(leadershipOrg())
  return { repository, scope: await loadViewerScope(repository, leaderUser(L.gabriel, "MANAGER")), closure: CLOSURE, loadPendingActions: async () => NO_PENDING }
}

describe("span de controle (leadership_span)", () => {
  it("por líder: lista nominal de todos os supervisores e o total calculado no texto (sem conta do modelo)", async () => {
    const result = await executeLeadershipTool(await managerDeps(), "leadership_span", {})
    const card = result.card as QueryTableCard
    expect(card.rows.length).toBeGreaterThan(0)
    expect(card.rows.length).toBe(card.totalRows)
    const operators = card.rows.reduce((total, row) => total + Number(row.cells.operators), 0)
    expect(result.text).toContain(`${card.rows.length} supervisores, ${operators} operadores ativos`)
    expect(result.text).toMatch(/span médio = [\d,]+ operadores por supervisor/)
    expect(card.rows.find((row) => row.cells.leader === "Sara Silva")?.cells.operators).toBe("5")
  })

  it("por Grupo: líderes, operadores e média de cada Grupo", async () => {
    const card = (await executeLeadershipTool(await managerDeps(), "leadership_span", { por: "GRUPO" })).card as QueryTableCard
    expect(card.columns.map((column) => column.label)).toEqual(["Grupo", "Supervisores", "Operadores", "Média por supervisor", "Mínimo", "Máximo"])
    for (const row of card.rows) {
      const expected = Math.round((Number(row.cells.operators) / Number(row.cells.leaders)) * 10) / 10
      expect(row.cells.average).toBe(expected.toLocaleString("pt-BR", { maximumFractionDigits: 1 }))
    }
  })

  it("conta líderes abaixo de líderes (supervisores por gerente/coordenador) e recusa nível contado acima do líder", async () => {
    const deps = await managerDeps()
    const scope = deps.scope
    const supervisors = [...scope.nodes.values()].filter((node) => node.role === "SUPERVISOR" && node.active).length
    const result = await executeLeadershipTool(deps, "leadership_span", { nivel: "MANAGER", contar: "SUPERVISORES" })
    const card = result.card as QueryTableCard
    expect(card.columns.map((column) => column.label)).toEqual(["Gerente", "Grupo", "Supervisores"])
    expect(card.rows.reduce((total, row) => total + Number(row.cells.operators), 0)).toBeLessThanOrEqual(supervisors)
    expect(result.text).toMatch(/supervisores por gerente/)
    const invalid = await executeLeadershipTool(deps, "leadership_span", { nivel: "SUPERVISOR", contar: "GERENTES" })
    expect(invalid.issue?.kind).toBe("INVALID")
  })

  it("é oferecida ao modelo junto da calculadora", () => {
    const names = LEADERSHIP_TOOL_DECLARATIONS.map((declaration) => declaration.name)
    expect(names).toContain("leadership_span")
    expect(names).toContain("leadership_calculate")
  })
})

describe("calculadora (leadership_calculate)", () => {
  it("lê números como as ferramentas mostram (pt-BR, milhar, %)", () => {
    expect(parseNumber("2.264")).toBe(2264)
    expect(parseNumber("25,2")).toBe(25.2)
    expect(parseNumber("87,2%")).toBe(87.2)
    expect(parseNumber("1.234,5")).toBe(1234.5)
    expect(parseNumber(12)).toBe(12)
    expect(parseNumber("doze")).toBeNull()
  })

  it("faz as operações e recusa o que não tem resultado", () => {
    const run = (operation: Parameters<typeof calculate>[0]["operation"], values: number[]) => calculate({ label: "x", operation, values })
    expect(run("SOMA", [1, 2, 3]).result).toBe(6)
    expect(run("SUBTRACAO", [10, 3, 2]).result).toBe(5)
    expect(run("MULTIPLICACAO", [2, 3, 4]).result).toBe(24)
    expect(run("DIVISAO", [2264, 90]).result).toBeCloseTo(25.1556, 3)
    expect(run("MEDIA", [25, 28, 39]).result).toBe(30.666666666666668)
    expect(run("MEDIANA", [5, 1, 3, 2]).result).toBe(2.5)
    expect(run("MINIMO", [5, 1, 3]).result).toBe(1)
    expect(run("MAXIMO", [5, 1, 3]).result).toBe(5)
    expect(run("CONTAGEM", [5, 1, 3]).result).toBe(3)
    expect(run("PERCENTUAL", [34, 39]).result).toBeCloseTo(87.18, 2)
    expect(run("VARIACAO_PERCENTUAL", [80, 100]).result).toBe(25)
    expect(run("DESVIO_PADRAO", [2, 4, 4, 4, 5, 5, 7, 9]).result).toBe(2)
    expect(run("DIVISAO", [1, 0])).toMatchObject({ result: null, error: "divisão por zero" })
    expect(run("PERCENTUAL", [1])).toMatchObject({ result: null })
  })

  it("DL-11: devolve a conta escrita e diz, no texto e na estrutura, que os operandos foram informados (não apurados)", async () => {
    const result = await executeLeadershipTool(await managerDeps(), "leadership_calculate", { calculos: [{ rotulo: "Span médio", operacao: "DIVISAO", valores: ["2.264", 90] }] })
    expect(result.text).toContain("Span médio: divisão (o primeiro pelos demais) dos valores informados [2.264; 90] = 25,16")
    expect(result.text).toContain("NÃO apurou nem conferiu os valores de entrada")
    expect(result.trace).toEqual({ calculation: { operands: "INFORMED_BY_ASSISTANT", operandsCheckedAgainstData: false } })
    expect(result.issue).toBeUndefined()
  })

  it("pedido fora do formato vira issue, sem resultado inventado", async () => {
    expect(parseCalculations([])).toHaveProperty("error")
    expect(parseCalculations([{ operacao: "RAIZ", valores: [4] }])).toHaveProperty("error")
    const result = await executeLeadershipTool(await managerDeps(), "leadership_calculate", { calculos: [{ operacao: "SOMA", valores: ["abc"] }] })
    expect(result.issue?.kind).toBe("INVALID")
  })
})
