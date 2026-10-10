import { randomUUID } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"
import { EVENT_BY_NAME, USAGE_EVENT_SCHEMA_VERSION, type UsageEntityType } from "../domain/usage-events.js"
import { currentEnvironment, loadUsageSettings } from "./usage-settings.js"
import { insertUsageEvents, loadActorContext, touchCoverage } from "./usage-event-store.js"

/**
 * FATO DE SERVIDOR (login, logout, ciclo da aplicação de feedback, convite, sessão de voz emitida, notificação lida,
 * exportação) — gravado DEPOIS de a operação de negócio responder com sucesso. Melhor esforço: falha aqui é registrada no log e
 * NUNCA desfaz nem atrasa a ação já concluída. A chave semântica (`idempotencyKey`) impede que o mesmo fato entre duas vezes.
 */
type Queryable = Pick<Database, "query">

export type ServerEventInput = {
  organizationId: string
  name: string
  accountId: string | null
  actorPersonId: string | null
  subjectPersonId?: string | null
  entity?: { type: UsageEntityType; id: string } | null
  properties?: Record<string, unknown>
  idempotencyKey?: string | null
  occurredAt?: Date
}

export async function recordServerUsageEvent(db: Queryable, input: ServerEventInput): Promise<boolean> {
  try {
    const definition = EVENT_BY_NAME.get(input.name)
    if (!definition || definition.emitter !== "SERVER") throw new Error(`Evento de servidor fora do catálogo: ${input.name}`)
    const properties = definition.properties.parse(input.properties ?? {}) as Record<string, unknown>
    const now = input.occurredAt ?? new Date()
    const settings = await loadUsageSettings(db, input.organizationId, now)
    if (!settings.collectionEnabled) return false
    const actor = input.actorPersonId ? await loadActorContext(db, input.organizationId, input.actorPersonId) : null
    const row = {
      organizationId: input.organizationId,
      eventId: randomUUID(),
      eventName: input.name,
      schemaVersion: USAGE_EVENT_SCHEMA_VERSION,
      family: definition.family,
      source: "SERVER" as const,
      actorType: input.actorPersonId ? ("HUMAN" as const) : ("SYSTEM" as const),
      accountId: input.accountId,
      actorPersonId: input.actorPersonId,
      subjectPersonId: input.subjectPersonId ?? null,
      occurredAt: now,
      clientOccurredAt: null,
      receivedAt: now,
      clockOffsetMs: null,
      timestampStatus: "OK" as const,
      usageSessionId: null,
      tabId: null,
      screenInstanceId: null,
      screenKey: null,
      featureKey: null,
      elementKey: null,
      routeTemplate: null,
      area: null,
      entityType: input.entity?.type ?? null,
      entityId: input.entity?.id ?? null,
      correlationId: null,
      device: null,
      appVersion: null,
      environment: currentEnvironment(),
      populationClass: actor?.populationClass ?? ("REAL" as const),
      teamId: actor?.teamId ?? null,
      subteamId: actor?.subteamId ?? null,
      reportsToId: actor?.reportsToId ?? null,
      properties,
      idempotencyKey: input.idempotencyKey ?? null,
      batchId: null,
    }
    const inserted = await insertUsageEvents(db, [row])
    if (inserted.size > 0) {
      await touchCoverage(db, input.organizationId, [row], now)
      if (input.name === "auth.login_succeeded" && input.actorPersonId) await touchLoginMilestone(db, input.organizationId, input.actorPersonId, now)
    }
    return inserted.size > 0
  } catch (error) {
    console.error(JSON.stringify({ event: "usage_server_event_failed", name: input.name, message: (error as Error).message }))
    return false
  }
}

/** Login comprovado também é marco de acesso (primeiro/último observado). */
async function touchLoginMilestone(db: Queryable, organizationId: string, personId: string, at: Date) {
  await db.query(
    `insert into usage_person_milestones (organization_id, person_id, first_observed_at, first_observed_source, last_observed_at, last_observed_source, updated_at)
     values ($1, $2, $3, 'LOGIN', $3, 'LOGIN', $3)
     on conflict (organization_id, person_id) do update set
       first_observed_source = case when usage_person_milestones.first_observed_at is null or excluded.first_observed_at < usage_person_milestones.first_observed_at then 'LOGIN' else usage_person_milestones.first_observed_source end,
       first_observed_at = least(coalesce(usage_person_milestones.first_observed_at, excluded.first_observed_at), excluded.first_observed_at),
       last_observed_source = case when usage_person_milestones.last_observed_at is null or excluded.last_observed_at > usage_person_milestones.last_observed_at then 'LOGIN' else usage_person_milestones.last_observed_source end,
       last_observed_at = greatest(coalesce(usage_person_milestones.last_observed_at, excluded.last_observed_at), excluded.last_observed_at),
       updated_at = excluded.updated_at`,
    [organizationId, personId, at],
  )
}

/** Falha de login: só a contagem por hora da instalação (nunca organização nem pessoa pela entrada digitada). */
export async function countLoginFailure(db: Queryable, at = new Date()) {
  try {
    const bucket = new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000)
    await db.query(`insert into usage_auth_failure_counts (bucket_start, failures) values ($1, 1) on conflict (bucket_start) do update set failures = usage_auth_failure_counts.failures + 1`, [bucket])
  } catch (error) {
    console.error(JSON.stringify({ event: "usage_login_failure_count_failed", message: (error as Error).message }))
  }
}
