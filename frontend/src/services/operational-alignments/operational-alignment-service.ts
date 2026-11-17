import { linksFromScopeValue } from "@/lib/scope-links/scope-links"
import { z } from "zod"



import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type ListParams, type PageResult } from "@/lib/admin/list-query"
import {
  affectedAssessmentsSchema,
  alignmentDetailSchema,
  alignmentListItemSchema,
  alignmentPublicationPreviewSchema,
  alignmentScopeOptionsSchema,
  alignmentReasonSchema,
  processOptionSchema,
  requestReasonSchema,
  responsibleOptionSchema,
  type ResponsibleOption,
  type AffectedAssessments,
  type AlignmentDetail,
  type AlignmentFormValues,
  type AlignmentListItem,
  type AlignmentPublicationPreview,
  type AlignmentRelation,
  type AlignmentScopeOptions,
  type AlignmentState,
  type AlignmentReason,
  type ProcessOption,
  type RequestReason,
} from "@/schemas/operational-alignments/operational-alignment.schema"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

const BASE = "/api/v1/admin/operational-alignments"

export type AlignmentListParams = ListParams & { state?: AlignmentState; operatingUniverse?: OperatingUniverse; hasDraft?: boolean; scopeType?: "ALL_TEAMS"; teamId?: string; subteamId?: string }

export async function fetchAlignmentsPage(params: AlignmentListParams): Promise<PageResult<AlignmentListItem>> {
  return pageResultSchema(alignmentListItemSchema).parse(await adminGet(`${BASE}${toQueryString(params)}`))
}
export async function fetchAlignment(id: string): Promise<AlignmentDetail> {
  return alignmentDetailSchema.parse(await adminGet(`${BASE}/${id}`))
}
export async function fetchAlignmentScopeOptions(): Promise<AlignmentScopeOptions> {
  return alignmentScopeOptionsSchema.parse(await adminGet(`${BASE}/scope-options`))
}
export async function fetchPublicationPreview(id: string): Promise<AlignmentPublicationPreview> {
  return alignmentPublicationPreviewSchema.parse(await adminGet(`${BASE}/${id}/publication-preview`))
}
export async function fetchAffectedAssessments(id: string): Promise<AffectedAssessments> {
  return affectedAssessmentsSchema.parse(await adminGet(`${BASE}/${id}/affected-assessments`))
}

export type ProcessOptionParams = { search?: string; documentType?: string; operatingUniverse?: OperatingUniverse; page: number; pageSize: number }
/** Processos para o seletor: busca, tipo e universo no servidor (mais de mil bases), em páginas. */
export async function fetchProcessOptions(params: ProcessOptionParams): Promise<PageResult<ProcessOption>> {
  return pageResultSchema(processOptionSchema).parse(await adminGet(`${BASE}/process-options${toQueryString(params)}`))
}

/** Corpo enviado ao backend: ids que o recorte não usa vão nulos; trecho e motivo só quando preenchidos. */
export function alignmentPayloadOf(values: AlignmentFormValues) {
  return {
    title: values.title,
    guidance: values.guidance,
    affectedDocumentIds: values.affectedDocumentIds,
    reasonId: values.reasonId,
    requestSubjectIds: values.requestSubjectIds,
    affectedTopic: values.affectedTopic.trim() ? values.affectedTopic.trim() : null,
    justification: values.justification,
    operatingUniverse: values.operatingUniverse,
    scopeType: values.scope.global ? "UNIVERSE" : "GROUPS",
    links: linksFromScopeValue(values.scope),
    productId: values.productId,
    startsOn: values.startsOn,
    endsOn: values.endsOn,
    changeReason: values.changeReason?.trim() ? values.changeReason.trim() : null,
    responsiblePersonId: values.responsiblePersonId,
  }
}

export async function fetchResponsibleOptions(search: string): Promise<ResponsibleOption[]> {
  return z.object({ items: z.array(responsibleOptionSchema) }).parse(await adminGet(`${BASE}/responsible-options?search=${encodeURIComponent(search)}`)).items
}

export async function createAlignment(values: AlignmentFormValues): Promise<AlignmentDetail> {
  return alignmentDetailSchema.parse(await adminSend(BASE, "POST", alignmentPayloadOf(values)))
}
export async function saveAlignmentDraft(id: string, values: AlignmentFormValues): Promise<AlignmentDetail> {
  return alignmentDetailSchema.parse(await adminSend(`${BASE}/${id}/draft`, "PUT", alignmentPayloadOf(values)))
}
export async function discardAlignmentDraft(id: string): Promise<void> {
  await adminSend(`${BASE}/${id}/draft`, "DELETE")
}
export async function publishAlignment(id: string, relations: { alignmentId: string; relation: AlignmentRelation }[]): Promise<AlignmentDetail> {
  return alignmentDetailSchema.parse(await adminSend(`${BASE}/${id}/publish`, "POST", { relations }))
}
export async function deleteAlignment(id: string, reason: string): Promise<void> {
  await adminSend(`${BASE}/${id}`, "DELETE", { reason })
}
export async function endAlignment(id: string, reason: string): Promise<AlignmentDetail> {
  return alignmentDetailSchema.parse(await adminSend(`${BASE}/${id}/end`, "POST", { reason }))
}


export async function fetchReasons(): Promise<AlignmentReason[]> {
  return z.array(alignmentReasonSchema).parse(await adminGet(`${BASE}/reasons`))
}
export async function createReason(name: string): Promise<void> {
  await adminSend(`${BASE}/reasons`, "POST", { name })
}
export async function updateReason(id: string, input: { name?: string; active?: boolean }): Promise<void> {
  await adminSend(`${BASE}/reasons/${id}`, "PATCH", input)
}
export async function fetchRequestReasons(): Promise<RequestReason[]> {
  return z.array(requestReasonSchema).parse(await adminGet(`${BASE}/request-reasons`))
}
export async function createRequestReason(name: string): Promise<void> {
  await adminSend(`${BASE}/request-reasons`, "POST", { name })
}
