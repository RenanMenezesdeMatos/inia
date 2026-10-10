import { env } from "../../../config/env.js"
import { INIA_LIVE_MODEL } from "../../../config/inia-voice.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { VoiceSessionConfig } from "../domain/voice-session.js"

/**
 * FRONTEIRA DO GEMINI LIVE (V1.3 — §10): a sessão de voz do avatar é uma sessão própria
 * (WebSocket bidirecional no navegador, token efêmero emitido aqui). Ela NÃO passa pelo
 * llm-gateway — reimplementar o streaming de voz pelo gateway prejudicaria o produto. O que a
 * sessão Live aciona no backend (`/tool-call` → runSpecialistTool → gateway) usa o gateway
 * normal, com roteamento, telemetria, classificação e Evidence Gating fail-closed. O modelo da
 * sessão Live nunca é trocado no meio da conversa.
 */
const AUTH_TOKENS_URL = "https://generativelanguage.googleapis.com/v1beta/auth_tokens"
const WEBSOCKET_HOST = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained"

// Verified live against the Gemini API (2026-09-09): ephemeral tokens must
// connect through the "Constrained" RPC name, not the plain
// BidiGenerateContent one the published examples show for direct API-key
// use — the plain path rejects ephemeral tokens with "unregistered callers".
export const REALTIME_MODEL = INIA_LIVE_MODEL

const NEW_SESSION_WINDOW_MS = 5 * 60_000
const SESSION_LIFETIME_MS = 30 * 60_000

export type EphemeralRealtimeSession = {
  wsUrl: string
  model: string
  expiresAt: string
}

/**
 * `BidiGenerateContentSetup` completo da sessão — vai no pedido do token, nunca pelo navegador. Push-to-talk: o turno só fecha
 * com o `activityEnd` do cliente (a API recusa misturá-lo com a detecção automática; ver o transporte no frontend).
 */
export function buildLiveSessionSetup(config: VoiceSessionConfig) {
  return {
    model: REALTIME_MODEL,
    generationConfig: {
      responseModalities: ["AUDIO"],
      // A voz da INIA sempre explícita (config/inia-voice.ts) — a padrão do Live não é documentada.
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voiceName } } },
      ...(typeof config.thinkingBudget === "number" ? { thinkingConfig: { thinkingBudget: config.thinkingBudget } } : {}),
    },
    systemInstruction: { parts: [{ text: config.systemInstruction }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
    ...(config.tools.length > 0 ? { tools: [{ functionDeclarations: config.tools }] } : {}),
  }
}

/**
 * Token efêmero TRAVADO na configuração da sessão (R-04). Verificado contra a API real em 08/10/2026 (v1beta + RPC "Constrained"):
 * com `bidiGenerateContentSetup` e SEM `fieldMask`, o provedor usa o setup do token inteiro e ignora o `setup` que o cliente manda
 * na conexão — instrução, ferramentas, modelo e voz pedidos pelo navegador não valem (nem com `{ setup: {} }`). `uses: 1`: o
 * token abre uma única sessão.
 */
export async function createEphemeralRealtimeSession(config: VoiceSessionConfig): Promise<EphemeralRealtimeSession> {
  if (!env.GEMINI_API_KEY) {
    throw new DomainError(
      "Voz em tempo real não está configurada neste ambiente.",
      "REALTIME_NOT_CONFIGURED",
      503,
    )
  }

  const now = Date.now()
  const expireTime = new Date(now + SESSION_LIFETIME_MS).toISOString()
  const newSessionExpireTime = new Date(now + NEW_SESSION_WINDOW_MS).toISOString()

  const response = await fetch(AUTH_TOKENS_URL, {
    method: "POST",
    headers: {
      "x-goog-api-key": env.GEMINI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uses: 1, expireTime, newSessionExpireTime, bidiGenerateContentSetup: buildLiveSessionSetup(config) }),
  })

  if (!response.ok) {
    // O corpo do provedor fica só no log do servidor (pode trazer detalhe da conta/chave); o navegador recebe o status.
    const body = await response.text().catch(() => "")
    console.warn(JSON.stringify({ event: "realtime_token_error", status: response.status, body: body.slice(0, 500) }))
    throw new DomainError(
      "Não foi possível iniciar a sessão de voz.",
      "REALTIME_SESSION_FAILED",
      502,
      { status: response.status },
    )
  }

  const data = (await response.json()) as { name: string }
  const wsUrl = `${WEBSOCKET_HOST}?access_token=${encodeURIComponent(data.name)}`

  return { wsUrl, model: REALTIME_MODEL, expiresAt: expireTime }
}
