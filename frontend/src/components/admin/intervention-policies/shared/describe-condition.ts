import { isConditionGroup, NUMERIC_COMPARATOR_LABELS, type HistoricalPeriod, type NumericComparator, type PolicyCondition, type PolicyConditionGroup } from "@/schemas/admin/intervention-policy.schema"

/**
 * A condição de uma regra DITA EM FRASE — para quem abre a política entender o "quando" sem ler os campos do editor. Pura: só
 * traduz o que está configurado (nada é avaliado aqui) e nunca mostra chave ou código cru quando há nome no catálogo.
 * O rótulo que o administrador escreveu para uma condição de indicador vence a frase gerada.
 */
export type DescribeContext = {
  /** Indicador principal da política (o assunto), usado quando a condição não escolhe outro. */
  policyIndicatorCode: string | null
  indicatorName: (code: string) => string
  typeName: (key: string) => string
  competencyName?: (key: string) => string
}

const comparator = (value: string) => NUMERIC_COMPARATOR_LABELS[value as NumericComparator] ?? value
const number = (value: number | null | undefined) => (value === null || value === undefined ? "—" : value.toLocaleString("pt-BR"))
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)
const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ou ${items.at(-1)}`)

const CALENDAR_UNIT: Record<string, string> = { DAY: "dia", WEEK: "semana", MONTH: "mês", TWO_MONTHS: "bimestre", QUARTER: "trimestre", FOUR_MONTHS: "quadrimestre", SEMESTER: "semestre" }
function period(value: HistoricalPeriod | undefined): string {
  if (!value) return "no período"
  if (value.kind === "ROLLING_DAYS") return `nos últimos ${value.days} dias`
  if (value.kind === "CLOSURES") return `nos últimos ${value.count} ${plural(value.count, "fechamento", "fechamentos")}`
  return `${value.phase === "CURRENT" ? "neste" : "no último"} ${CALENDAR_UNIT[value.unit] ?? "período"}`
}

const METRIC: Record<string, string> = { INDICATOR_VALUE: "resultado oficial", INDICATOR_ACHIEVEMENT: "atingimento oficial", INDICATOR_QUARTILE: "quartil oficial", INDICATOR_WEIGHT: "peso oficial", PRV_ACHIEVEMENT: "atingimento oficial do PRV", PRV_QUARTILE: "quartil oficial do PRV" }
const SOURCE: Record<string, string> = { MEASUREMENT: "medição diária", INDICATOR_ACHIEVEMENT: "atingimento oficial", PRV_ACHIEVEMENT: "atingimento oficial do PRV", OPERATIONAL_QUARTILE: "quartil operacional" }
const QUARTILE: Record<string, string> = { Q1: "melhor quartil (Q1)", Q2: "quartil Q2", Q3: "quartil Q3", Q4: "pior quartil (Q4)" }
const RESULT: Record<string, string> = { IMPROVED: "melhorou", UNCHANGED: "não mudou", WORSENED: "piorou", NOT_MEASURED: "não medido" }
const STATUS: Record<string, string> = { ACTIVE: "em andamento", COMPLETED: "concluída", CANCELLED: "cancelada" }

function indicator(condition: Extract<PolicyCondition, { kind: "INDICATOR" }>, context: DescribeContext): string {
  if (condition.label?.trim()) return condition.label.trim()
  const { criterion } = condition
  const performance = criterion.performanceQuery
  const historical = criterion.historicalQuery
  const code = performance?.indicatorCode ?? historical?.indicatorCode ?? context.policyIndicatorCode
  const prv = performance?.metric.startsWith("PRV_") || historical?.source === "PRV_ACHIEVEMENT"
  const name = prv ? "PRV" : code ? context.indicatorName(code) : "o indicador"
  if (performance) {
    if (performance.recurrence) return `${name} ficou no ${QUARTILE[performance.recurrence.matchQuartile]} em ${comparator(criterion.comparator)} ${number(criterion.thresholdNumeric)} dos últimos ${performance.recurrence.periods} fechamentos`
    if (performance.metric.endsWith("_QUARTILE")) return `${name} ficou ${criterion.comparator === "NOT_EQUALS" ? "fora do" : "no"} ${QUARTILE[criterion.thresholdText ?? ""] ?? "quartil escolhido"} no último fechamento`
    const percent = performance.metric.endsWith("_ACHIEVEMENT") ? "%" : ""
    return `${METRIC[performance.metric] ?? "resultado"} de ${name} ficou ${comparator(criterion.comparator)} ${number(criterion.thresholdNumeric)}${percent} no último fechamento`
  }
  if (historical) {
    const source = SOURCE[historical.source ?? "MEASUREMENT"] ?? "medição"
    const when = period(historical.period)
    if ((historical.aggregation ?? "COUNT") === "COUNT") {
      return `${name} teve ${comparator(criterion.comparator)} ${number(criterion.thresholdNumeric)} ${plural(criterion.thresholdNumeric ?? 0, "medição", "medições")} com valor ${comparator(historical.comparator ?? "")} ${number(historical.indicatorThreshold)} ${when} (${source})`
    }
    const reference = historical.compareTo?.kind === "GOAL" ? "a meta vigente" : historical.compareTo?.kind === "PREVIOUS_PERIOD" ? (historical.compareTo.changeMode === "PERCENT" ? `${number(criterion.thresholdNumeric)}% de variação sobre o período anterior` : "o período anterior") : number(criterion.thresholdNumeric)
    return `${name} (${source}) ficou ${comparator(criterion.comparator)} ${reference} ${when}`
  }
  return `${name}: condição de indicador incompleta`
}

export function describeCondition(condition: PolicyCondition, context: DescribeContext): string {
  const subject = (code: string | null) => (code ?? context.policyIndicatorCode ? context.indicatorName((code ?? context.policyIndicatorCode)!) : null)
  const types = (keys: string[], any = "qualquer intervenção") => (keys.length === 0 ? any : list(keys.map((key) => `“${context.typeName(key)}”`)))
  switch (condition.kind) {
    case "INDICATOR":
      return indicator(condition, context)
    case "EVOLUTION": {
      const name = subject(condition.indicatorCode) ?? "o indicador"
      const minimum = condition.minimumImprovementPercent > 0 ? `pelo menos ${number(condition.minimumImprovementPercent)}%` : "nada"
      return condition.expectation === "NOT_IMPROVED"
        ? `${name} não melhorou ${minimum} desde o último feedback (publicado nos últimos ${condition.withinDays} dias)`
        : `${name} melhorou ${condition.minimumImprovementPercent > 0 ? minimum : "(qualquer melhora)"} desde o último feedback (publicado nos últimos ${condition.withinDays} dias)`
    }
    case "EMPLOYMENT":
      return condition.check === "CURRENTLY_ELIGIBLE" ? (condition.expected ? "está em produção hoje" : "não está em produção hoje") : `${comparator(condition.comparator)} ${condition.threshold} ${plural(condition.threshold, "dia elegível", "dias elegíveis")} ${period(condition.period)}`
    case "PRIOR_INTERVENTIONS": {
      const results = condition.operationalResults.length > 0 ? ` com resultado ${list(condition.operationalResults.map((result) => `“${RESULT[result]}”`))}` : ""
      const statuses = list(condition.statuses.map((status) => STATUS[status]!))
      return `teve ${comparator(condition.comparator)} ${condition.threshold} ${types(condition.typeKeys, plural(condition.threshold, "intervenção", "intervenções"))} ${statuses}${results} nos últimos ${condition.withinDays} dias${condition.sameSubject ? ", sobre o mesmo assunto" : ""}`
    }
    case "TIME_SINCE_INTERVENTION":
      return `${comparator(condition.comparator)} ${condition.days} dias desde ${condition.event === "OPENED" ? "a abertura" : "a conclusão"} de ${types(condition.typeKeys)}${condition.sameSubject ? " sobre o mesmo assunto" : ""} (${condition.whenNone === "MET" ? "vale também para quem nunca teve" : "não vale para quem nunca teve"})`
    case "SUPPORTED_DIAGNOSIS": {
      const about = subject(condition.indicatorCode)
      const competencies = condition.competencyKeys.length > 0 ? ` que aponta ${list(condition.competencyKeys.map((key) => `“${context.competencyName?.(key) ?? key}”`))}` : ""
      return `${condition.expectation === "EXISTS" ? "tem" : "não tem"} diagnóstico sustentado${about ? ` de ${about}` : ""}${competencies} nos últimos ${condition.withinDays} dias`
    }
    case "PUBLISHED_FEEDBACK": {
      const kind = condition.feedbackKind === "INDICATOR" ? " de indicador" : condition.feedbackKind === "MONITORING" ? " de monitoria" : ""
      const about = condition.indicatorCode ? ` sobre ${context.indicatorName(condition.indicatorCode)}` : ""
      return `recebeu ${comparator(condition.comparator)} ${condition.threshold} ${plural(condition.threshold, "feedback", "feedbacks")}${kind}${about} nos últimos ${condition.withinDays} dias`
    }
    case "INTERACTION_FLAG": {
      const value = condition.match.type === "BOOLEAN" ? (condition.match.value ? "" : " = não") : ` ${comparator(condition.match.comparator)} ${number(condition.match.threshold)}`
      const measure = condition.measure === "PERCENT" ? `${number(condition.threshold)}% dos atendimentos` : `${number(condition.threshold)} ${plural(condition.threshold, "atendimento", "atendimentos")}`
      return `teve a flag “${condition.flagName}”${value} em ${comparator(condition.comparator)} ${measure} nos últimos ${condition.withinDays} dias`
    }
  }
}

/** O "quando" inteiro da regra numa frase: condições ligadas por "e" / "ou", com parênteses nos grupos aninhados. */
export function describeWhen(group: PolicyConditionGroup, context: DescribeContext, nested = false): string {
  const parts = group.items.map((item) => (isConditionGroup(item) ? describeWhen(item, context, true) : describeCondition(item, context)))
  const text = parts.join(group.operator === "ALL" ? " e " : " ou ")
  return nested && parts.length > 1 ? `(${text})` : text
}
