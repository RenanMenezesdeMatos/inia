import type { Orchestrator } from "../assistant.schema"
import { QUARTILE_VALUES } from "../employee-performance.schema"
import { COMPARATORS_BY_FIELD_TYPE, HISTORICAL_AGGREGATION_LABELS, type Comparator, type FlowGraph, type FlowNode } from "../workflow-graph.schema"
import { triggerProvidesValue } from "../workflow.schema"
import type { ValidationContext, ValidationIssue, VariableInfo } from "./types"
import { decodeSourcePathLocal, findField, structuredFieldsOf } from "./source-paths"

// Família CONDIÇÃO: grupo E/OU, histórico do indicador, quartil operacional, performance, origem e valor do gatilho.
// Espelho do backend: workflows/application/publish-validation/conditions.ts.

type TypedRuleLike = { comparator: Comparator; thresholdBoolean?: boolean | null; thresholdNumeric?: number | null; thresholdText?: string }
type FieldType = keyof typeof COMPARATORS_BY_FIELD_TYPE

/** Comparador/valor contra um tipo CONHECIDO (variável ou campo do resultado estruturado) — espelho de
 * `validateTypedCondition` do backend, na mesma ordem: operador do tipo → valor do tipo → opção da lista. */
function validateTypedCondition(subject: string, rule: TypedRuleLike, fieldType: FieldType, enumValues: string[] | undefined, nodeId: string, code: string, issues: ValidationIssue[]): void {
  if (!COMPARATORS_BY_FIELD_TYPE[fieldType].includes(rule.comparator)) {
    issues.push({ nodeId, code, message: `${subject} usa um operador incompatível com o tipo do campo selecionado.` })
    return
  }
  if (fieldType === "BOOLEAN" && (rule.thresholdBoolean === undefined || rule.thresholdBoolean === null)) {
    issues.push({ nodeId, code, message: `${subject} precisa de um valor verdadeiro/falso.` })
    return
  }
  if (fieldType === "NUMBER" && (rule.thresholdNumeric === undefined || rule.thresholdNumeric === null)) {
    issues.push({ nodeId, code, message: `${subject} precisa de um valor numérico.` })
    return
  }
  if (fieldType === "STRING") {
    const needsValue = rule.comparator !== "IS_EMPTY" && rule.comparator !== "NOT_EMPTY"
    if (needsValue && !rule.thresholdText) {
      issues.push({ nodeId, code, message: `${subject} precisa de um valor de texto.` })
    } else if (needsValue && enumValues && enumValues.length > 0 && rule.thresholdText && !enumValues.includes(rule.thresholdText)) {
      issues.push({ nodeId, code, message: `${subject} usa um valor que não está entre as opções desse campo (${enumValues.join(", ")}).` })
    }
  }
}

const variableFieldType = (variable: VariableInfo): FieldType => (variable.type === "NUMERIC" ? "NUMBER" : variable.type === "TEXT" ? "STRING" : "BOOLEAN")

function hasComparisonValue(rule: TypedRuleLike): boolean {
  return (
    (rule.thresholdBoolean !== undefined && rule.thresholdBoolean !== null) ||
    (rule.thresholdNumeric !== undefined && rule.thresholdNumeric !== null) ||
    Boolean(rule.thresholdText) ||
    rule.comparator === "IS_EMPTY" ||
    rule.comparator === "NOT_EMPTY"
  )
}

/** Regra sourcePath (Workflow Variable / campo do resultado estruturado / legado) — reaproveitada por uma Condition simples
 * e por cada regra de um `group` (AND/OR). Espelho de `validateSourcePathRule` do backend: variável → existe e tipo;
 * campo estruturado → tipo/opções, ou campo que não existe mais; sem tipo conhecido → só exige um valor. */
