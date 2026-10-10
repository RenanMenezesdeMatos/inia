import type { Database } from "../../../../infrastructure/database/pool.js"
import { loadEffectiveStrategy } from "../../../indicator-diagnosis/application/diagnostic-strategy-service.js"
import { allowedMeasurementAggregations, isMeasurementAggregationAllowed, MEASUREMENT_AGGREGATION_LABELS, OPERATIONAL_AGGREGATION_LABELS, type MeasurementAggregation, type OperationalAggregationKind } from "../../../indicators/domain/operational-aggregation.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { isClosingDiagnosisSource, type HistoricalQuery, type HistoricalSource } from "../../domain/graph-schema.js"
import { validateIndicatorCapabilities } from "../validate-indicator-capabilities.js"
import type { PublishTriggerContext } from "./context.js"

// Família INDICADOR E ESTRATÉGIA: diagnóstico do fechamento do PRV e do indicador (estratégia publicada), semântica
// operacional e capacidades do indicador. Espelho no editor: workflow-validation/indicator-diagnosis.ts.

/**
 * Agregação x semântica operacional do indicador (`indicator_definitions.operational_aggregation`,
 * migration 052) — assíncrona porque depende do catálogo. Média simples de TMA/taxa com
 * volumes diferentes por dia é matemática errada (média de médias) e SUM de TMA não significa
 * nada: o editor só oferece o permitido, e aqui um payload manual é rejeitado do mesmo jeito.
 */
async function validateMeasurementAggregation(db: Database, organizationId: string, subject: string, indicatorCode: string | undefined, aggregation: string, errorCode: string): Promise<void> {
  if (!indicatorCode) return
  const result = await db.query<{ operational_aggregation: string | null }>(`select operational_aggregation from indicator_definitions where code = $1 and organization_id = $2`, [indicatorCode, organizationId])
  const kind = (result.rows[0]?.operational_aggregation ?? "AVERAGE") as OperationalAggregationKind
  if (!isMeasurementAggregationAllowed(kind, aggregation)) {
    const allowed = allowedMeasurementAggregations(kind).map((item) => MEASUREMENT_AGGREGATION_LABELS[item]).join(", ")
    throw new DomainError(
      `${subject} usa "${MEASUREMENT_AGGREGATION_LABELS[aggregation as MeasurementAggregation] ?? aggregation}" para ${indicatorCode}, cuja semântica operacional é "${OPERATIONAL_AGGREGATION_LABELS[kind]}" — agregações válidas: ${allowed}.`,
      errorCode,
      422,
    )
  }
}

/** Valor do indicador e Quartil operacional leem `indicator_measurements` — as duas fontes da camada operacional. */
function isOperationalSource(source: HistoricalSource | undefined): boolean {
  return source === undefined || source === "MEASUREMENT" || source === "OPERATIONAL_QUARTILE"
}

/** Quartil operacional exige direção oficial HIGHER/LOWER (mesma regra do Ranking por quartil — Parte 35). */
async function validateOperationalQuartileDirection(db: Database, organizationId: string, nodeLabel: string, query: HistoricalQuery, errorCode: string): Promise<void> {
  if (query.source !== "OPERATIONAL_QUARTILE" || !query.indicatorCode) return
  const indicator = await db.query<{ desired_direction: string }>(`select desired_direction from indicator_definitions where code = $1 and organization_id = $2`, [query.indicatorCode, organizationId])
  if (!indicator.rows[0]) throw new DomainError(`Indicador "${query.indicatorCode}" não encontrado.`, "INDICATOR_NOT_FOUND", 404)
  if (indicator.rows[0].desired_direction === "TARGET") {
    throw new DomainError(
      `O nó "${nodeLabel}" usa Quartil operacional para um indicador sem direção de desempenho oficial definida (meta por faixa/alvo — "TARGET"). Sem direção HIGHER/LOWER não há regra de classificação em quartis.`,
      errorCode,
      422,
    )
  }
}

/** Diagnóstico do fechamento do PRV: Agenda (ou Manual por colaborador) com a fonte "Fechamentos oficiais". */
export function validatePrvClosingDiagnosis(context: PublishTriggerContext): void {
  const { graph, origin } = context
  // INDICATOR DIAGNOSIS V1 — diagnóstico do FECHAMENTO do PRV: agenda (um colaborador por execução) + fonte "Fechamentos oficiais".
  for (const node of graph.nodes) {
    if (node.type !== "action" || node.config.actionType !== "CALL_AGENT" || node.config.outputContract !== "PRV_CLOSING_DIAGNOSIS") continue
    if (origin !== "schedule" || node.config.scheduledDataSource?.kind !== "PERFORMANCE") {
      throw new DomainError(
        `O nó "${node.label}" usa o formato "Diagnóstico do fechamento do PRV", que parte do fechamento oficial — só com gatilho por Agenda (ou Manual por colaborador) e a fonte de dados "Fechamentos oficiais".`,
        "WORKFLOW_PRV_DIAGNOSIS_REQUIRES_SCHEDULE",
        422,
        { nodeId: node.id },
      )
    }
  }
}

