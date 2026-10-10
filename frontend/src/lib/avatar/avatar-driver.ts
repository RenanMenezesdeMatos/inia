import type { AvatarConversationState, AvatarDriver, AvatarTuning, ConversationCue } from "./animation/types"
import { DEFAULT_AVATAR_TUNING } from "./animation/types"
import { FramePresentationEstimator } from "./audio/av-sync"
import type { SpeechClock } from "./audio/types"
import { createTextTimedLipsync } from "./lipsync/text-timed-lipsync"
import type { SpeechFrame, SpeechLipsyncEngine, TextTimedLipsync } from "./lipsync/types"
import { REST_MOUTH } from "./lipsync/types"

/**
 * O objeto que liga a conversa ao avatar — criado UMA vez por chat e lido a cada quadro pelo
 * `useFrame`, nunca por props/estado do React (o `<Canvas>` não pode re-renderizar por fala nem por
 * animação; ver `inia-humanoid-avatar-3d.tsx`).
 *
 * Duas fontes de fala, a mesma saída (`SpeechFrame`):
 * - resposta do Gemini Live: lip-sync por áudio + texto, amostrado no instante OUVIDO do
 *   `AudioContext` de reprodução (`playback.heardTime`);
 * - despedida ("Até já!"): `speechSynthesis` do navegador, que não expõe o áudio — lip-sync
 *   temporizado pelo texto + eventos de fronteira de palavra, no relógio `performance.now()`.
 */

/** Controle da despedida falada pelo `speechSynthesis`; ligue aos eventos da `SpeechSynthesisUtterance`. */
export type FarewellSpeech = {
  /** `onboundary`: a palavra que começa em `charIndex` começou agora. */
  boundary(charIndex: number): void
  /** `onend`/`onerror`: a fala acabou; a boca fecha suavemente. */
  end(): void
  /** Desmontagem/cancelamento: cala a boca a partir de agora. */
  cancel(): void
}

export type AvatarSpeechDriver = AvatarDriver & {
  setState(state: AvatarConversationState): void
  pushCue(cue: ConversationCue): void
  /** Valores fora de 0..2 são limitados; não numéricos, ignorados. */
  setTuning(patch: Partial<AvatarTuning>): void
  /**
   * Voz silenciada: o áudio segue (sem som), mas ela não "fala" — boca em repouso, sem postura nem gestos de fala. Gestos pedidos
   * pela tela (`gesture`) continuam.
   */
  setMuted(muted: boolean): void
  /** Chame no `onstart` da utterance (a fala começa agora). */
  startFarewell(text: string): FarewellSpeech
  /**
   * Cancela a despedida, esvazia as dicas e volta a "idle". A instância continua utilizável — o
   * StrictMode desmonta e remonta efeitos com o mesmo objeto.
   */
  dispose(): void
}

export type AvatarSpeechDriverOptions = {
  /**
   * Relógio do áudio ouvido (a reprodução do transporte). `scheduledUntil`/`isPlaying`, quando
   * existem, seguram as dicas de texto até o trecho correspondente ser OUVIDO.
   */
  playback: SpeechClock & { readonly scheduledUntil?: number; isPlaying?(): boolean }
  lipsync: Pick<SpeechLipsyncEngine, "sample">
  /** Padrão: `createTextTimedLipsync()`. */
  textTimed?: TextTimedLipsync
  /** Relógio em ms (padrão: `performance.now()`); só os testes trocam. */
  now?: () => number
}

/** Sem ninguém drenando (câmera desligada), a fila não cresce além disso. */
const MAX_PENDING_CUES = 32
const NO_CUES: ConversationCue[] = []
/**
 * A dica de texto é liberada um pouco ANTES do fim do áudio que já estava agendado quando o
 * fragmento chegou (a transcrição acompanha a geração; a palavra soa perto desse fim).
 */
const CUE_LEAD_SECONDS = 0.35
const MAX_DELAYED_CUES = 64
const TUNING_KEYS = Object.keys(DEFAULT_AVATAR_TUNING) as Array<keyof AvatarTuning>

class SpeechDriver implements AvatarSpeechDriver {
  readonly tuning: AvatarTuning = { ...DEFAULT_AVATAR_TUNING }
  private currentState: AvatarConversationState = "idle"
  private cues: ConversationCue[] = []
  /** Dicas de texto esperando o áudio correspondente ser ouvido (o texto chega até ~40 s antes). */
  private delayed: Array<{ cue: ConversationCue; at: number }> = []
  private readonly playback: AvatarSpeechDriverOptions["playback"]
  private readonly lipsync: Pick<SpeechLipsyncEngine, "sample">
  private readonly textTimed: TextTimedLipsync
  private readonly now: () => number
  /** Despedida em andamento (token do handle vigente; 0 = nenhuma). */
  private farewellToken = 0
  private farewellSeq = 0
  private muted = false
  private readonly presentation = new FramePresentationEstimator()

  constructor(options: AvatarSpeechDriverOptions) {
    this.playback = options.playback
    this.lipsync = options.lipsync
    this.textTimed = options.textTimed ?? createTextTimedLipsync()
    this.now = options.now ?? (() => performance.now())
  }

  get state(): AvatarConversationState {
    // Muda, a fala segue sem som: para o corpo dela, não está falando.
    return this.muted && this.currentState === "speaking" ? "idle" : this.currentState
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (muted) this.delayed = this.delayed.filter((entry) => entry.cue.type !== "assistant-text")
  }

