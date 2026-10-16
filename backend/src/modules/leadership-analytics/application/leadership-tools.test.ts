import { describe, expect, it } from "vitest"
import type { PendingActionsSummary } from "../../pending-actions/domain/view-models.js"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { indicatorRow, InMemoryAnalyticsRepository } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import { CLOSURE, L, leaderUser, leadershipOrg, operatorsOf } from "../testing/leadership-fixture.js"
import type { IndicatorAnalysisCard, PeopleCard, PrioritiesCard, StructureOverviewCard } from "../domain/view-models.js"
import { visibleCards } from "./leadership-context.js"
import { executeLeadershipTool, type LeadershipToolDependencies } from "./leadership-toolset.js"

const NO_PENDING: PendingActionsSummary = { pending: [], history: [], pendingCount: 0 }

async function depsFor(personId: string, role: "SUPERVISOR" | "COORDINATOR" | "MANAGER", org = leadershipOrg(), pending: PendingActionsSummary = NO_PENDING): Promise<LeadershipToolDependencies> {
  const repository = new InMemoryAnalyticsRepository(org)
  const scope = await loadViewerScope(repository, leaderUser(personId, role))
  return { repository, scope, closure: CLOSURE, loadPendingActions: async () => pending }
}

const analysis = (result: { card: unknown }) => result.card as IndicatorAnalysisCard

describe("ferramentas da liderança — escopo decidido no backend", () => {
  it("Supervisora não alcança a equipe irmã nem a gerência vizinha: mesma resposta de 'não encontrado'", async () => {
    const deps = await depsFor(L.sara, "SUPERVISOR")
    for (const name of ["Saulo", "Hugo Reis", "Helena"]) {
      const result = await executeLeadershipTool(deps, "leadership_indicator_analysis", { indicador: "TMA", estrutura: name })
      expect(result.card).toBeNull()
      expect(result.issue?.kind).toBe("NOT_FOUND")
    }
  })

  it("referência por id (vinda da tela) também é validada contra o escopo", async () => {
    const deps = await depsFor(L.gabriel, "MANAGER")
    const result = await executeLeadershipTool(deps, "leadership_structure_overview", { subject_kind: "MANAGER_STRUCTURE", subject_id: L.helena })
    expect(result.issue?.kind).toBe("NOT_FOUND")
    expect(result.card).toBeNull()
  })

  it("Coordenadora aprofunda até a equipe de uma supervisora pelo nome; nome repetido pede escolha", async () => {
    const deps = await depsFor(L.carla, "COORDINATOR")
    const sara = analysis(await executeLeadershipTool(deps, "leadership_indicator_analysis", { indicador: "tempo medio de atendimento", estrutura: "sara" }))
    expect(sara.structure.subject).toEqual({ kind: "SUPERVISOR_TEAM", supervisorId: L.sara })
    expect(sara.population.memberCount).toBe(5)
    const ambiguous = await executeLeadershipTool(deps, "leadership_indicator_analysis", { indicador: "TMA", estrutura: "Silva" })
    expect(ambiguous.issue?.kind).toBe("AMBIGUOUS")
    expect(ambiguous.issue?.candidates).toEqual(["Sara Silva (Supervisor)", "Saulo Silva (Supervisor)"])
    // Sônia responde direto ao gerente: fora da estrutura da coordenadora.
    expect((await executeLeadershipTool(deps, "leadership_structure_overview", { estrutura: "Sônia" })).issue?.kind).toBe("NOT_FOUND")
  })
})

