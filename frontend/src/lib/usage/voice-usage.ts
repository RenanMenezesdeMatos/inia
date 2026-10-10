import { newId } from "./usage-collector"
import { getUsageTracker, trackUsage } from "./usage-provider"

/**
 * Uso da VOZ para a monitoria de usabilidade — ciclo técnico observado pelo transporte, nunca áudio nem texto:
 *   intenção de voz (uma por pedido de conexão; reconexão mantém a intenção) · permissão do microfone · intervalos com microfone
 *   aberto (microfone aberto NÃO é fala) · reprodução da fala da INIA (início real, fim ou interrupção) · tempo até o primeiro
 *   áudio depois do turno do usuário. Sem rastreador (coleta desligada, laboratório do avatar) tudo vira nada.
 */
export class VoiceUsageRecorder {
  private intentId: string | null = null
  private micSince: number | null = null
  private playing: { turnId: number; startedAt: number } | null = null
  private awaitingAudioSince: number | null = null
  private awaitingCorrelation: string | null = null
  private media = { mic: false, playback: false }

  connectRequested() {
    this.intentId = newId()
    this.connection("REQUESTED", null)
  }

  connected() {
    this.connection("ESTABLISHED", null)
  }

  failed() {
    this.connection("FAILED", "NETWORK")
  }

  closed(reason: "USER" | "NETWORK" | "SERVER" | "IDLE") {
    this.micClosed()
    this.playbackEnded("INTERRUPTED")
    this.connection("CLOSED", reason)
  }

  micPermission(error: unknown | null) {
    const result = error === null ? "GRANTED" : error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "DENIED" : "UNAVAILABLE"
    trackUsage("voice.mic_permission", { result, voiceIntentId: this.ensureIntent() }, { qualifies: true })
  }

  micOpened() {
    this.micSince = Date.now()
    this.setMedia("mic", true)
  }

  micClosed() {
    if (this.micSince === null) return
    const start = this.micSince
    this.micSince = null
    this.setMedia("mic", false)
    const end = Date.now()
    if (end - start < 200) return
    trackUsage("voice.mic_span", { spanStart: new Date(start).toISOString(), spanEnd: new Date(end).toISOString(), voiceIntentId: this.ensureIntent() })
  }

  /** O usuário terminou um turno (voz ou texto): mede até o primeiro áudio da resposta. */
  turnSent() {
    this.awaitingAudioSince = performance.now()
    this.awaitingCorrelation = newId()
  }

  /** Primeiro áudio agendado de uma resposta = a fala da INIA começou de verdade. */
  audioScheduled(turnId: number) {
    if (this.playing?.turnId === turnId) return
    if (this.playing) this.playbackEnded("COMPLETED")
    this.playing = { turnId, startedAt: Date.now() }
    this.setMedia("playback", true)
    trackUsage("voice.playback", { stage: "STARTED", context: "CONVERSATION", voiceIntentId: this.ensureIntent() })
    if (this.awaitingAudioSince !== null) {
      trackUsage("latency.measured", { metric: "VOICE_FIRST_AUDIO", ms: Math.round(performance.now() - this.awaitingAudioSince), outcome: "OK" }, { correlationId: this.awaitingCorrelation })
      this.awaitingAudioSince = null
      this.awaitingCorrelation = null
    }
  }

  playbackEnded(stage: "COMPLETED" | "INTERRUPTED") {
    const playing = this.playing
    if (!playing) return
    this.playing = null
    this.setMedia("playback", false)
    trackUsage("voice.playback", { stage, context: "CONVERSATION", spanStart: new Date(playing.startedAt).toISOString(), spanEnd: new Date().toISOString(), voiceIntentId: this.ensureIntent() })
  }

  private connection(stage: string, reason: string | null) {
    trackUsage("voice.connection", { stage, voiceIntentId: this.ensureIntent(), reason })
  }

  private ensureIntent(): string {
    if (!this.intentId) this.intentId = newId()
    return this.intentId
  }

  /** Voz/áudio em andamento conta como atenção no tempo ativo (pares sempre equilibrados). */
  private setMedia(kind: "mic" | "playback", active: boolean) {
    if (this.media[kind] === active) return
    this.media[kind] = active
    try {
      getUsageTracker()?.setMediaActive(active)
    } catch {
      // observacional
    }
  }
}
