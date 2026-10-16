import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { definition, indicatorRow, ORG, person, type InMemoryOrg } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import type { IndicatorPerformanceRow, PersonNode } from "../../performance-analytics/application/analytics-read-repository.js"

/**
 * Organização de teste da liderança, com nível intermediário AUSENTE de propósito:
 *   Gerente Gabriel ─┬─ Coordenadora Carla ─┬─ Supervisora Sara Silva (5 operadores)
 *                    │                      └─ Supervisor Saulo Silva (5 operadores)
 *                    ├─ Supervisora Sônia (sem coordenador; 5 operadores)
 *                    └─ 1 operador ligado diretamente ao gerente
 *   Gerente Helena (estrutura vizinha, fora do escopo de Gabriel) ── Supervisor Hugo (5 operadores)
 * Agosto/2026 = fechamento completo; setembro/2026 = só a equipe da Sara (fechamento parcial).
 */
export const L = {
  gabriel: "40000000-0000-4000-8000-000000000001",
  carla: "40000000-0000-4000-8000-000000000002",
  sara: "40000000-0000-4000-8000-000000000003",
  saulo: "40000000-0000-4000-8000-000000000004",
  sonia: "40000000-0000-4000-8000-000000000005",
  helena: "40000000-0000-4000-8000-000000000006",
  hugo: "40000000-0000-4000-8000-000000000007",
  direct: "40000000-0000-4000-8000-000000000099",
  team: "50000000-0000-4000-8000-000000000001",
  otherTeam: "50000000-0000-4000-8000-000000000002",
} as const

const operatorId = (supervisorIndex: number, index: number) => `41000000-0000-4000-8000-0000000${String(supervisorIndex).padStart(2, "0")}${String(index).padStart(3, "0")}`

export const SUPERVISORS = [
  { id: L.sara, index: 1, name: "Sara Silva" },
  { id: L.saulo, index: 2, name: "Saulo Silva" },
  { id: L.sonia, index: 3, name: "Sônia Prado" },
  { id: L.hugo, index: 4, name: "Hugo Reis" },
] as const

/** Atingimento de TMA (menor é melhor; o atingimento já vem ajustado) por supervisor × operador: Sara concentra os ruins. */
const TMA_ACHIEVEMENT: Record<number, number[]> = {
  1: [70, 75, 80, 85, 120],
  2: [101, 102, 103, 104, 90],
  3: [110, 111, 112, 113, 114],
  4: [60, 60, 60, 60, 60],
}

export function operatorsOf(supervisorIndex: number): string[] {
  return Array.from({ length: 5 }, (_, index) => operatorId(supervisorIndex, index + 1))
}

export function leadershipOrg(): InMemoryOrg {
  const team = (id: string) => (id === L.helena || id === L.hugo ? { teamId: L.otherTeam, teamName: "Outro Grupo" } : { teamId: L.team, teamName: "Atendimento" })
  const people: PersonNode[] = [
    person({ id: L.gabriel, name: "Gabriel Gerente", role: "MANAGER", ...team(L.gabriel) }),
    person({ id: L.carla, name: "Carla Coordenadora", role: "COORDINATOR", reportsToId: L.gabriel, ...team(L.carla) }),
    person({ id: L.sara, name: "Sara Silva", role: "SUPERVISOR", reportsToId: L.carla, ...team(L.sara) }),
    person({ id: L.saulo, name: "Saulo Silva", role: "SUPERVISOR", reportsToId: L.carla, ...team(L.saulo) }),
    person({ id: L.sonia, name: "Sônia Prado", role: "SUPERVISOR", reportsToId: L.gabriel, ...team(L.sonia) }),
    person({ id: L.helena, name: "Helena Gerente", role: "MANAGER", ...team(L.helena) }),
    person({ id: L.hugo, name: "Hugo Reis", role: "SUPERVISOR", reportsToId: L.helena, ...team(L.hugo) }),
    person({ id: L.direct, name: "Davi Direto", role: "OPERATOR", reportsToId: L.gabriel, ...team(L.gabriel) }),
  ]
  const rows: IndicatorPerformanceRow[] = []
  for (const supervisor of SUPERVISORS) {
    operatorsOf(supervisor.index).forEach((id, index) => {
      people.push(person({ id, name: `Operador ${supervisor.index}.${index + 1}`, role: "OPERATOR", reportsToId: supervisor.id, ...team(supervisor.id) }))
      const achievement = TMA_ACHIEVEMENT[supervisor.index]![index]!
      rows.push(indicatorRow({ personId: id, indicatorCode: "TMA", referencePeriod: "2026-08", value: Math.round(30000 / achievement), targetValue: 300, achievementPercent: achievement, quartile: achievement >= 110 ? "Q1" : achievement >= 100 ? "Q2" : achievement >= 80 ? "Q3" : "Q4" }))
      rows.push(indicatorRow({ personId: id, indicatorCode: "TMA", referencePeriod: "2026-07", value: 300, targetValue: 300, achievementPercent: 100, quartile: "Q2" }))
      if (supervisor.index === 1) rows.push(indicatorRow({ personId: id, indicatorCode: "TMA", referencePeriod: "2026-09", value: 300, targetValue: 300, achievementPercent: 100, quartile: "Q2" }))
    })
  }
  // Davi (direto): sem dado de TMA, só FCR — "sem dado não é desempenho ruim".
  rows.push(indicatorRow({ personId: L.direct, indicatorCode: "FCR", referencePeriod: "2026-08", value: 70, targetValue: 75, achievementPercent: 93.3, quartile: "Q3" }))
  return {
    people,
    definitions: [definition("TMA", "Tempo Médio de Atendimento", "SECONDS", "LOWER"), definition("FCR", "First Call Resolution", "PERCENT", "HIGHER"), definition("TEMPO_META", "Tempo na Meta", "SECONDS", "TARGET")],
    indicatorRows: rows,
    prvRows: [],
    followUps: {},
    pendingReviews: {},
  }
}

export function leaderUser(personId: string, role: AuthTokenPayload["role"]): AuthTokenPayload {
  return { sub: `acc-${personId}`, personId, organizationId: ORG, role, name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
}

export const CLOSURE = { lastClosedPeriod: "2026-09", now: new Date("2026-10-15T12:00:00Z"), timeZone: "America/Sao_Paulo" }
