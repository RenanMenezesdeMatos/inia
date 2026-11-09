import { z } from "zod"

import { knowledgeDocumentTypeSchema, knowledgeSourceTypeSchema, pdfExtractionSchema } from "@/schemas/admin/knowledge.schema"

/**
 * Material da Base de Conhecimento como o LEITOR comum recebe (`GET /api/v1/knowledge-materials/:id`):
 * o mesmo documento do admin, só com o que a página de leitura precisa — conteúdo da versão
 * PUBLICADA, sem alcances, autor ou histórico de versões. A autorização foi decidida no backend.
 */
export const knowledgeMaterialSchema = z.object({
  id: z.string(),
  title: z.string(),
  documentType: knowledgeDocumentTypeSchema,
  sourceType: knowledgeSourceTypeSchema,
  originalFilename: z.string().nullable(),
  mimeType: z.string().nullable(),
  fileSizeBytes: z.number().nullable(),
  updatedAt: z.string(),
  content: z.string(),
  version: z.number(),
  /** A versão vigente: quem chega por uma citação confere se a página citada é desta versão. */
  versionId: z.string().optional(),
  /** Registro da conversão do PDF: páginas e imagens no texto. */
  extraction: pdfExtractionSchema.nullish().catch(null),
})

export type KnowledgeMaterial = z.infer<typeof knowledgeMaterialSchema>
