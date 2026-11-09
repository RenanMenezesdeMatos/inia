import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { OperationalAggregationKind } from "../../indicators/domain/operational-aggregation.js"
import { graphCatalogProblems, indicatorCodesOfGraph, type IndicatorCatalogEntry } from "../domain/indicator-graph-compatibility.js"

/**
 * Defesa de quem RODA um grafo já publicado contra o catálogo vigente. O publish valida na hora de publicar, mas a estratégia
 * de um indicador pode ser corrigida depois (`indicator-correction-service.ts`): ativar um Workflow pausado e uma execução em
 * andamento precisam parar com o motivo, nunca calcular um número sem sentido e seguir o ramo errado.
 */
type Queryable = Pick<Database, "query">

async function loadCatalog(db: Queryable, organizationId: string, codes: readonly string[]): Promise<Map<string, IndicatorCatalogEntry>> {
  const rows = await db.query<{ code: string; operational_aggregation: string | null; desired_direction: string }>(
    `select code, operational_aggregation, desired_direction from indicator_definitions where organization_id = $1 and code = any($2::text[])`,
    [organizationId, codes],
  )
  return new Map(rows.rows.filter((row) => row.operational_aggregation).map((row) => [row.code, { kind: row.operational_aggregation as OperationalAggregationKind, direction: row.desired_direction }]))
}

async function assertGraph(db: Queryable, organizationId: string, graph: unknown, guidance: string): Promise<void> {
  const codes = indicatorCodesOfGraph(graph)
  if (codes.length === 0) return
  const catalog = await loadCatalog(db, organizationId, codes)
  const problem = graphCatalogProblems(graph, (code) => catalog.get(code))[0]
  if (problem) throw new DomainError(`${problem.message} ${guidance}`, problem.errorCode, 422, { nodeId: problem.nodeId, indicatorCode: problem.indicatorCode })
}

/** Um nó na hora de executar: Condição e Selecionar colaboradores. Nó que não depende do catálogo não custa consulta. */
export function assertNodeMatchesIndicatorCatalog(db: Queryable, organizationId: string, node: { id: string; type: string; label: string; config: unknown }): Promise<void> {
  return assertGraph(db, organizationId, { nodes: [node] }, "A estratégia do indicador mudou depois da publicação: ajuste este nó e publique o Workflow de novo.")
}

/** Ativar um Workflow pausado faz a versão publicada valer de novo: confere antes, para não ligar uma automação que só falharia. */
export async function assertPublishedWorkflowMatchesIndicatorCatalog(db: Queryable, organizationId: string, workflowId: string): Promise<void> {
  const published = await db.query<{ graph: unknown }>(
    `select v.graph from workflows w join workflow_versions v on v.id = w.active_version_id where w.id = $1 and w.organization_id = $2`,
    [workflowId, organizationId],
  )
  if (!published.rows[0]) return
  await assertGraph(db, organizationId, published.rows[0].graph, "A estratégia do indicador mudou depois da publicação: ajuste o nó e publique de novo antes de ativar.")
}
