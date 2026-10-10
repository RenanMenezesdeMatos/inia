import { evaluateAttainment, type IndicatorDirection } from "../../indicators/domain/evaluate-attainment.js"

/**
 * INDICATOR DIAGNOSIS V1 — FECHAMENTO OFICIAL DO PRV (domínio puro). O ponto de partida do diagnóstico de indicadores é o
 * FECHAMENTO, não "um indicador ruim":
 *
 *   fechamento oficial (employee_prv_performance + employee_indicator_performance da competência)
 *     → triagem (quais indicadores merecem investigação — regra da estratégia de cada indicador)
 *     → investigação por indicador (população, mix, padrões operacionais) → diagnóstico → projeções por público.
 *
 * Os valores OFICIAIS são soberanos: PRV, atingimento, peso, meta, quartil e valor chegam prontos da fonte e só são LIDOS. Nada
 * aqui calcula atingimento, PRV, quartil ou "variação oficial". Duas comparações são permitidas, porque só ORDENAM valores
 * oficiais (nunca produzem número novo): o quartil de um fechamento × o anterior (Q1 = melhor, Q4 = pior, sempre) e o valor
 * oficial × o anterior pelo sentido do indicador.
 */
export const PRV_CLOSING_CONTRACT = "PRV_CLOSING_V1" as const

export const QUARTILES = ["Q1", "Q2", "Q3", "Q4"] as const
export type Quartile = (typeof QUARTILES)[number]
/** 1 = MELHOR quartil, 4 = PIOR. Nunca inverter (a fonte já entrega o quartil normalizado pelo sentido do indicador). */
export const QUARTILE_RANK: Readonly<Record<Quartile, number>> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 }
export const isQuartile = (value: unknown): value is Quartile => typeof value === "string" && (QUARTILES as readonly string[]).includes(value)

/** Linha de `employee_indicator_performance` — como veio da fonte oficial. */
export type OfficialIndicatorSnapshot = {
  snapshotId: string
  indicatorId: string
  indicatorCode: string
  indicatorName: string
  unit: string
  direction: IndicatorDirection
  referencePeriod: string
  value: number
  target: number | null
  achievementPercent: number | null
  weightPercent: number | null
  quartile: Quartile | null
  subteamId: string | null
}

/** Linha de `employee_prv_performance`. */
export type OfficialPrvSnapshot = { snapshotId: string; referencePeriod: string; achievementPercent: number; quartile: Quartile }

export type PrvClosing = {
  contract: typeof PRV_CLOSING_CONTRACT
  organizationId: string
  personId: string
  referencePeriod: string
  prv: OfficialPrvSnapshot | null
  indicators: OfficialIndicatorSnapshot[]
  /** Fechamento anterior compatível (competência imediatamente anterior com dado oficial). Opcional — nunca exigido. */
  previous: { referencePeriod: string; prv: OfficialPrvSnapshot | null; indicators: OfficialIndicatorSnapshot[] } | null
}

/**
 * Dentro/fora da referência (regra ÚNICA do produto — a mesma de `isWithinReference` do analytics): o atingimento oficial manda
 * quando existe (≥ 100 = dentro); sem ele, valor × meta × sentido. null = nada oficial para afirmar.
 */
export function withinReferenceOf(snapshot: Pick<OfficialIndicatorSnapshot, "achievementPercent" | "value" | "target" | "direction">): boolean | null {
  if (snapshot.achievementPercent !== null) return snapshot.achievementPercent >= 100
  return evaluateAttainment(snapshot.value, snapshot.target, snapshot.direction)
}

export type Movement = "IMPROVED" | "WORSENED" | "UNCHANGED"

/** Quartil anterior → atual (Q1 melhor). null = algum dos dois ausente. */
export function quartileMovementOf(previous: Quartile | null | undefined, current: Quartile | null | undefined): Movement | null {
  if (!previous || !current) return null
  const delta = QUARTILE_RANK[current] - QUARTILE_RANK[previous]
  return delta > 0 ? "WORSENED" : delta < 0 ? "IMPROVED" : "UNCHANGED"
}

/** Valor oficial anterior → atual pelo sentido do indicador (só ordena; nenhum número novo). TARGET não tem sentido → null. */
export function officialValueMovementOf(previous: number | null | undefined, current: number, direction: IndicatorDirection): Movement | null {
  if (previous === null || previous === undefined || direction === "TARGET") return null
  if (previous === current) return "UNCHANGED"
  const better = direction === "LOWER" ? current < previous : current > previous
  return better ? "IMPROVED" : "WORSENED"
}

/** O indicador do fechamento anterior correspondente (mesmo indicador). */
export const previousSnapshotOf = (closing: PrvClosing, indicatorCode: string) => closing.previous?.indicators.find((entry) => entry.indicatorCode === indicatorCode) ?? null

/** Janela civil da competência "AAAA-MM" (datas locais; fim exclusivo). */
export function referencePeriodDates(referencePeriod: string): { startDate: string; endDate: string; previousPeriod: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(referencePeriod)
  if (!match) throw new Error(`Competência inválida: ${referencePeriod}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const pad = (value: number) => String(value).padStart(2, "0")
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
  return { startDate: `${year}-${pad(month)}-01`, endDate: `${next.year}-${pad(next.month)}-01`, previousPeriod: `${previous.year}-${pad(previous.month)}` }
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
/** "agosto de 2026" — rótulo exibível da competência. */
export function referencePeriodLabel(referencePeriod: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(referencePeriod)
  if (!match) return referencePeriod
  return `${MONTHS[Number(match[2]) - 1]} de ${match[1]}`
}

/** Dados oficiais mínimos para decidir algo sobre o indicador: valor e ao menos quartil ou referência (meta/atingimento). */
export function officialDataComplete(snapshot: OfficialIndicatorSnapshot): boolean {
  if (!Number.isFinite(snapshot.value)) return false
  return snapshot.quartile !== null || snapshot.achievementPercent !== null || snapshot.target !== null
}

/** Percentual exibível em pt-BR ("90,9%") — só formatação de um número já calculado/oficial. */
export const formatPercent = (value: number) => `${String(value).replace(".", ",")}%`
