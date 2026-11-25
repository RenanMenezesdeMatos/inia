import type { OrgScopeEntry } from "@/lib/scope-links/scope-links"
import type { UniverseFilterValue } from "@/lib/operating-universe/hierarchy"
import { z } from "zod"

import { AdminApiError, adminGet, adminGetBlob, adminSend, adminUpload, adminUploadWithProgress, type UploadTransfer } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type DateRangeFilter, type ListParams, type OrgScopeFilter, type PageResult, type SubjectScopeFilter } from "@/lib/admin/list-query"
import {
  knowledgeAiPreviewSchema,
  knowledgeDocumentDetailSchema,
  knowledgeDocumentPreviewSchema,
  knowledgeDocumentSchema,
  knowledgeSubjectCatalogSchema,
  knowledgeSubjectSchema,
  knowledgeVersionComparisonSchema,
  knowledgeVersionDetailSchema,
  knowledgeVersionRowSchema,
  type KnowledgeAiPreview,
  type KnowledgeDocument,
  type KnowledgeDocumentDetail,
  type KnowledgeDocumentPreview,
  type KnowledgeDocumentType,
  type KnowledgeSourceType,
  type KnowledgeSubject,
  type KnowledgeSubjectCatalog,
  type KnowledgeSubjectScopePayload,
  type KnowledgeStatus,
  type KnowledgeVersionComparison,
  type KnowledgeVersionDetail,
  type KnowledgeVersionRow,
} from "@/schemas/admin/knowledge.schema"
import { knowledgeUploadRunSchema, type KnowledgeUploadRun } from "@/schemas/admin/knowledge-upload.schema"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

const BASE_PATH = "/api/v1/admin/knowledge"

export type KnowledgeListParams = ListParams &
  OrgScopeFilter &
  SubjectScopeFilter & {
    documentType: KnowledgeDocumentType[]
    sourceType: KnowledgeSourceType[]
    status: KnowledgeStatus[]
    hasFile?: boolean
    createdAt: DateRangeFilter
    /** Universo de atuação; PENDING = sem classificação. */
    operatingUniverse?: UniverseFilterValue
  }

export async function fetchKnowledgeDocumentsPage(params: KnowledgeListParams): Promise<PageResult<KnowledgeDocument>> {
  const { createdAt, status, ...rest } = params
  // "Aprovada" é só uma marca do rascunho: quem filtra Rascunho também vê essas bases.
  const statuses = status.includes("DRAFT") ? [...status, "APPROVED" as const] : status
  return pageResultSchema(knowledgeDocumentSchema).parse(await adminGet(`${BASE_PATH}${toQueryString({ ...rest, status: statuses, createdFrom: createdAt.from, createdTo: createdAt.to })}`))
}

export type KnowledgeOptionsSearch = { search?: string | undefined; universe?: string | null | undefined; teamId?: readonly string[] | undefined; subteamId?: readonly string[] | undefined }

/** Bases para um seletor, em páginas: as do universo (e as ainda sem universo) e as que valem no Grupo/Subgrupo, inclusive as globais. */
export async function fetchKnowledgeOptionsPage(search: KnowledgeOptionsSearch, page: number, pageSize: number, signal?: AbortSignal): Promise<PageResult<KnowledgeDocument>> {
  const scope = { teamId: search.teamId, subteamId: search.subteamId, scopeMatch: search.teamId?.length || search.subteamId?.length ? "fits" : undefined }
  return pageResultSchema(knowledgeDocumentSchema).parse(await adminGet(`${BASE_PATH}${toQueryString({ search: search.search, operatingUniverse: search.universe ? [search.universe, "PENDING"] : undefined, ...scope, sort: "title", page, pageSize })}`, signal))
}

/** Uma base já escolhida (nome, universo e alcance), mesmo fora do lote carregado; fora do alcance de quem pede não volta. */
export async function fetchKnowledgeOption(id: string): Promise<KnowledgeDocument | null> {
  return pageResultSchema(knowledgeDocumentSchema).parse(await adminGet(`${BASE_PATH}${toQueryString({ ids: id, page: 1, pageSize: 1 })}`)).items[0] ?? null
}

/** Assuntos da base: o catálogo canônico das chamadas (o mesmo dos Alinhamentos), com a permissão de incluir. */
export async function fetchKnowledgeSubjects(): Promise<KnowledgeSubjectCatalog> {
  return knowledgeSubjectCatalogSchema.parse(await adminGet(`${BASE_PATH}/subjects`))
}

