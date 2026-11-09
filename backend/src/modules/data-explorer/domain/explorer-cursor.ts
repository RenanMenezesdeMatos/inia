import { createHash } from "node:crypto"
import { explorerErrors } from "./explorer-errors.js"
import type { ExplorerColumn, ExplorerDataset } from "./explorer-catalog-types.js"
import type { ExplorerQuery } from "./explorer-query.js"

/**
 * POSIÇÃO DA PÁGINA (keyset): valor da coluna de ordenação + chave do último registro, em texto, sem perder microssegundos nem casas decimais.
 * Não precisa de segredo: os valores só viram parâmetros, e o `where` da organização e dos filtros continua valendo. A impressão digital evita
 * reaproveitar a posição em outra ordenação, onde ela não teria significado.
 */
export type ExplorerCursor = { sort: string | null; key: string }

const fingerprint = (dataset: ExplorerDataset, column: ExplorerColumn, direction: string) => createHash("sha256").update(`${dataset.code}|${column.key}|${direction}`).digest("base64url").slice(0, 16)

export function encodeExplorerCursor(query: ExplorerQuery, position: ExplorerCursor): string {
  return Buffer.from(JSON.stringify({ f: fingerprint(query.dataset, query.sort.column, query.sort.direction), s: position.sort, k: position.key }), "utf8").toString("base64url")
}

const SORT_PATTERN: Record<ExplorerColumn["type"], RegExp> = {
  TEXT: /^[\s\S]{0,4000}$/,
  ENUM: /^[\s\S]{0,4000}$/,
  MONTH: /^\d{4}-\d{2}$/,
  NUMBER: /^-?\d{1,40}(\.\d{1,40})?$/,
  DATE: /^\d{4}-\d{2}-\d{2}$/,
  // O texto que o próprio banco produz na sessão em UTC.
  DATETIME: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00$/,
  TIME: /^\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/,
  BOOLEAN: /^(true|false)$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
}
const KEY_PATTERN = { uuid: SORT_PATTERN.UUID, bigint: /^\d{1,19}$/ } as const
const MAX_BIGINT = 9_223_372_036_854_775_807n

/** O formato não basta: "2026-99-99" passa na expressão e o banco recusaria. A posição forjada precisa ser recusada aqui, como erro do pedido. */
function isRealCalendarDate(year: string, month: string, day: string): boolean {
  const date = new Date(Date.UTC(2000, Number(month) - 1, Number(day)))
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day))
  return Number(year) >= 1 && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)
}

function isMeaningfulSort(type: ExplorerColumn["type"], value: string): boolean {
  if (type === "DATE" || type === "DATETIME") {
    const [year = "", month = "", day = ""] = value.slice(0, 10).split("-")
    if (!isRealCalendarDate(year, month, day)) return false
    if (type === "DATE") return true
    const [hours = 0, minutes = 0, seconds = 0] = value.slice(11, 19).split(":").map(Number)
    return hours < 24 && minutes < 60 && seconds < 60
  }
  if (type === "MONTH") {
    const month = Number(value.slice(5, 7))
    return month >= 1 && month <= 12
  }
  if (type === "TIME") {
    const [hours = 0, minutes = 0, seconds = 0] = value.slice(0, 8).split(":").map(Number)
    return hours < 24 && minutes < 60 && seconds < 60
  }
  return true
}

export function decodeExplorerCursor(query: ExplorerQuery, raw: string): ExplorerCursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
  } catch {
    throw explorerErrors.invalidCursor()
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw explorerErrors.invalidCursor()
  const { f, s, k } = parsed as { f?: unknown; s?: unknown; k?: unknown }
  if (f !== fingerprint(query.dataset, query.sort.column, query.sort.direction)) throw explorerErrors.invalidCursor()
  if (typeof k !== "string" || !KEY_PATTERN[query.dataset.key.cast].test(k)) throw explorerErrors.invalidCursor()
  if (query.dataset.key.cast === "bigint" && BigInt(k) > MAX_BIGINT) throw explorerErrors.invalidCursor()
  if (s === null) {
    if (!query.sort.column.nullable) throw explorerErrors.invalidCursor()
    return { sort: null, key: k }
  }
  // eslint-disable-next-line no-control-regex -- byte nulo seria recusado pelo banco como erro interno
  if (typeof s !== "string" || !SORT_PATTERN[query.sort.column.type].test(s) || /\u0000/.test(s) || !isMeaningfulSort(query.sort.column.type, s)) throw explorerErrors.invalidCursor()
  return { sort: s, key: k }
}
