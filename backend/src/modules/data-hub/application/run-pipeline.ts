import type pg from "pg"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { requireDataContract } from "../domain/contract-registry.js"
import type { DataContract } from "../domain/data-contract.js"
import { DataRunError, type RecordError } from "../domain/error-codes.js"
import { computeFreshness, expectedIntervalMinutes, nextSyncAt } from "../domain/freshness.js"
import { feedMappingSchema, mapRecord, validateMapping, type SourceRecord } from "../domain/mapping.js"
import { REMOTE_SOURCE_KINDS } from "../domain/source-config.js"
import { emptyMetrics, MAX_RUN_ATTEMPTS, RETRY_BACKOFF_MS, type RunMetrics, type RunStage, type RunStatus } from "../domain/run-status.js"
import { columnsFromRecords, fingerprintColumns, missingMappedSources } from "../domain/schema-fingerprint.js"
import { extractRecords, fetchApiRecords } from "./connectors/api-pull-connector.js"
import { parseFileBatch, type FetchedBatch } from "./connectors/file-connector.js"
import { fetchNextSftpFile } from "./connectors/sftp-connector.js"
import { databaseConfigOfFeed, fetchDatabaseWholeBatch, runDatabasePages, usesWholeBatch } from "./database-run.js"
import type { DataHubContext } from "./data-hub-context.js"
import { findFeed, findSource, SELECT_RUN, toIsoRow, type DataFeedRow, type DataRunRow, type DataSourceRow } from "./records.js"
import { emptyApply, mergeApply, type ApplyResult, type Rejection, type ValidRecord, type WriteContext } from "./writers/domain-writer.js"
import { requireWriter } from "./writers/writer-registry.js"
import { useBatchStatementTimeout } from "../../../infrastructure/database/pool.js"

/**
 * Pipeline de um Run: CONNECTING → FETCHING → PARSING → MAPPING → VALIDATING → APPLYING →
 * COMPLETED | PARTIAL | FAILED. Cada transição é persistida (a UI polla o status).
 *
 * Atomicidade: contrato PARTIAL_ALLOWED aplica em lotes de APPLY_BATCH registros, cada lote na
 * própria transação (uma falha de banco no lote N deixa N-1 lotes aplicados — o Run fica FAILED
 * com as contagens reais e o reprocessamento é idempotente). Contrato ATOMIC (ou feed com
 * "falhar com qualquer rejeição") só aplica se não houver nenhuma rejeição, numa transação única.
 *
 * Checkpoint (API Pull) só avança depois de aplicação bem-sucedida; arquivo SFTP só é marcado
 * como processado depois de um Run COMPLETED/PARTIAL.
 */
export const APPLY_BATCH = 1000
/** Conteúdo bruto de banco externo retido para reprocessamento só até este tamanho por carga. */
export const RAW_RETENTION_LIMIT_BYTES = 32 * 1024 * 1024
const MAX_PERSISTED_REJECTIONS = 10_000

type Queryable = Pick<DataHubContext["db"], "query">

export async function transition(db: Queryable, runId: string, status: RunStatus, stages: RunStage[], detail: string | null = null): Promise<RunStage[]> {
  const now = new Date().toISOString()
  const last = stages[stages.length - 1]
  if (last && !last.finishedAt) last.finishedAt = now
  const next = [...stages, { stage: status, startedAt: now, finishedAt: null, detail }]
  await db.query(`update data_ingestion_runs set status = $2, stages = $3 where id = $1`, [runId, status, JSON.stringify(next)])
  return next
}

export function closeStages(stages: RunStage[], detail?: string): RunStage[] {
  const now = new Date().toISOString()
  const last = stages[stages.length - 1]
  if (last && !last.finishedAt) {
    last.finishedAt = now
    if (detail) last.detail = last.detail ? `${last.detail} · ${detail}` : detail
  }
  return stages
}

export type LoadedRun = { run: DataRunRow; feed: DataFeedRow; source: DataSourceRow; contract: DataContract }

