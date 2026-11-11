import { describe, expect, it } from "vitest"
import { purgeOldOccurrences } from "./pg-error-occurrence-store.js"

/** Banco falso: `expired` linhas vencidas; cada DELETE apaga até o `limit` ($2) pedido. */
function fakeDb(expired: number) {
  let remaining = expired
  let calls = 0
  return {
    calls: () => calls,
    remaining: () => remaining,
    db: {
      query: async (_sql: string, params?: unknown[]) => {
        calls += 1
        const limit = Number(params?.[1])
        const deleted = Math.min(limit, remaining)
        remaining -= deleted
        return { rows: [], rowCount: deleted }
      },
    } as unknown as Parameters<typeof purgeOldOccurrences>[0],
  }
}

describe("retenção das ocorrências de erro (run-3 C05)", () => {
  it("apaga em lotes até esgotar o vencido, não só um lote por rodada", async () => {
    const fake = fakeDb(12_201)
    const deleted = await purgeOldOccurrences(fake.db, 30)
    expect(deleted).toBe(12_201)
    expect(fake.remaining()).toBe(0)
    expect(fake.calls()).toBe(3)
  })

  it("respeita o orçamento de lotes da rodada (o resto fica para a próxima)", async () => {
    const fake = fakeDb(50)
    const deleted = await purgeOldOccurrences(fake.db, 30, { batchSize: 10, maxBatches: 2 })
    expect(deleted).toBe(20)
    expect(fake.remaining()).toBe(30)
  })

  it("para no primeiro lote incompleto", async () => {
    const fake = fakeDb(0)
    expect(await purgeOldOccurrences(fake.db, 30)).toBe(0)
    expect(fake.calls()).toBe(1)
  })
})
