import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../config/env.js")>()
  return { env: { ...actual.env, GEMINI_API_KEY: "test-key" } }
})
const { streamWithTools } = await import("./gemini-function-calling-client.js")
const { geminiProviderAdapter } = await import("./gemini-provider-adapter.js")

/** Corpo SSE no formato do `streamGenerateContent?alt=sse` (pedaços em linhas `data:`), entregue em pedaços arbitrários. */
function sse(payloads: unknown[], split = 7): Response {
  const body = payloads.map((payload) => `data: ${JSON.stringify(payload)}\r\n\r\n`).join("")
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (let index = 0; index < body.length; index += split) controller.enqueue(encoder.encode(body.slice(index, index + split)))
      controller.close()
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } })
}

const realFetch = globalThis.fetch
let requests: { url: string; body: Record<string, unknown> }[] = []
function serve(...responses: Response[]) {
  requests = []
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return responses.shift()!
  }) as typeof fetch
}

beforeEach(() => {
  requests = []
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe("streamWithTools — chamada com ferramentas em fluxo", () => {
  it("texto: cada pedaço vai para onText assim que chega (pensamento nunca), com o uso do último pedaço", async () => {
    serve(sse([
      { candidates: [{ content: { parts: [{ text: "pensando…", thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: "Olá, " }] } }] },
      { candidates: [{ content: { parts: [{ text: "tudo certo." }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 } },
    ]))
    const chunks: string[] = []
    const result = await streamWithTools([{ role: "user", text: "oi" }], "SYS", [], (text) => chunks.push(text))
    expect(requests[0]!.url).toContain(":streamGenerateContent?alt=sse")
    expect(chunks).toEqual(["Olá, ", "tudo certo."])
    expect(result).toMatchObject({ kind: "text", text: "Olá, tudo certo.", streamedChars: "Olá, tudo certo.".length })
    expect(result.usage.promptTokens).toBe(10)
  })

  it("ferramenta: junta as chamadas com o thoughtSignature (devolvido no turno seguinte) e nada vai para a tela", async () => {
    serve(sse([{ candidates: [{ content: { parts: [{ functionCall: { name: "agent_x", args: { query: "q" } }, thoughtSignature: "sig-1" }, { functionCall: { name: "my_results", args: {} } }] } }] }]))
    const chunks: string[] = []
    const result = await streamWithTools([{ role: "user", text: "oi" }], "SYS", [{ name: "agent_x", description: "d", parameters: { type: "object", properties: {} } }], (text) => chunks.push(text))
    expect(chunks).toEqual([])
    expect(result).toMatchObject({ kind: "functionCalls", streamedChars: 0, calls: [{ name: "agent_x", args: { query: "q" }, thoughtSignature: "sig-1" }, { name: "my_results", args: {} }] })
    expect(requests[0]!.body.tools).toEqual([{ functionDeclarations: [expect.objectContaining({ name: "agent_x" })] }])
  })

  it("texto ANTES da ferramenta: o que saiu é contado (quem chamou retira) e o que vem depois da chamada não sai", async () => {
    serve(sse([
      { candidates: [{ content: { parts: [{ text: "Vou verificar. " }] } }] },
      { candidates: [{ content: { parts: [{ functionCall: { name: "agent_x", args: {} } }, { text: "depois" }] } }] },
    ]))
    const chunks: string[] = []
    const result = await streamWithTools([{ role: "user", text: "oi" }], "SYS", [], (text) => chunks.push(text))
    expect(chunks).toEqual(["Vou verificar. "])
    expect(result).toMatchObject({ kind: "functionCalls", streamedChars: "Vou verificar. ".length })
  })

  it("saída estruturada em fluxo: pede JSON (schema e teto de saída) e entrega o JSON cru em pedaços — quem chamou extrai o que mostra", async () => {
    serve(sse([
      { candidates: [{ content: { parts: [{ text: '{"answer":"Abra ' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'o protocolo."}' }] } }] },
    ]))
    const chunks: string[] = []
    const schema = { type: "object", properties: { answer: { type: "string" } } }
    const result = await streamWithTools([{ role: "user", text: "pergunta" }], "SYS", [], (text) => chunks.push(text), { json: { responseSchema: schema, maxOutputTokens: 900 } })
    expect(requests[0]!.body.generationConfig).toEqual({ responseMimeType: "application/json", responseSchema: schema, maxOutputTokens: 900 })
    expect(chunks.join("")).toBe('{"answer":"Abra o protocolo."}')
    expect(result).toMatchObject({ kind: "text", text: '{"answer":"Abra o protocolo."}' })
  })

  it("texto livre em fluxo não pede JSON", async () => {
    serve(sse([{ candidates: [{ content: { parts: [{ text: "ok" }] } }] }]))
    await streamWithTools([{ role: "user", text: "oi" }], "SYS", [], () => {})
    expect(requests[0]!.body.generationConfig).toBeUndefined()
  })

  it("menos raciocínio: `thinkingConfig.thinkingLevel` junto do JSON", async () => {
    serve(sse([{ candidates: [{ content: { parts: [{ text: "{}" }] } }] }]))
    await streamWithTools([{ role: "user", text: "p" }], "SYS", [], () => {}, { json: {}, thinkingLevel: "low" })
    expect(requests[0]!.body.generationConfig).toEqual({ responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } })
  })

  it("503 antes de começar: uma nova tentativa curta, como na chamada inteira", async () => {
    serve(new Response("high demand", { status: 503 }), sse([{ candidates: [{ content: { parts: [{ text: "ok" }] } }] }]))
    const result = await streamWithTools([{ role: "user", text: "oi" }], "SYS", [], () => {})
    expect(requests).toHaveLength(2)
    expect(result).toMatchObject({ kind: "text", text: "ok" })
  })
})

describe("adapter Gemini — menos raciocínio só para modelo que raciocina", () => {
  const profile = (supportsReasoning: boolean) => ({ id: "p", provider: "GEMINI" as const, model: "gemini-x", tier: "STANDARD" as const, contextWindow: 1_000_000, maxOutput: 65_536, supportsTools: true, supportsStructuredOutput: true, supportsReasoning, supportsPromptCache: false, enabled: true })
  const request = (supportsReasoning: boolean, reasoningEffort?: "LOW") => ({ systemPrompt: "SYS", contents: [{ role: "user" as const, text: "p" }], tools: [], structuredOutput: true, route: { profile: profile(supportsReasoning), tier: "STANDARD" as const, reason: "teste", mode: "CURRENT" as const, escalated: false, fallback: false }, ...(reasoningEffort ? { reasoningEffort } : {}) })
  const json = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 })

  it("resposta inteira e em fluxo: pede thinkingLevel low só quando o perfil raciocina; sem pedido, nada muda", async () => {
    serve(json(), sse([{ candidates: [{ content: { parts: [{ text: "{}" }] } }] }]), json(), json())
    await geminiProviderAdapter.generate(request(true, "LOW"))
    await geminiProviderAdapter.stream!(request(true, "LOW"), () => {})
    await geminiProviderAdapter.generate(request(false, "LOW"))
    await geminiProviderAdapter.generate(request(true))
    expect(requests.map((entry) => (entry.body.generationConfig as Record<string, unknown> | undefined)?.thinkingConfig ?? null)).toEqual([{ thinkingLevel: "low" }, { thinkingLevel: "low" }, null, null])
  })
})
