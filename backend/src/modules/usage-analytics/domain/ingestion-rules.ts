import { z } from "zod"
import { ELEMENT_BY_KEY, CONTENT_KEYS, SEARCH_SURFACE_KEYS } from "./usage-elements.js"
import { CLIENT_EVENT_NAMES, EVENT_BY_NAME, USAGE_ENTITY_TYPES, USAGE_EVENT_SCHEMA_VERSION, type UsageEntityType } from "./usage-events.js"
import { SCREEN_BY_KEY, screenAreaOf, type UsageArea } from "./usage-screens.js"

/**
 * INGESTÃO de eventos do navegador — validação pura (o que depende do banco — entidade existe e pertence ao alcance do ator —
 * fica na aplicação). Tudo que não está no catálogo é RECUSADO com motivo contado na Qualidade da medição; nunca guardado como
 * texto livre.
 *
 * Relógio: o navegador manda o instante do fato (relógio dele) e o instante do envio. A diferença entre o envio e o
 * recebimento estima o desvio do relógio + trânsito. Até 2 min de diferença o horário do cliente é mantido; acima disso ele é
 * corrigido pelo desvio e marcado (`CLIENT_CLOCK_CORRECTED`). Evento mais de 5 s no futuro (já corrigido) é recusado; evento
 * com mais de 72 h (a fila local expira em 24 h) é recusado como expirado; entre 10 min e 72 h ele é aceito como ATRASADO — com
 * o horário do fato, nunca reescrito como "agora".
 */
export const MAX_EVENTS_PER_BATCH = 100
export const MAX_BATCH_BYTES = 128 * 1024
export const MAX_EVENTS_PER_ACCOUNT_PER_MINUTE = 600
export const CLOCK_SKEW_TOLERANCE_MS = 120_000
export const FUTURE_TOLERANCE_MS = 5_000
export const LATE_THRESHOLD_MS = 10 * 60_000
export const MAX_EVENT_AGE_MS = 72 * 3_600_000

export const USAGE_DEVICES = ["DESKTOP", "MOBILE", "TABLET"] as const

export const REJECTION_REASONS = [
  "INVALID_ENVELOPE",
  "UNKNOWN_EVENT",
  "INVALID_PROPERTIES",
  "UNKNOWN_SCREEN",
  "UNKNOWN_ELEMENT",
  "ROUTE_MISMATCH",
  "ENTITY_NOT_ALLOWED",
  "ENTITY_NOT_FOUND",
  "ENTITY_NOT_AUTHORIZED",
  "TIMESTAMP_IN_FUTURE",
  "TIMESTAMP_TOO_OLD",
  "INVALID_SPAN",
  "RATE_LIMITED",
] as const
export type RejectionReason = (typeof REJECTION_REASONS)[number]
export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  INVALID_ENVELOPE: "Envelope inválido",
  UNKNOWN_EVENT: "Evento fora do catálogo",
  INVALID_PROPERTIES: "Propriedades fora do esquema",
  UNKNOWN_SCREEN: "Tela fora do catálogo",
  UNKNOWN_ELEMENT: "Elemento fora do catálogo",
  ROUTE_MISMATCH: "Rota não corresponde à tela",
  ENTITY_NOT_ALLOWED: "Entidade não permitida para o evento",
  ENTITY_NOT_FOUND: "Entidade inexistente na organização",
  ENTITY_NOT_AUTHORIZED: "Entidade fora do alcance de quem usa",
  TIMESTAMP_IN_FUTURE: "Horário no futuro",
  TIMESTAMP_TOO_OLD: "Evento expirado (mais de 72 h)",
  INVALID_SPAN: "Intervalo inválido",
  RATE_LIMITED: "Acima do limite de frequência",
}

export type TimestampStatus = "OK" | "CLIENT_CLOCK_CORRECTED" | "LATE"

