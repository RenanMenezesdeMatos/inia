import { createHash } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { consolidatedStructureAnchorId } from "../domain/consolidated-structure-schema.js"
import { configurationChanges, stableJson, type ConfigurationChange, type WorkflowConfiguration } from "../domain/workflow-configuration.js"
import { resolveStructureAnchorOperatorIds } from "./hierarchy-subjects.js"
import { resolveOrganizationTimezone } from "./organization-timezone.js"
import { loadShiftsOn, planDueScheduleEnrollments, type DueScheduleSlot, type ScheduleConfiguration } from "./schedule-check.js"
import { addDays, localDateParts, nextOccurrences } from "./schedule-recurrence.js"
import { isAssumedWorkday, resolveRelativeInstant } from "./shift-schedule.js"
import { resolveEligibleOperatorIds } from "./workflow-eligibility.js"

/**
 * IMPACTO DE ENTRAR NO AR — o que acontece no runtime quando uma configuração de Workflow passa a valer:
 * ao PUBLICAR um Workflow ativo (a configuração do rascunho vira a publicada) ou ao ATIVAR um Workflow
 * publicado. Só a Agenda nasce matrícula sozinha nesse momento (Flag/Indicador esperam o próximo evento;
 * Manual espera alguém clicar em Executar agora), então só ela tem impacto calculado.
 *
 * Incidente que originou esta regra (2026-10-05): uma Agenda mensal "dia 5 às 18:30" para TODOS os
 * colaboradores entrou no ar às 18:4x do dia 5 — o checador recupera os horários de HOJE já vencidos
 * (catch-up do mesmo dia, schedule-check.ts) e criou 2.264 matrículas no minuto seguinte. A prévia de
 * "Próximas execuções" só mostrava o futuro e escondia isso.
 *
 * Regra (a mesma no backend e na tela):
 *   - IMMEDIATE_CATCH_UP: a primeira rodada do checador depois de entrar no ar criaria matrículas
 *     (calculado pela MESMA função que o checador usa — `planDueScheduleEnrollments` — descontando o
 *     que já existe pelo índice único do slot);
 *   - LARGE_POPULATION: cada ocorrência atinge mais de GO_LIVE_CONFIRMATION_POPULATION pessoas E a
 *     configuração é nova para o runtime (primeira publicação, configuração alterada, ou ativação).
 * Qualquer um dos dois exige confirmação explícita: o pedido precisa trazer o `fingerprint` do impacto
 * que a pessoa viu. Se o impacto mudou entre a prévia e o clique, o fingerprint não bate e a tela mostra
 * o impacto novo — nunca entra no ar com um número que ninguém viu.
 */
export const GO_LIVE_CONFIRMATION_POPULATION = 50

export type GoLiveReason = "PUBLISH" | "ACTIVATE"
export type GoLiveConfirmationReason = "IMMEDIATE_CATCH_UP" | "LARGE_POPULATION"

export type ScheduleGoLiveImpact = {
  mode: "CALENDAR" | "RELATIVE_TO_SHIFT"
  evaluation: "INDIVIDUAL" | "CONSOLIDATED"
  /** Pessoas elegíveis (Individual) ou membros da estrutura analisada (Consolidado). */
  population: number
  /** Matrículas por ocorrência: Individual = uma por pessoa; Consolidado = uma para a estrutura. */
  enrollmentsPerOccurrence: number
  /** O que a primeira rodada do checador (em até 1 minuto) criaria — horários de HOJE já vencidos. */
  immediate: { enrollments: number; alreadyEnrolled: number; scheduledFor: string[] }
  /** Primeiro disparo: o horário recuperado agora (quando `immediate.enrollments > 0`) ou a próxima ocorrência. */
  firstFireAt: string | null
  firesImmediately: boolean
  timezone: string
}

export type GoLiveImpact = {
  reason: GoLiveReason
  triggerKind: WorkflowConfiguration["triggerConfig"]["kind"]
  /** O Workflow está ativo — a configuração passa a valer na hora (inativo: só quando for ativado). */
  goesLive: boolean
  firstPublication: boolean
  configurationChanges: ConfigurationChange[]
  schedule: ScheduleGoLiveImpact | null
  requiresConfirmation: boolean
  reasons: GoLiveConfirmationReason[]
  threshold: number
  fingerprint: string
}

export type GoLiveImpactInput = {
  workflowId: string
  reason: GoLiveReason
  /** A configuração que vai valer (rascunho ao publicar; a publicada ao ativar). */
  configuration: WorkflowConfiguration
  /** A configuração publicada hoje — null quando nunca foi publicado. */
  published: WorkflowConfiguration | null
  active: boolean
  now: Date
}

