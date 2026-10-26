import type { Database } from "../../../infrastructure/database/pool.js"
import type { ProductCatalogSource } from "../domain/product-catalog.js"

type Queryable = Pick<Database, "query">

/**
 * O CADASTRO COMO VALIA NUMA DATA (leitura do motor de feedback, escopada à organização):
 *   - itens (famílias/produtos) que existiam e estavam ativos na data;
 *   - versões de critérios APROVADAS e vigentes na data (rascunho nunca; aprovada depois ou fora da vigência nunca);
 *   - abrangência por produto vigente na data das fontes apresentadas na análise.
 * Nada é retroativo: o que foi cadastrado ou aprovado depois da chamada não vale para ela. Sem nenhum item = null (sem modo produto).
 */
export async function loadProductCatalogAt(db: Queryable, organizationId: string, at: Date, sourceIds: readonly string[]): Promise<ProductCatalogSource | null> {
  const nodes = (await db.query<{ id: string; code: string; kind: "FAMILY" | "PRODUCT"; name: string; description: string | null; parent_id: string | null }>(
    `select id, code, kind, name, description, parent_id from product_catalog_nodes
      where organization_id = $1 and created_at <= $2 and (archived_at is null or archived_at > $2)
      order by code`,
    [organizationId, at],
  )).rows
  if (nodes.length === 0) return null
  const criteria = (await db.query<{ version_id: string; criterion_id: string; version: number; title: string; statement: string; target_node_ids: string[]; context: string | null; limitations: string | null; strength: "CONCLUSIVE" | "INDICATIVE"; conclusive_when: string | null; source_reference: string | null; source_title: string | null; effective_from: Date; approved_at: Date; content_hash: string }>(
    `select v.id version_id, v.criterion_id, v.version, c.title, v.statement, v.target_node_ids, v.context, v.limitations, v.strength, v.conclusive_when,
            v.source_reference, d.title source_title, v.effective_from, v.approved_at, v.content_hash
       from product_identification_criterion_versions v
       join product_identification_criteria c on c.id = v.criterion_id and c.organization_id = v.organization_id
       left join knowledge_documents d on d.id = v.source_document_id and d.organization_id = v.organization_id
      where v.organization_id = $1 and v.status in ('APPROVED', 'SUPERSEDED') and v.effective_from <= $2 and (v.effective_until is null or v.effective_until > $2)
      order by c.title, v.criterion_id`,
    [organizationId, at],
  )).rows
  const scopes = sourceIds.length === 0 ? [] : (await db.query<{ id: string; source_kind: "KNOWLEDGE_DOCUMENT" | "ARGUMENT_SCRIPT"; source_id: string; node_ids: string[]; effective_from: Date }>(
    `select id, source_kind, source_id, node_ids, effective_from from product_scope_assignments
      where organization_id = $1 and source_id = any($3::uuid[]) and effective_from <= $2 and (effective_until is null or effective_until > $2)`,
    [organizationId, at, [...new Set(sourceIds)]],
  )).rows
  return {
    nodes: nodes.map((node) => ({ id: node.id, code: node.code, kind: node.kind, name: node.name, description: node.description, parentId: node.parent_id })),
    criteria: criteria.map((row) => ({
      criterionId: row.criterion_id,
      versionId: row.version_id,
      version: row.version,
      title: row.title,
      statement: row.statement,
      targetNodeIds: row.target_node_ids,
      context: row.context,
      limitations: row.limitations,
      strength: row.strength,
      conclusiveWhen: row.conclusive_when,
      sourceLabel: [row.source_title, row.source_reference].filter(Boolean).join(" — ") || null,
      effectiveFrom: new Date(row.effective_from).toISOString(),
      approvedAt: new Date(row.approved_at).toISOString(),
      contentHash: row.content_hash,
    })),
    scopes: scopes.map((row) => ({ assignmentId: row.id, sourceKind: row.source_kind, sourceId: row.source_id, nodeIds: row.node_ids, effectiveFrom: new Date(row.effective_from).toISOString() })),
  }
}