async function loadRun(ctx: DataHubContext, runId: string): Promise<LoadedRun | null> {
  const result = await ctx.db.query<DataRunRow>(`${SELECT_RUN} where r.id = $1`, [runId])
  const run = result.rows[0] ? toIsoRow(result.rows[0]) : null
  if (!run) return null
  const [feed, source] = await Promise.all([findFeed(ctx.db, run.organizationId, run.feedId), findSource(ctx.db, run.organizationId, run.sourceId)])
  if (!feed || !source) return null
  return { run, feed, source, contract: requireDataContract(run.contractKey, run.contractVersion) }
}

export async function persistRejections(db: Queryable, run: DataRunRow, rejections: Rejection[]): Promise<void> {
  const limited = rejections.slice(0, MAX_PERSISTED_REJECTIONS)
  for (let index = 0; index < limited.length; index += APPLY_BATCH) {
    const chunk = limited.slice(index, index + APPLY_BATCH)
    await db.query(
      `insert into data_ingestion_rejections (organization_id, run_id, record_number, source_record_key, error_code, field, message)
       select $1, $2, record_number, source_record_key, error_code, field, message
       from unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::text[]) as t(record_number, source_record_key, error_code, field, message)`,
      [run.organizationId, run.id, chunk.map((r) => r.recordNumber), chunk.map((r) => r.sourceRecordKey), chunk.map((r) => r.error.code), chunk.map((r) => r.error.field), chunk.map((r) => r.error.message.slice(0, 500))],
    )
  }
}

export async function persistLineage(client: pg.PoolClient, run: DataRunRow, entries: ApplyResult["lineage"]): Promise<void> {
  for (let index = 0; index < entries.length; index += APPLY_BATCH) {
    const chunk = entries.slice(index, index + APPLY_BATCH)
    await client.query(
      `insert into data_lineage (organization_id, run_id, feed_id, source_id, contract_key, entity_type, entity_id, source_record_key, record_number, action)
       select $1, $2, $3, $4, $5, entity_type, entity_id, source_record_key, record_number, action
       from unnest($6::text[], $7::uuid[], $8::text[], $9::int[], $10::text[]) as t(entity_type, entity_id, source_record_key, record_number, action)`,
      [run.organizationId, run.id, run.feedId, run.sourceId, run.contractKey, chunk.map((e) => e.entityType), chunk.map((e) => e.entityId), chunk.map((e) => e.sourceRecordKey), chunk.map((e) => e.recordNumber), chunk.map((e) => e.action)],
    )
  }
}

