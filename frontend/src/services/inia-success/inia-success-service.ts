import { apiGet } from "@/lib/api/api-client"
import { alignmentsSchema, complianceSchema, feedbackSchema, repliesSchema, responseTimeSchema, routesSchema, successContextSchema, supportSchema, type SuccessFilter } from "@/schemas/inia-success/inia-success.schema"

/** Indicadores de sucesso da INIA — leituras agregadas (o servidor decide o alcance de cada bloco pela permissão de quem lê). */
const BASE = "/api/v1/admin/inia-success"

const queryOf = (filter: SuccessFilter) => {
  const params = new URLSearchParams({ from: filter.from, to: filter.to })
  if (filter.teamId?.length) params.set("teamId", filter.teamId.join(","))
  if (filter.subteamId?.length) params.set("subteamId", filter.subteamId.join(","))
  return params.toString()
}

export const fetchSuccessContext = async () => successContextSchema.parse(await apiGet<unknown>(`${BASE}/context`))
export const fetchResponseTime = async (filter: SuccessFilter) => responseTimeSchema.parse(await apiGet<unknown>(`${BASE}/response-time?${queryOf(filter)}`))
export const fetchRoutes = async (filter: SuccessFilter) => routesSchema.parse(await apiGet<unknown>(`${BASE}/routes?${queryOf(filter)}`))
export const fetchReplies = async (filter: SuccessFilter) => repliesSchema.parse(await apiGet<unknown>(`${BASE}/replies?${queryOf(filter)}`))
export const fetchSupport = async (filter: SuccessFilter) => supportSchema.parse(await apiGet<unknown>(`${BASE}/support?${queryOf(filter)}`))
export const fetchFeedback = async (filter: SuccessFilter) => feedbackSchema.parse(await apiGet<unknown>(`${BASE}/feedback?${queryOf(filter)}`))
export const fetchCompliance = async (filter: SuccessFilter) => complianceSchema.parse(await apiGet<unknown>(`${BASE}/compliance?${queryOf(filter)}`))
export const fetchAlignments = async (filter: SuccessFilter) => alignmentsSchema.parse(await apiGet<unknown>(`${BASE}/alignments?${queryOf(filter)}`))
