import { apiGet, apiPost } from "@/lib/api/api-client"
import {
  contestationDetailSchema,
  contestationPageSchema,
  contestationSummarySchema,
  type ContestationDetail,
  type ContestationPage,
  type ContestationStatus,
  type ContestationSummary,
} from "@/schemas/admin/feedback-contestation.schema"
import type { ContestationDecision, ContestationOrigin, ContestationReason } from "@/schemas/feedback-ratings/feedback-rating.schema"

/** "Contestações de feedback" — `/api/v1/admin/feedback-contestations`; o backend aplica o escopo de quem revisa em cada chamada. */
const BASE = "/api/v1/admin/feedback-contestations"

export type ContestationFilters = {
  status?: ContestationStatus | undefined
  origin?: ContestationOrigin | undefined
  reason?: ContestationReason | undefined
  search?: string | undefined
  page: number
  pageSize: number
}

export async function fetchContestations(filters: ContestationFilters): Promise<ContestationPage> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") params.set(key, String(value))
  return contestationPageSchema.parse(await apiGet<unknown>(`${BASE}?${params}`))
}

export async function fetchContestation(id: string): Promise<ContestationDetail> {
  return contestationDetailSchema.parse(await apiGet<unknown>(`${BASE}/${encodeURIComponent(id)}`))
}

export async function reviewContestation(id: string, input: { decision: ContestationDecision; response: string }): Promise<ContestationDetail> {
  return contestationDetailSchema.parse(await apiPost<unknown>(`${BASE}/${encodeURIComponent(id)}/review`, input))
}

/** Taxa de contestação dos feedbacks disponibilizados no período (datas locais "AAAA-MM-DD", inclusivas). */
export async function fetchContestationSummary(period: { from: string; to: string }): Promise<ContestationSummary> {
  return contestationSummarySchema.parse(await apiGet<unknown>(`${BASE}/summary?${new URLSearchParams(period)}`))
}
