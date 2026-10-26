import { afterEach, describe, expect, it, vi } from "vitest"
import { AiProviderError } from "../../../../shared/application/model-routing/ai-errors.js"
import type { FetchLike, ResolvedConnection } from "../../application/provider-adapter-port.js"
import { createAnthropicMessagesAdapter, normalizeAnthropicUsage, toAnthropicMessages } from "./anthropic-messages-adapter.js"
import { createGoogleGenAiAdapter } from "./google-genai-adapter.js"
import { endpointProblem } from "./http.js"
import { createOpenAiChatAdapter, normalizeOpenAiFinishReason, normalizeOpenAiUsage, toChatMessages, toJsonSchema } from "./openai-chat-adapter.js"

/**
 * Adapters contra um fetch FALSO — nenhuma API real (paga ou não) é chamada pela suíte (§103–§105).
 */
const SECRET = "sk-test-SUPERSECRETVALUE-9876"
const connection = (overrides: Partial<ResolvedConnection> = {}): ResolvedConnection => ({ id: "conn-1", name: "Teste", providerKey: "OPENAI", adapterType: "OPENAI_CHAT_COMPLETIONS", baseUrl: "https://api.example.test/v1", apiVersion: null, apiKey: SECRET, headers: {}, timeoutMs: 5_000, ...overrides })

type Call = { url: string; init: RequestInit | undefined }
function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return respond(url, init)
    },
  }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

afterEach(() => vi.restoreAllMocks())

