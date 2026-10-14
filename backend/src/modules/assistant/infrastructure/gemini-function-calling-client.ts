import { env } from "../../../config/env.js"
import { beforeLlmCall, countTechnicalIdsInPrompt, recordLlmCall, usageFromGeminiPayload, type LlmRouteRecord, type LlmUsage } from "../../../shared/application/llm-telemetry.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { AiCallCancelledError } from "../../../shared/application/model-routing/ai-errors.js"
import { currentAiAbortSignal, withAiCancellation } from "../../../shared/application/model-routing/ai-runtime.js"

// Modelo diferente do chat de texto simples (backend/src/modules/realtime/infrastructure/gemini-text-client.ts,
// que fica no 3.1-flash-lite de propósito, sem etapa de "thinking") — o Orquestrador precisa de
// raciocínio mais profundo pra function calling/Structured Output em fluxos empresariais
// complexos. Sem streaming aqui de propósito: precisamos inspecionar a resposta inteira pra
// saber se veio um functionCall antes de decidir o que mostrar pro operador.
const MODEL = "gemini-3.8-flash"
const generateUrl = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
const REQUEST_TIMEOUT_MS = 45_000
// Mesma instabilidade de "high demand" já documentada em gemini-text-client.ts (2026-09-09) —
// confirmado de novo ao vivo aqui em 2026-09-11 (503 "This model is currently experiencing
// high demand" em generateContent, não só no streamGenerateContent de texto). Um retry curto
// resolve a maioria dos casos sem o operador perceber.
const RETRY_DELAY_MS = 600

/** Subconjunto do JSON Schema aceito pelo Gemini — plano (especialistas do Orquestrador) ou
 * aninhado (Tools de investigação, ver investigation/domain/tool-catalog.ts). */
export type FunctionParameterSchema = {
  type: string
  description?: string
  enum?: string[]
  items?: FunctionParameterSchema
  properties?: Record<string, FunctionParameterSchema>
  required?: string[]
}

export type FunctionDeclaration = {
  name: string
  description: string
  parameters: {
    type: "object"
    properties: Record<string, FunctionParameterSchema>
    required?: string[]
  }
}

// `id` (pra correlacionar cada chamada com sua resposta quando vêm várias em paralelo) e
// `thoughtSignature` (opaco — o Gemini exige de volta, inalterado, no turno seguinte; sem ele a
// segunda chamada falha com 400 "Function call is missing a thought_signature", confirmado ao
// vivo em 2026-09-11) só existem porque o Gemini os devolveu — nunca são inventados aqui,
// só carregados de ida e volta.
export type FunctionCall = { name: string; args: Record<string, unknown>; id?: string; thoughtSignature?: string }

export type ChatTurn =
  | { role: "user" | "model"; text: string }
  // Um único content com N parts — é assim que o Gemini representa function
  // calling em paralelo (várias tools acionadas na mesma resposta do
  // modelo), não como N turns separados.
  | { role: "model"; functionCalls: FunctionCall[] }
  | { role: "user"; functionResponses: { name: string; response: Record<string, unknown> }[] }

/** `usage`/`durationMs` = o que o provider informou nesta request (null quando não informado) —
 * quem orquestra várias requests (investigation-runtime.ts) soma por fase sem depender do store
 * de telemetria do QA Lab. */
export type GenerateWithToolsResult = ({ kind: "text"; text: string } | { kind: "functionCalls"; calls: FunctionCall[] }) & { usage: LlmUsage; durationMs: number; model: string }

type GenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown>; id?: string }; thoughtSignature?: string }> }
  }>
}

function describeLastTurn(contents: ChatTurn[]): string {
  const last = contents[contents.length - 1]
  if (!last) return ""
  if ("functionResponses" in last) return `[respostas dos especialistas] ${last.functionResponses.map((item) => item.name).join(", ")}`
  if ("functionCalls" in last) return `[function calls] ${last.functionCalls.map((item) => item.name).join(", ")}`
  return last.text
}

function turnToContent(turn: ChatTurn): { role: string; parts: unknown[] } {
  if ("functionCalls" in turn) {
    return {
      role: "model",
      parts: turn.functionCalls.map(({ thoughtSignature, ...functionCall }) => ({
        functionCall,
        ...(thoughtSignature ? { thoughtSignature } : {}),
      })),
    }
  }
  if ("functionResponses" in turn) return { role: "user", parts: turn.functionResponses.map((functionResponse) => ({ functionResponse })) }
  return { role: turn.role, parts: [{ text: turn.text }] }
}

/**
 * Gera uma resposta com function calling nativo do Gemini — usada tanto pra decidir se o
 * orquestrador quer chamar algum especialista quanto (numa segunda chamada, com o resultado
 * da tool anexado a `contents`) pra obter a resposta final já sintetizada.
 */
