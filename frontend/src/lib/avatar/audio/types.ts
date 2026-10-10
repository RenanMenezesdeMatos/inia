import type { ScheduledAudioChunk } from "../lipsync/types"

/**
 * Contratos da reprodução da fala (áudio do Gemini Live) e do relógio "ouvido".
 *
 * O `AudioContext` de reprodução é a fonte da verdade temporal do lip-sync: cada chunk recebe
 * um `startAt` exato nesse relógio, e o avatar pergunta "o que está sendo OUVIDO agora?" —
 * `currentTime` do contexto menos a latência de saída (ou `getOutputTimestamp`, quando existe).
 * Nada disso passa por estado do React.
 */

export interface SpeechClock {
  /**
   * Instante (s, relógio do AudioContext) que está saindo do alto-falante agora, já somado ao
   * ajuste manual `avOffsetMs` (Bluetooth etc.). `null` sem contexto de áudio.
   */
  heardTime(nowPerformanceMs?: number): number | null
}

export type PlaybackTurnEvent =
  /** Primeiro chunk do turno foi agendado. */
  | { type: "turn-started"; turnId: number; startAt: number }
  /**
   * Todo o áudio agendado do turno terminou de tocar (não é o `turnComplete` da rede). Pode se
   * repetir no mesmo turno se o áudio voltar depois de um buraco (ex.: espera de uma tool).
   */
  | { type: "turn-drained"; turnId: number; endedAt: number }
  /** Turno interrompido: nada depois de `stoppedAt` é ouvido. */
  | { type: "turn-interrupted"; turnId: number; stoppedAt: number }

export type SpeechPlaybackOptions = {
  sampleRate?: number
  /** Fade-out ao interromper, evita estalo. */
  interruptFadeMs?: number
  /**
   * Ajuste fino de sincronia audiovisual (positivo = boca adiantada em relação ao áudio). Ausente =
   * o ajuste salvo deste aparelho (Acessibilidade › Sincronia da boca, `av-sync.ts`).
   */
  avOffsetMs?: number
  onChunkScheduled?: (chunk: ScheduledAudioChunk) => void
  onTurnEvent?: (event: PlaybackTurnEvent) => void
  /**
   * Fábrica do AudioContext (padrão: `new AudioContext({ sampleRate })`). Existe para testes e
   * para o laboratório; nunca é chamada fora de `prime()`.
   */
  createContext?: (sampleRate: number) => AudioContext
}

/** Observador da reprodução — o transporte usa para alimentar o lip-sync e o estado da conversa. */
export type SpeechPlaybackListener = {
  /** Chamado ANTES do `start()` do chunk (o lip-sync já conhece o áudio antes de ele soar). */
  onChunkScheduled?: (chunk: ScheduledAudioChunk) => void
  onTurnEvent?: (event: PlaybackTurnEvent) => void
}

export interface SpeechPlayback extends SpeechClock {
  /** Cria/retoma o AudioContext — chamar DE DENTRO de um clique (política de autoplay). */
  prime(): void
  readonly context: AudioContext | null
  /** Turno corrente (0 = nenhum). */
  readonly currentTurnId: number
  /** Abre um novo turno de áudio; o anterior é considerado encerrado (sem cortar o que já toca). */
  beginTurn(): number
  /** Agenda um chunk PCM16 (base64 do Gemini) no turno corrente; ignora se o turno não é o corrente. */
  enqueueBase64Pcm16(base64: string, turnId: number): ScheduledAudioChunk | null
  enqueuePcm(pcm: Float32Array, turnId: number): ScheduledAudioChunk | null
  /** Para tudo com fade; devolve o instante (relógio do contexto) em que o áudio se cala. */
  interrupt(): number | null
  /** Há áudio agendado ainda não ouvido. */
  isPlaying(): boolean
  /** Fim do áudio agendado no turno corrente (s). */
  readonly scheduledUntil: number
  setAvOffsetMs(ms: number): void
  /**
   * Voz da INIA silenciada (botão de mudo): o áudio continua sendo agendado e o relógio OUVIDO continua andando (o texto segue o
   * ritmo da fala), só não sai no alto-falante. Vale para o contexto atual e os próximos; troca com uma rampa curta (sem estalo).
   */
  setMuted(muted: boolean): void
  /** Nó para gravações de demonstração (laboratório): recebe exatamente o que vai ao alto-falante. */
  tapOutput(node: AudioNode): () => void
  /**
   * Assina chunks agendados e eventos de turno além dos callbacks das opções (um `SpeechPlayback`
   * injetado — laboratório — continua observável pelo transporte). Devolve o cancelamento.
   */
  subscribe(listener: SpeechPlaybackListener): () => void
  /**
   * Fecha o AudioContext e cala tudo. O objeto continua utilizável: só um novo `prime()` (dentro
   * de um clique) cria outro contexto — `enqueue*` nunca cria contexto por conta própria.
   */
  close(): Promise<void>
}
