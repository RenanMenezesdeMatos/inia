/**
 * ORÇAMENTO DA RODADA V12 (02/10/2026): US$ 0,30 e 8 requisições de modelo para TUDO — revisão, confirmação focal, planejamento,
 * redação, verificação, reparos e retentativas, somando TODAS as etapas (cada etapa roda separada e lê o que sobrou). Livro-razão
 * PRÓPRIO, separado dos encerrados da V10 e da V11 (`round-v10-budget-ledger.json` e `round-v11-budget-ledger.json`, intocados). Nunca reinicia: cada execução paga lê o livro-razão, recebe só o que SOBROU (trava HTTP
 * com reserva do pior caso por requisição — ver `paid-budget.ts`) e grava as entradas, mesmo se falhar no meio.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createPaidBudget, type LedgerEntry } from "../paid-budget.js"

const here = dirname(fileURLToPath(import.meta.url))
export const ROUND_V12_LEDGER = join(here, "results", "round-v12-budget-ledger.json")
export const ROUND_V12_LIMITS = { maxRequests: 8, maxUsd: 0.3, pricePerMillion: { input: 0.75, output: 3.75 }, hostPattern: /generativelanguage\.googleapis\.com/ }

type StoredEntry = LedgerEntry & { script: string; at: string }
type StoredLedger = { limits: { maxRequests: number; maxUsd: number; pricePerMillion: { input: number; output: number } }; entries: StoredEntry[] }

export function readRoundV12Ledger(): StoredLedger {
  if (!existsSync(ROUND_V12_LEDGER)) return { limits: { maxRequests: ROUND_V12_LIMITS.maxRequests, maxUsd: ROUND_V12_LIMITS.maxUsd, pricePerMillion: ROUND_V12_LIMITS.pricePerMillion }, entries: [] }
  return JSON.parse(readFileSync(ROUND_V12_LEDGER, "utf8")) as StoredLedger
}

export function roundV12Totals(ledger = readRoundV12Ledger()) {
  const sent = ledger.entries.filter((entry) => entry.status !== "BLOCKED")
  return { requests: sent.length, spentUsd: sent.reduce((sum, entry) => sum + entry.spentUsd, 0), blocked: ledger.entries.filter((entry) => entry.status === "BLOCKED").length }
}

/** Trava com o que sobrou do orçamento global; `persist()` grava as entradas desta execução no livro-razão (chamar no `finally`). */
export function openRoundV12Budget(script: string, baseFetch: typeof fetch) {
  const ledger = readRoundV12Ledger()
  const before = roundV12Totals(ledger)
  const remaining = { maxRequests: Math.max(0, ROUND_V12_LIMITS.maxRequests - before.requests), maxUsd: Math.max(0, ROUND_V12_LIMITS.maxUsd - before.spentUsd) }
  const budget = createPaidBudget({ ...ROUND_V12_LIMITS, ...remaining }, baseFetch)
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
      writeFileSync(ROUND_V12_LEDGER, JSON.stringify(next, null, 2))
      return roundV12Totals(next)
    },
  }
}
