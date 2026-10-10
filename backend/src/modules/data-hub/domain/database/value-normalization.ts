import type { DatabaseColumn } from "./column-types.js"

/**
 * Valor de banco externo → valor de registro da Central (JSON-safe), igual para amostra, prévia, carga e
 * reprocessamento. Regras:
 *  - DATE → "AAAA-MM-DD"; DATETIME (sem fuso) → "AAAA-MM-DDTHH:mm:ss[.fff]" sem fuso — quem interpreta é o
 *    mapeamento, no fuso da organização (como num CSV); DATETIME_TZ → ISO com "Z"/offset (instante exato);
 *  - decimais e inteiros grandes chegam como texto (sem perder precisão); o contrato converte;
 *  - binários nunca são importados (null);
 *  - JSON continua objeto (o mapeamento aceita caminho `a.b`).
 * Os adaptadores entregam datas como texto do próprio banco (PostgreSQL/MySQL/MariaDB) ou `Date` em UTC
 * (SQL Server com `useUTC`) — os dois caminhos chegam ao mesmo formato aqui.
 */
const pad = (value: number, size = 2) => String(value).padStart(size, "0")

function fraction(text: string | undefined): string {
  if (!text) return ""
  const digits = text.replace(".", "").slice(0, 3)
  return digits.length ? `.${digits.padEnd(3, "0")}` : ""
}

const DATETIME_TEXT = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/

function normalizeOffset(offset: string): string {
  if (offset === "Z") return "Z"
  const match = /^([+-]\d{2}):?(\d{2})?$/.exec(offset)
  return match ? `${match[1]}:${match[2] ?? "00"}` : offset
}

function dateFromUtcParts(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function timeFromUtcParts(date: Date): string {
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}${date.getUTCMilliseconds() ? `.${pad(date.getUTCMilliseconds(), 3)}` : ""}`
}

export function normalizeDatabaseValue(value: unknown, column: Pick<DatabaseColumn, "category">): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === "bigint") return value.toString()
  if (value instanceof Uint8Array) {
    // BIT(1) do MySQL/MariaDB chega como buffer de 1 byte.
    if (column.category === "BOOLEAN" && value.byteLength === 1) return value[0] !== 0
    return null
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    switch (column.category) {
      case "DATE":
        return dateFromUtcParts(value)
      case "DATETIME":
        return `${dateFromUtcParts(value)}T${timeFromUtcParts(value)}`
      case "TIME":
        return timeFromUtcParts(value)
      default:
        return value.toISOString()
    }
  }
  if (typeof value === "string") {
    switch (column.category) {
      case "DATE":
        return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value
      case "DATETIME": {
        const match = DATETIME_TEXT.exec(value.trim())
        if (!match) return value
        const [, date, time, frac, offset] = match
        const local = `${date}T${time!.length === 5 ? `${time}:00` : time}${fraction(frac)}`
        // Coluna "sem fuso" que ainda assim trouxe offset (raro) — preserva o instante.
        return offset ? `${local}${normalizeOffset(offset)}` : local
      }
      case "DATETIME_TZ": {
        const match = DATETIME_TEXT.exec(value.trim())
        if (!match) return value
        const [, date, time, frac, offset] = match
        // Sessão em UTC: TIMESTAMP do MySQL/MariaDB chega sem offset e é UTC.
        return `${date}T${time!.length === 5 ? `${time}:00` : time}${fraction(frac)}${normalizeOffset(offset ?? "Z")}`
      }
      default:
        return value
    }
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "boolean") return value
  if (typeof value === "object") return value
  return String(value)
}

export function normalizeDatabaseRow(row: Record<string, unknown>, columns: readonly DatabaseColumn[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const column of columns) out[column.name] = normalizeDatabaseValue(row[column.name], column)
  return out
}
