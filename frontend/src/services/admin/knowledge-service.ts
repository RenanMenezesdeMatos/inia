import { z } from "zod"

import { adminGet, adminGetBlob, adminSend, adminUpload } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type DateRangeFilter, type ListParams, type OrgScopeFilter, type PageResult, type SubjectScopeFilter } from "@/lib/admin/list-query"
import {
  knowledgeDocumentDetailSchema,
  knowledgeDocumentPreviewSchema,
  knowledgeDocumentSchema,
  type KnowledgeDocument,
  type KnowledgeDocumentDetail,
  type KnowledgeDocumentPreview,
  type KnowledgeDocumentType,
  type KnowledgeSourceType,
  type KnowledgeStatus,
} from "@/schemas/admin/knowledge.schema"
import type { OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import type { SubjectScopeValue } from "@/components/admin/shared/subject-scope-select"

export async function fetchKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  return z.array(knowledgeDocumentSchema).parse(await adminGet("/api/v1/admin/knowledge"))
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
  const { createdAt, ...rest } = params
  return pageResultSchema(knowledgeDocumentSchema).parse(
    await adminGet(`/api/v1/admin/knowledge${toQueryString({ ...rest, createdFrom: createdAt.from, createdTo: createdAt.to })}`),
  )
}

export async function fetchKnowledgeDocument(id: string): Promise<KnowledgeDocumentDetail> {
  return knowledgeDocumentDetailSchema.parse(await adminGet(`/api/v1/admin/knowledge/${id}`))
}

export type KnowledgeFile = { blob: Blob; filename: string | null }

// Arquivo original (PDF/DOCX/TXT/JSON) — vem pelo mesmo fetch autenticado por cookie das demais
// chamadas admin, então prévia e download respeitam exatamente as mesmas permissões da API.
export async function fetchKnowledgeFile(id: string): Promise<KnowledgeFile> {
  const { blob, filename } = await adminGetBlob(`/api/v1/admin/knowledge/${id}/file`)
  return { blob, filename }
}

export async function fetchKnowledgeDocumentPreview(id: string): Promise<KnowledgeDocumentPreview> {
  return knowledgeDocumentPreviewSchema.parse(await adminGet(`/api/v1/admin/knowledge/${id}/preview`))
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
  return adminUpload<{ id: string }>("/api/v1/admin/knowledge", formData)
}

export type UpdateKnowledgeInput = {
  title: string
  documentType: string
  content: string
  status: string
  orgScope: OrgScopeValue
  subjectScope: SubjectScopeValue
}

export async function updateKnowledgeDocument(id: string, input: UpdateKnowledgeInput): Promise<KnowledgeDocumentDetail> {
  return knowledgeDocumentDetailSchema.parse(
    await adminSend(`/api/v1/admin/knowledge/${id}`, "PATCH", {
      title: input.title,
      documentType: input.documentType,
      content: input.content,
      status: input.status,
      orgScopes: [input.orgScope],
      subjectScopes: [input.subjectScope],
    }),
  )
}

export async function setKnowledgeDocumentStatus(id: string, status: string): Promise<void> {
  await adminSend(`/api/v1/admin/knowledge/${id}`, "PATCH", { status })
}

export async function deleteKnowledgeDocument(id: string): Promise<void> {
  await adminSend(`/api/v1/admin/knowledge/${id}`, "DELETE")
}
