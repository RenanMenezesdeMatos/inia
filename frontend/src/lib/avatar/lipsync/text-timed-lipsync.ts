import { MouthTimeline } from "./coarticulation"
import { phonemizeText } from "./pt-br/g2p"
import type { AlignedPhone, PauseStrength, SpeechFrame, TextTimedLipsync } from "./types"
import { REST_MOUTH } from "./types"

/**
 * Lip-sync da fala sintetizada pelo NAVEGADOR (speechSynthesis — a despedida "Até já!"), que não
 * expõe o áudio. Mesmo G2P e mesma coarticulação do motor de áudio; o que muda é o "quando":
 *
 * - `start()` distribui os fones pelas prioris de duração (÷ taxa da voz) a partir do início;
 * - cada `boundary(charIndex)` (início de palavra, quando o navegador manda) re-ancora aquela palavra
 *   e todas as seguintes no instante real — a deriva da priori nunca passa de uma palavra;
 * - `end()`/`cancel()` fecham a boca com uma rampa curta.
 *
 * Relógio: `performance.now() / 1000` (o chamador decide; a despedida usa o mesmo relógio no
 * `sampleSpeech` do driver). Vozes de rede do Chrome às vezes não mandam `onboundary`: aí vale só a
 * priori, que para uma frase curta fica perto o suficiente.
 */

const PAUSE_MS: Record<PauseStrength, number> = { none: 0, short: 160, long: 300 }
/** Rampa de fechamento depois do `end()`/`cancel()`. */
const END_EASE_SECONDS = 0.12
/** Loudness assumido (não há áudio para medir): fala em volume normal. */
const ASSUMED_LOUDNESS = 0.75
/** Largura do pulso de ênfase no acento nuclear. */
const EMPHASIS_WIDTH_SECONDS = 0.07
/**
 * Direção assumida do acento nuclear sem F0: queda no declarativo (H+L*, o padrão do PT-BR) e
 * subida na pergunta (o "?" do texto). A despedida ("Até já!") é sempre declarativa.
 */
const DECLARATIVE_NUCLEAR_DIRECTION = -1
const QUESTION_NUCLEAR_DIRECTION = 1

type WordPlan = { charStart: number; wordIndex: number; question: boolean }

class BrowserSpeechLipsync implements TextTimedLipsync {
  private readonly timeline = new MouthTimeline()
  private phones: AlignedPhone[] = []
  /**
   * Acento de frase por fone. Sem áudio não há F0: vale o acento NUCLEAR do PT-BR — a última tônica
   * antes de cada pausa (ou do fim) —, nunca toda tônica (o motor de áudio usa o F0, `prosody.ts`).
   */
  private accents: boolean[] = []
  private words: WordPlan[] = []
  private startedAt = Number.NaN
  private endedAt = Number.POSITIVE_INFINITY

  start(text: string, atTime: number, ratePerSecond = 1): void {
    const rate = ratePerSecond > 0 ? ratePerSecond : 1
    this.phones = []
    this.words = []
    this.startedAt = atTime
    this.endedAt = Number.POSITIVE_INFINITY
    // Uma despedida nova não herda o fade da anterior (senão a boca ficaria fechada "falando").
    this.timeline.fadeStart = Number.POSITIVE_INFINITY
    let cursor = 0
    let t = atTime
    for (const word of phonemizeText(text)) {
      if (word.phones.length === 0) continue
      const found = text.indexOf(word.text, cursor)
      const charStart = found >= 0 ? found : cursor
      cursor = charStart + word.text.length
      for (const token of word.phones) {
        const duration = token.durationPriorMs / 1000 / rate
        this.phones.push({ phone: token.phone, start: t, end: t + duration, stressed: token.stressed, nucleus: token.nucleus, wordIndex: token.wordIndex, source: "aligned", loudness: ASSUMED_LOUDNESS })
        t += duration
      }
      this.words.push({ charStart, wordIndex: word.phones[0]!.wordIndex, question: word.questionEnd })
      const pause = PAUSE_MS[word.pauseAfter] / 1000 / rate
      if (pause > 0) {
        this.phones.push({ phone: "_", start: t, end: t + pause, stressed: false, nucleus: false, wordIndex: -1, source: "aligned", loudness: 0 })
        t += pause
      }
    }
    this.rebuild()
  }

