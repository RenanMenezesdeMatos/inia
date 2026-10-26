import { createHash } from "node:crypto"
import { z } from "zod"

/**
 * CATÁLOGO DE PRODUTOS DA OPERAÇÃO (domínio puro) — `PRODUCT_APPLICABILITY_V1`.
 *
 * O código conhece TIPOS (família × produto; critério conclusivo × indicativo), nunca produtos concretos: "SIP", "DDR", "0800",
 * "banda larga"… são dados da organização. Um critério de identificação é texto em linguagem natural (o que a operação escreveria
 * num manual: "conta iniciada em 6999 identifica SIP") — quem o aplica a uma conversa é a LEITURA do modelo; o código só confere
 * que o critério citado está aprovado e vigente na data da chamada, que a evidência existe literalmente e aplica as consequências.
 * Nenhum critério vira expressão regular, prefixo ou lista de palavras.
 */
export const PRODUCT_NODE_KINDS = ["FAMILY", "PRODUCT"] as const
export type ProductNodeKind = (typeof PRODUCT_NODE_KINDS)[number]
export const PRODUCT_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/
export const CRITERION_STRENGTHS = ["CONCLUSIVE", "INDICATIVE"] as const
export type CriterionStrength = (typeof CRITERION_STRENGTHS)[number]
/** Mesma tolerância dos argumentários: a vigência de um critério aprovado agora nunca vale para chamadas anteriores. */
export const APPROVAL_BACKDATE_TOLERANCE_MS = 5 * 60 * 1000

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((value) => (value && value.length > 0 ? value : null))

export const productNodeInputSchema = z.object({
  kind: z.enum(PRODUCT_NODE_KINDS),
  code: z.string().trim().toUpperCase().regex(PRODUCT_CODE_PATTERN, "Use letras maiúsculas, números e _ (começando por letra)."),
  name: z.string().trim().min(2).max(120),
  description: optionalText(2_000),
  parentId: z.string().uuid().nullish().transform((value) => value ?? null),
})
export type ProductNodeInput = z.infer<typeof productNodeInputSchema>
export const productNodePatchSchema = productNodeInputSchema.omit({ kind: true }).partial()

export type ProductNodeRecord = {
  id: string
  kind: ProductNodeKind
  code: string
  name: string
  description: string | null
  parentId: string | null
  active: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Conteúdo de UMA versão de um critério de identificação (o que a pessoa da operação escreve). */
export const criterionContentInputSchema = z.object({
  statement: z.string().trim().max(2_000).default(""),
  targetNodeIds: z.array(z.string().uuid()).max(40).default([]),
  context: optionalText(2_000),
  limitations: optionalText(2_000),
  strength: z.enum(CRITERION_STRENGTHS).default("INDICATIVE"),
  conclusiveWhen: optionalText(2_000),
  sourceDocumentId: z.string().uuid().nullish().transform((value) => value ?? null),
  sourceReference: optionalText(500),
})
export type CriterionContent = z.infer<typeof criterionContentInputSchema>

/** Hash do conteúdo (chaves em ordem fixa) — entra na proveniência da análise e no cache da proposta. */
export function criterionContentHashOf(content: CriterionContent): string {
  const canonical = JSON.stringify({
    statement: content.statement,
    targetNodeIds: [...content.targetNodeIds].sort(),
    context: content.context,
    limitations: content.limitations,
    strength: content.strength,
    conclusiveWhen: content.strength === "CONCLUSIVE" ? content.conclusiveWhen : null,
    sourceDocumentId: content.sourceDocumentId,
    sourceReference: content.sourceReference,
  })
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16)
}

/**
 * O que impede APROVAR uma versão: texto do critério, ao menos um alvo ativo do catálogo, a condição em que é conclusivo (quando
 * conclusivo) e a fonte (documento da base ou referência). Problemas, nunca correção automática.
 */
export function approvalIssuesOf(content: CriterionContent, activeNodeIds: ReadonlySet<string>): string[] {
  const issues: string[] = []
  if (content.statement.trim().length < 5) issues.push("Escreva o indício em linguagem natural (o que, na chamada, mostra o produto).")
  if (content.targetNodeIds.length === 0) issues.push("Escolha o produto, a categoria ou os produtos que o indício indica.")
  if (content.targetNodeIds.some((id) => !activeNodeIds.has(id))) issues.push("Um dos produtos indicados está desativado.")
  if (content.strength === "CONCLUSIVE" && !content.conclusiveWhen) issues.push("Diga quando o indício confirma o produto — sem isso ele apenas sugere.")
  if (!content.sourceDocumentId && !content.sourceReference) issues.push("Diga de onde vem o indício: um documento da base ou uma referência (norma, comunicado, planilha).")
  return issues
}