/** Diagnóstico do indicador: direto do fechamento (Agenda) ou da medição do gatilho, sempre com estratégia publicada. */
export async function validateIndicatorDiagnosis(context: PublishTriggerContext): Promise<void> {
  const { db, organizationId, graph, origin, triggerIndicatorCode } = context
  // INDICATOR DIAGNOSIS V2 — "Diagnóstico do indicador" com Agenda + "Fechamentos oficiais" + UM indicador = diagnóstico DIRETO do
  // fechamento oficial desse indicador (sem PRV). O COMO investigar continua do Indicador (estratégia publicada e ativa).
  const directDiagnosisNodes = graph.nodes.filter((node) => origin === "schedule" && isClosingDiagnosisSource(node) && node.type === "action" && node.config.actionType === "CALL_AGENT" && node.config.outputContract === "INDICATOR_DIAGNOSIS")
  for (const node of directDiagnosisNodes) {
    if (node.type !== "action" || node.config.actionType !== "CALL_AGENT") continue
    const indicatorCode = node.config.scheduledDataSource?.kind === "PERFORMANCE" ? node.config.scheduledDataSource.indicatorCode ?? null : null
    const indicator = indicatorCode ? (await db.query<{ id: string; active: boolean; official_closure_supported: boolean }>(`select id, active, official_closure_supported from indicator_definitions where code = $1 and organization_id = $2`, [indicatorCode, organizationId])).rows[0] : undefined
    if (!indicator) throw new DomainError(`O nó "${node.label}" diagnostica um indicador que não existe.`, "INDICATOR_NOT_FOUND", 404, { nodeId: node.id })
    if (!indicator.active || !indicator.official_closure_supported) throw new DomainError(`O nó "${node.label}" diagnostica um indicador inativo ou sem fechamento oficial.`, "WORKFLOW_INDICATOR_DIAGNOSIS_INDICATOR_UNAVAILABLE", 422, { nodeId: node.id })
    const strategy = await loadEffectiveStrategy(db, organizationId, { id: indicator.id })
    if (!strategy) {
      throw new DomainError(`O nó "${node.label}" usa o formato "Diagnóstico do indicador", mas o indicador não tem estratégia de diagnóstico publicada e ativa. Configure-a em Indicadores › Diagnóstico com IA.`, "WORKFLOW_INDICATOR_DIAGNOSIS_STRATEGY_MISSING", 422, { nodeId: node.id })
    }
    if (strategy.config.allowedBusinessDomainIds.length > 0) {
      const domain = (await db.query<{ business_domain_id: string | null }>(`select business_domain_id from agents where id = $1 and organization_id = $2`, [node.config.agentId, organizationId])).rows[0]?.business_domain_id ?? null
      if (!domain || !strategy.config.allowedBusinessDomainIds.includes(domain)) throw new DomainError(`O Agent do nó "${node.label}" não pertence a um domínio permitido na estratégia de diagnóstico do indicador.`, "WORKFLOW_INDICATOR_DIAGNOSIS_DOMAIN_NOT_ALLOWED", 422, { nodeId: node.id })
    }
  }

  // V1.6.1 — diagnóstico do indicador parte de UMA medição (a do gatilho por Indicador): fora dele não há o que decompor.
  if (origin !== "indicator" || !triggerIndicatorCode) {
    const diagnosisNode = graph.nodes.find((node) => node.type === "action" && node.config.actionType === "CALL_AGENT" && node.config.outputContract === "INDICATOR_DIAGNOSIS" && !directDiagnosisNodes.includes(node))
    if (diagnosisNode) {
      throw new DomainError(
        origin === "schedule"
          ? `O nó "${diagnosisNode.label}" usa o formato "Diagnóstico do indicador" com gatilho por Agenda: escolha a fonte "Fechamentos oficiais" e o indicador diagnosticado.`
          : `O nó "${diagnosisNode.label}" usa o formato "Diagnóstico do indicador", que parte da medição de um indicador — só disponível com gatilho por Indicador (ou Manual com medição de indicador).`,
        "WORKFLOW_INDICATOR_DIAGNOSIS_REQUIRES_INDICATOR",
        422,
      )
    }
  } else {
    // V1.6.2 — o COMO investigar é do Indicador (estratégia publicada); o Workflow só decide quando, qual Agent e a sequência.
    const diagnosisNodes = graph.nodes.filter((node) => node.type === "action" && node.config.actionType === "CALL_AGENT" && node.config.outputContract === "INDICATOR_DIAGNOSIS")
    if (diagnosisNodes.length > 0) {
      const strategy = await loadEffectiveStrategy(db, organizationId, { code: triggerIndicatorCode })
      if (!strategy) {
        throw new DomainError(
          `O nó "${diagnosisNodes[0]!.label}" usa o formato "Diagnóstico do indicador", mas o indicador não tem estratégia de diagnóstico publicada e ativa. Configure-a em Indicadores › Diagnóstico com IA.`,
          "WORKFLOW_INDICATOR_DIAGNOSIS_STRATEGY_MISSING",
          422,
        )
      }
      if (strategy.config.allowedBusinessDomainIds.length > 0) {
        for (const node of diagnosisNodes) {
          const agentId = node.type === "action" && node.config.actionType === "CALL_AGENT" ? node.config.agentId : null
          const domain = agentId ? (await db.query<{ business_domain_id: string | null }>(`select business_domain_id from agents where id = $1 and organization_id = $2`, [agentId, organizationId])).rows[0]?.business_domain_id ?? null : null
          if (!domain || !strategy.config.allowedBusinessDomainIds.includes(domain)) {
            throw new DomainError(
              `O Agent do nó "${node.label}" não pertence a um domínio permitido na estratégia de diagnóstico do indicador.`,
              "WORKFLOW_INDICATOR_DIAGNOSIS_DOMAIN_NOT_ALLOWED",
              422,
            )
          }
        }
      }
    }
  }
}

