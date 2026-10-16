import { describe, expect, it } from "vitest"
import type { PendingActionsSummary } from "../../pending-actions/domain/view-models.js"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import type { OperationalStructureSummary } from "../../performance-analytics/domain/view-models.js"
import { indicatorRow, InMemoryAnalyticsRepository } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import { CLOSURE, L, leaderUser, leadershipOrg, operatorsOf } from "../testing/leadership-fixture.js"
import type { QueryTableCard } from "../domain/view-models.js"
import { queryTableMarkdown } from "./indicator-query.js"
import { executeLeadershipTool, type LeadershipToolDependencies } from "./leadership-toolset.js"

const NO_PENDING: PendingActionsSummary = { pending: [], history: [], pendingCount: 0 }

async function depsFor(personId: string, role: "SUPERVISOR" | "COORDINATOR" | "MANAGER", org = leadershipOrg()): Promise<LeadershipToolDependencies> {
  const repository = new InMemoryAnalyticsRepository(org)
  return { repository, scope: await loadViewerScope(repository, leaderUser(personId, role)), closure: CLOSURE, loadPendingActions: async () => NO_PENDING }
}

const query = async (deps: LeadershipToolDependencies, args: Record<string, unknown>) => (await executeLeadershipTool(deps, "leadership_indicator_query", args)).card as QueryTableCard
const column = (card: QueryTableCard, label: string) => card.columns.find((entry) => entry.label === label)!.key
const cells = (card: QueryTableCard, label: string) => card.rows.map((row) => row.cells[column(card, label)])

describe("consulta flexível — fonte oficial", () => {
  it("por supervisor (agrupamento pedido): % fora com a base, pior primeiro; sem rótulo repetido", async () => {
    const card = await query(await depsFor(L.gabriel, "MANAGER"), { indicadores: ["TMA"], agrupar_por: "SUPERVISOR" })
    expect(card.scopeNote).toBe("Competência oficial: Agosto 2026")
    expect(cells(card, "Supervisor")).toEqual(["Sara Silva", "Saulo Silva", "Sônia Prado", "Sem supervisor (Ligados diretamente à estrutura)"])
    expect(cells(card, "Fora")).toEqual(["4", "1", "0", "0"])
    expect(cells(card, "Com referência")[0]).toBe("5 de 5")
    expect(cells(card, "% fora")[0]).toBe("80%")
    expect(card.rows[0]!.subject).toEqual({ kind: "SUPERVISOR_TEAM", supervisorId: L.sara })
  })

  it("evolução por competência: uma linha por mês, em ordem cronológica", async () => {
    const card = await query(await depsFor(L.gabriel, "MANAGER"), { indicadores: ["TMA"], agrupar_por: "COMPETENCIA", ultimas_competencias: 2, competencia: "2026-08" })
    expect(cells(card, "Competência")).toEqual(["Julho 2026", "Agosto 2026"])
    expect(cells(card, "% fora")).toEqual(["0%", "33,3%"])
  })

  it("variação desde a primeira competência quando pedidas várias", async () => {
    const card = await query(await depsFor(L.gabriel, "MANAGER"), { indicadores: ["TMA"], agrupar_por: "ESTRUTURA", ultimas_competencias: 2, competencia: "2026-08" })
    expect(card.columns.at(-1)!.label).toBe("Δ % fora desde jul/26")
    expect(card.rows[0]!.cells[card.columns.at(-1)!.key]).toBe("+33,3 p.p.")
  })

  it("pessoas fora num indicador: do menor atingimento ao maior, com link para a ficha", async () => {
    const card = await query(await depsFor(L.gabriel, "MANAGER"), { indicadores: ["TMA"], agrupar_por: "PESSOA", situacao: "FORA" })
    expect(card.totalRows).toBe(5)
    expect(cells(card, "Atingimento")).toEqual(["70%", "75%", "80%", "85%", "90%"])
    expect(card.rows[0]!.personId).toBe(operatorsOf(1)[0])
  })

  it("pessoas fora em N ou mais indicadores (ofensor por volume)", async () => {
    const org = leadershipOrg()
    org.indicatorRows!.push(indicatorRow({ personId: operatorsOf(1)[0]!, indicatorCode: "FCR", referencePeriod: "2026-08", value: 60, targetValue: 75, achievementPercent: 80 }))
    const card = await query(await depsFor(L.gabriel, "MANAGER", org), { agrupar_por: "PESSOA", minimo_indicadores_fora: 2 })
    expect(card.title).toBe("Pessoas fora da referência em 2 ou mais indicadores")
    expect(card.rows.map((row) => row.personId)).toEqual([operatorsOf(1)[0]])
    expect(card.rows[0]!.cells[column(card, "Fora")]).toBe("2")
  })

  it("escopo vale também aqui: estrutura vizinha não é consultável; indicador inexistente pede esclarecimento", async () => {
    const deps = await depsFor(L.gabriel, "MANAGER")
    expect((await executeLeadershipTool(deps, "leadership_indicator_query", { estrutura: "Hugo Reis" })).issue?.kind).toBe("NOT_FOUND")
    expect((await executeLeadershipTool(deps, "leadership_indicator_query", { indicadores: ["Inventado"] })).issue?.kind).toBe("NOT_FOUND")
  })

  it("a tabela em markdown traz exatamente as células do cartão", async () => {
    const card = await query(await depsFor(L.carla, "COORDINATOR"), { indicadores: ["TMA"] })
    const markdown = queryTableMarkdown(card)
    expect(markdown.split("\n")[0]).toBe(`| ${card.columns.map((entry) => entry.label).join(" | ")} |`)
    expect(markdown).toContain("| Sara Silva | 5 de 5 | 4 | 80% |")
  })
})

