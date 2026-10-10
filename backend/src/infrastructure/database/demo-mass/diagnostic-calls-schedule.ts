import { DEMO_TZ_OFFSET } from "./demo-constants.js"
import type { DiagnosticCall } from "./diagnostic-calls.js"
import { shiftFor } from "./interaction-generator.js"
import type { DemoPerson } from "./structure-generator.js"

/**
 * LAYOUT TEMPORAL V2 do lote `inia_demo_90_v1` (2026-09-18): as mesmas 90 chamadas, com o MESMO
 * conteúdo (transcrição, papéis, assunto, flags, duração) — só a posição no calendário muda, e de
 * forma determinística:
 *   - bloco por sufixo do id (001–010 → junho, 011–020 → julho, 021–030 → agosto/2026): os três blocos
 *     de dez que o lote já tinha (P1/P2/P3) viram os três meses — a relação caso ↔ bloco é preservada,
 *     nada é concentrado nem "facilitado"; a ordem cronológica dentro de cada operador é a do sufixo,
 *     então toda rechamada continua DEPOIS da chamada original;
 *   - dia = dia ÚTIL (seg–sex, o fallback de escala das personas 0002/0004/0005, sem calendário explícito)
 *     espalhado do 1º ao último dia útil do mês;
 *   - horário = dentro da JORNADA da pessoa (`employee_work_shifts` da massa, `shiftFor`), com margem
 *     para a duração, sem sobrepor NENHUMA outra chamada da mesma pessoa no dia (as 10 geradas e as do
 *     próprio lote) — se não couber, falha alto; nunca hora extra artificial, nunca fim de semana.
 * A fonte declara junho inteiro (uma chamada por operador por dia); a V2 é a instância congelada para
 * benchmark (DIAGNOSTIC_DATASET_V1). Mapeamento V1 → V2 por id em `temporal_layout_v2.json` (QA).
 */
export const DIAGNOSTIC_CALLS_TEMPORAL_LAYOUT = "V2_JUN_JUL_AGO_2026"
export const DIAGNOSTIC_CALLS_MONTH_BY_BLOCK: readonly string[] = ["2026-06", "2026-07", "2026-08"]
const CALLS_PER_BLOCK = 10
const FIRST_SLOT_MINUTES = 20
const SLOT_STEP_MINUTES = 53
const OVERLAP_STEP_MINUTES = 15
const MAX_DURATION_MARGIN_MINUTES = 12

export type PlacedInterval = { startedAt: string; endedAt: string }
export type ScheduledCall = { sourceExternalId: string; sourceStartedAt: string; startedAt: string; endedAt: string; localDate: string; block: number; slot: number }

function dayNumber(iso: string): number {
  return Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000)
}
function isoFromDayNumber(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}
function isWeekend(day: number): boolean {
  const weekday = new Date(day * 86_400_000).getUTCDay()
  return weekday === 0 || weekday === 6
}
const pad = (value: number) => String(value).padStart(2, "0")

/** Dias úteis (seg–sex) de uma competência "AAAA-MM", em ordem. */
export function businessDaysOf(period: string): string[] {
  const [year, month] = period.split("-").map(Number) as [number, number]
  const first = dayNumber(`${period}-01`)
  const last = dayNumber(`${period}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`)
  const days: string[] = []
  for (let day = first; day <= last; day += 1) if (!isWeekend(day)) days.push(isoFromDayNumber(day))
  return days
}

/** Sufixo numérico do id externo (`INIA-DEMO-M-017` → 17). */
export function callSequence(sourceExternalId: string): number {
  const match = /-(\d{3})$/.exec(sourceExternalId)
  if (!match) throw new Error(`Id externo sem sufixo numérico: ${sourceExternalId}`)
  return Number(match[1])
}

function localTimestamp(day: string, minute: number, second = 0): string {
  return `${day}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}:${pad(second)}${DEMO_TZ_OFFSET}`
}

function overlaps(a: PlacedInterval, b: PlacedInterval): boolean {
  return Date.parse(a.startedAt) < Date.parse(b.endedAt) && Date.parse(b.startedAt) < Date.parse(a.endedAt)
}

/**
 * Posiciona as chamadas de UMA pessoa. `existing` = intervalos que já ocupam a agenda dela (chamadas
 * geradas pela massa); as chamadas do próprio lote também não se sobrepõem entre si.
 */
export function scheduleDiagnosticCalls(person: DemoPerson, calls: readonly DiagnosticCall[], existing: readonly PlacedInterval[]): ScheduledCall[] {
  const shift = shiftFor(person)
  const [shiftHour, shiftMinute] = shift.startTime.split(":").map(Number) as [number, number]
  const shiftStart = shiftHour * 60 + shiftMinute
  const shiftEnd = shiftStart + shift.workMinutes
  const occupied: PlacedInterval[] = [...existing]
  const ordered = [...calls].sort((a, b) => callSequence(a.interacao_id_externo) - callSequence(b.interacao_id_externo))
  return ordered.map((call) => {
    const sequence = callSequence(call.interacao_id_externo)
    const block = Math.floor((sequence - 1) / CALLS_PER_BLOCK)
    const slot = (sequence - 1) % CALLS_PER_BLOCK
    const period = DIAGNOSTIC_CALLS_MONTH_BY_BLOCK[block]
    if (!period) throw new Error(`Chamada ${call.interacao_id_externo} fora dos ${DIAGNOSTIC_CALLS_MONTH_BY_BLOCK.length} blocos previstos`)
    const days = businessDaysOf(period)
    const day = days[Math.round((slot * (days.length - 1)) / (CALLS_PER_BLOCK - 1))]!
    const durationMinutes = Math.ceil(call.duracao_s / 60)
    const latestStart = shiftEnd - Math.max(durationMinutes, MAX_DURATION_MARGIN_MINUTES)
    let startMinute = shiftStart + FIRST_SLOT_MINUTES + ((slot * SLOT_STEP_MINUTES) % Math.max(1, latestStart - shiftStart - FIRST_SLOT_MINUTES))
    let placed: PlacedInterval | null = null
    for (let attempt = 0; attempt < 40 && startMinute <= latestStart; attempt += 1) {
      const candidate = { startedAt: localTimestamp(day, startMinute), endedAt: new Date(Date.parse(localTimestamp(day, startMinute)) + call.duracao_s * 1000).toISOString() }
      candidate.endedAt = toLocalIso(candidate.endedAt)
      if (!occupied.some((interval) => overlaps(interval, candidate))) {
        placed = candidate
        break
      }
      startMinute += OVERLAP_STEP_MINUTES
    }
    if (!placed) throw new Error(`Chamada ${call.interacao_id_externo} não coube na jornada de ${person.name} em ${day} sem sobrepor outra chamada`)
    occupied.push(placed)
    return { sourceExternalId: call.interacao_id_externo, sourceStartedAt: call.inicio_em, startedAt: placed.startedAt, endedAt: placed.endedAt, localDate: day, block: block + 1, slot: slot + 1 }
  })
}

/** ISO com o deslocamento fixo da massa (-03:00), a partir de um instante UTC. */
function toLocalIso(utcIso: string): string {
  const local = new Date(Date.parse(utcIso) - 3 * 60 * 60 * 1000)
  return `${local.toISOString().slice(0, 19)}${DEMO_TZ_OFFSET}`
}
