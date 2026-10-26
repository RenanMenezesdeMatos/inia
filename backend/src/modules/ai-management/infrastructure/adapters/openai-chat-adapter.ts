import { AiProviderError } from "../../../../shared/application/model-routing/ai-errors.js"
import type { LlmUsage } from "../../../../shared/application/llm-telemetry.js"
import type { AdapterTurn } from "../../../../shared/application/model-routing/provider-adapter.js"
import type { AiExecuteRequest, AiExecuteResult, AiProviderAdapter, AiSpeechRequest, AiSpeechResult, AiStreamExecuteResult, AiStreamResult, DiscoveredModel, FetchLike, ResolvedConnection } from "../../application/provider-adapter-port.js"
import { joinUrl, rawRequest, rawStreamRequest, readSse, requestJson, safeJsonParse, testByListing } from "./http.js"

/**
 * Protocolo OpenAI Chat Completions — OpenAI, xAI, LM Studio, Ollama (/v1) e qualquer servidor
 * compatível. Diferenças entre eles são DADOS (endpoint, credencial), não código.
 */
type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; tool_call_id?: string }

type ChatUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } }
type ChatResponse = { model?: string; choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]; usage?: ChatUsage }

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null)

/** Uso informado → LlmUsage; campo ausente = null (nunca 0 inventado — §77). */
export function normalizeOpenAiUsage(usage: ChatUsage | undefined): LlmUsage {
  return {
    promptTokens: num(usage?.prompt_tokens),
    outputTokens: num(usage?.completion_tokens),
    totalTokens: num(usage?.total_tokens),
    cachedInputTokens: num(usage?.prompt_tokens_details?.cached_tokens),
    reasoningTokens: num(usage?.completion_tokens_details?.reasoning_tokens),
  }
}

/** Turnos do contrato comum → mensagens Chat Completions. Chamada de função sem id recebe id posicional estável (resposta casa pela ordem). */
export function toChatMessages(systemPrompt: string, contents: AdapterTurn[]): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }]
  let pendingIds: string[] = []
  contents.forEach((turn, turnIndex) => {
    if ("functionCalls" in turn) {
      pendingIds = turn.functionCalls.map((call, index) => call.id ?? `call_${turnIndex}_${index}`)
      messages.push({ role: "assistant", content: null, tool_calls: turn.functionCalls.map((call, index) => ({ id: pendingIds[index]!, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) } })) })
      return
    }
    if ("functionResponses" in turn) {
      turn.functionResponses.forEach((response, index) => messages.push({ role: "tool", tool_call_id: pendingIds[index] ?? `call_${turnIndex}_${index}`, content: JSON.stringify(response.response) }))
      return
    }
    messages.push({ role: turn.role === "model" ? "assistant" : "user", content: turn.text })
  })
  return messages
}

/** `finish_reason` do Chat Completions → vocabulário do caminho legado (o redator e o motor leem MAX_TOKENS para dizer "resposta truncada"). */
const FINISH_REASONS: Record<string, string> = { stop: "STOP", length: "MAX_TOKENS", content_filter: "SAFETY", tool_calls: "STOP", function_call: "STOP" }
export function normalizeOpenAiFinishReason(reason: unknown): string | null {
  return typeof reason === "string" && reason ? (FINISH_REASONS[reason] ?? reason.toUpperCase()) : null
}

/**
 * Schema da etapa (o mesmo que o caminho legado manda ao Gemini: subconjunto OpenAPI, às vezes com tipos em maiúsculas,
 * `nullable` e `propertyOrdering`) → JSON Schema: tipo em minúsculas, `nullable: true` vira união com "null" e
 * `propertyOrdering` (só do Gemini) sai. O resto já é JSON Schema e passa como veio.
 */
export function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema)
  if (!schema || typeof schema !== "object") return schema
  const { nullable, propertyOrdering: _ordering, ...rest } = schema as Record<string, unknown>
  void _ordering
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rest)) {
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) out[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, toJsonSchema(child)]))
    else if (key === "items" || key === "anyOf" || key === "oneOf" || key === "allOf") out[key] = toJsonSchema(value)
    else if (key === "type" && typeof value === "string") out[key] = value.toLowerCase()
    else out[key] = value
  }
  if (nullable === true && typeof out.type === "string") {
    out.type = [out.type, "null"]
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null]
  }
  return out
}

/**
 * Saída estruturada: com o schema da etapa, Structured Outputs em modo NÃO estrito (`strict: false` — o modo estrito exige todo
 * campo obrigatório e `additionalProperties: false`, e os contratos da INIA têm campos opcionais); sem schema, o modo JSON (a API
 * exige a palavra "JSON" nas mensagens — os prompts estruturados da INIA a têm). Com tools, nenhum dos dois.
 */
