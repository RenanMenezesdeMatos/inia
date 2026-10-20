import { DomainError } from "../../../shared/domain/domain-error.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { nextSyncAt } from "../domain/freshness.js"
import { MAX_RUN_ATTEMPTS, RUN_ACTIVE_STATUSES, type RunTriggerKind } from "../domain/run-status.js"
import { REMOTE_SOURCE_KINDS } from "../domain/source-config.js"
import type { DataHubContext } from "./data-hub-context.js"
import { findRun, recordAudit, requireFeed, requireRun, requireSource, type DataFeedRow, type DataRunRow } from "./records.js"
import { executeRun } from "./run-pipeline.js"

/**
 * Fila de Runs + worker. Enfileirar é barato e síncrono (a UI recebe o runId e polla); quem
 * executa é o tick (`runDataHubTick`), com claim por `for update skip locked` + lease — mesmo
 * padrão do motor de Workflows. Um feed nunca tem duas execuções em andamento (unique index
 * parcial em data_ingestion_runs).
 */
const CLAIM_LIMIT = 5
const LEASE_SECONDS = 15 * 60

export type EnqueueInput = {
  organizationId: string
  feed: DataFeedRow
  triggerKind: RunTriggerKind
  requestedBy: string | null
  rawObjectId?: string | null
  idempotencyKey?: string | null
  /** SHA-256 do corpo recebido com a `idempotencyKey` (API Push) — a mesma chave com outro corpo é recusada. */
  idempotencyBodySha256?: string | null
  reprocessOfRunId?: string | null
}

export async function enqueueRun(ctx: DataHubContext, input: EnqueueInput): Promise<{ run: DataRunRow; deduplicated: boolean }> {
  const { feed } = input
  if (input.idempotencyKey) {
    const existing = await ctx.db.query<{ id: string; idempotency_body_sha256: string | null }>(`select id, idempotency_body_sha256 from data_ingestion_runs where feed_id = $1 and idempotency_key = $2`, [feed.id, input.idempotencyKey])
    const row = existing.rows[0]
    if (row) {
      if (input.idempotencyBodySha256 && row.idempotency_body_sha256 && row.idempotency_body_sha256 !== input.idempotencyBodySha256) {
        throw new DomainError("Esta Idempotency-Key já foi usada com outro conteúdo. Use uma chave nova para um lote diferente.", "DATA_PUSH_IDEMPOTENCY_CONFLICT", 422, { runId: row.id })
      }
      return { run: (await findRun(ctx.db, input.organizationId, row.id))!, deduplicated: true }
    }
  }
  // Push pode enfileirar vários lotes (processados em sequência); os demais gatilhos nunca
  // empilham uma carga em cima de outra do mesmo feed.
  if (input.triggerKind !== "PUSH") {
    const inFlight = await ctx.db.query<{ id: string }>(
      `select id from data_ingestion_runs where feed_id = $1 and status in ('QUEUED','CONNECTING','FETCHING','PARSING','MAPPING','VALIDATING','APPLYING') limit 1`,
      [feed.id],
    )
    if (inFlight.rows[0]) throw new DomainError("Já existe uma carga em andamento ou na fila para este feed.", "DATA_RUN_ALREADY_QUEUED", 409, { runId: inFlight.rows[0].id })
  }
  const result = await ctx.db.query<{ id: string }>(
    `insert into data_ingestion_runs (organization_id, source_id, feed_id, contract_key, contract_version, trigger_kind, raw_object_id, idempotency_key, reprocess_of_run_id, requested_by, checkpoint_before, queued_at, created_at, idempotency_body_sha256)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13) returning id`,
    [input.organizationId, feed.sourceId, feed.id, feed.contractKey, feed.contractVersion, input.triggerKind, input.rawObjectId ?? null, input.idempotencyKey ?? null, input.reprocessOfRunId ?? null, input.requestedBy, feed.checkpoint ? JSON.stringify(feed.checkpoint) : null, ctx.clock.now(), input.idempotencyBodySha256 ?? null],
  )
  const run = (await findRun(ctx.db, input.organizationId, result.rows[0]!.id))!
  ctx.logger.info({ runId: run.id, feedId: feed.id, sourceId: feed.sourceId, contract: `${feed.contractKey}@${feed.contractVersion}`, trigger: input.triggerKind }, "data-hub run queued")
  return { run, deduplicated: false }
}

