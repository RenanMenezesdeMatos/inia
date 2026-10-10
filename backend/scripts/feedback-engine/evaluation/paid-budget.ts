/**
 * TRAVA DE ORÇAMENTO de avaliações pagas — contada na FRONTEIRA HTTP com o provedor (o `fetch` que sai para a API), onde toda
 * tentativa real aparece: análise, reparo, nova tentativa de formato, retry de transporte, redação e verificação. Um wrapper em
 * volta do motor não enxerga os retries internos do cliente; aqui, cada POST é uma requisição paga.
 *
 * Antes de cada requisição: reserva o PIOR caso (entrada estimada pelo tamanho do corpo + teto de saída/raciocínio pedido) pela
 * tarifa informada. Só dispara se (requisições + 1) ≤ teto e (gasto + reserva) ≤ teto de custo. Depois: gasto = uso informado pelo
 * provedor; sem uso informado (erro, corpo ilegível), o gasto é a RESERVA inteira — nunca zero.
 */
export type BudgetLimits = { maxRequests: number; maxUsd: number; pricePerMillion: { input: number; output: number }; hostPattern: RegExp }
export type LedgerEntry = { index: number; label: string; url: string; reservedUsd: number; spentUsd: number; usageKnown: boolean; promptTokens: number | null; outputTokens: number | null; thoughtsTokens: number | null; totalTokens: number | null; status: number | "BLOCKED" | "NETWORK_ERROR"; durationMs: number | null }

export class PaidBudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PaidBudgetExceededError"
  }
}

/** Entrada estimada com folga: ~3 caracteres por token (pt-BR costuma ficar perto de 4). */
export const estimateInputTokens = (body: string) => Math.ceil(body.length / 3)

export function createPaidBudget(limits: BudgetLimits, baseFetch: typeof fetch = globalThis.fetch) {
  const ledger: LedgerEntry[] = []
  let label = "sem-etapa"
  const spent = () => ledger.reduce((sum, entry) => sum + entry.spentUsd, 0)
  const guardedFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    if (!limits.hostPattern.test(url)) return baseFetch(input, init)
    const body = typeof init?.body === "string" ? init.body : ""
    let maxOutput = 65_536
    try {
      maxOutput = (JSON.parse(body) as { generationConfig?: { maxOutputTokens?: number } }).generationConfig?.maxOutputTokens ?? 65_536
    } catch {
      // corpo não-JSON: reserva o teto padrão
    }
    const reservedUsd = (estimateInputTokens(body) * limits.pricePerMillion.input + maxOutput * limits.pricePerMillion.output) / 1_000_000
    const index = ledger.length + 1
    if (index > limits.maxRequests || spent() + reservedUsd > limits.maxUsd) {
      ledger.push({ index, label, url, reservedUsd, spentUsd: 0, usageKnown: true, promptTokens: null, outputTokens: null, thoughtsTokens: null, totalTokens: null, status: "BLOCKED", durationMs: null })
      throw new PaidBudgetExceededError(`Orçamento de avaliação atingido antes da requisição ${index} (${label}): ${index - 1}/${limits.maxRequests} requisições, US$ ${spent().toFixed(4)} gastos, reserva desta US$ ${reservedUsd.toFixed(4)}, teto US$ ${limits.maxUsd}.`)
    }
    const entry: LedgerEntry = { index, label, url: url.replace(/key=[^&]+/, "key=***"), reservedUsd, spentUsd: reservedUsd, usageKnown: false, promptTokens: null, outputTokens: null, thoughtsTokens: null, totalTokens: null, status: "NETWORK_ERROR", durationMs: null }
    ledger.push(entry)
    const started = Date.now()
    const response = await baseFetch(input, init)
    entry.durationMs = Date.now() - started
    entry.status = response.status
    try {
      const usage = ((await response.clone().json()) as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number } }).usageMetadata
      if (usage?.promptTokenCount !== undefined && usage.totalTokenCount !== undefined) {
        entry.promptTokens = usage.promptTokenCount
        entry.outputTokens = usage.candidatesTokenCount ?? null
        entry.thoughtsTokens = usage.thoughtsTokenCount ?? null
        entry.totalTokens = usage.totalTokenCount
        entry.spentUsd = (usage.promptTokenCount * limits.pricePerMillion.input + Math.max(0, usage.totalTokenCount - usage.promptTokenCount) * limits.pricePerMillion.output) / 1_000_000
        entry.usageKnown = true
      }
    } catch {
      // uso desconhecido: fica a reserva inteira como gasto
    }
    return response
  }
  return {
    fetch: guardedFetch,
    ledger,
    setLabel: (value: string) => { label = value },
    totals: () => ({ requests: ledger.filter((entry) => entry.status !== "BLOCKED").length, blocked: ledger.filter((entry) => entry.status === "BLOCKED").length, spentUsd: spent(), unknownUsage: ledger.filter((entry) => entry.status !== "BLOCKED" && !entry.usageKnown).length, promptTokens: ledger.reduce((sum, entry) => sum + (entry.promptTokens ?? 0), 0), outputAndThoughtsTokens: ledger.reduce((sum, entry) => sum + Math.max(0, (entry.totalTokens ?? 0) - (entry.promptTokens ?? 0)), 0) }),
  }
}