describe("OpenAI Chat Completions (OpenAI, xAI, LM Studio, Ollama, compatível)", () => {
  it("normaliza uso (cached/reasoning) e nunca inventa campo ausente", () => {
    expect(normalizeOpenAiUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 } })).toEqual({ promptTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 40, reasoningTokens: 5 })
    expect(normalizeOpenAiUsage(undefined)).toEqual({ promptTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, reasoningTokens: null })
  })

  it("traduz function calling de ida e volta (ids casam entre chamada e resposta)", () => {
    const messages = toChatMessages("sys", [{ role: "user", text: "oi" }, { role: "model", functionCalls: [{ name: "buscar", args: { q: 1 } }] }, { role: "user", functionResponses: [{ name: "buscar", response: { ok: true } }] }])
    expect(messages[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "call_1_0", function: { name: "buscar", arguments: '{"q":1}' } }] })
    expect(messages[3]).toMatchObject({ role: "tool", tool_call_id: "call_1_0" })
  })

  it("executa com Bearer, JSON mode e devolve texto + uso; tool_calls viram functionCalls", async () => {
    const fake = fakeFetch((_url, init) => {
      const body = JSON.parse(String(init?.body))
      if (body.tools) return json({ model: "gpt-x", choices: [{ message: { tool_calls: [{ id: "abc", function: { name: "buscar", arguments: '{"a":2}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })
      return json({ model: "gpt-x", choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } })
    })
    const adapter = createOpenAiChatAdapter(fake.fetch)
    const text = await adapter.execute(connection(), "gpt-x", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [], structuredOutput: true, maxOutputTokens: null }, 1000)
    expect(text).toMatchObject({ kind: "text", text: '{"ok":true}', model: "gpt-x", usage: { promptTokens: 10, outputTokens: 3 } })
    expect((fake.calls[0]!.init!.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`)
    expect(JSON.parse(String(fake.calls[0]!.init!.body)).response_format).toEqual({ type: "json_object" })
    const calls = await adapter.execute(connection(), "gpt-x", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [{ name: "buscar", description: "d", parameters: { type: "object", properties: {} } }], structuredOutput: false, maxOutputTokens: null }, 1000)
    expect(calls).toMatchObject({ kind: "functionCalls", calls: [{ name: "buscar", args: { a: 2 }, id: "abc" }] })
  })

  it("servidor local sem credencial não envia Authorization", async () => {
    const fake = fakeFetch(() => json({ data: [{ id: "qwen2.5:7b" }, { id: "nomic-embed-text" }] }))
    const models = await createOpenAiChatAdapter(fake.fetch).listModels(connection({ apiKey: null, baseUrl: "http://localhost:11434/v1", providerKey: "OLLAMA" }))
    expect((fake.calls[0]!.init!.headers as Record<string, string>).authorization).toBeUndefined()
    expect(models.map((model) => [model.providerModelId, model.kind])).toEqual([["qwen2.5:7b", "GENERATIVE"], ["nomic-embed-text", "EMBEDDING"]])
    // Capacidades não informadas pelo protocolo ficam DESCONHECIDAS (o admin declara).
    expect(models[0]!.capabilities).toEqual({})
  })

  it("teste de conexão: CONNECTED / AUTH_ERROR / RATE_LIMITED / INVALID_ENDPOINT / NETWORK_ERROR — sem gerar texto", async () => {
    const statusFor = async (respond: () => Response | Promise<Response>) => (await createOpenAiChatAdapter(fakeFetch(respond).fetch).testConnection(connection())).status
    expect(await statusFor(() => json({ data: [{ id: "m" }] }))).toBe("CONNECTED")
    expect(await statusFor(() => json({ error: { message: `invalid key ${SECRET}` } }, 401))).toBe("AUTH_ERROR")
    expect(await statusFor(() => json({}, 429))).toBe("RATE_LIMITED")
    expect(await statusFor(() => json({}, 404))).toBe("INVALID_ENDPOINT")
    expect(await statusFor(() => Promise.reject(new TypeError("fetch failed")))).toBe("NETWORK_ERROR")
  })

  it("erro do provider: categoria + mensagem segura; segredo nunca na exceção nem no log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const fake = fakeFetch(() => json({ error: { message: `Incorrect API key provided: ${SECRET}` } }, 401))
    const error = await createOpenAiChatAdapter(fake.fetch).execute(connection(), "gpt-x", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [], structuredOutput: false, maxOutputTokens: null }, 1000).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AiProviderError)
    expect((error as AiProviderError).category).toBe("AUTH")
    expect(JSON.stringify({ message: (error as Error).message, details: (error as AiProviderError).details })).not.toContain(SECRET)
    const logged = warn.mock.calls.map((call) => String(call[0])).join("\n")
    expect(logged).toContain("ai_provider_error")
    expect(logged).not.toContain(SECRET)
    expect(logged).not.toContain("SUPERSECRET")
  })

  it("stream: concatena deltas e lê o uso do último chunk", async () => {
    const sse = ['data: {"choices":[{"delta":{"content":"Olá"}}]}', 'data: {"choices":[{"delta":{"content":" mundo"}}]}', 'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}', "data: [DONE]", ""].join("\n")
    const chunks: string[] = []
    const result = await createOpenAiChatAdapter(fakeFetch(() => new Response(sse, { status: 200 })).fetch).stream!(connection(), "m", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], maxOutputTokens: null }, 1000, (chunk) => chunks.push(chunk))
    expect(chunks).toEqual(["Olá", " mundo"])
    expect(result).toMatchObject({ text: "Olá mundo", usage: { promptTokens: 5, outputTokens: 2, totalTokens: 7 } })
  })

  // Schema do jeito que as etapas do feedback o mandam ao Gemini (maiúsculas, nullable, propertyOrdering).
  const STAGE_SCHEMA = { type: "OBJECT", properties: { items: { type: "ARRAY", items: { type: "OBJECT", properties: { itemRef: { type: "STRING" }, whyItMatters: { type: "STRING", nullable: true }, stance: { type: "string", enum: ["A", "B"], nullable: true } }, required: ["itemRef"], propertyOrdering: ["itemRef", "whyItMatters", "stance"] } } }, required: ["items"], propertyOrdering: ["items"] }

  it("schema da etapa → JSON Schema: tipos em minúsculas, nullable vira união com null (inclusive no enum), sem propertyOrdering", () => {
    expect(toJsonSchema(STAGE_SCHEMA)).toEqual({ type: "object", properties: { items: { type: "array", items: { type: "object", properties: { itemRef: { type: "string" }, whyItMatters: { type: ["string", "null"] }, stance: { type: ["string", "null"], enum: ["A", "B", null] } }, required: ["itemRef"] } } }, required: ["items"] })
  })

  it("saída estruturada COM schema da etapa → json_schema não estrito; sem schema → modo JSON; com tools → nenhum dos dois", async () => {
    const fake = fakeFetch(() => json({ model: "gpt-x", choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }))
    const adapter = createOpenAiChatAdapter(fake.fetch)
    const base = { systemPrompt: "Responda em JSON.", contents: [{ role: "user" as const, text: "t" }], tools: [], structuredOutput: true, maxOutputTokens: null }
    await adapter.execute(connection(), "gpt-x", { ...base, responseSchema: STAGE_SCHEMA }, 1000)
    expect(JSON.parse(String(fake.calls[0]!.init!.body)).response_format).toEqual({ type: "json_schema", json_schema: { name: "inia_response", strict: false, schema: toJsonSchema(STAGE_SCHEMA) } })
    await adapter.execute(connection(), "gpt-x", { ...base, responseSchema: null }, 1000)
    expect(JSON.parse(String(fake.calls[1]!.init!.body)).response_format).toEqual({ type: "json_object" })
    await adapter.execute(connection(), "gpt-x", { ...base, responseSchema: STAGE_SCHEMA, tools: [{ name: "f", description: "d", parameters: { type: "object", properties: {} } }] }, 1000)
    expect(JSON.parse(String(fake.calls[2]!.init!.body))).not.toHaveProperty("response_format")
    await adapter.execute(connection(), "gpt-x", { ...base, structuredOutput: false, responseSchema: STAGE_SCHEMA }, 1000)
    expect(JSON.parse(String(fake.calls[3]!.init!.body))).not.toHaveProperty("response_format")
  })

  it("teto de saída: API oficial da OpenAI usa max_completion_tokens (modelos de raciocínio recusam max_tokens); compatíveis seguem com max_tokens", async () => {
    const fake = fakeFetch(() => json({ model: "m", choices: [{ message: { content: "ok" } }] }))
    const adapter = createOpenAiChatAdapter(fake.fetch)
    const request = { systemPrompt: "s", contents: [{ role: "user" as const, text: "t" }], tools: [], structuredOutput: false, maxOutputTokens: 4096 }
    await adapter.execute(connection({ providerKey: "OPENAI" }), "gpt-x", request, 1000)
    await adapter.execute(connection({ providerKey: "OPENAI_COMPATIBLE" }), "m", request, 1000)
    await adapter.execute(connection({ providerKey: "OLLAMA" }), "m", { ...request, maxOutputTokens: null }, 1000)
    const bodies = fake.calls.map((call) => JSON.parse(String(call.init!.body)) as Record<string, unknown>)
    expect(bodies[0]).toMatchObject({ max_completion_tokens: 4096 })
    expect(bodies[0]).not.toHaveProperty("max_tokens")
    expect(bodies[1]).toMatchObject({ max_tokens: 4096 })
    expect(bodies[1]).not.toHaveProperty("max_completion_tokens")
    expect(bodies[2]).not.toHaveProperty("max_tokens")
    expect(bodies[2]).not.toHaveProperty("max_completion_tokens")
  })

  it("finish_reason no vocabulário do caminho legado (length = MAX_TOKENS — resposta truncada); ausente = null", async () => {
    expect([normalizeOpenAiFinishReason("stop"), normalizeOpenAiFinishReason("length"), normalizeOpenAiFinishReason("content_filter"), normalizeOpenAiFinishReason(undefined)]).toEqual(["STOP", "MAX_TOKENS", "SAFETY", null])
    const result = await createOpenAiChatAdapter(fakeFetch(() => json({ model: "m", choices: [{ message: { content: '{"a":' }, finish_reason: "length" }] })).fetch).execute(connection(), "m", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [], structuredOutput: true, maxOutputTokens: 10 }, 1000)
    expect(result).toMatchObject({ kind: "text", text: '{"a":', finishReason: "MAX_TOKENS" })
  })
})

describe("OpenAI — síntese de voz (/audio/speech)", () => {
  const speechRequest = { text: "Oi, Ana! Seu recado: confirme a data de nascimento antes de enviar.", voice: "marin", instructions: "Fale como uma supervisora calorosa." }

  it("manda o texto EXATO, a voz e a instrução de tom pedindo PCM; devolve PCM16 24 kHz sem inventar uso", async () => {
    const pcm = Buffer.alloc(4_801, 7)
    const fake = fakeFetch(() => new Response(pcm, { status: 200, headers: { "content-type": "audio/pcm" } }))
    const result = await createOpenAiChatAdapter(fake.fetch).synthesizeSpeech!(connection(), "gpt-4o-mini-tts", speechRequest, 1000)
    expect(fake.calls[0]!.url).toBe("https://api.example.test/v1/audio/speech")
    expect((fake.calls[0]!.init!.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`)
    expect(JSON.parse(String(fake.calls[0]!.init!.body))).toEqual({ model: "gpt-4o-mini-tts", input: speechRequest.text, voice: "marin", response_format: "pcm", instructions: "Fale como uma supervisora calorosa." })
    // Amostra incompleta no fim sai (PCM16 = 2 bytes por amostra).
    expect(result).toMatchObject({ sampleRate: 24_000, model: "gpt-4o-mini-tts", usage: { promptTokens: null, outputTokens: null, totalTokens: null } })
    expect(result.pcm16.length).toBe(4_800)
  })

  it("sem instrução de tom cadastrada, o campo nem vai (tts-1 recusaria)", async () => {
    const fake = fakeFetch(() => new Response(Buffer.alloc(100), { status: 200 }))
    await createOpenAiChatAdapter(fake.fetch).synthesizeSpeech!(connection(), "tts-1", { ...speechRequest, instructions: null }, 1000)
    expect(JSON.parse(String(fake.calls[0]!.init!.body))).not.toHaveProperty("instructions")
  })

  it("erros normalizados (sem repetir): credencial, rate limit, áudio vazio", async () => {
    const run = (respond: () => Response) => createOpenAiChatAdapter(fakeFetch(respond).fetch).synthesizeSpeech!(connection(), "gpt-4o-mini-tts", speechRequest, 1000).catch((caught: unknown) => caught)
    expect(await run(() => json({ error: { message: "bad key" } }, 401))).toMatchObject({ category: "AUTH" })
    expect(await run(() => json({ error: { message: "slow down" } }, 429))).toMatchObject({ category: "RATE_LIMIT" })
    const empty = await run(() => new Response(Buffer.alloc(0), { status: 200 }))
    expect(empty).toBeInstanceOf(AiProviderError)
    expect(empty).toMatchObject({ category: "PROVIDER_ERROR" })
  })
})

describe("Anthropic Messages", () => {
  it("uso: entrada = não cacheada + lida do cache + gravada no cache; raciocínio não informado = null", () => {
    expect(normalizeAnthropicUsage({ input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 5, output_tokens: 7 })).toEqual({ promptTokens: 105, outputTokens: 7, totalTokens: 112, cachedInputTokens: 90, reasoningTokens: null })
  })
  it("tool_use/tool_result com ids casados; x-api-key e anthropic-version no header", async () => {
    expect(toAnthropicMessages([{ role: "model", functionCalls: [{ name: "f", args: {} }] }, { role: "user", functionResponses: [{ name: "f", response: { r: 1 } }] }])[1]).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_0_0" }] })
    const fake = fakeFetch(() => json({ model: "claude-x", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 3, output_tokens: 1 } }))
    const result = await createAnthropicMessagesAdapter(fake.fetch).execute(connection({ providerKey: "ANTHROPIC", adapterType: "ANTHROPIC_MESSAGES" }), "claude-x", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [], structuredOutput: true, maxOutputTokens: null }, 1000)
    expect(result).toMatchObject({ kind: "text", text: "ok" })
    const headers = fake.calls[0]!.init!.headers as Record<string, string>
    expect(headers["x-api-key"]).toBe(SECRET)
    expect(headers["anthropic-version"]).toBe("2023-06-01")
    expect(JSON.parse(String(fake.calls[0]!.init!.body)).system).toContain("JSON")
  })
})

describe("Google GenAI (credencial da conexão, não do ambiente)", () => {
  it("descobre modelos com janela de contexto e capacidades com ORIGEM (descoberta × inferida)", async () => {
    const fake = fakeFetch(() => json({ models: [{ name: "models/gemini-x", displayName: "Gemini X", inputTokenLimit: 1_000_000, outputTokenLimit: 65_536, supportedGenerationMethods: ["generateContent", "streamGenerateContent", "createCachedContent"], thinking: true }, { name: "models/embed-1", supportedGenerationMethods: ["embedContent"] }] }))
    const models = await createGoogleGenAiAdapter(fake.fetch).listModels(connection({ providerKey: "GOOGLE_GENAI", adapterType: "GOOGLE_GENAI", baseUrl: "https://generativelanguage.googleapis.com/v1beta" }))
    expect(models[0]).toMatchObject({ providerModelId: "gemini-x", contextWindow: 1_000_000, capabilities: { STREAMING: { supported: true, source: "DISCOVERED" }, TOOLS: { supported: true, source: "INFERRED" }, REASONING: { supported: true, source: "DISCOVERED" } } })
    expect(models[1]).toMatchObject({ providerModelId: "embed-1", kind: "EMBEDDING" })
    expect((fake.calls[0]!.init!.headers as Record<string, string>)["x-goog-api-key"]).toBe(SECRET)
    expect(fake.calls[0]!.url).not.toContain(SECRET)
  })

  it("schema da etapa vai em generationConfig.responseSchema (como no cliente legado), só no modo JSON; finishReason volta", async () => {
    const fake = fakeFetch(() => json({ modelVersion: "gemini-x", candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "MAX_TOKENS" }] }))
    const adapter = createGoogleGenAiAdapter(fake.fetch)
    const google = connection({ providerKey: "GOOGLE_GENAI", adapterType: "GOOGLE_GENAI", baseUrl: "https://generativelanguage.googleapis.com/v1beta" })
    const schema = { type: "OBJECT", properties: { a: { type: "STRING" } } }
    const result = await adapter.execute(google, "gemini-x", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [], structuredOutput: true, maxOutputTokens: 2048, responseSchema: schema }, 1000)
    expect(result).toMatchObject({ kind: "text", finishReason: "MAX_TOKENS" })
    expect(JSON.parse(String(fake.calls[0]!.init!.body)).generationConfig).toEqual({ responseMimeType: "application/json", responseSchema: schema, maxOutputTokens: 2048 })
    await adapter.execute(google, "gemini-x", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [], structuredOutput: false, maxOutputTokens: null, responseSchema: schema }, 1000)
    expect(JSON.parse(String(fake.calls[1]!.init!.body))).not.toHaveProperty("generationConfig")
  })
})

