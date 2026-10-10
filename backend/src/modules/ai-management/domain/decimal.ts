/**
 * DINHEIRO SEM FLOAT (§94). Valores monetários vivem como string decimal (o `numeric` do Postgres
 * chega assim pelo `pg`) e a aritmética usa ponto fixo em BigInt com `SCALE` casas. Nada aqui
 * converte moeda: somar valores de moedas diferentes é responsabilidade de quem chama (e é recusado
 * em `ai-budget.ts`/agregações).
 */
export const DECIMAL_SCALE = 12
const FACTOR = 10n ** BigInt(DECIMAL_SCALE)
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/

export type Decimal = bigint

export function isDecimalString(value: string): boolean {
  return DECIMAL_PATTERN.test(value.trim())
}

/** "0.30" → 300000000000n (escala 12). Casas além da escala são truncadas — preços de tabela nunca passam de 12. */
export function parseDecimal(value: string | number): Decimal {
  const text = typeof value === "number" ? numberToPlainString(value) : value.trim()
  if (!DECIMAL_PATTERN.test(text)) throw new Error(`Valor decimal inválido: ${text}`)
  const negative = text.startsWith("-")
  const [whole = "0", fraction = ""] = (negative ? text.slice(1) : text).split(".")
  const scaled = BigInt(whole) * FACTOR + BigInt((fraction + "0".repeat(DECIMAL_SCALE)).slice(0, DECIMAL_SCALE) || "0")
  return negative ? -scaled : scaled
}

function numberToPlainString(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Número não finito")
  // Números só entram por entrada humana/JSON (ex.: 0.3); toFixed evita notação científica.
  return value.toFixed(DECIMAL_SCALE)
}

export function formatDecimal(value: Decimal, maxFractionDigits = DECIMAL_SCALE): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const whole = abs / FACTOR
  let fraction = (abs % FACTOR).toString().padStart(DECIMAL_SCALE, "0").slice(0, maxFractionDigits).replace(/0+$/, "")
  if (fraction.length === 0) fraction = ""
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`
}

export function addDecimal(...values: Decimal[]): Decimal {
  return values.reduce((sum, value) => sum + value, 0n)
}

/** tokens × (preço por milhão) — resultado exato na escala (arredondamento half-up na última casa). */
export function costOfTokens(tokens: number, pricePerMillion: Decimal): Decimal {
  if (!Number.isInteger(tokens) || tokens < 0) throw new Error("Contagem de tokens inválida")
  const numerator = BigInt(tokens) * pricePerMillion
  const quotient = numerator / 1_000_000n
  const remainder = numerator % 1_000_000n
  return remainder * 2n >= 1_000_000n ? quotient + 1n : quotient
}

/** percentual inteiro (0–100+) de `part` sobre `whole` — null quando `whole` é zero. */
export function percentOfDecimal(part: Decimal, whole: Decimal): number | null {
  if (whole <= 0n) return null
  return Number((part * 10_000n) / whole) / 100
}

export function compareDecimal(left: Decimal, right: Decimal): number {
  return left === right ? 0 : left > right ? 1 : -1
}
