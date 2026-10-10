import { describe, expect, it } from "vitest"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { buildEmployeeDashboard } from "./build-employee-dashboard.js"
import { fixtureOrg, IDS } from "../testing/fixture-org.js"
import { InMemoryAnalyticsRepository, ORG } from "../testing/in-memory-analytics-repository.js"
import { loadViewerScope } from "./viewer-scope.js"

const operator: AuthTokenPayload = { sub: "acc", personId: IDS.op1, organizationId: ORG, role: "OPERATOR", name: "Ana", email: "ana@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }

async function dashboardFor(personId: string, period = "2026-09", org = fixtureOrg()) {
  const repository = new InMemoryAnalyticsRepository(org)
  const scope = await loadViewerScope(repository, { ...operator, personId })
  return { repository, dashboard: await buildEmployeeDashboard(repository, scope, { kind: "EMPLOYEE", employeeId: personId }, period) }
}

describe("Indicadores do Operador — PRV oficial", () => {
  it("mostra exatamente o valor persistido (105%, Q1), a variação em p.p. e a fonte — nunca recalcula", async () => {
    const { dashboard } = await dashboardFor(IDS.op1)
    expect(dashboard.mode).toBe("EMPLOYEE")
    expect(dashboard.prv).toEqual({ period: "2026-09", achievementPercent: 105, quartile: "Q1", target: 100, previousAchievementPercent: 101, deltaPp: 4, trend: "UP", source: "TEST" })
  })

  it("composição = indicadores com peso oficial no período, ordenados por peso, sem somar/recompor nada", async () => {
    const { dashboard } = await dashboardFor(IDS.op1)
    expect(dashboard.prvComposition).toEqual([
      { indicatorCode: "NOTA_URA", indicatorName: "Nota da Pesquisa na URA", achievementPercent: 112.5, weightPercent: 60 },
      { indicatorCode: "TMA", indicatorName: "Tempo Médio de Atendimento", achievementPercent: 93.3, weightPercent: 40 },
    ])
  })

  it("histórico do PRV vem da fonte oficial, mês a mês, com SEM DADOS como null (nunca 0)", async () => {
    const { dashboard } = await dashboardFor(IDS.op1)
    expect(dashboard.prvHistory.map((point) => [point.label, point.value])).toEqual([
      ["abr/26", null],
      ["mai/26", null],
      ["jun/26", null],
      ["jul/26", 96],
      ["ago/26", 101],
      ["set/26", 105],
    ])
  })

  it("sem PRV no período → prv null e ponto de atenção explícito, sem inventar valor", async () => {
    const { dashboard } = await dashboardFor(IDS.op2, "2026-08")
    expect(dashboard.prv).toBeNull()
    expect(dashboard.prvComposition).toEqual([])
    expect(dashboard.prvPositives).toEqual([])
  })

  it("insights determinísticos do PRV: acima da meta, Q1, evolução e sequência acima de 100%", async () => {
    const { dashboard } = await dashboardFor(IDS.op1)
    expect(dashboard.prvPositives.map((insight) => insight.text)).toEqual([
      "Atingimento de 105% — igual ou acima da meta.",
      "Está no Q1 — melhor quartil da referência oficial.",
      "Atingimento igual ou acima de 100% há 2 períodos.",
    ])
    expect(dashboard.prvAttentionPoints).toEqual([])
  })
})

describe("Indicadores do Operador — indicadores individuais", () => {
  it("cada indicador traz valor, meta, atingimento oficial, peso, quartil, variação e histórico; abaixo da referência vem primeiro", async () => {
    const { dashboard } = await dashboardFor(IDS.op1)
    expect(dashboard.indicators.map((indicator) => indicator.code)).toEqual(["TMA", "NOTA_URA"])
    const tma = dashboard.indicators[0]!
    expect(tma).toMatchObject({ value: 280, targetValue: 300, achievementPercent: 93.3, weightPercent: 40, quartile: "Q2", withinTarget: false, deltaPp: null, trend: "UNKNOWN", unit: "SECONDS", direction: "LOWER" })
    const ura = dashboard.indicators[1]!
    expect(ura).toMatchObject({ achievementPercent: 112.5, previousAchievementPercent: 102.5, deltaPp: 10, trend: "UP", quartile: "Q1" })
    expect(ura.history.map((point) => point.value)).toEqual([null, null, null, 100, 102.5, 112.5])
  })

  it("análise de IA persistida (feedback INDICATOR publicado) aparece no indicador certo — e nada é chamado sob demanda", async () => {
    const { dashboard, repository } = await dashboardFor(IDS.op1)
    const ura = dashboard.indicators.find((indicator) => indicator.code === "NOTA_URA")!
    expect(ura.persistedInsights).toEqual([expect.objectContaining({ id: "fb-1", source: "FEEDBACK", recommendation: "Recomendação persistida" })])
    expect(dashboard.indicators.find((indicator) => indicator.code === "TMA")!.persistedInsights).toEqual([])
    expect(repository.calls.filter((call) => call === "loadPersistedIndicatorInsights")).toHaveLength(1)
  })

  it("indicador sem atingimento oficial mas com meta: withinTarget deriva de valor x meta x direção e o atingimento fica SEM DADOS", async () => {
    const { dashboard } = await dashboardFor(IDS.op2)
    const tma = dashboard.indicators.find((indicator) => indicator.code === "TMA")!
    expect(tma.achievementPercent).toBeNull()
    expect(tma.withinTarget).toBe(false)
    expect(tma.attentionPoints.map((insight) => insight.text)).toContain("Sem dado oficial de atingimento de Tempo Médio de Atendimento neste período.")
  })

  it("Q4 e queda viram pontos de atenção descritivos", async () => {
    const { dashboard } = await dashboardFor(IDS.op2)
    const ura = dashboard.indicators.find((indicator) => indicator.code === "NOTA_URA")!
    expect(ura.attentionPoints.map((insight) => insight.text)).toEqual([
      "Atingimento de 37,5% — faltam 62,5 p.p. para a meta.",
      "Está no Q4 — quartil mais baixo da referência oficial.",
      "Abaixo da meta há 2 períodos consecutivos.",
    ])
    expect(ura.positives.map((insight) => insight.text)).toEqual(["Evoluiu 7,5 p.p. em relação ao período anterior."])
  })

  it("colaborador sem nenhuma linha → lista vazia e PRV null (estado vazio, não zeros)", async () => {
    const org = fixtureOrg()
    const repository = new InMemoryAnalyticsRepository(org)
    const scope = await loadViewerScope(repository, { ...operator, personId: IDS.op4 })
    const dashboard = await buildEmployeeDashboard(repository, scope, { kind: "EMPLOYEE", employeeId: IDS.op4 }, "2026-09")
    expect(dashboard.prv).toBeNull()
    expect(dashboard.indicators).toEqual([])
    expect(dashboard.prvHistory.every((point) => point.value === null)).toBe(true)
  })
})
