import { afterEach, describe, expect, it, vi } from "vitest"
import { createEphemeralRealtimeSession, REALTIME_MODEL } from "./gemini-realtime-client.js"

vi.mock("../../../config/env.js", () => ({ env: { GEMINI_API_KEY: "test-key" } }))

afterEach(() => vi.unstubAllGlobals())

const TOOLS = [{ name: "consultar_faturamento", description: "Faturamento", parameters: { type: "object", properties: {} } }]

describe("token efêmero da voz travado na configuração do servidor (R-04)", () => {
  it("leva o setup inteiro no pedido do token, sem fieldMask (o setup do cliente é ignorado), para uma única sessão", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ name: "auth_tokens/abc" })))
    vi.stubGlobal("fetch", fetchMock)
    const session = await createEphemeralRealtimeSession({ systemInstruction: "INSTRUÇÃO DO SERVIDOR", tools: TOOLS, voiceName: "Kore", thinkingBudget: 0 })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/auth_tokens")
    const body = JSON.parse(String(init.body))
    expect(body.uses).toBe(1)
    expect(body).not.toHaveProperty("fieldMask")
    expect(body.bidiGenerateContentSetup).toEqual({
      model: REALTIME_MODEL,
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }, thinkingConfig: { thinkingBudget: 0 } },
      systemInstruction: { parts: [{ text: "INSTRUÇÃO DO SERVIDOR" }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
      tools: [{ functionDeclarations: TOOLS }],
    })
    expect(session.wsUrl).toBe("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens%2Fabc")
    expect(session.model).toBe(REALTIME_MODEL)
    expect(JSON.stringify(session)).not.toContain("INSTRUÇÃO DO SERVIDOR")
  })

  it("sem especialistas não declara ferramentas; sem orçamento de raciocínio, usa o padrão do modelo", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ name: "auth_tokens/abc" })))
    vi.stubGlobal("fetch", fetchMock)
    await createEphemeralRealtimeSession({ systemInstruction: "x", tools: [], voiceName: "Kore" })
    const setup = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).bidiGenerateContentSetup
    expect(setup).not.toHaveProperty("tools")
    expect(setup.generationConfig).not.toHaveProperty("thinkingConfig")
  })
})

describe("emissão do token da voz com prazo", () => {
  it("o pedido leva um prazo; provedor travado vira 504 claro (o botão de voz não fica preso)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal)
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError")
    })
    vi.stubGlobal("fetch", fetchMock)
    await expect(createEphemeralRealtimeSession({ systemInstruction: "x", tools: [], voiceName: "Kore" })).rejects.toMatchObject({ code: "REALTIME_SESSION_TIMEOUT", statusCode: 504 })
  })
})
