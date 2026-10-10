import { z } from "zod"
import type { ColumnCategory } from "./column-types.js"

/**
 * Como um conjunto de dados de um banco externo é lido (config NÃO secreta do feed):
 *  - objeto = tabela ou visão escolhida na descoberta (nunca SQL livre);
 *  - INCREMENTAL: campo de atualização (cursor) + chaves opcionais de desempate. Cada carga lê só o que vem DEPOIS
 *    da posição aplicada por último; a posição avança página a página, na MESMA transação que aplica a página.
 *  - FULL: releitura completa a cada carga (upsert idempotente → linhas iguais contam como "sem mudança"). Com
 *    chave, lê em páginas e retoma do meio após uma falha; sem chave, uma única consulta limitada.
 */
const columnName = z.string().min(1).max(128)

export const databaseObjectSchema = z.object({
  schema: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  kind: z.enum(["TABLE", "VIEW"]),
})

export const databaseSyncSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("FULL"), keyColumns: z.array(columnName).max(3).default([]) }),
  z.object({
    mode: z.literal("INCREMENTAL"),
    cursorColumn: columnName,
    keyColumns: z.array(columnName).max(3).default([]),
    /** Releitura de segurança (só campo de data/hora): reler N minutos antes da última posição a cada ciclo — pega linhas gravadas com atraso. */
    lookbackMinutes: z.number().int().min(0).max(7 * 24 * 60).default(0),
  }),
])
export type DatabaseSync = z.infer<typeof databaseSyncSchema>

export const DATABASE_BATCH_SIZE_DEFAULT = 1_000
export const DATABASE_MAX_ROWS_PER_RUN_DEFAULT = 50_000

export const databaseFeedConfigSchema = z.object({
  object: databaseObjectSchema,
  sync: databaseSyncSchema.default({ mode: "FULL", keyColumns: [] }),
  /** Linhas por página (cada página é aplicada e confirmada antes da próxima). */
  batchSize: z.number().int().min(100).max(10_000).default(DATABASE_BATCH_SIZE_DEFAULT),
  /** Linhas por carga; passou disso, a próxima carga continua sozinha do ponto aplicado. */
  maxRowsPerRun: z.number().int().min(1_000).max(1_000_000).default(DATABASE_MAX_ROWS_PER_RUN_DEFAULT),
})
export type DatabaseFeedConfig = z.infer<typeof databaseFeedConfigSchema>

/** Colunas de ordenação/posição: cursor primeiro, chaves depois (sem repetir). */
export function orderColumnsOf(sync: DatabaseSync): string[] {
  if (sync.mode === "FULL") return [...new Set(sync.keyColumns)]
  return [sync.cursorColumn, ...sync.keyColumns.filter((column) => column !== sync.cursorColumn)].filter((column, index, all) => all.indexOf(column) === index)
}

/** Checkpoint persistido em `data_feeds.checkpoint` (jsonb). */
export type DatabaseCheckpoint = {
  kind: "DATABASE"
  mode: DatabaseSync["mode"]
  /** A quais colunas a posição se refere — se a configuração mudar, a posição antiga não vale (recomeça). */
  orderColumns: string[]
  /** Texto exato de cada coluna de ordenação da última linha APLICADA; null = início. */
  position: string[] | null
  /** A última carga chegou ao fim da origem (FULL: varredura completa; INCREMENTAL: nada pendente). */
  reachedEnd: boolean
  updatedAt: string
}

export function readDatabaseCheckpoint(raw: unknown, sync: DatabaseSync): { checkpoint: DatabaseCheckpoint | null; discarded: boolean } {
  if (!raw || typeof raw !== "object" || (raw as { kind?: unknown }).kind !== "DATABASE") return { checkpoint: null, discarded: Boolean(raw && typeof raw === "object" && Object.keys(raw).length > 0) }
  const checkpoint = raw as DatabaseCheckpoint
  const expected = orderColumnsOf(sync)
  const sameColumns = Array.isArray(checkpoint.orderColumns) && checkpoint.orderColumns.length === expected.length && checkpoint.orderColumns.every((column, index) => column === expected[index])
  if (checkpoint.mode !== sync.mode || !sameColumns) return { checkpoint: null, discarded: true }
  return { checkpoint, discarded: false }
}

