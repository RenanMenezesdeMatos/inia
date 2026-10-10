import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"

/**
 * Configuração da monitoria por organização (coleta ligada, retenção, fuso). Lida com cache curto (30 s) porque a ingestão
 * consulta a cada lote; uma mudança feita pelo painel invalida o cache na hora (`invalidateUsageSettings`).
 */
type Queryable = Pick<Database, "query">

export type UsageSettings = {
  organizationId: string
  collectionEnabled: boolean
  rawRetentionDays: number
  factRetentionMonths: number
  timezone: string
  timezoneSource: "OVERRIDE" | "OPERATION"
}

const CACHE_MS = 30_000
const cache = new Map<string, { at: number; value: UsageSettings }>()

export function invalidateUsageSettings(organizationId?: string) {
  if (organizationId) cache.delete(organizationId)
  else cache.clear()
}

export async function loadUsageSettings(db: Queryable, organizationId: string, now = new Date()): Promise<UsageSettings> {
  const hit = cache.get(organizationId)
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.value
  const [row, operationTimezone] = await Promise.all([
    db.query<{ collection_enabled: boolean; raw_retention_days: number; fact_retention_months: number; timezone_override: string | null }>(
      `select collection_enabled, raw_retention_days, fact_retention_months, timezone_override from usage_settings where organization_id = $1`,
      [organizationId],
    ),
    resolveOrganizationTimezone(db as Database, organizationId),
  ])
  const settings = row.rows[0]
  const value: UsageSettings = {
    organizationId,
    collectionEnabled: settings?.collection_enabled ?? true,
    rawRetentionDays: settings?.raw_retention_days ?? 90,
    factRetentionMonths: settings?.fact_retention_months ?? 13,
    timezone: settings?.timezone_override ?? operationTimezone,
    timezoneSource: settings?.timezone_override ? "OVERRIDE" : "OPERATION",
  }
  cache.set(organizationId, { at: now.getTime(), value })
  return value
}

/** Ambiente que carimba os eventos (cada base atende um ambiente). */
export function currentEnvironment(): string {
  return process.env.INIA_ENVIRONMENT?.trim() || process.env.NODE_ENV || "development"
}