/** Decisão pura (testável sem banco) — o que exige confirmação explícita. */
export function confirmationReasons(input: {
  reason: GoLiveReason
  goesLive: boolean
  isSchedule: boolean
  firstPublication: boolean
  changes: ConfigurationChange[]
  population: number
  immediateEnrollments: number
  threshold?: number
}): GoLiveConfirmationReason[] {
  if (!input.goesLive || !input.isSchedule) return []
  const threshold = input.threshold ?? GO_LIVE_CONFIRMATION_POPULATION
  const reasons: GoLiveConfirmationReason[] = []
  if (input.immediateEnrollments > 0) reasons.push("IMMEDIATE_CATCH_UP")
  const newToRuntime = input.reason === "ACTIVATE" || input.firstPublication || input.changes.length > 0
  if (input.population > threshold && newToRuntime) reasons.push("LARGE_POPULATION")
  return reasons
}

export function goLiveFingerprint(input: { workflowId: string; reason: GoLiveReason; configuration: WorkflowConfiguration; schedule: ScheduleGoLiveImpact | null }): string {
  const schedule = input.schedule
    ? { population: input.schedule.population, immediate: input.schedule.immediate.enrollments, scheduledFor: input.schedule.immediate.scheduledFor, firstFireAt: input.schedule.firstFireAt }
    : null
  return createHash("sha256")
    .update(stableJson({ workflowId: input.workflowId, reason: input.reason, configuration: input.configuration, schedule }))
    .digest("hex")
    .slice(0, 16)
}

export async function computeGoLiveImpact(db: Database, organizationId: string, input: GoLiveImpactInput): Promise<GoLiveImpact> {
  const trigger = input.configuration.triggerConfig
  const firstPublication = input.published === null
  const changes = input.published ? configurationChanges(input.configuration, input.published) : []
  // Inativo: nada passa a valer agora (a ativação recalcula o impacto da configuração publicada).
  const schedule = trigger.kind === "schedule" && input.active ? await scheduleImpact(db, organizationId, input) : null
  const reasons = confirmationReasons({
    reason: input.reason,
    goesLive: input.active,
    isSchedule: schedule !== null,
    firstPublication,
    changes,
    population: schedule?.population ?? 0,
    immediateEnrollments: schedule?.immediate.enrollments ?? 0,
  })
  return {
    reason: input.reason,
    triggerKind: trigger.kind,
    goesLive: input.active,
    firstPublication,
    configurationChanges: changes,
    schedule,
    requiresConfirmation: reasons.length > 0,
    reasons,
    threshold: GO_LIVE_CONFIRMATION_POPULATION,
    fingerprint: goLiveFingerprint({ workflowId: input.workflowId, reason: input.reason, configuration: input.configuration, schedule }),
  }
}

function scheduleConfigurationFrom(configuration: WorkflowConfiguration): ScheduleConfiguration {
  const trigger = configuration.triggerConfig
  if (trigger.kind !== "schedule") throw new Error("scheduleConfigurationFrom: gatilho não é Agenda")
  return {
    scopeType: configuration.scopeType,
    teamId: configuration.teamId,
    subteamId: configuration.subteamId,
    mode: trigger.mode,
    times: trigger.times ?? [],
    intervalDays: trigger.intervalDays,
    anchorDate: trigger.anchorDate,
    frequency: trigger.frequency,
    relative: trigger.relative,
    consolidatedStructure: configuration.consolidatedStructure,
    populationFilter: configuration.populationFilter,
  }
}

async function scheduleImpact(db: Database, organizationId: string, input: GoLiveImpactInput): Promise<ScheduleGoLiveImpact> {
  const config = scheduleConfigurationFrom(input.configuration)
  const timezone = await resolveOrganizationTimezone(db, organizationId)
  const relative = config.mode === "RELATIVE_TO_SHIFT"
  const structure = relative ? null : config.consolidatedStructure

  const population = structure
    ? (await resolveStructureAnchorOperatorIds(db, structure, consolidatedStructureAnchorId(structure))).length
    : (await resolveEligibleOperatorIds(db, organizationId, { scopeType: config.scopeType, teamId: config.teamId, subteamId: config.subteamId, populationFilter: config.populationFilter })).length

  const due = await planDueScheduleEnrollments(db, organizationId, config, { now: input.now, timezone })
  const pending = await withoutExistingEnrollments(db, input.workflowId, due)
  const scheduledFor = [...new Set(pending.map((slot) => slot.scheduledFor))].sort()

  let firstFireAt: string | null = scheduledFor[0] ?? null
  let enrollmentsPerOccurrence = structure ? (population > 0 ? 1 : 0) : population
  if (!firstFireAt) {
    if (relative) {
      const next = await nextRelativeFire(db, organizationId, config, input.now, timezone)
      firstFireAt = next.at
      enrollmentsPerOccurrence = next.withShift
    } else {
      const [next] = nextOccurrences(
        { times: config.times, intervalDays: config.intervalDays, anchorDate: config.anchorDate ?? null, frequency: config.frequency ?? undefined },
        { timezone, from: input.now, count: 1 },
      )
      firstFireAt = next?.iso ?? null
    }
  }

  return {
    mode: relative ? "RELATIVE_TO_SHIFT" : "CALENDAR",
    evaluation: structure ? "CONSOLIDATED" : "INDIVIDUAL",
    population,
    enrollmentsPerOccurrence,
    immediate: { enrollments: pending.length, alreadyEnrolled: due.length - pending.length, scheduledFor },
    firstFireAt,
    firesImmediately: pending.length > 0,
    timezone,
  }
}

