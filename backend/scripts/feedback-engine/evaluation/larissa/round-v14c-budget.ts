/**
 * ORÇAMENTO DA VALIDAÇÃO V14C (05/10/2026): o mesmo cenário depois da correção da ordem da referência; respostas pagas da V14 e da V14B
 * com o MESMO pedido são reaproveitadas sem custo — só as redações (indicador e monitoria) devem ir ao modelo. Teto de 10 requisições e
 * US$ 0,25. Livro-razão PRÓPRIO (`round-v14c-budget-ledger.json`); V8–V14B e a linha de base intocados.
 * Nunca reinicia: cada execução paga lê o livro-razão, recebe só o que SOBROU (trava HTTP com reserva do pior caso por requisição — ver
 * `paid-budget.ts`) e grava as entradas, mesmo se falhar no meio.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createPaidBudget, type LedgerEntry } from "../paid-budget.js"

const here = dirname(fileURLToPath(import.meta.url))
export const ROUND_V14C_LEDGER = join(here, "results", "round-v14c-budget-ledger.json")
export const ROUND_V14C_LIMITS = { maxRequests: 10, maxUsd: 0.25, pricePerMillion: { input: 0.75, output: 3.75 }, hostPattern: /generativelanguage\.googleapis\.com/ }

type StoredEntry = LedgerEntry & { script: string; at: string }
type StoredLedger = { limits: { maxRequests: number; maxUsd: number; pricePerMillion: { input: number; output: number } }; entries: StoredEntry[] }

export function readRoundV14CLedger(): StoredLedger {
  if (!existsSync(ROUND_V14C_LEDGER)) return { limits: { maxRequests: ROUND_V14C_LIMITS.maxRequests, maxUsd: ROUND_V14C_LIMITS.maxUsd, pricePerMillion: ROUND_V14C_LIMITS.pricePerMillion }, entries: [] }
  return JSON.parse(readFileSync(ROUND_V14C_LEDGER, "utf8")) as StoredLedger
}

export function roundV14CTotals(ledger = readRoundV14CLedger()) {
  const sent = ledger.entries.filter((entry) => entry.status !== "BLOCKED")
  return { requests: sent.length, spentUsd: sent.reduce((sum, entry) => sum + entry.spentUsd, 0), blocked: ledger.entries.filter((entry) => entry.status === "BLOCKED").length }
}

/** Trava com o que sobrou do orçamento global; `persist()` grava as entradas desta execução no livro-razão (chamar no `finally`). */
export function openRoundV14CBudget(script: string, baseFetch: typeof fetch) {
  const ledger = readRoundV14CLedger()
  const before = roundV14CTotals(ledger)
  const remaining = { maxRequests: Math.max(0, ROUND_V14C_LIMITS.maxRequests - before.requests), maxUsd: Math.max(0, ROUND_V14C_LIMITS.maxUsd - before.spentUsd) }
  const budget = createPaidBudget({ ...ROUND_V14C_LIMITS, ...remaining }, baseFetch)
  let persisted = false
  return {
    budget,
    before,
    remaining,
    persist() {
      if (persisted) return
      persisted = true
      const at = new Date().toISOString()
      const next: StoredLedger = { ...ledger, entries: [...ledger.entries, ...budget.ledger.map((entry) => ({ ...entry, index: ledger.entries.length + entry.index, script, at }))] }
      writeFileSync(ROUND_V14C_LEDGER, JSON.stringify(next, null, 2))
      return roundV14CTotals(next)
    },
  }
}
