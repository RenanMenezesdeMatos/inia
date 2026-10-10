import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { DataRunError } from "../domain/error-codes.js"
import type { DatabaseColumn } from "../domain/database/column-types.js"
import { databaseFeedConfigSchema, planPage, readDatabaseCheckpoint, startPointOf, type DatabaseCheckpoint, type DatabaseFeedConfig } from "../domain/database/database-sync.js"
import { feedMappingSchema, type FeedMapping } from "../domain/mapping.js"
import type { RunMetrics, RunStage } from "../domain/run-status.js"
import { fingerprintColumns } from "../domain/schema-fingerprint.js"
import { describeObjectInSession, readPage, resolveFeedColumns, resolveSourceConnection, withDatabaseSession, type DatabasePageRow, type DatabaseSessionScope } from "./connectors/database-connector.js"
import type { FetchedBatch } from "./connectors/file-connector.js"
import type { DataHubContext } from "./data-hub-context.js"
import { APPLY_BATCH, closeStages, finishRun, mapAll, persistLineage, persistRejections, RAW_RETENTION_LIMIT_BYTES, transition, type LoadedRun } from "./run-pipeline.js"
import { emptyApply, mergeApply, type WriteContext } from "./writers/domain-writer.js"
import { requireWriter } from "./writers/writer-registry.js"

/**
 * Carga de um conjunto de dados de BANCO EXTERNO.
 *
 * Dois modos, decididos pela regra (nunca pelo volume em tempo de execução):
 *  - PÁGINAS (eventos/medições/desempenho): cada página é mapeada, validada e aplicada numa transação que grava
 *    TAMBÉM a quarentena da página, a linhagem e o checkpoint — o checkpoint nunca avança antes da aplicação e uma
 *    falha no meio retoma da última página aplicada. Passou de `maxRowsPerRun`, a carga termina e a próxima
 *    (CONTINUAÇÃO) segue do ponto aplicado.
 *  - CARGA ÚNICA (cadastros mestres, contrato atômico, "exigir carga íntegra" ou leitura completa sem chave): lê tudo
 *    (até o limite) e segue o pipeline de sempre — gestor que vem na mesma carga continua resolvido e o checkpoint só
 *    avança depois do sucesso. Acima do limite, falha clara (nunca aplica pela metade).
 * Uma página inteira sem nenhum registro válido para a carga (FALHOU) sem avançar sobre ela — mapeamento errado
 * nunca "consome" linhas.
 */
const LEASE_SECONDS = 15 * 60

export function usesWholeBatch(loaded: Pick<LoadedRun, "contract" | "feed">, config: DatabaseFeedConfig): boolean {
  if (loaded.contract.category === "MASTER" || loaded.contract.writePolicy === "ATOMIC" || loaded.feed.failOnAnyRejection) return true
  return config.sync.mode === "FULL" && config.sync.keyColumns.length === 0
}

export function databaseConfigOfFeed(loaded: Pick<LoadedRun, "feed">): DatabaseFeedConfig | null {
  return loaded.feed.connectorConfig.connector === "DATABASE" ? databaseFeedConfigSchema.parse(loaded.feed.connectorConfig.database) : null
}

/** Coluna de origem de um campo mapeado: nome exato, ou o JSON de onde sai o caminho `coluna.campo`. */
export function columnOfSource(source: string, columns: readonly string[]): string | null {
  if (columns.includes(source)) return source
  const candidates = columns.filter((column) => source.startsWith(`${column}.`) || source.startsWith(`${column}[`))
  return candidates.sort((a, b) => b.length - a.length)[0] ?? null
}

type ReadPlan = {
  config: DatabaseFeedConfig
  select: DatabaseColumn[]
  order: DatabaseColumn[]
  checkpointColumns: string[]
  start: ReturnType<typeof startPointOf>
  notes: string[]
}

