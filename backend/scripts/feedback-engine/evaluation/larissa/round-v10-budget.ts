/**
 * ORÇAMENTO GLOBAL DA TAREFA V10 (02/10/2026): US$ 0,60 e 16 requisições de modelo para TUDO — comparação de contratos, teste
 * sintético, revisão, confirmação focal, ferramentas semânticas, redação, verificação e retentativas. Nunca reinicia entre scripts:
 * cada execução paga lê o livro-razão gravado, recebe só o que SOBROU (trava HTTP com reserva do pior caso por requisição — ver
 * `paid-budget.ts`) e acrescenta as suas entradas ao final, mesmo se falhar no meio.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createPaidBudget, type LedgerEntry } from "../paid-budget.js"

const here = dirname(fileURLToPath(import.meta.url))
export const ROUND_V10_LEDGER = join(here, "results", "round-v10-budget-ledger.json")
export const ROUND_V10_LIMITS = { maxRequests: 16, maxUsd: 0.6, pricePerMillion: { input: 0.75, output: 3.75 }, hostPattern: /generativelanguage\.googleapis\.com/ }

type StoredEntry = LedgerEntry & { script: string; at: string }
type StoredLedger = { limits: { maxRequests: number; maxUsd: number; pricePerMillion: { input: number; output: number } }; entries: StoredEntry[] }

export function readRoundV10Ledger(): StoredLedger {
  if (!existsSync(ROUND_V10_LEDGER)) return { limits: { maxRequests: ROUND_V10_LIMITS.maxRequests, maxUsd: ROUND_V10_LIMITS.maxUsd, pricePerMillion: ROUND_V10_LIMITS.pricePerMillion }, entries: [] }
  return JSON.parse(readFileSync(ROUND_V10_LEDGER, "utf8")) as StoredLedger
}

export function roundV10Totals(ledger = readRoundV10Ledger()) {
  const sent = ledger.entries.filter((entry) => entry.status !== "BLOCKED")
  return { requests: sent.length, spentUsd: sent.reduce((sum, entry) => sum + entry.spentUsd, 0), blocked: ledger.entries.filter((entry) => entry.status === "BLOCKED").length }
}

/** Trava com o que sobrou do orçamento global; `persist()` grava as entradas desta execução no livro-razão (chamar no `finally`). */
export function openRoundV10Budget(script: string, baseFetch: typeof fetch) {
  const ledger = readRoundV10Ledger()
  const before = roundV10Totals(ledger)
  const remaining = { maxRequests: Math.max(0, ROUND_V10_LIMITS.maxRequests - before.requests), maxUsd: Math.max(0, ROUND_V10_LIMITS.maxUsd - before.spentUsd) }
  const budget = createPaidBudget({ ...ROUND_V10_LIMITS, ...remaining }, baseFetch)
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
      writeFileSync(ROUND_V10_LEDGER, JSON.stringify(next, null, 2))
      return roundV10Totals(next)
    },
  }
}
