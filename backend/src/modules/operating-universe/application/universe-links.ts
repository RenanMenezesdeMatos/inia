import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { OPERATING_UNIVERSE_LABELS, asOperatingUniverse, type OperatingUniverse } from "../domain/operating-universe.js"

/**
 * VÍNCULOS × UNIVERSO — produto pertence a exatamente um universo; base de conhecimento ligada a produtos ("Vale para", abrangência em vigor em
 * `product_scope_assignments`, ou a do rascunho) precisa ser do MESMO universo de cada PRODUTO ligado. Categoria (FAMILY) não tem universo:
 * vale para os produtos dela, então o conflito é medido produto a produto. Pendente de qualquer lado não é conflito (é pendência).
 */
type Queryable = Pick<Database, "query">

export type UniverseLinkConflict = {
  sourceKind: "KNOWLEDGE_DOCUMENT" | "ARGUMENT_SCRIPT"
  sourceId: string
  sourceName: string
  sourceUniverse: OperatingUniverse | null
  productId: string
  productName: string
  productUniverse: OperatingUniverse | null
  /** O produto entrou pela categoria escolhida (não diretamente). */
  viaCategoryId: string | null
}


/** Produtos (diretos ou dentro das categorias escolhidas) com universo diferente de `universe`. */
export async function incompatibleProducts(db: Queryable, organizationId: string, nodeIds: readonly string[], universe: OperatingUniverse | null): Promise<{ id: string; name: string; operatingUniverse: OperatingUniverse; viaCategoryId: string | null }[]> {
  if (universe === null || nodeIds.length === 0) return []
  const rows = (await db.query<{ id: string; name: string; operating_universe: string; via: string | null }>(
    `with recursive chosen as (
       select n.id, n.kind, n.name, n.operating_universe, null::uuid via from product_catalog_nodes n where n.organization_id = $1 and n.id = any($2::uuid[])
       union
       select c.id, c.kind, c.name, c.operating_universe, coalesce(chosen.via, chosen.id) from product_catalog_nodes c join chosen on c.parent_id = chosen.id and chosen.kind = 'FAMILY'
     )
     select distinct on (id) id, name, operating_universe, via from chosen where kind = 'PRODUCT' and operating_universe is not null and operating_universe <> $3 order by id, via nulls first`,
    [organizationId, [...nodeIds], universe],
  )).rows
  return rows.map((row) => ({ id: row.id, name: row.name, operatingUniverse: row.operating_universe as OperatingUniverse, viaCategoryId: row.via }))
}

/** Escolha de produtos para um recurso: produto DIRETO de outro universo = 422 (a tela só oferece os compatíveis). */
export async function assertProductsCompatible(db: Queryable, organizationId: string, nodeIds: readonly string[], universe: OperatingUniverse | null): Promise<void> {
  const direct = (await incompatibleProducts(db, organizationId, nodeIds, universe)).filter((product) => product.viaCategoryId === null)
  if (direct.length > 0) {
    throw new DomainError(
      `Estes produtos são de outro universo de atuação e não podem ser ligados a um recurso ${OPERATING_UNIVERSE_LABELS[universe!]}: ${direct.map((product) => `${product.name} (${product.operatingUniverse})`).join(", ")}.`,
      "OPERATING_UNIVERSE_PRODUCT_INCOMPATIBLE",
      422,
      { products: direct },
    )
  }
}

/**
 * Conflitos EXISTENTES (abrangência por produto em vigor) — a lista que a regularização mostra antes de ativar o filtro. Filtrável por
 * recurso ou por produto, para conferir a mudança de universo de um dos lados antes de salvar.
 */
export async function existingUniverseConflicts(db: Queryable, organizationId: string, filter: { sourceId?: string; productId?: string; overrideSourceUniverse?: OperatingUniverse | null; overrideProductUniverse?: OperatingUniverse | null } = {}): Promise<UniverseLinkConflict[]> {
  const rows = (await db.query<{ source_kind: "KNOWLEDGE_DOCUMENT" | "ARGUMENT_SCRIPT"; source_id: string; source_name: string; source_universe: string | null; product_id: string; product_name: string; product_universe: string | null; via: string | null }>(
    `with open_links as (
       select a.source_kind, a.source_id, unnest(a.node_ids) node_id from product_scope_assignments a
        where a.organization_id = $1 and a.effective_until is null and ($2::uuid is null or a.source_id = $2)
     ), products as (
       select l.source_kind, l.source_id, n.id product_id, n.name product_name, n.operating_universe product_universe, null::uuid via
         from open_links l join product_catalog_nodes n on n.id = l.node_id and n.kind = 'PRODUCT'
       union all
       select l.source_kind, l.source_id, c.id, c.name, c.operating_universe, f.id
         from open_links l join product_catalog_nodes f on f.id = l.node_id and f.kind = 'FAMILY' join product_catalog_nodes c on c.parent_id = f.id and c.kind = 'PRODUCT'
     )
     select p.source_kind, p.source_id,
            coalesce(kd.title, s.name, 'Recurso') source_name,
            case when p.source_kind = 'KNOWLEDGE_DOCUMENT' then kd.operating_universe end source_universe,
            p.product_id, p.product_name,
            case when p.product_id = $3::uuid and $4::boolean then $5::text else p.product_universe end product_universe, p.via
       from products p
       left join knowledge_documents kd on p.source_kind = 'KNOWLEDGE_DOCUMENT' and kd.id = p.source_id and kd.deleted_at is null
       left join argument_scripts s on p.source_kind = 'ARGUMENT_SCRIPT' and s.id = p.source_id
      where ($3::uuid is null or p.product_id = $3::uuid)
        and (kd.id is not null or s.id is not null)`,
    [organizationId, filter.sourceId ?? null, filter.productId ?? null, filter.overrideProductUniverse !== undefined, filter.overrideProductUniverse ?? null],
  )).rows
  return rows
    .map((row) => ({
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      sourceName: row.source_name,
      sourceUniverse: filter.overrideSourceUniverse !== undefined && row.source_id === filter.sourceId ? filter.overrideSourceUniverse : asOperatingUniverse(row.source_universe),
      productId: row.product_id,
      productName: row.product_name,
      productUniverse: asOperatingUniverse(row.product_universe),
      viaCategoryId: row.via,
    }))
    .filter((row) => row.sourceUniverse !== null && row.productUniverse !== null && row.sourceUniverse !== row.productUniverse)
}

export function linkConflictError(conflicts: readonly UniverseLinkConflict[]): DomainError {
  const lines = conflicts.slice(0, 10).map((conflict) => `${conflict.sourceName} (${conflict.sourceUniverse}) × ${conflict.productName} (${conflict.productUniverse})`)
  return new DomainError(
    `A mudança deixaria vínculos com universos diferentes. Resolva antes de salvar: ${lines.join("; ")}${conflicts.length > 10 ? ` e mais ${conflicts.length - 10}` : ""}.`,
    "OPERATING_UNIVERSE_LINK_CONFLICT",
    409,
    { conflicts },
  )
}
