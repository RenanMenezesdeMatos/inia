import { DomainError } from "../../../../shared/domain/domain-error.js"
import type { FlatOutputSchemaField } from "../../../assistant/domain/output-schema-fields.js"
import { findStructuredOutputField } from "../../../assistant/domain/structured-output-definition.js"
import { QUARTILE_VALUES } from "../../../indicators/domain/employee-performance-schema.js"
import { COMPARATORS_BY_FIELD_TYPE, type Comparator, type FlowGraph, type HistoricalQuery, type PerformanceQuery } from "../../domain/graph-schema.js"
import type { PublishCatalogContext } from "./context.js"
import { parseSourcePath } from "./source-paths.js"

// Família CONDIÇÃO: comparador/valor por tipo, histórico do indicador, quartil operacional, performance, origem e valor do
// gatilho. Espelho no editor: workflow-validation/conditions.ts.

/**
 * Valida comparador/valor de uma Condition contra um tipo CONHECIDO (Structured Output field ou
 * Workflow Variable) — só chamada quando esse tipo foi resolvido; um sourcePath sem tipo
 * conhecido nunca passa por aqui (cai no modo legado logo abaixo, inalterado). O backend nunca
 * confia no frontend: mesmo que a UI já restrinja os comparadores por tipo, esta é a validação
 * que de fato bloqueia a publicação.
 */
type TypedRuleLike = {
  comparator: Comparator
  thresholdBoolean?: boolean | null | undefined
  thresholdNumeric?: number | null | undefined
  thresholdText?: string | undefined
}

function validateTypedCondition(
  subject: string,
  rule: TypedRuleLike,
  fieldType: "BOOLEAN" | "NUMBER" | "STRING" | "ARRAY",
  enumValues?: string[],
  errorCode = "WORKFLOW_INVALID_CONDITION",
): void {
  const allowed = COMPARATORS_BY_FIELD_TYPE[fieldType]
  if (!allowed.includes(rule.comparator)) {
    throw new DomainError(`${subject} usa um operador incompatível com o tipo do campo selecionado.`, errorCode, 422)
  }
  if (fieldType === "BOOLEAN" && (rule.thresholdBoolean === undefined || rule.thresholdBoolean === null)) {
    throw new DomainError(`${subject} precisa de um valor verdadeiro/falso.`, errorCode, 422)
  }
  if (fieldType === "NUMBER" && (rule.thresholdNumeric === undefined || rule.thresholdNumeric === null)) {
    throw new DomainError(`${subject} precisa de um valor numérico.`, errorCode, 422)
  }
  if (fieldType === "STRING") {
    const needsValue = !["IS_EMPTY", "NOT_EMPTY"].includes(rule.comparator)
    if (needsValue && !rule.thresholdText) {
      throw new DomainError(`${subject} precisa de um valor de texto.`, errorCode, 422)
    }
    if (needsValue && enumValues && enumValues.length > 0 && rule.thresholdText && !enumValues.includes(rule.thresholdText)) {
      throw new DomainError(`${subject} usa um valor que não está entre as opções desse campo (${enumValues.join(", ")}).`, errorCode, 422)
    }
  }
}

type DataConditionLike = {
  comparator: Comparator
  thresholdNumeric?: number | null | undefined
  thresholdText?: string | undefined
  historicalQuery?: HistoricalQuery | undefined
  performanceQuery?: PerformanceQuery | undefined
}

/**
 * Validação de negócio de uma Condition "de dados" (histórico OU performance) — ÚNICA fonte de
 * verdade, reaproveitada tanto pela Condition normal quanto pelo critério de "Selecionar
 * colaboradores" (select_employees.config.criterion, EMPLOYEE_COLLECTION), que usa exatamente o
 * mesmo formato de dados (mesmo historicalQuerySchema/performanceQuerySchema, só sem
 * sourcePath/group — nunca fazem sentido avaliados candidato a candidato). Extraída da rodada de
 * hardening: antes, o criterion do select_employees só tinha guardas de runtime
 * (condition-evaluator.ts) — um criterion semanticamente quebrado (ex.: PRV_ACHIEVEMENT+COUNT)
 * publicava e só falhava depois, em produção. Uma regra nova de domínio (nova fonte, nova
 * combinação proibida) precisa valer nos dois lugares ao mesmo tempo — por isso só existe aqui,
 * nunca duplicada. `subject` é o texto já formatado ("O nó de condição \"X\"" / "O critério de
 * seleção do nó \"X\"") — a validação em si nunca assume que é uma Condition.
 * Espelha `condition-evaluator.ts`/`evaluateDataCondition` (a engine real que roda esse critério
 * em tempo de execução) e `resolveHistoricalResult`/`resolvePerformanceQuery` — nunca uma 3ª
 * interpretação das mesmas regras de negócio.
 */
