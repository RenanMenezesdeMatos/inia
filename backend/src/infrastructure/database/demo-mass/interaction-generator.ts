import { absenceStartFor, DEMO_INTERACTIONS_FROM, DEMO_INTERACTIONS_UNTIL, DEMO_STRUCTURE, DEMO_TZ_OFFSET } from "./demo-constants.js"
import { demoId } from "./demo-ids.js"
import { CANONICAL_INTERACTION_OWNERS, IMPERFECT_FLAG_INTERACTIONS } from "./demo-identities.js"
import { customerName } from "./names.js"
import { clamp, type Random } from "./random.js"
import { placementAt, type DemoPerson, type DemoStructure } from "./structure-generator.js"
import { applyOperatorName, CANONICAL_TRANSCRIPTS } from "./transcripts/canonical-transcripts.js"
import { CITIES, COMPANIES, MONTHS, PLANS_B2B, PLANS_B2C } from "./transcripts/phrase-pools.js"
import { buildCallPlan, composeTranscript } from "./transcripts/transcript-composer.js"
import type { CallContext, CallPlan } from "./transcripts/transcript-types.js"

export type InteractionRow = {
  id: string
  operatorId: string
  externalId: string
  reason: string
  channel: "VOICE"
  startedAt: string
  endedAt: string
  transcript: { content: string; confidence: number }
  flags: Record<string, boolean | number>
  /** Só pra relatório/testes — não é persistido. */
  meta: { length: "CURTA" | "MEDIA" | "LONGA"; turns: number; plan: CallPlan | null; canonical: boolean }
}

/** Jornadas previstas (employee_work_shifts) — 4 turnos fixos, sorteados por operador. */
export const WORK_SHIFTS = [
  { startTime: "08:00", workMinutes: 360 },
  { startTime: "14:00", workMinutes: 360 },
  { startTime: "09:00", workMinutes: 480 },
  { startTime: "12:00", workMinutes: 480 },
] as const

export function shiftFor(person: DemoPerson): (typeof WORK_SHIFTS)[number] {
  return WORK_SHIFTS[person.ordinal % WORK_SHIFTS.length]!
}

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
function addDays(iso: string, days: number): string {
  return isoFromDayNumber(dayNumber(iso) + days)
}

