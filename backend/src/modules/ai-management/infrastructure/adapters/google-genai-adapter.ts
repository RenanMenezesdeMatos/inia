import { AiProviderError } from "../../../../shared/application/model-routing/ai-errors.js"
import { usageFromGeminiPayload, type LlmUsage } from "../../../../shared/application/llm-telemetry.js"
import type { AdapterTurn } from "../../../../shared/application/model-routing/provider-adapter.js"
import type { ModelCapabilities } from "../../domain/ai-capabilities.js"
import type { AiExecuteRequest, AiExecuteResult, AiProviderAdapter, AiStreamResult, DiscoveredModel, FetchLike, ResolvedConnection } from "../../application/provider-adapter-port.js"
import { joinUrl, rawRequest, readSse, requestJson, testByListing } from "./http.js"

/**
 * Protocolo Google Gemini (generateContent) com a credencial DA CONEXÃO. O caminho legado
 * (perfis por ambiente + GEMINI_API_KEY) continua nos clientes antigos, intocado — este adapter só
 * roda quando a organização tem uma policy ativa apontando para uma conexão Gemini.
 */
type GeminiPart = { text?: string; functionCall?: { name: string; args?: Record<string, unknown>; id?: string }; thoughtSignature?: string }
type GeminiResponse = { modelVersion?: string; candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[] }
type GeminiModel = { name?: string; displayName?: string; inputTokenLimit?: number; outputTokenLimit?: number; supportedGenerationMethods?: string[]; thinking?: boolean }

/** Mesmo formato de turnos do cliente legado (gemini-function-calling-client.ts). */
export function toGeminiContents(contents: AdapterTurn[]): { role: string; parts: unknown[] }[] {
  return contents.map((turn) => {
    if ("functionCalls" in turn) return { role: "model", parts: turn.functionCalls.map(({ thoughtSignature, ...functionCall }) => ({ functionCall, ...(thoughtSignature ? { thoughtSignature } : {}) })) }
    if ("functionResponses" in turn) return { role: "user", parts: turn.functionResponses.map((functionResponse) => ({ functionResponse })) }
    return { role: turn.role, parts: [{ text: turn.text }] }
  })
}

function headers(connection: ResolvedConnection): Record<string, string> {
  return { "content-type": "application/json", ...connection.headers, ...(connection.apiKey ? { "x-goog-api-key": connection.apiKey } : {}) }
}

function capabilitiesOf(model: GeminiModel): ModelCapabilities {
  const methods = model.supportedGenerationMethods ?? []
  const capabilities: ModelCapabilities = {}
  if (methods.includes("generateContent")) {
    // A API não declara suporte a ferramentas/JSON por modelo: para modelos generateContent é inferido (o admin pode corrigir).
    capabilities.STRUCTURED_OUTPUT = { supported: true, source: "INFERRED" }
    capabilities.TOOLS = { supported: true, source: "INFERRED" }
  }
  if (methods.includes("streamGenerateContent")) capabilities.STREAMING = { supported: true, source: "DISCOVERED" }
  if (typeof model.thinking === "boolean") capabilities.REASONING = { supported: model.thinking, source: "DISCOVERED" }
  if (methods.includes("createCachedContent")) capabilities.PROMPT_CACHE = { supported: true, source: "DISCOVERED" }
  if (methods.includes("bidiGenerateContent")) capabilities.AUDIO = { supported: true, source: "DISCOVERED" }
  return capabilities
}

