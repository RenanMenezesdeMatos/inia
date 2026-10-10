import { definition, indicatorRow, person, prvRow, type InMemoryOrg } from "./in-memory-analytics-repository.js"

/**
 * Organização de teste com todos os níveis reais da cadeia:
 *   Diretor → Gerente Sênior → Gerente A → Coordenadora → Supervisora Vanessa → op-1, op-2
 *                            → Gerente B → Supervisor Bruno → op-3 (Faturas), op-4 (sem dados)
 * Indicadores em unidades DIFERENTES (segundos x nota x %) de propósito — só o atingimento
 * normalizado pode ser consolidado.
 */
export const IDS = {
  director: "10000000-0000-4000-8000-000000000001",
  senior: "10000000-0000-4000-8000-000000000002",
  managerA: "10000000-0000-4000-8000-000000000003",
  managerB: "10000000-0000-4000-8000-000000000004",
  coordinator: "10000000-0000-4000-8000-000000000005",
  vanessa: "10000000-0000-4000-8000-000000000006",
  bruno: "10000000-0000-4000-8000-000000000007",
  op1: "10000000-0000-4000-8000-000000000011",
  op2: "10000000-0000-4000-8000-000000000012",
  op3: "10000000-0000-4000-8000-000000000013",
  op4: "10000000-0000-4000-8000-000000000014",
  teamA: "20000000-0000-4000-8000-000000000001",
  teamB: "20000000-0000-4000-8000-000000000002",
  subteamA1: "30000000-0000-4000-8000-000000000001",
} as const

export function fixtureOrg(): InMemoryOrg {
  return {
    people: [
      person({ id: IDS.director, name: "Paulo Diretor", role: "DIRECTOR" }),
      person({ id: IDS.senior, name: "Fernanda Sênior", role: "SENIOR_MANAGER", reportsToId: IDS.director }),
      person({ id: IDS.managerA, name: "Roberto Gerente", role: "MANAGER", reportsToId: IDS.senior, teamId: IDS.teamA, teamName: "ATENDIMENTO" }),
      person({ id: IDS.managerB, name: "Roberta Gerente", role: "MANAGER", reportsToId: IDS.senior, teamId: IDS.teamB, teamName: "FATURAS" }),
      person({ id: IDS.coordinator, name: "Patrícia Coordenadora", role: "COORDINATOR", reportsToId: IDS.managerA, teamId: IDS.teamA, teamName: "ATENDIMENTO" }),
      person({ id: IDS.vanessa, name: "Vanessa Supervisora", role: "SUPERVISOR", reportsToId: IDS.coordinator, teamId: IDS.teamA, teamName: "ATENDIMENTO" }),
      person({ id: IDS.bruno, name: "Bruno Supervisor", role: "SUPERVISOR", reportsToId: IDS.managerB, teamId: IDS.teamB, teamName: "FATURAS" }),
      person({ id: IDS.op1, name: "Ana Operadora", role: "OPERATOR", reportsToId: IDS.vanessa, teamId: IDS.teamA, teamName: "ATENDIMENTO", subteamId: IDS.subteamA1, subteamName: "Chat" }),
      person({ id: IDS.op2, name: "Bia Operadora", role: "OPERATOR", reportsToId: IDS.vanessa, teamId: IDS.teamA, teamName: "ATENDIMENTO" }),
      person({ id: IDS.op3, name: "Caio Operador", role: "OPERATOR", reportsToId: IDS.bruno, teamId: IDS.teamB, teamName: "FATURAS" }),
      person({ id: IDS.op4, name: "Dora Sem Dados", role: "OPERATOR", reportsToId: IDS.bruno, teamId: IDS.teamB, teamName: "FATURAS" }),
    ],
    definitions: [
      definition("TMA", "Tempo Médio de Atendimento", "SECONDS", "LOWER"),
      definition("NOTA_URA", "Nota da Pesquisa na URA", "STARS", "HIGHER"),
      definition("QUALIDADE", "Qualidade", "PERCENT", "HIGHER"),
    ],
    indicatorRows: [
      // op-1: setembro — TMA 280s (meta 300, 93.3%), URA 4.5 (meta 4, 112.5%, peso 60, Q1)
      indicatorRow({ personId: IDS.op1, indicatorCode: "TMA", referencePeriod: "2026-09", value: 280, targetValue: 300, achievementPercent: 93.3, weightPercent: 40, quartile: "Q2" }),
      indicatorRow({ personId: IDS.op1, indicatorCode: "NOTA_URA", referencePeriod: "2026-09", value: 4.5, targetValue: 4, achievementPercent: 112.5, weightPercent: 60, quartile: "Q1" }),
      indicatorRow({ personId: IDS.op1, indicatorCode: "NOTA_URA", referencePeriod: "2026-08", value: 4.1, targetValue: 4, achievementPercent: 102.5, weightPercent: 60, quartile: "Q2" }),
      indicatorRow({ personId: IDS.op1, indicatorCode: "NOTA_URA", referencePeriod: "2026-07", value: 4.0, targetValue: 4, achievementPercent: 100, weightPercent: 60, quartile: "Q2" }),
      // op-2: setembro — URA 1.5 (37.5%, Q4); TMA sem atingimento oficial mas com meta (fato: acima da meta LOWER → abaixo da referência)
      indicatorRow({ personId: IDS.op2, indicatorCode: "NOTA_URA", referencePeriod: "2026-09", value: 1.5, targetValue: 4, achievementPercent: 37.5, weightPercent: 60, quartile: "Q4" }),
      indicatorRow({ personId: IDS.op2, indicatorCode: "TMA", referencePeriod: "2026-09", value: 400, targetValue: 300, achievementPercent: null, weightPercent: 40, quartile: null }),
      indicatorRow({ personId: IDS.op2, indicatorCode: "NOTA_URA", referencePeriod: "2026-08", value: 1.2, targetValue: 4, achievementPercent: 30, weightPercent: 60, quartile: "Q4" }),
      // op-3: setembro — QUALIDADE 95 (105.6%)
      indicatorRow({ personId: IDS.op3, indicatorCode: "QUALIDADE", referencePeriod: "2026-09", value: 95, targetValue: 90, achievementPercent: 105.6, weightPercent: 100, quartile: "Q1" }),
      indicatorRow({ personId: IDS.op3, indicatorCode: "QUALIDADE", referencePeriod: "2026-08", value: 80, targetValue: 90, achievementPercent: 88.9, weightPercent: 100, quartile: "Q3" }),
    ],
    prvRows: [
      prvRow(IDS.op1, "2026-09", 105, "Q1"),
      prvRow(IDS.op1, "2026-08", 101, "Q2"),
      prvRow(IDS.op1, "2026-07", 96, "Q2"),
      prvRow(IDS.op2, "2026-09", 35, "Q4"),
      prvRow(IDS.op3, "2026-09", 98, "Q2"),
      prvRow(IDS.op3, "2026-08", 88, "Q3"),
    ],
    followUps: { [IDS.op1]: { total: 3, unacknowledged: 1 }, [IDS.op2]: { total: 2, unacknowledged: 2 } },
    pendingReviews: { [IDS.vanessa]: { [IDS.op2]: 1 }, [IDS.managerA]: { [IDS.op2]: 2 } },
    insights: [{ id: "fb-1", indicatorName: "Nota da Pesquisa na URA", summary: "Comportamento observado", recommendation: "Recomendação persistida", publishedAt: "2026-09-10T12:00:00.000Z", source: "FEEDBACK" }],
  }
}
