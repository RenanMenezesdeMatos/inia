import { z } from "zod"

export const knowledgeDocumentTypeSchema = z.enum(["PROCEDURE", "MANUAL", "FAQ", "RULE", "FLOW"])
export type KnowledgeDocumentType = z.infer<typeof knowledgeDocumentTypeSchema>

export const knowledgeSourceTypeSchema = z.enum(["TEXT", "PDF", "DOCX", "TXT", "JSON"])
export type KnowledgeSourceType = z.infer<typeof knowledgeSourceTypeSchema>

const orgScopeSchema = z.object({
  id: z.string(),
  scopeType: z.string(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamId: z.string().nullable(),
  subteamName: z.string().nullable(),
})

const subjectScopeSchema = z.object({
  id: z.string(),
  scopeType: z.string(),
  subjectId: z.string().nullable(),
  subjectName: z.string().nullable(),
})

export const knowledgeDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  documentType: knowledgeDocumentTypeSchema,
  sourceType: knowledgeSourceTypeSchema,
  originalFilename: z.string().nullable(),
  mimeType: z.string().nullable(),
  fileSizeBytes: z.number().nullable(),
  createdAt: z.coerce.string(),
  updatedAt: z.coerce.string().nullable(),
  authorName: z.string().nullable(),
  status: z.string(),
  excerpt: z.string().nullable(),
  orgScopes: z.array(orgScopeSchema),
  subjectScopes: z.array(subjectScopeSchema),
})
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>

export const knowledgeDocumentDetailSchema = knowledgeDocumentSchema.extend({
  latestVersion: z.object({ version: z.number(), content: z.string(), status: z.string(), createdAt: z.coerce.string() }).nullable(),
})
export type KnowledgeDocumentDetail = z.infer<typeof knowledgeDocumentDetailSchema>

export const knowledgeDocumentPreviewSchema = z.object({ format: z.literal("html"), html: z.string() })
export type KnowledgeDocumentPreview = z.infer<typeof knowledgeDocumentPreviewSchema>

export const knowledgeStatusSchema = z.enum(["DRAFT", "APPROVED", "PUBLISHED", "ARCHIVED"])
export type KnowledgeStatus = z.infer<typeof knowledgeStatusSchema>

export const DOCUMENT_TYPE_LABELS: Record<KnowledgeDocumentType, string> = {
  PROCEDURE: "Procedimento",
  MANUAL: "Manual",
  FAQ: "FAQ",
  RULE: "Regra",
  FLOW: "Fluxo",
}

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  DRAFT: "Rascunho",
  APPROVED: "Aprovado",
  PUBLISHED: "Publicado",
  ARCHIVED: "Arquivado",
}

// Como o conteúdo chegou: "TEXT" é o texto colado no cadastro; os demais são upload de arquivo.
export const SOURCE_TYPE_LABELS: Record<KnowledgeSourceType, string> = {
  TEXT: "Texto",
  PDF: "PDF",
  DOCX: "Word",
  TXT: "TXT",
  JSON: "JSON",
}

export function isFileSource(sourceType: KnowledgeSourceType) {
  return sourceType !== "TEXT"
}
