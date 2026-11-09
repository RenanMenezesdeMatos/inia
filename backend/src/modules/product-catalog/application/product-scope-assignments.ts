import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"

/**
 * A abrangência por produto EM VIGOR de uma fonte (`product_scope_assignments`): o registro imutável do que valeu em cada data, lido pelo
 * motor de feedback. Argumentário grava aqui na hora; base de conhecimento só na transição da versão (PEN-008, `knowledge-versions.ts`).
 */
type Queryable = Pick<Database, "query">

export type ProductScopeSourceKind = "KNOWLEDGE_DOCUMENT" | "ARGUMENT_SCRIPT"

export const normalizedProductNodeIds = (nodeIds: readonly string[]) => [...new Set(nodeIds)].sort()
export const sameProductNodeIds = (left: readonly string[], right: readonly string[]) => normalizedProductNodeIds(left).join(",") === normalizedProductNodeIds(right).join(",")

export async function openProductNodeIds(db: Queryable, organizationId: string, kind: ProductScopeSourceKind, sourceId: string): Promise<string[]> {
  return (await db.query<{ node_ids: string[] }>(`select node_ids from product_scope_assignments where organization_id = $1 and source_kind = $2 and source_id = $3 and effective_until is null limit 1`, [organizationId, kind, sourceId])).rows[0]?.node_ids ?? []
}

/** Todos ativos e da organização: o id vem de quem chama, e uma versão pode guardar um produto desativado ou excluído depois. */
export async function assertProductNodesActive(db: Queryable, organizationId: string, nodeIds: readonly string[]): Promise<void> {
  const wanted = normalizedProductNodeIds(nodeIds)
  if (wanted.length === 0) return
  const active = (await db.query<{ id: string }>(`select id from product_catalog_nodes where organization_id = $1 and active and id = any($2::uuid[])`, [organizationId, wanted])).rows
  if (active.length !== wanted.length) throw new DomainError("Escolha só produtos ou categorias ativos.", "PRODUCT_SCOPE_TARGET_INVALID", 422)
}

export type ProductScopeApplied = { changed: false } | { changed: true; before: string[]; after: string[]; assignmentId: string }

/**
 * Passa a valer a lista dada, A PARTIR de `at`: a anterior termina em `at` e nunca é apagada nem reescrita, porque a análise de uma chamada
 * anterior usa a que valia na data dela. Lista vazia = vale para qualquer produto. Sem mudança, não grava nada.
 */
export async function applyProductScopeAssignment(client: Queryable, input: { organizationId: string; kind: ProductScopeSourceKind; sourceId: string; nodeIds: readonly string[]; actorPersonId: string | null; at: Date }): Promise<ProductScopeApplied> {
  const nodeIds = normalizedProductNodeIds(input.nodeIds)
  await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`product-scope:${input.sourceId}`])
  const open = (await client.query<{ id: string; node_ids: string[] }>(`select id, node_ids from product_scope_assignments where organization_id = $1 and source_kind = $2 and source_id = $3 and effective_until is null`, [input.organizationId, input.kind, input.sourceId])).rows[0]
  if (open ? sameProductNodeIds(open.node_ids, nodeIds) : nodeIds.length === 0) return { changed: false }
  if (open) await client.query(`update product_scope_assignments set effective_until = $2, ended_by = $3 where id = $1`, [open.id, input.at, input.actorPersonId])
  const created = nodeIds.length === 0
    ? null
    : (await client.query<{ id: string }>(`insert into product_scope_assignments (organization_id, source_kind, source_id, node_ids, effective_from, created_by) values ($1,$2,$3,$4,$5,$6) returning id`, [input.organizationId, input.kind, input.sourceId, nodeIds, input.at, input.actorPersonId])).rows[0]!.id
  return { changed: true, before: open?.node_ids ?? [], after: nodeIds, assignmentId: created ?? open!.id }
}
