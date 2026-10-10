import type { SpeechFrame } from "../../lipsync/types"

/**
 * Como cabeça e sobrancelha respondem a cada TIPO de acento de frase (a direção do F0 do acento
 * que está pulsando — `SpeechFrame.accentDirection`/`accentNuclear`, ver `lipsync/prosody.ts`):
 *
 *  - QUEDA (H+L*, o nuclear declarativo do PT-BR) e o NUCLEAR do fim da frase: aceno curto para
 *    BAIXO — o "ponto" de quem fala. Sobrancelha quase parada.
 *  - SUBIDA (L+H* ou L*+H: continuação "vendas,", pergunta sim/não "juntos?"): a cabeça SOBE um pouco e
 *    a sobrancelha ergue — nunca aceno para baixo (a cabeça acompanha o F0; sobrancelha rápida
 *    acompanha subidas de F0).
 *  - PICO/NÍVEL (sobe e volta na janela, ou alto sem direção): batida intermediária — aceno menor
 *    para baixo e um pouco de sobrancelha.
 *
 * O nuclear só deixa de acenar para baixo quando sobe com clareza (continuação/pergunta): pico ou
 * nível no fim da frase vira queda. Pesos contínuos (smoothstep na direção): nada salta entre tipos.
 */

export type AccentResponse = {
  /** Amplitude 0..1 do aceno para baixo neste quadro (já com o pulso `emphasis`). */
  down: number
  /** Amplitude 0..1 da subida da cabeça. */
  up: number
  /** Amplitude 0..1 da sobrancelha do acento. */
  brow: number
}

/** Faixa da direção em que o peso passa de pico para subida/queda. */
const SHAPE_EDGE_LOW = 0.15
const SHAPE_EDGE_HIGH = 0.55
/** Pico: fração do aceno da queda e da sobrancelha da subida. */
const PEAK_NOD_SHARE = 0.6
const PEAK_BROW_SHARE = 0.6
/** Queda: só um traço de sobrancelha. */
const FALL_BROW_SHARE = 0.15

export function createAccentResponse(): AccentResponse {
  return { down: 0, up: 0, brow: 0 }
}

/** Pesos do quadro a partir do pulso e do tipo do acento (não aloca). */
export function writeAccentResponse(speech: SpeechFrame, out: AccentResponse): void {
  const pulse = speech.emphasis
  if (!(pulse > 0)) {
    out.down = 0
    out.up = 0
    out.brow = 0
    return
  }
  const direction = speech.accentDirection
  const rise = smoothstep(SHAPE_EDGE_LOW, SHAPE_EDGE_HIGH, direction)
  let fall = smoothstep(SHAPE_EDGE_LOW, SHAPE_EDGE_HIGH, -direction)
  let peak = 1 - rise - fall
  if (speech.accentNuclear) {
    fall += peak
    peak = 0
  }
  out.down = pulse * (fall + PEAK_NOD_SHARE * peak)
  out.up = pulse * rise
  out.brow = pulse * (rise + PEAK_BROW_SHARE * peak + FALL_BROW_SHARE * fall)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