function validateSourcePathRule(
  label: string,
  rule: TypedRuleLike & { sourcePath?: string },
  nodeId: string,
  graph: FlowGraph,
  orchestratorsById: Map<string, Orchestrator>,
  variablesById: Map<string, VariableInfo>,
  issues: ValidationIssue[],
): void {
  if (!rule.sourcePath) {
    issues.push({ nodeId, code: "WORKFLOW_INVALID_CONDITION", message: `"${label}" precisa de uma origem selecionada.` })
    return
  }
  const parsed = decodeSourcePathLocal(rule.sourcePath)
  // Etapa removida: quem aponta o problema é validateNodeReferences (node-references.ts). Aqui só não há o que tipar.
  if (parsed?.kind === "node" && !graph.nodes.some((candidate) => candidate.id === parsed.nodeId)) return
  if (parsed?.kind === "variable") {
    const variable = variablesById.get(parsed.variableId)
    if (!variable) {
      issues.push({ nodeId, code: "WORKFLOW_INVALID_CONDITION", message: `"${label}" referencia uma variável que não existe mais neste workflow.` })
      return
    }
    validateTypedCondition(`"${label}"`, rule, variableFieldType(variable), undefined, nodeId, "WORKFLOW_INVALID_CONDITION", issues)
    return
  }
  if (parsed?.kind === "node" && parsed.field.startsWith("structuredResult.")) {
    const sourceNode = graph.nodes.find((candidate) => candidate.id === parsed.nodeId)
    const fields = sourceNode?.type === "orchestrator" ? structuredFieldsOf(orchestratorsById.get(sourceNode.config.orchestratorId)) : undefined
    const fieldPath = parsed.field.slice("structuredResult.".length)
    const field = findField(fields, fieldPath)
    if (field) {
      validateTypedCondition(`"${label}"`, rule, field.type, field.enumValues, nodeId, "WORKFLOW_INVALID_CONDITION", issues)
      return
    }
    // Orquestrador COM resultado estruturado declarado mas sem esse campo (renomeado/removido); sem catálogo = legado livre.
    if (fields) {
      issues.push({ nodeId, code: "WORKFLOW_STRUCTURED_FIELD_NOT_FOUND", message: `"${label}" usa o campo "${fieldPath}", que não existe mais no resultado estruturado do Orquestrador — escolha outro campo.` })
      return
    }
  }
  if (!hasComparisonValue(rule)) {
    issues.push({ nodeId, code: "WORKFLOW_INVALID_CONDITION", message: `"${label}" precisa de um valor para comparar.` })
  }
}

type DataConditionLike = Pick<Extract<FlowNode, { type: "condition" }>["config"], "comparator" | "thresholdNumeric" | "thresholdText" | "historicalQuery" | "performanceQuery">

/**
 * Condition "de dados" (histórico, quartil operacional ou performance) — espelho de `validateDataConditionConfig` do
 * backend, a MESMA função para a Condition e para o critério de "Selecionar colaboradores" (como no backend). `subject` já
 * vem formatado ('O nó "X"' / 'O critério de seleção do nó "X"'); `code` é o código da regra de quem chama.
 */
