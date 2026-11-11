import type { SpeechFrame } from "../lipsync/types"
import { createSpeechFrame } from "../lipsync/types"
import { createAccentResponse, writeAccentResponse } from "./behavior/accent"
import { BlinkLayer } from "./behavior/blink"
import { BodyTurnLayer } from "./behavior/body-turn"
import { BreathingLayer } from "./behavior/breathing"
import type { BehaviorContext, BoneOffsets } from "./behavior/context"
import { createBoneOffsets, createFrameEvents, createStateWeights, normalizeCueText, resetBoneOffsets, updateStateWeights } from "./behavior/context"
import { ExpressionLayer } from "./behavior/expression"
import { GazeLayer } from "./behavior/gaze"
import { GestureScheduler } from "./behavior/gesture-scheduler"
import { HeadMotionLayer } from "./behavior/head-motion"
import { PostureLayer } from "./behavior/posture"
import { SecondaryMotionLayer } from "./behavior/secondary-motion"
import { createBlendshapeWeights, createFaceMixInput, mixFace } from "./face-mixer"
import type { GestureCommand } from "./gesture-catalog"
import type { Rng } from "./random"
import { createRng } from "./random"
import { damp, writeEffectiveTuning } from "./tuning"
import type { AvatarConversationState, AvatarDriver, AvatarFrameOutput, AvatarMotionProfile, AvatarTuning, BoneOffset } from "./types"
import { DEFAULT_AVATAR_TUNING } from "./types"

/**
 * BehaviorController — decide, a cada quadro, TODO o comportamento do avatar a partir do
 * `AvatarDriver` (estado da conversa, fala no instante ouvido, dicas de texto/microfone).
 *
 * Determinístico: a mesma semente + a mesma sequência de (dt, driver) produz exatamente os mesmos
 * quadros (testes e o gravador do laboratório dependem disso). Sem alocação por quadro: a saída é
 * um objeto reaproveitado — leia antes do próximo `update`.
 *
 * Camadas (cada uma no seu arquivo em `behavior/`): respiração, piscadas, olhar, cabeça/pescoço,
 * postura, virada (para onde ela está voltada — `setFacing`), expressão e agendamento de gestos. Estados trocam por cross-fade de pesos (~0,45 s),
 * nunca por salto. Sem fala ouvida a boca fica em repouso (silêncio = respiração + presença).
 */

export type BehaviorFrame = AvatarFrameOutput & {
  bones: BoneOffsets
  hair: BoneOffset
  /** Gesto a tocar/parar NESTE quadro (null na imensa maioria dos quadros). */
  gesture: GestureCommand | null
  /** A fala ouvida neste quadro (mesmo objeto a cada quadro). */
  speech: SpeechFrame
}

export type BehaviorControllerOptions = {
  /** Semente do gerador (padrão fixo: o mesmo take sempre se repete). */
  seed?: number
  /**
   * Piscada atraída pelo fim de frase (padrão: sim). Desligar só serve para comparar/medir
   * (`scripts/dev/lipsync-dynamics.ts`): as piscadas voltam a ser só aleatórias + de oportunidade.
   */
  prosodicBlinks?: boolean
  /**
   * Perfil de movimento (padrão "classic" = comportamento da Mentora original, quadro a quadro igual).
   * "natural" soma o movimento secundário (`behavior/secondary-motion.ts`) e as piscadas variadas.
   */
  motionProfile?: AvatarMotionProfile
}

/** Semente do gerador próprio do movimento secundário (não consome o gerador das outras camadas). */
const SECONDARY_SEED_SALT = 0x5ec0da27

/** Passo máximo por quadro: aba que volta do segundo plano não "teletransporta" a animação. */
export const MAX_FRAME_SECONDS = 0.1
const USER_BURST_MIN_SECONDS = 0.6
const USER_SILENCE_SECONDS = 0.35
/** Pulso mínimo para um pico de acento nuclear contar como fim de frase (pulso cheio = 0,55–1). */
const NUCLEAR_PEAK_MIN = 0.45
/**
 * Atraso da piscada de fim de frase: depois do pico do nuclear ela cai no fim da tônica/pós-tônica,
 * entrando na pausa; no início da pausa longa, quase imediata.
 */
const NUCLEAR_BLINK_DELAY_SECONDS = 0.12
const PHRASE_END_BLINK_DELAY_SECONDS = 0.04

export class BehaviorController {
  private readonly seed: number
  private readonly prosodicBlinks: boolean
  private profile: AvatarMotionProfile
  private secondary: SecondaryMotionLayer | null = null
  private rng: Rng
  private readonly ctx: BehaviorContext
  private readonly frame: BehaviorFrame
  private readonly faceInput = createFaceMixInput()
  private readonly tuning: AvatarTuning = { ...DEFAULT_AVATAR_TUNING }
  private readonly breathing = new BreathingLayer()
  private readonly blink = new BlinkLayer()
  private readonly gaze = new GazeLayer()
  private readonly posture = new PostureLayer()
  private readonly turn = new BodyTurnLayer()
  /** Para onde ela fica voltada (graus, + = esquerda dela) — decidido pela tela (ver `setFacing`). */
  private facingDeg = 0
  private readonly gestures = new GestureScheduler()
  private head: HeadMotionLayer
  private expression: ExpressionLayer
  private started = false
  private previousState: AvatarConversationState = "idle"
  private previousSpeaking = false
  private phraseStartedAt = 0
  private phraseWasQuestion = false
  private awaitingFirstPhrase = false
  private rawUserLevel = 0
  private lastUserLevelAt = -1
  private userAbove = 0
  private userBelow = 0
  private userBurst = false
  private previousEmphasis = 0
  private emphasisRising = false
  private previousNuclear = false