/** Agregação × semântica operacional, direção oficial do quartil e capacidades de cada indicador usado. */
export async function validateIndicatorUsage(context: PublishTriggerContext): Promise<void> {
  const { db, organizationId, graph, trigger, triggerIndicatorCode } = context
  // "Selecionar colaboradores" em modo Ranking (evolução de Ranking) — forma/presença primeiro
  // (síncrono, mesmo padrão do critério acima); "Melhores"/"Piores" (Parte 9/10/17/18 do pedido
  // original) e — nesta evolução — "Evolução"/"Queda" (Parte 18/70/82) SEMPRE, então exigem a
  // direção OFICIAL do indicador (`indicator_definitions.desired_direction` — única fonte
  // confiável, nunca inferida do nome), por isso são a ÚNICA parte async daqui — "Maiores"/
  // "Menores" são puramente matemáticos e nunca precisam dessa consulta (Parte 12 original).
  // Indicador com direção "TARGET" (meta por faixa, sem HIGHER/LOWER definido) não tem
  // Melhores/Piores nem Evolução/Queda disponível nesta V1 (Parte 11 original/18 desta evolução
  // — nunca inventa, só bloqueia com mensagem clara).
  // Agregação x semântica operacional do indicador (Condition, critério e Ranking sobre medições).
  for (const node of graph.nodes) {
    if (node.type === "condition" && node.config.historicalQuery && isOperationalSource(node.config.historicalQuery.source)) {
      await validateMeasurementAggregation(db, organizationId, `O nó de condição "${node.label}"`, node.config.historicalQuery.indicatorCode, node.config.historicalQuery.aggregation ?? "COUNT", "WORKFLOW_INVALID_CONDITION")
      await validateOperationalQuartileDirection(db, organizationId, node.label, node.config.historicalQuery, "WORKFLOW_INVALID_CONDITION")
    }
    if (node.type === "select_employees" && node.config.criterion?.historicalQuery && isOperationalSource(node.config.criterion.historicalQuery.source)) {
      await validateMeasurementAggregation(db, organizationId, `O critério de seleção do nó "${node.label}"`, node.config.criterion.historicalQuery.indicatorCode, node.config.criterion.historicalQuery.aggregation ?? "COUNT", "WORKFLOW_INVALID_SELECTION_CRITERION")
      await validateOperationalQuartileDirection(db, organizationId, node.label, node.config.criterion.historicalQuery, "WORKFLOW_INVALID_SELECTION_CRITERION")
    }
    if (node.type === "select_employees" && node.config.selectionMode === "RANKING" && node.config.ranking && (node.config.ranking.source ?? "MEASUREMENT") === "MEASUREMENT" && node.config.ranking.aggregation) {
      await validateMeasurementAggregation(db, organizationId, `A configuração de ranking do nó "${node.label}"`, node.config.ranking.indicatorCode, node.config.ranking.aggregation, "WORKFLOW_INVALID_SELECTION_RANKING")
    }
  }

  // Capacidades do indicador (catálogo metadata-driven): ativo, medição operacional pra janelas
  // operacionais, fechamento oficial pra fontes oficiais — ver validate-indicator-capabilities.ts.
  await validateIndicatorCapabilities(db, organizationId, graph, trigger.kind === "manual" ? (triggerIndicatorCode ? { kind: "indicator", indicatorCode: triggerIndicatorCode } : null) : trigger)
}
