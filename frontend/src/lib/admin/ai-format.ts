/**
 * Formatação da administração de IA. Dinheiro chega do backend como STRING decimal por moeda:
 * aqui só se FORMATA para exibição (Number só para o Intl) — nunca se soma entre moedas, nunca se
 * converte. Token `null` = "não informado pelo provider", jamais 0.
 */
const integerFormatter = new Intl.NumberFormat("pt-BR")
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })

export const NOT_REPORTED_LABEL = "Não informado"
export const NO_KNOWN_COST_LABEL = "Sem custo conhecido"
/** Modelo local sem tarifa de API: a API não cobra, mas o custo de máquina não é medido — nunca "grátis". */
export const LOCAL_API_COST_ZERO_LABEL = "Custo de API: 0 · custo computacional não medido"

/** Valor monetário em uma moeda; código desconhecido pelo Intl cai para "XYZ 1.234,56". */
export function formatMoney(amount: string, currency: string): string {
  const value = Number(amount)
  if (!Number.isFinite(value)) return `${currency} ${amount}`
  // Custos de IA costumam ser frações de centavo: mais casas quando o valor é pequeno.
  const maximumFractionDigits = value !== 0 && Math.abs(value) < 0.01 ? 6 : Math.abs(value) < 1 && value !== 0 ? 4 : 2
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits }).format(value)
  } catch {
    return `${currency} ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits }).format(value)}`
  }
}

/** Uma entrada por moeda (ordem alfabética), nunca somadas. Vazio = sem custo conhecido. */
export function moneyEntries(costByCurrency: Readonly<Record<string, string>>): { currency: string; amount: string; label: string }[] {
  return Object.keys(costByCurrency)
    .sort()
    .map((currency) => ({ currency, amount: costByCurrency[currency]!, label: formatMoney(costByCurrency[currency]!, currency) }))
}

export function formatCostByCurrency(costByCurrency: Readonly<Record<string, string>>, empty = NO_KNOWN_COST_LABEL): string {
  const entries = moneyEntries(costByCurrency)
  return entries.length === 0 ? empty : entries.map((entry) => entry.label).join(" · ")
}

/** Preço por milhão de tokens ("US$ 0,30 / 1M"). */
export function formatPerMillion(amount: string, currency: string): string {
  return `${formatMoney(amount, currency)} / 1M`
}

export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return integerFormatter.format(value)
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return integerFormatter.format(value)
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—"
  if (ms < 1000) return `${integerFormatter.format(ms)} ms`
  return `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`
}

export function formatRate(percent: number | null | undefined): string {
  if (percent === null || percent === undefined) return "—"
  return `${percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
}

export function formatAiDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  return dateTimeFormatter.format(new Date(value))
}

/** "YYYY-MM-DD" → "DD/MM" (eixo do gráfico diário, sem reinterpretar fuso). */
export function formatDayLabel(day: string): string {
  const [, month, date] = day.split("-")
  return month && date ? `${date}/${month}` : day
}

/** Número inteiro positivo digitado ("" = null). */
export function parseOptionalInt(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  return Number.isInteger(value) && value > 0 ? value : Number.NaN
}

/** Decimal digitado em pt-BR ("0,30") vira o formato do backend ("0.30"). */
export function normalizeDecimalInput(raw: string): string {
  return raw.trim().replace(",", ".")
}
