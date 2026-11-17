import { EMPLOYMENT_STATUS_LABELS, isOperationallyEligibleStatus, type EmploymentStatus } from "./employment-status.js"
import { SCHEDULE_ACTIVITY_TYPE_LABELS, type ScheduleActivityType } from "./schedule-activity.js"
import { SCHEDULE_EXCEPTION_LABELS, type ScheduleExceptionCode } from "./schedule-exception.js"
import type { ResolvedWorkday } from "./workday-resolution.js"

/**
 * MINHA JORNADA — leitura do PLANEJAMENTO da escala do próprio colaborador, dia a dia. Função pura sobre o MESMO dia resolvido
 * que o Calendário da equipe usa (`resolveWorkday`), para as duas visões nunca divergirem; a diferença é só o que se mostra:
 * o operador vê o PLANO (escala, exceções vigentes, situação funcional, atividades escaladas), nunca produção observada,
 * pendência ou classificação da gestão.
 *
 * Precedência do dia (a do domínio): antes da admissão → situação funcional não produtiva → exceção vigente (dia inteiro) →
 * escala explícita (trabalha / folga) → feriado do fallback → sem escala publicada. Só aparece a escala que o cliente enviou
 * (decisão de 17/11/2026, fim do 6x1: regime não diz mais os dias): o fallback legado seg–sex e o regime sem calendário são
 * "Sem escala publicada", sem nenhum horário de referência — nem a jornada cadastrada sugere que o dia é de trabalho. Atividades escaladas só valem num dia de trabalho: folga, exceção ou situação não produtiva vencem.
 *
 * Horários de entrada e saída: os do dia na escala (`employee_schedule_days`) vencem; sem eles, o envelope das atividades
 * escaladas (do primeiro início ao último fim); sem elas, a jornada vigente cadastrada (`employee_work_shifts`: entrada + carga).
 * Fim menor ou igual ao início = cruza a meia-noite.
 *
 * Linha do tempo: cada minuto recebe o que a fonte diz — pausa > outra atividade > logado > jornada prevista (dentro da entrada e
 * saída, sem atividade informada). Fora da jornada não vira bloco (pedido do responsável, 17/11). Nada é preenchido por suposição: sem atividades, a jornada é um bloco
 * único "Jornada prevista", nunca "logado para atendimento" inventado.
 */
export const JOURNEY_DAY_KINDS = ["WORK", "DAY_OFF", "EXCEPTION", "EMPLOYMENT_STATUS", "HOLIDAY", "NO_SCHEDULE", "BEFORE_HIRE"] as const
export type JourneyDayKind = (typeof JOURNEY_DAY_KINDS)[number]

export const JOURNEY_BLOCK_KINDS = ["SHIFT", "LOGGED_IN", "BREAK", "OTHER", "NON_WORKING"] as const
export type JourneyBlockKind = (typeof JOURNEY_BLOCK_KINDS)[number]

export type JourneyTimesSource = "SCHEDULE_DAY" | "ACTIVITIES" | "WORK_SHIFT"

export type JourneyShift = { start: string; end: string; crossesMidnight: boolean; source: JourneyTimesSource }

export type JourneyException = { id: string; code: ScheduleExceptionCode; label: string; originLabel: string }

/** Atividade escalada como chegou (horários HH:mm do dia da escala). */
export type JourneyActivityInput = { type: ScheduleActivityType; name: string; start: string; end: string }

/** Atividade do dia para a tela: horários e se termina no dia seguinte. */
export type JourneyActivity = { type: ScheduleActivityType; typeLabel: string; name: string; start: string; end: string; crossesMidnight: boolean }

/** Bloco da linha do tempo de UM dia, em minutos desde 00:00 local (`endMinute` exclusivo, até 1440). */
export type JourneyBlock = { kind: JourneyBlockKind; label: string; startMinute: number; endMinute: number; continuesFromPreviousDay: boolean; continuesNextDay: boolean }

export type JourneyDay = {
  date: string
  kind: JourneyDayKind
  label: string
  shift: JourneyShift | null
  exceptions: JourneyException[]
  /** Atividades escaladas do dia (só em dia de trabalho), em ordem de início. */
  activities: JourneyActivity[]
  blocks: JourneyBlock[]
}

export type JourneyShiftInput = { start: string | null; end: string | null } | null
export type JourneyWorkShiftInput = { startTime: string; workMinutes: number } | null

export const JOURNEY_DAY_KIND_LABELS: Record<Exclude<JourneyDayKind, "EXCEPTION" | "EMPLOYMENT_STATUS">, string> = {
  WORK: "Dia de trabalho",
  DAY_OFF: "Folga",
  HOLIDAY: "Feriado",
  NO_SCHEDULE: "Sem escala publicada",
  BEFORE_HIRE: "Antes da admissão",
}

