import { DEFAULT_ORGANIZATION_TIMEZONE } from "../../workflows/application/organization-timezone.js"
import { lastClosedPeriod } from "../../workflows/application/time-window.js"

/**
 * GUARD CENTRAL DO FECHAMENTO OFICIAL — regra de DOMÍNIO, temporal, independente da origem
 * da linha (DEMO_SEED, MANUAL_SEED, API, CSV, importação de produção…):
 *
 *   uma competência só é fechamento oficial quando `referencePeriod <= lastClosedReferencePeriod(now, tz)`.
 *
 * Em 16/09/2026 (fuso da organização) o último fechamento possível é 2026-08; uma linha de
 * 2026-09 pode EXISTIR no banco (fixture, carga antecipada) mas nenhum read path oficial a
 * enxerga como fechamento até 01/10/2026. Todo leitor oficial (Profile, estrutura, histórico,
 * Conditions/Ranking oficiais, Agents com performance, QA Lab, seletor de competência) usa
 * estas funções — nunca uma comparação própria com "o mês atual".
 */
export function lastClosedReferencePeriod(now: Date, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): string {
  return lastClosedPeriod(now, timeZone)
}

export function isClosedReferencePeriod(referencePeriod: string, now: Date, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): boolean {
  return referencePeriod <= lastClosedReferencePeriod(now, timeZone)
}

/** Competência pedida, limitada ao último fechamento possível (pedir "setembro" em 16/09 devolve agosto). */
export function clampToClosedReferencePeriod(referencePeriod: string, now: Date, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): string {
  const last = lastClosedReferencePeriod(now, timeZone)
  return referencePeriod > last ? last : referencePeriod
}

/** Filtro em memória para listas de competências vindas do banco (nunca inclui o mês corrente). */
export function onlyClosedReferencePeriods(periods: string[], now: Date, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): string[] {
  const last = lastClosedReferencePeriod(now, timeZone)
  return periods.filter((period) => period <= last)
}
