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
export function createReadOnlyDatabase(db: Database): Database {
  const query = ((sql: unknown, ...rest: unknown[]) => {
    const text = typeof sql === "string" ? sql : ((sql as { text?: string })?.text ?? "")
    if (!isReadOnlySql(text)) return Promise.reject(new QaWriteBlockedError(text))
    return (db.query as (...args: unknown[]) => unknown)(sql, ...rest)
  }) as Database["query"]

  const connect = (() =>
    Promise.reject(new QaWriteBlockedError("connect() — transação"))) as unknown as Database["connect"]

  return { query, connect }
}

export { isReadOnlySql }
