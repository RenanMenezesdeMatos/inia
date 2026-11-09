import { z } from "zod"

import { adminGet, adminGetBlob, adminSend, adminUpload } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type DateRangeFilter, type ListParams, type OrgScopeFilter, type PageResult, type SubjectScopeFilter } from "@/lib/admin/list-query"
import {
  knowledgeAiPreviewSchema,
  knowledgeDocumentDetailSchema,
  knowledgeDocumentPreviewSchema,
  knowledgeDocumentSchema,
  knowledgeVersionComparisonSchema,
  knowledgeVersionDetailSchema,
  knowledgeVersionRowSchema,
  type KnowledgeAiPreview,
  type KnowledgeDocument,
  type KnowledgeDocumentDetail,
  type KnowledgeDocumentPreview,
  type KnowledgeDocumentType,
  type KnowledgeSourceType,
  type KnowledgeStatus,
  type KnowledgeVersionComparison,
  type KnowledgeVersionDetail,
  type KnowledgeVersionRow,
} from "@/schemas/admin/knowledge.schema"
import type { OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import type { SubjectScopeValue } from "@/components/admin/shared/subject-scope-select"

const BASE_PATH = "/api/v1/admin/knowledge"

export async function fetchKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  return z.array(knowledgeDocumentSchema).parse(await adminGet(BASE_PATH))
}

export type KnowledgeListParams = ListParams &
  OrgScopeFilter &
  SubjectScopeFilter & {
    documentType: KnowledgeDocumentType[]
    sourceType: KnowledgeSourceType[]
    status: KnowledgeStatus[]
    hasFile?: boolean
    createdAt: DateRangeFilter
  }

export async function fetchKnowledgeDocumentsPage(params: KnowledgeListParams): Promise<PageResult<KnowledgeDocument>> {
  const { createdAt, status, ...rest } = params
  // "Aprovada" é só uma marca do rascunho: quem filtra Rascunho também vê essas bases.
  const statuses = status.includes("DRAFT") ? [...status, "APPROVED" as const] : status
  return pageResultSchema(knowledgeDocumentSchema).parse(await adminGet(`${BASE_PATH}${toQueryString({ ...rest, status: statuses, createdFrom: createdAt.from, createdTo: createdAt.to })}`))
}

export async function fetchKnowledgeDocument(id: string): Promise<KnowledgeDocumentDetail> {
  return knowledgeDocumentDetailSchema.parse(await adminGet(`${BASE_PATH}/${id}`))
}

export type KnowledgeFile = { blob: Blob; filename: string | null }

// Arquivo original (PDF/DOCX/TXT/JSON) da versão EM USO — vem pelo mesmo fetch autenticado por cookie das demais chamadas admin, então
// prévia e download respeitam exatamente as mesmas permissões da API.
export async function fetchKnowledgeFile(id: string): Promise<KnowledgeFile> {
  const { blob, filename } = await adminGetBlob(`${BASE_PATH}/${id}/file`)
  return { blob, filename }
}

export async function fetchKnowledgeDocumentPreview(id: string): Promise<KnowledgeDocumentPreview> {
  return knowledgeDocumentPreviewSchema.parse(await adminGet(`${BASE_PATH}/${id}/preview`))
}

export type CreateKnowledgeInput = {
  title: string
  documentType: string
  content?: string
  file?: File
  orgScope: OrgScopeValue
  subjectScope: SubjectScopeValue
}

export async function createKnowledgeDocument(input: CreateKnowledgeInput) {
  const formData = new FormData()
  formData.set("title", input.title)
  formData.set("documentType", input.documentType)
  if (input.content) formData.set("content", input.content)
  if (input.file) formData.set("file", input.file)
  formData.set("orgScopes", JSON.stringify([input.orgScope]))
  formData.set("subjectScopes", JSON.stringify([input.subjectScope]))
  return adminUpload<{ id: string }>(BASE_PATH, formData)
}

export type UpdateKnowledgeInput = {
  title: string
  documentType: string
  /** Só quando o texto mudou: a API normaliza o que recebe, e reenviar o mesmo texto criaria um rascunho sem mudança nenhuma. */
  content?: string
  orgScope?: OrgScopeValue
  subjectScope?: SubjectScopeValue
  changeSummary?: string
}

/** Grava o RASCUNHO: não muda o que a IA usa (PEN-008). */
export async function updateKnowledgeDocument(id: string, input: UpdateKnowledgeInput): Promise<KnowledgeDocumentDetail> {
  return knowledgeDocumentDetailSchema.parse(
    await adminSend(`${BASE_PATH}/${id}`, "PATCH", {
      title: input.title,
      documentType: input.documentType,
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.orgScope ? { orgScopes: [input.orgScope] } : {}),
      ...(input.subjectScope ? { subjectScopes: [input.subjectScope] } : {}),
      ...(input.changeSummary ? { changeSummary: input.changeSummary } : {}),
    }),
  )
}