export function validateDataConditionConfig(subject: string, config: DataConditionLike, errorCode: string): void {
  if (config.historicalQuery?.source === "OPERATIONAL_QUARTILE") {
    // Quartil OPERACIONAL (Parte 32–38): posição relativa do colaborador na população do Workflow
    // sobre medições de uma janela operacional — MESMO cálculo do Ranking (operational-quartile-
    // resolver.ts). Nunca é o quartil oficial do fechamento (esse é performanceQuery
    // INDICATOR_QUARTILE), por isso só aceita janela operacional, agregação de valor e comparação
    // "é/não é Q1..Q4".
    const query = config.historicalQuery
    if (!query.indicatorCode) throw new DomainError(`${subject} precisa de um indicador para calcular o quartil operacional.`, errorCode, 422)
    if (!query.period) throw new DomainError(`${subject} precisa de um período operacional (últimos N dias, semana ou mês) para o quartil operacional.`, errorCode, 422)
    if (query.period.kind === "CLOSURES") {
      throw new DomainError(`${subject} usa Últimos N fechamentos com Quartil operacional — o quartil operacional é calculado sobre medições diárias; para o quartil do fechamento use Quartil do indicador (performance).`, errorCode, 422)
    }
    if ((query.aggregation ?? "COUNT") === "COUNT") {
      throw new DomainError(`${subject} usa Quantidade de ocorrências com Quartil operacional — o quartil precisa de um valor agregado por colaborador (Média ponderada, Média, Soma…).`, errorCode, 422)
    }
    if (query.compareTo) throw new DomainError(`${subject} usa "Comparar com" com Quartil operacional — o quartil já é uma posição relativa à população; compare só com Q1..Q4.`, errorCode, 422)
    if (query.comparator !== undefined || query.indicatorThreshold !== undefined || query.minimumSampleSize !== undefined) {
      throw new DomainError(`${subject} usa filtro de medição/mínimo de medições com Quartil operacional — esses campos só se aplicam a Quantidade de ocorrências ou valor agregado.`, errorCode, 422)
    }
    validateTypedCondition(subject, config, "STRING", QUARTILE_VALUES, errorCode)
    if (config.comparator !== "EQUALS" && config.comparator !== "NOT_EQUALS") {
      throw new DomainError(`${subject} compara Quartil operacional com "${config.comparator}" — use "É igual a" ou "É diferente de" com Q1..Q4.`, errorCode, 422)
    }
    return
  }

  if (config.historicalQuery) {
    const query = config.historicalQuery
    // PRV é uma fonte própria (employee_prv_performance) — nunca pertence a um indicador
    // específico, então nunca exige indicatorCode (mesma exceção que performanceQuery já aplica
    // pra PRV_ACHIEVEMENT/PRV_QUARTILE logo abaixo). Valor bruto e Atingimento do indicador
    // sempre precisam de um, pra saber o que consultar.
    if (query.source !== "PRV_ACHIEVEMENT" && !query.indicatorCode) {
      throw new DomainError(`${subject} precisa de um indicador para avaliar o histórico.`, errorCode, 422)
    }
    if (!query.period && !query.windowDays) {
      throw new DomainError(`${subject} precisa de um período pra avaliar o histórico.`, errorCode, 422)
    }
    const aggregation = query.aggregation ?? "COUNT"
    // Quantidade de ocorrências (COUNT) conta MEDIÇÕES BRUTAS — só existe pra Valor do indicador
    // (source MEASUREMENT/ausente). Atingimento do indicador e Atingimento do PRV sempre agregam
    // um valor já pronto da fonte (Média/Mínimo/Máximo), nunca contam ocorrência por ocorrência —
    // nunca confia só na UI escondendo a opção, um payload manual precisa ser rejeitado aqui também.
    if (aggregation === "COUNT" && query.source !== undefined && query.source !== "MEASUREMENT") {
      throw new DomainError(
        `${subject} usa Quantidade de ocorrências, que só está disponível pra Valor do indicador — Atingimento/PRV sempre agregam (Média/Mínimo/Máximo).`,
        errorCode,
        422,
      )
    }
    // Agregações da camada operacional (média ponderada, soma, último valor) só existem pra
    // medições (Valor do indicador). Atingimento/PRV são percentuais oficiais já prontos — só
    // Média/Mínimo/Máximo entre fechamentos fazem sentido.
    if ((aggregation === "WEIGHTED_AVERAGE" || aggregation === "SUM" || aggregation === "LATEST") && query.source !== undefined && query.source !== "MEASUREMENT") {
      throw new DomainError(
        `${subject} usa uma agregação operacional (${aggregation}) com uma fonte oficial — Atingimento/PRV só aceitam Média, Mínimo ou Máximo entre fechamentos.`,
        errorCode,
        422,
      )
    }
    // Fonte oficial só existe por fechamento MENSAL — "Hoje", "Ontem", semana civil ou uma
    // janela de dias menor que um mês não têm significado pra Atingimento/PRV (Parte 29/30 da
    // evolução operacional). Janelas de ≥ 28 dias continuam aceitas (≈ N fechamentos, formato
    // já usado por workflows publicados).
    if (query.source !== undefined && query.source !== "MEASUREMENT" && query.period && ((query.period.kind === "ROLLING_DAYS" && query.period.days < 28) || (query.period.kind === "CALENDAR" && (query.period.unit === "DAY" || query.period.unit === "WEEK")))) {
      throw new DomainError(
        `${subject} usa um período operacional (dias/semana) com uma fonte oficial — Atingimento/PRV só existem por fechamento mensal: use Últimos N fechamentos ou um período mensal.`,
        errorCode,
        422,
      )
    }
    // Cobertura mínima é conceito da camada operacional (dias elegíveis × dias com medição) —
    // não existe pra fechamentos oficiais nem pra contagem de ocorrências.
    if (query.minimumCoverage !== undefined && ((query.source !== undefined && query.source !== "MEASUREMENT") || aggregation === "COUNT")) {
      throw new DomainError(`${subject} usa Cobertura mínima, que só está disponível para Valor do indicador com agregação (Média ponderada, Mínimo, Máximo…).`, errorCode, 422)
    }
    // Meta vigente (compareTo GOAL) é referência do VALOR DO INDICADOR — Atingimento (do
    // indicador ou do PRV) já representa a relação do resultado com a meta, então comparar de
    // novo contra a meta bruta misturaria grandezas diferentes.
    if (query.compareTo?.kind === "GOAL" && query.source !== undefined && query.source !== "MEASUREMENT") {
      throw new DomainError(
        `${subject} usa Meta vigente como referência, que só está disponível pra Valor do indicador — para Atingimento, compare com um valor fixo ou com o período anterior.`,
        errorCode,
        422,
      )
    }
    // Últimos N fechamentos — conta fechamentos reais, nunca combina com Quantidade de
    // ocorrências (contagem por medição já tem seu próprio significado) nem com Comparar com
    // Período anterior.
    if (query.period?.kind === "CLOSURES" && aggregation === "COUNT") {
      throw new DomainError(
        `${subject} usa Últimos N fechamentos, que não está disponível pra Quantidade de ocorrências — use Média, Mínimo ou Máximo.`,
        errorCode,
        422,
      )
    }
    if (query.period?.kind === "CLOSURES" && query.compareTo?.kind === "PREVIOUS_PERIOD") {
      throw new DomainError(`${subject} usa Últimos N fechamentos, que não está disponível com Comparar com Período anterior.`, errorCode, 422)
    }
    if (aggregation === "COUNT") {
      if (query.comparator === undefined || query.indicatorThreshold === undefined) {
        throw new DomainError(`${subject} precisa do filtro de medição pra contar ocorrências.`, errorCode, 422)
      }
      // Comparar com (Meta/Período anterior) e Mínimo de medições só fazem sentido pra um VALOR
      // agregado (Média/Mínimo/Máximo) — Quantidade de ocorrências sempre compara a contagem
      // contra um número fixo.
      if (query.compareTo) {
        throw new DomainError(
          `${subject} usa Quantidade de ocorrências, que sempre compara contra um valor fixo — "Comparar com" só se aplica a Média/Mínimo/Máximo.`,
          errorCode,
          422,
        )
      }
      if (query.minimumSampleSize !== undefined) {
        throw new DomainError(
          `${subject} usa Quantidade de ocorrências, que não usa Mínimo de medições — esse campo só se aplica a Média/Mínimo/Máximo.`,
          errorCode,
          422,
        )
      }
      if (config.thresholdNumeric === undefined || config.thresholdNumeric === null) {
        throw new DomainError(`${subject} precisa de um valor de referência.`, errorCode, 422)
      }
    } else if (!query.compareTo && (config.thresholdNumeric === undefined || config.thresholdNumeric === null)) {
      // Com Comparar com (Meta/Período anterior), o valor de referência é resolvido em tempo de
      // execução — nunca exige thresholdNumeric aqui.
      throw new DomainError(`${subject} precisa de um valor de referência.`, errorCode, 422)
    }
    return
  }

  if (config.performanceQuery) {
    const query = config.performanceQuery
    const isPrv = query.metric === "PRV_ACHIEVEMENT" || query.metric === "PRV_QUARTILE"
    if (!isPrv && !query.indicatorCode) {
      throw new DomainError(`${subject} precisa de um indicador para esta métrica de performance.`, errorCode, 422)
    }
    const isQuartile = query.metric === "INDICATOR_QUARTILE" || query.metric === "PRV_QUARTILE"
    if (query.recurrence && !isQuartile) {
      throw new DomainError(`${subject} usa Recorrência, que só está disponível para Quartil do indicador ou Quartil do PRV.`, errorCode, 422)
    }
    if (isQuartile && query.recurrence) {
      if (config.thresholdNumeric === undefined || config.thresholdNumeric === null) {
        throw new DomainError(`${subject} precisa da quantidade de fechamentos que devem bater o quartil-alvo.`, errorCode, 422)
      }
      if (!COMPARATORS_BY_FIELD_TYPE.NUMBER.includes(config.comparator)) {
        throw new DomainError(`${subject} usa Recorrência, que compara uma quantidade de fechamentos — use um operador numérico.`, errorCode, 422)
      }
    } else if (isQuartile) {
      validateTypedCondition(subject, config, "STRING", QUARTILE_VALUES, errorCode)
    } else {
      validateTypedCondition(subject, config, "NUMBER", undefined, errorCode)
    }
  }
}

