import { z } from "zod"

/**
 * Saúde da conexão × atualidade dos dados — nunca a mesma coisa.
 *
 * - Connection health: "consigo chegar/autenticar na fonte?" (HEALTHY | ERROR | UNKNOWN).
 * - Data freshness: "quando chegou dado válido pela última vez?" (FRESH | STALE | NEVER),
 *   derivada da cadência esperada do feed — uma fonte pode estar HEALTHY e o feed STALE.
 * - Source status: Rascunho / Ativa / Pausada / Erro (decisão administrativa + falha).
 */
export const CONNECTION_HEALTHS = ["HEALTHY", "ERROR", "UNKNOWN"] as const
export type ConnectionHealth = (typeof CONNECTION_HEALTHS)[number]

export const FRESHNESS_STATES = ["FRESH", "STALE", "NEVER"] as const
export type FreshnessState = (typeof FRESHNESS_STATES)[number]

export const SOURCE_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ERROR"] as const
export type SourceStatus = (typeof SOURCE_STATUSES)[number]

export const FEED_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "DEGRADED"] as const
export type FeedStatus = (typeof FEED_STATUSES)[number]

export const LOAD_MODES = ["DELTA", "SNAPSHOT"] as const
export type LoadMode = (typeof LOAD_MODES)[number]

/** Cadência esperada — base do "próxima sincronização" e do ATRASADO. */
export const cadenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MANUAL") }),
  z.object({ kind: z.literal("INTERVAL"), minutes: z.number().int().min(5).max(24 * 60) }),
  z.object({ kind: z.literal("DAILY"), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
])
export type Cadence = z.infer<typeof cadenceSchema>

export function cadenceLabel(cadence: Cadence): string {
  switch (cadence.kind) {
    case "MANUAL":
      return "Manual"
    case "INTERVAL":
      return cadence.minutes % 60 === 0 ? `A cada ${cadence.minutes / 60}h` : `A cada ${cadence.minutes} min`
    case "DAILY":
      return `Diário às ${cadence.time}`
  }
}

/** Intervalo esperado entre cargas, em minutos — `null` = manual (nunca fica atrasado por cadência). */
export function expectedIntervalMinutes(cadence: Cadence): number | null {
  switch (cadence.kind) {
    case "MANUAL":
      return null
    case "INTERVAL":
      return cadence.minutes
    case "DAILY":
      return 24 * 60
  }
}

/** Próxima execução a partir de `from` (UTC) — DAILY usa o horário no fuso informado. */
export function nextSyncAt(cadence: Cadence, from: Date, timeZone: string): Date | null {
  switch (cadence.kind) {
    case "MANUAL":
      return null
    case "INTERVAL":
      return new Date(from.getTime() + cadence.minutes * 60_000)
    case "DAILY": {
      const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      const parts = Object.fromEntries(formatter.formatToParts(from).map((part) => [part.type, part.value]))
      const today = `${parts.year}-${parts.month}-${parts.day}`
      const nowHHmm = `${parts.hour}:${parts.minute}`
      const targetDate = nowHHmm < cadence.time ? today : addDays(today, 1)
      return localToInstant(targetDate, cadence.time, timeZone)
    }
  }
}

export function addDays(date: string, amount: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number]
  const next = new Date(Date.UTC(y, m - 1, d + amount))
  return next.toISOString().slice(0, 10)
}

export function localToInstant(date: string, time: string, timeZone: string): Date {
  const [hour, minute] = time.split(":").map(Number) as [number, number]
  const [y, m, d] = date.split("-").map(Number) as [number, number, number]
  const guess = Date.UTC(y, m - 1, d, hour, minute)
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
  const asLocal = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
  }
  let instant = guess - (asLocal(guess) - guess)
  instant = guess - (asLocal(instant) - instant)
  return new Date(instant)
}

/**
 * Atualidade: FRESH se a última carga bem-sucedida está dentro de 2× o intervalo esperado
 * (tolerância a um ciclo perdido); STALE se passou disso; NEVER se nunca houve sucesso.
 * Feed manual sem cadência nunca fica STALE por tempo — só NEVER ou FRESH.
 */
export function computeFreshness(lastSuccessAt: Date | null, expectedInterval: number | null, now: Date): FreshnessState {
  if (!lastSuccessAt) return "NEVER"
  if (expectedInterval === null) return "FRESH"
  const ageMinutes = (now.getTime() - lastSuccessAt.getTime()) / 60_000
  return ageMinutes > expectedInterval * 2 ? "STALE" : "FRESH"
}
