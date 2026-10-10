/**
 * ORÇAMENTO DA RODADA V13 (02/10/2026): US$ 1,20 e 24 requisições de modelo para os DOIS cenários (A = C07 com análise nova e
 * redação; C = TMA de agosto/2026 com ferramentas, análises da própria pessoa e redação) — análise, revisão, confirmação, planejamento,
 * redação, verificação, reparos e coerência. Livro-razão PRÓPRIO (`round-v13-budget-ledger.json`); V8–V12 e a linha de base intocados.
 * Nunca reinicia: cada execução paga lê o livro-razão, recebe só o que SOBROU (trava HTTP com reserva do pior caso por requisição — ver
 * `paid-budget.ts`) e grava as entradas, mesmo se falhar no meio.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createPaidBudget, type LedgerEntry } from "../paid-budget.js"

const here = dirname(fileURLToPath(import.meta.url))
export const ROUND_V13_LEDGER = join(here, "results", "round-v13-budget-ledger.json")
export const ROUND_V13_LIMITS = { maxRequests: 24, maxUsd: 1.2, pricePerMillion: { input: 0.75, output: 3.75 }, hostPattern: /generativelanguage\.googleapis\.com/ }

type StoredEntry = LedgerEntry & { script: string; at: string }
type StoredLedger = { limits: { maxRequests: number; maxUsd: number; pricePerMillion: { input: number; output: number } }; entries: StoredEntry[] }

export function readRoundV13Ledger(): StoredLedger {
  if (!existsSync(ROUND_V13_LEDGER)) return { limits: { maxRequests: ROUND_V13_LIMITS.maxRequests, maxUsd: ROUND_V13_LIMITS.maxUsd, pricePerMillion: ROUND_V13_LIMITS.pricePerMillion }, entries: [] }
  return JSON.parse(readFileSync(ROUND_V13_LEDGER, "utf8")) as StoredLedger
}

export function roundV13Totals(ledger = readRoundV13Ledger()) {
  const sent = ledger.entries.filter((entry) => entry.status !== "BLOCKED")
  return { requests: sent.length, spentUsd: sent.reduce((sum, entry) => sum + entry.spentUsd, 0), blocked: ledger.entries.filter((entry) => entry.status === "BLOCKED").length }
}

/** Trava com o que sobrou do orçamento global; `persist()` grava as entradas desta execução no livro-razão (chamar no `finally`). */
export function openRoundV13Budget(script: string, baseFetch: typeof fetch) {
  const ledger = readRoundV13Ledger()
  const before = roundV13Totals(ledger)
  const remaining = { maxRequests: Math.max(0, ROUND_V13_LIMITS.maxRequests - before.requests), maxUsd: Math.max(0, ROUND_V13_LIMITS.maxUsd - before.spentUsd) }
  const budget = createPaidBudget({ ...ROUND_V13_LIMITS, ...remaining }, baseFetch)
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
      writeFileSync(ROUND_V13_LEDGER, JSON.stringify(next, null, 2))
      return roundV13Totals(next)
    },
  }
}
