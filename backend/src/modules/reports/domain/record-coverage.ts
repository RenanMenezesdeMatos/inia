import { lastDayOf, type ConcretePeriod } from "./report-definition.js"
import type { SourceState } from "./delivery-decision.js"

/**
 * COBERTURA DO PERÍODO pelos atendimentos carregados (achado DL-09 da 10ª auditoria): período que a carga ainda não alcançou
 * nunca é entregue como zero nem comparado — dado ausente não é queda. As marcas são datas civis no fuso da organização:
 * primeiro e último atendimento das pessoas da estrutura e o dia da última carga concluída do feed de interações (null = sem
 * feed na Central de Dados ou sem carga concluída).
 */
export type RecordMarks = { firstDay: string | null; lastDay: string | null; loadedThroughDay: string | null }

export const periodDates = (period: ConcretePeriod): { from: string; to: string } => ("month" in period ? { from: `${period.month}-01`, to: lastDayOf(period.month) } : period.dates)

const civil = (day: string) => day.split("-").reverse().join("/")

/**
 * O período está coberto quando:
 *   - já havia atendimento carregado até o fim dele (antes do primeiro atendimento não há dado: implantação, retenção);
 *     `fromStart` (a referência da comparação) exige dado desde o INÍCIO — período pela metade não é base de comparação;
 *   - período encerrado: o último atendimento alcança o fim do período, ou uma carga foi concluída depois dele (dia sem
 *     operação é zero legítimo só quando a carga daquele dia já passou);
 *   - período em curso ou futuro (termina hoje ou depois): há ao menos um atendimento dentro dele.
 */
export function recordPeriodCovered(marks: RecordMarks, period: ConcretePeriod, today: string, options: { fromStart?: boolean } = {}): boolean {
  const { from, to } = periodDates(period)
  if (!marks.firstDay || !marks.lastDay) return false
  if (marks.firstDay > (options.fromStart ? from : to)) return false
  if (to >= today) return marks.lastDay >= from
  return marks.lastDay >= to || (marks.loadedThroughDay !== null && marks.loadedThroughDay > to)
}

/** Fonte de interações marcada como pendente ("sem dados no período") quando a carga não cobre o período da execução. */
export function withRecordCoverage(sources: SourceState[], marks: RecordMarks | null, period: ConcretePeriod | null, today: string): SourceState[] {
  if (!marks || !period || recordPeriodCovered(marks, period, today)) return sources
  const { from, to } = periodDates(period)
  const loaded = marks.lastDay ? `atendimentos carregados até ${civil(marks.lastDay)}` : "nenhum atendimento carregado para esta estrutura"
  const detail = `Sem dados no período (${from === to ? civil(from) : `${civil(from)} a ${civil(to)}`}): ${loaded}.`
  return sources.map((source) => (source.source === "INTERACTIONS" ? { ...source, stale: true, detail } : source))
}
