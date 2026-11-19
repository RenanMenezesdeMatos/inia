/**
 * CÁLCULOS DA LIDERANÇA (`leadership_calculate`): contas sobre números que as ferramentas trouxeram — somar os totais de vários Grupos,
 * dividir operadores por supervisores, percentual, variação. O modelo nunca faz conta de cabeça: ele informa os valores e a operação,
 * o código calcula e devolve o resultado com a conta escrita. Só aritmética sobre os valores recebidos: nada é lido do banco aqui.
 * O resultado diz, no texto e na estrutura (`CALCULATION_TRACE`), que os OPERANDOS foram informados por quem pediu a conta e não
 * apurados nem conferidos pelo sistema: a calculadora garante a conta, nunca a origem do número.
 */

export const ARITHMETIC_OPERATIONS = ["SOMA", "SUBTRACAO", "MULTIPLICACAO", "DIVISAO", "MEDIA", "MEDIANA", "MINIMO", "MAXIMO", "CONTAGEM", "PERCENTUAL", "VARIACAO_PERCENTUAL", "DESVIO_PADRAO"] as const
export type ArithmeticOperation = (typeof ARITHMETIC_OPERATIONS)[number]

export const MAX_CALCULATIONS = 30
export const MAX_VALUES_PER_CALCULATION = 1000

export type Calculation = { label: string; operation: ArithmeticOperation; values: number[] }
export type CalculationOutcome = { label: string; operation: ArithmeticOperation; values: number[]; result: number | null; error: string | null }

const OPERATION_TEXT: Record<ArithmeticOperation, string> = {
  SOMA: "soma",
  SUBTRACAO: "subtração (o primeiro menos os demais)",
  MULTIPLICACAO: "multiplicação",
  DIVISAO: "divisão (o primeiro pelos demais)",
  MEDIA: "média",
  MEDIANA: "mediana",
  MINIMO: "mínimo",
  MAXIMO: "máximo",
  CONTAGEM: "contagem de valores",
  PERCENTUAL: "percentual (primeiro ÷ segundo × 100)",
  VARIACAO_PERCENTUAL: "variação percentual (do primeiro para o segundo)",
  DESVIO_PADRAO: "desvio padrão (populacional)",
}

/** Números em texto ("2.264", "25,2", "87,2%") também valem: o modelo copia o que a ferramenta mostrou. */
export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  let text = value.trim().replace(/%$/, "").replace(/\s/g, "")
  if (!text) return null
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".")
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, "")
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

/** Lê o pedido do modelo; `null` = pedido fora do formato (a ferramenta devolve o motivo). */
export function parseCalculations(raw: unknown): { calculations: Calculation[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Informe ao menos um cálculo em `calculos`." }
  if (raw.length > MAX_CALCULATIONS) return { error: `No máximo ${MAX_CALCULATIONS} cálculos por vez.` }
  const calculations: Calculation[] = []
  for (const [index, item] of raw.entries()) {
    const entry = (item ?? {}) as Record<string, unknown>
    const operation = ARITHMETIC_OPERATIONS.find((value) => value === entry.operacao)
    if (!operation) return { error: `Cálculo ${index + 1}: operação desconhecida (${String(entry.operacao)}). Use uma de: ${ARITHMETIC_OPERATIONS.join(", ")}.` }
    if (!Array.isArray(entry.valores) || entry.valores.length === 0) return { error: `Cálculo ${index + 1}: informe os valores.` }
    if (entry.valores.length > MAX_VALUES_PER_CALCULATION) return { error: `Cálculo ${index + 1}: no máximo ${MAX_VALUES_PER_CALCULATION} valores.` }
    const values = entry.valores.map(parseNumber)
    const invalid = values.findIndex((value) => value === null)
    if (invalid >= 0) return { error: `Cálculo ${index + 1}: o valor ${String(entry.valores[invalid])} não é um número.` }
    const label = typeof entry.rotulo === "string" && entry.rotulo.trim() ? entry.rotulo.trim().slice(0, 200) : `Cálculo ${index + 1}`
    calculations.push({ label, operation, values: values as number[] })
  }
  return { calculations }
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

export function calculate(calculation: Calculation): CalculationOutcome {
  const { values, operation } = calculation
  const done = (result: number | null, error: string | null = null): CalculationOutcome => ({ ...calculation, result: result === null || !Number.isFinite(result) ? null : result, error: result !== null && !Number.isFinite(result) ? "resultado não é um número finito" : error })
  const [first, second] = values
  switch (operation) {
    case "SOMA":
      return done(sum(values))
    case "SUBTRACAO":
      return done(values.slice(1).reduce((total, value) => total - value, first!))
    case "MULTIPLICACAO":
      return done(values.reduce((total, value) => total * value, 1))
    case "DIVISAO":
      if (values.length < 2) return done(null, "a divisão precisa de dois valores ou mais")
      if (values.slice(1).some((value) => value === 0)) return done(null, "divisão por zero")
      return done(values.slice(1).reduce((total, value) => total / value, first!))
    case "MEDIA":
      return done(sum(values) / values.length)
    case "MEDIANA": {
      const sorted = [...values].sort((a, b) => a - b)
      const middle = Math.floor(sorted.length / 2)
      return done(sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2)
    }
    case "MINIMO":
      return done(Math.min(...values))
    case "MAXIMO":
      return done(Math.max(...values))
    case "CONTAGEM":
      return done(values.length)
    case "PERCENTUAL":
      if (values.length !== 2) return done(null, "o percentual precisa de exatamente dois valores (parte e total)")
      if (second === 0) return done(null, "total igual a zero")
      return done((first! / second!) * 100)
    case "VARIACAO_PERCENTUAL":
      if (values.length !== 2) return done(null, "a variação precisa de exatamente dois valores (de e para)")
      if (first === 0) return done(null, "valor inicial igual a zero")
      return done(((second! - first!) / Math.abs(first!)) * 100)
    case "DESVIO_PADRAO": {
      const mean = sum(values) / values.length
      return done(Math.sqrt(sum(values.map((value) => (value - mean) ** 2)) / values.length))
    }
  }
}

export const formatNumber = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
const PERCENT_RESULTS: ArithmeticOperation[] = ["PERCENTUAL", "VARIACAO_PERCENTUAL"]

export const CALCULATION_HEADER = "[Contas feitas pelo sistema sobre valores INFORMADOS pelo assistente — o sistema fez só a conta: NÃO apurou nem conferiu os valores de entrada, que só valem se vieram de uma consulta de dados desta conversa. Use exatamente estes resultados, com o arredondamento que preferir]"

/** Estrutura do resultado da calculadora: a origem dos operandos fica explícita para quem lê o registro da chamada. */
export const CALCULATION_TRACE = { calculation: { operands: "INFORMED_BY_ASSISTANT", operandsCheckedAgainstData: false } } as const

export function renderCalculations(outcomes: readonly CalculationOutcome[]): string {
  const lines = outcomes.map((outcome) => {
    const shownValues = outcome.values.length > 40 ? `${outcome.values.slice(0, 40).map(formatNumber).join("; ")}; … (${outcome.values.length} valores)` : outcome.values.map(formatNumber).join("; ")
    const result = outcome.result === null ? `não calculado: ${outcome.error}` : `${formatNumber(outcome.result)}${PERCENT_RESULTS.includes(outcome.operation) ? "%" : ""}`
    return `- ${outcome.label}: ${OPERATION_TEXT[outcome.operation]} dos valores informados [${shownValues}] = ${result}`
  })
  return [CALCULATION_HEADER, ...lines].join("\n")
}
