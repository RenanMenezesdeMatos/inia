import type { FarewellSpeech } from "@/lib/avatar/avatar-driver"

/**
 * FALA DO RECADO (Workflow Output → Avatar). O texto já vem pronto e validado do backend (projeção do artefato confiável):
 * aqui só se FALA exatamente esse texto — nada é gerado, resumido ou reescrito por um modelo.
 *
 * Regra do produto: quando a pessoa aceita ouvir, o avatar FALA. Por isso `speakRecado` chama `speechSynthesis.speak`
 * SÍNCRONO, dentro do próprio clique (o gesto do usuário libera o áudio no navegador) — nunca depois de uma requisição.
 * É o mesmo motor de voz da despedida do avatar, com o lip-sync temporizado pelo texto do MESMO driver (`startFarewell`).
 *
 * O texto é dividido em frases curtas (o Chrome corta utterances longas por volta de 15 s) e todas entram na fila no mesmo
 * clique. Início = `onstart` da primeira; conclusão = `onend` da última sem interrupção. Sem início em poucos segundos
 * (áudio bloqueado/sem voz) = falha — a pessoa nunca fica esperando em silêncio.
 */
export type RecadoFailureReason = "SPEECH_UNAVAILABLE" | "SPEECH_ERROR" | "AUDIO_BLOCKED" | "NO_VOICE" | "UNKNOWN"

export type RecadoHandlers = {
  onStarted(): void
  onCompleted(): void
  onFailed(reason: RecadoFailureReason): void
  onInterrupted(): void
}

export type RecadoSpeechEnvironment = {
  synth: Pick<SpeechSynthesis, "speak" | "cancel"> & Partial<Pick<SpeechSynthesis, "getVoices">>
  createUtterance(text: string): SpeechSynthesisUtterance
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export type RecadoPlayback = { stop(): void }

/** Sem `onstart` nesse prazo, o áudio foi bloqueado ou não há voz: falha explícita. */
export const RECADO_START_TIMEOUT_MS = 5_000
const MAX_CHUNK_CHARS = 180

/** Frases inteiras, agrupadas até ~180 caracteres (nunca corta uma frase ao meio). */
export function splitRecadoSpeech(text: string): string[] {
  const sentences = (text.replace(/\s+/g, " ").trim().match(/[^.!?…]+[.!?…]+|\S[^.!?…]*$/g) ?? []).map((sentence) => sentence.trim()).filter(Boolean)
  const chunks: string[] = []
  for (const sentence of sentences) {
    const last = chunks[chunks.length - 1]
    if (last && last.length + sentence.length + 1 <= MAX_CHUNK_CHARS) chunks[chunks.length - 1] = `${last} ${sentence}`
    else chunks.push(sentence)
  }
  return chunks
}

export function browserSpeechEnvironment(): RecadoSpeechEnvironment | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance === "undefined") return null
  return {
    synth: window.speechSynthesis,
    createUtterance: (text) => new window.SpeechSynthesisUtterance(text),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  }
}

function portugueseVoice(synth: RecadoSpeechEnvironment["synth"]): SpeechSynthesisVoice | null {
  const voices = synth.getVoices?.() ?? []
  return voices.find((voice) => voice.lang?.toLowerCase() === "pt-br") ?? voices.find((voice) => voice.lang?.toLowerCase().startsWith("pt")) ?? null
}

/**
 * Começa a falar AGORA (chamar dentro do handler do clique). Devolve `null` quando não há voz no navegador (a falha já foi
 * informada por `onFailed`). `driver` = o driver do avatar (lip-sync por frase).
 */
export function speakRecado(text: string, driver: { startFarewell(text: string): FarewellSpeech }, handlers: RecadoHandlers, env: RecadoSpeechEnvironment | null = browserSpeechEnvironment()): RecadoPlayback | null {
  const chunks = splitRecadoSpeech(text)
  if (!env || chunks.length === 0) {
    handlers.onFailed(env ? "UNKNOWN" : "SPEECH_UNAVAILABLE")
    return null
  }
  let started = false
  let finished = false
  let current: FarewellSpeech | null = null
  let watchdog: unknown = null
  const finish = () => {
    finished = true
    env.clearTimeout(watchdog)
  }
  const fail = (reason: RecadoFailureReason) => {
    if (finished) return
    finish()
    current?.cancel()
    current = null
    env.synth.cancel()
    handlers.onFailed(reason)
  }
  // Fila limpa: nada de despedida ou recado anterior tocando junto.
  env.synth.cancel()
  const voice = portugueseVoice(env.synth)
  watchdog = env.setTimeout(() => {
    if (!started) fail("AUDIO_BLOCKED")
  }, RECADO_START_TIMEOUT_MS)
  chunks.forEach((chunk, index) => {
    const utterance = env.createUtterance(chunk)
    utterance.lang = "pt-BR"
    utterance.rate = 1
    if (voice) utterance.voice = voice
    utterance.onstart = () => {
      if (finished) return
      current = driver.startFarewell(chunk)
      if (!started) {
        started = true
        env.clearTimeout(watchdog)
        handlers.onStarted()
      }
    }
    utterance.onboundary = (event) => {
      if (event.name && event.name !== "word") return
      current?.boundary(event.charIndex)
    }
    utterance.onend = () => {
      if (finished) return
      current?.end()
      current = null
      if (index === chunks.length - 1) {
        finish()
        handlers.onCompleted()
      }
    }
    utterance.onerror = (event) => {
      // Cancelamento pedido pela própria tela (Parar/Encerrar) já foi reportado como interrupção.
      if (finished) return
      const code = (event as SpeechSynthesisErrorEvent | undefined)?.error
      fail(code === "not-allowed" ? "AUDIO_BLOCKED" : code === "voice-unavailable" || code === "language-unavailable" ? "NO_VOICE" : "SPEECH_ERROR")
    }
    env.synth.speak(utterance)
  })
  return {
    stop() {
      if (finished) return
      finish()
      current?.cancel()
      current = null
      env.synth.cancel()
      handlers.onInterrupted()
    },
  }
}
