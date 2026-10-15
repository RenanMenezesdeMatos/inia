import { adminGet } from "@/lib/admin/admin-api"
import { toQueryString } from "@/lib/admin/list-query"
import type { AiUsagePeriod } from "@/schemas/admin/ai-management.schema"
import {
  aiUsageRankingContextSchema,
  aiUsageRankingSchema,
  type AiUsageRanking,
  type AiUsageRankingContext,
  type AiUsageRankingLevel,
  type AiUsageRankingSort,
  type AiUsageSource,
} from "@/schemas/admin/ai-usage-ranking.schema"

const BASE = "/api/v1/admin/ai/usage/ranking"

/** O que vai na URL: só códigos do catálogo, instantes e ids opacos — nunca nome nem texto livre. */
export type AiUsageRankingParams = {
  level: AiUsageRankingLevel
  period: AiUsagePeriod
  from?: string
  to?: string
  providerKey?: string
  modelId?: string
  useCase?: string
  source?: AiUsageSource
  teamId?: string
  subteamId?: string
  sort: AiUsageRankingSort
  page: number
  pageSize: number
}

export async function fetchAiUsageRanking(params: AiUsageRankingParams): Promise<AiUsageRanking> {
  return aiUsageRankingSchema.parse(await adminGet(`${BASE}${toQueryString(params)}`))
}

export async function fetchAiUsageRankingContext(): Promise<AiUsageRankingContext> {
  return aiUsageRankingContextSchema.parse(await adminGet(`${BASE}/context`))
}
