import type pg from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * TRANSAÇÃO DO BACKEND, num lugar só (substitui as cópias locais de `inTransaction`: eram 22, em 4 variantes, e duas delas
 * mascaravam o erro original — docs/dev/validacao-boas-praticas-2026-10-29.md, P-1).
 *
 *  - Recebe o pool → abre um cliente dedicado: `begin` → trabalho → `commit`. Falhou: `rollback` e o erro ORIGINAL sobe; se o
 *    próprio `rollback` falhar, o cliente é descartado (`release(erro)`) em vez de voltar ao pool no meio de uma transação.
 *  - Recebe um cliente que JÁ está numa transação (chamada de dentro de outra transação; provas contra o banco de teste) →
 *    savepoint: a transação continua de quem a abriu. Falhou: volta ao savepoint e o descarta (assim um savepoint de mesmo
 *    nome mais acima volta a ser o alvo de quem chamou) e o erro original sobe.
 *  - `isolation` vale só para a transação que o helper ABRE (com o pool): no meio de uma transação o PostgreSQL não muda o
 *    isolamento. `readOnly` vale nos dois casos: dentro de uma transação já aberta, o savepoint fica só-leitura e é DESFEITO no
 *    fim (só houve leitura), e a transação de quem chamou volta a aceitar escrita.
 */
export type TransactionSource = Database | pg.PoolClient

const DEFAULT_SAVEPOINT = "inia_tx"

export type TransactionOptions = {
  savepoint?: string
  /** Nível de isolamento da transação aberta pelo helper (padrão do banco: read committed). */
  isolation?: "repeatable read" | "serializable"
  /** Transação só de leitura (o banco recusa escrita dentro dela). */
  readOnly?: boolean
}

const SAVEPOINT_NAME = /^[a-z_][a-z0-9_]{0,62}$/

export async function inTransaction<T>(db: TransactionSource, work: (client: pg.PoolClient) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
  const savepoint = options.savepoint ?? DEFAULT_SAVEPOINT
  // O nome entra no SQL: só identificador simples (erro de programação, nunca dado de usuário).
  if (!SAVEPOINT_NAME.test(savepoint)) throw new Error(`Nome de savepoint inválido: ${savepoint}`)
  if (isTransactionClient(db)) {
    await db.query(`savepoint ${savepoint}`)
    try {
      if (options.readOnly) await db.query("set local transaction_read_only = on")
      const result = await work(db)
      if (options.readOnly) await db.query(`rollback to savepoint ${savepoint}`)
      await db.query(`release savepoint ${savepoint}`)
      return result
    } catch (error) {
      await db
        .query(`rollback to savepoint ${savepoint}`)
        .then(() => db.query(`release savepoint ${savepoint}`))
        .catch(() => undefined)
      throw error
    }
  }
  const client = await db.connect()
  let broken: Error | undefined
  try {
    await client.query(beginStatement(options))
    const result = await work(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback").catch((rollbackError: unknown) => {
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError))
    })
    throw error
  } finally {
    if (broken) client.release(broken)
    else client.release()
  }
}

/** O mesmo `inTransaction` com o nome de savepoint do módulo fixado (os comandos SQL de cada módulo continuam os mesmos). */
export function transactionRunner(savepoint: string): <T>(db: TransactionSource, work: (client: pg.PoolClient) => Promise<T>) => Promise<T> {
  return (db, work) => inTransaction(db, work, { savepoint })
}

function beginStatement(options: TransactionOptions): string {
  return ["begin", options.isolation ? `isolation level ${options.isolation}` : null, options.readOnly ? "read only" : null].filter(Boolean).join(" ")
}

function isTransactionClient(db: TransactionSource): db is pg.PoolClient {
  return typeof (db as Partial<pg.PoolClient>).release === "function"
}
