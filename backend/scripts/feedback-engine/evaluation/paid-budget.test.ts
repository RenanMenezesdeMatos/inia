import { describe, expect, it } from "vitest"
import { createPaidBudget, PaidBudgetExceededError } from "./paid-budget.js"

/** A trava conta TENTATIVAS REAIS na fronteira HTTP — inclusive o retry que o cliente faz por dentro. Zero chamada real. */
const limits = { maxRequests: 3, maxUsd: 0.05, pricePerMillion: { input: 0.75, output: 3.75 }, hostPattern: /generativelanguage\.googleapis\.com/ }
const body = (maxOutputTokens: number) => JSON.stringify({ contents: [{ role: "user", parts: [{ text: "x".repeat(3000) }] }], generationConfig: { maxOutputTokens } })
const ok = (usage: object | null) => new Response(JSON.stringify(usage ? { candidates: [], usageMetadata: usage } : { candidates: [] }), { status: 200 })

describe("trava de orçamento na fronteira HTTP", () => {
  it("conta cada tentativa (inclusive retry interno), usa o uso informado e cobra a RESERVA quando o uso é desconhecido", async () => {
    const responses = [new Response("indisponível", { status: 503 }), ok({ promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300, totalTokenCount: 1500 }), ok(null)]
    const budget = createPaidBudget(limits, (async () => responses.shift()!) as typeof fetch)
    // Um "cliente" que faz retry interno em 503 — o wrapper externo veria 1 chamada; a trava vê 2.
    const clientWithRetry = async () => {
      const first = await budget.fetch("https://generativelanguage.googleapis.com/v1/models/x:generateContent", { method: "POST", body: body(1000) })
      if (first.status === 503) return budget.fetch("https://generativelanguage.googleapis.com/v1/models/x:generateContent", { method: "POST", body: body(1000) })
      return first
    }
    await clientWithRetry()
    await budget.fetch("https://generativelanguage.googleapis.com/v1/models/x:generateContent", { method: "POST", body: body(1000) })
    const totals = budget.totals()
    expect(totals.requests).toBe(3)
    expect(budget.ledger[1]!.spentUsd).toBeCloseTo((1000 * 0.75 + 500 * 3.75) / 1e6, 8)
    // 503 sem uso e resposta sem usageMetadata: gasto = reserva (nunca zero).
    expect(budget.ledger[0]!.spentUsd).toBe(budget.ledger[0]!.reservedUsd)
    expect(budget.ledger[2]!.usageKnown).toBe(false)
    expect(totals.unknownUsage).toBe(2)
  })

  it("bloqueia ANTES de enviar quando o teto de requisições ou a reserva de custo estouraria", async () => {
    let sent = 0
    const budget = createPaidBudget({ ...limits, maxUsd: 0.02 }, (async () => { sent += 1; return ok({ promptTokenCount: 1000, totalTokenCount: 1200 }) }) as typeof fetch)
    await budget.fetch("https://generativelanguage.googleapis.com/a", { method: "POST", body: body(1000) })
    // Reserva de 8.192 tokens de saída ≈ US$ 0,031 > saldo: não sai.
    await expect(budget.fetch("https://generativelanguage.googleapis.com/b", { method: "POST", body: body(8192) })).rejects.toBeInstanceOf(PaidBudgetExceededError)
    expect(sent).toBe(1)
    const byCount = createPaidBudget({ ...limits, maxRequests: 1 }, (async () => ok({ promptTokenCount: 10, totalTokenCount: 20 })) as typeof fetch)
    await byCount.fetch("https://generativelanguage.googleapis.com/a", { method: "POST", body: body(10) })
    await expect(byCount.fetch("https://generativelanguage.googleapis.com/a", { method: "POST", body: body(10) })).rejects.toThrow(/Orçamento de avaliação atingido/)
  })

  it("não interfere em requisições que não são do provedor", async () => {
    const budget = createPaidBudget(limits, (async () => new Response("ok")) as typeof fetch)
    await budget.fetch("http://localhost:4000/health")
    expect(budget.ledger).toHaveLength(0)
  })
})