describe("análise de indicador — base, ranking, decis e unidades", () => {
  it("Gerente: % fora com denominador explícito; sem dado fica fora do denominador", async () => {
    const card = analysis(await executeLeadershipTool(await depsFor(L.gabriel, "MANAGER"), "leadership_indicator_analysis", { indicador: "TMA" }))
    expect(card.period).toBe("2026-08")
    expect(card.population).toEqual({ memberCount: 16, membersWithData: 15, withReference: 15, noData: 1, coveragePercent: 93.8 })
    expect(card.reference).toEqual({ within: 10, below: 5, withinPercent: 66.7, belowPercent: 33.3 })
    expect(card.previous).toMatchObject({ period: "2026-07", belowPercent: 0, deltaPp: 33.3 })
    expect(card.ranking.rankedCount).toBe(15)
    expect(card.ranking.worst[0]).toMatchObject({ achievementPercent: 70, position: 15, decile: "D10", unitLabel: "Carla Coordenadora" })
    expect(card.deciles.reason).toBe("OK")
    expect(Object.values(card.deciles.counts).reduce((sum, count) => sum + count, 0)).toBe(15)
  })

  it("nível intermediário ausente: coordenação + supervisora sem coordenador + pessoa ligada diretamente", async () => {
    const card = analysis(await executeLeadershipTool(await depsFor(L.gabriel, "MANAGER"), "leadership_indicator_analysis", { indicador: "TMA" }))
    expect(card.unitsGroupByLabel).toBe("Coordenador")
    expect(card.units.map((unit) => [unit.label, unit.description, unit.memberCount, unit.below, unit.shareOfDeviationsPercent])).toEqual([
      ["Carla Coordenadora", "Coordenador", 10, 5, 100],
      ["Sônia Prado", "Supervisor", 5, 0, 0],
      ["Ligados diretamente", "Sem gestor intermediário", 1, 0, 0],
    ])
    expect(card.units.find((unit) => unit.label === "Ligados diretamente")?.subject).toBeNull()
    // Duas unidades navegáveis: não dá para afirmar concentração.
    expect(card.concentration?.pattern).toBe("UNDETERMINED")
  })

  it("agrupar por supervisor revela o desvio concentrado numa equipe", async () => {
    const card = analysis(await executeLeadershipTool(await depsFor(L.gabriel, "MANAGER"), "leadership_indicator_analysis", { indicador: "TMA", agrupar_por: "SUPERVISOR" }))
    expect(card.concentration?.pattern).toBe("CONCENTRATED")
    const sara = card.units.find((unit) => unit.label === "Sara Silva")!
    expect(card.concentration?.focusKeys).toEqual([sara.key])
    expect(sara).toMatchObject({ below: 4, belowPercent: 80, shareOfDeviationsPercent: 80, comparable: true })
  })

  it("empates dividem a posição; menos de 10 ranqueados = sem decis", async () => {
    const card = analysis(await executeLeadershipTool(await depsFor(L.helena, "MANAGER"), "leadership_indicator_analysis", { indicador: "TMA" }))
    expect(card.ranking.best.concat(card.ranking.worst).every((member) => member.position === 1)).toBe(true)
    expect(card.deciles.reason).toBe("INSUFFICIENT_POPULATION")
    expect(card.limitations.some((text) => text.includes("Decis exigem"))).toBe(true)
  })

  it("direção 'na meta' não tem melhor nem pior: sem ranking e sem decis", async () => {
    const org = leadershipOrg()
    for (const id of operatorsOf(1)) org.indicatorRows!.push(indicatorRow({ personId: id, indicatorCode: "TEMPO_META", referencePeriod: "2026-08", value: 10, targetValue: 10, achievementPercent: 100 }))
    const card = analysis(await executeLeadershipTool(await depsFor(L.sara, "SUPERVISOR", org), "leadership_indicator_analysis", { indicador: "TEMPO_META", competencia: "2026-08" }))
    expect(card.ranking.reason).toBe("DIRECTION_UNSUPPORTED")
    expect(card.deciles.reason).toBe("DIRECTION_UNSUPPORTED")
    expect(card.reference.within).toBe(5)
  })
})

