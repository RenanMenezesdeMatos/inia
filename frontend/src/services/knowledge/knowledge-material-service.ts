import { apiGet } from "@/lib/api/api-client"
import { adminGetBlob } from "@/lib/admin/admin-api"
import { knowledgeDocumentPreviewSchema, type KnowledgeDocumentPreview } from "@/schemas/admin/knowledge.schema"
import { knowledgeMaterialSchema, type KnowledgeMaterial } from "@/schemas/knowledge/knowledge-material.schema"

/**
 * Leitura de material para qualquer usuário autenticado — a API decide o acesso pelo alcance da
 * base e responde 404 (`KNOWLEDGE_MATERIAL_NOT_FOUND`) sem distinguir "não existe" de "sem acesso".
 */
export async function fetchKnowledgeMaterial(id: string): Promise<KnowledgeMaterial> {
  return knowledgeMaterialSchema.parse(await apiGet(`/api/v1/knowledge-materials/${encodeURIComponent(id)}`))
}

export type KnowledgeMaterialFile = { blob: Blob; filename: string | null }

// Mesmo fetch autenticado por cookie da prévia admin — prévia e download respeitam a mesma
// autorização da API de leitura.
export async function fetchKnowledgeMaterialFile(id: string): Promise<KnowledgeMaterialFile> {
  const { blob, filename } = await adminGetBlob(`/api/v1/knowledge-materials/${encodeURIComponent(id)}/file`)
  return { blob, filename }
}

export async function fetchKnowledgeMaterialPreview(id: string): Promise<KnowledgeDocumentPreview> {
  return knowledgeDocumentPreviewSchema.parse(await apiGet(`/api/v1/knowledge-materials/${encodeURIComponent(id)}/preview`))
}
