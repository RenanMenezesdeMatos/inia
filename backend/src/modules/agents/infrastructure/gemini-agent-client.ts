import { env } from "../../../config/env.js"
import { beforeLlmCall, countTechnicalIdsInPrompt, recordLlmCall, usageFromGeminiPayload, type LlmRouteRecord, type LlmUsage } from "../../../shared/application/llm-telemetry.js"
import { DomainError } from "../../../shared/domain/domain-error.js"

const MODEL = "gemini-3.1-flash-lite"
const generateUrl = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
const REQUEST_TIMEOUT_MS = 30_000
// Gemini's demand spikes are usually short-lived (same 503 behavior already
// observed for the chat client in gemini-text-client.ts) — one retry after
// a short delay meaningfully improves success odds for background agent
// runs, where there's no user watching a spinner to retry manually.
const RETRY_DELAY_MS = 600

type GenerateContentResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
}

export const AGENT_LLM_MODEL = MODEL

export type AgentReplyOptions = {
  structuredOutput?: boolean
  /** Modelo concreto escolhido pelo roteador (V1.2) — padrão: o modelo histórico deste cliente. */
  model?: string
  route?: LlmRouteRecord
  /** Cache explícito que já contém o prompt de sistema (V1.3) — a request vai sem `systemInstruction`. */
  cachedContent?: string | undefined
  /** V1.5.1: timeout/retries explícitos (ausente = 30 s e 1 retry em 503, o comportamento histórico). */
  transport?: { timeoutMs?: number; retries?: number } | undefined
  /** V1.7.1d: schema da saída JSON (`generationConfig.responseSchema`) — só com `structuredOutput`. */
  responseSchema?: Record<string, unknown> | undefined
  /** Teto de tokens de saída (`generationConfig.maxOutputTokens`) — ausente = padrão do modelo. */
  maxOutputTokens?: number | undefined
}

/** Chamada ao modelo devolvendo o texto e o uso informado pelo provider (Token Budget do runtime de investigação). */
export async function generateAgentReplyWithUsage(
  systemPrompt: string,
  inputContext: string,
  options?: AgentReplyOptions,
): Promise<{ text: string; usage: LlmUsage; durationMs: number; model: string; finishReason: string | null }> {
  const model = options?.model ?? MODEL
  if (!env.GEMINI_API_KEY) {
    throw new DomainError("Execução de agentes não está configurada neste ambiente (falta GEMINI_API_KEY).", "AGENT_EXECUTION_NOT_CONFIGURED", 503)
  }

  // Telemetria (ver shared/application/llm-telemetry.ts): no-op fora de um store; no QA Lab,
  // `beforeLlmCall` aplica "Parar antes da IA"/orçamento ANTES de consumir qualquer token.
  beforeLlmCall()
  const startedAt = new Date()
  const response = await fetchWithRetry(model, systemPrompt, inputContext, Boolean(options?.structuredOutput), options?.cachedContent, options?.transport, options?.responseSchema, options?.maxOutputTokens)

  const payload = (await response.json()) as GenerateContentResponse
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? ""
  const usage = usageFromGeminiPayload(payload)
  const durationMs = Date.now() - startedAt.getTime()
  recordLlmCall({
    model,
    ...usage,
    durationMs,
    startedAt,
    systemPrompt,
    input: inputContext,
    outputText: text || null,
    promptBreakdown: { systemPromptChars: systemPrompt.length, toolSchemaChars: 0, inputChars: inputContext.length, declaredTools: 0, technicalIds: countTechnicalIdsInPrompt(systemPrompt, inputContext) },
    ...(options?.route ? { route: options.route } : {}),
  })
  if (!text.trim()) {
    throw new DomainError("O agente não retornou nenhum texto.", "AGENT_EXECUTION_EMPTY", 502)
  }
  return { text, usage, durationMs, model, finishReason: payload.candidates?.[0]?.finishReason ?? null }
}

async function fetchWithRetry(model: string, systemPrompt: string, inputContext: string, structuredOutput: boolean, cachedContent?: string, transport?: AgentReplyOptions["transport"], responseSchema?: Record<string, unknown>, maxOutputTokens?: number): Promise<Response> {
  const attempts = 1 + Math.max(0, transport?.retries ?? 1)
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response: Response
    try {
      response = await fetch(generateUrl(model), {
        method: "POST",
        headers: { "x-goog-api-key": env.GEMINI_API_KEY!, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: inputContext }] }],
          ...(cachedContent ? { cachedContent } : { systemInstruction: { parts: [{ text: systemPrompt }] } }),
          ...(structuredOutput || maxOutputTokens ? { generationConfig: { ...(structuredOutput ? { responseMimeType: "application/json" } : {}), ...(structuredOutput && responseSchema ? { responseSchema } : {}), ...(maxOutputTokens ? { maxOutputTokens } : {}) } } : {}),
        }),
        signal: AbortSignal.timeout(transport?.timeoutMs ?? REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError"
      throw new DomainError(
        timedOut ? "O agente demorou demais para responder." : "Não foi possível contatar o modelo de IA.",
        timedOut ? "AGENT_EXECUTION_TIMEOUT" : "AGENT_EXECUTION_NETWORK_ERROR",
        504,
      )
    }

    if (response.ok) return response
    if (response.status !== 503 || attempt === attempts) {
      const body = await response.text()
      throw new DomainError("O modelo de IA não retornou uma resposta válida.", "AGENT_EXECUTION_FAILED", 502, { status: response.status, body })
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
  }
  throw new DomainError("Não foi possível contatar o modelo de IA.", "AGENT_EXECUTION_NETWORK_ERROR", 504)
}
