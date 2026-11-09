import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { ConnectionHealth, FeedStatus, LoadMode, SourceStatus, Cadence } from "../domain/freshness.js"
import type { AvailabilityPolicy } from "../domain/data-availability.js"
import type { FeedMapping } from "../domain/mapping.js"
import type { RunStage, RunStatus, RunTriggerKind } from "../domain/run-status.js"
import type { SchemaFingerprint } from "../domain/schema-fingerprint.js"
import type { FeedConnectorConfig, SourceConfig, SourceKind } from "../domain/source-config.js"

/** Linhas persistidas (camelCase) — sempre lidas com filtro de organização. */
export type DataSourceRow = {
  id: string
  organizationId: string
  publicId: string
  name: string
  description: string | null
  kind: SourceKind
  status: SourceStatus
  config: SourceConfig
  connectionHealth: ConnectionHealth
  connectionCheckedAt: string | null
  connectionError: string | null
  createdAt: string
  updatedAt: string
}

export type DataFeedRow = {
  id: string
  organizationId: string
  sourceId: string
  feedKey: string
  name: string
  contractKey: string
  contractVersion: number
  connectorConfig: FeedConnectorConfig
  mapping: FeedMapping
  loadMode: LoadMode
  cadence: Cadence
  expectedIntervalMinutes: number | null
  status: FeedStatus
  authoritative: boolean
  failOnAnyRejection: boolean
  sourceNamespace: string | null
  availabilityPolicy: AvailabilityPolicy | null
  schemaFingerprint: SchemaFingerprint | null
  schemaChangedAt: string | null
  checkpoint: Record<string, unknown> | null
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastDataAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  nextSyncAt: string | null
  createdAt: string
  updatedAt: string
}

export type DataRunRow = {
  id: string
  organizationId: string
  sourceId: string
  feedId: string
  contractKey: string
  contractVersion: number
  triggerKind: RunTriggerKind
  status: RunStatus
  stages: RunStage[]
  rawObjectId: string | null
  idempotencyKey: string | null
  reprocessOfRunId: string | null
  requestedBy: string | null
  attempts: number
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  bytes: number | null
  recordsReceived: number
  recordsParsed: number
  recordsValid: number
  recordsRejected: number
  recordsInserted: number
  recordsUpdated: number
  recordsUnchanged: number
  recordsDeactivated: number
  errorCount: number
  /** Avisos não bloqueantes (registro aplicado com ressalva) — separado de erros e de rejeitados. Histórico anterior à 064 = 0. */
  warningCount: number
  errorCode: string | null
  errorMessage: string | null
  businessMaxEventTime: string | null
  checkpointBefore: Record<string, unknown> | null
  checkpointAfter: Record<string, unknown> | null
  createdAt: string
}

export const SELECT_SOURCE = `
  select s.id, s.organization_id "organizationId", s.public_id "publicId", s.name, s.description, s.kind, s.status, s.config,
         s.connection_health "connectionHealth", s.connection_checked_at "connectionCheckedAt", s.connection_error "connectionError",
         s.created_at "createdAt", s.updated_at "updatedAt"
  from data_sources s`

export const SELECT_FEED = `
  select f.id, f.organization_id "organizationId", f.source_id "sourceId", f.feed_key "feedKey", f.name, f.contract_key "contractKey",
         f.contract_version "contractVersion", f.connector_config "connectorConfig", f.mapping, f.load_mode "loadMode", f.cadence,
         f.expected_interval_minutes "expectedIntervalMinutes", f.status, f.authoritative, f.fail_on_any_rejection "failOnAnyRejection",
         f.source_namespace "sourceNamespace", f.availability_policy "availabilityPolicy", f.schema_fingerprint "schemaFingerprint", f.schema_changed_at "schemaChangedAt", f.checkpoint,
         f.last_run_at "lastRunAt", f.last_success_at "lastSuccessAt", f.last_data_at "lastDataAt", f.last_error_code "lastErrorCode",
         f.last_error_message "lastErrorMessage", f.next_sync_at "nextSyncAt", f.created_at "createdAt", f.updated_at "updatedAt"
  from data_feeds f`