describe("competência padrão", () => {
  it("fechamento parcial mais novo não vira o padrão — a nota diz quanto ele cobre", async () => {
    const card = analysis(await executeLeadershipTool(await depsFor(L.gabriel, "MANAGER"), "leadership_indicator_analysis", { indicador: "TMA" }))
    expect(card.period).toBe("2026-08")
    expect(card.limitations[0]).toContain("Setembro 2026 tem fechamento parcial (5 de 16 pessoas com dado)")
  })

  it("equipe com setembro completo usa setembro; mês pedido é respeitado", async () => {
    const deps = await depsFor(L.sara, "SUPERVISOR")
    expect(analysis(await executeLeadershipTool(deps, "leadership_indicator_analysis", { indicador: "TMA" })).period).toBe("2026-09")
    expect(analysis(await executeLeadershipTool(deps, "leadership_indicator_analysis", { indicador: "TMA", competencia: "2026-08" })).period).toBe("2026-08")
  })
})

describe("pessoas, visão geral e prioridades", () => {
  it("pessoas fora num indicador: todas as linhas oficiais do indicador, do menor atingimento ao maior", async () => {
    const card = (await executeLeadershipTool(await depsFor(L.gabriel, "MANAGER"), "leadership_people", { indicador: "TMA" })).card as PeopleCard
    expect(card.total).toBe(5)
    expect(card.members.map((member) => member.indicator?.achievementPercent)).toEqual([70, 75, 80, 85, 90])
  })

  it("visão geral: indicadores ordenados por pessoas fora, unidades pela proporção", async () => {
    const card = (await executeLeadershipTool(await depsFor(L.gabriel, "MANAGER"), "leadership_structure_overview", {})).card as StructureOverviewCard
    expect(card.indicators[0]).toMatchObject({ code: "TMA", below: 5, withReference: 15 })
    expect(card.members.total).toBe(16)
  })

  it("prioridades: decisão atrasada primeiro, depois os indicadores com mais pessoas fora", async () => {
    const pending: PendingActionsSummary = {
      pendingCount: 2,
      history: [],
      pending: [
        { id: "r1", kind: "HUMAN_REVIEW", status: "PENDING", enrollmentId: "e", nodeId: "n", workflowName: "Monitoria", nodeLabel: "Revisão", operator: null, reason: null, requestedAt: "2026-10-10T10:00:00Z", caseId: null, decision: null, decidedAt: null, reviewer: null },
        { id: "intervention:i", kind: "INTERVENTION", status: "PENDING", interventionId: "i", caseId: "c", operator: { personId: "p", name: "Ana", teamName: null, jobTitle: null }, typeName: "Plano de ação", reason: "x", pendingReason: "EXECUTE", pendingLabel: "Executar", dueAt: "2026-10-12T00:00:00Z", overdue: true, sensitive: false, requestedAt: "2026-10-14T10:00:00Z", decidedAt: null, reviewer: null },
      ],
    }
    const card = (await executeLeadershipTool(await depsFor(L.gabriel, "MANAGER", leadershipOrg(), pending), "leadership_priorities", {})).card as PrioritiesCard
    expect(card.items.map((item) => [item.kind, item.severity])).toEqual([
      ["PENDING_DECISION", "HIGH"],
      ["PENDING_DECISION", "MEDIUM"],
      ["INDICATOR_DEVIATION", "MEDIUM"],
      // FCR: Davi (ligado diretamente) é o único com dado, e está fora — 1 de 1.
      ["INDICATOR_DEVIATION", "HIGH"],
    ])
    expect(card.items[0]!.title).toBe("Executar — Ana")
    expect(card.items[2]!.target).toMatchObject({ kind: "INDICATOR", indicatorCode: "TMA", period: "2026-08" })
  })
})

describe("cartões reabertos no histórico", () => {
  it("estrutura que o escopo atual não alcança não volta à tela", async () => {
    const gabriel = await depsFor(L.gabriel, "MANAGER")
    const helena = await depsFor(L.helena, "MANAGER")
    const own = (await executeLeadershipTool(gabriel, "leadership_structure_overview", {})).card!
    const foreign = (await executeLeadershipTool(helena, "leadership_structure_overview", {})).card!
    expect(visibleCards(gabriel.scope, [own, foreign])).toEqual([own])
    expect(visibleCards(null, [own])).toEqual([])
  })
})
