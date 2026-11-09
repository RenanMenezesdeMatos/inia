import { Bot, ClipboardCheck, Clock, Flag, GitBranch, GitMerge, Play, Send, ShieldCheck, Split, UsersRound, Zap, type LucideIcon } from "lucide-react"
import {
  COMPARATOR_LABELS,
  ESCALATION_ROLE_LABELS,
  HISTORICAL_AGGREGATION_LABELS,
  NODE_TYPE_LABELS,
  OUTPUT_SURFACE_LABELS,
  OUTPUT_TARGET_LABELS,
  PERFORMANCE_METRIC_LABELS,
  PERIOD_WINDOW_LABELS,
  FEEDBACK_DOMAIN_LABELS,
  type CalendarUnit,
  type Comparator,
  type ConditionRule,
  type EmployeeRankingConfig,
  type EmployeeRankingPartitionBy,
  type EmployeeRankingSelection,
  type FlowNode,
  type FlowNodeType,
  type HistoricalPeriod,
  type HistoricalQuery,
  type HistoricalSource,
  type PerformanceQuery,
} from "@/schemas/admin/workflow-graph.schema"
import { decodeSourcePath, decodeStructuredFieldPath } from "./content-sources"
import type { WorkflowVariableType } from "@/schemas/admin/workflow-variable.schema"

export const NODE_ICONS: Record<FlowNodeType, LucideIcon> = {
  trigger: Play,
  wait: Clock,
  condition: GitBranch,
  select_employees: UsersRound,
  apply_individually: Split,
  consolidate_results: GitMerge,
  action: Zap,
  orchestrator: Bot,
  human_review: ShieldCheck,
  output: Send,
  intervention_policy: ClipboardCheck,
  end: Flag,
}

export const NODE_COLORS: Record<FlowNodeType, { icon: string; iconBg: string; ring: string }> = {
  trigger: { icon: "text-sky-600 dark:text-sky-300", iconBg: "bg-sky-100 dark:bg-sky-950", ring: "border-sky-400 ring-sky-400/30" },
  wait: { icon: "text-amber-600 dark:text-amber-300", iconBg: "bg-amber-100 dark:bg-amber-950", ring: "border-amber-400 ring-amber-400/30" },
  condition: {
    icon: "text-violet-600 dark:text-violet-300",
    iconBg: "bg-violet-100 dark:bg-violet-950",
    ring: "border-violet-400 ring-violet-400/30",
  },
  select_employees: {
    icon: "text-teal-600 dark:text-teal-300",
    iconBg: "bg-teal-100 dark:bg-teal-950",
    ring: "border-teal-400 ring-teal-400/30",
  },
  apply_individually: {
    icon: "text-orange-600 dark:text-orange-300",
    iconBg: "bg-orange-100 dark:bg-orange-950",
    ring: "border-orange-400 ring-orange-400/30",
  },
  consolidate_results: {
    icon: "text-cyan-600 dark:text-cyan-300",
    iconBg: "bg-cyan-100 dark:bg-cyan-950",
    ring: "border-cyan-400 ring-cyan-400/30",
  },
  action: {
    icon: "text-fuchsia-600 dark:text-fuchsia-300",
    iconBg: "bg-fuchsia-100 dark:bg-fuchsia-950",
    ring: "border-fuchsia-400 ring-fuchsia-400/30",
  },
  orchestrator: {
    icon: "text-indigo-600 dark:text-indigo-300",
    iconBg: "bg-indigo-100 dark:bg-indigo-950",
    ring: "border-indigo-400 ring-indigo-400/30",
  },
  human_review: {
    icon: "text-rose-600 dark:text-rose-300",
    iconBg: "bg-rose-100 dark:bg-rose-950",
    ring: "border-rose-400 ring-rose-400/30",
  },
  output: {
    icon: "text-emerald-600 dark:text-emerald-300",
    iconBg: "bg-emerald-100 dark:bg-emerald-950",
    ring: "border-emerald-400 ring-emerald-400/30",
  },
  intervention_policy: {
    icon: "text-lime-700 dark:text-lime-300",
    iconBg: "bg-lime-100 dark:bg-lime-950",
    ring: "border-lime-500 ring-lime-500/30",
  },
  end: { icon: "text-slate-600 dark:text-slate-300", iconBg: "bg-slate-100 dark:bg-slate-800", ring: "border-slate-400 ring-slate-400/30" },
}

