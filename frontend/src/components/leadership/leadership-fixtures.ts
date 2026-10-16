import type { IndicatorAnalysisCard, PrioritiesCard, QueryTableCard } from "@/schemas/leadership/leadership.schema"

/** Cartões de exemplo no formato do backend (testes de componente). */
export const SUPERVISOR_SUBJECT = { kind: "SUPERVISOR_TEAM" as const, supervisorId: "11111111-1111-4111-8111-111111111111" }
export const COORDINATOR_SUBJECT = { kind: "COORDINATOR_STRUCTURE" as const, coordinatorId: "22222222-2222-4222-8222-222222222222" }

const decileCounts = { D1: 1, D2: 1, D3: 1, D4: 1, D5: 1, D6: 1, D7: 1, D8: 1, D9: 1, D10: 1 }

export function indicatorAnalysisCard(overrides: Partial<IndicatorAnalysisCard> = {}): IndicatorAnalysisCard {
  return {
    type: "INDICATOR_ANALYSIS",
    generatedAt: "2026-10-15T12:00:00.000Z",
    structure: { subject: COORDINATOR_SUBJECT, label: "Carla Coordenadora", description: "Estrutura · Coordenador" },
    period: "2026-08",
    periodLabel: "Agosto 2026",
    indicator: { code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", direction: "LOWER" },
    population: { memberCount: 25, membersWithData: 23, withReference: 23, noData: 2, coveragePercent: 92 },
    reference: { within: 14, below: 9, withinPercent: 60.9, belowPercent: 39.1 },
    previous: { period: "2026-07", periodLabel: "Julho 2026", withReference: 23, belowPercent: 34.8, deltaPp: 4.3 },
    averageAchievementPercent: 96.2,
    ranking: {
      reason: "OK",
      rankedCount: 23,
      best: [{ personId: "p-best", name: "Bruna Melhor", value: 250, targetValue: 300, achievementPercent: 120, position: 1, decile: "D1", officialQuartile: "Q1", within: true, unitLabel: "Sara Silva" }],
      worst: [{ personId: "p-worst", name: "Pedro Pior", value: 420, targetValue: 300, achievementPercent: 71.4, position: 23, decile: "D10", officialQuartile: "Q4", within: false, unitLabel: "Sara Silva" }],
    },
    officialQuartiles: { Q1: 6, Q2: 6, Q3: 5, Q4: 6, NO_DATA: 2 },
    deciles: { reason: "OK", rankedCount: 10, counts: decileCounts },
    units: [
      { key: "u-sara", label: "Sara Silva", description: "Supervisor", subject: SUPERVISOR_SUBJECT, memberCount: 12, membersWithData: 12, withReference: 12, within: 4, below: 8, belowPercent: 66.7, shareOfDeviationsPercent: 88.9, averageAchievementPercent: 88, comparable: true, comparabilityReasons: [], groupName: "Atendimento" },
      { key: "direct", label: "Ligados diretamente", description: "Sem gestor intermediário", subject: null, memberCount: 1, membersWithData: 0, withReference: 0, within: 0, below: 0, belowPercent: null, shareOfDeviationsPercent: 0, averageAchievementPercent: null, comparable: false, comparabilityReasons: ["população pequena"], groupName: null },
    ],
    unitsGroupBy: "SUPERVISOR",
    unitsGroupByLabel: "Supervisor",
    concentration: { pattern: "CONCENTRATED", focusKeys: ["u-sara"], overallRatePercent: 39.1, explanation: "Concentrado: Sara Silva reúne 88,9% das pessoas fora." },
    comparison: { groups: [{ teamName: "Atendimento", unitKeys: ["u-sara"] }], note: null },
    limitations: ["Setembro 2026 tem fechamento parcial (5 de 25 pessoas com dado)."],
    methods: ["Dentro/fora da meta: atingimento oficial ≥ 100% = dentro."],
    ...overrides,
  }
}

export function prioritiesCard(): PrioritiesCard {
  return {
    type: "PRIORITIES",
    generatedAt: "2026-10-15T12:00:00.000Z",
    structure: { subject: COORDINATOR_SUBJECT, label: "Carla Coordenadora", description: "Estrutura · Coordenador" },
    period: "2026-08",
    periodLabel: "Agosto 2026",
    items: [
      { kind: "PENDING_DECISION", severity: "HIGH", title: "Executar — Ana", evidence: "Plano de ação · prazo 12/10/2026 (atrasada)", target: { kind: "PENDING", operatorId: "op-ana", caseId: "case-1" }, question: null },
      { kind: "INDICATOR_DEVIATION", severity: "MEDIUM", title: "Tempo Médio de Atendimento: 9 de 23 fora da referência", evidence: "39,1% da estrutura em Agosto 2026.", target: { kind: "INDICATOR", subject: COORDINATOR_SUBJECT, indicatorCode: "TMA", indicatorName: "Tempo Médio de Atendimento", period: "2026-08" }, question: "Onde está concentrado o desvio de Tempo Médio de Atendimento?" },
    ],
    method: "Ordem: decisões atrasadas que aguardam você → …",
    limitations: [],
  }
}

export function queryTableCard(): QueryTableCard {
  return {
    type: "QUERY_TABLE",
    generatedAt: "2026-10-15T12:00:00.000Z",
    structure: { subject: COORDINATOR_SUBJECT, label: "Carla Coordenadora", description: "Estrutura · Coordenador" },
    source: "OFFICIAL",
    title: "Reincidência em até 7 Dias por supervisor",
    scopeNote: "Competência oficial: Agosto 2026",
    period: "2026-08",
    indicatorCode: "REINCIDENCIA_7D",
    columns: [
      { key: "group", label: "Supervisor", numeric: false },
      { key: "below", label: "Fora", numeric: true },
      { key: "belowPercent", label: "% fora", numeric: true },
    ],
    rows: [{ cells: { group: "Sara Silva", below: "15", belowPercent: "60%" }, subject: SUPERVISOR_SUBJECT, personId: null }],
    totalRows: 1,
    methods: ["Dentro/fora da meta: atingimento oficial ≥ 100% = dentro."],
    limitations: [],
  }
}
