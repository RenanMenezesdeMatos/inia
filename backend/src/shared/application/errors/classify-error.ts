/**
 * Classificação de uma FALHA INESPERADA (a que chegaria ao 500 genérico) em código operacional do catálogo — sem mudar o status
 * HTTP (500), só o código: banco fora, banco lento, conexões esgotadas, prazo de dependência; o resto continua `INTERNAL_ERROR`.
 * E a sanitização do que vai para log/ocorrência: nada de segredo nem dado pessoal na mensagem técnica.
 */

export type ClassifiedFailure = { code: string; summary: SanitizedError }
export type SanitizedError = { name: string; message: string; code?: string; stack?: string[] }

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "57P01", "57P02", "57P03", "08000", "08001", "08003", "08006"])
const TIMEOUT_CODES = new Set(["57014", "ETIMEDOUT"])
const EXHAUSTED_CODES = new Set(["53300", "53400"])

type ErrorLike = { name?: unknown; message?: unknown; code?: unknown; severity?: unknown; stack?: unknown; cause?: unknown }

function asErrorLike(error: unknown): ErrorLike {
  return typeof error === "object" && error !== null ? (error as ErrorLike) : { message: String(error) }
}

/** Erro vindo do driver do PostgreSQL (`pg`): tem `severity` ou mensagem característica de conexão/pool. */
function looksLikeDatabase(candidate: ErrorLike, message: string): boolean {
  const stack = typeof candidate.stack === "string" ? candidate.stack : ""
  // Erro do servidor PostgreSQL (`severity`), mensagem do driver/pool, ou a pilha passando pelo driver (`pg`/`pg-pool`): este
  // último pega "connect ECONNREFUSED" do pool em qualquer porta (banco em outra máquina ou porta, repassador, pgbouncer).
  return typeof candidate.severity === "string" || /Connection terminated|connection timeout|timeout exceeded when trying to connect|Client has encountered a connection error|Query read timeout/i.test(message) || /[\\/]node_modules[\\/]pg(-pool)?[\\/]/.test(stack)
}

export function classifyUnexpectedError(error: unknown): ClassifiedFailure {
  const candidate = asErrorLike(error)
  const message = typeof candidate.message === "string" ? candidate.message : ""
  const code = typeof candidate.code === "string" ? candidate.code : undefined
  const summary = sanitizeError(error)
  if (code && EXHAUSTED_CODES.has(code)) return { code: "INIA-BANCO-CONEXOES-ESGOTADAS", summary }
  if ((code && TIMEOUT_CODES.has(code) && (code === "57014" || looksLikeDatabase(candidate, message))) || /timeout exceeded when trying to connect|Query read timeout|Connection terminated due to connection timeout/i.test(message)) return { code: "INIA-BANCO-TIMEOUT", summary }
  if ((code && CONNECTION_CODES.has(code) && (code.length === 5 || looksLikeDatabase(candidate, message) || /:5432\b|postgres/i.test(message))) || /Connection terminated|Client has encountered a connection error/i.test(message)) return { code: "INIA-BANCO-INDISPONIVEL", summary }
  if (candidate.name === "TimeoutError" || (candidate.name === "AbortError" && /timeout|time out|prazo/i.test(message))) return { code: "INIA-DEPENDENCIA-TIMEOUT", summary }
  return { code: "INTERNAL_ERROR", summary }
}

/**
 * Remove o que não pode sair do processo: e-mails, CPF/telefone (sequências longas de dígitos), tokens (Bearer, JWT, chaves
 * longas), senhas em URL de conexão e pares `senha=`/`key=`/`token=`. Também corta o tamanho.
 */
export function redactSensitive(text: string, max = 500): string {
  const redacted = text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^:/\s@]+):([^@\s]+)@/gi, "$1$2:***@")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "***jwt***")
    .replace(/\b(password|senha|secret|segredo|token|api[_-]?key|key|authorization|cookie)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, "$1$2***")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "***@***")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "***cpf***")
    .replace(/\b\d{8,}\b/g, "***num***")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "***chave***")
  return redacted.length > max ? `${redacted.slice(0, max - 1)}…` : redacted
}

export function sanitizeError(error: unknown): SanitizedError {
  const candidate = asErrorLike(error)
  const name = typeof candidate.name === "string" ? candidate.name.slice(0, 80) : typeof error === "object" ? "Error" : typeof error
  const message = redactSensitive(typeof candidate.message === "string" ? candidate.message : String(error))
  const code = typeof candidate.code === "string" ? candidate.code.slice(0, 40) : undefined
  // Só as primeiras linhas da pilha (arquivo:linha), sem a mensagem repetida — o suficiente para achar o ponto no código.
  const stack = typeof candidate.stack === "string" ? candidate.stack.split("\n").slice(1, 9).map((line) => redactSensitive(line.trim(), 200)) : undefined
  return { name, message, ...(code ? { code } : {}), ...(stack?.length ? { stack } : {}) }
}
