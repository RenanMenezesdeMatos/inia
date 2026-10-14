import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { streamTextReply } from "./gemini-text-client.js"

vi.mock("../../../config/env.js", () => ({ env: { GEMINI_API_KEY: "test-key" } }))

/**
 * Prazo do streaming do chat: até 13/10/2026 um AbortSignal.timeout(15 s) no fetch valia para a resposta INTEIRA e cortava
 * respostas longas no meio. Agora: 15 s até começar, 30 s de silêncio máximo entre pedaços, e o cancelamento de quem pediu.
 * O "provedor" é um fetch falso cujo corpo reage ao sinal como o fetch real (erro na leitura quando aborta).
 */
type Script = { atMs: number; text: string }[]

function providerStreaming(script: Script, endAtMs: number | null) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const signal = init.signal!
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true })
        for (const step of script) setTimeout(() => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: step.text }] } }] })}\n\n`)), step.atMs)
        if (endAtMs !== null) setTimeout(() => controller.close(), endAtMs)
      },
    })
    return new Response(body, { status: 200 })
  })
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("streaming do chat — prazo por silêncio, nunca pela resposta inteira", () => {
  it("resposta de 50 s com um pedaço a cada 10 s chega inteira", async () => {
    vi.stubGlobal("fetch", providerStreaming([10, 20, 30, 40, 50].map((s) => ({ atMs: s * 1_000, text: `${s} ` })), 50_500))
    const chunks: string[] = []
    const reply = streamTextReply([{ role: "user", text: "oi" }], "sys", (text) => chunks.push(text))
    await vi.advanceTimersByTimeAsync(51_000)
    await reply
    expect(chunks.join("")).toBe("10 20 30 40 50 ")
  })

  it("30 s de silêncio depois de começar = TEXT_REPLY_TIMEOUT", async () => {
    vi.stubGlobal("fetch", providerStreaming([{ atMs: 1_000, text: "começo" }], null))
    const reply = streamTextReply([{ role: "user", text: "oi" }], "sys", () => {}).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(31_100)
    expect(await reply).toMatchObject({ code: "TEXT_REPLY_TIMEOUT", statusCode: 504 })
  })

  it("quem pediu foi embora: a leitura para na hora com AI_CALL_CANCELLED", async () => {
    vi.stubGlobal("fetch", providerStreaming([{ atMs: 1_000, text: "começo" }], null))
    const cancel = new AbortController()
    const reply = streamTextReply([{ role: "user", text: "oi" }], "sys", () => {}, cancel.signal).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(2_000)
    cancel.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(await reply).toMatchObject({ code: "AI_CALL_CANCELLED" })
  })
})
