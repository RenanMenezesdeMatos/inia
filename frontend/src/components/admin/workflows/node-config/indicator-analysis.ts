import { QUARTILE_VALUES } from "@/schemas/admin/employee-performance.schema"
import type { FlowNode, HistoricalAggregation, HistoricalPeriod } from "@/schemas/admin/workflow-graph.schema"

// "O que deseja analisar?" — a pergunta central de um Indicador/PRV (Parte 1-11 do pedido).
// Deriva-se do config atual (nunca é um campo próprio, só a forma de historicalQuery/
// performanceQuery já salva) — LEGACY_PERFORMANCE existe só pra Conditions salvas antes desta
// reorganização (Valor/Atingimento/Peso via performanceQuery, sem período), nunca oferecida como
// destino de uma Condition nova.
export type IndicatorAnalysisKind = "VALUE" | "ACHIEVEMENT" | "PRV_ACHIEVEMENT" | "QUARTILE" | "OPERATIONAL_QUARTILE" | "PRV_QUARTILE" | "LEGACY_PERFORMANCE"

export function indicatorAnalysisKindOf(config: Extract<FlowNode, { type: "condition" }>["config"]): IndicatorAnalysisKind {
  if (config.performanceQuery) {
    const metric = config.performanceQuery.metric
    if (metric === "INDICATOR_QUARTILE") return "QUARTILE"
    if (metric === "PRV_QUARTILE") return "PRV_QUARTILE"
    return "LEGACY_PERFORMANCE"
  }
  const source = config.historicalQuery?.source
  if (source === "PRV_ACHIEVEMENT") return "PRV_ACHIEVEMENT"
  if (source === "INDICATOR_ACHIEVEMENT") return "ACHIEVEMENT"
  if (source === "OPERATIONAL_QUARTILE") return "OPERATIONAL_QUARTILE"
  return "VALUE"
}

// "Quartil do indicador" = OFICIAL (fechamento mensal, lido da fonte) × "Quartil operacional" =
// posição relativa na população sobre medições de uma janela de dias — dois conceitos, dois
// rótulos, nunca o mesmo nome.
const INDICATOR_ANALYSIS_LABELS: Record<IndicatorAnalysisKind, string> = {
  VALUE: "Valor do indicador",
  ACHIEVEMENT: "Atingimento do indicador",
  PRV_ACHIEVEMENT: "Atingimento consolidado do PRV",
  QUARTILE: "Quartil do indicador (fechamento oficial)",
  OPERATIONAL_QUARTILE: "Quartil operacional (janela de dias)",
  PRV_QUARTILE: "Quartil do PRV",
  LEGACY_PERFORMANCE: "Mais recente (formato anterior)",
}

/** "Atingimento consolidado do PRV" só é correto em modo Individual — é o PRV do PRÓPRIO
 * colaborador, que já é uma consolidação dos indicadores dele. Numa estrutura (Consolidado), o
 * rótulo vira "...da estrutura": deixa claro que é uma média calculada pela engine sobre os
 * PRVs/atingimentos individuais dos membros, nunca um valor oficial da estrutura (que não existe
 * na fonte hoje — Parte 6 do pedido de Meta/Fechamentos). */
export function indicatorAnalysisLabel(kind: IndicatorAnalysisKind, evaluationMode?: "INDIVIDUAL" | "CONSOLIDATED"): string {
  if (evaluationMode === "CONSOLIDATED") {
    if (kind === "PRV_ACHIEVEMENT") return "Atingimento do PRV da estrutura"
    if (kind === "ACHIEVEMENT") return "Atingimento do indicador da estrutura"
  }
  return INDICATOR_ANALYSIS_LABELS[kind]
}

// Atingimento/PRV são percentuais oficiais já prontos: só Média/Mínimo/Máximo entre fechamentos.
// Quantidade de ocorrências e as agregações da camada operacional (média ponderada, soma, último
// valor) só existem pra Valor do indicador — mesmas regras da publicação no backend.
const OFFICIAL_AGGREGATIONS: ReadonlySet<HistoricalAggregation> = new Set<HistoricalAggregation>(["AVERAGE", "MINIMUM", "MAXIMUM"])
const OFFICIAL_DEFAULT_PERIOD: HistoricalPeriod = { kind: "ROLLING_DAYS", days: 30 }

