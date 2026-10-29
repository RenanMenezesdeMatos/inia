/**
 * PROVA contra o banco de teste real (achado C07 da 4ª auditoria): carga de API Push que estava NA FILA quando o feed ou a fonte
 * foram removidos nunca fica órfã ocupando as vagas da fila que todas as organizações dividem.
 *   INIA_DB_PROOF=1 npx vitest run orphan-runs-proof
 * Roda o ciclo real da fila (`processQueuedRuns`), que pega cargas de QUALQUER organização: recusa rodar se houver carga de outra
 * organização na fila. Organizações próprias, apagadas no fim.
 */
import express from "express"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import { createFeed, deleteFeed, setFeedStatus } from "../application/feed-service.js"
import { processQueuedRuns } from "../application/run-service.js"
import { createPushToken, createSource, deleteSource } from "../application/source-service.js"
import { createDataIngestionRouter } from "../presentation/data-ingestion-router.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG_A = "de00ee00-0000-4000-8000-00000000c071"
const ORG_B = "de00ee00-0000-4000-8000-00000000c072"
const ORGS = [ORG_A, ORG_B]
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
const mapping = { fields: [{ target: "externalInteractionId", source: "id", transforms: [] }, { target: "flagName", source: "flag", transforms: [] }, { target: "value", source: "value", transforms: [] }] }
// Relógio antigo: as cargas da prova são sempre as mais antigas da fila (o ciclo pega as 5 mais antigas).
let clockMs = Date.parse("2001-01-01T00:00:00.000Z")

let pool: pg.Pool
let ctx: DataHubContext
let app: express.Express

async function cleanup() {
  await pool.query(`delete from audit_logs where organization_id = any($1::uuid[])`, [ORGS])
  await pool.query(`delete from data_sources where organization_id = any($1::uuid[])`, [ORGS])
  await pool.query(`delete from data_raw_objects where organization_id = any($1::uuid[])`, [ORGS])
  await pool.query(`delete from organizations where id = any($1::uuid[])`, [ORGS])
}

async function setupPush(org: string, key: string) {
  const source = await createSource(ctx, org, null, { name: `C07 push ${key}`, config: { kind: "API_PUSH" } })
  const feed = await createFeed(ctx, org, null, source.id, { feedKey: key, name: `C07 ${key}`, contractKey: "INTERACTION_FLAGS", connectorConfig: { connector: "API_PUSH" }, mapping })
  await setFeedStatus(ctx, org, null, feed.id, "ACTIVATE")
  const { token } = await createPushToken(ctx, org, null, source.id, { label: "C07 token" })
  return { sourceId: source.id, publicId: (source as unknown as { publicId: string }).publicId, feedId: feed.id, token, key }
}

async function push(target: Awaited<ReturnType<typeof setupPush>>): Promise<string> {
  clockMs += 10
  const response = await request(app).post(`/api/v1/data-ingestion/${target.publicId}/${target.key}`).set("authorization", `Bearer ${target.token}`).set("content-type", "application/json").send({ records: [] })
  expect(response.status).toBe(202)
  return response.body.data.runId as string
}

async function runs(ids: string[]): Promise<Record<string, { status: string; errorCode: string | null }>> {
  const result = await pool.query<{ id: string; status: string; error_code: string | null }>(`select id, status, error_code from data_ingestion_runs where id = any($1::uuid[])`, [ids])
  return Object.fromEntries(result.rows.map((row) => [row.id, { status: row.status, errorCode: row.error_code }]))
}

async function tick() {
  const foreign = await pool.query<{ n: number }>(`select count(*)::int n from data_ingestion_runs where status = 'QUEUED' and not (organization_id = any($1::uuid[]))`, [ORGS])
  if (foreign.rows[0]!.n > 0) throw new Error(`Há ${foreign.rows[0]!.n} carga(s) de outra organização na fila: a prova não processa a fila compartilhada.`)
  await processQueuedRuns(ctx)
}

describe.skipIf(!ENABLED)("Central de Dados — cargas órfãs na fila (C07)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 3 })
    await cleanup()
    for (const id of ORGS) await pool.query(`insert into organizations (id, name, slug) values ($1, $2, $3)`, [id, `C07 ${id.slice(-1)}`, `c07-${id.slice(-4)}`])
    const overrides = { logger: silent, clock: { now: () => new Date(clockMs) }, wakeWorker: () => undefined }
    ctx = createDataHubContext(pool as unknown as Database, overrides)
    app = express()
    app.use("/api/v1/data-ingestion", createDataIngestionRouter(pool as unknown as Database, overrides))
    app.use((error: Error, _request: express.Request, response: express.Response, next: express.NextFunction) => {
      void next
      response.status(error instanceof DomainError ? error.statusCode : 500).json({ error: { code: (error as DomainError).code ?? String(error) } })
    })
  }, 60_000)

  afterAll(async () => {
    if (!pool) return
    await cleanup()
    await pool.end()
  })

  it("remover o feed encerra na hora as 6 cargas da fila; a carga da outra organização segue no próximo ciclo", async () => {
    const a = await setupPush(ORG_A, "c07-flags-a")
    const b = await setupPush(ORG_B, "c07-flags-b")
    const queuedA: string[] = []
    for (let index = 0; index < 6; index += 1) queuedA.push(await push(a))
    await deleteFeed(ctx, ORG_A, null, a.feedId)
    clockMs += 1000
    const runB = await push(b)
    expect(Object.values(await runs(queuedA))).toEqual(Array(6).fill({ status: "CANCELLED", errorCode: "DATA_FEED_INACTIVE" }))
    await tick()
    expect((await runs([runB]))[runB]!.status).toBe("COMPLETED")
    const audit = await pool.query<{ payload: { cancelledQueuedRuns?: number } }>(`select payload from audit_logs where organization_id = $1 and action = 'DATA_HUB_FEED_DELETED' and entity_id = $2`, [ORG_A, a.feedId])
    expect(audit.rows[0]?.payload.cancelledQueuedRuns).toBe(6)
  })

  it("órfã de antes da correção (feed removido sem encerrar a fila): o ciclo encerra ao encontrá-la e a outra organização passa", async () => {
    const a = await setupPush(ORG_A, "c07-legacy-a")
    const b = await setupPush(ORG_B, "c07-legacy-b")
    const queuedA: string[] = []
    for (let index = 0; index < 6; index += 1) queuedA.push(await push(a))
    // O estado que a remoção antiga deixava: feed removido, cargas ainda QUEUED.
    await pool.query(`update data_feeds set deleted_at = now(), status = 'PAUSED' where id = $1`, [a.feedId])
    clockMs += 1000
    const runB = await push(b)
    await tick() // as 5 mais antigas: órfãs → encerradas
    await tick() // a 6ª órfã e a carga da organização B
    expect(Object.values(await runs(queuedA))).toEqual(Array(6).fill({ status: "CANCELLED", errorCode: "DATA_FEED_INACTIVE" }))
    expect((await runs([runB]))[runB]!.status).toBe("COMPLETED")
  })

  it("remover a fonte encerra as cargas da fila de todos os feeds dela, na mesma transação", async () => {
    const a = await setupPush(ORG_A, "c07-source-a")
    const queued = [await push(a), await push(a)]
    await deleteSource(ctx, ORG_A, null, a.sourceId)
    expect(Object.values(await runs(queued))).toEqual(Array(2).fill({ status: "CANCELLED", errorCode: "DATA_FEED_INACTIVE" }))
  })
})
