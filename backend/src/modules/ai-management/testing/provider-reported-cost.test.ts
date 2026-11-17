import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { ResolvedConnection } from "../application/provider-adapter-port.js"
import { PROVIDER_RESPONSE_COST_HEADER, reportedCostFromHeaders } from "../infrastructure/adapters/http.js"
import { createOpenAiChatAdapter } from "../infrastructure/adapters/openai-chat-adapter.js"
import { FAKE_RESPONSE_COST_HEADER, startFakeOpenAiServer, type FakeServer } from "./fake-openai-compatible-server.js"

/**
 * CUSTO INFORMADO PELO PROVEDOR — o adaptador OpenAI-compatível contra um servidor HTTP FALSO em 127.0.0.1 (nenhuma API real
 * ou paga). Um gateway compatível com OpenAI baseado em LiteLLM informa o custo da chamada em USD no cabeçalho da resposta,
 * com e sem streaming; o adaptador devolve esse valor em `reportedCost`. Cabeçalho ausente, vazio, negativo ou não numérico
 * = `reportedCost: null` (o runtime estima pela tabela) — nunca erro.
 */
const KEY = "sk-fake-reported-cost-0001"
let fake: FakeServer
let connection: ResolvedConnection
const adapter = createOpenAiChatAdapter(fetch)
const request = { systemPrompt: "Prova", contents: [{ role: "user" as const, text: "Olá" }], tools: [], structuredOutput: false, maxOutputTokens: null }

beforeAll(async () => {
  fake = await startFakeOpenAiServer({ apiKey: KEY })
  connection = { id: "conn-cost", name: "Gateway falso", providerKey: "OPENAI_COMPATIBLE", adapterType: "OPENAI_CHAT_COMPLETIONS", baseUrl: fake.url, apiVersion: null, apiKey: KEY, headers: {}, timeoutMs: 5_000 }
})
afterAll(() => fake.close())
beforeEach(() => fake.setResponseCost(null))

describe("cabeçalho de custo do gateway compatível com OpenAI/LiteLLM", () => {
  it("o servidor falso usa o mesmo nome de cabeçalho que o adaptador lê", () => {
    expect(FAKE_RESPONSE_COST_HEADER).toBe(PROVIDER_RESPONSE_COST_HEADER)
    expect(reportedCostFromHeaders(new Headers({ [PROVIDER_RESPONSE_COST_HEADER]: "0.0003465" }))).toEqual({ amount: "0.0003465", currency: "USD" })
    // Gasto acumulado e teto da chave NÃO são o custo da chamada.
    expect(reportedCostFromHeaders(new Headers({ "x-litellm-key-spend": "12.5", "x-litellm-key-max-budget": "100" }))).toBeNull()
    expect(reportedCostFromHeaders(null)).toBeNull()
  })

  it("execute (sem streaming): custo informado volta junto com o uso de sempre", async () => {
    fake.setResponseCost("0.0003465")
    const result = await adapter.execute(connection, "fake-ok", request, 5_000)
    expect(result.reportedCost).toEqual({ amount: "0.0003465", currency: "USD" })
    expect(result.usage).toMatchObject({ promptTokens: 1200, outputTokens: 300 })
  })

  it("execute: notação científica é aceita; sem uso informado o custo informado continua valendo", async () => {
    fake.setResponseCost("3.465e-05")
    expect((await adapter.execute(connection, "fake-ok", request, 5_000)).reportedCost).toEqual({ amount: "0.00003465", currency: "USD" })
    fake.setResponseCost("0.002")
    const noUsage = await adapter.execute(connection, "fake-no-usage", request, 5_000)
    expect(noUsage.usage.promptTokens).toBeNull()
    expect(noUsage.reportedCost).toEqual({ amount: "0.002", currency: "USD" })
  })

  it("streamExecute (chat em fluxo): o cabeçalho chega no início e o custo volta no fim, com o texto inteiro", async () => {
    fake.setResponseCost("0.0001")
    const chunks: string[] = []
    const result = await adapter.streamExecute!(connection, "fake-ok", request, 5_000, (text) => chunks.push(text))
    expect(chunks.join("")).toBe("Olá do provider falso.")
    expect(result.reportedCost).toEqual({ amount: "0.0001", currency: "USD" })
  })

  it("stream (texto livre): custo informado também volta", async () => {
    fake.setResponseCost("0.00042")
    const result = await adapter.stream!(connection, "fake-ok", { systemPrompt: "Prova", contents: [{ role: "user", text: "Olá" }], maxOutputTokens: null }, 5_000, () => undefined)
    expect(result.text).toBe("Olá do provider falso.")
    expect(result.reportedCost).toEqual({ amount: "0.00042", currency: "USD" })
  })

  it("voz (/audio/speech): custo informado no cabeçalho volta mesmo sem uso de tokens", async () => {
    fake.setResponseCost("0.000015")
    const spoken = await adapter.synthesizeSpeech!(connection, "fake-ok", { text: "Olá", voice: "alloy", instructions: null }, 5_000)
    expect(spoken.usage.promptTokens).toBeNull()
    expect(spoken.reportedCost).toEqual({ amount: "0.000015", currency: "USD" })
  })

  it("cabeçalho ausente, vazio, negativo ou não numérico: reportedCost null em todos os caminhos — nunca erro", async () => {
    for (const raw of [null, "", "  ", "-0.5", "abc", "None", "NaN"]) {
      fake.setResponseCost(raw)
      const label = String(raw)
      expect((await adapter.execute(connection, "fake-ok", request, 5_000)).reportedCost, label).toBeNull()
      expect((await adapter.streamExecute!(connection, "fake-ok", request, 5_000, () => undefined)).reportedCost, label).toBeNull()
      expect((await adapter.stream!(connection, "fake-ok", { systemPrompt: "Prova", contents: [{ role: "user", text: "Olá" }], maxOutputTokens: null }, 5_000, () => undefined)).reportedCost, label).toBeNull()
    }
  })
})
