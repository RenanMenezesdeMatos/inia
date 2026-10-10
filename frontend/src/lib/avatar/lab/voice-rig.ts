import type { AvatarConversationState, AvatarDriver, AvatarTuning, ConversationCue } from "@/lib/avatar/animation/types"
import { createSpeechPlayback } from "@/lib/avatar/audio/speech-playback"
import type { SpeechPlayback } from "@/lib/avatar/audio/types"
import { createAvatarSpeechDriver, type AvatarSpeechDriver } from "@/lib/avatar/avatar-driver"
import { createSpeechLipsyncEngine } from "@/lib/avatar/lipsync/speech-lipsync-engine"
import type { SpeechFrame, SpeechLipsyncEngine } from "@/lib/avatar/lipsync/types"
import { GeminiRealtimeTransport, type EphemeralSession } from "@/lib/realtime/gemini-realtime-transport"
import { FixtureReplaySocket, type FixtureReplayEvent, type ReplayClock, type ReplayScript } from "./fixture-replay-socket"
import { createSimulatedMic, type SimulatedMic } from "./simulated-mic"

/**
 * Um "motor de voz" do laboratório montado com as peças de PRODUÇÃO, como o chat monta o dele:
 * reprodução (`createSpeechPlayback`) + lip-sync (`createSpeechLipsyncEngine`) + driver do avatar
 * (`createAvatarSpeechDriver`) + `GeminiRealtimeTransport`. Só muda a borda:
 * - "fixture": a WebSocket é o servidor falso (`FixtureReplaySocket`) e a sessão é fictícia —
 *   sem login, sem custo;
 * - "live": sessão e WebSocket reais (precisa do cookie de login; consome a API do Gemini).
 * Nos dois, o microfone é simulado (`simulated-mic.ts`): nunca pede permissão nem manda áudio.
 */

export type LabSource = "fixture" | "live"

export type VoiceRigEvents = {
  onState?: (state: AvatarConversationState, previous: AvatarConversationState) => void
  onConnection?: (connected: boolean) => void
  onOutputText?: (text: string) => void
  onTurnComplete?: () => void
  onError?: (message: string) => void
  onReplayEvent?: (event: FixtureReplayEvent) => void
}

export type VoiceRig = {
  readonly source: LabSource
  readonly playback: SpeechPlayback
  readonly lipsync: SpeechLipsyncEngine
  readonly driver: AvatarSpeechDriver
  readonly transport: GeminiRealtimeTransport
  readonly mic: SimulatedMic
  /** O servidor falso da conexão atual (só "fixture"). */
  readonly socket: FixtureReplaySocket | null
}

export type CreateVoiceRigOptions = {
  events: VoiceRigEvents
  /** "fixture": qual captura responde ao turno que acabou de terminar. */
  nextScript?: () => ReplayScript | null
  /** Testes: AudioContext falso da reprodução e relógio do servidor falso. */
  createContext?: (sampleRate: number) => AudioContext
  replayClock?: ReplayClock
}

/** Sessão fictícia do modo "fixture" (a URL nunca é aberta: `createSocket` devolve o servidor falso). */
export const FIXTURE_SESSION: EphemeralSession = {
  wsUrl: "wss://fixture-replay.invalid/avatar-lab",
  model: "models/gemini-2.5-flash-native-audio-latest (captura)",
  expiresAt: "2099-01-01T00:00:00.000Z",
}

/** Mesmo ganho do chat (`normalizedMicLevel`): RMS ~0–0,11 → 0–1. */
function normalizedMicLevel(level: number): number {
  return Math.min(1, level * 9)
}

export function createVoiceRig(source: LabSource, { events, nextScript, createContext, replayClock }: CreateVoiceRigOptions): VoiceRig {
  const playback = createSpeechPlayback(createContext ? { createContext } : {})
  const lipsync = createSpeechLipsyncEngine()
  const driver = createAvatarSpeechDriver({ playback, lipsync })
  const mic = createSimulatedMic({ getContext: () => playback.context })
  let socket: FixtureReplaySocket | null = null
  let previous: AvatarConversationState = "idle"

  const transport = new GeminiRealtimeTransport(
    {
      onConnectionChange: (connected) => events.onConnection?.(connected),
      // O mesmo que o chat faz em `applyConversationState`: o driver recebe o estado e as dicas de
      // turno ("turno" para o avatar = a fala da INIA).
      onStateChange: (state) => {
        const before = previous
        previous = state
        driver.setState(state)
        if (state === "speaking" && before !== "speaking") driver.pushCue({ type: "turn-started" })
        if (before === "speaking" && state !== "speaking") driver.pushCue({ type: "turn-ended" })
        events.onState?.(state, before)
      },
      onOutputTranscript: (text) => {
        driver.pushCue({ type: "assistant-text", text })
        events.onOutputText?.(text)
      },
      onAudioLevel: (level) => driver.pushCue({ type: "user-level", level: normalizedMicLevel(level) }),
      onTurnComplete: () => events.onTurnComplete?.(),
      onError: (message) => events.onError?.(message),
    },
    source === "fixture"
      ? {
          playback,
          lipsync,
          startCapture: mic.startCapture,
          fetchSession: async () => FIXTURE_SESSION,
          createSocket: (url) => {
            socket = new FixtureReplaySocket(url, { nextScript: () => nextScript?.() ?? null, clock: replayClock, onEvent: (event) => events.onReplayEvent?.(event) })
            return socket.asWebSocket()
          },
        }
      : { playback, lipsync, startCapture: mic.startCapture },
  )

  return {
    source,
    playback,
    lipsync,
    driver,
    transport,
    mic,
    get socket() {
      return socket
    },
  }
}

/**
 * O driver que o avatar recebe: UM objeto estável pela vida do laboratório (o `<Canvas>` nunca
 * re-renderiza por troca de motor), que delega ao motor ativo ("fixture" ou "live") e aplica a
 * sobreposição manual de estado — só fora da fala: falando, manda sempre o estado real.
 */
export class LabDriverProxy implements AvatarDriver {
  private override: AvatarConversationState | null = null

  constructor(private readonly activeRig: () => VoiceRig) {}

  get state(): AvatarConversationState {
    const real = this.activeRig().driver.state
    return real === "speaking" || this.override === null ? real : this.override
  }

  get tuning(): AvatarTuning {
    return this.activeRig().driver.tuning
  }

  get overrideState(): AvatarConversationState | null {
    return this.override
  }

  setOverride(state: AvatarConversationState | null): void {
    this.override = state === "speaking" ? null : state
  }

  sampleSpeech(out: SpeechFrame, nowMs: number): void {
    this.activeRig().driver.sampleSpeech(out, nowMs)
  }

  drainCues(): ConversationCue[] {
    return this.activeRig().driver.drainCues()
  }
}