export function validateDataCondition(subject: string, config: DataConditionLike, nodeId: string, code: string, issues: ValidationIssue[]): void {
  const push = (message: string) => issues.push({ nodeId, code, message })

  if (config.historicalQuery?.source === "OPERATIONAL_QUARTILE") {
    // Quartil operacional: indicador, janela operacional (nunca fechamentos), agregação de valor, sem "Comparar com",
    // sem filtro de medição/mínimo de medições, comparador É igual a/É diferente de + Q1..Q4.
    const query = config.historicalQuery
    if (!query.indicatorCode) push("Selecione o indicador do quartil operacional.")
    if (!query.period) push("Defina o período operacional do quartil (últimos N dias, semana ou mês).")
    if (query.period?.kind === "CLOSURES") push(`${subject} usa Últimos N fechamentos com Quartil operacional — o quartil operacional é calculado sobre medições diárias; para o quartil do fechamento use Quartil do indicador (performance).`)
    if ((query.aggregation ?? "COUNT") === "COUNT") push(`${subject} usa Quantidade de ocorrências com Quartil operacional — o quartil precisa de um valor agregado por colaborador.`)
    if (query.compareTo) push(`${subject} usa "Comparar com" com Quartil operacional — compare só com Q1..Q4.`)
    if (query.comparator !== undefined || query.indicatorThreshold !== undefined || query.minimumSampleSize !== undefined) {
      push(`${subject} usa filtro de medição/mínimo de medições com Quartil operacional — esses campos só se aplicam a Quantidade de ocorrências ou valor agregado.`)
    }
    if (config.comparator !== "EQUALS" && config.comparator !== "NOT_EQUALS") push(`${subject} compara Quartil operacional com um operador inválido — use "É igual a" ou "É diferente de".`)
    if (!config.thresholdText || !(QUARTILE_VALUES as string[]).includes(config.thresholdText)) push(`Selecione o quartil operacional (${QUARTILE_VALUES.join(", ")}).`)
    return
  }

  if (config.historicalQuery) {
    const query = config.historicalQuery
    const official = query.source !== undefined && query.source !== "MEASUREMENT"
    // PRV é uma fonte própria (employee_prv_performance) — nunca exige indicatorCode.
    if (query.source !== "PRV_ACHIEVEMENT" && !query.indicatorCode) push("Selecione o indicador do histórico.")
    if (!query.period && !query.windowDays) push("Defina o período do histórico.")
    const aggregation = query.aggregation ?? "COUNT"
    // Quantidade de ocorrências conta medições brutas — só existe pra Valor do indicador.
    if (aggregation === "COUNT" && official) {
      push(`${subject} usa Quantidade de ocorrências, que só está disponível pra Valor do indicador — Atingimento/PRV sempre agregam (Média/Mínimo/Máximo).`)
    }
    // Agregações da camada operacional (média ponderada, soma, último) só existem pra medições.
    if ((aggregation === "WEIGHTED_AVERAGE" || aggregation === "SUM" || aggregation === "LATEST") && official) {
      push(`${subject} usa uma agregação operacional (${HISTORICAL_AGGREGATION_LABELS[aggregation]}) com uma fonte oficial — Atingimento/PRV só aceitam Média, Mínimo ou Máximo entre fechamentos.`)
    }
    // Fonte oficial só existe por fechamento mensal: dias (< 28) ou semana/dia civil não têm significado.
    if (official && query.period && ((query.period.kind === "ROLLING_DAYS" && query.period.days < 28) || (query.period.kind === "CALENDAR" && (query.period.unit === "DAY" || query.period.unit === "WEEK")))) {
      push(`${subject} usa um período operacional (dias/semana) com uma fonte oficial — Atingimento/PRV só existem por fechamento mensal: use Últimos N fechamentos ou um período mensal.`)
    }
    // Cobertura mínima é conceito da camada operacional (dias elegíveis × dias com medição).
    if (query.minimumCoverage !== undefined && (official || aggregation === "COUNT")) {
      push(`${subject} usa Cobertura mínima, que só está disponível para Valor do indicador com agregação (Média ponderada, Mínimo, Máximo…).`)
    }
    // Meta vigente é referência do VALOR DO INDICADOR — Atingimento já representa a relação com a meta.
    if (query.compareTo?.kind === "GOAL" && official) {
      push(`${subject} usa Meta vigente como referência, que só está disponível pra Valor do indicador — para Atingimento, compare com um valor fixo ou com o período anterior.`)
    }
    // Últimos N fechamentos — nunca com Quantidade de ocorrências nem com Comparar com Período anterior.
    if (query.period?.kind === "CLOSURES" && aggregation === "COUNT") {
      push(`${subject} usa Últimos N fechamentos, que não está disponível pra Quantidade de ocorrências — use Média, Mínimo ou Máximo.`)
    }
    if (query.period?.kind === "CLOSURES" && query.compareTo?.kind === "PREVIOUS_PERIOD") {
      push(`${subject} usa Últimos N fechamentos, que não está disponível com Comparar com Período anterior.`)
    }
    if (aggregation === "COUNT") {
      if (query.comparator === undefined || query.indicatorThreshold === undefined) push("Defina o filtro de medição pra contar ocorrências.")
      // "Comparar com" e "Mínimo de medições" só fazem sentido pra um VALOR agregado.
      if (query.compareTo) push(`${subject} usa Quantidade de ocorrências, que sempre compara contra um valor fixo — "Comparar com" só se aplica a Média/Mínimo/Máximo.`)
      if (query.minimumSampleSize !== undefined) push(`${subject} usa Quantidade de ocorrências, que não usa Mínimo de medições — esse campo só se aplica a Média/Mínimo/Máximo.`)
      if (config.thresholdNumeric === undefined || config.thresholdNumeric === null) push("Defina o valor de referência do histórico.")
    } else if (!query.compareTo && (config.thresholdNumeric === undefined || config.thresholdNumeric === null)) {
      // Com Comparar com (Meta/Período anterior), o valor de referência é resolvido em tempo de execução.
      push("Defina o valor de referência do histórico.")
    }
    return
  }

  if (config.performanceQuery) {
    const query = config.performanceQuery
    const isPrv = query.metric === "PRV_ACHIEVEMENT" || query.metric === "PRV_QUARTILE"
    if (!isPrv && !query.indicatorCode) push("Selecione o indicador desta métrica de performance.")
    const isQuartile = query.metric === "INDICATOR_QUARTILE" || query.metric === "PRV_QUARTILE"
    if (query.recurrence && !isQuartile) {
      push(`${subject} usa Recorrência, que só está disponível para Quartil do indicador ou Quartil do PRV.`)
    } else if (isQuartile && query.recurrence) {
      if (config.thresholdNumeric === undefined || config.thresholdNumeric === null) push("Defina a quantidade de fechamentos que devem bater o quartil-alvo.")
      else if (!COMPARATORS_BY_FIELD_TYPE.NUMBER.includes(config.comparator)) push("Recorrência compara uma quantidade de fechamentos — use um operador numérico.")
    } else if (isQuartile) {
      // Mesmo critério de texto com opções do backend: "está vazio"/"não está vazio" não pedem quartil.
      const needsValue = config.comparator !== "IS_EMPTY" && config.comparator !== "NOT_EMPTY"
      if (!COMPARATORS_BY_FIELD_TYPE.STRING.includes(config.comparator)) push("Esse operador não funciona com quartil — use igual/diferente, por exemplo.")
      else if (needsValue && !config.thresholdText) push("Selecione o quartil de referência (Q1-Q4).")
      else if (needsValue && config.thresholdText && !(QUARTILE_VALUES as string[]).includes(config.thresholdText)) push(`Valor de quartil inválido — use ${QUARTILE_VALUES.join(", ")}.`)
    } else if (!COMPARATORS_BY_FIELD_TYPE.NUMBER.includes(config.comparator)) {
      push(`${subject} usa um operador incompatível com o tipo do campo selecionado.`)
    } else if (config.thresholdNumeric === undefined || config.thresholdNumeric === null) {
      push("Defina o valor numérico de referência.")
    }
  }
}

