/**
 * ORÇAMENTO DA RODADA V14 (02/10/2026): US$ 1,00 e 44 requisições de modelo para o cenário de setembro da Larissa (TMA de
 * setembro/2026 com ferramentas, análises das chamadas dela e de colegas do grupo de referência, redação; depois a monitoria de uma
 * chamada com erro na mesma memória isolada). Livro-razão PRÓPRIO (`round-v14-budget-ledger.json`); V8–V13 e a linha de base intocados.
 * Nunca reinicia: cada execução paga lê o livro-razão, recebe só o que SOBROU (trava HTTP com reserva do pior caso por requisição — ver
 * `paid-budget.ts`) e grava as entradas, mesmo se falhar no meio.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createPaidBudget, type LedgerEntry } from "../paid-budget.js"

const here = dirname(fileURLToPath(import.meta.url))
export const ROUND_V14_LEDGER = join(here, "results", "round-v14-budget-ledger.json")
export const ROUND_V14_LIMITS = { maxRequests: 44, maxUsd: 1.0, pricePerMillion: { input: 0.75, output: 3.75 }, hostPattern: /generativelanguage\.googleapis\.com/ }

type StoredEntry = LedgerEntry & { script: string; at: string }
type StoredLedger = { limits: { maxRequests: number; maxUsd: number; pricePerMillion: { input: number; output: number } }; entries: StoredEntry[] }

export function readRoundV14Ledger(): StoredLedger {
  if (!existsSync(ROUND_V14_LEDGER)) return { limits: { maxRequests: ROUND_V14_LIMITS.maxRequests, maxUsd: ROUND_V14_LIMITS.maxUsd, pricePerMillion: ROUND_V14_LIMITS.pricePerMillion }, entries: [] }
  return JSON.parse(readFileSync(ROUND_V14_LEDGER, "utf8")) as StoredLedger
}

export function roundV14Totals(ledger = readRoundV14Ledger()) {
  const sent = ledger.entries.filter((entry) => entry.status !== "BLOCKED")
  return { requests: sent.length, spentUsd: sent.reduce((sum, entry) => sum + entry.spentUsd, 0), blocked: ledger.entries.filter((entry) => entry.status === "BLOCKED").length }
}

/** Trava com o que sobrou do orçamento global; `persist()` grava as entradas desta execução no livro-razão (chamar no `finally`). */
export function openRoundV14Budget(script: string, baseFetch: typeof fetch) {
  const ledger = readRoundV14Ledger()
  const before = roundV14Totals(ledger)
  const remaining = { maxRequests: Math.max(0, ROUND_V14_LIMITS.maxRequests - before.requests), maxUsd: Math.max(0, ROUND_V14_LIMITS.maxUsd - before.spentUsd) }
  const budget = createPaidBudget({ ...ROUND_V14_LIMITS, ...remaining }, baseFetch)
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
      writeFileSync(ROUND_V14_LEDGER, JSON.stringify(next, null, 2))
      return roundV14Totals(next)
    },
  }
}
