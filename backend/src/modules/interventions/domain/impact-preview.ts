import { ADDRESSED_STATUSES, OPENING_STATUSES, type ConditionStatus, type DecisionStatus, type EvaluationOutcome } from "./policy-evaluation.js"

/**
 * PRÉVIA DE IMPACTO — o que uma versão da política faria se rodasse AGORA sobre um conjunto de pessoas, somado: quantas caem em
 * cada regra, o que nasceria (por formato), quem receberia (por líder) e quantas ficam sem dado suficiente. É só a soma das
 * avaliações (a mesma função do nó do Workflow e da simulação): nada aqui decide, grava ou avisa.
 *
 * Dado insuficiente é contado à parte, nunca como "caiu na regra". Sugestão de avaliação de continuidade é destacada porque é
 * sempre decisão humana restrita — a prévia mostra quantas seriam SUGERIDAS, nunca um resultado.
 */
export const INTERVENTION_IMPACT_PREVIEW_VERSION = "INTERVENTION_IMPACT_PREVIEW_V1"

export type ImpactDecision = { typeKey: string; typeName: string; status: DecisionStatus; sensitive: boolean; responsible: { personId: string; name: string } | null; problem: string | null }
export type ImpactEvaluation = {
  person: { id: string; name: string; teamName: string | null }
  outcome: EvaluationOutcome
  rules: { key: string; name: string; priority: number; status: ConditionStatus }[]
  selected: { ruleKey: string; mode: "MATCHED" | "INCONCLUSIVE" }[]
  decisions: ImpactDecision[]
}

export type ImpactRuleRow = { key: string; name: string; priority: number; met: number; inconclusive: number; notMet: number; decided: number }
export type ImpactFormatRow = { typeKey: string; typeName: string; sensitive: boolean; created: number; pendingApproval: number; recommended: number; notified: number; existing: number; suppressed: number; conflict: number }
export type ImpactLeaderRow = { personId: string; name: string; opened: number; notified: number }
export type ImpactPersonRow = { id: string; name: string; teamName: string | null; outcome: EvaluationOutcome; rules: string[]; decisions: { typeName: string; status: DecisionStatus }[] }
export type ImpactSummary = {
  evaluated: number
  /**
   * Pessoas (não decisões), cada uma em UMA linha, pelo que aconteceria com ela: `inconclusive` = faltou dado e nada seria
   * feito; `noMatch` = nenhuma regra atendida. `insufficientData` é o total de pessoas em que alguma regra não pôde ser decidida
   * por falta de dado (inclui quem, por isso mesmo, recebe a ação que a regra prevê para dado insuficiente).
   */
  people: { withNewFollowUp: number; onlyNotified: number; alreadyFollowed: number; suppressed: number; inconclusive: number; noMatch: number; conflict: number; notApplicable: number }
  insufficientData: number
  continuitySuggestions: number
  unresolvedRecipients: number
  outcomes: Partial<Record<EvaluationOutcome, number>>
  rules: ImpactRuleRow[]
  formats: ImpactFormatRow[]
  leaders: { distinct: number; top: ImpactLeaderRow[] }
  affected: { total: number; items: ImpactPersonRow[] }
}

export const IMPACT_LEADERS_LIMIT = 15
export const IMPACT_PEOPLE_LIMIT = 100

const opens = (status: DecisionStatus) => OPENING_STATUSES.includes(status)
const FORMAT_FIELD: Record<DecisionStatus, keyof Omit<ImpactFormatRow, "typeKey" | "typeName" | "sensitive">> = { CREATED: "created", PENDING_APPROVAL: "pendingApproval", RECOMMENDED: "recommended", NOTIFIED: "notified", EXISTING: "existing", SUPPRESSED: "suppressed", CONFLICT: "conflict" }

