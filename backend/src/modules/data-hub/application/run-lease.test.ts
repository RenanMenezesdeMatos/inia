import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { RUN_LEASE_SECONDS } from "../domain/run-status.js"
import { createDataHubContext } from "./data-hub-context.js"
import type { RawObjectStore } from "./ports.js"
import { APPLY_BATCH, executeRun } from "./run-pipeline.js"
import { processQueuedRuns } from "./run-service.js"
import type { DomainWriter } from "./writers/domain-writer.js"

/**
 * Posse de um Run (`claimed_until`) com banco fake. (1) Arquivo/API/SFTP também renovam a posse — em cada etapa e depois de
 * cada lote aplicado, pelo pool e fora da transação do lote —: uma carga de mais de 15 min nunca volta para a fila ainda
 * rodando. (2) Rollback que falha (conexão caída) não troca o erro do lote no Run. (3) Runs reivindicados juntos só executam
 * se a posse ainda é do mesmo claim.
 */
const writer = vi.hoisted(() => ({ fail: null as Error | null, applied: [] as number[] }))

vi.mock("./writers/writer-registry.js", () => ({
  requireWriter: (): DomainWriter => ({
    contractKey: "INDICATOR_MEASUREMENTS",
    prepare: async (_context, records) => ({ ready: records, rejections: [] }),
    apply: async (_context, client, batch) => {
      await client.query("insert into fake_domain_rows", [batch.length])
      if (writer.fail) throw writer.fail
      writer.applied.push(batch.length)
      return { inserted: batch.length, updated: 0, unchanged: 0, deactivated: 0, lineage: [], warnings: [], businessMaxEventTime: null }
    },
  }),
}))
vi.mock("../domain/mapping.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../domain/mapping.js")>()),
  validateMapping: () => [],
  mapRecord: (_contract: unknown, _mapping: unknown, source: Record<string, unknown>) => ({ record: source, errors: [] }),
}))

const RUN = { id: "run-1", organizationId: "org-1", sourceId: "src-1", feedId: "feed-1", contractKey: "INDICATOR_MEASUREMENTS", contractVersion: 1, triggerKind: "FILE_UPLOAD", status: "QUEUED", stages: [], rawObjectId: "raw-1", attempts: 0, startedAt: null }
const FEED = { id: "feed-1", organizationId: "org-1", sourceId: "src-1", contractKey: "INDICATOR_MEASUREMENTS", status: "ACTIVE", cadence: { kind: "MANUAL" }, mapping: { fields: [] }, connectorConfig: { connector: "FILE_UPLOAD", file: { format: "CSV" } }, failOnAnyRejection: false, sourceNamespace: "fonte", checkpoint: null }
const SOURCE = { id: "src-1", organizationId: "org-1", kind: "FILE_UPLOAD", name: "Planilhas", publicId: "src-pub" }
const ROWS = 2 * APPLY_BATCH + 500

type Event = { on: "db" | "client"; sql: string; params: unknown[] }

function fakeContext(options: { rollbackFails?: boolean } = {}) {
  const events: Event[] = []
  const text = (sql: string) => sql.replace(/\s+/g, " ").trim()
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    events.push({ on: "db", sql: text(sql), params })
    if (sql.includes("from data_ingestion_runs r") && sql.includes("r.id = $1")) return { rows: [{ ...RUN }], rowCount: 1 }
    if (sql.includes("from data_feeds f")) return { rows: [{ ...FEED }], rowCount: 1 }
    if (sql.includes("from data_sources s")) return { rows: [{ ...SOURCE }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  })
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      events.push({ on: "client", sql: text(sql), params })
      if (sql === "rollback" && options.rollbackFails) throw new Error("Connection terminated unexpectedly")
      return { rows: [], rowCount: 0 }
    }),
    release: vi.fn(),
  }
  const db = { query, connect: vi.fn(async () => client) } as unknown as Database
  const csv = ["valor", ...Array.from({ length: ROWS }, (_, index) => String(index))].join("\n")
  const rawObjects = { get: async () => ({ meta: { id: "raw-1", filename: "medicoes.csv", contentType: "text/csv", byteSize: csv.length, checksumSha256: "x", createdAt: "", expiresAt: "" }, content: new TextEncoder().encode(csv) }) } as unknown as RawObjectStore
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return { ctx: createDataHubContext(db, { rawObjects, logger }), events, client, logger }
}

