import type pg from "pg"
import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { inTransaction, transactionRunner } from "./transaction.js"

/** Cliente falso: registra cada comando; `fail` decide qual lança. Com `release` = um cliente já em transação. */
function fakeClient(fail: (sql: string) => boolean = () => false) {
  const commands: string[] = []
  const client = {
    query: vi.fn(async (sql: string) => {
      commands.push(sql)
      if (fail(sql)) throw new Error(`falhou: ${sql}`)
      return { rows: [], rowCount: 0 }
    }),
    release: vi.fn(),
  }
  return { client, commands, asClient: client as unknown as pg.PoolClient }
}

function fakePool(fail?: (sql: string) => boolean) {
  const dedicated = fakeClient(fail)
  const connect = vi.fn(async () => dedicated.client)
  return { ...dedicated, connect, db: { connect, query: vi.fn() } as unknown as Database }
}

describe("inTransaction — transação única do backend", () => {
  it("pool: begin → trabalho no cliente dedicado → commit; cliente devolvido ao pool sem erro", async () => {
    const { db, commands, client } = fakePool()
    const result = await inTransaction(db, async (tx) => {
      await tx.query("insert into t values (1)")
      return "ok"
    })
    expect(result).toBe("ok")
    expect(commands).toEqual(["begin", "insert into t values (1)", "commit"])
    expect(client.release).toHaveBeenCalledTimes(1)
    expect(client.release).toHaveBeenCalledWith()
  })

  it("pool: erro no trabalho → rollback e o erro original sobe", async () => {
    const { db, commands, client } = fakePool()
    await expect(inTransaction(db, async () => {
      throw new Error("regra de negócio")
    })).rejects.toThrow("regra de negócio")
    expect(commands).toEqual(["begin", "rollback"])
    expect(client.release).toHaveBeenCalledWith()
  })

  it("pool: rollback que falha não mascara o erro original e o cliente é descartado do pool", async () => {
    const { db, client } = fakePool((sql) => sql === "rollback")
    await expect(inTransaction(db, async () => {
      throw new Error("regra de negócio")
    })).rejects.toThrow("regra de negócio")
    expect(client.release).toHaveBeenCalledTimes(1)
    expect((client.release.mock.calls[0] as unknown[])[0]).toEqual(new Error("falhou: rollback"))
  })

  it("pool: falha no commit → rollback e o erro do commit sobe", async () => {
    const { db, commands } = fakePool((sql) => sql === "commit")
    await expect(inTransaction(db, async () => "ok")).rejects.toThrow("falhou: commit")
    expect(commands).toEqual(["begin", "commit", "rollback"])
  })

  it("cliente já em transação: savepoint com o nome do módulo, sem begin/commit e sem devolver o cliente", async () => {
    const { asClient, commands, client } = fakeClient()
    const run = transactionRunner("feedback_rating")
    const seen: unknown[] = []
    await run(asClient, async (tx) => {
      seen.push(tx)
      await tx.query("update t set x = 1")
    })
    expect(seen).toEqual([asClient])
    expect(commands).toEqual(["savepoint feedback_rating", "update t set x = 1", "release savepoint feedback_rating"])
    expect(client.release).not.toHaveBeenCalled()
  })

  it("cliente já em transação: erro → volta ao savepoint, descarta-o e o erro original sobe", async () => {
    const { asClient, commands } = fakeClient()
    await expect(inTransaction(asClient, async () => {
      throw new Error("regra de negócio")
    }, { savepoint: "inia_scenes" })).rejects.toThrow("regra de negócio")
    expect(commands).toEqual(["savepoint inia_scenes", "rollback to savepoint inia_scenes", "release savepoint inia_scenes"])
  })

  it("savepoints de mesmo nome aninhados: o de dentro é descartado depois do erro, e o release seguinte volta a ser o do de fora", async () => {
    const { asClient, commands } = fakeClient()
    await inTransaction(asClient, async (outer) => {
      await outer.query("insert fora")
      await inTransaction(outer, async () => {
        throw new Error("de dentro")
      }).catch(() => undefined)
      await outer.query("insert depois")
    })
    expect(commands).toEqual([
      "savepoint inia_tx",
      "insert fora",
      "savepoint inia_tx",
      "rollback to savepoint inia_tx",
      "release savepoint inia_tx",
      "insert depois",
      "release savepoint inia_tx",
    ])
  })

  it("nome de savepoint que não é identificador simples é recusado antes de qualquer comando", async () => {
    const { db, connect } = fakePool()
    await expect(inTransaction(db, async () => "ok", { savepoint: "x; drop table t" })).rejects.toThrow("Nome de savepoint inválido")
    expect(connect).not.toHaveBeenCalled()
  })
})
