import { z } from "zod"

import { apiGet, apiPost, toQueryString } from "@/lib/api/api-client"
import {
  analysisDetailSchema,
  analysisListItemSchema,
  evidenceCallSchema,
  metaSchema,
  patternDetailSchema,
  patternPageSchema,
  previewSchema,
  relevantPracticeSchema,
  type CreateAnalysisInput,
  type PatternFilters,
  type ReviewInput,
} from "@/schemas/best-practices/best-practices.schema"

const BASE = "/api/v1/best-practices"

export const fetchBestPracticesMeta = async () => metaSchema.parse(await apiGet(`${BASE}/meta`))
export const fetchPatterns = async (filters: PatternFilters) => patternPageSchema.parse(await apiGet(`${BASE}/patterns${toQueryString(filters)}`))
export const fetchPattern = async (id: string) => patternDetailSchema.parse(await apiGet(`${BASE}/patterns/${encodeURIComponent(id)}`))
export const fetchEvidenceCall = async (evidenceId: string) => evidenceCallSchema.parse(await apiGet(`${BASE}/evidence/${encodeURIComponent(evidenceId)}/call`))
export const reviewPattern = async (id: string, input: ReviewInput) => apiPost(`${BASE}/patterns/${encodeURIComponent(id)}/review`, input)
export const fetchAnalyses = async () => z.array(analysisListItemSchema).parse(await apiGet(`${BASE}/analyses`))
export const fetchAnalysis = async (id: string) => analysisDetailSchema.parse(await apiGet(`${BASE}/analyses/${encodeURIComponent(id)}`))
export const createAnalysis = async (input: CreateAnalysisInput) => apiPost<{ id: string; status: string }>(`${BASE}/analyses`, input)
export const fetchRelevantPractices = async (query: { indicatorId?: string | null; reason?: string | null; subReason?: string | null; personId?: string | null; interactionId?: string | null }) =>
  z.array(relevantPracticeSchema).parse(await apiGet(`${BASE}/relevant${toQueryString(query)}`))
export const fetchGuidancePreview = async (query: { datasetId: string; operatorRef: string; indicatorId: string }) => previewSchema.parse(await apiGet(`${BASE}/preview${toQueryString(query)}`))
