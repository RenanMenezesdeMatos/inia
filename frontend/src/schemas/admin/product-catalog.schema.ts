import { z } from "zod"

/**
 * Produtos (`/admin/product-catalog`, `PRODUCT_APPLICABILITY_V1`). A UI nunca conhece um produto concreto: categorias (FAMILY no
 * backend), produtos e indícios (critérios de identificação no backend) são registros deste cadastro. Indício = texto em linguagem
 * natural (o que a operação escreveria num manual) com alvo, contexto, exceções, força (confirma sob condição × apenas sugere), origem,
 * vigência e aprovação. Bases × produtos não é 1×1: base geral (nenhum produto), de um produto ou de vários.
 */
export const PRODUCT_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/

/** Mesma normalização dos outros catálogos: maiúsculas, sem acento, `_` nos separadores. */
export function normalizeProductCode(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export const productNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(["FAMILY", "PRODUCT"]),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().catch(null),
  parentId: z.string().nullable().catch(null),
  active: z.boolean(),
  archivedAt: z.string().nullable().catch(null),
  createdAt: z.coerce.string(),
  updatedAt: z.coerce.string().catch(""),
  criteriaCount: z.number().catch(0),
  scopeCount: z.number().catch(0),
  childCount: z.number().catch(0),
  inUse: z.boolean().catch(false),
  /** Usado agora por base, indício ou produto dentro dele. Histórico não barra a exclusão. */
  blocksDeletion: z.boolean().catch(false),
})
export type ProductNode = z.infer<typeof productNodeSchema>

export const criterionContentSchema = z.object({
  statement: z.string().catch(""),
  targetNodeIds: z.array(z.string()).catch([]),
  context: z.string().nullable().catch(null),
  limitations: z.string().nullable().catch(null),
  strength: z.enum(["CONCLUSIVE", "INDICATIVE"]).catch("INDICATIVE"),
  conclusiveWhen: z.string().nullable().catch(null),
  sourceDocumentId: z.string().nullable().catch(null),
  sourceReference: z.string().nullable().catch(null),
})
export type CriterionContent = z.infer<typeof criterionContentSchema>

export const criterionVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  status: z.enum(["DRAFT", "APPROVED", "SUPERSEDED"]),
  situation: z.enum(["DRAFT", "SCHEDULED", "IN_FORCE", "ENDED"]),
  content: criterionContentSchema,
  sourceDocumentTitle: z.string().nullable().catch(null),
  contentHash: z.string().catch(""),
  effectiveFrom: z.string().nullable().catch(null),
  effectiveUntil: z.string().nullable().catch(null),
  approvedAt: z.string().nullable().catch(null),
  approvedByName: z.string().nullable().catch(null),
  updatedAt: z.string().catch(""),
})
export type CriterionVersion = z.infer<typeof criterionVersionSchema>

export const identificationCriterionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  updatedAt: z.string().catch(""),
  current: criterionVersionSchema.nullable().catch(null),
  draft: criterionVersionSchema.nullable().catch(null),
})
export type IdentificationCriterionSummary = z.infer<typeof identificationCriterionSummarySchema>

export const identificationCriterionSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  updatedAt: z.string().catch(""),
  versions: z.array(criterionVersionSchema),
  usedByAnalyses: z.boolean().catch(false),
})
export type IdentificationCriterion = z.infer<typeof identificationCriterionSchema>

export const productScopeSourceSchema = z.object({
  sourceKind: z.enum(["KNOWLEDGE_DOCUMENT", "ARGUMENT_SCRIPT"]),
  sourceId: z.string(),
  title: z.string(),
  status: z.string().nullable().catch(null),
  scope: z.object({ assignmentId: z.string(), nodeIds: z.array(z.string()), since: z.string() }).nullable().catch(null),
  /** Base de conhecimento: produtos de uma versão ainda fora de uso, diferentes dos que valem. Sem efeito até a versão entrar em uso. */
  pendingScope: z.object({ version: z.number(), status: z.string(), nodeIds: z.array(z.string()) }).nullish().catch(null),
})
export type ProductScopeSource = z.infer<typeof productScopeSourceSchema>

export const productScopeHistorySchema = z.object({
  sourceKind: z.enum(["KNOWLEDGE_DOCUMENT", "ARGUMENT_SCRIPT"]),
  sourceId: z.string(),
  title: z.string(),
  history: z.array(z.object({ assignmentId: z.string(), nodeIds: z.array(z.string()), effectiveFrom: z.string(), effectiveUntil: z.string().nullable(), createdByName: z.string().nullable().catch(null)})),
  /** Base de conhecimento: o rascunho onde a escolha ficou (null = nada mudou). */
  pending: z.object({ version: z.number(), nodeIds: z.array(z.string()) }).nullish(),
})
export type ProductScopeHistory = z.infer<typeof productScopeHistorySchema>

export const CRITERION_SITUATION_LABEL: Record<CriterionVersion["situation"], string> = { DRAFT: "Rascunho", SCHEDULED: "Aprovado — começa depois", IN_FORCE: "Valendo", ENDED: "Encerrado" }
/** Força do indício, em palavras de quem configura: "confirma" (sob a condição escrita) × "apenas sugere" (nunca basta sozinho). */
export const STRENGTH_LABEL: Record<CriterionContent["strength"], string> = { CONCLUSIVE: "Confirma o produto", INDICATIVE: "Apenas sugere" }
export const SOURCE_KIND_LABEL: Record<ProductScopeSource["sourceKind"], string> = { KNOWLEDGE_DOCUMENT: "Base de conhecimento", ARGUMENT_SCRIPT: "Argumentário" }
/** Nome de um tipo de item do catálogo na tela (o backend continua chamando de FAMILY/PRODUCT). */
export const NODE_KIND_LABEL: Record<ProductNode["kind"], string> = { FAMILY: "Categoria", PRODUCT: "Produto" }
