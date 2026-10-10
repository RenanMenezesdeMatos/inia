import type { AiAdapterType } from "../../domain/ai-provider-catalog.js"
import type { AiProviderAdapter, FetchLike } from "../../application/provider-adapter-port.js"
import { createAnthropicMessagesAdapter } from "./anthropic-messages-adapter.js"
import { createGoogleGenAiAdapter } from "./google-genai-adapter.js"
import { createOpenAiChatAdapter } from "./openai-chat-adapter.js"
import { guardedFetch } from "./http.js"

/**
 * Registro de adapters POR PROTOCOLO (Open/Closed — §108): provider novo com protocolo conhecido
 * = só uma entrada no catálogo; protocolo novo = um adapter novo registrado aqui.
 */
export type AdapterRegistry = (adapterType: AiAdapterType) => AiProviderAdapter

export function createAdapterRegistry(fetchImpl: FetchLike = guardedFetch): AdapterRegistry {
  const adapters: Record<AiAdapterType, AiProviderAdapter> = {
    GOOGLE_GENAI: createGoogleGenAiAdapter(fetchImpl),
    OPENAI_CHAT_COMPLETIONS: createOpenAiChatAdapter(fetchImpl),
    ANTHROPIC_MESSAGES: createAnthropicMessagesAdapter(fetchImpl),
  }
  return (adapterType) => adapters[adapterType]
}