export async function createKnowledgeSubject(name: string): Promise<KnowledgeSubject> {
  return knowledgeSubjectSchema.parse(await adminSend(`${BASE_PATH}/subjects`, "POST", { name }))
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
  /** Alcance completo (223: vários Grupos/Subgrupos) — nunca só o primeiro. */
  orgScopes: OrgScopeEntry[]
  /** Todos os assuntos, 1..N assuntos canônicos ou nenhum (lista vazia). */
  subjectScopes: KnowledgeSubjectScopePayload[]
  operatingUniverse?: OperatingUniverse | null
  /** Id do acompanhamento do envio: com ele, o servidor grava cada etapa do processamento e a tela consulta por ele. */
  uploadId?: string
  onProgress?: (transfer: UploadTransfer) => void
}

export async function createKnowledgeDocument(input: CreateKnowledgeInput) {
  const formData = new FormData()
  // Antes do arquivo: o servidor lê os campos na ordem em que chegam.
  if (input.uploadId) formData.set("uploadId", input.uploadId)
  formData.set("title", input.title)
  formData.set("documentType", input.documentType)
  if (input.content) formData.set("content", input.content)
  if (input.file) formData.set("file", input.file)
  formData.set("orgScopes", JSON.stringify(input.orgScopes))
  formData.set("subjectScopes", JSON.stringify(input.subjectScopes))
  if (input.operatingUniverse) formData.set("operatingUniverse", input.operatingUniverse)
  if (input.file) return adminUploadWithProgress<{ id: string }>(BASE_PATH, formData, { onProgress: input.onProgress })
  return adminUpload<{ id: string }>(BASE_PATH, formData)
}

export type UpdateKnowledgeInput = {
  title: string
  documentType: string
  /** Só quando o texto mudou: a API normaliza o que recebe, e reenviar o mesmo texto criaria um rascunho sem mudança nenhuma. */
  content?: string
  orgScopes?: OrgScopeEntry[]
  subjectScopes?: KnowledgeSubjectScopePayload[]
  changeSummary?: string
}

/** Grava o RASCUNHO: não muda o que a IA usa (PEN-008). */
export async function updateKnowledgeDocument(id: string, input: UpdateKnowledgeInput): Promise<KnowledgeDocumentDetail> {
  return knowledgeDocumentDetailSchema.parse(
    await adminSend(`${BASE_PATH}/${id}`, "PATCH", {
      title: input.title,
      documentType: input.documentType,
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.orgScopes ? { orgScopes: input.orgScopes } : {}),
      ...(input.subjectScopes ? { subjectScopes: input.subjectScopes } : {}),
      ...(input.changeSummary ? { changeSummary: input.changeSummary } : {}),
    }),
  )
}

/** Troca o arquivo no rascunho. Sem texto extraível, o rascunho volta com `textAvailable: false` e `content: ""`. */
export async function replaceKnowledgeDraftFile(id: string, file: File, tracking: { uploadId?: string; onProgress?: (transfer: UploadTransfer) => void } = {}): Promise<KnowledgeDocumentDetail> {
  const formData = new FormData()
  if (tracking.uploadId) formData.set("uploadId", tracking.uploadId)
  formData.set("file", file)
  return knowledgeDocumentDetailSchema.parse(await adminUploadWithProgress(`${BASE_PATH}/${id}/draft/file`, formData, { onProgress: tracking.onProgress }))
}

/** O andamento de um envio da própria conta. `null` = o servidor ainda não começou a processar (ou o envio não existe). */
export async function fetchKnowledgeUploadRun(uploadId: string): Promise<KnowledgeUploadRun | null> {
  try {
    return knowledgeUploadRunSchema.parse(await adminGet(`${BASE_PATH}/uploads/${uploadId}`))
  } catch (error) {
    if (error instanceof AdminApiError && error.code === "KNOWLEDGE_UPLOAD_NOT_FOUND") return null
    throw error
  }
}

/** Os envios do último dia da conta (de uma base, com `documentId`). */
export async function fetchRecentKnowledgeUploads(documentId?: string): Promise<KnowledgeUploadRun[]> {
  return z.array(knowledgeUploadRunSchema).parse(await adminGet(`${BASE_PATH}/uploads${documentId ? `?documentId=${encodeURIComponent(documentId)}` : ""}`))
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
