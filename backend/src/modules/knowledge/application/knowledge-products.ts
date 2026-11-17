import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * PRODUTOS CADASTRADOS de uma base (Produtos e aplicabilidade: `product_scope_assignments` vigente × `product_catalog_nodes` ativos), no
 * formato que entra no texto do vetor: "Família › Produto" (nó de família sozinho = só o nome), separados por "; ", em ordem fixa. É
 * dado do administrador — a busca nunca adivinha produto pelo texto. Um único SQL serve à consulta e à indexação (a mesma string → o
 * mesmo hash).
 */
export function knowledgeProductsSql(documentRef: string, organizationRef: string): string {
  return `(select string_agg(case when p.id is null then n.name else p.name || ' › ' || n.name end, '; ' order by coalesce(p.name, n.name), n.name)
     from product_scope_assignments a
     cross join unnest(a.node_ids) as nid(id)
     join product_catalog_nodes n on n.id = nid.id and n.active
     left join product_catalog_nodes p on p.id = n.parent_id
    where a.organization_id = ${organizationRef} and a.source_kind = 'KNOWLEDGE_DOCUMENT' and a.source_id = ${documentRef}
      and a.effective_until is null and a.effective_from <= now())`
}

export async function loadKnowledgeProducts(db: Pick<Database, "query">, organizationId: string, documentIds: readonly string[]): Promise<Map<string, string>> {
  if (documentIds.length === 0) return new Map()
  const rows = (await db.query<{ id: string; products: string | null }>(`select d.id, ${knowledgeProductsSql("d.id", "d.organization_id")} products from unnest($2::uuid[]) as d0(id) join knowledge_documents d on d.id = d0.id and d.organization_id = $1`, [organizationId, [...documentIds]])).rows
  return new Map(rows.flatMap((row) => (row.products ? [[row.id, row.products] as const] : [])))
}