export function summarizeImpact(evaluations: readonly ImpactEvaluation[]): ImpactSummary {
  const people = { withNewFollowUp: 0, onlyNotified: 0, alreadyFollowed: 0, suppressed: 0, inconclusive: 0, noMatch: 0, conflict: 0, notApplicable: 0 }
  const outcomes: Partial<Record<EvaluationOutcome, number>> = {}
  const rules = new Map<string, ImpactRuleRow>()
  const formats = new Map<string, ImpactFormatRow>()
  const leaders = new Map<string, ImpactLeaderRow>()
  const affected: ImpactPersonRow[] = []
  let continuitySuggestions = 0
  let insufficientData = 0
  let unresolvedRecipients = 0

  for (const evaluation of evaluations) {
    outcomes[evaluation.outcome] = (outcomes[evaluation.outcome] ?? 0) + 1
    const statuses = evaluation.decisions.map((decision) => decision.status)
    const lacksData = evaluation.selected.some((item) => item.mode === "INCONCLUSIVE")
    if (lacksData) insufficientData += 1
    if (evaluation.outcome === "NOT_APPLICABLE") people.notApplicable += 1
    else if (statuses.includes("CONFLICT")) people.conflict += 1
    else if (statuses.some(opens)) people.withNewFollowUp += 1
    else if (statuses.includes("NOTIFIED")) people.onlyNotified += 1
    else if (statuses.includes("EXISTING")) people.alreadyFollowed += 1
    else if (statuses.includes("SUPPRESSED")) people.suppressed += 1
    else if (lacksData) people.inconclusive += 1
    else people.noMatch += 1

    const decided = new Set(evaluation.selected.filter((item) => item.mode === "MATCHED").map((item) => item.ruleKey))
    for (const rule of evaluation.rules) {
      const row = rules.get(rule.key) ?? { key: rule.key, name: rule.name, priority: rule.priority, met: 0, inconclusive: 0, notMet: 0, decided: 0 }
      row[rule.status === "MET" ? "met" : rule.status === "INCONCLUSIVE" ? "inconclusive" : "notMet"] += 1
      if (decided.has(rule.key)) row.decided += 1
      rules.set(rule.key, row)
    }
    for (const decision of evaluation.decisions) {
      const row = formats.get(decision.typeKey) ?? { typeKey: decision.typeKey, typeName: decision.typeName, sensitive: decision.sensitive, created: 0, pendingApproval: 0, recommended: 0, notified: 0, existing: 0, suppressed: 0, conflict: 0 }
      row[FORMAT_FIELD[decision.status]] += 1
      formats.set(decision.typeKey, row)
      if (!ADDRESSED_STATUSES.includes(decision.status)) continue
      if (decision.sensitive && opens(decision.status)) continuitySuggestions += 1
      if (decision.problem) unresolvedRecipients += 1
      if (!decision.responsible) continue
      const leader = leaders.get(decision.responsible.personId) ?? { personId: decision.responsible.personId, name: decision.responsible.name, opened: 0, notified: 0 }
      leader[decision.status === "NOTIFIED" ? "notified" : "opened"] += 1
      leaders.set(leader.personId, leader)
    }
    if (evaluation.decisions.length > 0 || lacksData) {
      const names = new Map(evaluation.rules.map((rule) => [rule.key, rule.name]))
      affected.push({ id: evaluation.person.id, name: evaluation.person.name, teamName: evaluation.person.teamName, outcome: evaluation.outcome, rules: evaluation.selected.map((item) => names.get(item.ruleKey) ?? item.ruleKey), decisions: evaluation.decisions.map((decision) => ({ typeName: decision.typeName, status: decision.status })) })
    }
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pt-BR")
  const leaderRows = [...leaders.values()].sort((a, b) => b.opened + b.notified - (a.opened + a.notified) || byName(a, b))
  // Quem teria alguma ação vem primeiro; quem só ficou sem dado, depois (a lista é limitada).
  affected.sort((a, b) => Number(b.decisions.length > 0) - Number(a.decisions.length > 0) || byName(a, b))
  return {
    evaluated: evaluations.length,
    people,
    insufficientData,
    continuitySuggestions,
    unresolvedRecipients,
    outcomes,
    rules: [...rules.values()].sort((a, b) => a.priority - b.priority),
    formats: [...formats.values()].sort((a, b) => byName({ name: a.typeName }, { name: b.typeName })),
    leaders: { distinct: leaderRows.length, top: leaderRows.slice(0, IMPACT_LEADERS_LIMIT) },
    affected: { total: affected.length, items: affected.slice(0, IMPACT_PEOPLE_LIMIT) },
  }
}

/**
 * Diferença para a versão em vigor, por pessoa: "recebe algo" = alguma decisão que abre um acompanhamento ou avisa quem lidera.
 * Só compara quem foi avaliado nas duas versões.
 */
export type ImpactComparison = { compared: number; gained: number; lost: number; kept: number }
export function compareImpact(target: readonly ImpactEvaluation[], baseline: readonly ImpactEvaluation[]): ImpactComparison {
  const acted = (evaluation: ImpactEvaluation) => evaluation.decisions.some((decision) => ADDRESSED_STATUSES.includes(decision.status))
  const before = new Map(baseline.map((evaluation) => [evaluation.person.id, acted(evaluation)]))
  const result = { compared: 0, gained: 0, lost: 0, kept: 0 }
  for (const evaluation of target) {
    const was = before.get(evaluation.person.id)
    if (was === undefined) continue
    result.compared += 1
    const is = acted(evaluation)
    if (is && was) result.kept += 1
    else if (is) result.gained += 1
    else if (was) result.lost += 1
  }
  return result
}
