/**
 * ORÇAMENTO DA VALIDAÇÃO V14D (05/10/2026): só as redações (indicador e monitoria) depois da composição V12 — todo o resto reaproveitado
 * das respostas pagas da V14, V14B e V14C. Teto de 8 requisições e US$ 0,15. Livro-razão PRÓPRIO (`round-v14d-budget-ledger.json`).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createPaidBudget, type LedgerEntry } from "../paid-budget.js"

const here = dirname(fileURLToPath(import.meta.url))
export const ROUND_V14D_LEDGER = join(here, "results", "round-v14d-budget-ledger.json")
export const ROUND_V14D_LIMITS = { maxRequests: 8, maxUsd: 0.15, pricePerMillion: { input: 0.75, output: 3.75 }, hostPattern: /generativelanguage\.googleapis\.com/ }

type StoredEntry = LedgerEntry & { script: string; at: string }
type StoredLedger = { limits: { maxRequests: number; maxUsd: number; pricePerMillion: { input: number; output: number } }; entries: StoredEntry[] }

export function readRoundV14DLedger(): StoredLedger {
  if (!existsSync(ROUND_V14D_LEDGER)) return { limits: { maxRequests: ROUND_V14D_LIMITS.maxRequests, maxUsd: ROUND_V14D_LIMITS.maxUsd, pricePerMillion: ROUND_V14D_LIMITS.pricePerMillion }, entries: [] }
  return JSON.parse(readFileSync(ROUND_V14D_LEDGER, "utf8")) as StoredLedger
}

export function roundV14DTotals(ledger = readRoundV14DLedger()) {
  const sent = ledger.entries.filter((entry) => entry.status !== "BLOCKED")
  return { requests: sent.length, spentUsd: sent.reduce((sum, entry) => sum + entry.spentUsd, 0), blocked: ledger.entries.filter((entry) => entry.status === "BLOCKED").length }
}

/** Trava com o que sobrou do orçamento global; `persist()` grava as entradas desta execução no livro-razão (chamar no `finally`). */
export function openRoundV14DBudget(script: string, baseFetch: typeof fetch) {
  const ledger = readRoundV14DLedger()
  const before = roundV14DTotals(ledger)
  const remaining = { maxRequests: Math.max(0, ROUND_V14D_LIMITS.maxRequests - before.requests), maxUsd: Math.max(0, ROUND_V14D_LIMITS.maxUsd - before.spentUsd) }
  const budget = createPaidBudget({ ...ROUND_V14D_LIMITS, ...remaining }, baseFetch)
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
      writeFileSync(ROUND_V14D_LEDGER, JSON.stringify(next, null, 2))
      return roundV14DTotals(next)
    },
  }
}