/** Descreve o objeto AO VIVO, confere mapeamento × colunas e decide colunas lidas e ponto de partida. */
async function planRead(ctx: DataHubContext, loaded: LoadedRun, scope: DatabaseSessionScope, config: DatabaseFeedConfig): Promise<ReadPlan> {
  const description = await describeObjectInSession(scope, config.object)
  const resolved = resolveFeedColumns(description, config)
  const live = resolved.supported.map((column) => column.name)
  const mapping: FeedMapping = feedMappingSchema.parse(loaded.feed.mapping)
  const requiredKeys = new Set(loaded.contract.fields.filter((field) => field.required).map((field) => field.key))
  const selectNames = new Set<string>()
  const missingOptional: string[] = []
  for (const field of mapping.fields) {
    if (!field.source) continue
    const column = columnOfSource(field.source, live)
    if (column) {
      selectNames.add(column)
      continue
    }
    if (requiredKeys.has(field.target)) throw new DataRunError("DATA_SCHEMA_CHANGED", `A origem ${config.object.schema}.${config.object.name} deixou de entregar "${field.source}" (→ ${field.target}). Ajuste o mapeamento do conjunto de dados.`)
    missingOptional.push(`${field.source} (→ ${field.target})`)
  }
  // Minimização: só as colunas mapeadas saem do banco do cliente (a ordenação vem em texto à parte).
  if (selectNames.size === 0) selectNames.add((resolved.order[0] ?? resolved.supported[0])!.name)
  const select = resolved.supported.filter((column) => selectNames.has(column.name))
  await ctx.db.query(`update data_feeds set schema_fingerprint = $2 where id = $1`, [loaded.feed.id, JSON.stringify(fingerprintColumns(live, ctx.clock.now()))])
  const { checkpoint, discarded } = readDatabaseCheckpoint(loaded.feed.checkpoint, config.sync)
  const start = startPointOf(config.sync, checkpoint, config.sync.mode === "INCREMENTAL" ? resolved.order[0]!.category : null)
  const notes: string[] = []
  if (missingOptional.length) notes.push(`coluna(s) opcional(is) ausente(s) na origem: ${missingOptional.join(", ")}`)
  if (discarded) notes.push("a configuração de sincronização mudou — leitura recomeça do início")
  if (start.kind === "LOOKBACK") notes.push(`releitura de segurança a partir de ${start.firstColumnFrom}`)
  return { config, select, order: resolved.order, checkpointColumns: resolved.order.map((column) => column.name), start, notes }
}

function checkpointOf(plan: ReadPlan, position: string[] | null, reachedEnd: boolean, now: Date): DatabaseCheckpoint {
  return { kind: "DATABASE", mode: plan.config.sync.mode, orderColumns: plan.checkpointColumns, position, reachedEnd, updatedAt: now.toISOString() }
}

async function heartbeat(ctx: DataHubContext, runId: string): Promise<void> {
  await ctx.db.query(`update data_ingestion_runs set claimed_until = now() + make_interval(secs => $2) where id = $1 and claimed_until is not null`, [runId, LEASE_SECONDS])
}

/**
 * Itera páginas a partir do ponto de partida, sem pular nem repetir linha (empate na fronteira resolvido por
 * `planPage`). `onPage` recebe as linhas e a posição a gravar; devolver `false` interrompe.
 */