/** Slots que o índice único deixaria passar (o checador nunca duplica um slot já matriculado). */
async function withoutExistingEnrollments(db: Database, workflowId: string, slots: DueScheduleSlot[]): Promise<DueScheduleSlot[]> {
  if (slots.length === 0) return []
  const existing = await db.query<{ subject_id: string; scheduled_for: string }>(
    `select scheduled_subject_id subject_id, scheduled_for::text scheduled_for
       from workflow_enrollments
      where workflow_id = $1 and scheduled_subject_id = any($2::uuid[]) and scheduled_for = any($3::timestamptz[])`,
    [workflowId, [...new Set(slots.map((slot) => slot.subjectId))], [...new Set(slots.map((slot) => slot.scheduledFor))]],
  )
  const taken = new Set(existing.rows.map((row) => `${row.subject_id}|${new Date(row.scheduled_for).toISOString()}`))
  return slots.filter((slot) => !taken.has(`${slot.subjectId}|${new Date(slot.scheduledFor).toISOString()}`))
}

/** Próximo disparo da Agenda relativa: o primeiro instante FUTURO, entre os colaboradores com jornada, no próximo dia útil assumido. */
async function nextRelativeFire(db: Database, organizationId: string, config: ScheduleConfiguration, now: Date, timezone: string): Promise<{ at: string | null; withShift: number }> {
  if (!config.relative) return { at: null, withShift: 0 }
  const operatorIds = await resolveEligibleOperatorIds(db, organizationId, { scopeType: config.scopeType, teamId: config.teamId, subteamId: config.subteamId, populationFilter: config.populationFilter })
  if (operatorIds.length === 0) return { at: null, withShift: 0 }
  let date = localDateParts(now, timezone).date
  for (let guard = 0; guard < 8; guard++, date = addDays(date, 1)) {
    if (!isAssumedWorkday(date)) continue
    const shifts = await loadShiftsOn(db, operatorIds, date)
    const instants = operatorIds
      .map((id) => shifts.get(id))
      .flatMap((shift) => (shift ? [resolveRelativeInstant(shift, config.relative!, date, timezone)] : []))
      .filter((instant): instant is Date => instant !== null && instant.getTime() > now.getTime())
    if (instants.length > 0) return { at: new Date(Math.min(...instants.map((instant) => instant.getTime()))).toISOString(), withShift: shifts.size }
  }
  return { at: null, withShift: 0 }
}

const CONFIRMATION_CODES: Record<GoLiveReason, string> = {
  PUBLISH: "WORKFLOW_PUBLISH_CONFIRMATION_REQUIRED",
  ACTIVATE: "WORKFLOW_ACTIVATION_CONFIRMATION_REQUIRED",
}

/** Recusa (409 com o impacto em `details.impact`) quando o impacto exige confirmação e o pedido não trouxe o fingerprint dele. */
export function assertGoLiveConfirmed(impact: GoLiveImpact, confirmation: string | null | undefined): void {
  if (!impact.requiresConfirmation || confirmation === impact.fingerprint) return
  const action = impact.reason === "PUBLISH" ? "publicar" : "ativar"
  const message = confirmation
    ? `O impacto mudou desde a confirmação. Revise os números atualizados e confirme de novo para ${action}.`
    : `Confirme o impacto para ${action}: ${describeGoLiveImpact(impact)}`
  throw new DomainError(message, CONFIRMATION_CODES[impact.reason], 409, { impact })
}

/** Frase curta do impacto (mensagem do 409 e auditoria) — a tela monta a sua própria apresentação. */
export function describeGoLiveImpact(impact: GoLiveImpact): string {
  const schedule = impact.schedule
  if (!schedule) return "nenhuma execução é criada ao entrar no ar."
  const parts: string[] = []
  if (schedule.immediate.enrollments > 0) parts.push(`${schedule.immediate.enrollments} execução(ões) começam em até 1 minuto (horário de hoje que já passou)`)
  parts.push(`${schedule.population} pessoa(s) por ocorrência`)
  return `${parts.join("; ")}.`
}
