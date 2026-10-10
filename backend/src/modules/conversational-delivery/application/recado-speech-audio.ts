import { createHash } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { RecipientScope } from "./avatar-delivery-service.js"

/**
 * ÁUDIO do recado do avatar com a voz do Gemini. A fala é o `speech_text` JÁ PROJETADO da entrega (texto exato, validado);
 * a voz só a diz (a MESMA da conversa, conferida contra o texto — ver recado-voice.ts). Gerado uma vez por entrega e guardado (`workflow_output_speech_audio`) — o navegador pede quando o
 * convite aparece, então no clique de aceite o áudio já está pronto e a fala começa na hora. Só o destinatário (fora = 404).
 * Nunca muda estado da entrega: tocar continua sendo decidido pelo clique e registrado pelos eventos do recado.
 */
export type RecadoSpeechSynthesizer = (request: { text: string }) => Promise<{ pcm16: Buffer; sampleRate: number; model: string; voice: string }>
export type RecadoSpeechAudio = { pcm16: Buffer; sampleRate: number; durationMs: number; voice: string; model: string; cached: boolean }

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")
/** Uma síntese por entrega em andamento neste processo (dois pedidos juntos esperam a mesma). */
const inFlight = new Map<string, Promise<RecadoSpeechAudio>>()

export async function loadRecadoSpeechAudio(db: Pick<Database, "query">, scope: RecipientScope, outputId: string, synthesize: RecadoSpeechSynthesizer, expected: { voice: string; models: readonly string[] }): Promise<RecadoSpeechAudio> {
  const delivery = (await db.query<{ speech_text: string | null }>(`select speech_text from workflow_outputs where id = $1 and organization_id = $2 and recipient_id = $3 and surface = 'AVATAR'`, [outputId, scope.organizationId, scope.personId])).rows[0]
  if (!delivery?.speech_text) throw new DomainError("Recado não encontrado.", "AVATAR_DELIVERY_NOT_FOUND", 404)
  const text = delivery.speech_text
  const textHash = sha256(text)
  const cached = (await db.query<{ audio: Buffer; sample_rate: number; duration_ms: number; voice_name: string; model: string }>(
    `select audio, sample_rate, duration_ms, voice_name, model from workflow_output_speech_audio where output_id = $1 and text_sha256 = $2 and voice_name = $3 and model = any($4::text[])`,
    [outputId, textHash, expected.voice, [...expected.models]],
  )).rows[0]
  if (cached) return { pcm16: cached.audio, sampleRate: cached.sample_rate, durationMs: cached.duration_ms, voice: cached.voice_name, model: cached.model, cached: true }

  const pending = inFlight.get(outputId)
  if (pending) return pending
  const work = (async (): Promise<RecadoSpeechAudio> => {
    const speech = await synthesize({ text })
    const durationMs = Math.round((speech.pcm16.length / 2 / speech.sampleRate) * 1000)
    await db.query(
      `insert into workflow_output_speech_audio (output_id, organization_id, text_sha256, voice_name, model, sample_rate, audio, duration_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (output_id) do update set text_sha256 = excluded.text_sha256, voice_name = excluded.voice_name, model = excluded.model,
         sample_rate = excluded.sample_rate, audio = excluded.audio, duration_ms = excluded.duration_ms, created_at = now()`,
      [outputId, scope.organizationId, textHash, speech.voice, speech.model, speech.sampleRate, speech.pcm16, durationMs],
    )
    return { pcm16: speech.pcm16, sampleRate: speech.sampleRate, durationMs, voice: speech.voice, model: speech.model, cached: false }
  })()
  inFlight.set(outputId, work)
  try {
    return await work
  } finally {
    inFlight.delete(outputId)
  }
}
