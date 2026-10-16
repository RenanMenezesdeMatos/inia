import { apiGet, apiPost, apiSend } from "@/lib/api/api-client"
import {
  audiencePersonSchema,
  deliveryDetailSchema,
  receivedDeliverySchema,
  reportDetailSchema,
  reportListSchema,
  reportOptionsSchema,
  reportPreviewSchema,
  reportProposalSchema,
  reportSummarySchema,
  type ReportConfig,
  type ReportDefinition,
  type ReportVisualization,
} from "@/schemas/reports/reports.schema"
import { z } from "zod"

/** Reports recorrentes: permissões e escopo decididos no backend; a tela só monta o pedido. */
export async function fetchReports() {
  return reportListSchema.parse(await apiGet("/api/v1/reports"))
}

export async function fetchReport(id: string) {
  return reportDetailSchema.parse(await apiGet(`/api/v1/reports/${id}`))
}

export async function fetchReportOptions() {
  return reportOptionsSchema.parse(await apiGet("/api/v1/reports/options"))
}

export async function fetchReportProposal(id: string) {
  return reportProposalSchema.parse(await apiGet(`/api/v1/reports/proposals/${id}`))
}

export async function previewReport(input: { definition: ReportDefinition; visualization?: ReportVisualization }) {
  return reportPreviewSchema.parse(await apiPost("/api/v1/reports/preview", input))
}

export async function createReport(input: { config: ReportConfig; activate: boolean; proposalId?: string | null }) {
  return reportSummarySchema.parse(await apiPost("/api/v1/reports", input))
}

export async function updateReport(id: string, input: { revision: number; config: ReportConfig }) {
  return reportSummarySchema.parse(await apiSend(`/api/v1/reports/${id}`, "PUT", input))
}

export async function setReportStatus(id: string, input: { revision: number; status: "ACTIVE" | "INACTIVE" }) {
  return reportSummarySchema.parse(await apiPost(`/api/v1/reports/${id}/status`, input))
}

export async function runReportNow(id: string) {
  return z.object({ runId: z.string().nullable() }).parse(await apiPost(`/api/v1/reports/${id}/run`))
}

export async function deleteReport(id: string) {
  await apiSend(`/api/v1/reports/${id}`, "DELETE")
}

export async function fetchReceivedDeliveries(reportId?: string) {
  return z.array(receivedDeliverySchema).parse(await apiGet(`/api/v1/reports/received${reportId ? `?reportId=${reportId}` : ""}`))
}

export async function fetchDelivery(id: string) {
  return deliveryDetailSchema.parse(await apiGet(`/api/v1/reports/deliveries/${id}`))
}

export async function markDeliveryRead(id: string) {
  await apiPost(`/api/v1/reports/deliveries/${id}/read`)
}

export async function retryDeliveryAnalysis(id: string) {
  return z.object({ analysisStatus: z.string() }).parse(await apiPost(`/api/v1/reports/deliveries/${id}/analysis/retry`))
}

export async function searchAudiencePeople(query: string) {
  return z.array(audiencePersonSchema).parse(await apiGet(`/api/v1/reports/audience/people?q=${encodeURIComponent(query)}`))
}