function responseFormat(request: AiExecuteRequest): Record<string, unknown> {
  if (!request.structuredOutput || request.tools.length > 0) return {}
  if (request.responseSchema) return { response_format: { type: "json_schema", json_schema: { name: "inia_response", strict: false, schema: toJsonSchema(request.responseSchema) } } }
  return { response_format: { type: "json_object" } }
}

/**
 * Teto de saída: a API OFICIAL da OpenAI recusa `max_tokens` nos modelos de raciocínio (o-series, gpt-5…) e aceita
 * `max_completion_tokens` em todos; servidores compatíveis (Ollama, LM Studio, vLLM, xAI, gateways) seguem com o `max_tokens`
 * clássico, que é o que eles conhecem.
 */
function maxTokensField(connection: ResolvedConnection, maxOutputTokens: number | null): Record<string, number> {
  if (!maxOutputTokens) return {}
  return connection.providerKey === "OPENAI" ? { max_completion_tokens: maxOutputTokens } : { max_tokens: maxOutputTokens }
}

/** `response_format: "pcm"` da OpenAI = amostras cruas 24 kHz, 16 bits com sinal, little-endian, mono — o formato do avatar. */
export const OPENAI_SPEECH_SAMPLE_RATE = 24_000

/** Corpo de `/audio/speech`: o texto vai como veio (a INIA nunca o reescreve); instrução de tom só quando cadastrada. */
export function speechRequestBody(providerModelId: string, request: AiSpeechRequest): Record<string, unknown> {
  return { model: providerModelId, input: request.text, voice: request.voice, response_format: "pcm", ...(request.instructions ? { instructions: request.instructions } : {}) }
}

function authHeaders(connection: ResolvedConnection): Record<string, string> {
  return { "content-type": "application/json", ...connection.headers, ...(connection.apiKey ? { authorization: `Bearer ${connection.apiKey}` } : {}) }
}