async function iteratePages(ctx: DataHubContext, runId: string, scope: DatabaseSessionScope, plan: ReadPlan, onPage: (rows: DatabasePageRow[], position: string[] | null, last: boolean) => Promise<void>): Promise<{ read: number; reachedEnd: boolean; pages: number }> {
  const { config } = plan
  let position: string[] | null = plan.start.kind === "AFTER" ? plan.start.position : null
  let lookback: string | null = plan.start.kind === "LOOKBACK" ? plan.start.firstColumnFrom : null
  let read = 0
  let pages = 0
  for (;;) {
    const remaining = config.maxRowsPerRun - read
    if (remaining <= 0) return { read, reachedEnd: false, pages }
    const size = Math.min(config.batchSize, remaining)
    const rows = await readPage(scope, { object: config.object, select: plan.select, order: plan.order, after: position, atOrAfterFirst: position ? null : lookback, limit: size + 1 })
    await heartbeat(ctx, runId)
    const page = planPage(rows.map((row) => row.position), size)
    let taken: DatabasePageRow[]
    if (page.tieGroup) {
      // A página inteira tem o mesmo valor de ordenação: lê o grupo empatado de uma vez (nunca dividido).
      taken = await readPage(scope, { object: config.object, select: plan.select, order: plan.order, equalTo: page.tieGroup, limit: config.maxRowsPerRun + 1 })
      if (taken.length > config.maxRowsPerRun) {
        throw new DataRunError("DATA_SOURCE_VOLUME_LIMIT", `Mais de ${config.maxRowsPerRun} linhas têm o mesmo valor em ${plan.checkpointColumns.join(" + ")}. Inclua uma chave de desempate na sincronização (ex.: o identificador da linha).`)
      }
    } else {
      taken = rows.slice(0, page.take)
    }
    const last = page.reachedEnd
    const nextPosition = taken.length ? taken[taken.length - 1]!.position : position
    pages += 1
    read += taken.length
    await onPage(taken, nextPosition, last)
    position = nextPosition
    lookback = null
    if (last) return { read, reachedEnd: true, pages }
  }
}

// ---------------------------------------------------------------------------------------------
// CARGA ÚNICA — lê tudo (até o limite) e devolve um lote para o pipeline de sempre.
// ---------------------------------------------------------------------------------------------
export async function fetchDatabaseWholeBatch(ctx: DataHubContext, loaded: LoadedRun): Promise<FetchedBatch> {
  const config = databaseConfigOfFeed(loaded)!
  const connection = await resolveSourceConnection(ctx, loaded.source)
  return withDatabaseSession(
    ctx,
    loaded.source.id,
    connection,
    async (scope) => {
      const plan = await planRead(ctx, loaded, scope, config)
      const records: Record<string, unknown>[] = []
      let position: string[] | null = plan.start.kind === "AFTER" ? plan.start.position : null
      let reachedEnd: boolean
      if (plan.order.length === 0) {
        const rows = await readPage(scope, { object: config.object, select: plan.select, order: [], limit: config.maxRowsPerRun + 1 })
        if (rows.length > config.maxRowsPerRun) {
          throw new DataRunError("DATA_SOURCE_VOLUME_LIMIT", `A origem tem mais de ${config.maxRowsPerRun} linhas. Escolha uma chave para ler em páginas (o checkpoint retoma do meio) ou aumente o limite por carga.`)
        }
        records.push(...rows.map((row) => row.record))
        reachedEnd = true
        position = null
      } else {
        const outcome = await iteratePages(ctx, loaded.run.id, scope, plan, async (rows, nextPosition) => {
          records.push(...rows.map((row) => row.record))
          position = nextPosition
        })
        if (!outcome.reachedEnd) {
          throw new DataRunError("DATA_SOURCE_VOLUME_LIMIT", `Mais de ${config.maxRowsPerRun} linhas pendentes. Este conjunto (${loaded.contract.label}) é aplicado de uma vez para manter as referências da própria carga — aumente o limite por carga (até 1.000.000).`)
        }
        reachedEnd = true
      }
      const detail = `${config.object.schema}.${config.object.name} · ${records.length} linha(s)${plan.notes.length ? ` · ${plan.notes.join(" · ")}` : ""}`
      return { columns: plan.select.map((column) => column.name), records, bytes: Buffer.byteLength(JSON.stringify(records)), totalRecords: records.length, detail, checkpointAfter: checkpointOf(plan, position, reachedEnd, ctx.clock.now()) as unknown as Record<string, unknown> }
    },
    config.object,
  )
}

