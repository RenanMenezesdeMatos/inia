import type { AnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import type { QueryTableCard } from "../domain/view-models.js"
import { officialQuery } from "./official-query.js"
import { operationalQuery } from "./operational-query.js"
import type { IndicatorQueryInput } from "./query-common.js"

/**
 * CONSULTA FLEXÍVEL de indicadores no escopo da sessão — a INIA monta o pedido (indicadores ou PRV, visão, recorte, competências e
 * como lê-las, filtros, ordenação) e o backend calcula. Duas fontes, nunca misturadas: OFICIAL (fechamento mensal persistido) e
 * OPERACIONAL (medição diária do período em curso). O resultado é uma tabela (`QUERY_TABLE`) e a mesma tabela em markdown.
 */
export async function runIndicatorQuery(repository: AnalyticsReadRepository, scope: ViewerScope, input: IndicatorQueryInput): Promise<QueryTableCard> {
  return input.source === "OPERATIONAL" ? operationalQuery(repository, scope, input) : officialQuery(repository, scope, input)
}

export { PRV_CODE, PRV_DEFINITION } from "./official-query.js"
export { MAX_QUERY_ROWS, queryTableMarkdown, type IndicatorQueryInput, type PeriodMode, type QueryGrouping, type QuerySituation, type QuerySort, type QueryView } from "./query-common.js"