export const SELECT_RUN = `
  select r.id, r.organization_id "organizationId", r.source_id "sourceId", r.feed_id "feedId", r.contract_key "contractKey", r.contract_version "contractVersion",
         r.trigger_kind "triggerKind", r.status, r.stages, r.raw_object_id "rawObjectId", r.idempotency_key "idempotencyKey", r.reprocess_of_run_id "reprocessOfRunId",
         r.requested_by "requestedBy", r.attempts, r.queued_at "queuedAt", r.started_at "startedAt", r.finished_at "finishedAt", r.duration_ms "durationMs", r.bytes,
         r.records_received "recordsReceived", r.records_parsed "recordsParsed", r.records_valid "recordsValid", r.records_rejected "recordsRejected",
         r.records_inserted "recordsInserted", r.records_updated "recordsUpdated", r.records_unchanged "recordsUnchanged", r.records_deactivated "recordsDeactivated",
         r.error_count "errorCount", r.warning_count "warningCount", r.error_code "errorCode", r.error_message "errorMessage", r.business_max_event_time "businessMaxEventTime",
         r.checkpoint_before "checkpointBefore", r.checkpoint_after "checkpointAfter", r.created_at "createdAt"
  from data_ingestion_runs r`

type Queryable = Pick<Database, "query">

export function toIsoRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) out[key] = value instanceof Date ? value.toISOString() : value
  return out as T
}

export async function findSource(db: Queryable, organizationId: string, sourceId: string): Promise<DataSourceRow | null> {
  const result = await db.query<DataSourceRow>(`${SELECT_SOURCE} where s.organization_id = $1 and s.id = $2 and s.deleted_at is null`, [organizationId, sourceId])
  return result.rows[0] ? toIsoRow(result.rows[0]) : null
}

export async function requireSource(db: Queryable, organizationId: string, sourceId: string): Promise<DataSourceRow> {
  const source = await findSource(db, organizationId, sourceId)
  if (!source) throw new DomainError("Fonte não encontrada.", "DATA_SOURCE_NOT_FOUND", 404)
  return source
}

/** Dentro de uma transação: trava a linha da fonte até o commit e devolve o que está gravado agora. */
export async function lockSource(db: Queryable, organizationId: string, sourceId: string): Promise<DataSourceRow> {
  const result = await db.query<DataSourceRow>(`${SELECT_SOURCE} where s.organization_id = $1 and s.id = $2 and s.deleted_at is null for update`, [organizationId, sourceId])
  if (!result.rows[0]) throw new DomainError("Fonte não encontrada.", "DATA_SOURCE_NOT_FOUND", 404)
  return toIsoRow(result.rows[0])
}

export async function findFeed(db: Queryable, organizationId: string, feedId: string): Promise<DataFeedRow | null> {
  const result = await db.query<DataFeedRow>(`${SELECT_FEED} where f.organization_id = $1 and f.id = $2 and f.deleted_at is null`, [organizationId, feedId])
  return result.rows[0] ? toIsoRow(result.rows[0]) : null
}

export async function requireFeed(db: Queryable, organizationId: string, feedId: string): Promise<DataFeedRow> {
  const feed = await findFeed(db, organizationId, feedId)
  if (!feed) throw new DomainError("Feed não encontrado.", "DATA_FEED_NOT_FOUND", 404)
  return feed
}

export async function listFeedsOfSource(db: Queryable, organizationId: string, sourceId: string): Promise<DataFeedRow[]> {
  const result = await db.query<DataFeedRow>(`${SELECT_FEED} where f.organization_id = $1 and f.source_id = $2 and f.deleted_at is null order by f.created_at`, [organizationId, sourceId])
  return result.rows.map(toIsoRow)
}

export async function findRun(db: Queryable, organizationId: string, runId: string): Promise<DataRunRow | null> {
  const result = await db.query<DataRunRow>(`${SELECT_RUN} where r.organization_id = $1 and r.id = $2`, [organizationId, runId])
  return result.rows[0] ? toIsoRow(result.rows[0]) : null
}

export async function requireRun(db: Queryable, organizationId: string, runId: string): Promise<DataRunRow> {
  const run = await findRun(db, organizationId, runId)
  if (!run) throw new DomainError("Carga não encontrada.", "DATA_RUN_NOT_FOUND", 404)
  return run
}

/** Audit trail das ações administrativas da Central — reaproveita `audit_logs`. Nunca inclui segredo. */
export async function recordAudit(db: Queryable, input: { organizationId: string; actorId: string | null; action: string; entityType: string; entityId: string; payload?: Record<string, unknown> }): Promise<void> {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, $4, $5, $6)`, [
    input.organizationId,
    input.actorId,
    input.action,
    input.entityType,
    input.entityId,
    JSON.stringify(input.payload ?? {}),
  ])
}
