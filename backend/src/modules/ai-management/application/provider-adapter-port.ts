import type { LlmUsage } from "../../../shared/application/llm-telemetry.js"
import type { AdapterFunctionDeclaration, AdapterTurn } from "../../../shared/application/model-routing/provider-adapter.js"
import type { AiModelKind, ModelCapabilities } from "../domain/ai-capabilities.js"
import type { AiAdapterType } from "../domain/ai-provider-catalog.js"

/**
 * AI PROVIDER ADAPTER (§4, §107, §108) — a única fronteira que conhece o protocolo de um vendor.
 * O roteador depende desta interface; nenhum SDK/HTTP concreto vaza para domínio ou aplicação.
 * Um adapter por PROTOCOLO (não por nome comercial): OpenAI, xAI, LM Studio e Ollama compartilham
 * o de Chat Completions.
 */
export type ResolvedConnection = {
  id: string
  name: string
  providerKey: string
  adapterType: AiAdapterType
  baseUrl: string
  apiVersion: string | null
  /** Decifrada só no momento da chamada; nunca logada, nunca devolvida. */
  apiKey: string | null
  headers: Record<string, string>
  timeoutMs: number
}

export const CONNECTION_TEST_STATUSES = ["CONNECTED", "AUTH_ERROR", "NETWORK_ERROR", "RATE_LIMITED", "INVALID_ENDPOINT", "UNSUPPORTED", "UNKNOWN_ERROR"] as const
export type ConnectionTestStatus = (typeof CONNECTION_TEST_STATUSES)[number]

export type ConnectionTestResult = { status: ConnectionTestStatus; latencyMs: number | null; message: string; modelCount: number | null }

export type DiscoveredModel = {
  providerModelId: string
  displayName: string
  kind: AiModelKind
  contextWindow: number | null
  maxOutputTokens: number | null
  capabilities: ModelCapabilities
  metadata: Record<string, unknown>
}

export type AiExecuteRequest = {
  systemPrompt: string
  contents: AdapterTurn[]
  tools: AdapterFunctionDeclaration[]
  structuredOutput: boolean
  maxOutputTokens: number | null
  /** Schema da saída estruturada pedido pela etapa (mesmo formato que o caminho legado manda ao Gemini). Só vale com
   * `structuredOutput` e sem tools; protocolo que não o transporta ignora — o parser de quem chamou é a validação de verdade. */
  responseSchema?: Record<string, unknown> | null
}

export type AiExecuteResult = ({ kind: "text"; text: string } | { kind: "functionCalls"; calls: { name: string; args: Record<string, unknown>; id?: string; thoughtSignature?: string }[] }) & {
  usage: LlmUsage
  /** Modelo informado pelo provider (ou o pedido, quando não informa). */
  model: string
  durationMs: number
  /** Motivo de término no vocabulário do caminho legado (STOP, MAX_TOKENS, SAFETY…); ausente/null = não informado. */
  finishReason?: string | null
}

export type AiStreamResult = { usage: LlmUsage; model: string; durationMs: number; text: string }

/** Síntese de voz: o texto EXATO lido com a voz do provider (+ instrução de tom, quando o modelo aceita). */
export type AiSpeechRequest = { text: string; voice: string; instructions: string | null }
/** PCM16 mono little-endian, sem cabeçalho (o mesmo formato que o avatar já toca). Uso não informado = null em cada campo. */
export type AiSpeechResult = { pcm16: Buffer; sampleRate: number; usage: LlmUsage; model: string; durationMs: number }

export interface AiProviderAdapter {
  readonly adapterType: AiAdapterType
  testConnection(connection: ResolvedConnection): Promise<ConnectionTestResult>
  listModels(connection: ResolvedConnection): Promise<DiscoveredModel[]>
  /** Lança AiProviderError (categoria normalizada, mensagem segura) em qualquer falha. */
  execute(connection: ResolvedConnection, providerModelId: string, request: AiExecuteRequest, timeoutMs: number): Promise<AiExecuteResult>
  /** Opcional: sem ele o runtime executa sem streaming e entrega a resposta num único chunk. */
  stream?(connection: ResolvedConnection, providerModelId: string, request: Omit<AiExecuteRequest, "tools" | "structuredOutput">, timeoutMs: number, onChunk: (text: string) => void): Promise<AiStreamResult>
  /** Opcional: só os protocolos de `SPEECH_SYNTHESIS_ADAPTERS` (ai-speech.ts) leem texto em voz. Lança AiProviderError; nunca repete. */
  synthesizeSpeech?(connection: ResolvedConnection, providerModelId: string, request: AiSpeechRequest, timeoutMs: number): Promise<AiSpeechResult>
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
