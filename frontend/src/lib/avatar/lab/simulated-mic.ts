import type { MicCapture, StartMicCapture } from "@/lib/realtime/mic-capture"

/**
 * Microfone simulado do laboratório: o transporte de produção abre "o microfone" no barge-in
 * (`startTurn` → `activityStart`) sem `getUserMedia` e sem mandar áudio — o servidor falso não
 * precisa dele. Emite só o NÍVEL (~19×/s, como o worklet real), alto enquanto o "usuário fala"
 * (`speak`), para o avatar reagir em "ouvindo" exatamente como na conversa real.
 */

export type SimulatedMic = {
  readonly startCapture: StartMicCapture
  /** O "usuário" fala por `ms` (só tem efeito com o microfone aberto). */
  speak(ms: number): void
  readonly isOpen: boolean
}

export type SimulatedMicOptions = {
  /** Contexto exposto no `MicCapture` (o transporte só o retoma ao voltar para a aba). */
  getContext: () => AudioContext | null
  now?: () => number
  levelIntervalMs?: number
}

export function createSimulatedMic({ getContext, now = () => Date.now(), levelIntervalMs = 52 }: SimulatedMicOptions): SimulatedMic {
  let open = false
  let speakingUntil = 0
  return {
    get isOpen() {
      return open
    },
    speak(ms) {
      if (open) speakingUntil = now() + Math.max(0, ms)
    },
    startCapture: async (handlers) => {
      open = true
      speakingUntil = 0
      let phase = 0
      const timer = setInterval(() => {
        phase += 1
        // Fala: nível entre ~0,03 e ~0,14 (sílabas); silêncio: ruído de fundo abaixo do limiar.
        const level = now() < speakingUntil ? 0.085 + 0.055 * Math.sin(phase * 1.7) * Math.abs(Math.sin(phase * 0.45)) : 0.004
        handlers.onLevel(level)
      }, levelIntervalMs)
      const capture: MicCapture = {
        // Sem AudioContext próprio: o transporte só confere `state` dele ao voltar para a aba.
        context: getContext() as AudioContext,
        stop() {
          clearInterval(timer)
          open = false
          speakingUntil = 0
        },
      }
      return capture
    },
  }
}
