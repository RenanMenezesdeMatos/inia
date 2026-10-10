import { compareDecimal, formatDecimal, parseDecimal, percentOfDecimal } from "./decimal.js"

/**
 * ORÇAMENTO DE IA (§49–§52, §96). Por organização e por ESCOPO: GLOBAL, USE_CASE ou PROVIDER (V1
 * entrega os três no modelo; a UI prioriza global + Use Case). O orçamento tem MOEDA e só é
 * comparado com custo da MESMA moeda — gasto em outra moeda aparece como "não comparável", nunca
 * é convertido (não há FX no produto).
 */
export const AI_BUDGET_SCOPES = ["GLOBAL", "USE_CASE", "PROVIDER"] as const
export type AiBudgetScope = (typeof AI_BUDGET_SCOPES)[number]

export type AiBudget = {
  id: string
  scope: AiBudgetScope
  scopeKey: string | null
  currency: string
  monthlyAmount: string
  warningThresholds: number[]
  hardLimit: boolean
  enabled: boolean
}

export type AiBudgetStatus = "OK" | "WARNING" | "EXCEEDED"

export type AiBudgetEvaluation = {
  budgetId: string
  status: AiBudgetStatus
  spent: string
  limit: string
  currency: string
  percent: number | null
  /** Limiares (%) já atingidos no mês — base dos alertas 70/90/100. */
  reachedThresholds: number[]
  /** Moedas com gasto no escopo que NÃO podem ser comparadas a este orçamento. */
  notComparableCurrencies: string[]
  /** Chamadas do escopo sem custo conhecido (sem tabela/uso) — o gasto real pode ser maior. */
  unknownCostCalls: number
  hardLimitReached: boolean
}

export const DEFAULT_WARNING_THRESHOLDS = [70, 90, 100]

export function evaluateBudget(budget: AiBudget, spentByCurrency: Readonly<Record<string, string>>, unknownCostCalls: number): AiBudgetEvaluation {
  const spent = parseDecimal(spentByCurrency[budget.currency] ?? "0")
  const limit = parseDecimal(budget.monthlyAmount)
  const percent = percentOfDecimal(spent, limit)
  const reachedThresholds = [...budget.warningThresholds].sort((a, b) => a - b).filter((threshold) => percent !== null && percent >= threshold)
  const exceeded = limit > 0n ? compareDecimal(spent, limit) >= 0 : false
  const status: AiBudgetStatus = exceeded ? "EXCEEDED" : reachedThresholds.length > 0 ? "WARNING" : "OK"
  return {
    budgetId: budget.id,
    status,
    spent: formatDecimal(spent, 6),
    limit: formatDecimal(limit, 6),
    currency: budget.currency,
    percent,
    reachedThresholds,
    notComparableCurrencies: Object.keys(spentByCurrency).filter((currency) => currency !== budget.currency && parseDecimal(spentByCurrency[currency] ?? "0") > 0n),
    unknownCostCalls,
    hardLimitReached: budget.enabled && budget.hardLimit && exceeded,
  }
}

export function validateBudgetInput(input: { scope: string; scopeKey: string | null; currency: string; monthlyAmount: string; warningThresholds: number[] }): string[] {
  const issues: string[] = []
  if (!(AI_BUDGET_SCOPES as readonly string[]).includes(input.scope)) issues.push("Escopo inválido.")
  if (input.scope === "GLOBAL" && input.scopeKey !== null) issues.push("Orçamento global não tem chave de escopo.")
  if (input.scope !== "GLOBAL" && !input.scopeKey) issues.push("Informe o Use Case ou provider do orçamento.")
  if (!/^[A-Z]{3}$/.test(input.currency)) issues.push("Moeda deve ser um código ISO de 3 letras.")
  if (!/^\d+(\.\d+)?$/.test(input.monthlyAmount) || parseDecimal(input.monthlyAmount) <= 0n) issues.push("Valor mensal deve ser um decimal positivo.")
  if (input.warningThresholds.some((value) => !Number.isInteger(value) || value < 1 || value > 100)) issues.push("Limiares de alerta devem ser inteiros entre 1 e 100.")
  return issues
}
