/**
 * ORÇAMENTO DA LINHA DE BASE SIMPLES (02/10/2026): US$ 0,20 e 8 requisições de modelo para TUDO — redação, verificação e
 * retentativas dos três cenários. Livro-razão PRÓPRIO, separado dos encerrados da V10, V11 e V12 (intocados). Nunca reinicia: cada execução paga lê o livro-razão, recebe só o que SOBROU (trava HTTP
 * com reserva do pior caso por requisição — ver `paid-budget.ts`) e grava as entradas, mesmo se falhar no meio.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createPaidBudget, type LedgerEntry } from "../paid-budget.js"

const here = dirname(fileURLToPath(import.meta.url))
export const BASELINE_SIMPLE_LEDGER = join(here, "results", "baseline-simple-budget-ledger.json")
export const BASELINE_SIMPLE_LIMITS = { maxRequests: 8, maxUsd: 0.2, pricePerMillion: { input: 0.75, output: 3.75 }, hostPattern: /generativelanguage\.googleapis\.com/ }

type StoredEntry = LedgerEntry & { script: string; at: string }
type StoredLedger = { limits: { maxRequests: number; maxUsd: number; pricePerMillion: { input: number; output: number } }; entries: StoredEntry[] }

export function readBaselineSimpleLedger(): StoredLedger {
  if (!existsSync(BASELINE_SIMPLE_LEDGER)) return { limits: { maxRequests: BASELINE_SIMPLE_LIMITS.maxRequests, maxUsd: BASELINE_SIMPLE_LIMITS.maxUsd, pricePerMillion: BASELINE_SIMPLE_LIMITS.pricePerMillion }, entries: [] }
  return JSON.parse(readFileSync(BASELINE_SIMPLE_LEDGER, "utf8")) as StoredLedger
}

export function baselineSimpleTotals(ledger = readBaselineSimpleLedger()) {
  const sent = ledger.entries.filter((entry) => entry.status !== "BLOCKED")
  return { requests: sent.length, spentUsd: sent.reduce((sum, entry) => sum + entry.spentUsd, 0), blocked: ledger.entries.filter((entry) => entry.status === "BLOCKED").length }
}

/** Trava com o que sobrou do orçamento global; `persist()` grava as entradas desta execução no livro-razão (chamar no `finally`). */
export function openBaselineSimpleBudget(script: string, baseFetch: typeof fetch) {
  const ledger = readBaselineSimpleLedger()
  const before = baselineSimpleTotals(ledger)
  const remaining = { maxRequests: Math.max(0, BASELINE_SIMPLE_LIMITS.maxRequests - before.requests), maxUsd: Math.max(0, BASELINE_SIMPLE_LIMITS.maxUsd - before.spentUsd) }
  const budget = createPaidBudget({ ...BASELINE_SIMPLE_LIMITS, ...remaining }, baseFetch)
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
      writeFileSync(BASELINE_SIMPLE_LEDGER, JSON.stringify(next, null, 2))
      return baselineSimpleTotals(next)
    },
  }
}
