import type { Database } from "../../../infrastructure/database/pool.js"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import type { ReportComparison } from "../domain/comparison.js"
import type { SourceState } from "../domain/delivery-decision.js"
import type { ReportAnalysisConfig, ReportAudience, ReportDefinition, ReportSchedule, ReportVisualization } from "../domain/report-definition.js"
import type { VisualizationData } from "../domain/visualization.js"

/** Armazenamento dos reports recorrentes (porta + PostgreSQL). Ver migration 148. */
export type ReportStatus = "ACTIVE" | "INACTIVE"
export type RunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "NOT_FORWARDED" | "PARTIAL" | "BLOCKED" | "SKIPPED" | "FAILED"
export type AnalysisStatus = "PENDING" | "READY" | "FAILED" | "DISABLED" | "NOT_APPLICABLE"
export type NotForwardedReason = "STALE_SOURCES" | "NO_CHANGE" | "INSUFFICIENT_COVERAGE"

export type ReportConfig = {
  name: string
  description: string | null
  definition: ReportDefinition
  visualization: ReportVisualization
  schedule: ReportSchedule
  audience: ReportAudience
  analysis: ReportAnalysisConfig
}

export type ReportRecord = ReportConfig & {
  id: string
  organizationId: string
  ownerAccountId: string
  ownerPersonId: string
  status: ReportStatus
  origin: "CHAT" | "SCREEN"
  configVersion: number
  timeZone: string
  nextRunAt: string | null
  lastRunAt: string | null
  lastRunStatus: RunStatus | null
  lastValidDeliveryAt: string | null
  sourceProposalId: string | null
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type RunRecord = {
  id: string
  organizationId: string
  reportId: string
  scheduledFor: string
  triggerKind: "SCHEDULE" | "MANUAL"
  configVersion: number
  status: RunStatus
  attempts: number
  outcome: Record<string, unknown> | null
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
}

export type DeliveryRecord = {
  id: string
  organizationId: string
  reportId: string
  runId: string
  configVersion: number
  scopeKey: string
  kind: "DELIVERY" | "NOT_FORWARDED"
  reason: NotForwardedReason | null
  structureLabel: string | null
  periodKey: string | null
  periodLabel: string | null
  sources: SourceState[]
  dataset: QueryTableCard | null
  visualization: VisualizationData | null
  comparison: ReportComparison | null
  fingerprint: string | null
  empty: boolean
  analysisStatus: AnalysisStatus
  analysisText: string | null
  analysisAttempts: number
  analysisError: string | null
  occurrences: number
  lastCheckedAt: string
  createdAt: string
}

export type NewDelivery = Omit<DeliveryRecord, "id" | "analysisText" | "analysisAttempts" | "analysisError" | "occurrences" | "lastCheckedAt" | "createdAt">
export type Recipient = { personId: string; accountId: string | null }

export type ReportStore = {
  createReport(input: ReportConfig & { organizationId: string; ownerAccountId: string; ownerPersonId: string; status: ReportStatus; origin: "CHAT" | "SCREEN"; timeZone: string; nextRunAt: string | null; sourceProposalId: string | null }, createdByAccountId: string): Promise<ReportRecord>
  /** Atualiza a configuração; `bumpVersion` grava nova versão. Compare-and-swap pela revisão (null = conflito). */
  updateReport(id: string, organizationId: string, revision: number, patch: Partial<ReportConfig> & { status?: ReportStatus; nextRunAt?: string | null; bumpVersion: boolean }, actorAccountId: string): Promise<ReportRecord | null>
  getReport(id: string, organizationId: string): Promise<ReportRecord | null>
  listReports(organizationId: string, ownerAccountId: string): Promise<ReportRecord[]>
  softDeleteReport(id: string, organizationId: string, actorAccountId: string): Promise<boolean>
  /** Execução de um horário: cria uma vez (chave única report × horário). Devolve null se já existia. */
  enqueueRun(input: { organizationId: string; reportId: string; scheduledFor: string; triggerKind: "SCHEDULE" | "MANUAL"; configVersion: number }): Promise<RunRecord | null>
  finishRun(runId: string, status: RunStatus, outcome: Record<string, unknown>, error: { code: string; message: string } | null): Promise<void>
  requeueRun(runId: string, nextAttemptAt: string, error: { code: string; message: string }): Promise<void>
  markReportRun(reportId: string, status: RunStatus, at: string, validDeliveryAt: string | null): Promise<void>
  listRuns(reportId: string, limit: number): Promise<RunRecord[]>
  lastValidDelivery(reportId: string, scopeKey: string): Promise<DeliveryRecord | null>
  latestRecord(reportId: string, scopeKey: string): Promise<DeliveryRecord | null>
  /** Grava a entrega/aviso uma única vez por execução × escopo (reprocessar devolve o já gravado). */
  insertDelivery(input: NewDelivery): Promise<{ delivery: DeliveryRecord; created: boolean }>
  bumpNotice(deliveryId: string, at: string): Promise<void>
  /** Destinatários de um item: uma linha por pessoa por execução (nunca duplica entre seleções de público). */
  addRecipients(deliveryId: string, runId: string, organizationId: string, reportId: string, recipients: Recipient[]): Promise<number>
  setAnalysis(deliveryId: string, status: AnalysisStatus, text: string | null, error: string | null): Promise<void>
  getDelivery(id: string, organizationId: string): Promise<DeliveryRecord | null>
  isRecipient(deliveryId: string, personId: string): Promise<boolean>
}

const iso = (value: Date | string | null): string | null => (value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString())

type ReportRow = {
  id: string; organization_id: string; owner_account_id: string; owner_person_id: string; name: string; description: string | null; status: ReportStatus; origin: "CHAT" | "SCREEN"; config_version: number
  definition: ReportDefinition; visualization: ReportVisualization; schedule: ReportSchedule; audience: ReportAudience; analysis: ReportAnalysisConfig; time_zone: string
  next_run_at: Date | null; last_run_at: Date | null; last_run_status: RunStatus | null; last_valid_delivery_at: Date | null; source_proposal_id: string | null; revision: number; created_at: Date; updated_at: Date; deleted_at: Date | null
}

function toReport(row: ReportRow): ReportRecord {
  return {
    id: row.id, organizationId: row.organization_id, ownerAccountId: row.owner_account_id, ownerPersonId: row.owner_person_id, name: row.name, description: row.description, status: row.status, origin: row.origin, configVersion: row.config_version,
    definition: row.definition, visualization: row.visualization, schedule: row.schedule, audience: row.audience, analysis: row.analysis, timeZone: row.time_zone,
    nextRunAt: iso(row.next_run_at), lastRunAt: iso(row.last_run_at), lastRunStatus: row.last_run_status, lastValidDeliveryAt: iso(row.last_valid_delivery_at), sourceProposalId: row.source_proposal_id, revision: row.revision, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!, deletedAt: iso(row.deleted_at),
  }
}

type RunRow = { id: string; organization_id: string; report_id: string; scheduled_for: Date; trigger_kind: "SCHEDULE" | "MANUAL"; config_version: number; status: RunStatus; attempts: number; outcome: Record<string, unknown> | null; error_code: string | null; error_message: string | null; started_at: Date | null; finished_at: Date | null }
const toRun = (row: RunRow): RunRecord => ({ id: row.id, organizationId: row.organization_id, reportId: row.report_id, scheduledFor: iso(row.scheduled_for)!, triggerKind: row.trigger_kind, configVersion: row.config_version, status: row.status, attempts: row.attempts, outcome: row.outcome, errorCode: row.error_code, errorMessage: row.error_message, startedAt: iso(row.started_at), finishedAt: iso(row.finished_at) })

type DeliveryRow = {
  id: string; organization_id: string; report_id: string; run_id: string; config_version: number; scope_key: string; kind: "DELIVERY" | "NOT_FORWARDED"; reason: NotForwardedReason | null; structure_label: string | null; period_key: string | null; period_label: string | null
  sources: SourceState[]; dataset: QueryTableCard | null; visualization: VisualizationData | null; comparison: ReportComparison | null; fingerprint: string | null; empty: boolean; analysis_status: AnalysisStatus; analysis_text: string | null; analysis_attempts: number; analysis_error: string | null; occurrences: number; last_checked_at: Date; created_at: Date
}
export const toDelivery = (row: DeliveryRow): DeliveryRecord => ({
  id: row.id, organizationId: row.organization_id, reportId: row.report_id, runId: row.run_id, configVersion: row.config_version, scopeKey: row.scope_key, kind: row.kind, reason: row.reason, structureLabel: row.structure_label, periodKey: row.period_key, periodLabel: row.period_label,
  sources: row.sources ?? [], dataset: row.dataset, visualization: row.visualization, comparison: row.comparison, fingerprint: row.fingerprint, empty: row.empty, analysisStatus: row.analysis_status, analysisText: row.analysis_text, analysisAttempts: row.analysis_attempts, analysisError: row.analysis_error, occurrences: row.occurrences, lastCheckedAt: iso(row.last_checked_at)!, createdAt: iso(row.created_at)!,
})

const REPORT_COLUMNS = "id, organization_id, owner_account_id, owner_person_id, name, description, status, origin, config_version, definition, visualization, schedule, audience, analysis, time_zone, next_run_at, last_run_at, last_run_status, last_valid_delivery_at, source_proposal_id, revision, created_at, updated_at, deleted_at"
const RUN_COLUMNS = "id, organization_id, report_id, scheduled_for, trigger_kind, config_version, status, attempts, outcome, error_code, error_message, started_at, finished_at"
export const DELIVERY_COLUMNS = "id, organization_id, report_id, run_id, config_version, scope_key, kind, reason, structure_label, period_key, period_label, sources, dataset, visualization, comparison, fingerprint, empty, analysis_status, analysis_text, analysis_attempts, analysis_error, occurrences, last_checked_at, created_at"

export function createPostgresReportStore(db: Database): ReportStore {
  const insertVersion = async (report: ReportRecord, actorAccountId: string) => {
    await db.query(
      `insert into report_versions (report_id, version, organization_id, name, definition, visualization, schedule, audience, analysis, created_by_account_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (report_id, version) do nothing`,
      [report.id, report.configVersion, report.organizationId, report.name, JSON.stringify(report.definition), JSON.stringify(report.visualization), JSON.stringify(report.schedule), JSON.stringify(report.audience), JSON.stringify(report.analysis), actorAccountId],
    )
  }
  return {
    async createReport(input, createdByAccountId) {
      const result = await db.query<ReportRow>(
        `insert into reports (organization_id, owner_account_id, owner_person_id, name, description, status, origin, audience_mode, definition, visualization, schedule, audience, analysis, time_zone, next_run_at, source_proposal_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning ${REPORT_COLUMNS}`,
        [input.organizationId, input.ownerAccountId, input.ownerPersonId, input.name.trim(), input.description, input.status, input.origin, input.audience.mode, JSON.stringify(input.definition), JSON.stringify(input.visualization), JSON.stringify(input.schedule), JSON.stringify(input.audience), JSON.stringify(input.analysis), input.timeZone, input.nextRunAt, input.sourceProposalId],
      )
      const report = toReport(result.rows[0]!)
      await insertVersion(report, createdByAccountId)
      return report
    },
    async updateReport(id, organizationId, revision, patch, actorAccountId) {
      const sets: string[] = []
      const values: unknown[] = [id, organizationId, revision]
      const set = (column: string, value: unknown) => {
        values.push(value)
        sets.push(`${column} = $${values.length}`)
      }
      if (patch.name !== undefined) set("name", patch.name.trim())
      if (patch.description !== undefined) set("description", patch.description)
      if (patch.definition !== undefined) set("definition", JSON.stringify(patch.definition))
      if (patch.visualization !== undefined) set("visualization", JSON.stringify(patch.visualization))
      if (patch.schedule !== undefined) set("schedule", JSON.stringify(patch.schedule))
      if (patch.audience !== undefined) {
        set("audience", JSON.stringify(patch.audience))
        set("audience_mode", patch.audience.mode)
      }
      if (patch.analysis !== undefined) set("analysis", JSON.stringify(patch.analysis))
      if (patch.status !== undefined) set("status", patch.status)
      if (patch.nextRunAt !== undefined) set("next_run_at", patch.nextRunAt)
      if (patch.bumpVersion) sets.push("config_version = config_version + 1")
      const result = await db.query<ReportRow>(
        `update reports set ${[...sets, "revision = revision + 1", "updated_at = now()"].join(", ")}
          where id = $1 and organization_id = $2 and revision = $3 and deleted_at is null returning ${REPORT_COLUMNS}`,
        values,
      )
      const row = result.rows[0]
      if (!row) return null
      const report = toReport(row)
      if (patch.bumpVersion) await insertVersion(report, actorAccountId)
      // Desativar cancela o que ainda estava na fila (nada novo roda depois de desativado).
      if (report.status === "INACTIVE") await db.query(`update report_runs set status = 'SKIPPED', finished_at = now(), outcome = '{"reason":"REPORT_INACTIVE"}'::jsonb where report_id = $1 and status = 'QUEUED'`, [id])
      return report
    },
    async getReport(id, organizationId) {
      const result = await db.query<ReportRow>(`select ${REPORT_COLUMNS} from reports where id = $1 and organization_id = $2`, [id, organizationId])
      return result.rows[0] ? toReport(result.rows[0]) : null
    },
    async listReports(organizationId, ownerAccountId) {
      const result = await db.query<ReportRow>(`select ${REPORT_COLUMNS} from reports where organization_id = $1 and owner_account_id = $2 and deleted_at is null order by updated_at desc limit 500`, [organizationId, ownerAccountId])
      return result.rows.map(toReport)
    },
    async softDeleteReport(id, organizationId, actorAccountId) {
      const result = await db.query(`update reports set deleted_at = now(), deleted_by_account_id = $3, status = 'INACTIVE', next_run_at = null, revision = revision + 1, updated_at = now() where id = $1 and organization_id = $2 and deleted_at is null`, [id, organizationId, actorAccountId])
      if ((result.rowCount ?? 0) === 0) return false
      await db.query(`update report_runs set status = 'SKIPPED', finished_at = now(), outcome = '{"reason":"REPORT_DELETED"}'::jsonb where report_id = $1 and status = 'QUEUED'`, [id])
      return true
    },
    async enqueueRun(input) {
      const result = await db.query<RunRow>(
        `insert into report_runs (organization_id, report_id, scheduled_for, trigger_kind, config_version, status)
         values ($1, $2, $3, $4, $5, 'QUEUED') on conflict (report_id, scheduled_for) do nothing returning ${RUN_COLUMNS}`,
        [input.organizationId, input.reportId, input.scheduledFor, input.triggerKind, input.configVersion],
      )
      return result.rows[0] ? toRun(result.rows[0]) : null
    },
    async finishRun(runId, status, outcome, error) {
      await db.query(`update report_runs set status = $2, outcome = $3, error_code = $4, error_message = $5, finished_at = now(), claimed_until = null where id = $1`, [runId, status, JSON.stringify(outcome), error?.code ?? null, error?.message ?? null])
    },
    async requeueRun(runId, nextAttemptAt, error) {
      await db.query(`update report_runs set status = 'QUEUED', next_attempt_at = $2, error_code = $3, error_message = $4, claimed_until = null where id = $1`, [runId, nextAttemptAt, error.code, error.message])
    },
    async markReportRun(reportId, status, at, validDeliveryAt) {
      await db.query(`update reports set last_run_at = $2, last_run_status = $3, last_valid_delivery_at = coalesce($4, last_valid_delivery_at) where id = $1`, [reportId, at, status, validDeliveryAt])
    },
    async listRuns(reportId, limit) {
      const result = await db.query<RunRow>(`select ${RUN_COLUMNS} from report_runs where report_id = $1 order by scheduled_for desc limit $2`, [reportId, limit])
      return result.rows.map(toRun)
    },
    async lastValidDelivery(reportId, scopeKey) {
      const result = await db.query<DeliveryRow>(`select ${DELIVERY_COLUMNS} from report_deliveries where report_id = $1 and scope_key = $2 and kind = 'DELIVERY' order by created_at desc limit 1`, [reportId, scopeKey])
      return result.rows[0] ? toDelivery(result.rows[0]) : null
    },
    async latestRecord(reportId, scopeKey) {
      const result = await db.query<DeliveryRow>(`select ${DELIVERY_COLUMNS} from report_deliveries where report_id = $1 and scope_key = $2 order by created_at desc limit 1`, [reportId, scopeKey])
      return result.rows[0] ? toDelivery(result.rows[0]) : null
    },
    async insertDelivery(input) {
      const inserted = await db.query<DeliveryRow>(
        `insert into report_deliveries (organization_id, report_id, run_id, config_version, scope_key, kind, reason, structure_label, period_key, period_label, sources, dataset, visualization, comparison, fingerprint, empty, analysis_status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         on conflict (run_id, scope_key) do nothing returning ${DELIVERY_COLUMNS}`,
        [input.organizationId, input.reportId, input.runId, input.configVersion, input.scopeKey, input.kind, input.reason, input.structureLabel, input.periodKey, input.periodLabel, JSON.stringify(input.sources), input.dataset ? JSON.stringify(input.dataset) : null, input.visualization ? JSON.stringify(input.visualization) : null, input.comparison ? JSON.stringify(input.comparison) : null, input.fingerprint, input.empty, input.analysisStatus],
      )
      if (inserted.rows[0]) return { delivery: toDelivery(inserted.rows[0]), created: true }
      const existing = await db.query<DeliveryRow>(`select ${DELIVERY_COLUMNS} from report_deliveries where run_id = $1 and scope_key = $2`, [input.runId, input.scopeKey])
      return { delivery: toDelivery(existing.rows[0]!), created: false }
    },
    async bumpNotice(deliveryId, at) {
      await db.query(`update report_deliveries set occurrences = occurrences + 1, last_checked_at = $2 where id = $1`, [deliveryId, at])
    },
    async addRecipients(deliveryId, runId, organizationId, reportId, recipients) {
      if (recipients.length === 0) return 0
      const result = await db.query(
        `insert into report_delivery_recipients (delivery_id, run_id, organization_id, report_id, recipient_person_id, recipient_account_id)
         select $1, $2, $3, $4, person_id, account_id from unnest($5::uuid[], $6::uuid[]) as r(person_id, account_id)
         on conflict do nothing`,
        [deliveryId, runId, organizationId, reportId, recipients.map((recipient) => recipient.personId), recipients.map((recipient) => recipient.accountId)],
      )
      return result.rowCount ?? 0
    },
    async setAnalysis(deliveryId, status, text, error) {
      await db.query(`update report_deliveries set analysis_status = $2, analysis_text = coalesce($3, analysis_text), analysis_error = $4, analysis_attempts = analysis_attempts + case when $2 in ('READY', 'FAILED') then 1 else 0 end, analysis_updated_at = now() where id = $1`, [deliveryId, status, text, error])
    },
    async getDelivery(id, organizationId) {
      const result = await db.query<DeliveryRow>(`select ${DELIVERY_COLUMNS} from report_deliveries where id = $1 and organization_id = $2`, [id, organizationId])
      return result.rows[0] ? toDelivery(result.rows[0]) : null
    },
    async isRecipient(deliveryId, personId) {
      const result = await db.query(`select 1 from report_delivery_recipients where delivery_id = $1 and recipient_person_id = $2`, [deliveryId, personId])
      return (result.rowCount ?? 0) > 0
    },
  }
}