function isOperationalPeriod(period: HistoricalPeriod | undefined): boolean {
  if (!period) return false
  if (period.kind === "ROLLING_DAYS") return period.days < 28
  return period.kind === "CALENDAR" && (period.unit === "DAY" || period.unit === "WEEK")
}

/** Default "fresco" de cada kind — usado quando não há nada compatível pra reaproveitar do
 * estado anterior (ex.: vindo de Quartil/Mais recente, que não têm historicalQuery nenhum).
 * Mesmos valores que `buildIndicatorAnalysisConfig` sempre usou, nunca uma regra nova. */
function freshHistoricalConfig(kind: "VALUE" | "ACHIEVEMENT" | "PRV_ACHIEVEMENT", indicatorCode: string): Extract<FlowNode, { type: "condition" }>["config"] {
  if (kind === "VALUE") {
    return {
      comparator: "GTE",
      thresholdNumeric: 1,
      thresholdBoolean: null,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode, aggregation: "COUNT", comparator: "LT", indicatorThreshold: 0, period: { kind: "ROLLING_DAYS", days: 7 } },
    }
  }
  return {
    comparator: "LT",
    thresholdNumeric: null,
    thresholdBoolean: null,
    historicalQuery: {
      kind: "INDICATOR_THRESHOLD_COUNT",
      // undefined, nunca "" — o schema (historicalQuerySchema.indicatorCode) exige min(1) quando
      // presente; PRV precisa do campo AUSENTE, não de uma string vazia (que falharia o parse).
      indicatorCode: kind === "PRV_ACHIEVEMENT" ? undefined : indicatorCode,
      aggregation: "AVERAGE",
      source: kind === "PRV_ACHIEVEMENT" ? "PRV_ACHIEVEMENT" : "INDICATOR_ACHIEVEMENT",
      period: { kind: "ROLLING_DAYS", days: 30 },
    },
  }
}

/**
 * Troca entre Valor/Atingimento do indicador/Atingimento do PRV (as 3 origens de
 * `historicalQuery`) — revalida os campos dependentes em vez de reconstruir do zero (correção
 * pontual de UX/validação: antes, QUALQUER troca de "O que deseja analisar?" apagava período,
 * agregação, comparação e mínimo de medições já configurados, mesmo entre origens plenamente
 * compatíveis).
 *
 * `period` é a MESMA estrutura pras 3 origens — inclusive "Últimos N fechamentos"
 * (`{kind:"CLOSURES", count}`): o rótulo exibido ("Últimos N meses fechados" pra Valor x
 * "Últimos N fechamentos mensais" pra Atingimento/PRV) já é 100% derivado da origem em tempo de
 * renderização (ver HistoricalPeriodPicker/describePeriod) — reaproveitar o objeto tal como está
 * PRESERVA a quantidade (count/days) e AUTOMATICAMENTE atualiza o rótulo, sem nenhuma conversão
 * (nunca "3 fechamentos" virando "90 dias" ou vice-versa).
 *
 * Exceção: uma janela operacional (dias < 28, Hoje/Ontem/semana) não existe pra Atingimento/PRV
 * (fonte oficial, só por fechamento mensal) — nesse caso o período cai no default "fresco" (30 dias).
 *
 * `aggregation` só precisa mudar quando incompatível: Quantidade de ocorrências (COUNT) e as
 * agregações operacionais (média ponderada, soma, último valor) só existem pra Valor bruto —
 * trocando para Atingimento/PRV com uma delas selecionada, a análise não sobrevive. Nesse caso
 * (o único reset de agregação desta função) cai pra Média, o mesmo default "fresco" que
 * esta função já usa pra uma troca sem nada prévio — não é uma regra nova, é o mesmo padrão
 * oficial já usado pela aplicação. `comparator`/`thresholdNumeric` externos (que no modo COUNT
 * significam "contagem ≥ N", uma unidade completamente diferente de "valor agregado < X") são
 * resetados junto — mesmo reset que HistoricalConditionForm.setAggregation já faz quando o
 * próprio admin troca a agregação manualmente. Média/Mínimo/Máximo são válidas pras 3 origens
 * igualmente, então nunca precisam mudar.
 */