export type GenerateWithToolsOptions = {
  /** Modelo concreto escolhido pelo roteador (V1.2) — padrão: o modelo histórico deste cliente. */
  model?: string
  route?: LlmRouteRecord
  /** Nome do cache explícito (`cachedContents/…`) que JÁ contém system + tools (V1.3): a request vai
   * sem `systemInstruction`/`tools` (a API recusa repetir) — os textos continuam na telemetria. */
  cachedContent?: string | undefined
}

export async function generateWithTools(
  contents: ChatTurn[],
  systemInstruction: string,
  tools: FunctionDeclaration[],
  options?: GenerateWithToolsOptions,
): Promise<GenerateWithToolsResult> {
  const model = options?.model ?? MODEL
  if (!env.GEMINI_API_KEY) {
    throw new DomainError("Orquestrador de chat não está configurado neste ambiente (falta GEMINI_API_KEY).", "ASSISTANT_NOT_CONFIGURED", 503)
  }

  // Telemetria (ver shared/application/llm-telemetry.ts): no-op fora de um store; no QA Lab,
  // `beforeLlmCall` aplica "Parar antes da IA"/orçamento ANTES de consumir qualquer token.
  beforeLlmCall()
  const startedAt = new Date()
  const response = await connectWithRetry(model, contents, systemInstruction, tools, options?.cachedContent)
  const payload = (await response.json()) as GenerateContentResponse
  const parts = payload.candidates?.[0]?.content?.parts ?? []
  const calls: FunctionCall[] = parts
    .filter((part) => part.functionCall)
    .map((part) => ({ ...part.functionCall!, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) }))
  const text = parts.map((part) => part.text ?? "").join("")
  const usage = usageFromGeminiPayload(payload)
  const durationMs = Date.now() - startedAt.getTime()
  const inputChars = contents.reduce((sum, turn) => sum + ("text" in turn ? turn.text.length : JSON.stringify(turn).length), 0)
  recordLlmCall({
    model,
    ...usage,
    durationMs,
    startedAt,
    systemPrompt: systemInstruction,
    // A "entrada" de um turno com function calling é o último turno de texto/resposta de tool
    // — o histórico completo já está descrito pelas próprias chamadas anteriores do trace.
    input: describeLastTurn(contents),
    outputText: calls.length > 0 ? `[function calls] ${calls.map((call) => call.name).join(", ")}` : text || null,
    ...(calls.length > 0 ? { toolCalls: calls.map((call) => call.name) } : {}),
    promptBreakdown: { systemPromptChars: systemInstruction.length, toolSchemaChars: tools.length > 0 ? JSON.stringify(tools).length : 0, inputChars, declaredTools: tools.length, technicalIds: countTechnicalIdsInPrompt(systemInstruction, ...contents.map((turn) => ("text" in turn ? turn.text : JSON.stringify(turn)))) },
    ...(options?.route ? { route: options.route } : {}),
  })
  if (calls.length > 0) return { kind: "functionCalls", calls, usage, durationMs, model }

  if (!text.trim()) throw new DomainError("A INIA não retornou nenhum texto.", "ASSISTANT_EMPTY", 502)
  return { kind: "text", text, usage, durationMs, model }
}

async function connectWithRetry(model: string, contents: ChatTurn[], systemInstruction: string, tools: FunctionDeclaration[], cachedContent?: string): Promise<Response> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let response: Response
    try {
      response = await fetch(generateUrl(model), {
        method: "POST",
        headers: { "x-goog-api-key": env.GEMINI_API_KEY!, "content-type": "application/json" },
        body: JSON.stringify({
          contents: contents.map(turnToContent),
          ...(cachedContent
            ? { cachedContent }
            : { systemInstruction: { parts: [{ text: systemInstruction }] }, ...(tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}) }),
        }),
        // Prazo da chamada + cancelamento de quem pediu (SSE do chat fechado): o fetch para e a vaga do limitador volta.
        signal: withAiCancellation(AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
      })
    } catch (error) {
      if (currentAiAbortSignal()?.aborted) throw new AiCallCancelledError()
      const timedOut = error instanceof Error && error.name === "TimeoutError"
      throw new DomainError(
        timedOut ? "A INIA demorou demais para responder." : "Não foi possível contatar a INIA.",
        timedOut ? "ASSISTANT_TIMEOUT" : "ASSISTANT_NETWORK_ERROR",
        504,
      )
    }

    if (response.ok) return response
    if (response.status !== 503 || attempt === 2) {
      const body = await response.text()
      throw new DomainError("Não foi possível obter uma resposta da INIA.", "ASSISTANT_FAILED", 502, { status: response.status, body })
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
  }
  throw new DomainError("Não foi possível contatar a INIA.", "ASSISTANT_NETWORK_ERROR", 504)
}