/** Nome de cada ação na tela — o mesmo da paleta, da Wiki e das mensagens de validação. */
export const ACTION_TYPE_LABELS: Record<Extract<FlowNode, { type: "action" }>["config"]["actionType"], string> = {
  CALL_AGENT: "Chamar agente",
  GENERATE_FEEDBACK: "Gerar feedback",
  GENERATE_INTERACTION_FEEDBACK: "Feedback direto de atendimento",
  ESCALATE: "Escalonar",
  SET_VARIABLE: "Definir variável",
  SET_CONFIG_VALUE: "Definir configuração",
}

/** O que a etapa é: "Condição", "Chamar agente"… — nunca o genérico "Ação". */
export function nodeKindLabel(node: FlowNode): string {
  return node.type === "action" ? ACTION_TYPE_LABELS[node.config.actionType] : NODE_TYPE_LABELS[node.type]
}

/** Como a etapa é chamada na tela: o nome dado, senão o que ela é. Nunca vazio, nunca o id técnico. */
export function nodeDisplayName(node: FlowNode): string {
  return node.label.trim() || nodeKindLabel(node)
}

export type NodeDescribeContext = {
  triggerLabel?: string
  /** Só usado pra decidir a FRASE do card do Trigger — "Todos os dias às 09:00" (Agenda) nunca
   * deveria virar "Quando 'Todos os dias às 09:00' chega/atualiza" (fraseado certo só pra
   * flag/indicador). Evolução do Trigger por agenda. */
  triggerKind?: "channel_flag" | "indicator" | "schedule" | "manual"
  /** Consolidado (Estrutura Consolidada configurada) — muda o rótulo de Atingimento/PRV no card
   * (Parte 6 do pedido de Meta/Fechamentos): "Atingimento consolidado do PRV" só é correto em
   * modo Individual (o PRV do PRÓPRIO colaborador); numa estrutura, é uma média calculada pela
   * engine sobre os PRVs individuais dos membros, nunca um PRV oficial da estrutura. Ausente =
   * Individual, comportamento de sempre. */
  isConsolidatedMode?: boolean
  /** Nós entre "Aplicar individualmente" e "Consolidar resultados": mesmo em Workflow consolidado, o sujeito ali é a pessoa da execução. */
  individualNodeIds?: ReadonlySet<string>
  getAgentName?: (agentId: string) => string | undefined
  getOrchestratorName?: (orchestratorId: string) => string | undefined
  /** Nome da política de acompanhamento (resumo publicado) — o card nunca mostra id. */
  getPolicyName?: (policyId: string) => string | undefined
  /** Label amigável ("Diagnóstico › Severidade") de um campo de Structured Output, dado o node
   * de origem e o path relativo (já sem o prefixo "structuredResult.") — undefined quando o
   * schema não é conhecido, caindo no fallback textual de sempre. */
  getStructuredFieldLabel?: (nodeId: string, fieldPath: string) => string | undefined
  /** Rótulo de negócio de um valor de campo de lista ("Recomendada ao responsável" em vez de RECOMMENDED). */
  getStructuredFieldOptionLabel?: (nodeId: string, fieldPath: string, value: string) => string | undefined
  /** Nome + tipo de uma Workflow Variable pelo seu id imutável — undefined se ela não existir
   * mais (referência quebrada). */
  getVariable?: (variableId: string) => { label: string; type: WorkflowVariableType } | undefined
  /** Label amigável de qualquer node do grafo pelo id — usado pelo card de Human Review pra
   * mostrar "revisão anterior: <label>" em vez do id técnico do node. */
  getNodeLabel?: (nodeId: string) => string | undefined
  /** Problemas de publicação por nó (contagem + primeira mensagem) — o card mostra "N problemas"
   * e uma linha; a lista completa vive no painel de configuração e no rodapé do editor. */
  issuesByNodeId?: Record<string, { count: number; message: string }>
}

