import { registerProviderAdapter, type AdapterRequest, type AdapterResponse, type ProviderAdapter } from "../../../shared/application/model-routing/provider-adapter.js"
import { observedCacheRecord } from "../../../shared/application/model-routing/cache-record.js"
import { EMPTY_USAGE, type LlmRouteRecord } from "../../../shared/application/llm-telemetry.js"
import { generateAgentReplyWithUsage } from "../../agents/infrastructure/gemini-agent-client.js"
import { generateWithTools, type ChatTurn, type FunctionDeclaration } from "./gemini-function-calling-client.js"
import { ensureCachedPrefix } from "./gemini-prompt-cache.js"

/**
 * ADAPTER GEMINI — a única implementação de provedor existente hoje. Reaproveita os dois clientes
 * já provados (function calling e generateContent estruturado), agora parametrizados pelo modelo
 * concreto do perfil roteado. O cache explícito (V1.3) acontece AQUI: só quando o gateway marcou o
 * prefixo como cacheável e o perfil suporta — nunca com dado dinâmico. Registrado no import (ver
 * llm-gateway.ts).
 */
function routeRecord(request: AdapterRequest): LlmRouteRecord {
  return { provider: request.route.profile.provider, tier: request.route.tier, reason: request.route.reason, mode: request.route.mode, escalated: request.route.escalated, fallback: request.route.fallback }
}

export const geminiProviderAdapter: ProviderAdapter = {
  provider: "GEMINI",
  async generate(request: AdapterRequest): Promise<AdapterResponse> {
    const model = request.route.profile.model
    const route = routeRecord(request)
    const cached = request.cache?.cacheable && request.route.profile.supportsPromptCache ? await ensureCachedPrefix({ model, systemPrompt: request.systemPrompt, tools: request.tools, cacheKeyVersion: request.cache.cacheKeyVersion }) : null
    const cacheKeyVersion = request.cache?.cacheKeyVersion ?? null
    const describeCache = (usage: AdapterResponse["usage"]): NonNullable<AdapterResponse["cache"]> => {
      const observed = observedCacheRecord(usage, cacheKeyVersion)
      return cached ? { ...observed, mode: "EXPLICIT", createdTokens: cached.created ? cached.tokens : 0 } : { ...observed, createdTokens: 0 }
    }
    // Sem ferramentas e com um único turno de usuário, o generateContent estruturado é o caminho mais barato/estável.
    const single = request.contents.length === 1 && request.contents[0] && "text" in request.contents[0] && request.contents[0].role === "user"
    if (request.tools.length === 0 && single && request.structuredOutput) {
      const reply = await generateAgentReplyWithUsage(request.systemPrompt, (request.contents[0] as { text: string }).text, { structuredOutput: true, model, route, cachedContent: cached?.name, ...(request.transport ? { transport: request.transport } : {}), ...(request.responseSchema ? { responseSchema: request.responseSchema } : {}), ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}) })
      return { kind: "text", text: reply.text, usage: reply.usage, durationMs: reply.durationMs, model: reply.model, provider: "GEMINI", cache: describeCache(reply.usage ?? EMPTY_USAGE), finishReason: reply.finishReason }
    }
    const result = await generateWithTools(request.contents as ChatTurn[], request.systemPrompt, request.tools as FunctionDeclaration[], { model, route, cachedContent: cached?.name })
    return { ...result, provider: "GEMINI", cache: describeCache(result.usage ?? EMPTY_USAGE) }
  },
}

registerProviderAdapter(geminiProviderAdapter)
