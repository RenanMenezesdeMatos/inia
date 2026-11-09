/**
 * PROVA contra o banco de teste real: novas tentativas da carga quando a origem fica indisponível (trava ou timeout no banco do
 * cliente, por exemplo) e a separação entre esse limite e o de quedas do processo.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run run-retry-proof
 * Cada tentativa roda direto (`executeRun`), sem processar a fila compartilhada. Organização própria, apagada no fim.
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import { createFeed, setFeedStatus } from "../application/feed-service.js"
import { findRun, findSource, type DataFeedRow, type DataRunRow } from "../application/records.js"
import { executeRun } from "../application/run-pipeline.js"
import { enqueueRun, recoverInterruptedRuns, requestManualSync } from "../application/run-service.js"
import { createSource, setSourceStatus } from "../application/source-service.js"
import { json, MockHttpClient } from "./fakes.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "de00ee00-0000-4000-8000-00000000c081"
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
const mapping = { fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }, { target: "indicatorCode", source: "indicador", transforms: [] }, { target: "date", source: "dia", transforms: [] }, { target: "value", source: "valor", transforms: [] }] }

let pool: pg.Pool
let ctx: DataHubContext
let http: MockHttpClient
/** Como a origem responde agora. */
let origin: "DOWN" | "UP" | "AUTH_REFUSED" = "DOWN"
/** Acontece enquanto a tentativa está em andamento, antes de a origem responder. */
let duringRequest: (() => Promise<unknown>) | null = null

async function cleanup() {
  await pool.query(`delete from audit_logs where organization_id = $1`, [ORG])
  await pool.query(`delete from data_sources where organization_id = $1`, [ORG])
  await pool.query(`delete from data_raw_objects where organization_id = $1`, [ORG])
  await pool.query(`delete from organizations where id = $1`, [ORG])
}

async function setupFeed(key: string): Promise<DataFeedRow> {
  const source = await createSource(ctx, ORG, null, { name: `Retry ${key}`, config: { kind: "API_PULL", api: { baseUrl: "https://api.retry.local", auth: { kind: "NONE" }, headers: {}, timeoutMs: 5000 } } })
  await setSourceStatus(ctx, ORG, null, source.id, "ACTIVATE")
  const feed = await createFeed(ctx, ORG, null, source.id, {
    feedKey: key,
    name: `Retry ${key}`,
    contractKey: "INDICATOR_MEASUREMENTS",
    cadence: { kind: "DAILY", time: "07:00" },
    connectorConfig: { connector: "API_PULL", api: { endpoint: "/medicoes", extractPath: "data", pagination: { kind: "NONE" }, checkpoint: { kind: "NONE" } } },
    mapping,
  })
  return setFeedStatus(ctx, ORG, null, feed.id, "ACTIVATE")
}

const scheduled = async (feed: DataFeedRow) => (await enqueueRun(ctx, { organizationId: ORG, feed, triggerKind: "SCHEDULE", requestedBy: null })).run
const attempt = async (runId: string): Promise<DataRunRow> => (await executeRun(ctx, runId))!
const healthOf = async (sourceId: string) => (await findSource(pool as unknown as Database, ORG, sourceId))!.connectionHealth

/** Segundos até a próxima tentativa (negativo = já venceu). */
async function secondsToNextAttempt(runId: string): Promise<number> {
  const result = await pool.query<{ seconds: number }>(`select extract(epoch from next_attempt_at - now())::float8 seconds from data_ingestion_runs where id = $1`, [runId])
  return result.rows[0]!.seconds
}

/** O processo morreu durante esta tentativa: estado "em andamento" com a posse vencida. */
async function crash(runId: string) {
  await pool.query(`update data_ingestion_runs set status = 'APPLYING', claimed_until = now() - interval '1 minute' where id = $1`, [runId])
  const foreign = await pool.query<{ n: number }>(`select count(*)::int n from data_ingestion_runs where status in ('CONNECTING','FETCHING','PARSING','MAPPING','VALIDATING','APPLYING') and claimed_until < now() and organization_id <> $1`, [ORG])
  if (foreign.rows[0]!.n > 0) throw new Error(`Há ${foreign.rows[0]!.n} carga(s) interrompida(s) de outra organização: a prova não mexe nelas.`)
  await recoverInterruptedRuns(ctx)
  return (await findRun(pool as unknown as Database, ORG, runId))!
}

