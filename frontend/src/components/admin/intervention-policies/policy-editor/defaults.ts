import { isConditionGroup, INTERVENTION_POLICY_SCHEMA_VERSION, type IndicatorCriterion, type PolicyAction, type PolicyCondition, type PolicyConditionGroup, type PolicyDefinition, type PolicyRule } from "@/schemas/admin/intervention-policy.schema"
import type { IndicatorWithRules } from "@/schemas/admin/indicator-rule.schema"
import { defaultAggregationFor } from "@/schemas/admin/workflow-graph.schema"

import type { ConditionKind } from "../shared/labels"

/**
 * Valores iniciais do editor de política. Toda regra, condição e ação nasce COMPLETA (números preenchidos, chaves válidas,
 * grupos com pelo menos um item): "Salvar rascunho" sempre passa no formato do backend. O que a publicação exige além disso
 * (tipos publicados, indicador escolhido, diagnóstico para treinamento…) aparece como pendência da publicação.
 */
export const MAX_RULES = 20
export const MAX_ACTIONS = 5
export const MAX_INCONCLUSIVE_ACTIONS = 3
export const MAX_GROUP_DEPTH = 3
export const MAX_GROUP_ITEMS = 12
export const MAX_CONDITIONS_PER_RULE = 30
export const DEFAULT_JUSTIFICATION = "Justificativa a definir."

export type FlagOption = { channel: string; flagName: string; valueType: "BOOLEAN" | "NUMERIC" }
export type ConditionContext = { policyIndicatorCode: string | null; indicator?: IndicatorWithRules | undefined; flag?: FlagOption | undefined }

/** Histórico do indicador: medição diária, agregação natural do indicador, últimos 30 dias, comparada à meta vigente. */
export function defaultHistoricalCriterion(indicatorCode: string | null, indicator?: IndicatorWithRules): IndicatorCriterion {
  return {
    comparator: "LT",
    thresholdNumeric: null,
    historicalQuery: {
      kind: "INDICATOR_THRESHOLD_COUNT",
      ...(indicatorCode ? { indicatorCode } : {}),
      source: "MEASUREMENT",
      aggregation: defaultAggregationFor(indicator?.operationalAggregation),
      period: { kind: "ROLLING_DAYS", days: 30 },
      ...(indicator?.minimumSampleSize ? { minimumSampleSize: indicator.minimumSampleSize } : {}),
      ...(indicator?.minimumCoverage ? { minimumCoverage: indicator.minimumCoverage } : {}),
      compareTo: { kind: "GOAL" },
    },
  }
}

/** Resultado oficial do fechamento: atingimento do indicador abaixo de 100%. */
export function defaultPerformanceCriterion(indicatorCode: string | null): IndicatorCriterion {
  return { comparator: "LT", thresholdNumeric: 100, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_ACHIEVEMENT", ...(indicatorCode ? { indicatorCode } : {}) } }
}

export function defaultCondition(kind: ConditionKind, context: ConditionContext): PolicyCondition {
  switch (kind) {
    case "INDICATOR":
      return { kind: "INDICATOR", criterion: defaultHistoricalCriterion(context.policyIndicatorCode, context.indicator) }
    case "EMPLOYMENT":
      return { kind: "EMPLOYMENT", check: "CURRENTLY_ELIGIBLE", expected: true }
    case "PRIOR_INTERVENTIONS":
      return { kind: "PRIOR_INTERVENTIONS", typeKeys: [], statuses: ["COMPLETED"], operationalResults: [], sameSubject: true, withinDays: 90, comparator: "GTE", threshold: 1 }
    case "TIME_SINCE_INTERVENTION":
      return { kind: "TIME_SINCE_INTERVENTION", typeKeys: [], event: "OPENED", sameSubject: true, comparator: "GTE", days: 30, whenNone: "MET" }
    case "SUPPORTED_DIAGNOSIS":
      return { kind: "SUPPORTED_DIAGNOSIS", indicatorCode: null, competencyKeys: [], withinDays: 60, expectation: "EXISTS" }
    case "PUBLISHED_FEEDBACK":
      return { kind: "PUBLISHED_FEEDBACK", feedbackKind: null, indicatorCode: null, withinDays: 30, comparator: "GTE", threshold: 1 }
    case "INTERACTION_FLAG":
      return defaultFlagCondition(context.flag)
  }
}

/** Flag de atendimento: a primeira flag ativa do catálogo, contando atendimentos nos últimos 30 dias. */
export function defaultFlagCondition(flag: FlagOption | undefined): Extract<PolicyCondition, { kind: "INTERACTION_FLAG" }> {
  return {
    kind: "INTERACTION_FLAG",
    channel: flag?.channel ?? "VOICE",
    flagName: flag?.flagName ?? "",
    match: flag?.valueType === "NUMERIC" ? { type: "NUMERIC", comparator: "LTE", threshold: 2 } : { type: "BOOLEAN", value: true },
    withinDays: 30,
    measure: "COUNT",
    comparator: "GTE",
    threshold: 3,
    minimumInteractions: 1,
  }
}

export function defaultGroup(context: ConditionContext): PolicyConditionGroup {
  return { operator: "ALL", items: [defaultCondition("INDICATOR", context)] }
}

export function defaultAction(typeKey: string): PolicyAction {
  return { typeKey, effect: "RECOMMEND", dueInDays: null, onActive: "KEEP", cooldownDays: 30 }
}

export function nextRuleKey(rules: PolicyRule[]): string {
  const taken = new Set(rules.map((rule) => rule.key))
  let index = rules.length + 1
  while (taken.has(`REGRA_${index}`)) index += 1
  return `REGRA_${index}`
}

export const nextPriority = (rules: PolicyRule[]) => Math.min(999, Math.max(0, ...rules.map((rule) => rule.priority)) + 1)

export function newRule(rules: PolicyRule[], context: ConditionContext, defaultTypeKey: string | null): PolicyRule {
  const key = nextRuleKey(rules)
  return {
    key,
    name: `Regra ${key.replace("REGRA_", "")}`,
    priority: nextPriority(rules),
    justification: DEFAULT_JUSTIFICATION,
    when: defaultGroup(context),
    actions: defaultTypeKey ? [defaultAction(defaultTypeKey)] : [],
    inconclusiveActions: [],
  }
}

/** Move a regra e renumera TODAS as prioridades na ordem da lista (1 = maior), sem empate. */
export function moveRule(rules: PolicyRule[], index: number, delta: -1 | 1): PolicyRule[] {
  const target = index + delta
  if (target < 0 || target >= rules.length) return rules
  const next = [...rules]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved!)
  return renumber(next)
}

