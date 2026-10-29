import type pg from "pg"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useBatchStatementTimeout, type Database } from "../../../infrastructure/database/pool.js"
import { APPLY_BATCH, applyInTransactions } from "./run-pipeline.js"
import { emptyApply, type ApplyResult } from "./writers/domain-writer.js"

vi.mock("../../../infrastructure/database/pool.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../infrastructure/database/pool.js")>()),
  useBatchStatementTimeout: vi.fn(async () => {}),
}))

/** Cliente dedicado falso: registra o primeiro comando de cada query; `fail` decide qual delas lança. */
function fakeDatabase(options: { failClient?: (sql: string) => boolean; failPool?: (sql: string) => boolean } = {}) {
  const clientCommands: string[] = []
  const release = vi.fn()
  const client = {
    query: vi.fn(async (sql: string) => {
      clientCommands.push(sql.trim().split(/\s+/)[0]!.toLowerCase())
      if (options.failClient?.(sql)) throw new Error(`falhou: ${sql}`)
      return { rows: [], rowCount: 0 }
    }),
    release,
  }
  const poolQuery = vi.fn(async (sql: string) => {
    if (options.failPool?.(sql)) throw new Error("conexão do pool caiu")
    return { rows: [], rowCount: 0 }
  })
  const db = { connect: async () => client, query: poolQuery } as unknown as Database
  return { db, clientCommands, release, poolQuery }
}

/** Devolvido ao pool para reúso (sem erro): `release()` e `release(undefined)` são o mesmo para o pg. */
function expectReturnedToPool(release: ReturnType<typeof vi.fn>) {
  expect(release).toHaveBeenCalledTimes(1)
  expect(release.mock.calls[0]?.[0]).toBeUndefined()
}

const applied = (inserted: number): ApplyResult => ({ ...emptyApply(), inserted })
const records = (count: number) => Array.from({ length: count }, (_, index) => index)

afterEach(() => vi.mocked(useBatchStatementTimeout).mockReset())

describe("applyInTransactions — APPLYING da Central de Dados", () => {
  it("lotes parciais: uma transação por lote, contagem gravada no Run a cada lote, cliente devolvido limpo", async () => {
    const { db, clientCommands, release, poolQuery } = fakeDatabase()
    const total = await applyInTransactions(db, "run-1", records(APPLY_BATCH + 1), false, async (_client, chunk) => applied(chunk.length))

    expect(total.inserted).toBe(APPLY_BATCH + 1)
    expect(clientCommands).toEqual(["begin", "commit", "begin", "commit"])
    expect(poolQuery).toHaveBeenCalledTimes(2)
    expectReturnedToPool(release)
  })

  it("atômico: falha ao gravar a contagem depois de um lote desfaz a transação ANTES de devolver o cliente ao pool", async () => {
    const { db, clientCommands, release } = fakeDatabase({ failPool: (sql) => sql.includes("update data_ingestion_runs") })
    await expect(applyInTransactions(db, "run-1", records(APPLY_BATCH + 1), true, async (_client, chunk) => applied(chunk.length))).rejects.toThrow("conexão do pool caiu")

    expect(clientCommands).toEqual(["begin", "rollback"])
    expectReturnedToPool(release)
  })

  it("falha logo depois do begin (limite de comando do lote) também desfaz a transação", async () => {
    vi.mocked(useBatchStatementTimeout).mockRejectedValueOnce(new Error("statement timeout"))
    const { db, clientCommands, release } = fakeDatabase()
    const applyChunk = vi.fn(async () => applied(1))
    await expect(applyInTransactions(db, "run-1", records(3), false, applyChunk)).rejects.toThrow("statement timeout")

    expect(applyChunk).not.toHaveBeenCalled()
    expect(clientCommands).toEqual(["begin", "rollback"])
    expectReturnedToPool(release)
  })

  it("erro do lote continua sendo o erro devolvido; se nem o rollback passa, o cliente é descartado do pool", async () => {
    const { db, release } = fakeDatabase({ failClient: (sql) => sql === "rollback" })
    await expect(applyInTransactions(db, "run-1", records(2), true, async () => {
      throw new Error("chave duplicada no lote")
    })).rejects.toThrow("chave duplicada no lote")

    const [discarded] = release.mock.calls[0] as [Error | undefined]
    expect(discarded).toBeInstanceOf(Error)
    expect(discarded?.message).toBe("falhou: rollback")
  })

  it("lote recebe o cliente da transação, nunca o pool", async () => {
    const { db } = fakeDatabase()
    const seen: unknown[] = []
    await applyInTransactions(db, "run-1", records(1), true, async (client: pg.PoolClient) => {
      seen.push(client)
      return applied(1)
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toBe(db)
  })
})