describe.skipIf(!ENABLED)("Central de Dados — novas tentativas da carga", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 3 })
    await cleanup()
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'Retry', 'retry-c081')`, [ORG])
    http = new MockHttpClient().on("/medicoes", async () => {
      await duringRequest?.()
      return origin === "UP" ? json(200, { data: [] }) : origin === "AUTH_REFUSED" ? json(401, {}) : json(503, {})
    })
    ctx = createDataHubContext(pool as unknown as Database, { logger: silent, http })
  }, 60_000)

  afterAll(async () => {
    if (!pool) return
    await cleanup()
    await pool.end()
  })

  it("carga agendada: insiste 7 vezes com a espera crescente e só então falha; a conexão aparece com erro desde a primeira falha", async () => {
    origin = "DOWN"
    const feed = await setupFeed("retry-agendada")
    const run = await scheduled(feed)
    for (const [index, minutes] of [1, 5, 15, 30, 60, 60].entries()) {
      const result = await attempt(run.id)
      expect(result).toMatchObject({ status: "QUEUED", attempts: index + 1, errorCode: "DATA_SOURCE_UNREACHABLE" })
      const seconds = await secondsToNextAttempt(run.id)
      expect(seconds).toBeGreaterThan(minutes * 60 - 10)
      expect(seconds).toBeLessThanOrEqual(minutes * 60)
      expect(await healthOf(feed.sourceId)).toBe("ERROR")
    }
    expect(await attempt(run.id)).toMatchObject({ status: "FAILED", attempts: 7, errorCode: "DATA_SOURCE_UNREACHABLE" })
  })

  it("a origem volta no meio das tentativas: a carga termina e a conexão volta a ficar saudável", async () => {
    origin = "DOWN"
    const feed = await setupFeed("retry-volta")
    const run = await scheduled(feed)
    await attempt(run.id)
    await attempt(run.id)
    expect(await healthOf(feed.sourceId)).toBe("ERROR")
    origin = "UP"
    expect(await attempt(run.id)).toMatchObject({ status: "COMPLETED", attempts: 3, errorCode: null })
    expect(await findSource(pool as unknown as Database, ORG, feed.sourceId)).toMatchObject({ connectionHealth: "HEALTHY", connectionError: null })
  })

  it("Sincronizar agora durante a espera antecipa a mesma carga, em vez de recusar, e ela mantém as tentativas da agenda", async () => {
    origin = "DOWN"
    const feed = await setupFeed("retry-antecipa")
    const run = await scheduled(feed)
    await attempt(run.id)
    expect(await secondsToNextAttempt(run.id)).toBeGreaterThan(0)

    const anticipated = await requestManualSync(ctx, ORG, feed.id, null)
    expect(anticipated.id).toBe(run.id)
    expect(anticipated.triggerKind).toBe("SCHEDULE")
    expect(await secondsToNextAttempt(run.id)).toBeLessThanOrEqual(0)
    const inFlight = await pool.query(`select 1 from data_ingestion_runs where feed_id = $1`, [feed.id])
    expect(inFlight.rowCount).toBe(1)
    const audit = await pool.query<{ payload: { runId: string; anticipatedRetry?: boolean } }>(`select payload from audit_logs where organization_id = $1 and action = 'DATA_HUB_SYNC_REQUESTED' and entity_id = $2`, [ORG, feed.id])
    expect(audit.rows[0]?.payload).toEqual({ sourceId: feed.sourceId, name: feed.name, runId: run.id, anticipatedRetry: true })

    origin = "UP"
    expect(await attempt(run.id)).toMatchObject({ status: "COMPLETED", attempts: 2 })
  })

  it("Sincronizar agora sem carga esperando: nasce MANUAL, falha na 3ª tentativa, e um segundo pedido com a carga ainda na fila continua recusado", async () => {
    origin = "DOWN"
    const feed = await setupFeed("retry-manual")
    const run = await requestManualSync(ctx, ORG, feed.id, null)
    expect(run.triggerKind).toBe("MANUAL")
    await expect(requestManualSync(ctx, ORG, feed.id, null)).rejects.toMatchObject({ code: "DATA_RUN_ALREADY_QUEUED" })
    expect(await attempt(run.id)).toMatchObject({ status: "QUEUED", attempts: 1 })
    expect(await attempt(run.id)).toMatchObject({ status: "QUEUED", attempts: 2 })
    expect(await attempt(run.id)).toMatchObject({ status: "FAILED", attempts: 3 })
  })

  it("erro que não é transitório falha de vez, mesmo na carga agendada", async () => {
    origin = "AUTH_REFUSED"
    const feed = await setupFeed("retry-credencial")
    const run = await scheduled(feed)
    expect(await attempt(run.id)).toMatchObject({ status: "FAILED", attempts: 1, errorCode: "DATA_SOURCE_AUTH_FAILED" })
  })

  it("pausar o conjunto de dados encerra a carga que esperava, sem nova consulta à origem; Sincronizar agora depois cria uma carga nova", async () => {
    origin = "DOWN"
    const feed = await setupFeed("retry-pausa-conjunto")
    const run = await scheduled(feed)
    await attempt(run.id)
    const requests = http.requests.length

    await setFeedStatus(ctx, ORG, null, feed.id, "PAUSE")
    expect(await findRun(pool as unknown as Database, ORG, run.id)).toMatchObject({ status: "CANCELLED", errorCode: "DATA_FEED_INACTIVE" })
    const audit = await pool.query<{ payload: { cancelledQueuedRuns?: number } }>(`select payload from audit_logs where organization_id = $1 and action = 'DATA_HUB_FEED_PAUSED' and entity_id = $2`, [ORG, feed.id])
    expect(audit.rows[0]?.payload.cancelledQueuedRuns).toBe(1)
    await executeRun(ctx, run.id)
    expect(http.requests.length).toBe(requests)

    const manual = await requestManualSync(ctx, ORG, feed.id, null)
    expect(manual.id).not.toBe(run.id)
    expect(manual.triggerKind).toBe("MANUAL")
  })

  it("pausar a fonte encerra a carga que esperava em qualquer conjunto dela", async () => {
    origin = "DOWN"
    const feed = await setupFeed("retry-pausa-fonte")
    const run = await scheduled(feed)
    await attempt(run.id)
    await setSourceStatus(ctx, ORG, null, feed.sourceId, "PAUSE")
    expect(await findRun(pool as unknown as Database, ORG, run.id)).toMatchObject({ status: "CANCELLED", errorCode: "DATA_FEED_INACTIVE" })
  })

  it("pausar com a tentativa em andamento: quando ela falha, a carga não volta para a fila", async () => {
    origin = "DOWN"
    const feed = await setupFeed("retry-pausa-em-andamento")
    const run = await scheduled(feed)
    duringRequest = () => setFeedStatus(ctx, ORG, null, feed.id, "PAUSE")
    try {
      expect(await attempt(run.id)).toMatchObject({ status: "FAILED", attempts: 1, errorCode: "DATA_SOURCE_UNREACHABLE" })
    } finally {
      duringRequest = null
    }
  })

  it("pausar não mexe em carga ainda não tentada", async () => {
    origin = "UP"
    const feed = await setupFeed("retry-pausa-nao-tentada")
    const run = await scheduled(feed)
    await setFeedStatus(ctx, ORG, null, feed.id, "PAUSE")
    expect(await findRun(pool as unknown as Database, ORG, run.id)).toMatchObject({ status: "QUEUED", attempts: 0 })
  })

  it("quedas do processo têm limite próprio: tentativas gastas com a origem não contam, e a 3ª queda encerra a carga mesmo com tentativas sobrando", async () => {
    origin = "DOWN"
    const feed = await setupFeed("retry-queda")
    const run = await scheduled(feed)
    for (let index = 0; index < 4; index += 1) await attempt(run.id)

    expect(await crash(run.id)).toMatchObject({ status: "QUEUED", attempts: 4 })
    await attempt(run.id)
    expect(await crash(run.id)).toMatchObject({ status: "QUEUED", attempts: 5 })
    await attempt(run.id)
    expect(await crash(run.id)).toMatchObject({ status: "FAILED", attempts: 6, errorCode: "DATA_INTERNAL_ERROR" })
  })
})