export const renumber = (rules: PolicyRule[]) => rules.map((rule, index) => ({ ...rule, priority: index + 1 }))

export function duplicatedPriorities(rules: PolicyRule[]): Set<number> {
  const seen = new Map<number, number>()
  for (const rule of rules) seen.set(rule.priority, (seen.get(rule.priority) ?? 0) + 1)
  return new Set([...seen].filter(([, count]) => count > 1).map(([priority]) => priority))
}

export function countConditions(group: PolicyConditionGroup): number {
  return group.items.reduce((total, item) => total + (isConditionGroup(item) ? countConditions(item) : 1), 0)
}

/** Espelho de `groupRequires` do backend: a condição é obrigatória para a regra bater (caminho só de ALL ou todos os ramos de ANY)? */
export function groupRequires(group: PolicyConditionGroup, predicate: (condition: PolicyCondition) => boolean): boolean {
  const required = (item: PolicyCondition | PolicyConditionGroup): boolean => (isConditionGroup(item) ? groupRequires(item, predicate) : predicate(item))
  return group.operator === "ALL" ? group.items.some(required) : group.items.every(required)
}
export const requiresSupportedDiagnosis = (group: PolicyConditionGroup) => groupRequires(group, (condition) => condition.kind === "SUPPORTED_DIAGNOSIS" && condition.expectation === "EXISTS")

/** Remove o que o contrato não aceita vazio (código de indicador em branco, rótulo vazio) antes de enviar. */
export function sanitizeDefinition(definition: PolicyDefinition): PolicyDefinition {
  const cleanItem = (item: PolicyCondition | PolicyConditionGroup): PolicyCondition | PolicyConditionGroup => {
    if (isConditionGroup(item)) return { operator: item.operator, items: item.items.map(cleanItem) }
    if (item.kind !== "INDICATOR") return item
    const { label, criterion } = item
    const historical = criterion.historicalQuery ? { ...criterion.historicalQuery } : undefined
    if (historical && !historical.indicatorCode) delete historical.indicatorCode
    const performance = criterion.performanceQuery ? { ...criterion.performanceQuery } : undefined
    if (performance && !performance.indicatorCode) delete performance.indicatorCode
    return { kind: "INDICATOR", ...(label && label.trim() ? { label: label.trim() } : {}), criterion: { ...criterion, ...(historical ? { historicalQuery: historical } : {}), ...(performance ? { performanceQuery: performance } : {}) } }
  }
  return {
    ...definition,
    schemaVersion: INTERVENTION_POLICY_SCHEMA_VERSION,
    rules: definition.rules.map((rule) => ({ ...rule, when: cleanItem(rule.when) as PolicyConditionGroup })),
  }
}
