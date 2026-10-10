import type { Database } from "../../../infrastructure/database/pool.js"
import { systemClock, type Clock } from "../../../shared/domain/clock.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { loadWorkActivityEvidenceSources, resolveWorkdaysBySubject } from "../../indicators/application/operational-measurement-resolver.js"
import { DEFAULT_ORGANIZATION_TIMEZONE } from "../../workflows/application/organization-timezone.js"
import { localDateOf, startOfLocalDate } from "../../workflows/application/time-window.js"
import { EMPLOYMENT_STATUS_LABELS } from "../domain/employment-status.js"
import { SCHEDULE_EXCEPTION_LABELS, type ScheduleExceptionCode } from "../domain/schedule-exception.js"
import { describeWorkActivityEvidence, evidenceSourcesEnabled, type WorkActivityEvidenceSources } from "../domain/work-activity-evidence.js"
import { SCHEDULE_BASIS_LABELS } from "../domain/work-schedule.js"
import type { ResolvedWorkday } from "../domain/workday-resolution.js"
import { WORKDAY_AVAILABILITY_LABELS, type WorkdayAvailabilityState, type WorkdayDataAvailability } from "../domain/workday-data-availability.js"
import { describeWorkdayClassification, type JustifiedAbsenceReason, type WorkdayClassificationKind } from "../domain/workday-classification.js"
import { syncDataAvailabilityAlerts, type AvailabilityAlertReport } from "./data-availability-alert-service.js"
import { provisionScheduleExceptions, type Queryable } from "./schedule-exception-service.js"
import { classifyWorkday, listPeopleWithActiveClassifications, supersedeClassificationBySystem } from "./workday-classification-service.js"

/**
 * RECONCILIAÇÃO DE DIAS DE TRABALHO — job determinístico (sem IA) que compara PLANEJADO × OBSERVADO
 * nos últimos dias e registra o que diverge, sempre idempotente (uma linha por pessoa × data × tipo):
 *
 *  - MISSING_EXPECTED_PRODUCTION: EM_PRODUCAO + programado + sem exceção + turno encerrado + fontes
 *    relevantes JÁ FECHADAS e confiáveis (people/domain/workday-data-availability.ts) + NENHUMA evidência
 *    → PENDÊNCIA para o Supervisor ("Produção não identificada após o fechamento das fontes"). Antes do
 *    prazo das fontes (D-1/D-2, RH) o dia fica AGUARDANDO; fonte atrasada gera alerta administrativo de
 *    DADO (data-availability-alert-service.ts), nunca milhares de pendências individuais.
 *    A pendência é um estado INTERMEDIÁRIO: só uma pessoa autorizada classifica (falta injustificada /
 *    ausência justificada / trabalhou — dados não chegaram) ou corrige o planejamento. A INIA NUNCA cria
 *    exceção nem falta sozinha. Se a carga atrasada chega depois, a pendência é resolvida automaticamente
 *    como PRODUCTION_RECEIVED_AFTER_ALERT; se uma exceção/escala/situação passa a dizer que a pessoa não
 *    deveria produzir, PLAN_UPDATED_AFTER_ALERT.
 *  - Classificação já feita e a verdade chega depois: produção real → a classificação vigente é marcada
 *    CONTRADICTED_BY_WORK_EVIDENCE (o dia vira trabalhado; o histórico fica); RH informa férias/INSS →
 *    SUPERSEDED_BY_AUTHORITATIVE_STATUS. Nunca apagada, nunca reescrita.
 *  - PRODUCTION_ON_NON_WORKING_DAY: produção observada em dia planejado como folga/day off/banco → aviso
 *    (NOTED). Divergência plano × realidade, não necessariamente erro (hora extra, mudança operacional).
 *    O dia é tratado como TRABALHADO; a exceção/folga NÃO é apagada.
 *  - PRODUCTION_WITH_NON_ELIGIBLE_STATUS: produção observada com situação ≠ EM_PRODUCAO → inconsistência
 *    de dados (NOTED). A situação funcional é soberana e NÃO muda automaticamente.
 *
 * Só avalia quando a organização tem ao menos uma fonte de evidência (interações ou indicador marcado
 * como prova) — sem fonte, "sem evidência" não significa nada e ninguém é cobrado. Só depois do turno
 * (`shift_end` da escala) ou, sem turno informado, depois de a data operacional encerrar no fuso da org.
 * O sino reaproveita `alerts` (dedupe_key determinístico); a fila reaproveita a Surface Pendências.
 */
export const RECONCILIATION_LOOKBACK_DAYS = 7