const renews = (event: Event) => event.sql.includes("claimed_until = case when claimed_until is null then null else now() + make_interval")

describe("Run de arquivo — posse renovada enquanto a carga avança", () => {
  it("cada etapa e cada lote aplicado renovam a posse, pelo pool, depois do commit do lote — nunca dentro da transação", async () => {
    writer.fail = null
    writer.applied = []
    const { ctx, events } = fakeContext()
    await executeRun(ctx, RUN.id)
    expect(writer.applied).toEqual([APPLY_BATCH, APPLY_BATCH, 500])
    const renewals = events.filter(renews)
    expect(renewals.every((event) => event.on === "db" && event.params.includes(RUN_LEASE_SECONDS))).toBe(true)
    expect(renewals.filter((event) => event.sql.startsWith("update data_ingestion_runs set records_inserted"))).toHaveLength(3)
    expect(renewals.filter((event) => event.sql.startsWith("update data_ingestion_runs set status = $2, stages = $3")).map((event) => event.params[1])).toEqual(["CONNECTING", "FETCHING", "PARSING", "MAPPING", "VALIDATING", "APPLYING"])
    expect(events.filter((event) => event.on === "client" && event.sql.includes("claimed_until"))).toEqual([])
    // Cada renovação de lote vem depois do commit daquele lote.
    const sequence = events.filter((event) => (event.on === "client" && (event.sql === "begin" || event.sql === "commit")) || (renews(event) && event.sql.startsWith("update data_ingestion_runs set records_inserted"))).map((event) => (event.on === "client" ? event.sql : "renova"))
    expect(sequence).toEqual(["begin", "commit", "renova", "begin", "commit", "renova", "begin", "commit", "renova"])
  })

  it("rollback que falha (conexão caída) não troca o erro do lote: o Run FALHOU com o motivo real", async () => {
    writer.fail = new Error("deadlock detected")
    writer.applied = []
    const { ctx, events, client } = fakeContext({ rollbackFails: true })
    await executeRun(ctx, RUN.id)
    writer.fail = null
    const finished = events.find((event) => event.on === "db" && event.sql.startsWith("update data_ingestion_runs set status = $2, stages = $3, finished_at"))!
    expect(finished.params[1]).toBe("FAILED")
    expect(finished.params[16]).toBe("deadlock detected")
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})

describe("processQueuedRuns — posse conferida antes de executar cada Run reivindicado", () => {
  it("Run cuja posse foi tomada por outro worker enquanto as anteriores rodavam não é executado de novo", async () => {
    const events: Event[] = []
    const tokens = new Map([["run-a", "2026-10-17T12:15:00.000001Z"], ["run-b", "2026-10-17T12:15:00.000002Z"]])
    const executed: string[] = []
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      events.push({ on: "db", sql, params })
      if (sql.includes("and status = 'QUEUED' and claimed_until = $2::timestamptz")) return { rows: [], rowCount: tokens.get(String(params[0])) === params[1] ? 1 : 0 }
      if (sql.includes("from data_ingestion_runs r") && sql.includes("r.id = $1")) {
        executed.push(String(params[0]))
        // Enquanto run-a roda, outro worker reivindica run-b (a posse dela venceu): o token muda.
        if (params[0] === "run-a") tokens.set("run-b", "2026-10-17T12:31:00.000000Z")
        return { rows: [], rowCount: 0 }
      }
      return { rows: [], rowCount: 0 }
    })
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("for update skip locked")) return { rows: [{ id: "run-a" }, { id: "run-b" }], rowCount: 2 }
        if (sql.includes("returning id")) return { rows: [...tokens.entries()].map(([id, token]) => ({ id, token })), rowCount: 2 }
        return { rows: [], rowCount: 0 }
      }),
      release: vi.fn(),
    }
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const ctx = createDataHubContext({ query, connect: vi.fn(async () => client) } as unknown as Database, { logger })
    expect(await processQueuedRuns(ctx)).toEqual({ processed: 1 })
    expect(executed).toEqual(["run-a"])
    expect(logger.warn).toHaveBeenCalledWith({ runId: "run-b" }, expect.stringContaining("skipped"))
    // A posse de run-b (agora do outro worker) não é apagada por este.
    expect(events.filter((event) => event.sql.includes("set claimed_until = null")).map((event) => event.params[0])).toEqual(["run-a"])
  })
})