  constructor(options: BehaviorControllerOptions = {}) {
    this.seed = options.seed ?? 0x1a1a2026
    this.prosodicBlinks = options.prosodicBlinks ?? true
    this.profile = options.motionProfile ?? "classic"
    this.applyProfile()
    this.rng = createRng(this.seed)
    this.head = new HeadMotionLayer(this.rng)
    this.expression = new ExpressionLayer(this.rng)
    this.ctx = {
      dt: 0,
      time: 0,
      rng: this.rng,
      state: "idle",
      weights: createStateWeights("idle"),
      speech: createSpeechFrame(),
      accent: createAccentResponse(),
      tuning: this.tuning,
      events: createFrameEvents(),
      userLevel: 0,
    }
    this.frame = { blendshapes: createBlendshapeWeights(), bones: createBoneOffsets(), hair: { x: 0, y: 0, z: 0 }, gesture: null, speech: this.ctx.speech }
  }

  /** Volta ao início (mesma semente): usado ao remontar a cena e pelo laboratório. */
  reset(): void {
    this.rng = createRng(this.seed)
    this.head = new HeadMotionLayer(this.rng)
    this.expression = new ExpressionLayer(this.rng)
    this.ctx.rng = this.rng
    this.ctx.time = 0
    this.breathing.reset()
    this.blink.reset()
    this.gaze.reset()
    this.posture.reset()
    this.turn.reset()
    this.gestures.reset()
    this.applyProfile()
    this.started = false
    this.previousSpeaking = false
    this.awaitingFirstPhrase = false
    this.rawUserLevel = 0
    this.lastUserLevelAt = -1
    this.userBurst = false
    this.userAbove = 0
    this.userBelow = 0
    this.ctx.userLevel = 0
    this.previousEmphasis = 0
    this.emphasisRising = false
    this.previousNuclear = false
  }

  /**
   * Para onde ela fica voltada, em graus (+ = para a esquerda dela). A tela decide (ex.: no palco do feedback, para o cartão
   * que ela apresenta ou para a pessoa); a virada é animada pela camada `BodyTurnLayer` — olhos, cabeça e depois o corpo.
   */
  /** Troca o perfil de movimento (o laboratório compara os dois no mesmo modelo). Sem mudança = sem efeito. */
  setMotionProfile(profile: AvatarMotionProfile): void {
    if (profile === this.profile) return
    this.profile = profile
    this.applyProfile()
  }

  get motionProfile(): AvatarMotionProfile {
    return this.profile
  }

  private applyProfile(): void {
    const natural = this.profile === "natural"
    this.blink.natural = natural
    this.secondary = natural ? new SecondaryMotionLayer(createRng((this.seed ^ SECONDARY_SEED_SALT) >>> 0)) : null
  }

  setFacing(degrees: number): void {
    this.facingDeg = Number.isFinite(degrees) ? degrees : 0
  }

  /**
   * Um quadro. `dtSeconds` = passo desde o anterior (limitado a 0,1 s), `nowMs` =
   * `performance.now()` (repassado ao driver para amostrar a fala no instante ouvido).
   */
  update(driver: AvatarDriver, dtSeconds: number, nowMs: number, reducedMotion = false): BehaviorFrame {
    const ctx = this.ctx
    const dt = Number.isFinite(dtSeconds) ? Math.min(MAX_FRAME_SECONDS, Math.max(0, dtSeconds)) : 0
    ctx.dt = dt
    ctx.time += dt
    writeEffectiveTuning(driver.tuning, reducedMotion, this.tuning)

    const state = driver.state
    if (!this.started) {
      // Primeiro quadro: começa no estado atual, sem cross-fade vindo de "idle".
      this.started = true
      this.previousState = state
      const initial = createStateWeights(state)
      Object.assign(ctx.weights, initial)
    }
    ctx.state = state
    updateStateWeights(ctx.weights, state, dt)

    driver.sampleSpeech(ctx.speech, nowMs)
    writeAccentResponse(ctx.speech, ctx.accent)
    this.detectEvents(driver, state)

    resetBoneOffsets(this.frame.bones)
    this.breathing.update(ctx, this.frame.bones)
    this.posture.update(ctx, this.frame.bones)
    this.turn.update(ctx, this.facingDeg, this.frame.bones, reducedMotion)
    if (ctx.events.phraseStarted) this.blink.opportunistic(ctx, 0.3)
    if (this.prosodicBlinks) {
      // Fim de frase: a próxima piscada (se já estava perto) vem agora — no fim da tônica nuclear ou
      // no início da pausa longa —, não no meio de uma palavra.
      if (ctx.events.nuclearAccentPeak) this.blink.atPhraseBoundary(ctx, NUCLEAR_BLINK_DELAY_SECONDS)
      if (ctx.events.phraseEnded) this.blink.atPhraseBoundary(ctx, PHRASE_END_BLINK_DELAY_SECONDS)
    }
    this.gaze.update(ctx, this.blink)
    this.head.update(ctx, this.gaze, this.frame.bones)
    if (this.secondary) this.secondary.update(ctx, this.frame.bones, this.frame.hair)
    else this.frame.hair.x = this.frame.hair.y = this.frame.hair.z = 0
    this.expression.update(ctx, this.faceInput.expression)
    const blink = this.blink.update(ctx)
    this.frame.gesture = this.gestures.update(ctx)

    const face = this.faceInput
    Object.assign(face.mouth, ctx.speech.mouth)
    face.blinkLeft = blink
    face.blinkRight = blink
    face.gazeYawDeg = this.gaze.eyeYaw + this.turn.eyeYaw
    face.gazePitchDeg = this.gaze.eyePitch
    face.lipsync = this.tuning.lipsync
    mixFace(face, this.frame.blendshapes)
    return this.frame
  }

