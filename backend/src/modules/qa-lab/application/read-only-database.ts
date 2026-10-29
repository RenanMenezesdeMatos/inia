import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"

export class QaWriteBlockedError extends DomainError {
  constructor(sql: string) {
    super(
      `Escrita no banco bloqueada em ambiente de QA: "${sql.trim().slice(0, 80).replace(/\s+/g, " ")}…". A simulação nunca grava dados operacionais.`,
      "QA_WRITE_BLOCKED",
      500,
    )
  }
}

const WRITE_KEYWORDS = /^\s*(insert|update|delete|merge|truncate|alter|create|drop|grant|revoke|begin|commit|rollback|copy|lock|call|do|refresh|cluster|vacuum|analyze)\b/i

/** CTE de leitura (`with … select`) passa; CTE com escrita dentro (`with … insert`) não. */
function isReadOnlySql(sql: string): boolean {
  const trimmed = sql.trim()
  if (WRITE_KEYWORDS.test(trimmed)) return false
  if (/^\s*with\b/i.test(trimmed)) return !/\b(insert|update|delete|merge)\b/i.test(trimmed)
  return /^\s*(select|show|explain|values)\b/i.test(trimmed)
}

/**
 * Boundary fechada do QA Lab, aplicada no nível mais baixo possível: o motor de workflow, os
 * Agents e o Orchestrator recebem este `Database` durante uma simulação e conseguem LER tudo
 * (colaboradores, chamadas, medições, metas, bases de conhecimento) mas qualquer escrita lança
 * `QaWriteBlockedError` antes de sair pro Postgres. É o que garante que, mesmo que algum
 * executor futuro esqueça de passar pelo `WorkflowEffectSink`, uma simulação nunca cria
 * matrícula/alerta/feedback/medição real — e, por consequência, nunca acorda outro Workflow.
 * `connect()` também é bloqueado: quem abre transação é porque vai escrever.
 */
export function createReadOnlyDatabase(db: Database, options: { enforcedByDatabase?: boolean } = {}): Database {
  const query = ((sql: unknown, ...rest: unknown[]) => {
    const text = typeof sql === "string" ? sql : ((sql as { text?: string })?.text ?? "")
    if (!isReadOnlySql(text)) return Promise.reject(new QaWriteBlockedError(text))
    if (options.enforcedByDatabase) return queryInReadOnlyTransaction(db, sql, rest)
    return (db.query as (...args: unknown[]) => unknown)(sql, ...rest)
  }) as Database["query"]

  const connect = (() =>
    Promise.reject(new QaWriteBlockedError("connect() — transação"))) as unknown as Database["connect"]

  return { query, connect }
}

/**
 * O banco como SEGUNDA trava (`enforcedByDatabase`): a lista de palavras acima olha só o começo do comando, então um `select` que
 * grava por dentro (função que escreve, `nextval`) passaria. Cada leitura roda numa transação `read only` própria — o PostgreSQL
 * recusa qualquer escrita — e curta: nada fica aberto entre uma consulta e outra (nem durante uma chamada de IA, que o
 * `idle_in_transaction_session_timeout` derrubaria), e consultas em paralelo continuam em paralelo, cada uma na sua conexão.
 */
async function queryInReadOnlyTransaction(db: Database, sql: unknown, rest: unknown[]): Promise<unknown> {
  const client = await db.connect()
  let discard = false
  try {
    await client.query("begin transaction read only")
    const result = await (client.query as (...args: unknown[]) => Promise<unknown>)(sql, ...rest)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback").catch(() => {
      discard = true
    })
    throw error
  } finally {
    client.release(discard)
  }
}

export { isReadOnlySql }