/**
 * ÁRVORE: produto só sob uma FAMÍLIA; família sob outra família (ou na raiz). Sem ciclos. Folhas = produtos e famílias sem filhos
 * (família ainda sem produtos cadastrados também é algo que se pode identificar).
 */
export function treeIssuesOf(input: { id: string | null; kind: ProductNodeKind; parentId: string | null }, nodes: readonly Pick<ProductNodeRecord, "id" | "kind" | "parentId">[]): string[] {
  if (!input.parentId) return []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const parent = byId.get(input.parentId)
  if (!parent) return ["A categoria escolhida não existe nesta organização."]
  if (parent.kind !== "FAMILY") return ["Um item só pode ficar dentro de uma categoria."]
  let cursor: string | null = parent.id
  const seen = new Set<string>()
  while (cursor) {
    if (input.id && cursor === input.id) return ["A categoria não pode ficar dentro dela mesma."]
    if (seen.has(cursor)) break
    seen.add(cursor)
    cursor = byId.get(cursor)?.parentId ?? null
  }
  return []
}

/** Folhas (produtos e famílias sem filhos) abaixo de um item — o conjunto de produtos que ele representa. */
export function leavesOf(nodeId: string, nodes: readonly Pick<ProductNodeRecord, "id" | "parentId">[]): string[] {
  const children = new Map<string, string[]>()
  for (const node of nodes) if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id])
  const out: string[] = []
  const stack = [nodeId]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current)) continue
    seen.add(current)
    const below = children.get(current) ?? []
    if (below.length === 0) out.push(current)
    else stack.push(...below)
  }
  return out.sort()
}

// ---------------------------------------------------------------------------------------------
// Fotografia para o motor (cadastro vigente NA DATA DA CHAMADA)
// ---------------------------------------------------------------------------------------------
export type CatalogNodeSource = { id: string; code: string; kind: ProductNodeKind; name: string; description: string | null; parentId: string | null }
export type CatalogCriterionSource = {
  criterionId: string
  versionId: string
  version: number
  title: string
  statement: string
  targetNodeIds: string[]
  context: string | null
  limitations: string | null
  strength: CriterionStrength
  conclusiveWhen: string | null
  sourceLabel: string | null
  effectiveFrom: string
  approvedAt: string
  contentHash: string
}
export type SourceScopeSource = { assignmentId: string; sourceKind: "KNOWLEDGE_DOCUMENT" | "ARGUMENT_SCRIPT"; sourceId: string; nodeIds: string[]; effectiveFrom: string }
/** O cadastro como valia numa data: itens ativos naquela data, critérios aprovados e vigentes, abrangência das fontes. */
export type ProductCatalogSource = { nodes: CatalogNodeSource[]; criteria: CatalogCriterionSource[]; scopes: SourceScopeSource[] }

/** Identidade do cadastro usado (entra na chave da análise e na proveniência). */
export function catalogFingerprintOf(source: ProductCatalogSource): string {
  const canonical = JSON.stringify({
    nodes: [...source.nodes].sort((a, b) => a.id.localeCompare(b.id)).map((node) => [node.id, node.code, node.kind, node.name, node.description, node.parentId]),
    criteria: [...source.criteria].sort((a, b) => a.versionId.localeCompare(b.versionId)).map((criterion) => [criterion.versionId, criterion.contentHash]),
    scopes: [...source.scopes].sort((a, b) => a.assignmentId.localeCompare(b.assignmentId)).map((scope) => [scope.assignmentId, [...scope.nodeIds].sort()]),
  })
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16)
}

/** Situação de uma versão de critério para a tela. */
export function criterionVersionSituation(version: { status: string; effectiveFrom: string | null; effectiveUntil: string | null }, now: Date): "DRAFT" | "SCHEDULED" | "IN_FORCE" | "ENDED" {
  if (version.status === "DRAFT") return "DRAFT"
  if (version.effectiveFrom && new Date(version.effectiveFrom).getTime() > now.getTime()) return "SCHEDULED"
  if (version.effectiveUntil && new Date(version.effectiveUntil).getTime() <= now.getTime()) return "ENDED"
  return "IN_FORCE"
}