  /** Acesso de diagnóstico/testes às camadas (somente leitura na prática). */
  get debug(): { blink: BlinkLayer; gestures: GestureScheduler; breathing: BreathingLayer; time: number } {
    return { blink: this.blink, gestures: this.gestures, breathing: this.breathing, time: this.ctx.time }
  }

  private detectEvents(driver: AvatarDriver, state: AvatarConversationState): void {
    const ctx = this.ctx
    const events = ctx.events
    const speech = ctx.speech
    events.stateEntered = state !== this.previousState ? state : null
    this.previousState = state

    events.assistantText = ""
    events.requestedGesture = null
    const cues = driver.drainCues()
    for (const cue of cues) {
      if (cue.type === "assistant-text") {
        events.assistantText = events.assistantText ? `${events.assistantText} ${normalizeCueText(cue.text)}` : normalizeCueText(cue.text)
      } else if (cue.type === "user-level") {
        this.rawUserLevel = Number.isFinite(cue.level) ? Math.min(1, Math.max(0, cue.level)) : 0
        this.lastUserLevelAt = ctx.time
      } else if (cue.type === "turn-started") {
        this.awaitingFirstPhrase = true
      } else if (cue.type === "turn-ended") {
        this.awaitingFirstPhrase = false
      } else if (cue.type === "gesture") {
        events.requestedGesture = cue.id
      }
    }

    // Fronteiras de frase na fala OUVIDA.
    events.phraseStarted = speech.speaking && !this.previousSpeaking
    events.phraseEnded = !speech.speaking && this.previousSpeaking
    events.firstPhraseOfTurn = events.phraseStarted && this.awaitingFirstPhrase
    if (events.phraseStarted) {
      this.phraseStartedAt = ctx.time
      this.awaitingFirstPhrase = false
    }
    if (speech.speaking) this.phraseWasQuestion = speech.question
    events.phraseDuration = events.phraseEnded ? ctx.time - this.phraseStartedAt : 0
    events.endedPhraseWasQuestion = events.phraseEnded && this.phraseWasQuestion
    this.previousSpeaking = speech.speaking

    // Pico do pulso de um acento nuclear (o pulso parou de subir).
    const emphasis = speech.emphasis
    events.nuclearAccentPeak = this.emphasisRising && emphasis < this.previousEmphasis && this.previousEmphasis >= NUCLEAR_PEAK_MIN && this.previousNuclear
    if (emphasis > this.previousEmphasis) this.emphasisRising = true
    else if (emphasis < this.previousEmphasis) this.emphasisRising = false
    this.previousEmphasis = emphasis
    this.previousNuclear = speech.accentNuclear

    // Microfone: o nível chega ~19×/s; sem dica nova por 0,3 s, considera silêncio.
    if (this.lastUserLevelAt >= 0 && ctx.time - this.lastUserLevelAt > 0.3) this.rawUserLevel = 0
    const listening = state === "listening"
    const level = listening ? this.rawUserLevel : 0
    ctx.userLevel = damp(ctx.userLevel, level, level > ctx.userLevel ? 0.05 : 0.25, ctx.dt)
    events.userBurstEnded = false
    if (level > 0.15) {
      this.userAbove += ctx.dt
      this.userBelow = 0
      if (this.userAbove >= USER_BURST_MIN_SECONDS) this.userBurst = true
    } else if (level < 0.05) {
      this.userBelow += ctx.dt
      if (this.userBelow >= USER_SILENCE_SECONDS) {
        if (this.userBurst && listening) events.userBurstEnded = true
        this.userBurst = false
        this.userAbove = 0
      }
    }
  }
}

export function createBehaviorController(options?: BehaviorControllerOptions): BehaviorController {
  return new BehaviorController(options)
}