export const RECONCILIATION_KINDS = ["MISSING_EXPECTED_PRODUCTION", "PRODUCTION_ON_NON_WORKING_DAY", "PRODUCTION_WITH_NON_ELIGIBLE_STATUS"] as const
export type ReconciliationKind = (typeof RECONCILIATION_KINDS)[number]
export const RECONCILIATION_KIND_LABELS: Record<ReconciliationKind, string> = {
  MISSING_EXPECTED_PRODUCTION: "Produção não identificada",
  PRODUCTION_ON_NON_WORKING_DAY: "Produção em dia planejado como não trabalhado",
  PRODUCTION_WITH_NON_ELIGIBLE_STATUS: "Produção com situação funcional não produtiva",
}

export type ReconciliationStatus = "OPEN" | "NOTED" | "RESOLVED"
/**
 * NOT_WORKED = legado (criava exceção); as decisões humanas atuais são CLASSIFICAÇÕES revisáveis.
 * SOURCES_STILL_OPEN / DATA_SOURCE_DELAYED / STATUS_NON_PRODUCTIVE = resoluções da REAVALIAÇÃO pela regra
 * atual (fim do turno ≠ dado fechado): pendências abertas por uma regra anterior são reavaliadas em cada
 * rodada e encerradas com o motivo — nunca apagadas.
 */
export const RECONCILIATION_RESOLUTIONS = ["NOT_WORKED", "UNJUSTIFIED_ABSENCE", "JUSTIFIED_ABSENCE", "WORKED_DATA_MISSING", "SCHEDULE_CORRECTED", "PRODUCTION_RECEIVED_AFTER_ALERT", "PLAN_UPDATED_AFTER_ALERT", "SOURCES_STILL_OPEN", "DATA_SOURCE_DELAYED", "STATUS_NON_PRODUCTIVE"] as const
export type ReconciliationResolution = (typeof RECONCILIATION_RESOLUTIONS)[number]
export const RECONCILIATION_RESOLUTION_LABELS: Record<ReconciliationResolution, string> = {
  NOT_WORKED: "Não trabalhou (exceção registrada)",
  UNJUSTIFIED_ABSENCE: "Falta injustificada",
  JUSTIFIED_ABSENCE: "Ausência justificada",
  WORKED_DATA_MISSING: "Trabalhou — dados não chegaram",
  SCHEDULE_CORRECTED: "Planejamento corrigido",
  PRODUCTION_RECEIVED_AFTER_ALERT: "Produção recebida após o alerta",
  PLAN_UPDATED_AFTER_ALERT: "Plano atualizado após o alerta",
  SOURCES_STILL_OPEN: "Fontes ainda dentro do prazo (reavaliada)",
  DATA_SOURCE_DELAYED: "Fonte de dados atrasada (reavaliada)",
  STATUS_NON_PRODUCTIVE: "Situação funcional não produtiva (reavaliada)",
}

export const ALERT_TYPE_BY_KIND: Record<ReconciliationKind, string> = {
  MISSING_EXPECTED_PRODUCTION: "WORKDAY_MISSING_PRODUCTION",
  PRODUCTION_ON_NON_WORKING_DAY: "WORKDAY_PRODUCTION_DIVERGENCE",
  PRODUCTION_WITH_NON_ELIGIBLE_STATUS: "WORKDAY_STATUS_INCONSISTENCY",
}

/** Aviso ao Supervisor quando uma classificação dele foi superada por fato posterior (produção real / RH). */
export const CLASSIFICATION_SUPERSEDED_ALERT_TYPE = "WORKDAY_CLASSIFICATION_SUPERSEDED"
/** Janela em que o job revisa classificações vigentes contra dados tardios (produção/RH). */
export const CLASSIFICATION_REVIEW_DAYS = 30

export function reconciliationDedupeKey(kind: ReconciliationKind, personId: string, workday: string): string {
  return `workday_reconciliation:${kind}:${personId}:${workday}`
}

export type WorkdaySnapshot = {
  state: ResolvedWorkday["state"]
  plannedToWork: boolean
  plannedBasis: string
  plannedCause: ResolvedWorkday["plannedCause"]
  exceptionCode: ScheduleExceptionCode | null
  status: string | null
  shiftEnd: string | null
  evidence: string | null
  evidenceSources: WorkActivityEvidenceSources
  /** Disponibilidade dos dados no momento da detecção (fontes fechadas? qual prazo decidiu?). */
  availability?: { state: WorkdayAvailabilityState; label: string; workActivityExpectedAt: string | null; employmentExpectedAt: string | null }
}

export type ReconciliationRow = {
  id: string
  organizationId: string
  personId: string
  workday: string
  kind: ReconciliationKind
  status: ReconciliationStatus
  snapshot: WorkdaySnapshot
  recipientPersonId: string | null
  alertId: string | null
  resolution: ReconciliationResolution | null
  resolutionExceptionId: string | null
  /** Classificação vigente que resolveu a pendência (falta injustificada / ausência justificada / dados não chegaram). */
  classificationId: string | null
  resolvedByPersonId: string | null
  resolvedAt: string | null
  detectedAt: string
}

