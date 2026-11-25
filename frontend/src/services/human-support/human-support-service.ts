import { ApiError, apiGet, apiPost, apiSend } from "@/lib/api/api-client"
import { anjoRowSchema, responseTimesPanelSchema, scopeNodeSchema, settingsViewSchema, type ResponseTimes, type ScopeState, type SettingsView } from "@/schemas/human-support/admin.schema"
import type { ClassificationOutcome, ClassificationReason, EvaluationResolved, PauseReason, Pertinence } from "@/schemas/human-support/catalogs.schema"
import { abandonmentListSchema, abandonmentSchema, type AbandonmentKind, anjosNowSchema, demandSchema, operationHistorySchema, queueWaitingSchema, type Productivity, classificationViewSchema, funnelResponseSchema, presenceTimelineSchema, requestDetailSchema, requestListSchema, transferCandidatesSchema, unavailableAttemptsSchema } from "@/schemas/human-support/monitoring.schema"
import { anjoAttendanceHistorySchema, anjoViewSchema, evaluationCurrentSchema, messagesPageSchema, messageViewSchema, myRequestsSchema, operatorRequestViewSchema, previewResponseSchema, receiptsSchema, stateResponseSchema, type StateResponse } from "@/schemas/human-support/state.schema"
import { z } from "zod"

/**
 * Apoio com Anjo — chamadas à API (o servidor resolve a pessoa pela sessão e decide o alcance). A chamada de estado é GET com
 * espera longa (até 20 s); ela nunca renova a sessão e nunca chama `/auth/activity`.
 */
const API_URL = process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"
const BASE = "/api/v1/human-support"
const ADMIN = "/api/v1/admin/human-support"
const MONITORING = "/api/v1/admin/human-support-monitoring"

export async function fetchHumanSupportState(input: { since?: string | null; wait?: number; workspace?: "anjo" | "anjo-status" | "none"; signal?: AbortSignal }): Promise<StateResponse> {
  const params = new URLSearchParams({ wait: String(input.wait ?? 0), workspace: input.workspace ?? "none" })
  if (input.since) params.set("since", input.since)
  const response = await fetch(`${API_URL}${BASE}/me/state?${params}`, { credentials: "include", cache: "no-store", ...(input.signal ? { signal: input.signal } : {}) })
  if (!response.ok) throw new ApiError(`Erro ${response.status}`, response.status, null)
  return stateResponseSchema.parse(((await response.json()) as { data: unknown }).data)
}

export async function previewSupportRequest(source: { interactionId?: string | null; ratingId?: string | null }) {
  return previewResponseSchema.parse(await apiPost<unknown>(`${BASE}/requests/preview`, compact(source)))
}

export async function createSupportRequest(input: { clientRequestId: string; interactionId?: string | null; ratingId?: string | null; note?: string }) {
  return z.object({ request: operatorRequestViewSchema }).parse(await apiPost<unknown>(`${BASE}/requests`, compact(input))).request
}

export async function cancelSupportRequest(requestId: string) {
  return z.object({ request: operatorRequestViewSchema }).parse(await apiPost<unknown>(`${BASE}/requests/${requestId}/cancel`, {})).request
}

/** Encerrar: o operador recebe o pedido atualizado; o Anjo, a área dele atualizada. */
export async function closeSupportRequestAsOperator(requestId: string) {
  return z.object({ request: operatorRequestViewSchema }).parse(await apiPost<unknown>(`${BASE}/requests/${requestId}/close`, {})).request
}
export async function closeSupportRequestAsAnjo(requestId: string, cause?: "OPERATOR_ABSENT") {
  return z.object({ anjo: anjoViewSchema }).parse(await apiPost<unknown>(`${BASE}/requests/${requestId}/close`, cause ? { cause } : {})).anjo
}

export async function fetchSupportMessages(requestId: string, query: { after?: number; before?: number; limit?: number } = {}) {
  const params = new URLSearchParams(Object.entries(query).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])))
  return messagesPageSchema.parse(await apiGet<unknown>(`${BASE}/requests/${requestId}/messages${params.size ? `?${params}` : ""}`))
}

export async function sendSupportMessage(requestId: string, input: { clientMessageId: string; body: string }) {
  return z.object({ message: messageViewSchema }).parse(await apiPost<unknown>(`${BASE}/requests/${requestId}/messages`, input)).message
}

/** "Estou digitando" (renovado pela tela a cada 4 s) ou "parei sem enviar". O texto em digitação nunca sai da tela. */
export async function signalSupportTyping(requestId: string, typing: boolean): Promise<void> {
  await apiPost(`${BASE}/requests/${requestId}/typing`, { typing })
}

