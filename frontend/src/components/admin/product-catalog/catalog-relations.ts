import { normalizeProductCode, type IdentificationCriterionSummary, type ProductNode, type ProductScopeSource } from "@/schemas/admin/product-catalog.schema"

/**
 * Relações do cadastro de produtos vistas a partir de UM produto (ou categoria) — funções puras da tela. A relação entre bases e
 * produtos NÃO é 1×1: uma base pode ser geral (sem produto marcado = vale para todos), de um produto só ou de vários; uma base marcada
 * para uma categoria vale para os produtos dela.
 */

/** As categorias acima de um item (a mais próxima primeiro). */
export function ancestorsOf(nodes: readonly ProductNode[], id: string): ProductNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const out: ProductNode[] = []
  let cursor = byId.get(id)?.parentId ?? null
  while (cursor && out.length < 20) {
    const parent = byId.get(cursor)
    if (!parent) break
    out.push(parent)
    cursor = parent.parentId
  }
  return out
}

export type ScopeKind = "GENERAL" | "SPECIFIC" | "SHARED"
/** Como uma base vale: geral (todos os produtos), específica (um produto/categoria) ou de vários. */
export const scopeKindOf = (source: Pick<ProductScopeSource, "scope">): ScopeKind => (!source.scope || source.scope.nodeIds.length === 0 ? "GENERAL" : source.scope.nodeIds.length === 1 ? "SPECIFIC" : "SHARED")

export type BaseOfNode = { source: ProductScopeSource; via: ProductNode | null; others: string[] }
/** Bases que valem para o item: marcadas para ele (direto) ou para uma categoria acima dele (`via`). Gerais ficam de fora (valem para todos). */
export function basesOf(nodes: readonly ProductNode[], sources: readonly ProductScopeSource[], id: string): BaseOfNode[] {
  const ancestors = ancestorsOf(nodes, id)
  return sources.flatMap((source): BaseOfNode[] => {
    const ids = source.scope?.nodeIds ?? []
    if (ids.length === 0) return []
    if (ids.includes(id)) return [{ source, via: null, others: ids.filter((other) => other !== id) }]
    const via = ancestors.find((ancestor) => ids.includes(ancestor.id))
    return via ? [{ source, via, others: ids.filter((other) => other !== via.id) }] : []
  })
}

/** A versão que a tela mostra de um indício: a valendo (ou a mais recente aprovada); sem nenhuma aprovada, o rascunho. */
export const shownVersionOf = (criterion: IdentificationCriterionSummary) => criterion.current ?? criterion.draft

export type ClueOfNode = { criterion: IdentificationCriterionSummary; via: ProductNode | null; others: string[] }
/** Indícios que reconhecem o item: apontam para ele (direto) ou para uma categoria acima dele (`via` — o indício só confirma a categoria). */
export function cluesOf(nodes: readonly ProductNode[], criteria: readonly IdentificationCriterionSummary[], id: string): ClueOfNode[] {
  const ancestors = ancestorsOf(nodes, id)
  return criteria.flatMap((criterion): ClueOfNode[] => {
    const targets = shownVersionOf(criterion)?.content.targetNodeIds ?? []
    if (targets.includes(id)) return [{ criterion, via: null, others: targets.filter((other) => other !== id) }]
    const via = ancestors.find((ancestor) => targets.includes(ancestor.id))
    return via ? [{ criterion, via, others: targets.filter((other) => other !== via.id) }] : []
  })
}

const CODE_MAX = 40
/**
 * Código técnico de um item novo, gerado pelo nome (a tela não mostra código): maiúsculas sem acento, começa por letra ("0800" vira
 * "P_0800") e não repete um código da organização (sufixo _2, _3…). O backend continua sendo a autoridade do formato e da unicidade.
 */
export function codeFromName(name: string, nodes: readonly Pick<ProductNode, "code">[]): string {
  let base = normalizeProductCode(name)
  if (!/^[A-Z]/.test(base)) base = `P_${base}`
  base = base.slice(0, CODE_MAX).replace(/_+$/, "")
  if (base.length < 2) base = "PRODUTO"
  const taken = new Set(nodes.map((node) => node.code))
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`
    const candidate = `${base.slice(0, CODE_MAX - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}