  setState(state: AvatarConversationState): void {
    this.currentState = state
  }

  sampleSpeech(out: SpeechFrame, nowMs: number): void {
    if (this.muted) {
      writeRestFrame(out)
      return
    }
    if (this.farewellToken !== 0) {
      const time = nowMs / 1000
      // Depois do `end()` a boca ainda fecha suavemente; quando o texto não está mais ativo, a
      // despedida acabou e a fonte volta a ser o áudio (em repouso, sem sessão de voz).
      if (this.textTimed.isActive(time)) {
        this.textTimed.sample(time, out)
        return
      }
      this.farewellToken = 0
    }
    // A pose calculada agora só aparece no próximo vsync: amostra o instante ouvido DAQUELE momento.
    // Somado depois (não `heardTime(now + quadro)`): o `heardTime` nunca passa do `currentTime` e, sem
    // `getOutputTimestamp` (Safari), nem depende do `now`.
    const lead = this.presentation.observe(nowMs) / 1000
    const heard = this.playback.heardTime(nowMs)
    if (heard === null) {
      writeRestFrame(out)
      return
    }
    this.lipsync.sample(heard + lead, out)
  }

  drainCues(): ConversationCue[] {
    if (this.delayed.length > 0) this.releaseHeardCues()
    // Quase todo quadro não tem dica: devolve o array vazio compartilhado (sem alocação).
    if (this.cues.length === 0) return NO_CUES
    const drained = this.cues
    this.cues = []
    return drained
  }

  pushCue(cue: ConversationCue): void {
    // Muda: nada de sorriso/gesto puxado pela fala nem abertura/fim de turno — ela não está falando.
    if (this.muted && (cue.type === "assistant-text" || cue.type === "turn-started" || cue.type === "turn-ended")) return
    if (cue.type === "assistant-text") {
      const at = this.playback.scheduledUntil
      if (typeof at === "number" && Number.isFinite(at)) {
        this.delayed.push({ cue, at })
        if (this.delayed.length > MAX_DELAYED_CUES) this.delayed.splice(0, this.delayed.length - MAX_DELAYED_CUES)
        return
      }
    }
    const last = this.cues[this.cues.length - 1]
    // O nível do microfone chega ~19×/s: só o mais recente interessa.
    if (cue.type === "user-level" && last?.type === "user-level") {
      this.cues[this.cues.length - 1] = cue
      return
    }
    this.cues.push(cue)
    if (this.cues.length > MAX_PENDING_CUES) this.cues.splice(0, this.cues.length - MAX_PENDING_CUES)
  }

  /** Move para a fila as dicas cujo áudio já soou; descarta as de uma resposta cortada. */
  private releaseHeardCues(): void {
    const heard = this.playback.heardTime(this.now())
    if (heard === null) {
      // Sem relógio de áudio não há o que esperar: a dica vale agora.
      for (const item of this.delayed) this.pushImmediate(item.cue)
      this.delayed = []
      return
    }
    let due = 0
    while (due < this.delayed.length && this.delayed[due].at - CUE_LEAD_SECONDS <= heard) {
      this.pushImmediate(this.delayed[due].cue)
      due++
    }
    if (due > 0) this.delayed.splice(0, due)
    // Nada tocando e ainda há texto "no futuro": o áudio dele foi cortado e nunca vai soar.
    if (this.delayed.length > 0 && this.playback.isPlaying && !this.playback.isPlaying()) this.delayed = []
  }

  private pushImmediate(cue: ConversationCue): void {
    this.cues.push(cue)
    if (this.cues.length > MAX_PENDING_CUES) this.cues.splice(0, this.cues.length - MAX_PENDING_CUES)
  }

  setTuning(patch: Partial<AvatarTuning>): void {
    for (const key of TUNING_KEYS) {
      const value = patch[key]
      if (typeof value === "number" && Number.isFinite(value)) this.tuning[key] = Math.min(2, Math.max(0, value))
    }
  }

  startFarewell(text: string): FarewellSpeech {
    this.farewellSeq += 1
    const token = this.farewellSeq
    this.farewellToken = token
    this.textTimed.start(text, this.now() / 1000)
    // Um handle antigo (utterance anterior) nunca mexe na despedida nova.
    const current = () => this.farewellToken === token
    return {
      boundary: (charIndex) => {
        if (current()) this.textTimed.boundary(charIndex, this.now() / 1000)
      },
      end: () => {
        if (current()) this.textTimed.end(this.now() / 1000)
      },
      cancel: () => {
        if (!current()) return
        this.textTimed.cancel(this.now() / 1000)
      },
    }
  }

  dispose(): void {
    if (this.farewellToken !== 0) this.textTimed.cancel(this.now() / 1000)
    this.farewellToken = 0
    this.cues = []
    this.delayed = []
    this.currentState = "idle"
  }
}

export function createAvatarSpeechDriver(options: AvatarSpeechDriverOptions): AvatarSpeechDriver {
  return new SpeechDriver(options)
}

function writeRestFrame(out: SpeechFrame): void {
  out.speaking = false
  Object.assign(out.mouth, REST_MOUTH)
  out.energy = 0
  out.emphasis = 0
  out.accentDirection = 0
  out.accentNuclear = false
  out.phraseTime = 0
  out.question = false
  out.debugPhone = null
  out.debugSource = null
}
