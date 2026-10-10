import { AiProviderError } from "../../../../shared/application/model-routing/ai-errors.js"
import type { LlmUsage } from "../../../../shared/application/llm-telemetry.js"
import type { AdapterTurn } from "../../../../shared/application/model-routing/provider-adapter.js"
import type { AiExecuteRequest, AiExecuteResult, AiProviderAdapter, DiscoveredModel, FetchLike, ResolvedConnection } from "../../application/provider-adapter-port.js"
import { joinUrl, requestJson, testByListing } from "./http.js"

/**
 * Protocolo Anthropic Messages. Sem modo JSON nativo: saída estruturada é pedida por instrução
 * (e validada depois pelos parsers de sempre). Sem streaming nesta V1 — o runtime entrega a
 * resposta como um único chunk quando um Use Case interativo cair aqui.
 */
const DEFAULT_API_VERSION = "2023-06-01"
const DEFAULT_MAX_TOKENS = 8192
const STRUCTURED_SUFFIX = "\n\nResponda SOMENTE com um objeto JSON válido, sem texto antes ou depois."

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } | { type: "tool_result"; tool_use_id: string; content: string }
type Message = { role: "user" | "assistant"; content: Block[] | string }
type MessagesResponse = { model?: string; content?: ({ type: "text"; text?: string } | { type: "tool_use"; id?: string; name?: string; input?: Record<string, unknown> })[]; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null)

/** Entrada total = não cacheada + lida do cache + gravada no cache (é o que a Anthropic cobra como entrada). */
export function normalizeAnthropicUsage(usage: MessagesResponse["usage"]): LlmUsage {
  const input = num(usage?.input_tokens)
  const cacheRead = num(usage?.cache_read_input_tokens)
  const cacheWrite = num(usage?.cache_creation_input_tokens)
  const output = num(usage?.output_tokens)
  const prompt = input === null ? null : input + (cacheRead ?? 0) + (cacheWrite ?? 0)
  return { promptTokens: prompt, outputTokens: output, totalTokens: prompt !== null && output !== null ? prompt + output : null, cachedInputTokens: cacheRead, reasoningTokens: null }
}

export function toAnthropicMessages(contents: AdapterTurn[]): Message[] {
  const messages: Message[] = []
  let pendingIds: string[] = []
  contents.forEach((turn, turnIndex) => {
    if ("functionCalls" in turn) {
      pendingIds = turn.functionCalls.map((call, index) => call.id ?? `toolu_${turnIndex}_${index}`)
      messages.push({ role: "assistant", content: turn.functionCalls.map((call, index) => ({ type: "tool_use", id: pendingIds[index]!, name: call.name, input: call.args ?? {} })) })
      return
    }
    if ("functionResponses" in turn) {
      messages.push({ role: "user", content: turn.functionResponses.map((response, index) => ({ type: "tool_result", tool_use_id: pendingIds[index] ?? `toolu_${turnIndex}_${index}`, content: JSON.stringify(response.response) })) })
      return
    }
    messages.push({ role: turn.role === "model" ? "assistant" : "user", content: turn.text })
  })
  return messages
}

function headers(connection: ResolvedConnection): Record<string, string> {
  return { "content-type": "application/json", "anthropic-version": connection.apiVersion ?? DEFAULT_API_VERSION, ...connection.headers, ...(connection.apiKey ? { "x-api-key": connection.apiKey } : {}) }
}

export function createAnthropicMessagesAdapter(fetchImpl: FetchLike = fetch): AiProviderAdapter {
  const listModels = async (connection: ResolvedConnection): Promise<DiscoveredModel[]> => {
    const body = await requestJson<{ data?: { id?: string; display_name?: string }[] }>(fetchImpl, connection, joinUrl(connection.baseUrl, "models?limit=100"), { method: "GET", headers: headers(connection) }, connection.timeoutMs)
    return (body.data ?? [])
      .filter((item): item is { id: string; display_name?: string } => typeof item.id === "string")
      .map((item) => ({ providerModelId: item.id, displayName: item.display_name ?? item.id, kind: "GENERATIVE", contextWindow: null, maxOutputTokens: null, capabilities: {}, metadata: {} }))
  }
  return {
    adapterType: "ANTHROPIC_MESSAGES",
    testConnection: (connection) => testByListing(async () => (await listModels(connection)).length),
    listModels,
    async execute(connection, providerModelId, request: AiExecuteRequest, timeoutMs): Promise<AiExecuteResult> {
      const startedAt = Date.now()
      const body = await requestJson<MessagesResponse>(fetchImpl, connection, joinUrl(connection.baseUrl, "messages"), {
        method: "POST",
        headers: headers(connection),
        body: JSON.stringify({
          model: providerModelId,
          max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
          system: request.structuredOutput ? `${request.systemPrompt}${STRUCTURED_SUFFIX}` : request.systemPrompt,
          messages: toAnthropicMessages(request.contents),
          ...(request.tools.length > 0 ? { tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
        }),
      }, timeoutMs)
      const blocks = body.content ?? []
      const usage = normalizeAnthropicUsage(body.usage)
      const model = body.model ?? providerModelId
      const durationMs = Date.now() - startedAt
      const toolUses = blocks.filter((block): block is { type: "tool_use"; id?: string; name?: string; input?: Record<string, unknown> } => block.type === "tool_use" && typeof (block as { name?: string }).name === "string")
      if (toolUses.length > 0) return { kind: "functionCalls", calls: toolUses.map((block) => ({ name: block.name!, args: block.input ?? {}, ...(block.id ? { id: block.id } : {}) })), usage, model, durationMs }
      const text = blocks.filter((block): block is { type: "text"; text?: string } => block.type === "text").map((block) => block.text ?? "").join("")
      if (blocks.length === 0) throw new AiProviderError("PROVIDER_ERROR", { message: "O provedor de IA não devolveu nenhuma resposta." })
      return { kind: "text", text, usage, model, durationMs }
    },
  }
}