/** Rótulo oficial da situação funcional em caixa de frase ("FÉRIAS" → "Férias"); siglas (INSS) ficam como estão. */
export function employmentStatusSentenceLabel(status: EmploymentStatus): string {
  const label = EMPLOYMENT_STATUS_LABELS[status]
  if (label === label.toUpperCase() && !label.includes(" ") && label.length <= 4) return label
  const lower = label.toLocaleLowerCase("pt-BR")
  return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1)
}

/** "08:00:00" / "08:00" → "08:00"; inválido → null. */
export function normalizeClock(value: string | null | undefined): string | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

export function clockToMinutes(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number)
  return hours! * 60 + minutes!
}

function minutesToClock(total: number): string {
  const normalized = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`
}

/** Fim no dia seguinte quando é menor ou igual ao início (mesma regra da escala). */
function crosses(start: string, end: string): boolean {
  return clockToMinutes(end) <= clockToMinutes(start)
}

export function toJourneyActivities(inputs: readonly JourneyActivityInput[]): JourneyActivity[] {
  return inputs
    .map((input) => ({ start: normalizeClock(input.start), end: normalizeClock(input.end), input }))
    .filter((item): item is { start: string; end: string; input: JourneyActivityInput } => item.start !== null && item.end !== null && item.start !== item.end)
    .map(({ start, end, input }) => ({ type: input.type, typeLabel: SCHEDULE_ACTIVITY_TYPE_LABELS[input.type], name: input.name, start, end, crossesMidnight: crosses(start, end) }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name, "pt-BR"))
}

/** Envelope das atividades: do primeiro início ao último fim (contando o que passa da meia-noite). */
function activitiesEnvelope(activities: readonly JourneyActivity[]): JourneyShift | null {
  if (activities.length === 0) return null
  const startMinute = Math.min(...activities.map((activity) => clockToMinutes(activity.start)))
  const endMinute = Math.max(...activities.map((activity) => clockToMinutes(activity.end) + (activity.crossesMidnight ? 1440 : 0)))
  return { start: minutesToClock(startMinute), end: minutesToClock(endMinute), crossesMidnight: endMinute >= 1440, source: "ACTIVITIES" }
}

/** Horário do dia: o da escala (início e fim) vence; sem ele, o envelope das atividades; sem elas, a jornada vigente. */
export function resolveJourneyShift(day: JourneyShiftInput, workShift: JourneyWorkShiftInput, activities: readonly JourneyActivity[] = []): JourneyShift | null {
  const start = normalizeClock(day?.start)
  const end = normalizeClock(day?.end)
  if (start && end) return { start, end, crossesMidnight: crosses(start, end), source: "SCHEDULE_DAY" }
  return activitiesEnvelope(activities) ?? workShiftReference(workShift)
}

export function workShiftReference(workShift: JourneyWorkShiftInput): JourneyShift | null {
  const start = normalizeClock(workShift?.startTime)
  if (!start || !workShift || !(workShift.workMinutes > 0) || workShift.workMinutes > 1440) return null
  const endTotal = clockToMinutes(start) + workShift.workMinutes
  return { start, end: minutesToClock(endTotal), crossesMidnight: endTotal >= 1440, source: "WORK_SHIFT" }
}

export type JourneyDayInput = {
  resolved: ResolvedWorkday
  /** Exceções VIGENTES da pessoa nesta data (canceladas não aparecem para o colaborador). */
  exceptions: JourneyException[]
  scheduleDay: JourneyShiftInput
  workShift: JourneyWorkShiftInput
  /** Atividades escaladas VIGENTES desta data. */
  activities?: readonly JourneyActivityInput[]
}

type DescribedDay = Omit<JourneyDay, "blocks">

/** Tipo e rótulo do dia + horário planejado e atividades (só em dia de trabalho com escala explícita). */
export function describeJourneyDay(input: JourneyDayInput): DescribedDay {
  const { resolved, exceptions } = input
  const base = { date: resolved.date, shift: null, exceptions, activities: [] }
  if (resolved.state === "BEFORE_HIRE") return { ...base, kind: "BEFORE_HIRE", label: JOURNEY_DAY_KIND_LABELS.BEFORE_HIRE }
  if (resolved.status !== null && !isOperationallyEligibleStatus(resolved.status)) return { ...base, kind: "EMPLOYMENT_STATUS", label: employmentStatusSentenceLabel(resolved.status) }
  const planned = resolved.planned
  if (planned.exception) {
    const matching = exceptions.find((exception) => exception.code === planned.exception!.code)
    return { ...base, kind: "EXCEPTION", label: matching?.label ?? SCHEDULE_EXCEPTION_LABELS[planned.exception.code] }
  }
  if (planned.basis === "EXPLICIT_SCHEDULE") {
    if (!planned.scheduledToWork) return { ...base, kind: "DAY_OFF", label: JOURNEY_DAY_KIND_LABELS.DAY_OFF }
    const activities = toJourneyActivities(input.activities ?? [])
    return { ...base, kind: "WORK", label: JOURNEY_DAY_KIND_LABELS.WORK, activities, shift: resolveJourneyShift(input.scheduleDay, input.workShift, activities) }
  }
  if (planned.holiday) return { ...base, kind: "HOLIDAY", label: JOURNEY_DAY_KIND_LABELS.HOLIDAY }
  return { ...base, kind: "NO_SCHEDULE", label: JOURNEY_DAY_KIND_LABELS.NO_SCHEDULE }
}

const SHIFT_LABEL = "Jornada prevista"

/** Prioridade na linha do tempo: o que a fonte detalha vence o genérico (pausa dentro do login aparece como pausa). */
const PRIORITY: Record<"SHIFT" | ScheduleActivityType, number> = { SHIFT: 1, LOGGED_IN: 2, OTHER: 3, BREAK: 4 }

type Paint = { kind: JourneyBlockKind; label: string; priority: number; fromPrevious: boolean; toNext: boolean }

/** Intervalos de um dia [início, fim) em minutos; o que passa da meia-noite vai até 1440 aqui e o resto abre o dia seguinte. */
function intervalsOf(day: DescribedDay): { kind: "SHIFT" | ScheduleActivityType; label: string; start: number; end: number; crosses: boolean }[] {
  if (day.kind !== "WORK") return []
  const items: { kind: "SHIFT" | ScheduleActivityType; label: string; start: number; end: number; crosses: boolean }[] = []
  if (day.shift && day.shift.source !== "ACTIVITIES") items.push({ kind: "SHIFT", label: SHIFT_LABEL, start: clockToMinutes(day.shift.start), end: clockToMinutes(day.shift.end), crosses: day.shift.crossesMidnight })
  for (const activity of day.activities) items.push({ kind: activity.type, label: activity.type === "LOGGED_IN" ? SCHEDULE_ACTIVITY_TYPE_LABELS.LOGGED_IN : activity.name, start: clockToMinutes(activity.start), end: clockToMinutes(activity.end), crosses: activity.crossesMidnight })
  return items
}

/**
 * Linha do tempo de UM dia (00:00–24:00 local). `previous` = o dia anterior já descrito: o que dele cruza a meia-noite (jornada
 * ou atividade) abre o dia. Sem horário conhecido num dia de trabalho, ou sem escala publicada, só aparece o que se sabe — o
 * resto fica sem bloco (a tela explica a lacuna), nunca preenchido por suposição.
 */
export function buildJourneyBlocks(day: DescribedDay, previous: DescribedDay | null): JourneyBlock[] {
  const cells: (Paint | null)[] = Array.from({ length: 1440 }, () => null)
  const paint = (start: number, end: number, value: Paint) => {
    for (let minute = Math.max(0, start); minute < Math.min(1440, end); minute += 1) {
      const current = cells[minute]
      if (!current || current.priority < value.priority) cells[minute] = value
    }
  }
  for (const item of previous ? intervalsOf(previous) : []) {
    if (item.crosses && item.end > 0) paint(0, item.end, { kind: item.kind, label: item.label, priority: PRIORITY[item.kind], fromPrevious: true, toNext: false })
  }
  const today = intervalsOf(day)
  for (const item of today) paint(item.start, item.crosses ? 1440 : item.end, { kind: item.kind, label: item.label, priority: PRIORITY[item.kind], fromPrevious: false, toNext: item.crosses })
  // Dia de trabalho: só os intervalos que a escala informa (fora da jornada não vira bloco). Dia sem jornada: o rótulo do dia no resto.
  const fill: Paint | null = day.kind === "WORK" || day.kind === "NO_SCHEDULE" ? null : { kind: "NON_WORKING", label: day.label, priority: 0, fromPrevious: false, toNext: false }
  const blocks: JourneyBlock[] = []
  for (let minute = 0; minute < 1440; minute += 1) {
    const cell = cells[minute] ?? fill
    if (!cell) continue
    const last = blocks.at(-1)
    const lastCell = minute > 0 ? (cells[minute - 1] ?? fill) : null
    if (last && last.endMinute === minute && lastCell !== null && (lastCell === cell || (lastCell.kind === cell.kind && lastCell.label === cell.label && !cell.fromPrevious))) {
      last.endMinute = minute + 1
      continue
    }
    blocks.push({ kind: cell.kind, label: cell.label, startMinute: minute, endMinute: minute + 1, continuesFromPreviousDay: cell.fromPrevious && minute === 0, continuesNextDay: false })
  }
  for (const block of blocks) {
    const cell = cells[block.endMinute - 1] ?? fill
    block.continuesNextDay = block.endMinute === 1440 && Boolean(cell?.toNext)
  }
  return blocks
}

/** Descreve os dias em ordem; `inputs[0]` é o dia ANTERIOR ao primeiro mostrado (só serve ao que cruza a meia-noite). */
export function buildJourneyDays(inputs: JourneyDayInput[]): JourneyDay[] {
  const described = inputs.map(describeJourneyDay)
  return described.slice(1).map((day, index) => ({ ...day, blocks: buildJourneyBlocks(day, described[index] ?? null) }))
}