function buildHistoricalAnalysisConfig(
  kind: "VALUE" | "ACHIEVEMENT" | "PRV_ACHIEVEMENT",
  current: Extract<FlowNode, { type: "condition" }>["config"],
  currentIndicatorCode: string,
): Extract<FlowNode, { type: "condition" }>["config"] {
  const previous = current.historicalQuery
  if (!previous) return freshHistoricalConfig(kind, currentIndicatorCode)

  // undefined, nunca "" — mesmo motivo de freshHistoricalConfig acima: o schema exige min(1)
  // quando o campo está presente, então PRV precisa do campo AUSENTE.
  const indicatorCode = kind === "PRV_ACHIEVEMENT" ? undefined : (previous.indicatorCode || currentIndicatorCode)
  const source = kind === "VALUE" ? undefined : kind === "PRV_ACHIEVEMENT" ? "PRV_ACHIEVEMENT" : "INDICATOR_ACHIEVEMENT"
  const previousAggregation: HistoricalAggregation = previous.aggregation ?? "COUNT"
  const aggregationCompatible = kind === "VALUE" || OFFICIAL_AGGREGATIONS.has(previousAggregation)
  const aggregation: HistoricalAggregation = aggregationCompatible ? previousAggregation : "AVERAGE"
  // Fonte oficial só existe por fechamento mensal (mesma regra da publicação no backend): uma
  // janela operacional (dias < 28, Hoje/Ontem/semana) vinda do Valor do indicador não tem
  // significado pra Atingimento/PRV e cai no mesmo período "fresco" de freshHistoricalConfig.
  const period = kind !== "VALUE" && isOperationalPeriod(previous.period) ? OFFICIAL_DEFAULT_PERIOD : previous.period

  if (aggregation === "COUNT") {
    // Só alcançável quando compatível (kind VALUE, já era COUNT) — os campos de Quantidade
    // nunca precisam de reset, período/comparator/threshold preservados tal como estavam.
    return {
      comparator: current.comparator,
      thresholdNumeric: current.thresholdNumeric,
      thresholdBoolean: null,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode,
        aggregation: "COUNT",
        comparator: previous.comparator ?? "LT",
        indicatorThreshold: previous.indicatorThreshold ?? 0,
        period,
        windowDays: period ? undefined : previous.windowDays,
      },
    }
  }

  const aggregationChanged = aggregation !== previousAggregation
  // Meta vigente (compareTo GOAL) é referência do VALOR DO INDICADOR — Atingimento (indicador
  // ou PRV) já representa a relação do resultado com a meta, nunca reoferecida como referência.
  // Trocando pra uma origem que não suporta, o campo é LIMPO (não escolhe uma nova referência
  // sozinho — "Valor fixo" com thresholdNumeric vazio exige nova escolha do admin, nunca inventa
  // a intenção dele).
  const goalCompatible = kind === "VALUE" || previous.compareTo?.kind !== "GOAL"
  return {
    comparator: aggregationChanged ? "LT" : current.comparator,
    thresholdNumeric: aggregationChanged ? null : current.thresholdNumeric,
    thresholdBoolean: null,
    historicalQuery: {
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode,
      aggregation,
      source,
      period,
      windowDays: period ? undefined : previous.windowDays,
      minimumSampleSize: previous.minimumSampleSize,
      compareTo: goalCompatible ? previous.compareTo : undefined,
    },
  }
}