/** Troca o arquivo no rascunho. Sem texto extraível, o rascunho volta com `textAvailable: false` e `content: ""`. */
export async function replaceKnowledgeDraftFile(id: string, file: File): Promise<KnowledgeDocumentDetail> {
  const formData = new FormData()
  formData.set("file", file)
  return knowledgeDocumentDetailSchema.parse(await adminUpload(`${BASE_PATH}/${id}/draft/file`, formData))
}

export type PublishKnowledgeInput = { changeSummary?: string; reactivate?: boolean }

export async function publishKnowledgeDocument(id: string, input: PublishKnowledgeInput): Promise<KnowledgeDocumentDetail> {
  return knowledgeDocumentDetailSchema.parse(await adminSend(`${BASE_PATH}/${id}/publish`, "POST", input))
}

export async function archiveKnowledgeDocument(id: string): Promise<KnowledgeDocumentDetail> {
  return knowledgeDocumentDetailSchema.parse(await adminSend(`${BASE_PATH}/${id}/archive`, "POST"))
}

export async function reactivateKnowledgeDocument(id: string): Promise<KnowledgeDocumentDetail> {
  return knowledgeDocumentDetailSchema.parse(await adminSend(`${BASE_PATH}/${id}/reactivate`, "POST"))
}

export async function discardKnowledgeDraft(id: string): Promise<KnowledgeDocumentDetail> {
  return knowledgeDocumentDetailSchema.parse(await adminSend(`${BASE_PATH}/${id}/draft/discard`, "POST"))
}

export async function fetchKnowledgeVersions(id: string): Promise<KnowledgeVersionRow[]> {
  return z.array(knowledgeVersionRowSchema).parse(await adminGet(`${BASE_PATH}/${id}/versions`))
}

export async function fetchKnowledgeVersion(id: string, versionId: string): Promise<KnowledgeVersionDetail> {
  return knowledgeVersionDetailSchema.parse(await adminGet(`${BASE_PATH}/${id}/versions/${versionId}`))
}

export async function fetchKnowledgeVersionFile(id: string, versionId: string): Promise<KnowledgeFile> {
  const { blob, filename } = await adminGetBlob(`${BASE_PATH}/${id}/versions/${versionId}/file`)
  return { blob, filename }
}

export async function fetchKnowledgeVersionPreview(id: string, versionId: string): Promise<KnowledgeDocumentPreview> {
  return knowledgeDocumentPreviewSchema.parse(await adminGet(`${BASE_PATH}/${id}/versions/${versionId}/preview`))
}

export async function fetchKnowledgeAiPreview(id: string, versionId: string): Promise<KnowledgeAiPreview> {
  return knowledgeAiPreviewSchema.parse(await adminGet(`${BASE_PATH}/${id}/versions/${versionId}/ai-preview`))
}

/** Reprocessa o arquivo original com a conversão atual. O resultado vai para um rascunho: nada do que está em uso muda. */
export async function reprocessKnowledgeDocument(id: string, input: { overwriteDraft?: boolean } = {}): Promise<KnowledgeDocumentDetail> {
  return knowledgeDocumentDetailSchema.parse(await adminSend(`${BASE_PATH}/${id}/reprocess`, "POST", input))
}

export async function compareKnowledgeVersions(id: string, fromVersionId: string, toVersionId: string): Promise<KnowledgeVersionComparison> {
  return knowledgeVersionComparisonSchema.parse(await adminGet(`${BASE_PATH}/${id}/versions/compare${toQueryString({ from: fromVersionId, to: toVersionId })}`))
}

/** `reactivate`: em base arquivada, a confirmação de que ela volta a valer. Tentar de novo não a reativa sem isso. */
export async function retryKnowledgeVersion(id: string, versionId: string, input: { reactivate?: boolean } = {}): Promise<KnowledgeDocumentDetail> {
  return knowledgeDocumentDetailSchema.parse(await adminSend(`${BASE_PATH}/${id}/versions/${versionId}/retry`, "POST", input))
}

export type RevertKnowledgeInput = { changeSummary?: string; discardDraft?: boolean; reactivate?: boolean }

export async function revertKnowledgeVersion(id: string, versionId: string, input: RevertKnowledgeInput): Promise<KnowledgeDocumentDetail> {
  return knowledgeDocumentDetailSchema.parse(await adminSend(`${BASE_PATH}/${id}/versions/${versionId}/revert`, "POST", input))
}

export async function deleteKnowledgeDocument(id: string): Promise<void> {
  await adminSend(`${BASE_PATH}/${id}`, "DELETE")
}
