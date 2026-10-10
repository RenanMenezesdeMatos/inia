import { adminGet, adminGetBlob, adminSend } from "@/lib/admin/admin-api"
import {
  contextSchema,
  conversationsSchema,
  feedbacksSchema,
  journeysSchema,
  overviewSchema,
  peopleSchema,
  personDetailSchema,
  qualitySchema,
  screensSchema,
  timelineSchema,
  workflowsSchema,
  type UsabilityContext,
  type UsabilityPersonDetail,
  type UsabilityTimeline,
} from "@/schemas/admin/usability.schema"

/**
 * Monitoria de usabilidade — `/api/v1/admin/usability`. O backend aplica permissão e escopo em cada chamada (agregados,
 * pessoas identificadas, comentários, exportação, configuração); a tela só repassa os filtros da URL. Nada aqui tem dado de
 * exemplo: sem resposta = estado de erro, nunca números inventados.
 */
const BASE = "/api/v1/admin/usability"

export const USABILITY_TABS = ["overview", "people", "screens", "feedbacks", "conversations", "workflows", "journeys", "quality"] as const
export type UsabilityTab = (typeof USABILITY_TABS)[number]

const ENDPOINT: Record<UsabilityTab, string> = {
  overview: "overview",
  people: "users",
  screens: "screens",
  feedbacks: "feedbacks",
  conversations: "conversations",
  workflows: "workflows",
  journeys: "journeys",
  quality: "data-quality",
}

const SCHEMA = {
  overview: overviewSchema,
  people: peopleSchema,
  screens: screensSchema,
  feedbacks: feedbacksSchema,
  conversations: conversationsSchema,
  workflows: workflowsSchema,
  journeys: journeysSchema,
  quality: qualitySchema,
} as const

export type UsabilityTabData = { [K in UsabilityTab]: ReturnType<(typeof SCHEMA)[K]["parse"]> }
export type UsabilityQuery = Record<string, string>

const qs = (query: UsabilityQuery) => {
  const params = new URLSearchParams(query)
  const text = params.toString()
  return text ? `?${text}` : ""
}

export async function fetchUsabilityContext(): Promise<UsabilityContext> {
  return contextSchema.parse(await adminGet(`${BASE}/context`))
}

export async function fetchUsabilityTab<T extends UsabilityTab>(tab: T, query: UsabilityQuery): Promise<UsabilityTabData[T]> {
  return SCHEMA[tab].parse(await adminGet(`${BASE}/${ENDPOINT[tab]}${qs(query)}`)) as UsabilityTabData[T]
}

export async function fetchUsabilityPerson(personId: string, query: UsabilityQuery): Promise<UsabilityPersonDetail> {
  return personDetailSchema.parse(await adminGet(`${BASE}/users/${personId}${qs(query)}`))
}

export async function fetchUsabilityTimeline(personId: string, query: UsabilityQuery): Promise<UsabilityTimeline> {
  return timelineSchema.parse(await adminGet(`${BASE}/users/${personId}/timeline${qs(query)}`))
}

export type PersonOption = { id: string; name: string; matricula: string | null; teamName: string | null }
export async function searchUsabilityPeople(search: string): Promise<PersonOption[]> {
  return adminGet(`${BASE}/users/options${qs({ search })}`)
}

/** Exportação: o MESMO recorte da API (aba, tabela e filtros). O arquivo vem do servidor com BOM, `;` e vírgula decimal. */
export async function downloadUsabilityCsv(tab: UsabilityTab, table: string, query: UsabilityQuery): Promise<void> {
  const { blob, filename } = await adminGetBlob(`${BASE}/export.csv${qs({ ...query, tab, table })}`)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.setAttribute("data-usage-ignore", "")
  anchor.href = url
  anchor.download = filename ?? `usabilidade-${tab}-${table}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export type UsabilitySettingsInput = { collectionEnabled?: boolean; rawRetentionDays?: number; factRetentionMonths?: number; timezoneOverride?: string | null; reason: string }
export const updateUsabilitySettings = (input: UsabilitySettingsInput) => adminSend(`${BASE}/settings`, "PUT", input)

export type ClassificationInput = { personId: string; classification: "TEST" | "DEMO" | "AUTOMATION"; reason: string }
export const classifyUsabilityPerson = (input: ClassificationInput) => adminSend(`${BASE}/classifications`, "POST", input)
export const unclassifyUsabilityPerson = (personId: string, reason: string) => adminSend(`${BASE}/classifications/${personId}`, "DELETE", { reason })

export const reprocessUsability = (input: { from: string; to: string; reason: string }) => adminSend<{ personDays: number }>(`${BASE}/reprocess`, "POST", input)