describe("proteção de endpoint", () => {
  it("aceita localhost/LAN (modelo local é alcançado pelo SERVIDOR); recusa credencial na URL e metadados de nuvem", () => {
    expect(endpointProblem("http://localhost:1234/v1")).toBeNull()
    expect(endpointProblem("http://192.168.0.10:11434/v1")).toBeNull()
    expect(endpointProblem("http://user:pass@host/v1")).not.toBeNull()
    expect(endpointProblem("http://169.254.169.254/latest")).not.toBeNull()
    expect(endpointProblem("ftp://host")).not.toBeNull()
  })
})

describe("execução em fluxo com ferramentas (chat pela policy)", () => {
  const sseBody = (lines: string[]) => new Response([...lines, ""].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } })
  const tool = { name: "agent_x", description: "d", parameters: { type: "object", properties: { query: { type: "string" } } } }

  it("OpenAI: texto em deltas vai para onText; chamadas de ferramenta fatiadas são remontadas pelo índice", async () => {
    const text = sseBody(['data: {"choices":[{"delta":{"content":"Olá"}}]}', 'data: {"choices":[{"delta":{"content":" mundo"},"finish_reason":"stop"}]}', 'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}', "data: [DONE]"])
    const fake = fakeFetch(() => text)
    const chunks: string[] = []
    const result = await createOpenAiChatAdapter(fake.fetch).streamExecute!(connection(), "m", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [tool], structuredOutput: false, maxOutputTokens: null }, 1000, (chunk) => chunks.push(chunk))
    expect(chunks).toEqual(["Olá", " mundo"])
    expect(result).toMatchObject({ kind: "text", text: "Olá mundo", streamedChars: 9, finishReason: "STOP", usage: { promptTokens: 5 } })
    const body = JSON.parse(String(fake.calls[0]!.init!.body)) as Record<string, unknown>
    expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true }, tools: [{ type: "function", function: { name: "agent_x" } }] })

    const calls = sseBody([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"agent_","arguments":"{\\"que"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"x","arguments":"ry\\":\\"q\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","function":{"name":"my_results","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
    ])
    const toolChunks: string[] = []
    const toolResult = await createOpenAiChatAdapter(fakeFetch(() => calls).fetch).streamExecute!(connection(), "m", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [tool], structuredOutput: false, maxOutputTokens: null }, 1000, (chunk) => toolChunks.push(chunk))
    expect(toolChunks).toEqual([])
    expect(toolResult).toMatchObject({ kind: "functionCalls", streamedChars: 0, calls: [{ name: "agent_x", args: { query: "q" }, id: "call_1" }, { name: "my_results", args: {}, id: "call_2" }] })
  })

  it("Google: texto e chamadas no mesmo fluxo (thoughtSignature preservado; pensamento nunca vai para a tela)", async () => {
    const google = connection({ providerKey: "GOOGLE_GENAI", adapterType: "GOOGLE_GENAI", baseUrl: "https://generativelanguage.googleapis.com/v1beta" })
    const fake = fakeFetch(() => sseBody([
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "pensando", thought: true }] } }] })}`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Oi" }] } }] })}`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "!" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 } })}`,
    ]))
    const chunks: string[] = []
    const result = await createGoogleGenAiAdapter(fake.fetch).streamExecute!(google, "gemini-x", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [tool], structuredOutput: false, maxOutputTokens: null }, 1000, (chunk) => chunks.push(chunk))
    expect(fake.calls[0]!.url).toContain(":streamGenerateContent?alt=sse")
    expect(chunks).toEqual(["Oi", "!"])
    expect(result).toMatchObject({ kind: "text", text: "Oi!", streamedChars: 3, finishReason: "STOP" })

    const withCall = fakeFetch(() => sseBody([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "agent_x", args: { query: "q" } }, thoughtSignature: "sig" }] } }] })}`]))
    const callResult = await createGoogleGenAiAdapter(withCall.fetch).streamExecute!(google, "gemini-x", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [tool], structuredOutput: false, maxOutputTokens: null }, 1000, () => {})
    expect(callResult).toMatchObject({ kind: "functionCalls", calls: [{ name: "agent_x", args: { query: "q" }, thoughtSignature: "sig" }] })
  })

  it("saída estruturada em fluxo (esclarecimento pelas bases): o pedido é JSON nos dois provedores e o JSON cru chega em pedaços", async () => {
    const google = connection({ providerKey: "GOOGLE_GENAI", adapterType: "GOOGLE_GENAI", baseUrl: "https://generativelanguage.googleapis.com/v1beta" })
    const googleFake = fakeFetch(() => sseBody([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"answer":' }] } }] })}`, `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '"ok"}' }] } }] })}`]))
    const googleChunks: string[] = []
    const googleResult = await createGoogleGenAiAdapter(googleFake.fetch).streamExecute!(google, "gemini-x", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [], structuredOutput: true, maxOutputTokens: null }, 1000, (chunk) => googleChunks.push(chunk))
    expect(JSON.parse(String(googleFake.calls[0]!.init?.body)).generationConfig).toMatchObject({ responseMimeType: "application/json" })
    expect(googleChunks).toEqual(['{"answer":', '"ok"}'])
    expect(googleResult).toMatchObject({ kind: "text", text: '{"answer":"ok"}' })

    const openAiFake = fakeFetch(() => sseBody([`data: ${JSON.stringify({ choices: [{ delta: { content: '{"answer":"ok"}' } }] })}`, "data: [DONE]"]))
    const openAiChunks: string[] = []
    await createOpenAiChatAdapter(openAiFake.fetch).streamExecute!(connection(), "m", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [], structuredOutput: true, maxOutputTokens: null }, 1000, (chunk) => openAiChunks.push(chunk))
    expect(JSON.parse(String(openAiFake.calls[0]!.init?.body)).response_format).toEqual({ type: "json_object" })
    expect(openAiChunks).toEqual(['{"answer":"ok"}'])
  })

  it("Google: menos raciocínio vira thinkingConfig.thinkingLevel; sem o pedido, nenhum ajuste vai", async () => {
    const google = connection({ providerKey: "GOOGLE_GENAI", adapterType: "GOOGLE_GENAI", baseUrl: "https://generativelanguage.googleapis.com/v1beta" })
    const fake = fakeFetch(() => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 }))
    const adapter = createGoogleGenAiAdapter(fake.fetch)
    await adapter.execute(google, "gemini-x", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [], structuredOutput: true, maxOutputTokens: null, reasoningEffort: "LOW" }, 1000)
    await adapter.execute(google, "gemini-x", { systemPrompt: "s", contents: [{ role: "user", text: "t" }], tools: [], structuredOutput: false, maxOutputTokens: null }, 1000)
    const bodies = fake.calls.map((call) => JSON.parse(String(call.init?.body)) as { generationConfig?: Record<string, unknown> })
    expect(bodies[0]!.generationConfig).toEqual({ responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } })
    expect(bodies[1]!.generationConfig).toBeUndefined()
  })
})
