import type { RelativeSchedule } from "../domain/trigger-config-schema.js"
import { weekdayOf, zonedTimeToIso } from "./schedule-recurrence.js"

/**
 * Calculadora do Trigger "Por agenda" relativo ao expediente (2ª evolução da Agenda) — resolve o
 * instante individual de UM colaborador a partir da jornada PREVISTA dele (horário de entrada +
 * carga horária), nunca de telemetria de login/logoff real (que não existe hoje — ver
 * docs/workflow-engine-wiki.md, "expediente previsto x login real"). Módulo puro, mesmo espírito
 * de schedule-recurrence.ts — reaproveitado tanto pelo checador real (schedule-check.ts) quanto
 * pelo preview (workflow-router.ts), nunca duas implementações divergentes.
 */
export type EmployeeShift = { startTime: string; workMinutes: number }

export type ShiftWindow = { start: Date; end: Date }

/**
 * Segunda a Sexta, hardcoded — não existe hoje nenhuma fonte de escala/calendário de dias
 * trabalhados (Parte 16 do pedido). Limitação documentada: serve só pra massa de
 * desenvolvimento/teste; uma integração futura com escala real substituiria esta função sem
 * precisar mudar o restante da calculadora.
 */
export function isAssumedWorkday(dateStr: string): boolean {
  const day = weekdayOf(dateStr)
  return day !== "SAT" && day !== "SUN"
}

/**
 * Início e fim previstos do expediente de um colaborador, numa data de calendário local — o fim
 * é sempre calculado a partir do início + duração em minutos (nunca comparando só relógios), por
 * isso jornadas que atravessam a meia-noite (ex.: entrada 22:00, 8h de carga) resolvem
 * corretamente pro dia seguinte (Parte 17 do pedido).
 */
export function resolveShiftWindow(shift: EmployeeShift, dateStr: string, timezone: string): ShiftWindow {
  const time = shift.startTime.slice(0, 5) // aceita "HH:mm" ou "HH:mm:ss" (coluna `time` do Postgres)
  const start = new Date(zonedTimeToIso(dateStr, time, timezone))
  const end = new Date(start.getTime() + shift.workMinutes * 60_000)
  return { start, end }
}

/**
 * Instante individual em que a regra relativa dispara pra esse colaborador, nessa data — `null`
 * quando a configuração é incompatível com a duração da jornada dele (ex.: "5h após o início"
 * numa jornada de 4h cairia depois do fim do expediente) — nunca inventa/clampa um horário fora
 * do expediente (Parte 30 do pedido); esse colaborador simplesmente não tem ocorrência nesse dia,
 * mesmo princípio já usado pro dia-do-mês inexistente na Agenda de calendário.
 */
export function resolveRelativeInstant(shift: EmployeeShift, relative: RelativeSchedule, dateStr: string, timezone: string): Date | null {
  const window = resolveShiftWindow(shift, dateStr, timezone)
  if (relative.anchor === "START") {
    if (relative.offsetMinutes === undefined) return null
    const instant = new Date(window.start.getTime() + relative.offsetMinutes * 60_000)
    return instant <= window.end ? instant : null
  }
  if (relative.anchor === "END") {
    if (relative.offsetMinutes === undefined) return null
    const instant = new Date(window.end.getTime() - relative.offsetMinutes * 60_000)
    return instant >= window.start ? instant : null
  }
  // PERCENTAGE: 0-100 sempre cai dentro de [start, end] por construção, nunca incompatível.
  if (relative.percentage === undefined) return null
  const durationMs = window.end.getTime() - window.start.getTime()
  return new Date(window.start.getTime() + durationMs * (relative.percentage / 100))
}

/** Percentual do expediente PREVISTO já decorrido num instante — "percentual da jornada
 * prevista", nunca "tempo logado" (não temos telemetria real — Parte 3 do pedido). */
export function elapsedScheduledPercent(window: ShiftWindow, instant: Date): number {
  const durationMs = window.end.getTime() - window.start.getTime()
  if (durationMs <= 0) return 0
  const elapsed = instant.getTime() - window.start.getTime()
  return Math.max(0, Math.min(100, (elapsed / durationMs) * 100))
}
