import { apiGet, apiPost } from "@/lib/api/api-client"
import {
  contestationDetailSchema,
  contestationPageSchema,
  type ContestationDetail,
  type ContestationPage,
  type ContestationStatus,
} from "@/schemas/admin/feedback-contestation.schema"
import type { ContestationDecision, FeedbackDislikeReason } from "@/schemas/feedback-ratings/feedback-rating.schema"

/** "Contestações de feedback" — `/api/v1/admin/feedback-contestations`; o backend aplica o escopo de quem revisa em cada chamada. */
const BASE = "/api/v1/admin/feedback-contestations"

export type ContestationFilters = { status?: ContestationStatus | undefined; reason?: FeedbackDislikeReason | undefined; search?: string | undefined; page: number; pageSize: number }

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