export function createGoogleGenAiAdapter(fetchImpl: FetchLike = fetch): AiProviderAdapter {
  const listModels = async (connection: ResolvedConnection): Promise<DiscoveredModel[]> => {
    const models: GeminiModel[] = []
    let pageToken: string | undefined
    for (let page = 0; page < 5; page++) {
      const body = await requestJson<{ models?: GeminiModel[]; nextPageToken?: string }>(fetchImpl, connection, joinUrl(connection.baseUrl, `models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`), { method: "GET", headers: headers(connection) }, connection.timeoutMs)
      models.push(...(body.models ?? []))
      if (!body.nextPageToken) break
      pageToken = body.nextPageToken
    }
    return models
      .filter((model): model is GeminiModel & { name: string } => typeof model.name === "string")
      .map((model) => {
        const methods = model.supportedGenerationMethods ?? []
        const id = model.name.replace(/^models\//, "")
        return { providerModelId: id, displayName: model.displayName ?? id, kind: methods.includes("generateContent") ? "GENERATIVE" : methods.includes("embedContent") ? "EMBEDDING" : "GENERATIVE", contextWindow: model.inputTokenLimit ?? null, maxOutputTokens: model.outputTokenLimit ?? null, capabilities: capabilitiesOf(model), metadata: { methods } }
      })
  }

  // Schema da etapa no mesmo lugar em que o cliente legado o manda (`generationConfig.responseSchema`, só com o modo JSON).
  const body = (request: Pick<AiExecuteRequest, "systemPrompt" | "contents" | "maxOutputTokens" | "responseSchema"> & { tools?: AiExecuteRequest["tools"]; structuredOutput?: boolean }) => {
    const json = Boolean(request.structuredOutput) && !(request.tools && request.tools.length > 0)
    return JSON.stringify({
      contents: toGeminiContents(request.contents),
      systemInstruction: { parts: [{ text: request.systemPrompt }] },
      ...(request.tools && request.tools.length > 0 ? { tools: [{ functionDeclarations: request.tools }] } : {}),
      ...(request.structuredOutput || request.maxOutputTokens ? { generationConfig: { ...(json ? { responseMimeType: "application/json" } : {}), ...(json && request.responseSchema ? { responseSchema: request.responseSchema } : {}), ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}) } } : {}),
    })
  }

  return {
    adapterType: "GOOGLE_GENAI",
    testConnection: (connection) => testByListing(async () => (await listModels(connection)).length),
    listModels,
    async execute(connection, providerModelId, request, timeoutMs): Promise<AiExecuteResult> {
      const startedAt = Date.now()
      const payload = await requestJson<GeminiResponse>(fetchImpl, connection, joinUrl(connection.baseUrl, `models/${encodeURIComponent(providerModelId)}:generateContent`), { method: "POST", headers: headers(connection), body: body(request) }, timeoutMs)
      const parts = payload.candidates?.[0]?.content?.parts ?? []
      const usage = usageFromGeminiPayload(payload)
      const model = payload.modelVersion ?? providerModelId
      const durationMs = Date.now() - startedAt
      const finishReason = payload.candidates?.[0]?.finishReason ?? null
      const calls = parts.filter((part) => part.functionCall).map((part) => ({ name: part.functionCall!.name, args: part.functionCall!.args ?? {}, ...(part.functionCall!.id ? { id: part.functionCall!.id } : {}), ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) }))
      if (calls.length > 0) return { kind: "functionCalls", calls, usage, model, durationMs, finishReason }
      if (parts.length === 0) throw new AiProviderError("PROVIDER_ERROR", { message: "O provedor de IA não devolveu nenhuma resposta." })
      return { kind: "text", text: parts.map((part) => part.text ?? "").join(""), usage, model, durationMs, finishReason }
    },
    async stream(connection, providerModelId, request, timeoutMs, onChunk): Promise<AiStreamResult> {
      const startedAt = Date.now()
      const response = await rawRequest(fetchImpl, connection, joinUrl(connection.baseUrl, `models/${encodeURIComponent(providerModelId)}:streamGenerateContent?alt=sse`), { method: "POST", headers: headers(connection), body: body(request) }, timeoutMs)
      let text = ""
      let usage: LlmUsage = usageFromGeminiPayload(null)
      let model = providerModelId
      await readSse(response, (payload) => {
        const chunk = (payload as GeminiResponse).candidates?.[0]?.content?.parts?.[0]?.text
        if (chunk) {
          text += chunk
          onChunk(chunk)
        }
        if ("usageMetadata" in payload) usage = usageFromGeminiPayload(payload)
        if (typeof payload.modelVersion === "string") model = payload.modelVersion
      })
      return { usage, model, durationMs: Date.now() - startedAt, text }
    },
  }
}