type DbRow = { id: string; organization_id: string; person_id: string; workday: string; kind: ReconciliationKind; status: ReconciliationStatus; snapshot: WorkdaySnapshot; recipient_person_id: string | null; alert_id: string | null; resolution: ReconciliationResolution | null; resolution_exception_id: string | null; classification_id?: string | null; resolved_by_person_id: string | null; resolved_at: string | null; detected_at: string }

const COLUMNS = `id, organization_id, person_id, to_char(workday, 'YYYY-MM-DD') workday, kind, status, snapshot, recipient_person_id, alert_id, resolution, resolution_exception_id, classification_id, resolved_by_person_id, resolved_at, detected_at`

export function toReconciliation(row: DbRow): ReconciliationRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    personId: row.person_id,
    workday: row.workday,
    kind: row.kind,
    status: row.status,
    snapshot: row.snapshot,
    recipientPersonId: row.recipient_person_id,
    alertId: row.alert_id,
    resolution: row.resolution,
    resolutionExceptionId: row.resolution_exception_id,
    classificationId: row.classification_id ?? null,
    resolvedByPersonId: row.resolved_by_person_id,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    detectedAt: new Date(row.detected_at).toISOString(),
  }
}

function formatDay(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

export function snapshotOf(day: ResolvedWorkday, shiftEnd: string | null, sources: WorkActivityEvidenceSources, availability?: WorkdayDataAvailability): WorkdaySnapshot {
  return {
    state: day.state,
    plannedToWork: day.plannedToWork,
    plannedBasis: day.planned.basis,
    plannedCause: day.plannedCause,
    exceptionCode: day.planned.exception?.code ?? null,
    status: day.status,
    shiftEnd,
    evidence: day.evidence ? describeWorkActivityEvidence(day.evidence) : null,
    evidenceSources: sources,
    ...(availability ? { availability: { state: availability.state, label: WORKDAY_AVAILABILITY_LABELS[availability.state], workActivityExpectedAt: availability.workActivity.expectedAt, employmentExpectedAt: availability.employment.expectedAt } } : {}),
  }
}

export function describeSnapshotPlan(snapshot: WorkdaySnapshot): string {
  if (snapshot.exceptionCode) return `${SCHEDULE_EXCEPTION_LABELS[snapshot.exceptionCode]} (exceção registrada)`
  if (snapshot.status && snapshot.status !== "EM_PRODUCAO") return EMPLOYMENT_STATUS_LABELS[snapshot.status as keyof typeof EMPLOYMENT_STATUS_LABELS] ?? snapshot.status
  const basis = SCHEDULE_BASIS_LABELS[snapshot.plannedBasis as keyof typeof SCHEDULE_BASIS_LABELS] ?? snapshot.plannedBasis
  return snapshot.plannedToWork ? `Trabalha — ${basis.toLowerCase()}${snapshot.shiftEnd ? ` · turno até ${snapshot.shiftEnd.slice(0, 5)}` : ""}` : `Não trabalha — ${basis.toLowerCase()}`
}

function describeSources(sources: WorkActivityEvidenceSources): string {
  const parts: string[] = []
  if (sources.interactions) parts.push("interações")
  if (sources.indicatorCodes.length > 0) parts.push(`indicador(es) ${sources.indicatorCodes.join(", ")}`)
  return parts.join(" e ")
}

export function alertTextFor(kind: ReconciliationKind, personName: string, workday: string, snapshot: WorkdaySnapshot): { title: string; description: string; severity: "INFO" | "MEDIUM" | "HIGH" } {
  const day = formatDay(workday)
  switch (kind) {
    case "MISSING_EXPECTED_PRODUCTION":
      return { title: "Produção não identificada após o fechamento das fontes", description: `Não foi identificada produção para ${personName} em ${day} depois de as fontes fecharem. Plano: ${describeSnapshotPlan(snapshot)}. Fontes de evidência: ${describeSources(snapshot.evidenceSources)}. Classifique o que aconteceu na Surface Pendências (falta injustificada, ausência justificada, trabalhou — dados não chegaram, ou corrigir planejamento).`, severity: "MEDIUM" }
    case "PRODUCTION_ON_NON_WORKING_DAY":
      return { title: "Produção em dia planejado como não trabalhado", description: `Produção detectada para ${personName} em ${day} (${snapshot.evidence ?? "evidência registrada"}) num dia planejado como ${snapshot.exceptionCode ? SCHEDULE_EXCEPTION_LABELS[snapshot.exceptionCode].toLowerCase() : snapshot.plannedCause === "HOLIDAY" ? "feriado" : "folga"}. O dia é tratado como trabalhado; o planejamento fica registrado.`, severity: "INFO" }
    case "PRODUCTION_WITH_NON_ELIGIBLE_STATUS":
      return { title: "Inconsistência: produção com situação funcional não produtiva", description: `Produção detectada para ${personName} em ${day} (${snapshot.evidence ?? "evidência registrada"}) com situação funcional "${describeSnapshotPlan(snapshot)}". A situação funcional não foi alterada — verifique a fonte de situação na Central de Dados.`, severity: "MEDIUM" }
  }
}

export type ReconciliationRunReport = { organizations: number; opened: number; noted: number; autoResolved: number; skippedNoSources: number; waiting: number; delayed: number; supersededClassifications: number; /** Pendências abertas por regra anterior encerradas nesta rodada pela regra atual (SOURCES_STILL_OPEN / DATA_SOURCE_DELAYED / STATUS_NON_PRODUCTIVE / classificação). */ reviewedLegacy: number; availabilityAlerts: AvailabilityAlertReport }

const emptyReport = (): Omit<ReconciliationRunReport, "organizations"> => ({ opened: 0, noted: 0, autoResolved: 0, skippedNoSources: 0, waiting: 0, delayed: 0, supersededClassifications: 0, reviewedLegacy: 0, availabilityAlerts: { created: 0, resolved: 0, delayedSourceDays: 0 } })

/** Roda para todas as organizações (ticker do servidor e `npm run calendar:reconcile`). O instante vem do Clock. */
export async function runWorkdayReconciliation(db: Database, clock: Clock | Date = systemClock): Promise<ReconciliationRunReport> {
  const now = clock instanceof Date ? clock : clock.now()
  const organizations = await db.query<{ id: string; timezone: string | null }>(`select o.id, (select op.timezone from operations op where op.organization_id = o.id order by op.created_at limit 1) timezone from organizations o`)
  const report: ReconciliationRunReport = { organizations: 0, ...emptyReport() }
  for (const organization of organizations.rows) {
    const partial = await reconcileOrganizationWorkdays(db, organization.id, organization.timezone ?? DEFAULT_ORGANIZATION_TIMEZONE, now)
    report.organizations += 1
    report.opened += partial.opened
    report.noted += partial.noted
    report.autoResolved += partial.autoResolved
    report.skippedNoSources += partial.skippedNoSources
    report.waiting += partial.waiting
    report.delayed += partial.delayed
    report.supersededClassifications += partial.supersededClassifications
    report.reviewedLegacy += partial.reviewedLegacy
    report.availabilityAlerts.created += partial.availabilityAlerts.created
    report.availabilityAlerts.resolved += partial.availabilityAlerts.resolved
    report.availabilityAlerts.delayedSourceDays += partial.availabilityAlerts.delayedSourceDays
  }
  return report
}

async function createAlert(db: Queryable, input: { organizationId: string; recipientId: string; kind: ReconciliationKind; personId: string; workday: string; personName: string; snapshot: WorkdaySnapshot; now: Date }): Promise<string | null> {
  const text = alertTextFor(input.kind, input.personName, input.workday, input.snapshot)
  const result = await db.query<{ id: string }>(
    `insert into alerts (organization_id, recipient_id, title, description, severity, alert_type, dedupe_key, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (dedupe_key) do nothing returning id`,
    [input.organizationId, input.recipientId, text.title, text.description, text.severity, ALERT_TYPE_BY_KIND[input.kind], reconciliationDedupeKey(input.kind, input.personId, input.workday), input.now],
  )
  if (result.rows[0]) return result.rows[0].id
  const existing = await db.query<{ id: string }>(`select id from alerts where dedupe_key = $1`, [reconciliationDedupeKey(input.kind, input.personId, input.workday)])
  return existing.rows[0]?.id ?? null
}

async function resolveAlert(db: Queryable, alertId: string | null, now: Date): Promise<void> {
  if (!alertId) return
  await db.query(`update alerts set status = 'RESOLVED', resolved_at = $2 where id = $1 and status <> 'RESOLVED'`, [alertId, now])
}

/**
 * Reconciliação de UMA organização nos últimos `lookbackDays` (inclui hoje, para turnos já encerrados).
 * Uma resolução em lote (`resolveWorkdaysBySubject`) para todos os operadores ativos — nunca por pessoa;
 * uma segunda, só para quem tem classificação vigente nos últimos CLASSIFICATION_REVIEW_DAYS, revisa se
 * dados tardios (produção real / situação autoritativa) contrariaram a classificação.
 */
export async function reconcileOrganizationWorkdays(db: Database, organizationId: string, timeZone: string, now: Date, options: { lookbackDays?: number; classificationReviewDays?: number } = {}): Promise<Omit<ReconciliationRunReport, "organizations">> {
  const report = emptyReport()
  const sources = await loadWorkActivityEvidenceSources(db, organizationId)
  const today = localDateOf(now, timeZone)
  const lookback = options.lookbackDays ?? RECONCILIATION_LOOKBACK_DAYS
  const daysAgo = (days: number) => new Date(new Date(`${today}T00:00:00Z`).getTime() - days * 86_400_000).toISOString().slice(0, 10)
  const firstDate = daysAgo(lookback)
  const window = { start: startOfLocalDate(firstDate, timeZone), end: now }
  const people = await db.query<{ id: string; name: string; reports_to_id: string | null }>(`select id, name, reports_to_id from people where organization_id = $1 and active and role = 'OPERATOR' order by id`, [organizationId])
  if (people.rowCount === 0) return report
  const ids = people.rows.map((row) => row.id)
  const personById = new Map(people.rows.map((row) => [row.id, row]))
  const existing = await db.query<DbRow>(`select ${COLUMNS} from workday_reconciliations where organization_id = $1 and workday between $2::date and $3::date`, [organizationId, firstDate, today])
  const existingByKey = new Map(existing.rows.map((row) => [`${row.kind}|${row.person_id}|${row.workday}`, toReconciliation(row)]))
  if (!evidenceSourcesEnabled(sources)) {
    report.skippedNoSources = 1
    return report
  }
  const workdays = await resolveWorkdaysBySubject(db, ids, window, timeZone, { now, evidenceSources: sources })
  const availability = [...workdays.values()][0]?.availability ?? new Map<string, WorkdayDataAvailability>()
  const schedule = await db.query<{ person_id: string; schedule_date: string; shift_end: string | null }>(`select person_id, schedule_date::text schedule_date, shift_end::text shift_end from employee_schedule_days where person_id = any($1::uuid[]) and schedule_date between $2::date and $3::date`, [ids, firstDate, today])
  const shiftEndByKey = new Map(schedule.rows.map((row) => [`${row.person_id}|${row.schedule_date}`, row.shift_end]))
  const exceptionIds = new Map<string, string>()
  const openMissing = [...existingByKey.values()].filter((row) => row.kind === "MISSING_EXPECTED_PRODUCTION" && row.status === "OPEN")
  if (openMissing.length > 0) {
    const activeExceptions = await db.query<{ id: string; person_id: string; exception_date: string }>(`select id, person_id, to_char(exception_date, 'YYYY-MM-DD') exception_date from employee_schedule_exceptions where active and person_id = any($1::uuid[]) and exception_date between $2::date and $3::date order by created_at`, [openMissing.map((row) => row.personId), firstDate, today])
    for (const row of activeExceptions.rows) if (!exceptionIds.has(`${row.person_id}|${row.exception_date}`)) exceptionIds.set(`${row.person_id}|${row.exception_date}`, row.id)
  }
  const reviewed = new Set<string>()
  for (const person of people.rows) {
    const subject = workdays.get(person.id)
    if (!subject) continue
    for (const day of subject.days) {
      const shiftEnd = shiftEndByKey.get(`${person.id}|${day.date}`) ?? null
      const snapshot = snapshotOf(day, shiftEnd, sources, availability.get(day.date))
      const missingKey = `MISSING_EXPECTED_PRODUCTION|${person.id}|${day.date}`
      const open = existingByKey.get(missingKey)
      if (day.state === "WAITING_FOR_SOURCES") report.waiting += 1
      if (day.state === "DATA_SOURCE_DELAY") report.delayed += 1
      reviewed.add(`${person.id}|${day.date}`)
      report.supersededClassifications += await reviewClassification(db, organizationId, person, day, snapshot, now)
      // Pendência ABERTA reavaliada pela regra ATUAL (inclui as abertas por uma regra anterior — upgrade sem
      // apagar nada): produção chegou → resolvida; fontes ainda no prazo / fonte atrasada / situação não
      // produtiva / plano ou classificação explicam o dia → resolvida com o motivo; só MISSING continua aberta.
      if (open && open.status === "OPEN") {
        if (day.state === "WORKED_OBSERVED") {
          await db.query(`update workday_reconciliations set status = 'RESOLVED', resolution = 'PRODUCTION_RECEIVED_AFTER_ALERT', resolved_at = $3, snapshot = snapshot || $2::jsonb, updated_at = $3 where id = $1`, [open.id, JSON.stringify({ evidence: snapshot.evidence, receivedAfterAlert: true }), now])
          await resolveAlert(db, open.alertId, now)
          report.autoResolved += 1
          continue
        }
        const review = legacyReviewOf(day)
        if (review) {
          const exceptionId = day.plannedCause === "EXCEPTION" ? (exceptionIds.get(`${person.id}|${day.date}`) ?? null) : null
          await db.query(
            `update workday_reconciliations set status = 'RESOLVED', resolution = $2, resolution_exception_id = $3, classification_id = coalesce(classification_id, $4), resolved_at = $5, snapshot = snapshot || $6::jsonb, updated_at = $5 where id = $1`,
            [open.id, review.resolution, exceptionId, day.classification?.id ?? null, now, JSON.stringify({ reviewedByCurrentRule: { state: day.state, availability: day.availability, resolution: review.resolution, reason: review.reason, at: now.toISOString() } })],
          )
          await resolveAlert(db, open.alertId, now)
          if (review.resolution === "PLAN_UPDATED_AFTER_ALERT") report.autoResolved += 1
          else report.reviewedLegacy += 1
          continue
        }
      }
      // Só depois de as fontes fecharem e serem confiáveis — nunca pelo simples fim do turno.
      if (day.state === "MISSING_EXPECTED_PRODUCTION" && !open) {
        const alertId = person.reports_to_id ? await createAlert(db, { organizationId, recipientId: person.reports_to_id, kind: "MISSING_EXPECTED_PRODUCTION", personId: person.id, workday: day.date, personName: person.name, snapshot, now }) : null
        await db.query(
          `insert into workday_reconciliations (organization_id, person_id, workday, kind, status, snapshot, recipient_person_id, alert_id, detected_at, updated_at) values ($1, $2, $3::date, 'MISSING_EXPECTED_PRODUCTION', 'OPEN', $4, $5, $6, $7, $7) on conflict (person_id, workday, kind) do nothing`,
          [organizationId, person.id, day.date, JSON.stringify(snapshot), person.reports_to_id, alertId, now],
        )
        report.opened += 1
        continue
      }
      // Divergência plano × realidade só quando o PLANO era um fato (escala explícita, exceção registrada,
      // feriado com política): fim de semana do fallback seg–sex e 6x1 sem calendário são presunção/desconhecido —
      // o dia vira trabalhado sem aviso (o perfil mostra "trabalhou fora do plano" mesmo assim).
      const explicitPlan = day.plannedCause === "EXCEPTION" || day.plannedCause === "HOLIDAY" || (day.plannedCause === "SCHEDULED_DAY_OFF" && day.planned.basis === "EXPLICIT_SCHEDULE")
      const informational: ReconciliationKind | null = day.conflict === "PRODUCTION_WITH_NON_ELIGIBLE_STATUS" ? "PRODUCTION_WITH_NON_ELIGIBLE_STATUS" : day.state === "WORKED_OBSERVED" && day.overridesPlan && explicitPlan ? "PRODUCTION_ON_NON_WORKING_DAY" : null
      if (informational && !existingByKey.has(`${informational}|${person.id}|${day.date}`)) {
        const alertId = person.reports_to_id ? await createAlert(db, { organizationId, recipientId: person.reports_to_id, kind: informational, personId: person.id, workday: day.date, personName: person.name, snapshot, now }) : null
        await db.query(
          `insert into workday_reconciliations (organization_id, person_id, workday, kind, status, snapshot, recipient_person_id, alert_id, detected_at, updated_at) values ($1, $2, $3::date, $4, 'NOTED', $5, $6, $7, $8, $8) on conflict (person_id, workday, kind) do nothing`,
          [organizationId, person.id, day.date, informational, JSON.stringify(snapshot), person.reports_to_id, alertId, now],
        )
        report.noted += 1
      }
    }
  }
  // Fonte atrasada = alerta administrativo de DADO (por fonte × dia), nunca pendência por pessoa.
  report.availabilityAlerts = await syncDataAvailabilityAlerts(db, organizationId, availability, now)
  // Classificações vigentes mais antigas que a janela: dados tardios (produção/RH) ainda podem contrariá-las.
  const reviewDays = options.classificationReviewDays ?? CLASSIFICATION_REVIEW_DAYS
  if (reviewDays > lookback) {
    const classifiedIds = (await listPeopleWithActiveClassifications(db, organizationId, daysAgo(reviewDays), daysAgo(lookback + 1))).filter((id) => personById.has(id))
    if (classifiedIds.length > 0) {
      const olderWindow = { start: startOfLocalDate(daysAgo(reviewDays), timeZone), end: startOfLocalDate(firstDate, timeZone) }
      const older = await resolveWorkdaysBySubject(db, classifiedIds, olderWindow, timeZone, { now, evidenceSources: sources })
      for (const [personId, subject] of older) {
        const person = personById.get(personId)!
        for (const day of subject.days) {
          if (reviewed.has(`${personId}|${day.date}`)) continue
          report.supersededClassifications += await reviewClassification(db, organizationId, person, day, snapshotOf(day, null, sources), now)
        }
      }
    }
  }
  return report
}

/**
 * REAVALIAÇÃO de uma pendência aberta pela regra atual — o motivo pelo qual ela deixa de existir.
 * Só MISSING_EXPECTED_PRODUCTION (e PLANNED_WORK, quando a disponibilidade voltou a ser desconhecida)
 * mantêm a pendência aberta; qualquer outro estado explica o dia sem o Supervisor.
 */
export function legacyReviewOf(day: ResolvedWorkday): { resolution: ReconciliationResolution; reason: string } | null {
  switch (day.state) {
    case "MISSING_EXPECTED_PRODUCTION":
    case "PLANNED_WORK":
      return null
    case "WAITING_FOR_SOURCES":
      return { resolution: "SOURCES_STILL_OPEN", reason: "os dados que poderiam explicar o dia ainda não deveriam ter chegado (SLA D-1/D-2 ou RH dentro do prazo)" }
    case "DATA_SOURCE_DELAY":
      return { resolution: "DATA_SOURCE_DELAYED", reason: "fonte relevante não entregou no prazo — problema de dado (alerta administrativo), não ausência do colaborador" }
    case "NON_ELIGIBLE_EMPLOYMENT_STATUS":
    case "BEFORE_HIRE":
      return { resolution: "STATUS_NON_PRODUCTIVE", reason: `situação funcional ${day.status ?? "anterior à admissão"} — não deveria produzir` }
    case "CLASSIFIED_UNJUSTIFIED_ABSENCE":
      return { resolution: "UNJUSTIFIED_ABSENCE", reason: "classificação humana vigente" }
    case "CLASSIFIED_JUSTIFIED_ABSENCE":
      return { resolution: "JUSTIFIED_ABSENCE", reason: "classificação humana vigente" }
    case "CLASSIFIED_WORKED_DATA_MISSING":
      return { resolution: "WORKED_DATA_MISSING", reason: "classificação humana vigente" }
    case "PLANNED_NON_WORKING":
    case "INDETERMINATE":
      return { resolution: "PLAN_UPDATED_AFTER_ALERT", reason: "o plano (exceção, escala ou feriado) passou a dizer que a pessoa não deveria produzir" }
    case "WORKED_OBSERVED":
      return { resolution: "PRODUCTION_RECEIVED_AFTER_ALERT", reason: "produção observada" }
  }
}

/**
 * Classificação humana vigente contrariada por fato mais forte — marcada no histórico (nunca apagada) e
 * o Supervisor é avisado. Idempotente: a segunda passagem não encontra classificação vigente.
 */
async function reviewClassification(db: Database, organizationId: string, person: { id: string; name: string; reports_to_id: string | null }, day: ResolvedWorkday, snapshot: WorkdaySnapshot, now: Date): Promise<number> {
  if (!day.classification || !day.classificationContradictedBy) return 0
  const reason = day.classificationContradictedBy === "WORK_EVIDENCE" ? "CONTRADICTED_BY_WORK_EVIDENCE" : "SUPERSEDED_BY_AUTHORITATIVE_STATUS"
  const superseded = await supersedeClassificationBySystem(db, { organizationId, classificationId: day.classification.id, reason, detail: { personId: person.id, workday: day.date, evidence: snapshot.evidence, status: day.status }, now })
  if (!superseded) return 0
  await db.query(`update workday_reconciliations set snapshot = snapshot || $2::jsonb, updated_at = $3 where classification_id = $1`, [day.classification.id, JSON.stringify({ classificationSuperseded: reason, receivedAfterAlert: day.classificationContradictedBy === "WORK_EVIDENCE" }), now])
  if (person.reports_to_id) {
    const label = describeWorkdayClassification(day.classification)
    const text = day.classificationContradictedBy === "WORK_EVIDENCE"
      ? { title: "Produção recebida após a classificação", description: `${person.name} em ${formatDay(day.date)} estava classificado(a) como "${label}", mas chegou evidência de trabalho (${snapshot.evidence ?? "produção registrada"}). O dia passa a contar como trabalhado; a classificação anterior fica no histórico como contrariada por evidência posterior.` }
      : { title: "Situação funcional recebida após a classificação", description: `${person.name} em ${formatDay(day.date)} estava classificado(a) como "${label}", mas a fonte autoritativa informou situação "${snapshot.status ? (EMPLOYMENT_STATUS_LABELS[snapshot.status as keyof typeof EMPLOYMENT_STATUS_LABELS] ?? snapshot.status) : "não produtiva"}". A situação funcional prevalece; o dia deixa de contar e a classificação anterior fica preservada no histórico.` }
    await db.query(
      `insert into alerts (organization_id, recipient_id, title, description, severity, alert_type, dedupe_key, created_at) values ($1, $2, $3, $4, 'INFO', $5, $6, $7) on conflict (dedupe_key) do nothing`,
      [organizationId, person.reports_to_id, text.title, text.description, CLASSIFICATION_SUPERSEDED_ALERT_TYPE, `workday_reconciliation:CLASSIFICATION_SUPERSEDED:${person.id}:${day.date}:${day.classification.id}`, now],
    )
  }
  return 1
}

// ---------------------------------------------------------------------------------------------
// Resolução pelo Supervisor (Surface Pendências)
// ---------------------------------------------------------------------------------------------
export type SupervisorResolutionInput =
  | { resolution: "UNJUSTIFIED_ABSENCE" }
  | { resolution: "JUSTIFIED_ABSENCE"; reasonCode: JustifiedAbsenceReason }
  | { resolution: "WORKED_DATA_MISSING" }
  | { resolution: "SCHEDULE_CORRECTED" }

export async function loadReconciliation(db: Queryable, organizationId: string, id: string): Promise<ReconciliationRow | null> {
  const result = await db.query<DbRow>(`select ${COLUMNS} from workday_reconciliations where organization_id = $1 and id = $2`, [organizationId, id])
  return result.rows[0] ? toReconciliation(result.rows[0]) : null
}

/**
 * Decisão do Supervisor sobre "Produção não identificada após o fechamento das fontes":
 *  - FALTA INJUSTIFICADA: classificação (revisável) — o dia CONTINUA esperado/elegível; a política de
 *    cada indicador decide contribuição zero × sem amostra; nenhuma medição é criada;
 *  - AUSÊNCIA JUSTIFICADA (motivo): classificação — o dia sai da elegibilidade; ATESTADO guarda só o motivo;
 *  - TRABALHOU — DADOS NÃO CHEGARAM: classificação — nada é inventado; indicadores seguem sem valor até
 *    o dado real chegar (aí a reconciliação é automática);
 *  - CORRIGIR PLANEJAMENTO: override operacional AJUSTE_ESCALA (a escala de origem não é adulterada).
 * Idempotente: repetir a mesma resolução devolve o estado. Uma classificação diferente da vigente é uma
 * REVISÃO (histórico preservado) — o mesmo caminho de "Editar classificação" no Calendário da equipe.
 */
export async function resolveReconciliation(db: Queryable, input: { organizationId: string; id: string; actorPersonId: string; decision: SupervisorResolutionInput; now?: Date }): Promise<ReconciliationRow> {
  const now = input.now ?? systemClock.now()
  const current = await loadReconciliation(db, input.organizationId, input.id)
  if (!current) throw new DomainError("Pendência não encontrada.", "PENDING_ACTION_NOT_FOUND", 404)
  if (current.kind !== "MISSING_EXPECTED_PRODUCTION") throw new DomainError("Este registro é informativo e não exige decisão.", "PENDING_ACTION_NOT_ACTIONABLE", 409)
  const classificationOf = (decision: SupervisorResolutionInput): WorkdayClassificationKind | null => (decision.resolution === "SCHEDULE_CORRECTED" ? null : decision.resolution)
  if (current.status === "RESOLVED") {
    if (current.resolution === input.decision.resolution && classificationOf(input.decision) === null) return current
    if (current.resolution === "PRODUCTION_RECEIVED_AFTER_ALERT" || current.resolution === "PLAN_UPDATED_AFTER_ALERT" || current.resolution === "SCHEDULE_CORRECTED" || current.resolution === "NOT_WORKED") {
      throw new DomainError("Esta pendência já foi resolvida.", "PENDING_ACTION_ALREADY_DECIDED", 409)
    }
  }
  const classification = classificationOf(input.decision)
  if (classification) {
    await classifyWorkday(db, { organizationId: input.organizationId, personId: current.personId, workday: current.workday, classification, reasonCode: input.decision.resolution === "JUSTIFIED_ABSENCE" ? input.decision.reasonCode : null, actorPersonId: input.actorPersonId, reconciliationId: current.id, now })
    await resolveAlert(db, current.alertId, now)
    return (await loadReconciliation(db, input.organizationId, input.id))!
  }
  const outcome = await provisionScheduleExceptions(db, { organizationId: input.organizationId, personId: current.personId, code: "AJUSTE_ESCALA", from: current.workday, to: current.workday, actorPersonId: input.actorPersonId, allowScheduleAdjustment: true })
  const exceptionId = [...outcome.created, ...outcome.reactivated, ...outcome.unchanged][0]?.id ?? null
  const updated = await db.query<DbRow>(
    `update workday_reconciliations set status = 'RESOLVED', resolution = 'SCHEDULE_CORRECTED', resolution_exception_id = $2, resolved_by_person_id = $3, resolved_at = $4, updated_at = $4 where id = $1 returning ${COLUMNS}`,
    [current.id, exceptionId, input.actorPersonId, now],
  )
  await resolveAlert(db, current.alertId, now)
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'WORKDAY_RECONCILIATION_RESOLVED', 'workday_reconciliation', $3, $4)`, [input.organizationId, input.actorPersonId, current.id, JSON.stringify({ personId: current.personId, workday: current.workday, resolution: "SCHEDULE_CORRECTED", exceptionId })])
  return toReconciliation(updated.rows[0]!)
}

/** Reconciliações de N pessoas num intervalo (Calendário da equipe / perfil). */
export async function listReconciliations(db: Queryable, input: { organizationId: string; personIds: string[]; from: string; to: string }): Promise<ReconciliationRow[]> {
  if (input.personIds.length === 0) return []
  const result = await db.query<DbRow>(`select ${COLUMNS} from workday_reconciliations where organization_id = $1 and person_id = any($2::uuid[]) and workday between $3::date and $4::date order by workday, detected_at`, [input.organizationId, input.personIds, input.from, input.to])
  return result.rows.map(toReconciliation)
}