/** "Sincronizar agora" — feed remoto (API Pull/SFTP) ativo, pausado ou degradado. */
export async function requestManualSync(ctx: DataHubContext, organizationId: string, feedId: string, actorId: string | null): Promise<DataRunRow> {
  const feed = await requireFeed(ctx.db, organizationId, feedId)
  const source = await requireSource(ctx.db, organizationId, feed.sourceId)
  if (!REMOTE_SOURCE_KINDS.includes(source.kind)) throw new DomainError("Só fontes que a INIA consulta (API Pull, SFTP e banco de dados) podem ser sincronizadas pela INIA; arquivos e push chegam do cliente.", "DATA_SOURCE_NOT_SYNCABLE", 422)
  if (feed.status === "DRAFT") throw new DomainError("Ative o feed antes de sincronizar (o mapeamento precisa estar completo).", "DATA_FEED_INACTIVE", 422)
  const { run } = await enqueueRun(ctx, { organizationId, feed, triggerKind: "MANUAL", requestedBy: actorId })
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_SYNC_REQUESTED", entityType: "data_feed", entityId: feed.id, payload: { runId: run.id } })
  return run
}

/** Reprocessa um Run anterior (mesmo conteúdo bruto, mapeamento ATUAL do feed). Idempotência protege contra duplicação. */
export async function requestReprocess(ctx: DataHubContext, organizationId: string, runId: string, actorId: string | null): Promise<DataRunRow> {
  const original = await requireRun(ctx.db, organizationId, runId)
  if (!original.rawObjectId) throw new DomainError("Esta carga não tem conteúdo bruto retido para reprocessar.", "DATA_RAW_EXPIRED", 422)
  const raw = await ctx.rawObjects.get(original.rawObjectId)
  if (!raw) throw new DomainError("O conteúdo bruto desta carga já foi descartado pela retenção.", "DATA_RAW_EXPIRED", 422)
  const feed = await requireFeed(ctx.db, organizationId, original.feedId)
  const { run } = await enqueueRun(ctx, { organizationId, feed, triggerKind: "REPROCESS", requestedBy: actorId, rawObjectId: original.rawObjectId, reprocessOfRunId: original.id })
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_REPROCESS_REQUESTED", entityType: "data_ingestion_run", entityId: run.id, payload: { originalRunId: original.id } })
  return run
}

export async function cancelQueuedRun(ctx: DataHubContext, organizationId: string, runId: string, actorId: string | null): Promise<DataRunRow> {
  const result = await ctx.db.query(`update data_ingestion_runs set status = 'CANCELLED', finished_at = now() where organization_id = $1 and id = $2 and status = 'QUEUED'`, [organizationId, runId])
  if (!result.rowCount) throw new DomainError("Só cargas ainda na fila podem ser canceladas.", "DATA_RUN_NOT_CANCELLABLE", 409)
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_RUN_CANCELLED", entityType: "data_ingestion_run", entityId: runId })
  return requireRun(ctx.db, organizationId, runId)
}

// ---------------------------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------------------------
/** Feeds ativos com cadência vencida viram Runs SCHEDULE (um por feed; nunca em cima de outro em andamento). */
export async function enqueueDueFeeds(ctx: DataHubContext, now: Date = ctx.clock.now()): Promise<number> {
  const due = await ctx.db.query<{ id: string; organization_id: string }>(
    `select f.id, f.organization_id from data_feeds f
     join data_sources s on s.id = f.source_id and s.status = 'ACTIVE' and s.deleted_at is null and s.kind = any($2::text[])
     where f.status = 'ACTIVE' and f.deleted_at is null and f.next_sync_at is not null and f.next_sync_at <= $1
       and not exists (select 1 from data_ingestion_runs r where r.feed_id = f.id and r.status in ('QUEUED','CONNECTING','FETCHING','PARSING','MAPPING','VALIDATING','APPLYING'))
     order by f.next_sync_at limit 50`,
    [now, REMOTE_SOURCE_KINDS],
  )
  let enqueued = 0
  for (const row of due.rows) {
    const feed = await requireFeed(ctx.db, row.organization_id, row.id)
    const timeZone = await resolveOrganizationTimezone(ctx.db, row.organization_id)
    // Avança a próxima execução ANTES de enfileirar — evita reenfileirar no próximo tick se a carga demorar.
    await ctx.db.query(`update data_feeds set next_sync_at = $2 where id = $1`, [feed.id, nextSyncAt(feed.cadence, now, timeZone)])
    try {
      await enqueueRun(ctx, { organizationId: row.organization_id, feed, triggerKind: "SCHEDULE", requestedBy: null })
      enqueued += 1
    } catch (error) {
      if (!(error instanceof DomainError && error.code === "DATA_RUN_ALREADY_QUEUED")) throw error
    }
  }
  return enqueued
}

