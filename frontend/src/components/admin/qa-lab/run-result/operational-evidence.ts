import { formatCivilDate } from "@/lib/format/date"
import { employmentStatusLabel, scheduleExceptionLabel } from "@/schemas/people/employment-status.schema"
import { formatNumber } from "../qa-lab-format"
import { AGGREGATION_LABELS } from "./run-format"

/** Evidência do cálculo operacional (camada 1) — vem pronta do resolvedor único do backend
 * (`OperationalEvidence`): janela, método, amostra/dias, cobertura, numerador/denominador. */
export type OperationalEvidence = {
  windowLabel: string
  aggregation: string
  aggregationKind: string
  method: string
  sampleCount: number
  daysWithData: number
  expectedDays: number | null
  coverage: number | null
  numerator: number | null
  denominator: number | null
  sampleTotal: number | null
  minimumCoverage?: number | null
  coverageSatisfied?: boolean | null
  /** Medições da janela em datas NÃO elegíveis (folga, day off, férias…) — preservadas, fora do cálculo. */
  ignoredMeasurements?: number
  /** Como os dias elegíveis foram formados (calendário, admissão, situação, exceções, escala, feriado). */
  eligibility?: {
    businessDays: number
    calendarDays?: number
    scheduledWorkDays?: number
    eligibleDays: number
    excludedBeforeHire: number
    excludedByStatus: Partial<Record<string, number>>
    excludedByScheduleException?: Partial<Record<string, number>>
    excludedByScheduledDayOff?: number
    excludedByHoliday?: number
    excludedByUnknownSchedule?: number
    statusConfidence?: { freshness: "FRESH" | "STALE" | "UNKNOWN"; unconfirmedDays: number; lastSuccessLocalDate: string | null } | null
    scheduleConfidence?: { freshness: "FRESH" | "STALE" | "UNKNOWN"; basis: string; scheduleType: string | null; unconfirmedScheduleDays: number; unknownScheduleDays: number; lastSuccessLocalDate: string | null } | null
    holidayConfidence?: { policy: string; operationalCapitalCode: string | null; confidence: "CAPITAL_KNOWN" | "CAPITAL_UNKNOWN"; applicableHolidayDays: number } | null
    observed?: { workedObservedDays: number; workedDespitePlan: { exception: Record<string, number | undefined>; scheduledDayOff: number; holiday: number; unknownSchedule: number }; missingExpectedProductionDays: number; productionWithNonEligibleStatusDays: number; evidenceSources: { interactions: boolean; indicatorCodes: string[] } } | null
  } | null
}

const SCHEDULE_BASIS_TEXT: Record<string, string> = { EXPLICIT_SCHEDULE: "escala informada pela fonte", LEGACY_WEEKDAY_FALLBACK: "seg–sex por compatibilidade (sem escala configurada)", UNKNOWN_SCHEDULE: "regime 6x1 sem folga informada", MIXED: "escala parcialmente informada" }

export function isOperationalEvidence(value: unknown): value is OperationalEvidence {
  return Boolean(value) && typeof value === "object" && typeof (value as { windowLabel?: unknown }).windowLabel === "string"
}