const routeTemplatePattern = /^\/[A-Za-z0-9:/*_-]{0,120}$/
const entitySchema = z.object({ type: z.enum(USAGE_ENTITY_TYPES), id: z.string().uuid() }).strict()

export const clientEventSchema = z
  .object({
    eventId: z.string().uuid(),
    name: z.string().max(60),
    schemaVersion: z.literal(USAGE_EVENT_SCHEMA_VERSION),
    occurredAt: z.string().datetime({ offset: true }),
    usageSessionId: z.string().uuid(),
    tabId: z.string().uuid(),
    screenInstanceId: z.string().uuid().nullable(),
    screenKey: z.string().max(80).nullable(),
    elementKey: z.string().max(80).nullable(),
    routeTemplate: z.string().regex(routeTemplatePattern).nullable(),
    entity: entitySchema.nullable(),
    correlationId: z.string().uuid().nullable(),
    properties: z.record(z.string(), z.unknown()),
  })
  .strict()
export type ClientEvent = z.infer<typeof clientEventSchema>

export const clientBatchSchema = z
  .object({
    accountId: z.string().uuid(),
    sentAt: z.string().datetime({ offset: true }),
    appVersion: z.string().regex(/^[A-Za-z0-9._+-]{1,40}$/).nullable(),
    device: z.enum(USAGE_DEVICES),
    events: z.array(z.unknown()).min(1).max(MAX_EVENTS_PER_BATCH),
  })
  .strict()

export type ValidatedEvent = ClientEvent & {
  effectiveOccurredAt: Date
  clientOccurredAt: Date
  timestampStatus: TimestampStatus
  featureKey: string | null
  area: UsageArea | null
  properties: Record<string, unknown>
}
export type EventValidation = { ok: true; event: ValidatedEvent } | { ok: false; reason: RejectionReason; eventId: string | null }

/** Rota declarada × tela do catálogo: a rota tem de ser a da tela ou a de algum ancestral (aba/painel herdam). */
function routeMatches(screenKey: string, routeTemplate: string | null): boolean {
  const screen = SCREEN_BY_KEY.get(screenKey)
  if (!screen) return false
  if (routeTemplate === null) return screen.kind !== "ROUTE"
  if (screen.kind === "PANEL" || screen.kind === "MODAL") return true
  let current: typeof screen | undefined = screen
  while (current) {
    if (current.routeTemplate === routeTemplate) return true
    if (current.routeTemplate === "/wiki/*" && routeTemplate.startsWith("/wiki")) return true
    current = current.parent ? SCREEN_BY_KEY.get(current.parent) : undefined
  }
  return false
}

export function clockOffsetMs(sentAt: Date, receivedAt: Date): number {
  return receivedAt.getTime() - sentAt.getTime()
}

export function validateClientEvent(raw: unknown, context: { receivedAt: Date; clockOffsetMs: number }): EventValidation {
  const parsed = clientEventSchema.safeParse(raw)
  const eventId = typeof (raw as { eventId?: unknown })?.eventId === "string" ? ((raw as { eventId: string }).eventId) : null
  if (!parsed.success) return { ok: false, reason: "INVALID_ENVELOPE", eventId }
  const event = parsed.data
  const definition = EVENT_BY_NAME.get(event.name)
  if (!definition || !CLIENT_EVENT_NAMES.includes(event.name)) return { ok: false, reason: "UNKNOWN_EVENT", eventId }
  const properties = definition.properties.safeParse(event.properties)
  if (!properties.success) return { ok: false, reason: "INVALID_PROPERTIES", eventId }
  if (event.screenKey !== null && !SCREEN_BY_KEY.has(event.screenKey)) return { ok: false, reason: "UNKNOWN_SCREEN", eventId }
  if (definition.requiresScreen && (event.screenKey === null || event.screenInstanceId === null)) return { ok: false, reason: "UNKNOWN_SCREEN", eventId }
  if (event.screenKey !== null && !routeMatches(event.screenKey, event.routeTemplate)) return { ok: false, reason: "ROUTE_MISMATCH", eventId }
  if (event.elementKey !== null && !ELEMENT_BY_KEY.has(event.elementKey)) return { ok: false, reason: "UNKNOWN_ELEMENT", eventId }
  if (definition.requiresElement && event.elementKey === null) return { ok: false, reason: "UNKNOWN_ELEMENT", eventId }
  if (event.entity && !(definition.entityTypes ?? []).includes(event.entity.type)) return { ok: false, reason: "ENTITY_NOT_ALLOWED", eventId }
  const props = properties.data as Record<string, unknown>
  if (event.name === "content.scrolled" && !CONTENT_KEYS.has(String(props.contentKey))) return { ok: false, reason: "INVALID_PROPERTIES", eventId }
  if ((event.name === "search.performed" || event.name === "search.result_opened" || event.name === "filter.applied") && !SEARCH_SURFACE_KEYS.has(String(props.surface))) return { ok: false, reason: "INVALID_PROPERTIES", eventId }
  if (typeof props.targetScreenKey === "string" && !SCREEN_BY_KEY.has(props.targetScreenKey)) return { ok: false, reason: "INVALID_PROPERTIES", eventId }

  const clientOccurredAt = new Date(event.occurredAt)
  const corrected = Math.abs(context.clockOffsetMs) > CLOCK_SKEW_TOLERANCE_MS
  const effective = corrected ? new Date(clientOccurredAt.getTime() + context.clockOffsetMs) : clientOccurredAt
  if (effective.getTime() > context.receivedAt.getTime() + FUTURE_TOLERANCE_MS) return { ok: false, reason: "TIMESTAMP_IN_FUTURE", eventId }
  const age = context.receivedAt.getTime() - effective.getTime()
  if (age > MAX_EVENT_AGE_MS) return { ok: false, reason: "TIMESTAMP_TOO_OLD", eventId }
  // Intervalos (heartbeat, microfone, reprodução) também passam pela correção e precisam ser coerentes.
  if (typeof props.spanStart === "string" && typeof props.spanEnd === "string") {
    const start = new Date(props.spanStart).getTime() + (corrected ? context.clockOffsetMs : 0)
    const end = new Date(props.spanEnd).getTime() + (corrected ? context.clockOffsetMs : 0)
    if (!(end > start) || end > context.receivedAt.getTime() + FUTURE_TOLERANCE_MS) return { ok: false, reason: "INVALID_SPAN", eventId }
    if (event.name === "activity.heartbeat" && end - start > 20_000) return { ok: false, reason: "INVALID_SPAN", eventId }
    if (event.name !== "activity.heartbeat" && end - start > 6 * 3_600_000) return { ok: false, reason: "INVALID_SPAN", eventId }
  }
  const timestampStatus: TimestampStatus = corrected ? "CLIENT_CLOCK_CORRECTED" : age > LATE_THRESHOLD_MS ? "LATE" : "OK"
  const element = event.elementKey ? ELEMENT_BY_KEY.get(event.elementKey) : undefined
  const featureKey = element?.feature ?? (event.screenKey ? SCREEN_BY_KEY.get(event.screenKey)?.feature ?? null : null)
  return { ok: true, event: { ...event, properties: props, effectiveOccurredAt: effective, clientOccurredAt, timestampStatus, featureKey, area: screenAreaOf(event.screenKey) } }
}

/** Aplica a mesma correção de relógio de um evento a um instante das propriedades (intervalos). */
export function correctedInstant(value: string, offsetMs: number): Date {
  const instant = new Date(value)
  return Math.abs(offsetMs) > CLOCK_SKEW_TOLERANCE_MS ? new Date(instant.getTime() + offsetMs) : instant
}

/** Limite de frequência por conta (janela deslizante de 1 min, em memória do processo). */
export function createRateLimiter(limit = MAX_EVENTS_PER_ACCOUNT_PER_MINUTE, windowMs = 60_000) {
  const hits = new Map<string, number[]>()
  return {
    /** Quantos dos `count` eventos cabem agora (o resto é recusado como RATE_LIMITED). */
    take(accountId: string, count: number, now: Date): number {
      const since = now.getTime() - windowMs
      const recent = (hits.get(accountId) ?? []).filter((at) => at > since)
      const allowed = Math.max(0, Math.min(count, limit - recent.length))
      for (let index = 0; index < allowed; index += 1) recent.push(now.getTime())
      hits.set(accountId, recent)
      return allowed
    },
  }
}

export type EntityRef = { type: UsageEntityType; id: string }