function formatDuration(durationMs: number): string {
  const minutes = Math.round(durationMs / 60000)
  if (minutes > 0 && minutes % 1440 === 0) return `${minutes / 1440} dia(s)`
  if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60} hora(s)`
  return `${minutes} minuto(s)`
}

const NO_VALUE_COMPARATORS: Comparator[] = ["IS_EMPTY", "NOT_EMPTY"]

function describeThresholdValue(config: {
  thresholdBoolean?: boolean | null
  thresholdNumeric?: number | null
  thresholdText?: string
}): string {
  if (config.thresholdBoolean !== undefined && config.thresholdBoolean !== null) return config.thresholdBoolean ? "Verdadeiro" : "Falso"
  if (config.thresholdText) return config.thresholdText
  if (config.thresholdNumeric !== undefined && config.thresholdNumeric !== null) return String(config.thresholdNumeric)
  return "?"
}

/** "é igual a CRITICAL" ou, pra comparadores sem valor (IS_EMPTY/NOT_EMPTY), só "está vazio". */
function describeComparison(config: { comparator: Comparator; thresholdBoolean?: boolean | null; thresholdNumeric?: number | null; thresholdText?: string }): string {
  if (NO_VALUE_COMPARATORS.includes(config.comparator)) return COMPARATOR_LABELS[config.comparator]
  return `${COMPARATOR_LABELS[config.comparator]} ${describeThresholdValue(config)}`
}

// Frase com preposição, pra compor no meio de uma sentença ("Máximo de TMA no último mês é
// maior que 900") — diferente de CALENDAR_UNIT_LABELS (rótulo do Select, sem preposição).
// Fase PREVIOUS (padrão) x CURRENT (Parte 18 da evolução de Unidade de Análise/Período —
// "Este mês", sempre parcial, nunca finge que fechou).
const CALENDAR_UNIT_SENTENCE: Record<"PREVIOUS" | "CURRENT", Record<CalendarUnit, string>> = {
  PREVIOUS: {
    DAY: "ontem",
    WEEK: "na última semana",
    MONTH: "no último mês",
    TWO_MONTHS: "no último bimestre",
    QUARTER: "no último trimestre",
    FOUR_MONTHS: "no último quadrimestre",
    SEMESTER: "no último semestre",
  },
  CURRENT: {
    DAY: "hoje",
    WEEK: "nesta semana",
    MONTH: "neste mês",
    TWO_MONTHS: "neste bimestre",
    QUARTER: "neste trimestre",
    FOUR_MONTHS: "neste quadrimestre",
    SEMESTER: "neste semestre",
  },
}

/** "nos últimos 7 dias" (janela móvel), "no último mês" (período civil), "nos últimos 3
 * fechamentos mensais" (Atingimento/PRV — fechamentos reais persistidos pela fonte, inalterado
 * pela correção de PERÍODO desta rodada) ou "nos últimos 3 meses fechados" (Valor bruto — meses
 * de calendário civis completos, correção pontual de PERÍODO: nunca a mesma nomenclatura pros
 * dois conceitos). */
function describePeriod(period: HistoricalPeriod | undefined, windowDays: number | undefined, source?: HistoricalSource): string {
  const effective: HistoricalPeriod = period ?? { kind: "ROLLING_DAYS", days: windowDays ?? 7 }
  if (effective.kind === "ROLLING_DAYS") return `nos últimos ${effective.days} dias`
  if (effective.kind === "CLOSURES") {
    const isMeasurement = source === "MEASUREMENT" || source === undefined
    return isMeasurement ? `nos últimos ${effective.count} meses fechados` : `nos últimos ${effective.count} fechamentos mensais`
  }
  return CALENDAR_UNIT_SENTENCE[effective.phase ?? "PREVIOUS"][effective.unit]
}

/** Descreve um resultado de Condition sobre uma regra simples (sourcePath/variável/legado) —
 * reaproveitado tanto pelo card de uma Condition simples quanto por cada regra dentro de um
 * ConditionGroup (AND/OR). */
function describeConditionRule(rule: ConditionRule, context: NodeDescribeContext): string {
  if (!rule.sourcePath) return `${context.triggerLabel ?? "valor do gatilho"} ${describeComparison(rule)}`
  const decoded = decodeSourcePath(rule.sourcePath)
  if (decoded?.kind === "variable") {
    const variable = context.getVariable?.(decoded.variableId)
    return `${variable?.label ?? "variável"} ${describeComparison(rule)}`
  }
  if (decoded?.kind === "node") {
    const structuredPath = decoded.field ? decodeStructuredFieldPath(decoded.field) : null
    const fieldLabel = structuredPath ? context.getStructuredFieldLabel?.(decoded.nodeId, structuredPath) : undefined
    const optionLabel = structuredPath && rule.thresholdText ? context.getStructuredFieldOptionLabel?.(decoded.nodeId, structuredPath, rule.thresholdText) : undefined
    if (fieldLabel) return `${fieldLabel} ${describeComparison(optionLabel ? { ...rule, thresholdText: optionLabel } : rule)}`
  }
  return `resultado anterior ${describeComparison(rule)}`
}

/** "3 ou mais" em vez de "é maior ou igual a 3" — o lado "quantidade" do COUNT lê melhor em
 * linguagem natural que em comparador+valor cru. */
function describeCountThreshold(comparator: Comparator, threshold: number): string {
  switch (comparator) {
    case "GTE":
      return `${threshold} ou mais`
    case "LTE":
      return `${threshold} ou menos`
    case "GT":
      return `mais de ${threshold}`
    case "LT":
      return `menos de ${threshold}`
    case "EQUALS":
      return `exatamente ${threshold}`
    case "NOT_EQUALS":
      return `diferente de ${threshold}`
    default:
      return `${COMPARATOR_LABELS[comparator]} ${threshold}`
  }
}

/** "Média de Nota URA" / "Atingimento de Monitoria de Qualidade" / "Atingimento do PRV" — nunca
 * mistura o rótulo genérico de agregação com "indicador" quando a origem é PRV (não tem
 * indicador nenhum) ou Atingimento (o substantivo certo é "atingimento", não "indicador"). Em
 * modo Consolidado, o rótulo de PRV vira "...do PRV da estrutura" (Parte 6 do pedido de Meta/
 * Fechamentos) — deixa claro que é uma média calculada pela engine sobre os PRVs individuais dos
 * membros, nunca um PRV oficial da estrutura (que não existe na fonte hoje). */
function describeHistoricalSubject(query: HistoricalQuery, isConsolidatedMode?: boolean): string {
  const aggregationLabel = HISTORICAL_AGGREGATION_LABELS[query.aggregation ?? "COUNT"]
  if (query.source === "PRV_ACHIEVEMENT") return `${aggregationLabel} do atingimento do PRV${isConsolidatedMode ? " da estrutura" : ""}`
  if (query.source === "INDICATOR_ACHIEVEMENT") return `${aggregationLabel} do atingimento de ${query.indicatorCode || "indicador"}${isConsolidatedMode ? " da estrutura" : ""}`
  return `${aggregationLabel} de ${query.indicatorCode || "indicador"}`
}

/** "aumentou pelo menos 10%" / "diminuiu pelo menos 10%" (Parte 17/18) — thresholdNumeric
 * negativo representa magnitude de queda (comparator LTE -10 = "caiu pelo menos 10%"); os dois
 * padrões documentados no pedido viram frase natural, o resto cai num fallback genérico. */
function describePercentChange(comparator: Comparator, threshold: number | null | undefined): string {
  const value = threshold ?? 0
  if (comparator === "GTE" && value >= 0) return `aumentou pelo menos ${value}%`
  if (comparator === "GT" && value >= 0) return `aumentou mais de ${value}%`
  if (comparator === "LTE" && value <= 0) return `diminuiu pelo menos ${Math.abs(value)}%`
  if (comparator === "LT" && value <= 0) return `diminuiu mais de ${Math.abs(value)}%`
  return `variação ${COMPARATOR_LABELS[comparator]} ${value}%`
}

const RANKING_SELECTION_LABELS: Record<EmployeeRankingSelection, string> = {
  HIGHEST: "maiores valores",
  LOWEST: "menores valores",
  BEST: "melhores",
  WORST: "piores",
  IMPROVED: "maiores evoluções",
  DECLINED: "maiores quedas",
  OPERATIONAL_QUARTILE: "quartil operacional",
}

// "" pra NONE — nunca aparece um "· por Nenhuma" pendurado no resumo (Parte 27/57: só mostra o
// sufixo quando a separação está realmente ligada).
const RANKING_PARTITION_SUFFIX: Record<EmployeeRankingPartitionBy, string> = { NONE: "", TEAM: " · por Grupo", SUBTEAM: " · por Subgrupo" }

/** Resumo de "Selecionar colaboradores" em modo Ranking — "5 piores · Média de Qualidade · nos
 * últimos 90 dias" (VALUE) ou "2 maiores quedas · Média de Qualidade · nos últimos 30 dias vs
 * período anterior · por Subgrupo" (CHANGE + partição) — nunca o formulário inteiro no card
 * (Parte 43/44 original; Parte 55/56/57 da evolução de Evolução/Grupo: a separação PRECISA
 * aparecer no resumo, nunca escondida). Reaproveita describeHistoricalSubject
 * (aggregation+indicador) e describePeriod (mesmo texto de período que a Condition histórica já
 * usa) — nunca uma 2ª implementação de frase. */
function describeRankingSummary(ranking: EmployeeRankingConfig): string {
  const isQuartile = ranking.selection === "OPERATIONAL_QUARTILE"
  if (!ranking.selection || !ranking.aggregation || (!isQuartile && !ranking.count)) return "Selecionar colaboradores — ranking incompleto"
  const subject = describeHistoricalSubject({ kind: "INDICATOR_THRESHOLD_COUNT", aggregation: ranking.aggregation, source: ranking.source, indicatorCode: ranking.indicatorCode })
  const period = describePeriod(ranking.period, undefined, ranking.source)
  const partitionSuffix = RANKING_PARTITION_SUFFIX[ranking.partitionBy ?? "NONE"]
  const comparisonSuffix = ranking.rankingBasis === "CHANGE" ? " vs período anterior" : ""
  // Quartil OPERACIONAL sempre nomeado como tal + janela — nunca confundível com o quartil oficial do fechamento.
  if (isQuartile) return `${ranking.operationalQuartile ?? "Q?"} operacional · ${subject} · ${period}${partitionSuffix}`
  return `${ranking.count} ${RANKING_SELECTION_LABELS[ranking.selection]} · ${subject} · ${period}${comparisonSuffix}${partitionSuffix}`
}

/** Resumo do Histórico do indicador (Parte 2/38) — muda de forma conforme a agregação: COUNT
 * conta ocorrências de medição que batem um filtro ("3 ou mais notas URA < 3 nos últimos 7
 * dias"), AVERAGE/MINIMUM/MAXIMUM agregam o valor direto ("Média de Nota URA nos últimos 30
 * dias é menor que 3,3"), e Comparação temporal percentual vira "aumentou/diminuiu X%". */
function describeHistoricalSummary(
  query: HistoricalQuery,
  outer: { comparator: Comparator; thresholdBoolean?: boolean | null; thresholdNumeric?: number | null; thresholdText?: string },
  isConsolidatedMode?: boolean,
): string {
  const period = describePeriod(query.period, query.windowDays, query.source)
  // Quartil OPERACIONAL sempre nomeado como tal + janela — nunca confundível com "Quartil do
  // indicador" (oficial, do fechamento).
  if (query.source === "OPERATIONAL_QUARTILE") {
    const verb = outer.comparator === "NOT_EQUALS" ? "não é" : "é"
    return `Quartil operacional de ${query.indicatorCode || "indicador"} ${period} ${verb} ${outer.thresholdText ?? "Q?"}`
  }
  if ((query.aggregation ?? "COUNT") === "COUNT") {
    const count = describeCountThreshold(outer.comparator, outer.thresholdNumeric ?? 0)
    const innerComparator = query.comparator ?? "LT"
    return `${count} ${query.indicatorCode || "indicador"} ${COMPARATOR_LABELS[innerComparator]} ${query.indicatorThreshold ?? "?"} ${period}`
  }
  if (query.compareTo?.kind === "PREVIOUS_PERIOD" && query.compareTo.changeMode === "PERCENT") {
    return `${describeHistoricalSubject(query, isConsolidatedMode)} ${period} ${describePercentChange(outer.comparator, outer.thresholdNumeric)}`
  }
  return `${describeHistoricalSubject(query, isConsolidatedMode)} ${period} ${describeComparison(outer)}`
}

/** Resumo de uma Condition de Performance (Parte 8) — "Quartil do PRV é igual a Q4", ou, com
 * Recorrência (Parte 7/8/10/24), "Q4 em 3 ou mais dos últimos 3 fechamentos". */
function describePerformanceSummary(query: PerformanceQuery, outer: { comparator: Comparator; thresholdBoolean?: boolean | null; thresholdNumeric?: number | null; thresholdText?: string }): string {
  if (query.recurrence) {
    const count = describeCountThreshold(outer.comparator, outer.thresholdNumeric ?? 0)
    return `${query.recurrence.matchQuartile} em ${count} dos últimos ${query.recurrence.periods} fechamentos`
  }
  const metricLabel = PERFORMANCE_METRIC_LABELS[query.metric]
  const label = query.indicatorCode ? `${metricLabel} (${query.indicatorCode})` : metricLabel
  return `${label} ${describeComparison(outer)}`
}

/** Descreve a origem dinâmica de uma Action "Definir variável" (evolução de Variáveis do
 * Workflow) — mesmo padrão de `describeConditionRule`, reaproveitando os mesmos resolvedores de
 * rótulo amigável (`triggerLabel`/`getNodeLabel`/`getStructuredFieldLabel`/`getVariable`) já
 * usados pela Condition. Nunca expõe sourceNodeId/UUID/JSON path. */
function describeDynamicVariableSource(sourcePath: string, context: NodeDescribeContext): string {
  const decoded = decodeSourcePath(sourcePath)
  if (!decoded) return "origem não configurada"
  if (decoded.kind === "variable") {
    const variable = context.getVariable?.(decoded.variableId)
    return variable?.label ?? "variável"
  }
  if (decoded.nodeId === "trigger") return context.triggerLabel ? `Valor do gatilho ("${context.triggerLabel}")` : "Valor do gatilho"
  const structuredPath = decoded.field ? decodeStructuredFieldPath(decoded.field) : null
  const fieldLabel = structuredPath ? context.getStructuredFieldLabel?.(decoded.nodeId, structuredPath) : undefined
  return fieldLabel ?? context.getNodeLabel?.(decoded.nodeId) ?? "resultado anterior"
}

export type SetVariableBadge = "FIXED" | "DYNAMIC"

/** Badge "Fixo"/"Dinâmico" do card de "Definir variável" no canvas (Parte 16-22 do pedido de
 * variáveis dinâmicas) — null pra qualquer outro node/Action, nunca inventa uma badge genérica
 * pra tipos que não têm esse conceito. */
export function describeSetVariableBadge(node: FlowNode): SetVariableBadge | null {
  if (node.type !== "action" || node.config.actionType !== "SET_VARIABLE") return null
  // `!== undefined` (não truthy) — sourcePath "" é o estado transitório "Dinâmico escolhido,
  // Fonte ainda não" e precisa continuar contando como dinâmico (mesmo motivo do isDynamic em
  // SetVariableForm, node-config/set-variable-form.tsx).
  return node.config.sourcePath !== undefined ? "DYNAMIC" : "FIXED"
}

export function describeNodeConfig(node: FlowNode, context: NodeDescribeContext): string {
  switch (node.type) {
    case "trigger":
      if (!context.triggerLabel) return "Início do fluxo"
      // Agenda já é uma frase de recorrência pronta ("Todos os dias às 09:00") — "Quando ...
      // chega/atualiza" só faz sentido pra flag/indicador (Parte 12/13 do pedido de evolução da Agenda).
      // Manual já vem pronto ("Executar agora · Interação do colaborador") — nunca "chega/atualiza".
      return context.triggerKind === "schedule" || context.triggerKind === "manual" ? context.triggerLabel : `Quando "${context.triggerLabel}" chega/atualiza`
    case "wait":
      return `Aguardar ${formatDuration(node.config.durationMs)}`
    case "condition": {
      // Prioridade igual à do motor (graph-schema.ts): group > historicalQuery > performanceQuery > sourcePath > legado.
      if (node.config.group) {
        const joiner = node.config.group.operator === "ALL" ? " E " : " OU "
        return node.config.group.rules.map((rule) => describeConditionRule(rule, context)).join(joiner)
      }
      if (node.config.historicalQuery) {
        return describeHistoricalSummary(node.config.historicalQuery, node.config, context.isConsolidatedMode && !context.individualNodeIds?.has(node.id))
      }
      if (node.config.performanceQuery) {
        return describePerformanceSummary(node.config.performanceQuery, node.config)
      }
      // sourcePath (variável/node anterior) ou legado (valor bruto do gatilho) — mesma lógica
      // reaproveitada de cada regra dentro de um group.
      return describeConditionRule(node.config, context)
    }
    case "select_employees": {
      // "Por ranking" (evolução) mostra sua própria frase curta; "Por critério" (ausente =
      // legado) reaproveita o MESMO resumo que uma Condition "de dados" já mostraria — o
      // critério é literalmente a mesma forma — nunca um formulário inteiro no card.
      if (node.config.selectionMode === "RANKING") {
        return node.config.ranking ? describeRankingSummary(node.config.ranking) : "Selecionar colaboradores — ranking incompleto"
      }
      const criterion = node.config.criterion
      if (!criterion) return "Selecionar colaboradores — sem critério"
      if (criterion.historicalQuery) return describeHistoricalSummary(criterion.historicalQuery, criterion, context.isConsolidatedMode)
      if (criterion.performanceQuery) return describePerformanceSummary(criterion.performanceQuery, criterion)
      return "Selecionar colaboradores — sem critério"
    }
    case "apply_individually":
      // Sem configuração própria (Parte 40 do pedido) — a origem da coleção aparece no painel
      // de configuração (que tem acesso ao grafo), não no card.
      return "1 execução por colaborador da coleção"
    case "consolidate_results":
      // Sem configuração própria (mesmo padrão de apply_individually) — qual "Aplicar
      // individualmente" pareado aparece no painel de configuração, que tem acesso ao grafo.
      return "Aguarda as execuções de \"Aplicar individualmente\""
    case "action":
      if (node.config.actionType === "CALL_AGENT") {
        if (!node.config.agentId) return "Agente ainda não escolhido"
        return `Chamar ${context.getAgentName?.(node.config.agentId) ?? "agente"}`
      }
      if (node.config.actionType === "ESCALATE") {
        // Reaproveita os MESMOS resolvedores de rótulo já usados pelo Human Review (Destino) e
        // pelo Output (Superfícies) — nunca expõe UUID/nodeId cru (Parte 23 do pedido).
        const target = node.config.target
        const targetLabel =
          target.type === "SPECIFIC_USER"
            ? "pessoa específica"
            : target.type === "ROLE_OF_OPERATOR"
              ? `${ESCALATION_ROLE_LABELS[target.role]} do operador`
              : `${ESCALATION_ROLE_LABELS[target.role]} de quem decidiu em "${context.getNodeLabel?.(target.previousReviewNodeId) ?? "revisão anterior"}"`
        const surfaces = node.config.surfaces.map((surface) => OUTPUT_SURFACE_LABELS[surface]).join(" + ")
        const reason = node.config.reason ? ` — "${node.config.reason}"` : ""
        return `Escalonar → ${targetLabel} · ${surfaces || "sem destino"}${reason}`
      }
      if (node.config.actionType === "SET_VARIABLE") {
        const variable = context.getVariable?.(node.config.variableId)
        const variableLabel = variable?.label ?? "(não selecionada)"
        // Dinâmico: "Pontuação de risco ← Monitoria Completa › Risco › Score" (Parte 21 do pedido
        // de variáveis dinâmicas) — nunca expõe sourceNodeId/UUID/JSON path. `!== undefined`
        // (não truthy): sourcePath "" ainda é modo dinâmico, só sem Fonte escolhida ainda.
        if (node.config.sourcePath !== undefined) return `${variableLabel} ← ${describeDynamicVariableSource(node.config.sourcePath, context)}`
        // Fixo: comportamento de sempre.
        const value = typeof node.config.value === "boolean" ? (node.config.value ? "Verdadeiro" : "Falso") : String(node.config.value ?? "?")
        return `${variableLabel} = ${value}`
      }
      if (node.config.actionType === "GENERATE_FEEDBACK") {
        // "Origem: <nome do nó> · Tipo: …" — nunca id; sem origem = aviso visível no card.
        const sourceLabel = node.config.sourceNodeId ? (context.getNodeLabel?.(node.config.sourceNodeId) ?? "origem removida") : "sem origem"
        return `Feedback confiável · Origem: ${sourceLabel} · Tipo: ${FEEDBACK_DOMAIN_LABELS[node.config.feedbackDomain]}`
      }
      if (node.config.actionType === "GENERATE_INTERACTION_FEEDBACK") {
        const source = node.config.interactionSource
        return source.kind === "TRIGGER_INTERACTION"
          ? "Feedback de atendimento · interação do gatilho"
          : `Feedback de atendimento · até ${source.sampleSize} do período "${PERIOD_WINDOW_LABELS[source.period]}" (${source.strategy === "MOST_RECENT" ? "mais recentes" : "amostra reproduzível"})`
      }
      return `Definir "${node.config.configKey}"`
    case "intervention_policy": {
      const policyName = node.config.policyId ? (context.getPolicyName?.(node.config.policyId) ?? "política selecionada") : "política não selecionada"
      return `${policyName} · ${node.config.mode === "APPLY_POLICY" ? "abre conforme a política" : "somente recomenda"}`
    }
    case "orchestrator": {
      const orchestratorName = context.getOrchestratorName?.(node.config.orchestratorId) ?? "orquestrador não selecionado"
      return node.config.instruction ? `${orchestratorName} — "${node.config.instruction}"` : orchestratorName
    }
    case "human_review": {
      const target = node.config.reviewTarget
      if (target.type === "SPECIFIC_USER") return "Revisão de pessoa específica"
      const roleLabel = ESCALATION_ROLE_LABELS[target.role]
      if (target.type === "ROLE_OF_OPERATOR") return `Revisão do ${roleLabel} do operador`
      const previousLabel = context.getNodeLabel?.(target.previousReviewNodeId) ?? "revisão anterior"
      return `Revisão do ${roleLabel} de quem decidiu em "${previousLabel}"`
    }
    case "output": {
      const surfaces = node.config.surfaces.map((surface) => OUTPUT_SURFACE_LABELS[surface]).join(" + ")
      // "Cargo específico" sozinho não responde quem recebe: mostra o cargo escolhido.
      const recipient = node.config.target.type === "ROLE" ? ESCALATION_ROLE_LABELS[node.config.target.role] : OUTPUT_TARGET_LABELS[node.config.target.type]
      return `${recipient} — ${surfaces || "sem destino"}`
    }
    case "end":
      return "Fim do fluxo"
  }
}
