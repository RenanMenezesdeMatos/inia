/**
 * ORÇAMENTO DA VALIDAÇÃO V14B (05/10/2026): o mesmo cenário da V14 depois das correções; respostas pagas da V14 com o MESMO pedido são
 * reaproveitadas sem custo e só os pedidos novos vão ao modelo — teto de 30 requisições e US$ 0,80. Livro-razão PRÓPRIO
 * (`round-v14b-budget-ledger.json`); V8–V14 e a linha de base intocados.
 * Nunca reinicia: cada execução paga lê o livro-razão, recebe só o que SOBROU (trava HTTP com reserva do pior caso por requisição — ver
 * `paid-budget.ts`) e grava as entradas, mesmo se falhar no meio.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createPaidBudget, type LedgerEntry } from "../paid-budget.js"

const here = dirname(fileURLToPath(import.meta.url))
export const ROUND_V14B_LEDGER = join(here, "results", "round-v14b-budget-ledger.json")
export const ROUND_V14B_LIMITS = { maxRequests: 30, maxUsd: 0.8, pricePerMillion: { input: 0.75, output: 3.75 }, hostPattern: /generativelanguage\.googleapis\.com/ }

type StoredEntry = LedgerEntry & { script: string; at: string }
type StoredLedger = { limits: { maxRequests: number; maxUsd: number; pricePerMillion: { input: number; output: number } }; entries: StoredEntry[] }

export function readRoundV14BLedger(): StoredLedger {
  if (!existsSync(ROUND_V14B_LEDGER)) return { limits: { maxRequests: ROUND_V14B_LIMITS.maxRequests, maxUsd: ROUND_V14B_LIMITS.maxUsd, pricePerMillion: ROUND_V14B_LIMITS.pricePerMillion }, entries: [] }
  return JSON.parse(readFileSync(ROUND_V14B_LEDGER, "utf8")) as StoredLedger
}

export function roundV14BTotals(ledger = readRoundV14BLedger()) {
  const sent = ledger.entries.filter((entry) => entry.status !== "BLOCKED")
  return { requests: sent.length, spentUsd: sent.reduce((sum, entry) => sum + entry.spentUsd, 0), blocked: ledger.entries.filter((entry) => entry.status === "BLOCKED").length }
}

/** Trava com o que sobrou do orçamento global; `persist()` grava as entradas desta execução no livro-razão (chamar no `finally`). */
export function openRoundV14BBudget(script: string, baseFetch: typeof fetch) {
  const ledger = readRoundV14BLedger()
  const before = roundV14BTotals(ledger)
  const remaining = { maxRequests: Math.max(0, ROUND_V14B_LIMITS.maxRequests - before.requests), maxUsd: Math.max(0, ROUND_V14B_LIMITS.maxUsd - before.spentUsd) }
  const budget = createPaidBudget({ ...ROUND_V14B_LIMITS, ...remaining }, baseFetch)
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
      writeFileSync(ROUND_V14B_LEDGER, JSON.stringify(next, null, 2))
      return roundV14BTotals(next)
    },
  }
}
