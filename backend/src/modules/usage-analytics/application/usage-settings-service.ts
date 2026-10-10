import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { loadPersonPlacements } from "../../people/application/usage-analytics-reader.js"
import { addDays, datesBetween, localDateOf } from "../domain/usage-time.js"
import { invalidateUsageSettings, loadUsageSettings } from "./usage-settings.js"

/**
 * CONFIGURAÇÃO da monitoria (`usability.manage`, organização inteira) — ligar/desligar a coleta (o intervalo desligado vira
 * lacuna de cobertura, nunca zero), retenção, fuso de apresentação, classificação EXPLÍCITA de pessoas de teste/demonstração/
 * automação e reprocessamento das projeções. Toda alteração é auditada (ator + o que mudou, nunca dados de uso).
 */
type Queryable = Pick<Database, "query">
export type ManageActor = { organizationId: string; personId: string; accountId: string }

export const settingsInputSchema = z
  .object({
    collectionEnabled: z.boolean().optional(),
    rawRetentionDays: z.number().int().min(7).max(400).optional(),
    factRetentionMonths: z.number().int().min(1).max(60).optional(),
    timezoneOverride: z.string().min(3).max(64).nullable().optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .strict()

export async function updateUsageSettings(db: Queryable, actor: ManageActor, raw: unknown, now = new Date()) {
  const input = settingsInputSchema.parse(raw)
  if (input.timezoneOverride) {
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: input.timezoneOverride })
    } catch {
      throw new DomainError("Fuso horário inválido.", "USABILITY_TIMEZONE_INVALID", 422)
    }
  }
  const before = await loadUsageSettings(db, actor.organizationId, now)
  await db.query(
    `insert into usage_settings (organization_id, collection_enabled, raw_retention_days, fact_retention_months, timezone_override, updated_by_account_id, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (organization_id) do update set collection_enabled = excluded.collection_enabled, raw_retention_days = excluded.raw_retention_days,
       fact_retention_months = excluded.fact_retention_months, timezone_override = excluded.timezone_override, updated_by_account_id = excluded.updated_by_account_id, updated_at = excluded.updated_at`,
    [
      actor.organizationId,
      input.collectionEnabled ?? before.collectionEnabled,
      input.rawRetentionDays ?? before.rawRetentionDays,
      input.factRetentionMonths ?? before.factRetentionMonths,
      input.timezoneOverride === undefined ? (before.timezoneSource === "OVERRIDE" ? before.timezone : null) : input.timezoneOverride,
      actor.accountId,
      now,
    ],
  )
  if (input.collectionEnabled !== undefined && input.collectionEnabled !== before.collectionEnabled) {
    await db.query(`insert into usage_collection_toggles (organization_id, enabled, reason, changed_by_account_id, changed_at) values ($1, $2, $3, $4, $5)`, [actor.organizationId, input.collectionEnabled, input.reason, actor.accountId, now])
  }
  await audit(db, actor, "USABILITY_SETTINGS_UPDATED", { changes: input })
  invalidateUsageSettings(actor.organizationId)
  return loadUsageSettings(db, actor.organizationId, now)
}

export const classificationInputSchema = z.object({ personId: z.string().uuid(), classification: z.enum(["TEST", "DEMO", "AUTOMATION"]), reason: z.string().trim().min(3).max(300) }).strict()

export async function classifyPerson(db: Queryable, actor: ManageActor, raw: unknown, now = new Date()) {
  const input = classificationInputSchema.parse(raw)
  const placement = (await loadPersonPlacements(db, actor.organizationId, [input.personId])).get(input.personId)
  if (!placement) throw new DomainError("Pessoa não encontrada.", "USABILITY_PERSON_NOT_FOUND", 404)
  await db.query(`update usage_population_classifications set removed_at = $3, removed_by_account_id = $4 where organization_id = $1 and person_id = $2 and removed_at is null`, [actor.organizationId, input.personId, now, actor.accountId])
  await db.query(
    `insert into usage_population_classifications (organization_id, person_id, classification, reason, classified_by_account_id, classified_at) values ($1, $2, $3, $4, $5, $6)`,
    [actor.organizationId, input.personId, input.classification, input.reason, actor.accountId, now],
  )
  await audit(db, actor, "USABILITY_PERSON_CLASSIFIED", { personId: input.personId, classification: input.classification, reason: input.reason }, input.personId)
}

export async function unclassifyPerson(db: Queryable, actor: ManageActor, personId: string, reason: string, now = new Date()) {
  const result = await db.query(`update usage_population_classifications set removed_at = $3, removed_by_account_id = $4 where organization_id = $1 and person_id = $2 and removed_at is null`, [actor.organizationId, personId, now, actor.accountId])
  if (!result.rowCount) throw new DomainError("Pessoa sem classificação vigente.", "USABILITY_CLASSIFICATION_NOT_FOUND", 404)
  await audit(db, actor, "USABILITY_PERSON_UNCLASSIFIED", { personId, reason }, personId)
}

/** Reprocessa as projeções de [from, to] (datas locais): marca pessoa × dia de quem tem evento no intervalo. Idempotente. */
export async function reprocessProjections(db: Queryable, actor: ManageActor, raw: unknown, now = new Date()) {
  const input = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(3).max(300) }).strict().parse(raw)
  if (input.from > input.to || datesBetween(input.from, input.to).length > 400) throw new DomainError("Intervalo inválido (máximo 400 dias).", "USABILITY_REPROCESS_INVALID", 422)
  const settings = await loadUsageSettings(db, actor.organizationId, now)
  const result = await db.query(
    `insert into usage_projection_dirty (organization_id, person_id, local_date, marked_at)
     select distinct organization_id, actor_person_id, (occurred_at at time zone $4)::date, $5::timestamptz from usage_events
     where organization_id = $1 and actor_person_id is not null and source = 'CLIENT' and (occurred_at at time zone $4)::date between $2::date and $3::date
     on conflict (organization_id, person_id, local_date) do update set marked_at = excluded.marked_at, attempts = 0`,
    [actor.organizationId, input.from, input.to, settings.timezone, now],
  )
  await audit(db, actor, "USABILITY_REPROCESS_REQUESTED", { from: input.from, to: input.to, reason: input.reason, personDays: result.rowCount })
  return { personDays: result.rowCount ?? 0, today: localDateOf(now, settings.timezone), oldestDay: addDays(input.from, 0) }
}

async function audit(db: Queryable, actor: ManageActor, action: string, payload: Record<string, unknown>, entityId: string = actor.organizationId) {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'USABILITY', $4, $5)`, [actor.organizationId, actor.personId, action, entityId, JSON.stringify(payload)])
}
