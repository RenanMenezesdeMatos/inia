import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { FlowGraph, HistoricalPeriod } from "../domain/graph-schema.js"
import type { TriggerConfig } from "../domain/trigger-config-schema.js"

/**
 * Publish × CAPACIDADES do indicador (catálogo metadata-driven, migration 055). O Workflow
 * Engine descobre indicadores pelo catálogo — nunca por lista — e aqui garante que cada
 * referência é compatível com o que o indicador declara:
 *
 * - existe e está ATIVO (indicador desativado não entra em Workflow novo; os já publicados
 *   continuam abrindo pra auditoria — este check só roda no publish/dry-run);
 * - janela OPERACIONAL (últimos N dias, dia/semana civil, quartil operacional) só com medição
 *   operacional habilitada (`daily_supported`);
 * - fonte OFICIAL (Atingimento/Quartil do indicador, fechamentos) só com fechamento oficial
 *   habilitado (`official_closure_supported`).
 *
 * Uma consulta ao catálogo por publish (todos os códigos de uma vez), nunca por nó.
 */
type CatalogRow = { code: string; name: string; active: boolean; daily_supported: boolean; official_closure_supported: boolean }

type IndicatorUse = {
  code: string
  subject: string
  nodeId?: string
  errorCode: string
  needsOperational: boolean
  needsOfficial: boolean
}

/** Janela menor que um mês civil só existe com medição operacional diária. */
export function isOperationalWindow(period: HistoricalPeriod | undefined): boolean {
  if (!period) return false
  if (period.kind === "ROLLING_DAYS") return true
  if (period.kind === "CALENDAR") return period.unit === "DAY" || period.unit === "WEEK"
  return false
}

export function collectIndicatorUses(graph: FlowGraph, trigger: TriggerConfig | null): IndicatorUse[] {
  const uses: IndicatorUse[] = []
  for (const node of graph.nodes) {
    if (node.type === "condition") {
      const subject = `O nó de condição "${node.label}"`
      const query = node.config.historicalQuery
      if (query?.indicatorCode) {
        const source = query.source ?? "MEASUREMENT"
        uses.push({
          code: query.indicatorCode,
          subject,
          nodeId: node.id,
          errorCode: "WORKFLOW_INVALID_CONDITION",
          needsOperational: source === "OPERATIONAL_QUARTILE" || (source === "MEASUREMENT" && isOperationalWindow(query.period)),
          needsOfficial: source === "INDICATOR_ACHIEVEMENT",
        })
      }
      const performance = node.config.performanceQuery
      if (performance?.indicatorCode && performance.metric.startsWith("INDICATOR_")) {
        uses.push({ code: performance.indicatorCode, subject, nodeId: node.id, errorCode: "WORKFLOW_INVALID_CONDITION", needsOperational: false, needsOfficial: true })
      }
    }
    if (node.type === "select_employees") {
      const criterion = node.config.criterion
      if (criterion?.historicalQuery?.indicatorCode) {
        const query = criterion.historicalQuery
        const source = query.source ?? "MEASUREMENT"
        uses.push({
          code: criterion.historicalQuery.indicatorCode,
          subject: `O critério de seleção do nó "${node.label}"`,
          nodeId: node.id,
          errorCode: "WORKFLOW_INVALID_SELECTION_CRITERION",
          needsOperational: source === "OPERATIONAL_QUARTILE" || (source === "MEASUREMENT" && isOperationalWindow(query.period)),
          needsOfficial: source === "INDICATOR_ACHIEVEMENT",
        })
      }
      if (criterion?.performanceQuery?.indicatorCode && criterion.performanceQuery.metric.startsWith("INDICATOR_")) {
        uses.push({ code: criterion.performanceQuery.indicatorCode, subject: `O critério de seleção do nó "${node.label}"`, nodeId: node.id, errorCode: "WORKFLOW_INVALID_SELECTION_CRITERION", needsOperational: false, needsOfficial: true })
      }
      const ranking = node.config.ranking
      if (node.config.selectionMode === "RANKING" && ranking?.indicatorCode) {
        const source = ranking.source ?? "MEASUREMENT"
        uses.push({
          code: ranking.indicatorCode,
          subject: `A configuração de ranking do nó "${node.label}"`,
          nodeId: node.id,
          errorCode: "WORKFLOW_INVALID_SELECTION_RANKING",
          needsOperational: source === "MEASUREMENT" && (ranking.selection === "OPERATIONAL_QUARTILE" || isOperationalWindow(ranking.period)),
          needsOfficial: source === "INDICATOR_ACHIEVEMENT",
        })
      }
    }
    if (node.type === "action" && node.config.actionType === "CALL_AGENT" && node.config.scheduledDataSource?.kind === "INDICATOR" && node.config.scheduledDataSource.indicatorCode) {
      uses.push({ code: node.config.scheduledDataSource.indicatorCode, subject: `O nó "${node.label}"`, nodeId: node.id, errorCode: "WORKFLOW_INVALID_ACTION", needsOperational: false, needsOfficial: false })
    }
  }
  if (trigger?.kind === "indicator") {
    uses.push({ code: trigger.indicatorCode, subject: "O gatilho por indicador", errorCode: "WORKFLOW_INVALID_TRIGGER", needsOperational: false, needsOfficial: false })
  }
  return uses
}

export async function validateIndicatorCapabilities(db: Database, organizationId: string, graph: FlowGraph, trigger: TriggerConfig | null): Promise<void> {
  const uses = collectIndicatorUses(graph, trigger)
  if (uses.length === 0) return
  const codes = [...new Set(uses.map((use) => use.code))]
  const result = await db.query<CatalogRow>(
    `select code, name, active, daily_supported, official_closure_supported from indicator_definitions where organization_id = $1 and code = any($2::text[])`,
    [organizationId, codes],
  )
  const catalog = new Map(result.rows.map((row) => [row.code, row]))
  for (const use of uses) {
    const details = use.nodeId ? { nodeId: use.nodeId } : undefined
    const indicator = catalog.get(use.code)
    if (!indicator) throw new DomainError(`${use.subject} usa o indicador "${use.code}", que não existe no catálogo.`, "INDICATOR_NOT_FOUND", 404, details)
    if (!indicator.active) {
      throw new DomainError(`${use.subject} usa o indicador "${indicator.name}", que está desativado — indicadores desativados não entram em Workflows novos.`, "WORKFLOW_INDICATOR_INACTIVE", 422, details)
    }
    if (use.needsOperational && !indicator.daily_supported) {
      throw new DomainError(
        `${use.subject} usa uma janela operacional (dias, semana ou quartil operacional) para "${indicator.name}", que não tem medição operacional habilitada — use períodos mensais/fechamentos ou habilite a medição operacional no catálogo de indicadores.`,
        "WORKFLOW_INDICATOR_NOT_OPERATIONAL",
        422,
        details,
      )
    }
    if (use.needsOfficial && !indicator.official_closure_supported) {
      throw new DomainError(
        `${use.subject} usa o fechamento oficial (atingimento/quartil) de "${indicator.name}", que não tem fechamento oficial habilitado — use o Valor do indicador (medição operacional).`,
        "WORKFLOW_INDICATOR_NO_OFFICIAL_CLOSURE",
        422,
        details,
      )
    }
  }
}
