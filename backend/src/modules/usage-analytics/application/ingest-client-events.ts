import { randomUUID } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { correctedInstant, clientBatchSchema, clockOffsetMs, validateClientEvent, type RejectionReason, type ValidatedEvent, createRateLimiter } from "../domain/ingestion-rules.js"
import { EVENT_BY_NAME, USAGE_EVENT_SCHEMA_VERSION } from "../domain/usage-events.js"
import { authorizeEntities, entityKey } from "./entity-authorization.js"
import { currentEnvironment, loadUsageSettings } from "./usage-settings.js"
import { insertUsageEvents, loadActorContext, markDirty, touchCoverage, type UsageEventRow } from "./usage-event-store.js"

/**
 * INGESTÃO do lote do navegador — `POST /api/v1/usage/events/batch`. Pessoa, conta e organização vêm SEMPRE da sessão; o
 * lote declara a conta que o produziu e, se ela não for a da sessão (troca de conta com fila antiga), o lote inteiro é
 * recusado (409) para o navegador descartá-lo — a atividade de uma pessoa nunca é atribuída a outra. Coleta desligada:
 * nada é gravado e a resposta diz isso (o navegador para de enviar). Falha aqui nunca afeta o produto: o coletor é
 * assíncrono e best effort.
 */
type Queryable = Pick<Database, "query">

export type IngestSession = { organizationId: string; accountId: string; personId: string }
export type IngestResult = { collectionEnabled: boolean; received: number; accepted: number; duplicates: number; rejected: number; rejections: Partial<Record<RejectionReason, number>>; rejectedEventIds: string[] }

const rateLimiter = createRateLimiter()

export async function ingestClientBatch(db: Queryable, session: IngestSession, body: unknown, options: { transport: "FETCH" | "BEACON"; now?: Date; rateLimit?: ReturnType<typeof createRateLimiter> }): Promise<IngestResult> {
  const receivedAt = options.now ?? new Date()
  const parsed = clientBatchSchema.safeParse(body)
  if (!parsed.success) throw new DomainError("Lote de eventos inválido.", "USAGE_BATCH_INVALID", 400)
  const batch = parsed.data
  if (batch.accountId !== session.accountId) throw new DomainError("O lote pertence a outra conta e foi descartado.", "USAGE_ACCOUNT_MISMATCH", 409)
  const settings = await loadUsageSettings(db, session.organizationId, receivedAt)
  if (!settings.collectionEnabled) return { collectionEnabled: false, received: batch.events.length, accepted: 0, duplicates: 0, rejected: 0, rejections: {}, rejectedEventIds: [] }

  const offset = clockOffsetMs(new Date(batch.sentAt), receivedAt)
  const rejections: Partial<Record<RejectionReason, number>> = {}
  const rejectedEventIds: string[] = []
  const reject = (reason: RejectionReason, eventId: string | null) => {
    rejections[reason] = (rejections[reason] ?? 0) + 1
    if (eventId) rejectedEventIds.push(eventId)
  }
  const allowed = (options.rateLimit ?? rateLimiter).take(session.accountId, batch.events.length, receivedAt)
  const valid: ValidatedEvent[] = []
  batch.events.forEach((raw, index) => {
    if (index >= allowed) return reject("RATE_LIMITED", typeof (raw as { eventId?: unknown })?.eventId === "string" ? (raw as { eventId: string }).eventId : null)
    const result = validateClientEvent(raw, { receivedAt, clockOffsetMs: offset })
    if (result.ok) valid.push(result.event)
    else reject(result.reason, result.eventId)
  })

  const entities = valid.flatMap((event) => (event.entity ? [event.entity] : []))
  const decisions = entities.length > 0 ? await authorizeEntities(db, { organizationId: session.organizationId, actorPersonId: session.personId, entities }) : new Map()
  const actor = await loadActorContext(db, session.organizationId, session.personId)
  const batchId = randomUUID()
  const environment = currentEnvironment()
  const rows: UsageEventRow[] = []
  const dirtyInstants: Date[] = []
  for (const event of valid) {
    let subjectPersonId: string | null = null
    if (event.entity) {
      const decision = decisions.get(entityKey(event.entity))
      if (!decision?.ok) {
        reject(decision?.reason ?? "ENTITY_NOT_FOUND", event.eventId)
        continue
      }
      subjectPersonId = decision.subjectPersonId
    }
    const definition = EVENT_BY_NAME.get(event.name)!
    // Intervalos (heartbeat, microfone, reprodução) recebem a mesma correção de relógio do evento.
    const properties = { ...event.properties }
    for (const field of ["spanStart", "spanEnd", "lastInteractionAt"] as const) {
      const value = properties[field]
      if (typeof value === "string") properties[field] = correctedInstant(value, offset).toISOString()
    }
    rows.push({
      organizationId: session.organizationId,
      eventId: event.eventId,
      eventName: event.name,
      schemaVersion: USAGE_EVENT_SCHEMA_VERSION,
      family: definition.family,
      source: "CLIENT",
      actorType: "HUMAN",
      accountId: session.accountId,
      actorPersonId: session.personId,
      subjectPersonId,
      occurredAt: event.effectiveOccurredAt,
      clientOccurredAt: event.clientOccurredAt,
      receivedAt,
      clockOffsetMs: offset,
      timestampStatus: event.timestampStatus,
      usageSessionId: event.usageSessionId,
      tabId: event.tabId,
      screenInstanceId: event.screenInstanceId,
      screenKey: event.screenKey,
      featureKey: event.featureKey,
      elementKey: event.elementKey,
      routeTemplate: event.routeTemplate,
      area: event.area,
      entityType: event.entity?.type ?? null,
      entityId: event.entity?.id ?? null,
      correlationId: event.correlationId,
      device: batch.device,
      appVersion: batch.appVersion,
      environment,
      populationClass: actor.populationClass,
      teamId: actor.teamId,
      subteamId: actor.subteamId,
      reportsToId: actor.reportsToId,
      properties,
      idempotencyKey: null,
      batchId,
    })
    dirtyInstants.push(event.effectiveOccurredAt)
    if (typeof properties.spanEnd === "string") dirtyInstants.push(new Date(properties.spanEnd))
  }

  const inserted = await insertUsageEvents(db, rows)
  const insertedRows = rows.filter((row) => inserted.has(row.eventId))
  const duplicates = rows.length - insertedRows.length
  if (insertedRows.length > 0) {
    await touchCoverage(db, session.organizationId, insertedRows, receivedAt)
    await markDirty(db, session.organizationId, [{ personId: session.personId, instants: dirtyInstants }], settings.timezone, receivedAt)
  }
  const rejected = Object.values(rejections).reduce((sum, count) => sum + (count ?? 0), 0)
  const oldest = rows.length > 0 ? Math.max(...rows.map((row) => receivedAt.getTime() - row.occurredAt.getTime())) : null
  await db.query(
    `insert into usage_ingest_batches (id, organization_id, account_id, received_at, transport, events_received, accepted, duplicates, rejected, rejection_reasons, clock_offset_ms, oldest_event_age_ms, app_version, device)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [batchId, session.organizationId, session.accountId, receivedAt, options.transport, batch.events.length, insertedRows.length, duplicates, rejected, JSON.stringify(rejections), offset, oldest, batch.appVersion, batch.device],
  )
  return { collectionEnabled: true, received: batch.events.length, accepted: insertedRows.length, duplicates, rejected, rejections, rejectedEventIds }
}