describe("consulta flexível — fonte operacional (mês corrente)", () => {
  const summary: OperationalStructureSummary = {
    comparison: { kind: "MONTH", label: "Mês corrente × mês anterior", currentLabel: "Mês corrente (até hoje)", previousLabel: "Mês anterior (completo)", currentPhrase: "no mês corrente (até hoje)", previousPhrase: "o mês anterior" } as never,
    windowLabel: "01/10/2026 → 15/10/2026",
    previousWindowLabel: "01/09/2026 → 30/09/2026",
    windowCalendarDays: 15,
    previousWindowCalendarDays: 30,
    currentPeriodCalendarDays: 31,
    memberCount: 5,
    eligibleMemberCount: 5,
    method: "Pooled",
    indicators: [{ code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", direction: "LOWER", aggregation: "WEIGHTED_AVERAGE", aggregationLabel: "Média ponderada", method: null, currentValue: 300, previousValue: 330, changePercent: -9.1, performanceChangePercent: 9.1, performanceTrend: "IMPROVED", changeUnavailableReason: null, membersWithData: 5, membersWithSufficientData: 5, memberCount: 5, eligibleMemberCount: 5, minimumCoverage: null, minimumSampleSize: null, sufficiencyRule: "NONE" }],
  }

  it("valor consolidado da janela corrente × anterior, com desempenho ajustado à direção e sem meta", async () => {
    const org = { ...leadershipOrg(), operationalSummary: summary }
    const card = await query(await depsFor(L.sara, "SUPERVISOR", org), { fonte: "OPERACIONAL", janela: "MES_CORRENTE", indicadores: ["TMA"] })
    expect(card.source).toBe("OPERATIONAL")
    expect(card.scopeNote).toContain("01/10/2026 → 15/10/2026")
    expect(card.rows[0]!.cells).toMatchObject({ current: "300 s", previous: "330 s", trend: "melhorou", coverage: "5 de 5" })
    expect(card.methods.join(" ")).toContain("não tem meta oficial")
  })

  it("sem medição no período corrente: a limitação diz que a coluna atual fica vazia", async () => {
    const empty = { ...summary, indicators: [{ ...summary.indicators[0]!, currentValue: null, membersWithData: 0 }] }
    const card = await query(await depsFor(L.sara, "SUPERVISOR", { ...leadershipOrg(), operationalSummary: empty }), { fonte: "OPERACIONAL" })
    expect(card.limitations.join(" ")).toContain("Ainda não há medição diária")
  })
})