/** "Janela 09/09/2026 → 15/09/2026 · 5 dias com dados (cobertura 100%) · 287 contatos · Σ 142.639 ÷ Σ 287 · média ponderada". */
export function evidenceLines(evidence: OperationalEvidence): string[] {
  const lines = [`Janela: ${evidence.windowLabel}`]
  // Calendário real: dias no calendário → programados para trabalho (escala) → excluídos (folga, feriado,
  // admissão, situação com rótulo real) → elegíveis × dias com dados × mínimo × resultado — nunca só "sem dados".
  if (evidence.eligibility) {
    const e = evidence.eligibility
    const excluded = [
      ...(e.excludedBeforeHire > 0 ? [`${e.excludedBeforeHire} antes da admissão`] : []),
      ...Object.entries(e.excludedByStatus).map(([status, days]) => `${days} por ${employmentStatusLabel(status)}`),
    ]
    if (e.calendarDays !== undefined) {
      const schedule = e.scheduleConfidence
      const calendarExclusions = [
        ...(e.excludedByScheduledDayOff ? [`${e.excludedByScheduledDayOff} ${schedule?.basis === "LEGACY_WEEKDAY_FALLBACK" ? "de fim de semana" : "por folga programada"}`] : []),
        ...(e.excludedByHoliday ? [`${e.excludedByHoliday} por feriado`] : []),
        ...(e.excludedByUnknownSchedule ? [`${e.excludedByUnknownSchedule} com escala desconhecida`] : []),
      ]
      lines.push(`Dias no calendário: ${e.calendarDays} · programados para trabalho: ${e.scheduledWorkDays ?? e.businessDays}${calendarExclusions.length > 0 ? ` (${calendarExclusions.join(", ")})` : ""}${schedule ? ` · ${SCHEDULE_BASIS_TEXT[schedule.basis] ?? schedule.basis}${schedule.scheduleType ? ` · regime ${schedule.scheduleType === "SIX_BY_ONE" ? "6x1" : "5x2"}` : ""}` : ""}`)
      const exceptions = Object.entries(e.excludedByScheduleException ?? {}).filter(([, days]) => (days ?? 0) > 0)
      if (exceptions.length > 0) lines.push(`Exceções individuais: ${exceptions.map(([code, days]) => `${days} ${scheduleExceptionLabel(code)}`).join(", ")} — a exceção vence a escala naquele dia`)
      lines.push(`Excluídos por situação: ${excluded.length > 0 ? excluded.join(", ") : "nenhum"}`)
      const holidays = e.holidayConfidence
      if (holidays && (holidays.applicableHolidayDays > 0 || holidays.policy === "EXCLUDE_APPLICABLE_HOLIDAYS")) {
        lines.push(`Feriados: ${holidays.applicableHolidayDays} aplicável(is) na janela · política ${holidays.policy === "EXCLUDE_APPLICABLE_HOLIDAYS" ? "excluir no fallback" : "ignorar"} · ${holidays.confidence === "CAPITAL_KNOWN" ? `capital operacional ${holidays.operationalCapitalCode}` : "sem capital operacional — só feriados nacionais e datas da organização são conhecidos"}`)
      }
      if (schedule?.freshness === "STALE" && schedule.unconfirmedScheduleDays > 0) {
        lines.push(`⚠ Fonte de escala atrasada (última carga ${schedule.lastSuccessLocalDate ? formatCivilDate(schedule.lastSuccessLocalDate) : "—"}) · ${schedule.unconfirmedScheduleDays} dia(s) com escala presumida — a folga pode ter mudado`)
      }
      // PLANEJADO × OBSERVADO: só quando há fonte de evidência (interações/indicador marcado) ou inconsistência.
      const observed = e.observed
      if (observed) {
        const enabled = observed.evidenceSources.interactions || observed.evidenceSources.indicatorCodes.length > 0
        const despite = [
          ...Object.entries(observed.workedDespitePlan.exception).filter(([, days]) => (days ?? 0) > 0).map(([code, days]) => `${days} em ${scheduleExceptionLabel(code)} previsto(a)`),
          ...(observed.workedDespitePlan.scheduledDayOff > 0 && schedule?.basis !== "LEGACY_WEEKDAY_FALLBACK" ? [`${observed.workedDespitePlan.scheduledDayOff} em folga prevista`] : []),
          ...(observed.workedDespitePlan.holiday > 0 ? [`${observed.workedDespitePlan.holiday} em feriado`] : []),
          ...(observed.workedDespitePlan.unknownSchedule > 0 ? [`${observed.workedDespitePlan.unknownSchedule} com escala desconhecida`] : []),
        ]
        if (enabled) {
          lines.push(`Produção observada: ${observed.workedObservedDays} dia(s) com evidência (${[observed.evidenceSources.interactions ? "interações" : null, ...observed.evidenceSources.indicatorCodes].filter(Boolean).join(", ")})${despite.length > 0 ? ` · trabalhou fora do plano: ${despite.join(", ")} — o plano fica registrado, o dia conta como trabalhado` : ""}${observed.missingExpectedProductionDays > 0 ? ` · ${observed.missingExpectedProductionDays} dia(s) programado(s) sem produção identificada (pendência do Supervisor; continua elegível)` : ""}`)
        }
        if (observed.productionWithNonEligibleStatusDays > 0) lines.push(`⚠ ${observed.productionWithNonEligibleStatusDays} dia(s) com produção em situação funcional não produtiva — inconsistência de dados; a situação é soberana e não muda automaticamente`)
      }
    } else {
      lines.push(`Dias úteis: ${e.businessDays}${excluded.length > 0 ? ` · excluídos: ${excluded.join(", ")}` : " · nenhum excluído"}`)
    }
    // Situação funcional só entra no trace quando influencia a elegibilidade (dias excluídos) ou
    // quando a fonte está atrasada — nunca polui o trace de quem está simplesmente ativo e confiável.
    const confidence = evidence.eligibility.statusConfidence
    if (confidence?.freshness === "STALE") {
      lines.push(`⚠ Fonte de situação funcional atrasada (última carga ${confidence.lastSuccessLocalDate ? formatCivilDate(confidence.lastSuccessLocalDate) : "—"}) · ${confidence.unconfirmedDays} dia(s) elegível(is) presumido(s), não confirmado(s)`)
    } else if (confidence && excluded.length > 0) {
      lines.push(`Situação funcional: fonte ${confidence.freshness === "FRESH" ? "atualizada" : "não configurada na Central"}${confidence.lastSuccessLocalDate ? ` (última carga ${formatCivilDate(confidence.lastSuccessLocalDate)})` : ""}`)
    }
  }
  lines.push(`Dias elegíveis: ${evidence.expectedDays ?? "—"} · dias com medição elegível: ${evidence.daysWithData} · medições: ${evidence.sampleCount}`)
  if (evidence.ignoredMeasurements) lines.push(`Medições ignoradas por inelegibilidade: ${evidence.ignoredMeasurements} (preservadas no banco, fora do valor e da cobertura)`)
  if (evidence.coverage !== null) {
    const minimum = evidence.minimumCoverage !== undefined && evidence.minimumCoverage !== null ? ` · mínimo exigido: ${Math.round(evidence.minimumCoverage * 100)}%` : ""
    const verdict = evidence.coverageSatisfied === false ? " → abaixo do mínimo: SEM DADOS" : evidence.coverageSatisfied === true ? " → cobertura suficiente" : ""
    lines.push(`Cobertura: ${Math.round(evidence.coverage * 100)}%${minimum}${verdict}`)
  }
  if (evidence.numerator !== null && evidence.denominator !== null) lines.push(`Componentes: Σ numerador ${formatNumber(evidence.numerator, 2)} · Σ denominador ${formatNumber(evidence.denominator, 2)}`)
  if (evidence.sampleTotal !== null && evidence.sampleTotal !== evidence.denominator) lines.push(`Amostra declarada: ${formatNumber(evidence.sampleTotal, 0)}`)
  lines.push(`Método: ${evidence.method} (${AGGREGATION_LABELS[evidence.aggregation] ?? evidence.aggregation})`)
  return lines
}