export function createOpenAiChatAdapter(fetchImpl: FetchLike = fetch): AiProviderAdapter {
  const listModels = async (connection: ResolvedConnection): Promise<DiscoveredModel[]> => {
    const body = await requestJson<{ data?: { id?: string; owned_by?: string }[] }>(fetchImpl, connection, joinUrl(connection.baseUrl, "models"), { method: "GET", headers: authHeaders(connection) }, connection.timeoutMs)
    return (body.data ?? [])
      .filter((item): item is { id: string; owned_by?: string } => typeof item.id === "string" && item.id.length > 0)
      .map((item) => ({ providerModelId: item.id, displayName: item.id, kind: /embed/i.test(item.id) ? "EMBEDDING" : "GENERATIVE", contextWindow: null, maxOutputTokens: null, capabilities: {}, metadata: item.owned_by ? { ownedBy: item.owned_by } : {} }))
  }

  return {
    adapterType: "OPENAI_CHAT_COMPLETIONS",
    testConnection: (connection) => testByListing(async () => (await listModels(connection)).length),
    listModels,
    async execute(connection, providerModelId, request: AiExecuteRequest, timeoutMs): Promise<AiExecuteResult> {
      const startedAt = Date.now()
      const body = await requestJson<ChatResponse>(fetchImpl, connection, joinUrl(connection.baseUrl, "chat/completions"), {
        method: "POST",
        headers: authHeaders(connection),
        body: JSON.stringify({
          model: providerModelId,
          messages: toChatMessages(request.systemPrompt, request.contents),
          ...(request.tools.length > 0 ? { tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}),
          ...responseFormat(request),
          ...maxTokensField(connection, request.maxOutputTokens),
        }),
      }, timeoutMs)
      const choice = body.choices?.[0]
      const message = choice?.message
      if (!message) throw new AiProviderError("PROVIDER_ERROR", { message: "O provedor de IA não devolveu nenhuma resposta." })
      const usage = normalizeOpenAiUsage(body.usage)
      const model = body.model ?? providerModelId
      const durationMs = Date.now() - startedAt
      const finishReason = normalizeOpenAiFinishReason(choice?.finish_reason)
      const toolCalls = (message.tool_calls ?? []).filter((call) => call.function?.name)
      if (toolCalls.length > 0) return { kind: "functionCalls", calls: toolCalls.map((call) => ({ name: call.function!.name!, args: safeJsonParse(call.function!.arguments ?? "{}"), ...(call.id ? { id: call.id } : {}) })), usage, model, durationMs, finishReason }
      return { kind: "text", text: message.content ?? "", usage, model, durationMs, finishReason }
    },
    async synthesizeSpeech(connection, providerModelId, request, timeoutMs): Promise<AiSpeechResult> {
      const startedAt = Date.now()
      const response = await rawRequest(fetchImpl, connection, joinUrl(connection.baseUrl, "audio/speech"), { method: "POST", headers: authHeaders(connection), body: JSON.stringify(speechRequestBody(providerModelId, request)) }, timeoutMs)
      let audio: Buffer
      try {
        audio = Buffer.from(await response.arrayBuffer())
      } catch (error) {
        throw new AiProviderError(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "TIMEOUT" : "NETWORK")
      }
      // Áudio vazio (ou uma amostra só) não é voz: o recado nunca toca silêncio como se fosse a fala.
      const pcm16 = audio.subarray(0, audio.length - (audio.length % 2))
      if (pcm16.length < 2) throw new AiProviderError("PROVIDER_ERROR", { message: "O provedor de IA não devolveu áudio." })
      // A resposta é binária: o provider não informa tokens nela — uso desconhecido (custo UNKNOWN), nunca inventado.
      return { pcm16, sampleRate: OPENAI_SPEECH_SAMPLE_RATE, usage: normalizeOpenAiUsage(undefined), model: providerModelId, durationMs: Date.now() - startedAt }
    },
    async streamExecute(connection, providerModelId, request: AiExecuteRequest, timeoutMs, onText): Promise<AiStreamExecuteResult> {
      const startedAt = Date.now()
      const { response, deadline } = await rawStreamRequest(fetchImpl, connection, joinUrl(connection.baseUrl, "chat/completions"), {
        method: "POST",
        headers: authHeaders(connection),
        body: JSON.stringify({
          model: providerModelId,
          messages: toChatMessages(request.systemPrompt, request.contents),
          ...(request.tools.length > 0 ? { tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}),
          ...responseFormat(request),
          ...maxTokensField(connection, request.maxOutputTokens),
          stream: true,
          stream_options: { include_usage: true },
        }),
      }, timeoutMs)
      // Chamadas de ferramenta chegam em pedaços (nome e argumentos fatiados), identificadas pelo índice.
      const toolCalls = new Map<number, { id?: string; name: string; arguments: string }>()
      let text = ""
      let streamedChars = 0
      let firstTokenMs: number | null = null
      let usage: LlmUsage = normalizeOpenAiUsage(undefined)
      let model = providerModelId
      let finishReason: string | null = null
      await readSse(response, (payload) => {
        const choice = (payload.choices as { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[] | undefined)?.[0]
        for (const delta of choice?.delta?.tool_calls ?? []) {
          const index = delta.index ?? 0
          const current = toolCalls.get(index) ?? { name: "", arguments: "" }
          const id = delta.id ?? current.id
          toolCalls.set(index, { ...(id ? { id } : {}), name: current.name + (delta.function?.name ?? ""), arguments: current.arguments + (delta.function?.arguments ?? "") })
        }
        const content = choice?.delta?.content
        if (content) {
          text += content
          firstTokenMs ??= Date.now() - startedAt
          if (toolCalls.size === 0) {
            streamedChars += content.length
            onText(content)
          }
        }
        if (choice?.finish_reason) finishReason = normalizeOpenAiFinishReason(choice.finish_reason)
        if (payload.usage) usage = normalizeOpenAiUsage(payload.usage as ChatUsage)
        if (typeof payload.model === "string") model = payload.model
      }, deadline)
      const durationMs = Date.now() - startedAt
      const calls = [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call).filter((call) => call.name)
      if (calls.length > 0) return { kind: "functionCalls", calls: calls.map((call) => ({ name: call.name, args: safeJsonParse(call.arguments || "{}"), ...(call.id ? { id: call.id } : {}) })), usage, model, durationMs, finishReason, streamedChars, firstTokenMs }
      return { kind: "text", text, usage, model, durationMs, finishReason, streamedChars, firstTokenMs }
    },
    async stream(connection, providerModelId, request, timeoutMs, onChunk): Promise<AiStreamResult> {
      const startedAt = Date.now()
      const { response, deadline } = await rawStreamRequest(fetchImpl, connection, joinUrl(connection.baseUrl, "chat/completions"), {
        method: "POST",
        headers: authHeaders(connection),
        body: JSON.stringify({ model: providerModelId, messages: toChatMessages(request.systemPrompt, request.contents), stream: true, stream_options: { include_usage: true }, ...maxTokensField(connection, request.maxOutputTokens) }),
      }, timeoutMs)
      let text = ""
      let usage: LlmUsage = normalizeOpenAiUsage(undefined)
      let model = providerModelId
      await readSse(response, (payload) => {
        const delta = (payload.choices as { delta?: { content?: string } }[] | undefined)?.[0]?.delta?.content
        if (delta) {
          text += delta
          onChunk(delta)
        }
        if (payload.usage) usage = normalizeOpenAiUsage(payload.usage as ChatUsage)
        if (typeof payload.model === "string") model = payload.model
      }, deadline)
      return { usage, model, durationMs: Date.now() - startedAt, text }
    },
  }
}
