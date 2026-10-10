import { env } from "../../../config/env.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { usageFromGeminiPayload, type LlmUsage } from "../../../shared/application/llm-telemetry.js"

// Chosen over gemini-3.6-flash after live testing on 2026-09-09: this one
// skips the model's default "thinking" pass entirely (0 thought tokens vs.
// 200-300+ on the others), so it's both faster and cheaper for a plain
// chat reply that doesn't need extended reasoning.
const MODEL = "gemini-3.1-flash-lite"
const STREAM_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`
// fetch() has no default timeout — if Gemini's servers hang instead of
// erroring quickly (observed during the "high demand" instability on
// 2026-09-09), an unbounded call here means the frontend's request hangs
// too, `textReplyPending` never clears, and the composer gets stuck
// disabled with an empty "thinking" bubble until the page is reloaded.
const REQUEST_TIMEOUT_MS = 15_000
// Google's own 503 message says demand spikes are "usually temporary" —
// confirmed live: 2 of 3 back-to-back calls failed with 503 while the 2nd
// succeeded fine, so one short-delay retry meaningfully improves the odds
// without the user noticing much extra wait. Only applies to the initial
// connection attempt, not to a stream that fails partway through.
const RETRY_DELAY_MS = 600

type StreamChunk = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  usageMetadata?: unknown
}

export type HistoryTurn = { role: "user" | "model"; text: string }

/**
 * Streams a reply from Gemini, invoking `onChunk` with each text fragment
 * as it arrives (verified live against the real SSE format on 2026-09-09:
 * `data: {json}` lines, each carrying the next slice of the reply — not a
 * delta-only design, each `candidates[0].content.parts[0].text` is the new
 * text since the last chunk, so callers just concatenate in order).
 *
 * `history` is the full conversation so far, oldest first, ending with the
 * new user turn — `generateContent`/`streamGenerateContent` are stateless,
 * so this is the only way a reply is grounded in what was already said
 * (otherwise every text message starts from zero, with no memory of the
 * question before it, let alone anything discussed by voice).
 */
export async function streamTextReply(
  history: HistoryTurn[],
  systemInstruction: string,
  onChunk: (text: string) => void,
): Promise<LlmUsage | null> {
  if (!env.GEMINI_API_KEY) {
    throw new DomainError(
      "Resposta de texto não está configurada neste ambiente.",
      "TEXT_REPLY_NOT_CONFIGURED",
      503,
    )
  }

  const response = await connectWithRetry(history, systemInstruction)
  if (!response.body) {
    throw new DomainError("A INIA não retornou uma resposta.", "TEXT_REPLY_EMPTY", 502)
  }

  let sawAnyText = false
  // O último chunk do SSE traz `usageMetadata` (uso da resposta inteira) — devolvido para o registro de uso (AI Providers V1).
  let usage: LlmUsage | null = null
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("data:")) continue
        const payload = trimmed.slice("data:".length).trim()
        if (!payload) continue
        const chunk = safeParse(payload)
        if (chunk && "usageMetadata" in chunk) usage = usageFromGeminiPayload(chunk)
        const text = chunk?.candidates?.[0]?.content?.parts?.[0]?.text
        if (text) {
          sawAnyText = true
          onChunk(text)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (!sawAnyText) {
    throw new DomainError("A INIA não retornou uma resposta.", "TEXT_REPLY_EMPTY", 502)
  }
  return usage
}

async function connectWithRetry(history: HistoryTurn[], systemInstruction: string): Promise<Response> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let response: Response
    try {
      response = await fetch(STREAM_URL, {
        method: "POST",
        headers: {
          "x-goog-api-key": env.GEMINI_API_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: history.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
          systemInstruction: { parts: [{ text: systemInstruction }] },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError"
      throw new DomainError(
        timedOut ? "A INIA demorou demais para responder." : "Não foi possível contatar a INIA.",
        timedOut ? "TEXT_REPLY_TIMEOUT" : "TEXT_REPLY_NETWORK_ERROR",
        504,
      )
    }

    if (response.ok) return response
    if (response.status !== 503 || attempt === 2) {
      const body = await response.text()
      throw new DomainError(
        "Não foi possível obter uma resposta da INIA.",
        "TEXT_REPLY_FAILED",
        502,
        { status: response.status, body },
      )
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
  }
  throw new DomainError("Não foi possível contatar a INIA.", "TEXT_REPLY_NETWORK_ERROR", 504)
}

function safeParse(raw: string): StreamChunk | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