/** Onde a próxima carga começa. */
export type StartPoint = { kind: "BEGINNING" } | { kind: "AFTER"; position: string[] } | { kind: "LOOKBACK"; firstColumnFrom: string }

export function startPointOf(sync: DatabaseSync, checkpoint: DatabaseCheckpoint | null, cursorCategory: ColumnCategory | null): StartPoint {
  if (!checkpoint?.position) return { kind: "BEGINNING" }
  if (sync.mode === "FULL") return checkpoint.reachedEnd ? { kind: "BEGINNING" } : { kind: "AFTER", position: checkpoint.position }
  // Releitura só ao começar um NOVO ciclo (a carga anterior chegou ao fim) e só para data/hora — nunca numa
  // continuação (senão uma janela maior que o limite por carga releria para sempre).
  if (checkpoint.reachedEnd && sync.lookbackMinutes > 0 && cursorCategory && ["DATE", "DATETIME", "DATETIME_TZ"].includes(cursorCategory)) {
    const from = subtractMinutesFromDateText(checkpoint.position[0]!, sync.lookbackMinutes, cursorCategory)
    if (from) return { kind: "LOOKBACK", firstColumnFrom: from }
  }
  return { kind: "AFTER", position: checkpoint.position }
}

/**
 * Divisão determinística de uma página lida com `limit + 1` linhas, sem nunca pular linha nem entrar em laço:
 *  - até `pageSize` linhas → última página;
 *  - a linha extra tem posição diferente da última da página → aplica a página inteira;
 *  - empate na fronteira (mesma posição dos dois lados) → a página termina ANTES do grupo empatado, que é lido
 *    inteiro na próxima (as linhas iguais nunca ficam divididas entre duas posições);
 *  - a página INTEIRA é um único grupo empatado → `tieGroup`: quem chama lê o grupo inteiro de uma vez.
 * Funciona também com chave não única (é o empate que a regra resolve).
 */
export type PagePlan = { take: number; reachedEnd: boolean; tieGroup: string[] | null }

export function samePosition(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

export function planPage(positions: readonly (readonly string[])[], pageSize: number): PagePlan {
  if (positions.length <= pageSize) return { take: positions.length, reachedEnd: true, tieGroup: null }
  const extra = positions[pageSize]!
  if (!samePosition(positions[pageSize - 1], extra)) return { take: pageSize, reachedEnd: false, tieGroup: null }
  let start = pageSize - 1
  while (start > 0 && samePosition(positions[start - 1], extra)) start -= 1
  if (start > 0) return { take: start, reachedEnd: false, tieGroup: null }
  return { take: 0, reachedEnd: false, tieGroup: [...extra] }
}

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})(?:([ T])(\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/

/** Texto de data/hora vindo do próprio banco − N minutos, no mesmo estilo (separador e fuso). Sem frações: a janela só precisa ser anterior. */
export function subtractMinutesFromDateText(text: string, minutes: number, category: ColumnCategory): string | null {
  const match = DATE_TEXT.exec(text.trim())
  if (!match) return null
  const [, y, mo, d, separator, h = "00", mi = "00", s = "00", , offset] = match
  const base = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  if (Number.isNaN(base)) return null
  if (category === "DATE") {
    const days = Math.max(1, Math.ceil(minutes / (24 * 60)))
    return new Date(base - days * 86_400_000).toISOString().slice(0, 10)
  }
  const shifted = new Date(base - minutes * 60_000).toISOString()
  return `${shifted.slice(0, 10)}${separator ?? " "}${shifted.slice(11, 19)}${offset ?? ""}`
}
