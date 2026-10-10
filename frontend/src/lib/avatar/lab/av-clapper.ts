import { FramePresentationEstimator } from "../audio/av-sync"
import type { SpeechPlayback } from "../audio/types"

/**
 * Teste de claque (laboratório): mede o erro boca × voz que SOBRA num aparelho real — o que o
 * `heardTime` não sabe (latência não informada de fones Bluetooth, compositor, painel).
 *
 * Um clique curto por segundo é agendado na MESMA reprodução da INIA (`createSpeechPlayback`, com o
 * ajuste salvo do aparelho) e a tela pisca quando o instante ouvido do quadro que vai aparecer
 * (`heardTime(agora)` + 1 intervalo de quadro, o mesmo caminho da boca) cruza o clique. Filmando a tela a 240 fps
 * com o som do aparelho, a distância entre o 1º quadro claro e o início do clique na trilha de áudio
 * do vídeo é o erro: flash ANTES do clique = boca adiantada → ajuste negativo do mesmo tanto.
 */

export const CLAP_PERIOD_SECONDS = 1
export const CLAP_COUNT = 20
/** Duração do flash: 3 quadros a 60 Hz — visível em qualquer câmera, início nítido. */
export const FLASH_SECONDS = 0.05
const CLICK_SECONDS = 0.012
/** Taxa da reprodução da INIA (PCM do Gemini Live): os buffers são criados nela, qualquer que seja a do contexto. */
const CLAP_SAMPLE_RATE = 24000

/** Clique de banda larga com ataque instantâneo (início nítido na forma de onda do vídeo). */
export function createClickPcm(sampleRate: number, periodSeconds = CLAP_PERIOD_SECONDS): Float32Array {
  const pcm = new Float32Array(Math.round(sampleRate * periodSeconds))
  const clickSamples = Math.round(sampleRate * CLICK_SECONDS)
  let seed = 12345
  for (let i = 0; i < clickSamples; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    const noise = (seed / 0xffffffff) * 2 - 1
    pcm[i] = 0.9 * noise * Math.exp(-i / (clickSamples / 4))
  }
  return pcm
}

/** O instante ouvido está dentro de algum flash? (`clicks` em ordem crescente.) */
export function flashActive(heard: number, clicks: readonly number[]): boolean {
  for (const click of clicks) {
    if (heard < click) return false
    if (heard < click + FLASH_SECONDS) return true
  }
  return false
}

export type AvClapperState = {
  running: boolean
  clicks: number[]
  /** Antecipação de apresentação em uso (ms). */
  leadMs: number
}

export class AvClapper {
  readonly state: AvClapperState = { running: false, clicks: [], leadMs: 0 }
  private readonly presentation = new FramePresentationEstimator()

  constructor(private readonly playback: SpeechPlayback) {}

  /** Chame DE DENTRO do clique (política de autoplay): prepara o áudio e agenda os cliques. */
  start(count = CLAP_COUNT): void {
    this.playback.prime()
    if (!this.playback.context) return
    const turnId = this.playback.beginTurn()
    const pcm = createClickPcm(CLAP_SAMPLE_RATE)
    this.state.clicks = []
    for (let k = 0; k < count; k++) {
      const chunk = this.playback.enqueuePcm(pcm, turnId)
      if (chunk) this.state.clicks.push(chunk.startAt)
    }
    this.state.running = this.state.clicks.length > 0
  }

  stop(): void {
    this.playback.interrupt()
    this.state.running = false
    this.state.clicks = []
  }

  /** Um quadro: a tela deve estar clara? (Mesmo caminho da boca: ajuste do aparelho + 1 quadro.) */
  frame(nowMs: number): boolean {
    const lead = this.presentation.observe(nowMs)
    this.state.leadMs = lead
    if (!this.state.running) return false
    const now = this.playback.heardTime(nowMs)
    const heard = now === null ? null : now + lead / 1000
    const last = this.state.clicks[this.state.clicks.length - 1]
    if (heard !== null && last !== undefined && heard > last + CLAP_PERIOD_SECONDS) this.state.running = false
    return heard !== null && flashActive(heard, this.state.clicks)
  }
}
