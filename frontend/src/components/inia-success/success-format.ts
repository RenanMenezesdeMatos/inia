import type { ChartConfig } from "@/components/ui/chart"
import type { Average, Bucket, Rate } from "@/schemas/inia-success/inia-success.schema"

/**
 * Formatação dos Indicadores de sucesso (só apresentação; as regras de cálculo e de amostra mínima são do servidor). Sem base nunca
 * vira 0%: o texto diz "Sem base para cálculo". Amostra pequena (denominador abaixo de 5) mostra a contagem, nunca a porcentagem.
 */
export const NO_BASE = "Sem base para cálculo"
export const SMALL_SAMPLE = "Amostra pequena"

export const formatCount = (value: number) => value.toLocaleString("pt-BR")
export const formatPercent = (value: number) => `${(Math.round(value * 1000) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`

/** "1 resposta" / "2 respostas". */
export const plural = (count: number, unit: readonly [string, string]) => `${formatCount(count)} ${count === 1 ? unit[0] : unit[1]}`

/** Duração legível de uma média ou percentil em segundos: "8,4 s", "1 min 12 s". */
export function formatSeconds(seconds: number | null): string {
  if (seconds === null) return "—"
  if (seconds < 60) return `${seconds.toLocaleString("pt-BR", { maximumFractionDigits: seconds < 10 ? 1 : 0 })} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`
}

/** Valor principal de uma taxa: a porcentagem, ou o estado quando ela não é calculável. */
export const rateValue = (rate: Rate) => (rate.status === "OK" && rate.value !== null ? formatPercent(rate.value) : rate.status === "SMALL_SAMPLE" ? SMALL_SAMPLE : NO_BASE)

/** A base de uma taxa por extenso: "164 de 200 respostas avaliadas". */
export const rateBase = (rate: Rate, unit: readonly [string, string]) => `${formatCount(rate.numerator ?? 0)} de ${plural(rate.denominator ?? 0, unit)}`

/** A base embaixo de um número grande: "2 de 4 respostas avaliadas (menos de 5: sem porcentagem)"; sem base, a frase de vazio. */
export const rateBaseLine = (rate: Rate, unit: readonly [string, string], empty: string) =>
  rate.status === "NO_DATA" ? empty : `${rateBase(rate, unit)}${rate.status === "SMALL_SAMPLE" ? " (menos de 5: sem porcentagem)" : ""}`

/** "82% · 164 de 200 respostas avaliadas"; sem base: "Sem base para cálculo · 0 respostas avaliadas". */
export function rateWithBase(rate: Rate, unit: readonly [string, string]): string {
  if (rate.status === "NO_DATA") return `${NO_BASE} · ${plural(0, unit)}`
  if (rate.status === "SMALL_SAMPLE") return `${SMALL_SAMPLE} · ${rateBase(rate, unit)}`
  return `${rateValue(rate)} · ${rateBase(rate, unit)}`
}

/** Forma curta para tabela: "50% (2 de 4)", "Amostra pequena (2 de 4)", "Sem base". */
export const rateCompact = (rate: Rate) => (rate.status === "NO_DATA" ? "Sem base" : `${rateValue(rate)} (${formatCount(rate.numerator ?? 0)} de ${formatCount(rate.denominator ?? 0)})`)

export const averageValue = (average: Average) => (average.status === "OK" ? formatSeconds(average.value) : average.status === "SMALL_SAMPLE" ? SMALL_SAMPLE : NO_BASE)

/** Rótulo curto de um ponto da evolução: dia ("12/11") ou semana ("10/11–16/11", com "parcial"). */
export function bucketLabel(bucket: Bucket): string {
  const day = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
  return bucket.from === bucket.to ? day(bucket.from) : `${day(bucket.from)}–${day(bucket.to)}`
}
export const bucketTitle = (bucket: Bucket) => (bucket.from === bucket.to ? bucketLabel(bucket) : `Semana ${bucketLabel(bucket)}${bucket.partial ? " (parcial)" : ""}`)

/**
 * Cor por SIGNIFICADO, igual em toda a tela (a cor segue a entidade, nunca a posição): respostas da INIA no chat, feedbacks, consulta
 * da INIA (sinais registrados pelo sistema) e Apoio com Anjo. Passos validados (claro e escuro) do método de visualização: os três
 * primeiros são distinguíveis em qualquer combinação, inclusive com daltonismo; o texto nunca usa a cor da série.
 */
export const SERIES_THEME = {
  replies: { light: "#2a78d6", dark: "#3987e5" },
  feedback: { light: "#eb6834", dark: "#d95926" },
  consultation: { light: "#1baf7a", dark: "#199e70" },
  support: { light: "#6250d6", dark: "#9085e9" },
} as const
export type SeriesKey = keyof typeof SERIES_THEME

export const seriesConfig = (key: SeriesKey, label: string): ChartConfig => ({
  [key]: { label, theme: SERIES_THEME[key] },
})