/** Cada nó de Condition, na mesma prioridade do motor: grupo > histórico/quartil > performance > origem > valor do gatilho. */
export function validateConditions(context: ValidationContext): void {
  const { graph, trigger, orchestratorsById, variablesById, issues } = context
  const isBoolean = trigger.kind === "channel_flag" && trigger.valueType === "BOOLEAN"
  for (const node of graph.nodes) {
    if (node.type !== "condition") continue

    // Prioridade igual à do motor (graph-schema.ts): group > historicalQuery > performanceQuery > sourcePath > legado.
    if (node.config.group) {
      node.config.group.rules.forEach((rule, index) => {
        validateSourcePathRule(`${node.label} (regra ${index + 1})`, rule, node.id, graph, orchestratorsById, variablesById, issues)
      })
      continue
    }

    if (node.config.historicalQuery || node.config.performanceQuery) {
      validateDataCondition(`O nó "${node.label}"`, node.config, node.id, "WORKFLOW_INVALID_CONDITION", issues)
      continue
    }

    if (node.config.sourcePath !== undefined) {
      validateSourcePathRule(node.label, node.config, node.id, graph, orchestratorsById, variablesById, issues)
      continue
    }

    // Modo legado: compara o valor bruto do gatilho — só existe quando o gatilho fornece um (Flag, Indicador, Manual com
    // medição). Agenda e Manual sem medição não fornecem (espelha o publish: WORKFLOW_INVALID_CONDITION).
    if (!triggerProvidesValue(trigger)) {
      issues.push({
        nodeId: node.id,
        code: "WORKFLOW_INVALID_CONDITION",
        message:
          trigger.kind === "schedule"
            ? `"${node.label}" compara o valor do gatilho, mas o gatilho por agenda não fornece nenhum — use reincidência ou o resultado de um nó anterior.`
            : `"${node.label}" compara o valor do gatilho, mas este gatilho Manual não fornece um — use histórico/indicador ou o resultado de um nó anterior.`,
      })
      continue
    }
    if (isBoolean) {
      if (node.config.comparator !== "EQUALS" || node.config.thresholdBoolean === undefined || node.config.thresholdBoolean === null) {
        issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_CONDITION", message: 'Precisa de uma condição "é igual a" com verdadeiro/falso — a flag do gatilho é booleana.' })
      }
    } else if (node.config.thresholdNumeric === undefined || node.config.thresholdNumeric === null) {
      issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_CONDITION", message: "Precisa de um valor numérico." })
    }
  }
}