  boundary(charIndex: number, atTime: number): void {
    if (this.words.length === 0 || atTime >= this.endedAt) return
    let index = -1
    for (let w = 0; w < this.words.length; w++) if (this.words[w]!.charStart <= charIndex) index = w
    if (index < 0) return
    const wordIndex = this.words[index]!.wordIndex
    const first = this.phones.findIndex((phone) => phone.wordIndex === wordIndex)
    if (first < 0) return
    const shift = atTime - this.phones[first]!.start
    if (Math.abs(shift) < 0.005) return
    for (let i = first; i < this.phones.length; i++) {
      this.phones[i]!.start += shift
      this.phones[i]!.end += shift
    }
    // Emenda com o que veio antes: nada sobreposto; um buraco vira silêncio (a boca descansa).
    for (let i = first - 1; i >= 0; i--) {
      const phone = this.phones[i]!
      if (phone.start >= atTime) {
        phone.start = atTime
        phone.end = atTime
      } else {
        if (phone.end > atTime) phone.end = atTime
        break
      }
    }
    this.phones = this.phones.filter((phone) => phone.end > phone.start)
    this.rebuild()
  }

  end(atTime: number): void {
    this.close(atTime)
  }

  cancel(atTime: number): void {
    this.close(atTime)
  }

  isActive(time: number): boolean {
    return this.phones.length > 0 && time >= this.startedAt - 0.05 && time < this.endedAt + END_EASE_SECONDS
  }

  sample(time: number, out: SpeechFrame): void {
    if (!this.isActive(time)) {
      writeRest(out)
      return
    }
    this.timeline.sample(time, out.mouth)
    const index = this.timeline.indexAt(time)
    const speaking = index >= 0 && !this.timeline.isPause(index) && time < this.endedAt
    out.speaking = speaking
    out.energy = speaking ? ASSUMED_LOUDNESS : 0
    const question = this.questionAt(index)
    out.emphasis = this.emphasisAt(time)
    // Todo acento daqui é nuclear; a direção vem do texto (sem áudio não há F0).
    out.accentNuclear = out.emphasis > 0
    out.accentDirection = out.emphasis > 0 ? (question ? QUESTION_NUCLEAR_DIRECTION : DECLARATIVE_NUCLEAR_DIRECTION) : 0
    out.phraseTime = speaking ? time - this.phraseStart(index) : 0
    out.question = question
    out.debugPhone = index >= 0 ? this.timeline.phoneAt(index) : null
    out.debugSource = index >= 0 ? "aligned" : null
  }

  private close(atTime: number): void {
    if (atTime >= this.endedAt) return
    this.endedAt = atTime
    this.timeline.fadeStart = atTime
    this.timeline.fadeDuration = END_EASE_SECONDS
  }

  private rebuild(): void {
    this.accents = this.phones.map(() => false)
    let lastStressed = -1
    for (let i = 0; i <= this.phones.length; i++) {
      const phone = this.phones[i]
      if (i === this.phones.length || phone!.phone === "_") {
        if (lastStressed >= 0) this.accents[lastStressed] = true
        lastStressed = -1
      } else if (phone!.stressed && phone!.nucleus) lastStressed = i
    }
    const fadeStart = this.timeline.fadeStart
    this.timeline.clear()
    this.timeline.appendAll(this.phones)
    this.timeline.fadeStart = fadeStart
    this.timeline.fadeDuration = END_EASE_SECONDS
  }

  private emphasisAt(time: number): number {
    let best = 0
    for (let i = 0; i < this.phones.length; i++) {
      if (!this.accents[i]) continue
      const phone = this.phones[i]!
      const x = (time - (phone.start + phone.end) / 2) / EMPHASIS_WIDTH_SECONDS
      if (x < -4 || x > 4) continue
      best = Math.max(best, Math.exp(-x * x))
    }
    return time >= this.endedAt ? 0 : best
  }

  private phraseStart(index: number): number {
    for (let i = index - 1; i >= 0; i--) if (this.timeline.isPause(i)) return this.timeline.end[i]!
    return this.startedAt
  }

  private questionAt(index: number): boolean {
    if (index < 0) return false
    const wordIndex = this.timeline.wordIndex[index]
    // A pergunta vale para a oração inteira: procura a próxima palavra que fecha oração.
    const at = this.words.findIndex((plan) => plan.wordIndex === wordIndex)
    return at >= 0 && this.words[at]!.question
  }
}

function writeRest(out: SpeechFrame): void {
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

export function createTextTimedLipsync(): TextTimedLipsync {
  return new BrowserSpeechLipsync()
}