/** Entregue (o aplicativo recebeu) e lida (a pessoa viu) até um `seq`. O servidor só avança e devolve o recibo desta ponta. */
export async function acknowledgeSupportMessages(requestId: string, ack: { deliveredSeq?: number; readSeq?: number }) {
  return z.object({ receipts: receiptsSchema }).parse(await apiPost<unknown>(`${BASE}/requests/${requestId}/receipts`, compact(ack))).receipts
}

export async function evaluateSupportAttendance(attendanceId: string, input: { resolved?: EvaluationResolved; stars?: number }) {
  return z.object({ current: evaluationCurrentSchema }).parse(await apiSend<unknown>(`${BASE}/attendances/${attendanceId}/evaluation`, "PUT", input)).current
}

export async function fetchMySupportRequests(cursor?: string | null) {
  return myRequestsSchema.parse(await apiGet<unknown>(`${BASE}/me/requests${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`))
}

export type PresenceChange = { status: "AVAILABLE" } | { status: "PAUSED"; pauseReason: PauseReason } | { status: "OFFLINE" }
export async function changeAnjoPresence(change: PresenceChange) {
  return z.object({ anjo: anjoViewSchema }).parse(await apiSend<unknown>(`${BASE}/anjo/presence`, "PUT", change)).anjo
}

/** "Cancelar programação": o estado atual fica e o Anjo volta a poder receber chamados. */
export async function cancelScheduledAnjoPresence() {
  return z.object({ anjo: anjoViewSchema }).parse(await apiSend<unknown>(`${BASE}/anjo/presence/scheduled`, "DELETE")).anjo
}

export async function fetchAnjoAttendanceHistory(cursor?: string | null) {
  return anjoAttendanceHistorySchema.parse(await apiGet<unknown>(`${BASE}/anjo/attendances${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`))
}

export type ClassificationInput = { reason: ClassificationReason; referenceTitle?: string; referenceUrl?: string; otherDescription?: string; outcome: ClassificationOutcome; pertinence: Pertinence }
export async function classifySupportAttendance(attendanceId: string, input: ClassificationInput) {
  return z.object({ classification: classificationViewSchema }).parse(await apiPost<unknown>(`${BASE}/attendances/${attendanceId}/classification`, compact(input))).classification
}

/** O próprio histórico do Anjo (jornada e indicadores de atendimento). */
export async function fetchMyAnjoHistory(period: { from: string; to: string }) {
  return operationHistorySchema.parse(await apiGet<unknown>(`${BASE}/anjo/history?${new URLSearchParams(period)}`))
}

// Administrador geral
export async function fetchSupportSettings() {
  return settingsViewSchema.parse(await apiGet<unknown>(`${ADMIN}/settings`))
}
export async function saveSupportSettings(input: SettingsView) {
  return settingsViewSchema.parse(await apiSend<unknown>(`${ADMIN}/settings`, "PUT", input))
}
export async function fetchSupportScopes() {
  return z.object({ items: z.array(scopeNodeSchema) }).parse(await apiGet<unknown>(`${ADMIN}/scopes`)).items
}
export async function saveSupportScopeState(scopeType: "group" | "subgroup", id: string, state: ScopeState) {
  return z.object({ node: scopeNodeSchema }).parse(await apiSend<unknown>(`${ADMIN}/scopes/${scopeType}/${id}`, "PUT", { state })).node
}
export async function fetchSupportAnjos(filter: { teamId?: readonly string[] | null; subteamId?: readonly string[] | null } = {}) {
  const params = new URLSearchParams(Object.entries(filter).flatMap(([key, value]) => (value?.length ? [[key, value.join(",")]] : [])))
  return z.object({ items: z.array(anjoRowSchema) }).parse(await apiGet<unknown>(`${ADMIN}/anjos${params.size ? `?${params}` : ""}`)).items
}
export async function saveAnjoCapacity(personId: string, maxConcurrent: number | null) {
  return z.object({ row: anjoRowSchema }).parse(await apiSend<unknown>(`${ADMIN}/anjos/${personId}/capacity`, "PUT", { maxConcurrent })).row
}