/** Origem dos registros de um Run: objeto bruto (upload/push/reprocess), API Pull ou SFTP. */
async function fetchBatch(ctx: DataHubContext, loaded: LoadedRun, stages: RunStage[]): Promise<{ batch: FetchedBatch; stages: RunStage[]; rawObjectId: string | null; sftpFile: { path: string; checksum: string; size: number; modifiedAt: string | null } | null }> {
  const { run, feed, source } = loaded
  const connector = feed.connectorConfig

  if (run.rawObjectId) {
    stages = await transition(ctx.db, run.id, "FETCHING", stages, "Lendo conteúdo bruto retido")
    const raw = await ctx.rawObjects.get(run.rawObjectId)
    if (!raw) throw new DataRunError("DATA_RAW_EXPIRED")
    stages = await transition(ctx.db, run.id, "PARSING", stages, raw.meta.filename ?? raw.meta.contentType)
    if (connector.connector === "API_PUSH" || raw.meta.contentType === "application/json") {
      const text = new TextDecoder("utf-8").decode(raw.content)
      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch {
        throw new DataRunError("DATA_FILE_INVALID", "O payload retido não é JSON válido.")
      }
      const path = connector.connector === "API_PUSH" ? connector.push.extractPath : ""
      const records = extractRecords(payload, path)
      return { batch: { columns: columnsFromRecords(records), records, bytes: raw.meta.byteSize, totalRecords: records.length, detail: `${records.length} registro(s) no payload` }, stages, rawObjectId: run.rawObjectId, sftpFile: null }
    }
    const fileConfig = connector.connector === "FILE_UPLOAD" ? connector.file : connector.connector === "SFTP" ? connector.sftp : null
    if (!fileConfig) throw new DataRunError("DATA_INTERNAL_ERROR", "Conector do feed não aceita arquivo.")
    const batch = await parseFileBatch(fileConfig, raw.content)
    return { batch, stages, rawObjectId: run.rawObjectId, sftpFile: null }
  }

  if (connector.connector === "API_PULL") {
    stages = await transition(ctx.db, run.id, "FETCHING", stages, "Consultando a API")
    const batch = await fetchApiRecords(ctx, source, feed, { checkpoint: feed.checkpoint })
    // Retém o payload consolidado para reprocessamento (mesma retenção dos arquivos).
    const raw = await ctx.rawObjects.put({ organizationId: run.organizationId, sourceId: source.id, feedId: feed.id, filename: null, contentType: "application/json", content: new TextEncoder().encode(JSON.stringify(batch.records)) })
    await ctx.db.query(`update data_ingestion_runs set raw_object_id = $2 where id = $1`, [run.id, raw.id])
    stages = await transition(ctx.db, run.id, "PARSING", stages, batch.detail)
    return { batch, stages, rawObjectId: raw.id, sftpFile: null }
  }

  if (connector.connector === "SFTP") {
    stages = await transition(ctx.db, run.id, "FETCHING", stages, "Procurando arquivo novo no SFTP")
    const file = await fetchNextSftpFile(ctx, source, feed)
    if (!file) return { batch: { columns: [], records: [], bytes: 0, totalRecords: 0, detail: "Nenhum arquivo novo" }, stages, rawObjectId: null, sftpFile: null }
    const raw = await ctx.rawObjects.put({ organizationId: run.organizationId, sourceId: source.id, feedId: feed.id, filename: file.entry.name, contentType: /\.xlsx$/i.test(file.entry.name) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv", content: file.content })
    await ctx.db.query(`update data_ingestion_runs set raw_object_id = $2 where id = $1`, [run.id, raw.id])
    stages = await transition(ctx.db, run.id, "PARSING", stages, file.entry.name)
    const batch = await parseFileBatch(connector.sftp, file.content)
    return { batch, stages, rawObjectId: raw.id, sftpFile: { path: file.entry.path, checksum: file.checksum, size: file.entry.size, modifiedAt: file.entry.modifiedAt } }
  }

  if (connector.connector === "DATABASE") {
    stages = await transition(ctx.db, run.id, "FETCHING", stages, "Consultando o banco de dados externo (carga única)")
    const batch = await fetchDatabaseWholeBatch(ctx, loaded)
    let rawObjectId: string | null = null
    if (batch.bytes <= RAW_RETENTION_LIMIT_BYTES) {
      const raw = await ctx.rawObjects.put({ organizationId: run.organizationId, sourceId: source.id, feedId: feed.id, filename: null, contentType: "application/json", content: new TextEncoder().encode(JSON.stringify(batch.records)) })
      await ctx.db.query(`update data_ingestion_runs set raw_object_id = $2 where id = $1`, [run.id, raw.id])
      rawObjectId = raw.id
    }
    stages = await transition(ctx.db, run.id, "PARSING", stages, batch.detail)
    return { batch, stages, rawObjectId, sftpFile: null }
  }

  throw new DataRunError("DATA_INTERNAL_ERROR", "Run sem conteúdo bruto e sem conector remoto.")
}

export type MappingOutcome = { valid: ValidRecord[]; rejections: Rejection[]; rejectedRecords: number }

/** Mapeia + valida estruturalmente todos os registros (puro; usado também pelo preview). */
export function mapAll(contract: DataContract, mappingInput: unknown, records: SourceRecord[], timeZone: string, keyField: string | undefined, recordOffset = 0): MappingOutcome {
  const mapping = feedMappingSchema.parse(mappingInput)
  const context = { timeZone: mapping.timeZone ?? timeZone }
  const valid: ValidRecord[] = []
  const rejections: Rejection[] = []
  let rejectedRecords = 0
  records.forEach((source, index) => {
    const recordNumber = recordOffset + index + 1
    const { record, errors } = mapRecord(contract, mapping, source, context)
    const key = keyField && record[keyField] !== null && record[keyField] !== undefined ? String(record[keyField]) : null
    if (errors.length === 0) {
      valid.push({ recordNumber, record, sourceRecordKey: key })
      return
    }
    rejectedRecords += 1
    for (const error of errors as RecordError[]) rejections.push({ recordNumber, sourceRecordKey: key, error })
  })
  return { valid, rejections, rejectedRecords }
}

export async function finishRun(ctx: DataHubContext, loaded: LoadedRun, status: RunStatus, stages: RunStage[], metrics: RunMetrics, error: { code: string; message: string } | null, checkpointAfter: Record<string, unknown> | null | undefined): Promise<void> {
  const { run, feed, source } = loaded
  const now = ctx.clock.now()
  const startedAt = run.startedAt ? new Date(run.startedAt) : now
  await ctx.db.query(
    `update data_ingestion_runs set status = $2, stages = $3, finished_at = $4, duration_ms = $5, bytes = $6,
       records_received = $7, records_parsed = $8, records_valid = $9, records_rejected = $10, records_inserted = $11, records_updated = $12,
       records_unchanged = $13, records_deactivated = $14, error_count = $15, error_code = $16, error_message = $17, business_max_event_time = $18,
       checkpoint_after = coalesce($19::jsonb, checkpoint_after), warning_count = $20
     where id = $1`,
    [run.id, status, JSON.stringify(closeStages(stages)), now, Math.max(0, now.getTime() - startedAt.getTime()), metrics.bytes, metrics.recordsReceived, metrics.recordsParsed, metrics.recordsValid, metrics.recordsRejected, metrics.recordsInserted, metrics.recordsUpdated, metrics.recordsUnchanged, metrics.recordsDeactivated, metrics.errorCount, error?.code ?? null, error?.message?.slice(0, 1000) ?? null, metrics.businessMaxEventTime, checkpointAfter === undefined ? null : JSON.stringify(checkpointAfter), metrics.warningCount],
  )
  const success = status === "COMPLETED" || status === "PARTIAL"
  const timeZone = await resolveOrganizationTimezone(ctx.db, run.organizationId)
  const next = feed.status === "ACTIVE" ? nextSyncAt(feed.cadence, now, timeZone) : null
  const schemaChanged = error?.code === "DATA_SCHEMA_CHANGED"
  await ctx.db.query(
    `update data_feeds set
       last_run_at = $2,
       last_success_at = case when $3 then $2 else last_success_at end,
       last_data_at = case when $4::timestamptz is not null and ($4::timestamptz > last_data_at or last_data_at is null) then $4::timestamptz else last_data_at end,
       last_error_code = $5, last_error_message = $6,
       checkpoint = case when $3 and $7::jsonb is not null then $7::jsonb else checkpoint end,
       status = case when $8 and status = 'ACTIVE' then 'DEGRADED' else status end,
       schema_changed_at = case when $8 then $2 else schema_changed_at end,
       next_sync_at = $9,
       updated_at = now()
     where id = $1`,
    [feed.id, now, success, metrics.businessMaxEventTime, error?.code ?? null, error?.message?.slice(0, 1000) ?? null, checkpointAfter === undefined || checkpointAfter === null ? null : JSON.stringify(checkpointAfter), schemaChanged, next],
  )
  // Saúde da conexão só muda quando a fonte foi de fato contatada (nunca por erro de mapping).
  if ((REMOTE_SOURCE_KINDS as readonly string[]).includes(source.kind)) {
    const connectionError = error && ["DATA_SOURCE_AUTH_FAILED", "DATA_SOURCE_UNREACHABLE", "DATA_SOURCE_TIMEOUT", "DATA_SOURCE_TLS_FAILED", "DATA_SOURCE_NOT_FOUND"].includes(error.code)
    const contacted = success || connectionError || ["DATA_SOURCE_RESPONSE_INVALID", "DATA_SCHEMA_CHANGED", "DATA_RUN_ATOMIC_REJECTED", "DATA_SOURCE_PERMISSION_DENIED", "DATA_NO_VALID_RECORDS", "DATA_SOURCE_VOLUME_LIMIT"].includes(error?.code ?? "")
    if (contacted) {
      await ctx.db.query(
        `update data_sources set connection_health = $2, connection_checked_at = $3, connection_error = $4,
           status = case when $5 and status = 'ACTIVE' then 'ERROR' when not $5 and status = 'ERROR' then 'ACTIVE' else status end, updated_at = now()
         where id = $1`,
        [source.id, connectionError ? "ERROR" : "HEALTHY", now, connectionError ? error!.message.slice(0, 500) : null, error?.code === "DATA_SOURCE_AUTH_FAILED"],
      )
    }
  }
  ctx.logger.info(
    { sourceId: source.id, feedId: feed.id, runId: run.id, contract: `${run.contractKey}@${run.contractVersion}`, status, errorCode: error?.code ?? null, counts: { received: metrics.recordsReceived, valid: metrics.recordsValid, rejected: metrics.recordsRejected, inserted: metrics.recordsInserted, updated: metrics.recordsUpdated, unchanged: metrics.recordsUnchanged }, durationMs: now.getTime() - startedAt.getTime() },
    "data-hub run finished",
  )
}

/** Executa um Run já na fila. Nunca lança por erro de dados/fonte: o resultado vai para o próprio Run. */
export async function executeRun(ctx: DataHubContext, runId: string): Promise<DataRunRow | null> {
  const loaded = await loadRun(ctx, runId)
  if (!loaded) return null
  const { run, feed, source, contract } = loaded
  if (run.status !== "QUEUED" && !["CONNECTING", "FETCHING", "PARSING", "MAPPING", "VALIDATING", "APPLYING"].includes(run.status)) return run

  const metrics = emptyMetrics()
  let stages: RunStage[] = run.stages ?? []
  await ctx.db.query(`update data_ingestion_runs set started_at = coalesce(started_at, now()), attempts = attempts + 1 where id = $1`, [run.id])
  run.startedAt = run.startedAt ?? new Date().toISOString()
  const attempt = run.attempts + 1
  let sftpFile: { path: string; checksum: string; size: number; modifiedAt: string | null } | null = null

  try {
    try {
      stages = await transition(ctx.db, run.id, "CONNECTING", stages, source.kind === "FILE_UPLOAD" || source.kind === "API_PUSH" ? "Conteúdo já recebido" : `Conectando em ${source.name}`)
    } catch (error) {
      // Outra execução do MESMO feed está em andamento (unique index parcial): volta pra fila em 30 s.
      if ((error as { code?: string }).code === "23505") {
        await ctx.db.query(`update data_ingestion_runs set status = 'QUEUED', attempts = attempts - 1, next_attempt_at = now() + interval '30 seconds', claimed_until = null where id = $1`, [run.id])
        return (await loadRun(ctx, run.id))?.run ?? null
      }
      throw error
    }
    const mappingProblems = validateMapping(contract, feedMappingSchema.parse(feed.mapping))
    if (mappingProblems.length > 0) throw new DataRunError("DATA_MAPPING_INVALID", mappingProblems.join(" "))

    // Banco externo em páginas: aplica e confirma o checkpoint página a página (database-run.ts).
    const databaseConfig = databaseConfigOfFeed(loaded)
    if (databaseConfig && !run.rawObjectId && !usesWholeBatch(loaded, databaseConfig)) {
      const box = { stages }
      try {
        await runDatabasePages(ctx, loaded, box, metrics)
      } finally {
        stages = box.stages
      }
      return (await loadRun(ctx, run.id))?.run ?? null
    }

    const fetched = await fetchBatch(ctx, loaded, stages)
    stages = fetched.stages
    sftpFile = fetched.sftpFile
    const { batch } = fetched
    metrics.bytes = batch.bytes
    metrics.recordsReceived = batch.totalRecords
    metrics.recordsParsed = batch.records.length

    if (batch.records.length === 0) {
      stages = closeStages(stages, "Nenhum registro recebido")
      await finishRun(ctx, loaded, "COMPLETED", stages, metrics, null, fetched.batch.checkpointAfter)
      return (await loadRun(ctx, run.id))?.run ?? null
    }

    // MAPPING — antes de qualquer registro: a origem ainda entrega o que o mapeamento espera?
    stages = await transition(ctx.db, run.id, "MAPPING", stages, `${batch.records.length} registro(s), ${batch.columns.length} coluna(s)`)
    const mapping = feedMappingSchema.parse(feed.mapping)
    const missing = missingMappedSources(contract, mapping, batch.records.slice(0, 200), batch.columns)
    const missingRequired = missing.filter((entry) => entry.required)
    const fingerprint = fingerprintColumns(batch.columns, ctx.clock.now())
    await ctx.db.query(`update data_feeds set schema_fingerprint = $2 where id = $1`, [feed.id, JSON.stringify(fingerprint)])
    if (missingRequired.length > 0) {
      throw new DataRunError("DATA_SCHEMA_CHANGED", `A origem deixou de entregar: ${missingRequired.map((entry) => `"${entry.source}" (→ ${entry.field})`).join(", ")}. Ajuste o mapeamento do feed.`)
    }
    const timeZone = await resolveOrganizationTimezone(ctx.db, run.organizationId)
    const keyField = contract.fields.find((field) => field.identity)?.key
    const mapped = mapAll(contract, feed.mapping, batch.records, timeZone, keyField)

    // VALIDATING — referências e regras de catálogo, em lote.
    stages = await transition(ctx.db, run.id, "VALIDATING", stages, `${mapped.valid.length} válido(s) na estrutura, ${mapped.rejectedRecords} rejeitado(s)`)
    const writer = requireWriter(contract.key)
    const writeContext: WriteContext = { ctx, organizationId: run.organizationId, timeZone, feed, runId: run.id, sourceNamespace: feed.sourceNamespace ?? source.publicId }
    const prepared = await writer.prepare(writeContext, mapped.valid)
    const rejections = [...mapped.rejections, ...prepared.rejections]
    const rejectedRecords = mapped.rejectedRecords + prepared.rejections.length
    metrics.recordsRejected = rejectedRecords
    metrics.recordsValid = prepared.ready.length
    metrics.errorCount = rejections.length
    await persistRejections(ctx.db, run, rejections)

    const atomic = contract.writePolicy === "ATOMIC" || feed.failOnAnyRejection
    if (atomic && rejectedRecords > 0) {
      throw new DataRunError("DATA_RUN_ATOMIC_REJECTED", `${rejectedRecords} registro(s) rejeitado(s) — o contrato ${contract.key} exige carga íntegra; nada foi aplicado.`)
    }
    if (prepared.ready.length === 0) {
      throw new DataRunError("DATA_NO_VALID_RECORDS", `Nenhum dos ${batch.records.length} registros é válido — veja a quarentena.`)
    }

    // APPLYING — lotes em transação própria (ou uma única transação quando atômico).
    stages = await transition(ctx.db, run.id, "APPLYING", stages, `${prepared.ready.length} registro(s) em lotes de ${APPLY_BATCH}`)
    const total = emptyApply()
    const client = await ctx.db.connect()
    try {
      // Cada transação de aplicação roda com o limite de comando das cargas em lote, mesmo quando esta carga roda na API.
      if (atomic) {
        await client.query("begin")
        await useBatchStatementTimeout(client)
      }
      for (let index = 0; index < prepared.ready.length; index += APPLY_BATCH) {
        const chunk = prepared.ready.slice(index, index + APPLY_BATCH)
        if (!atomic) {
          await client.query("begin")
          await useBatchStatementTimeout(client)
        }
        try {
          const result = await writer.apply(writeContext, client, chunk)
          await persistLineage(client, run, result.lineage)
          mergeApply(total, result)
          if (!atomic) await client.query("commit")
        } catch (error) {
          await client.query("rollback")
          throw error
        }
        await ctx.db.query(`update data_ingestion_runs set records_inserted = $2, records_updated = $3, records_unchanged = $4 where id = $1`, [run.id, total.inserted, total.updated, total.unchanged])
      }
      if (atomic) await client.query("commit")
    } finally {
      client.release()
    }
    metrics.recordsInserted = total.inserted
    metrics.recordsUpdated = total.updated
    metrics.recordsUnchanged = total.unchanged
    metrics.recordsDeactivated = total.deactivated
    metrics.businessMaxEventTime = total.businessMaxEventTime
    total.lineage = []
    // Avisos de registros APLICADOS (ex.: conflito de situação funcional): rastro na quarentena com
    // severidade própria — warningCount, nunca errorCount nem registro rejeitado.
    if (total.warnings.length > 0) {
      await persistRejections(ctx.db, run, total.warnings)
      metrics.warningCount += total.warnings.length
      stages = closeStages(stages, `${total.warnings.length} aviso(s) de conflito de situação funcional`)
    }

    if (sftpFile) {
      await ctx.db.query(
        `insert into data_processed_files (organization_id, feed_id, remote_path, checksum_sha256, byte_size, remote_modified_at, run_id) values ($1, $2, $3, $4, $5, $6, $7) on conflict (feed_id, checksum_sha256) do nothing`,
        [run.organizationId, feed.id, sftpFile.path, sftpFile.checksum, sftpFile.size, sftpFile.modifiedAt, run.id],
      )
    }
    const status: RunStatus = rejectedRecords > 0 ? "PARTIAL" : "COMPLETED"
    await finishRun(ctx, loaded, status, stages, metrics, null, fetched.batch.checkpointAfter)
  } catch (error) {
    const runError = error instanceof DataRunError ? error : new DataRunError("DATA_INTERNAL_ERROR", error instanceof Error ? error.message : "Erro inesperado.")
    if (!(error instanceof DataRunError)) ctx.logger.error({ runId: run.id, feedId: feed.id, sourceId: source.id, err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, "data-hub run crashed")
    if (runError.transient && attempt < MAX_RUN_ATTEMPTS) {
      const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]!
      stages = closeStages(stages, `${runError.message} · nova tentativa em ${Math.round(backoff / 60_000)} min`)
      await ctx.db.query(
        `update data_ingestion_runs set status = 'QUEUED', stages = $2, next_attempt_at = now() + make_interval(secs => $3), error_code = $4, error_message = $5, claimed_until = null where id = $1`,
        [run.id, JSON.stringify(stages), backoff / 1000, runError.code, runError.message.slice(0, 1000)],
      )
      await ctx.db.query(`update data_feeds set last_run_at = now(), last_error_code = $2, last_error_message = $3 where id = $1`, [feed.id, runError.code, runError.message.slice(0, 1000)])
      ctx.logger.warn({ runId: run.id, feedId: feed.id, sourceId: source.id, errorCode: runError.code, attempt }, "data-hub run retry scheduled")
      return (await loadRun(ctx, run.id))?.run ?? null
    }
    stages = closeStages(stages, runError.message)
    metrics.errorCount = Math.max(metrics.errorCount, 1)
    await finishRun(ctx, loaded, "FAILED", stages, metrics, { code: runError.code, message: runError.message }, undefined)
  }
  return (await loadRun(ctx, run.id))?.run ?? null
}

/** Atualidade dos feeds — helper compartilhado entre listagens e home. */
export function feedFreshness(feed: Pick<DataFeedRow, "lastSuccessAt" | "cadence" | "expectedIntervalMinutes">, now: Date) {
  const interval = feed.expectedIntervalMinutes ?? expectedIntervalMinutes(feed.cadence)
  return computeFreshness(feed.lastSuccessAt ? new Date(feed.lastSuccessAt) : null, interval, now)
}