// ---------------------------------------------------------------------------------------------
// PÁGINAS — mapeia, valida e aplica página a página; checkpoint na mesma transação.
// ---------------------------------------------------------------------------------------------
export async function runDatabasePages(ctx: DataHubContext, loaded: LoadedRun, box: { stages: RunStage[] }, metrics: RunMetrics): Promise<void> {
  const { run, feed, source, contract } = loaded
  const config = databaseConfigOfFeed(loaded)!
  box.stages = await transition(ctx.db, run.id, "FETCHING", box.stages, `Lendo ${config.object.schema}.${config.object.name} em páginas de ${config.batchSize} linha(s)`)
  // Retomada de uma carga interrompida: as contagens das páginas já aplicadas continuam valendo.
  if (run.attempts > 0) {
    Object.assign(metrics, { recordsReceived: run.recordsReceived, recordsParsed: run.recordsParsed, recordsValid: run.recordsValid, recordsRejected: run.recordsRejected, recordsInserted: run.recordsInserted, recordsUpdated: run.recordsUpdated, recordsUnchanged: run.recordsUnchanged, errorCount: run.errorCount, warningCount: run.warningCount })
  }
  const timeZone = await resolveOrganizationTimezone(ctx.db, run.organizationId)
  const keyField = contract.fields.find((field) => field.identity)?.key
  const writer = requireWriter(contract.key)
  const writeContext: WriteContext = { ctx, organizationId: run.organizationId, timeZone, feed, runId: run.id, sourceNamespace: feed.sourceNamespace ?? source.publicId }
  const connection = await resolveSourceConnection(ctx, source)
  const rawChunks: string[] = []
  let rawBytes = 0
  let rawOverflow = false
  let applyingStarted = false
  let lastCheckpoint: DatabaseCheckpoint | null = null

  const outcome = await withDatabaseSession(
    ctx,
    source.id,
    connection,
    async (scope) => {
      const plan = await planRead(ctx, loaded, scope, config)
      if (plan.notes.length) box.stages = closeStages(box.stages, plan.notes.join(" · "))
      const result = await iteratePages(ctx, run.id, scope, plan, async (rows, position, last) => {
        if (!applyingStarted) {
          box.stages = await transition(ctx.db, run.id, "APPLYING", box.stages, "Aplicando página a página (checkpoint confirmado junto com cada página)")
          applyingStarted = true
        }
        const checkpoint = checkpointOf(plan, position, last, ctx.clock.now())
        if (rows.length === 0) {
          // Fim da origem sem linha nova: só registra que a leitura chegou ao fim.
          await ctx.db.query(`update data_feeds set checkpoint = $2 where id = $1`, [feed.id, JSON.stringify(checkpoint)])
          await ctx.db.query(`update data_ingestion_runs set checkpoint_after = $2 where id = $1`, [run.id, JSON.stringify(checkpoint)])
          lastCheckpoint = checkpoint
          return
        }
        const offset = metrics.recordsReceived
        const records = rows.map((row) => row.record)
        if (!rawOverflow) {
          const chunk = JSON.stringify(records).slice(1, -1)
          rawBytes += Buffer.byteLength(chunk) + 1
          if (rawBytes > RAW_RETENTION_LIMIT_BYTES) {
            rawOverflow = true
            rawChunks.length = 0
          } else if (chunk) rawChunks.push(chunk)
        }
        const mapped = mapAll(contract, feed.mapping, records, timeZone, keyField, offset)
        const prepared = await writer.prepare(writeContext, mapped.valid)
        const rejections = [...mapped.rejections, ...prepared.rejections]
        const rejectedRecords = mapped.rejectedRecords + prepared.rejections.length
        metrics.recordsReceived += rows.length
        metrics.recordsParsed += rows.length
        metrics.recordsRejected += rejectedRecords
        metrics.errorCount += rejections.length
        if (prepared.ready.length === 0 && rejectedRecords > 0) {
          await persistRejections(ctx.db, run, rejections)
          throw new DataRunError("DATA_NO_VALID_RECORDS", `Nenhum registro válido nas linhas ${offset + 1}–${offset + rows.length} — veja a quarentena. A leitura parou ANTES delas (o checkpoint não avançou); corrija o mapeamento ou os dados e sincronize de novo.`)
        }
        const total = emptyApply()
        const client = await ctx.db.connect()
        try {
          await client.query("begin")
          await persistRejections(client, run, rejections)
          for (let index = 0; index < prepared.ready.length; index += APPLY_BATCH) {
            const part = await writer.apply(writeContext, client, prepared.ready.slice(index, index + APPLY_BATCH))
            await persistLineage(client, run, part.lineage)
            part.lineage = []
            mergeApply(total, part)
          }
          if (total.warnings.length) await persistRejections(client, run, total.warnings)
          await client.query(`update data_feeds set checkpoint = $2 where id = $1`, [feed.id, JSON.stringify(checkpoint)])
          await client.query(
            `update data_ingestion_runs set records_received = $2, records_parsed = $3, records_valid = $4, records_rejected = $5, records_inserted = $6, records_updated = $7,
               records_unchanged = $8, error_count = $9, warning_count = $10, checkpoint_after = $11 where id = $1`,
            [run.id, metrics.recordsReceived, metrics.recordsParsed, metrics.recordsValid + prepared.ready.length, metrics.recordsRejected, metrics.recordsInserted + total.inserted, metrics.recordsUpdated + total.updated, metrics.recordsUnchanged + total.unchanged, metrics.errorCount, metrics.warningCount + total.warnings.length, JSON.stringify(checkpoint)],
          )
          await client.query("commit")
        } catch (error) {
          await client.query("rollback").catch(() => {})
          // Nada da página ficou gravado: as contagens dela saem do total em memória.
          metrics.recordsReceived -= rows.length
          metrics.recordsParsed -= rows.length
          metrics.recordsRejected -= rejectedRecords
          metrics.errorCount -= rejections.length
          throw error
        } finally {
          client.release()
        }
        metrics.recordsValid += prepared.ready.length
        metrics.recordsInserted += total.inserted
        metrics.recordsUpdated += total.updated
        metrics.recordsUnchanged += total.unchanged
        metrics.recordsDeactivated += total.deactivated
        metrics.warningCount += total.warnings.length
        if (total.businessMaxEventTime && (!metrics.businessMaxEventTime || total.businessMaxEventTime > metrics.businessMaxEventTime)) metrics.businessMaxEventTime = total.businessMaxEventTime
        lastCheckpoint = checkpoint
      })
      return result
    },
    config.object,
  )

  // Conteúdo bruto retido (reprocessamento com outro mapeamento), dentro do limite.
  if (!rawOverflow && rawChunks.length > 0) {
    const raw = await ctx.rawObjects.put({ organizationId: run.organizationId, sourceId: source.id, feedId: feed.id, filename: `${config.object.schema}.${config.object.name}.json`, contentType: "application/json", content: new TextEncoder().encode(`[${rawChunks.join(",")}]`) })
    await ctx.db.query(`update data_ingestion_runs set raw_object_id = $2 where id = $1`, [run.id, raw.id])
  }
  metrics.bytes = rawBytes
  const summary = [
    `${outcome.pages} página(s), ${outcome.read} linha(s) lida(s)`,
    outcome.reachedEnd ? (config.sync.mode === "INCREMENTAL" ? "em dia com a origem" : "leitura completa concluída") : `limite de ${config.maxRowsPerRun} linhas por carga — a próxima carga continua do ponto aplicado`,
    rawOverflow ? "conteúdo bruto não retido (acima de 32 MB)" : null,
  ].filter(Boolean)
  box.stages = closeStages(box.stages, summary.join(" · "))
  if (!outcome.reachedEnd && lastCheckpoint === null) {
    throw new DataRunError("DATA_INTERNAL_ERROR", "A leitura não avançou nenhuma página.")
  }
  const status = metrics.recordsRejected > 0 ? "PARTIAL" : "COMPLETED"
  await finishRun(ctx, loaded, status, box.stages, metrics, null, undefined)
}