/** 10 dias úteis distintos, um por fatia da janela do operador — nunca todas no mesmo dia. */
export function pickInteractionDays(random: Random, from: string, until: string, count: number): string[] {
  const start = dayNumber(from)
  const end = dayNumber(until)
  const span = Math.max(1, end - start)
  const days = new Set<number>()
  for (let slot = 0; slot < count; slot += 1) {
    const sliceStart = start + Math.floor((span * slot) / count)
    const sliceEnd = start + Math.floor((span * (slot + 1)) / count)
    let day = random.int(sliceStart, Math.max(sliceStart, sliceEnd - 1))
    let guard = 0
    while ((isWeekend(day) || days.has(day)) && guard < 14) {
      day += 1
      guard += 1
    }
    days.add(clamp(day, start, end))
  }
  return [...days].sort((a, b) => a - b).map(isoFromDayNumber)
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function formatAmount(random: Random, min: number, max: number): string {
  const cents = random.pick([90, 99, 40, 70, 50])
  return `R$ ${random.int(min, max)},${pad(cents)}`
}

export function buildCallContext(random: Random, operator: DemoPerson, structure: DemoStructure, day: string): CallContext {
  // Cenário do Grupo VIGENTE no dia da chamada (placementAt): uma transferência não reescreve chamadas anteriores.
  const team = structure.teamByKey.get(placementAt(operator, day).teamKey!)!
  const customer = customerName(random)
  const segment = team.spec.segment
  const monthIndex = Number(day.slice(5, 7)) - 1
  return {
    random,
    operatorFirstName: operator.name.split(" ")[0]!,
    operatorGender: operator.gender,
    customerFirstName: customer.firstName,
    customerSurname: customer.surname,
    customerGender: customer.gender,
    segment,
    domain: team.spec.domain,
    companyName: segment === "B2B" ? random.pick(COMPANIES) : null,
    plan: random.pick(segment === "B2B" ? PLANS_B2B : PLANS_B2C),
    amount: formatAmount(random, segment === "B2B" ? 249 : 79, segment === "B2B" ? 1899 : 189),
    extraAmount: formatAmount(random, segment === "B2B" ? 300 : 110, segment === "B2B" ? 2400 : 260),
    dueDay: random.pick([5, 10, 15, 20, 25]),
    protocol: `${day.slice(0, 4)}${day.slice(5, 7)}${random.int(100000, 999999)}`,
    city: random.pick(CITIES),
    monthName: MONTHS[Math.max(0, monthIndex - 1)]!,
    variant: random.int(0, 5),
  }
}

export function interactionWindow(operator: DemoPerson, referenceDate: string = DEMO_INTERACTIONS_UNTIL): { from: string; until: string } {
  const from = operator.lateHire ? addDays(operator.hiredAt, 7) : DEMO_INTERACTIONS_FROM
  const until = operator.absentLastPeriod ? absenceStartFor(referenceDate) : DEMO_INTERACTIONS_UNTIL
  return { from, until }
}

/** As 10 interações de UM operador — reproduzíveis a partir da chave do operador. */
export function generateOperatorInteractions(structure: DemoStructure, operator: DemoPerson, random: Random): InteractionRow[] {
  const operatorRandom = random.fork(`interactions:${operator.key}`)
  const { from, until } = interactionWindow(operator)
  const days = pickInteractionDays(operatorRandom.fork("days"), from, until, DEMO_STRUCTURE.interactionsPerOperator)
  const shift = shiftFor(operator)
  const canonicalHere = Object.entries(CANONICAL_INTERACTION_OWNERS).filter(([, ordinal]) => ordinal === operator.ordinal).map(([externalId]) => externalId)
  const imperfectHere = IMPERFECT_FLAG_INTERACTIONS.filter((item) => item.operatorOrdinal === operator.ordinal)
  const windowDays = Math.max(1, dayNumber(until) - dayNumber(from))

  return days.map((day, index) => {
    const sequence = index + 1
    const callRandom = operatorRandom.fork(`call:${sequence}`)
    const [shiftHour, shiftMinute] = shift.startTime.split(":").map(Number) as [number, number]
    const startMinute = shiftHour * 60 + shiftMinute + callRandom.int(5, shift.workMinutes - 40)
    const startedAt = `${day}T${pad(Math.floor(startMinute / 60))}:${pad(startMinute % 60)}:${pad(callRandom.int(0, 59))}${DEMO_TZ_OFFSET}`
    const monthProgress = clamp((dayNumber(day) - dayNumber(from)) / windowDays, 0, 1)

    // Slot 5 recebe a transcrição canônica do operador (se houver); slot 7, a fixture de flag imperfeita.
    const canonicalId = sequence === 5 ? canonicalHere[0] : sequence === 6 ? canonicalHere[1] : undefined
    if (canonicalId) {
      const canonical = CANONICAL_TRANSCRIPTS[canonicalId]!
      const content = applyOperatorName(canonical.content, operator.name.split(" ")[0]!)
      return {
        id: demoId(`interaction:${canonicalId}`), operatorId: operator.id, externalId: canonicalId, reason: canonical.reason, channel: "VOICE",
        startedAt, endedAt: endOf(startedAt, canonical.durationSeconds), transcript: { content, confidence: 0.97 },
        flags: { ...canonical.flags }, meta: { length: canonical.length, turns: content.split("\n").length, plan: null, canonical: true },
      }
    }

    const imperfect = sequence === 7 ? imperfectHere[0] : sequence === 8 ? imperfectHere[1] : undefined
    const context = buildCallContext(callRandom, operator, structure, day)
    const plan = buildCallPlan(callRandom, { domain: context.domain, persona: operator.persona!, monthProgress })
    if (imperfect) plan.isRecall = imperfect.kind === "FALSE_NEGATIVE"
    const composed = composeTranscript(context, plan)
    const flags = { ...composed.flags }
    if (imperfect?.kind === "FALSE_POSITIVE") flags.rechamada = true
    if (imperfect?.kind === "FALSE_NEGATIVE") delete flags.rechamada
    const externalId = imperfect ? imperfect.externalId : `DEMO-INT-${String(operator.ordinal).padStart(4, "0")}-${pad(sequence)}`
    return {
      id: demoId(`interaction:${externalId}`), operatorId: operator.id, externalId, reason: composed.reason, channel: "VOICE",
      startedAt, endedAt: endOf(startedAt, composed.durationSeconds), transcript: { content: composed.content, confidence: Number(callRandom.float(0.86, 0.98).toFixed(2)) },
      flags, meta: { length: composed.plan.length, turns: composed.turns.length, plan: composed.plan, canonical: false },
    }
  })
}

function endOf(startedAt: string, durationSeconds: number): string {
  const started = new Date(startedAt)
  const ended = new Date(started.getTime() + durationSeconds * 1000)
  const local = new Date(ended.getTime() - 3 * 60 * 60 * 1000)
  return `${local.toISOString().slice(0, 19)}${DEMO_TZ_OFFSET}`
}