// Painel do apoio (Coordenador de Anjos e Administrador geral)
export type PanelFilter = { from: string; to: string; teamId?: readonly string[] | null; subteamId?: readonly string[] | null }
const panelParams = (filter: PanelFilter & Record<string, string | number | readonly string[] | null | undefined>) => new URLSearchParams(Object.entries(filter).flatMap(([key, value]) => (value === undefined || value === null || value === "" ? [] : [[key, String(value)]])))
export async function fetchSupportFunnel(filter: PanelFilter) {
  return funnelResponseSchema.parse(await apiGet<unknown>(`${MONITORING}/metrics?${panelParams(filter)}`))
}
/** Lista de pedidos: além do período e do Grupo/Subgrupo, a busca (protocolo ou nome do operador), o estado e a origem. */
export type RequestListFilter = PanelFilter & { search?: string | null; status?: string | null; origin?: string | null }
export async function fetchSupportRequests(filter: RequestListFilter & { cursor?: string | null }) {
  return requestListSchema.parse(await apiGet<unknown>(`${MONITORING}/requests?${panelParams(filter)}`))
}
export async function fetchSupportRequestDetail(requestId: string) {
  return requestDetailSchema.parse(await apiGet<unknown>(`${MONITORING}/requests/${requestId}`))
}
/** Transferência pela coordenação: os destinos possíveis e o comando (para um Anjo ou, com `null`, de volta à frente da fila). */
export async function fetchTransferCandidates(requestId: string) {
  return transferCandidatesSchema.parse(await apiGet<unknown>(`${MONITORING}/requests/${requestId}/transfer-candidates`))
}
export async function transferSupportAttendance(requestId: string, input: { toAnjoPersonId: string | null; reason: string }) {
  return requestDetailSchema.parse(await apiPost<unknown>(`${MONITORING}/requests/${requestId}/transfer`, input))
}
export async function fetchUnavailableAttempts(filter: PanelFilter & { cursor?: string | null }) {
  return unavailableAttemptsSchema.parse(await apiGet<unknown>(`${MONITORING}/unavailable-attempts?${panelParams(filter)}`))
}
/** Abandonos na espera e no atendimento no recorte (hoje na Monitoria Online; o período em Indicadores). */
export async function fetchSupportAbandonment(filter: PanelFilter) {
  return abandonmentSchema.parse(await apiGet<unknown>(`${MONITORING}/abandonment?${panelParams(filter)}`))
}
/** Quem abandonou num dos cards (paginado no servidor: 10/20/50 por página). */
export async function fetchSupportAbandonmentList(filter: PanelFilter & { kind: AbandonmentKind; page: number; pageSize: number }) {
  return abandonmentListSchema.parse(await apiGet<unknown>(`${MONITORING}/abandonment/list?${panelParams(filter)}`))
}
/** Situação dos Anjos agora (não depende do período do painel); o Grupo/Subgrupo é o mesmo filtro do painel. */
/** Histórico da operação (coordenação): jornada e indicadores por Anjo, consolidado e números da operação. */
export async function fetchOperationHistory(filter: PanelFilter & { anjoPersonId?: string | null }) {
  return operationHistorySchema.parse(await apiGet<unknown>(`${MONITORING}/history?${panelParams(filter)}`))
}
/** Acionamentos do período (aba Indicadores), com o filtro opcional de produtivos × não produtivos × não avaliados. */
export async function fetchSupportDemand(filter: PanelFilter & { productivity?: Productivity | null }) {
  return demandSchema.parse(await apiGet<unknown>(`${MONITORING}/demand?${panelParams(filter)}`))
}
/** Quem está na fila agora e desde quando (Coordenador de Anjos e Administrador geral). */
/** Tempos de resposta (Painel dos Anjos: Coordenador de Anjos e Administrador geral). */
export async function fetchResponseTimes() {
  return responseTimesPanelSchema.parse(await apiGet<unknown>(`${MONITORING}/response-times`))
}
/** `teamId = null` = o padrão da organização; num Grupo, `times = null` = voltar ao padrão. */
export type SaveResponseTimesInput = { teamId: null; times: ResponseTimes; anjoUnresponsive: { pauseAfterMinutes: number; offlineAfterMinutes: number }; version: number } | { teamId: string; times: ResponseTimes | null; version: number }
export async function saveResponseTimes(input: SaveResponseTimesInput) {
  const body = input.teamId === null ? { ...input.times, anjoUnresponsive: input.anjoUnresponsive, version: input.version } : { times: input.times, version: input.version }
  const path = input.teamId === null ? `${MONITORING}/response-times` : `${MONITORING}/response-times/groups/${encodeURIComponent(input.teamId)}`
  return responseTimesPanelSchema.parse(await apiSend<unknown>(path, "PUT", body))
}
export async function fetchQueueWaiting(filter: { teamId?: readonly string[] | null; subteamId?: readonly string[] | null } = {}) {
  const params = panelParams(filter as PanelFilter)
  return queueWaitingSchema.parse(await apiGet<unknown>(`${MONITORING}/queue${params.size ? `?${params}` : ""}`)).items
}
export async function fetchAnjosNow(filter: { teamId?: readonly string[] | null; subteamId?: readonly string[] | null } = {}) {
  const params = new URLSearchParams(Object.entries(filter).flatMap(([key, value]) => (value?.length ? [[key, value.join(",")]] : [])))
  return anjosNowSchema.parse(await apiGet<unknown>(`${MONITORING}/anjos/now${params.size ? `?${params}` : ""}`))
}
export async function fetchAnjoPresenceTimeline(personId: string, period: { from: string; to: string }) {
  return presenceTimelineSchema.parse(await apiGet<unknown>(`${MONITORING}/anjos/${personId}/presence?${panelParams(period)}`))
}

function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "")) as Partial<T>
}