/**
 * Valida uma regra "sourcePath" (Structured Output field / Workflow Variable / legado) — mesma
 * lógica reaproveitada tanto pela Condition simples quanto por cada regra de um `group` (AND/OR),
 * já que uma regra dentro de um grupo tem exatamente o mesmo formato de uma Condition simples.
 */
function validateSourcePathRule(
  label: string,
  rule: TypedRuleLike & { sourcePath?: string | undefined },
  graph: FlowGraph,
  variablesById: Map<string, string>,
  orchestratorSchemasById: Map<string, FlatOutputSchemaField[] | null>,
): void {
  if (!rule.sourcePath) {
    throw new DomainError(`O nó de condição "${label}" precisa de uma origem selecionada.`, "WORKFLOW_INVALID_CONDITION", 422)
  }
  const parsed = parseSourcePath(rule.sourcePath)
  const subject = `O nó de condição "${label}"`

  if (parsed?.kind === "variable") {
    const variableType = variablesById.get(parsed.variableId)
    if (!variableType) {
      throw new DomainError(`O nó de condição "${label}" referencia uma variável que não existe mais neste workflow.`, "WORKFLOW_INVALID_CONDITION", 422)
    }
    const fieldType = variableType === "NUMERIC" ? "NUMBER" : variableType === "TEXT" ? "STRING" : "BOOLEAN"
    validateTypedCondition(subject, rule, fieldType)
    return
  }

  if (parsed?.kind === "node" && parsed.field.startsWith("structuredResult.")) {
    const sourceNode = graph.nodes.find((candidate) => candidate.id === parsed.nodeId)
    const schema = sourceNode?.type === "orchestrator" ? orchestratorSchemasById.get(sourceNode.config.orchestratorId) : undefined
    const fieldPath = parsed.field.slice("structuredResult.".length)
    const field = findStructuredOutputField(schema, fieldPath)
    if (field) {
      validateTypedCondition(subject, rule, field.type, field.enumValues)
      return
    }
    // Orquestrador COM resultado estruturado declarado mas sem esse campo: o campo foi
    // renomeado/removido depois que a Condition foi montada — nunca publica em silêncio (o
    // runtime falharia ao resolver o path). Sem catálogo (legado só texto) cai no modo livre.
    if (schema) {
      throw new DomainError(
        `O nó de condição "${label}" usa o campo "${fieldPath}", que não existe mais no resultado estruturado do Orquestrador — escolha outro campo.`,
        "WORKFLOW_STRUCTURED_FIELD_NOT_FOUND",
        422,
      )
    }
  }

  const hasValue =
    (rule.thresholdBoolean !== undefined && rule.thresholdBoolean !== null) ||
    (rule.thresholdNumeric !== undefined && rule.thresholdNumeric !== null) ||
    Boolean(rule.thresholdText) ||
    ["IS_EMPTY", "NOT_EMPTY"].includes(rule.comparator)
  if (!hasValue) {
    throw new DomainError(`O nó de condição "${label}" precisa de um valor para comparar.`, "WORKFLOW_INVALID_CONDITION", 422)
  }
}