/** Reivindica Runs na fila (skip locked + lease) e executa em sequência. */
export async function processQueuedRuns(ctx: DataHubContext, limit = CLAIM_LIMIT): Promise<{ processed: number }> {
  const client = await ctx.db.connect()
  let claimed: string[] = []
  try {
    await client.query("begin")
    const due = await client.query<{ id: string }>(
      `select id from data_ingestion_runs
       where status = 'QUEUED' and next_attempt_at <= now() and (claimed_until is null or claimed_until < now())
       order by queued_at limit $1 for update skip locked`,
      [limit],
    )
    if (due.rows.length > 0) {
      await client.query(`update data_ingestion_runs set claimed_until = now() + make_interval(secs => $2) where id = any($1::uuid[])`, [due.rows.map((row) => row.id), LEASE_SECONDS])
    }
    claimed = due.rows.map((row) => row.id)
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
  let processed = 0
  for (const runId of claimed) {
    try {
      const finished = await executeRun(ctx, runId)
      if (finished) await enqueueContinuation(ctx, finished)
    } catch (error) {
      // Falha de infraestrutura fora do pipeline (que já captura erros de dado/fonte): marca o Run e segue.
      ctx.logger.error({ runId, err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, "data-hub run execution crashed")
      await ctx.db.query(`update data_ingestion_runs set status = 'FAILED', finished_at = now(), error_code = 'DATA_INTERNAL_ERROR', error_message = $2 where id = $1 and status <> 'FAILED'`, [runId, (error instanceof Error ? error.message : "Erro inesperado.").slice(0, 1000)])
    } finally {
      await ctx.db.query(`update data_ingestion_runs set claimed_until = null where id = $1`, [runId])
    }
    processed += 1
  }
  return { processed }
}

/**
 * Banco externo com mais linhas que o limite por carga: a carga terminou com o checkpoint no meio da origem
 * (`reachedEnd = false`) — a próxima carga (CONTINUAÇÃO) segue sozinha do ponto já aplicado.
 */
export async function enqueueContinuation(ctx: DataHubContext, run: DataRunRow): Promise<DataRunRow | null> {
  if (run.status !== "COMPLETED" && run.status !== "PARTIAL") return null
  const checkpoint = run.checkpointAfter as { kind?: string; reachedEnd?: boolean } | null
  if (checkpoint?.kind !== "DATABASE" || checkpoint.reachedEnd !== false) return null
  const feed = await requireFeed(ctx.db, run.organizationId, run.feedId).catch(() => null)
  if (!feed || feed.status === "PAUSED" || feed.status === "DRAFT") return null
  try {
    const { run: next } = await enqueueRun(ctx, { organizationId: run.organizationId, feed, triggerKind: "CONTINUATION", requestedBy: run.requestedBy, reprocessOfRunId: null })
    return next
  } catch (error) {
    if (error instanceof DomainError && error.code === "DATA_RUN_ALREADY_QUEUED") return null
    throw error
  }
}

/**
 * Carga interrompida (processo caiu/reiniciou no meio): ficou num estado "em andamento" com a posse vencida. Volta
 * para a fila e é retomada — no banco externo em páginas, do último checkpoint confirmado; nos demais, do começo
 * (aplicação idempotente). Esgotadas as tentativas, FALHOU com motivo.
 */
export async function recoverInterruptedRuns(ctx: DataHubContext, now: Date = ctx.clock.now()): Promise<{ requeued: number; failed: number }> {
  const stale = await ctx.db.query<{ id: string; attempts: number; stages: unknown }>(
    `select id, attempts, stages from data_ingestion_runs where status = any($1::text[]) and claimed_until is not null and claimed_until < $2`,
    [RUN_ACTIVE_STATUSES, now],
  )
  let requeued = 0
  let failed = 0
  for (const row of stale.rows) {
    const stages = Array.isArray(row.stages) ? [...row.stages] : []
    const last = stages[stages.length - 1] as { finishedAt?: string | null; detail?: string | null } | undefined
    if (last && !last.finishedAt) last.finishedAt = now.toISOString()
    if (row.attempts < MAX_RUN_ATTEMPTS) {
      if (last) last.detail = `${last.detail ? `${last.detail} · ` : ""}interrompida (processo reiniciado) — retomada automática`
      await ctx.db.query(`update data_ingestion_runs set status = 'QUEUED', claimed_until = null, next_attempt_at = $2, stages = $3 where id = $1 and status = any($4::text[])`, [row.id, now, JSON.stringify(stages), RUN_ACTIVE_STATUSES])
      requeued += 1
    } else {
      await ctx.db.query(`update data_ingestion_runs set status = 'FAILED', claimed_until = null, finished_at = $2, stages = $3, error_code = 'DATA_INTERNAL_ERROR', error_message = 'Carga interrompida várias vezes (processo reiniciado no meio) — sincronize de novo.' where id = $1 and status = any($4::text[])`, [row.id, now, JSON.stringify(stages), RUN_ACTIVE_STATUSES])
      failed += 1
    }
  }
  if (requeued || failed) ctx.logger.warn({ requeued, failed }, "data-hub interrupted runs recovered")
  return { requeued, failed }
}

/** Reinicia a leitura de um conjunto de banco externo do começo (ex.: depois de corrigir o mapeamento). Nada é apagado. */
export async function resetFeedCheckpoint(ctx: DataHubContext, organizationId: string, feedId: string, actorId: string | null): Promise<DataFeedRow> {
  const feed = await requireFeed(ctx.db, organizationId, feedId)
  const inFlight = await ctx.db.query(`select 1 from data_ingestion_runs where feed_id = $1 and status in ('QUEUED','CONNECTING','FETCHING','PARSING','MAPPING','VALIDATING','APPLYING') limit 1`, [feed.id])
  if (inFlight.rowCount) throw new DomainError("Espere a carga em andamento terminar (ou cancele a que está na fila) antes de reiniciar a leitura.", "DATA_RUN_ALREADY_QUEUED", 409)
  await ctx.db.query(`update data_feeds set checkpoint = null, updated_by = $2, updated_at = now() where id = $1`, [feed.id, actorId])
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_CHECKPOINT_RESET", entityType: "data_feed", entityId: feed.id, payload: { previous: feed.checkpoint } })
  return requireFeed(ctx.db, organizationId, feed.id)
}

/** Tick da Central (chamado pelo server a cada 15 s): retoma interrompidas, agenda vencidos, processa a fila, purga raw expirado. */
export async function runDataHubTick(ctx: DataHubContext): Promise<{ enqueued: number; processed: number; purged: number }> {
  await recoverInterruptedRuns(ctx)
  const enqueued = await enqueueDueFeeds(ctx)
  const { processed } = await processQueuedRuns(ctx)
  const purged = await ctx.rawObjects.purgeExpired(ctx.clock.now())
  return { enqueued, processed, purged }
}

/**
 * Dispara o processamento da fila fora do request (sem bloquear a resposta HTTP). O tick
 * periódico continua sendo a garantia; isto só reduz a latência percebida na UI. Serializado
 * por processo: se já há um worker rodando, o próximo tick pega o que sobrou.
 *
 * Com `ctx.wakeWorker` (API separada do processamento, papel `api`) só avisa o processamento: a carga — leitura de planilha
 * com o exceljs inteiro, mapeamento, validação, gravação — nunca roda no processo que atende as telas.
 */
let workerBusy = false
export function kickWorker(ctx: DataHubContext): void {
  if (ctx.wakeWorker) {
    ctx.wakeWorker()
    return
  }
  if (workerBusy) return
  workerBusy = true
  setImmediate(() => {
    processQueuedRuns(ctx)
      .catch((error) => ctx.logger.error({ err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, "data-hub worker kick failed"))
      .finally(() => {
        workerBusy = false
      })
  })
}