/**
 * Troca entre Quartil do indicador/Quartil do PRV — mesma ideia de `buildHistoricalAnalysisConfig`:
 * `recurrence` (Recorrência de N fechamentos + quartil-alvo) tem exatamente a mesma forma nas
 * duas origens (só o indicador muda — PRV não tem um), então é sempre reaproveitável. Vindo de
 * fora da família Quartil (Valor/Atingimento/Mais recente), não há `recurrence`/quartil-alvo
 * nenhum pra herdar — mesmo default "fresco" de sempre (Q4, fechamento mais recente).
 */
function buildQuartileAnalysisConfig(
  kind: "QUARTILE" | "PRV_QUARTILE",
  current: Extract<FlowNode, { type: "condition" }>["config"],
  currentIndicatorCode: string,
): Extract<FlowNode, { type: "condition" }>["config"] {
  const metric = kind === "PRV_QUARTILE" ? "PRV_QUARTILE" : "INDICATOR_QUARTILE"
  const indicatorCode = kind === "PRV_QUARTILE" ? undefined : currentIndicatorCode
  const previous = current.performanceQuery
  const previousWasQuartile = previous?.metric === "INDICATOR_QUARTILE" || previous?.metric === "PRV_QUARTILE"

  if (!previousWasQuartile) {
    return { comparator: "EQUALS", thresholdNumeric: null, thresholdText: "Q4", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric, indicatorCode } }
  }
  return {
    comparator: current.comparator,
    thresholdNumeric: current.thresholdNumeric,
    thresholdText: current.thresholdText,
    performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric, indicatorCode, recurrence: previous.recurrence },
  }
}

/**
 * Quartil operacional: herda indicador, janela (nunca "fechamentos" — o quartil operacional é
 * sobre medições diárias), agregação de valor (nunca COUNT) e cobertura mínima do estado
 * anterior; comparação sempre "É igual a"/"É diferente de" + Q1..Q4 (default Q4, o mesmo do
 * quartil oficial).
 */
function buildOperationalQuartileConfig(current: Extract<FlowNode, { type: "condition" }>["config"], currentIndicatorCode: string): Extract<FlowNode, { type: "condition" }>["config"] {
  const previous = current.historicalQuery
  const previousPeriod = previous?.period && previous.period.kind !== "CLOSURES" ? previous.period : undefined
  const previousAggregation = previous?.aggregation && previous.aggregation !== "COUNT" ? previous.aggregation : undefined
  const previousQuartile = (QUARTILE_VALUES as string[]).includes(current.thresholdText ?? "") ? current.thresholdText : undefined
  return {
    comparator: current.comparator === "NOT_EQUALS" ? "NOT_EQUALS" : "EQUALS",
    thresholdNumeric: null,
    thresholdBoolean: null,
    thresholdText: previousQuartile ?? "Q4",
    historicalQuery: {
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: previous?.indicatorCode || currentIndicatorCode || undefined,
      aggregation: previousAggregation ?? "WEIGHTED_AVERAGE",
      source: "OPERATIONAL_QUARTILE",
      period: previousPeriod ?? { kind: "ROLLING_DAYS", days: 7 },
      minimumCoverage: previous?.minimumCoverage,
    },
  }
}

export function buildIndicatorAnalysisConfig(
  kind: IndicatorAnalysisKind,
  current: Extract<FlowNode, { type: "condition" }>["config"],
): Extract<FlowNode, { type: "condition" }>["config"] {
  const currentIndicatorCode = current.historicalQuery?.indicatorCode ?? current.performanceQuery?.indicatorCode ?? ""
  switch (kind) {
    case "VALUE":
    case "ACHIEVEMENT":
    case "PRV_ACHIEVEMENT":
      return buildHistoricalAnalysisConfig(kind, current, currentIndicatorCode)
    case "OPERATIONAL_QUARTILE":
      return buildOperationalQuartileConfig(current, currentIndicatorCode)
    case "QUARTILE":
    case "PRV_QUARTILE":
      return buildQuartileAnalysisConfig(kind, current, currentIndicatorCode)
    case "LEGACY_PERFORMANCE":
      return { comparator: "LT", thresholdNumeric: 0, thresholdBoolean: null, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_ACHIEVEMENT", indicatorCode: currentIndicatorCode } }
  }
}