/** Cada nó de Condition: grupo E/OU, dados (histórico/performance), origem tipada e valor do gatilho. */
export function validateConditions(context: PublishCatalogContext): void {
  const { graph, trigger, origin, legacyValueType, variablesById, orchestratorSchemasById } = context
  for (const node of graph.nodes) {
    if (node.type !== "condition") continue

    if (node.config.group) {
      // AND/OR (Parte 3) — cada regra é validada com a MESMA função de uma Condition simples.
      // historicalQuery não é suportado dentro de um grupo (ver graph-schema.ts) — nada a
      // validar além do que já está no schema (min 1 regra).
      node.config.group.rules.forEach((rule, index) => {
        validateSourcePathRule(`${node.label} (regra ${index + 1})`, rule, graph, variablesById, orchestratorSchemasById)
      })
      continue
    }

    if (node.config.historicalQuery || node.config.performanceQuery) {
      validateDataConditionConfig(`O nó de condição "${node.label}"`, node.config, "WORKFLOW_INVALID_CONDITION")
      continue
    }

    if (node.config.sourcePath !== undefined) {
      validateSourcePathRule(node.label, node.config, graph, variablesById, orchestratorSchemasById)
      continue
    }

    // Modo legado: compara o valor bruto do trigger — só faz sentido quando o trigger
    // realmente fornece um ("channel_flag"/"indicator"); agenda não fornece. O Manual com medição carrega o valor da
    // medição escolhida; com interação não há valor de flag (ninguém "disparou" flag nenhuma).
    if (trigger.kind === "manual" && origin !== "indicator") {
      throw new DomainError(
        `O nó de condição "${node.label}" compara o valor do gatilho, mas o gatilho Manual ${origin === "channel_flag" ? "com interação não carrega valor de flag" : "por colaborador não fornece nenhum"} — use histórico/indicador ou o resultado de um nó anterior.`,
        "WORKFLOW_INVALID_CONDITION",
        422,
      )
    }
    if (trigger.kind === "schedule") {
      throw new DomainError(
        `O nó de condição "${node.label}" compara o valor do gatilho, mas o gatilho por agenda não fornece nenhum — use reincidência ou resultado de um nó anterior.`,
        "WORKFLOW_INVALID_CONDITION",
        422,
      )
    }
    if (legacyValueType === "BOOLEAN") {
      if (node.config.comparator !== "EQUALS" || node.config.thresholdBoolean === undefined || node.config.thresholdBoolean === null) {
        throw new DomainError(
          `O nó de condição "${node.label}" precisa de uma condição "é igual a" com verdadeiro/falso, pois a flag do gatilho é booleana.`,
          "WORKFLOW_INVALID_CONDITION",
          422,
        )
      }
    } else if (node.config.thresholdNumeric === undefined || node.config.thresholdNumeric === null) {
      throw new DomainError(`O nó de condição "${node.label}" precisa de um valor numérico.`, "WORKFLOW_INVALID_CONDITION", 422)
    }
  }
}
