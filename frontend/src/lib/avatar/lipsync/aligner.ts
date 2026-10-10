import { buildElements, leadingPause, type AlignmentElement } from "./alignment-elements"
import type { FeatureFrameStore } from "./audio-features"
import { audioOnlyEnd, audioOnlyPhones, segmentLoudness } from "./audio-only-phones"
import { WindowEmissions } from "./emission-model"
import { SegmentalViterbi, type HsmmEnd, type HsmmSegment } from "./hsmm"
import { HOP_SECONDS, type SpeechLandmarks } from "./speech-landmarks"
import type { AlignedPhone, G2PWord } from "./types"

/**
 * Alinhamento incremental texto × áudio SEM timestamps (o Gemini Live não manda nenhum).
 *
 * O texto diz QUAL articulação; o áudio diz QUANDO. Cada chunk é analisado assim que CHEGA
 * (`audio-features`: quadros de 10 ms no relógio do AudioContext) e o texto vira uma sequência de
 * elementos (`alignment-elements`: fones + pausas opcionais). Um Viterbi segmental (`hsmm.ts`)
 * casa os dois quadro a quadro, com modelo acústico por classe de fone (`emission-model.ts`) e
 * duração log-normal: silêncio de oclusiva, fricção e pausas puxam as fronteiras; a duração segura
 * o ritmo onde a acústica é ambígua.
 *
 * Streaming: a janela vai do último ponto CONSOLIDADO até a fronteira analisada. O prefixo em que
 * os melhores finais concordam (a pelo menos `MIN_LAG` da fronteira) é consolidado e nunca mais
 * muda; o resto é a cauda provisória, refeita a cada chunk/fragmento. O que vai ser OUVIDO logo
 * (`heardUntil` + folga) é consolidado de qualquer jeito — o avatar nunca vê um fone mudar depois
 * de tocado. Com a folga de geração do Gemini (≥ 0,9 s) isso quase nunca força nada.
 *
 * Texto atrasado em relação ao áudio RECEBIDO (o caso comum: o áudio chega até 39 s antes de tocar):
 * o enchimento (modelo de lixo, `hsmm.ts`) absorve a fala sem texto, e só o que não depende do texto
 * que falta é consolidado — as duas últimas palavras, a pausa antes delas e o último fone que está
 * soando ficam provisórios. Com o texto 0,25–1,5 s atrasado, o alinhamento da resposta longa fica
 * idêntico ao do texto em dia (`lipsync-metrics.ts --sweep`).
 *
 * Texto atrasado em relação ao áudio OUVIDO: o trecho vira fones "só áudio" (`audio-only-phones`) e
 * a fala coberta vira DÍVIDA; quando o texto chega, a retomada realinha o texto desde o começo da
 * fala do trecho só-áudio e retoma no elemento que soa na fronteira (`locateResume`); a dívida (pela
 * taxa de fala) só decide quando esse realinhamento não é possível.
 */

/** A consolidação por concordância fica pelo menos isto atrás da fronteira analisada (quadros). */
const MIN_LAG_FRAMES = 12
/** Com texto esgotado, o último trecho do texto conhecido fica provisório (quadros). */
const TEXT_TAIL_FRAMES = 45
/** Texto aberto: o fim do texto conhecido que fica provisório, em fala esperada (s). */
const TEXT_OPEN_PROTECTED_SECONDS = 1.2
/** ...quando o áudio recebido está a menos disto do instante ouvido (s). */
const TEXT_OPEN_NEAR_HEARD_SECONDS = 4
/** Folga antes do instante ouvido: o que cai antes disso não pode mais mudar. */
const HEARD_GUARD_SECONDS = 0.08
/**
 * Texto aberto: o FIM do último fone conhecido continua revisável até este tanto depois de ser
 * ouvido (o trecho seguinte é desenhado pela boca "ao vivo" do áudio, que nenhuma revisão desdiz).
 */
const TEXT_END_GRACE_SECONDS = 0.35
/** Fala sem texto no fim do turno: a boca solta até este tanto depois do último quadro com som. */
const TAIL_RELEASE_SECONDS = 0
/** ...contando como som o que está a menos disto do nível de fala (dB). */
const TAIL_SPEECH_FLOOR_DB = 20
/** ...e não passa deste tanto depois do último núcleo (consoante final + soltura). */
const MAX_RELEASE_AFTER_NUCLEUS_SECONDS = 0.25
/** No modo só-áudio, quanto além do instante ouvido é consolidado de uma vez. */
const AUDIO_ONLY_AHEAD_SECONDS = 0.25
/** Janela máxima (quadros) e elementos por janela. */
const MAX_WINDOW_FRAMES = 450
const MAX_WINDOW_ELEMENTS = 160
/** Finais candidatos para a concordância: até N, dentro deste feixe de escore. */
const CONVERGE_ENDS = 6
const CONVERGE_BEAM = 5
/**
 * Enchimento (texto ainda não chegou): margem por quadro abaixo da melhor classe. Calibrada nas
 * capturas: no alinhamento com o texto todo, a classe do fone alinhado fica em média 0,29 abaixo da
 * melhor classe do quadro (p75 0,31). Com 0,2 o enchimento ganha do texto CERTO (palavras somem);
 * com ≥ 1 volta a valer mais esticar o texto do que admitir que ele ainda não chegou.
 */
const FILLER_MARGIN = 0.6
/**
 * Texto encerrado: custo de entrada do enchimento final. A cauda de uma vogal decaindo fica com o
 * último fone (o enchimento ganharia dela por margem); fala sem transcrição de verdade (≥ ~0,3 s)
 * paga isso fácil — a alternativa é a pausa final por cima de fala (~4 por quadro).
 */
const FINAL_FILLER_ENTRY_COST = 12
/** Retomada depois de modo só-áudio: peso do desvio (log) entre texto pulado e fala coberta. */
const RESUME_WEIGHT = 3
const RESUME_MAX_SKIP = 40
/** Retomada pelo áudio: quadros que a janela precisa ver depois da fronteira consolidada. */
const RESUME_LOOKAHEAD_FRAMES = 20
/** Custo de começar um elemento antes/depois do que a retomada pelo áudio localizou. */
const RESUME_NEIGHBOR_COST = 2
/**
 * Trecho só-áudio mais longo que isto (quadros) com todo o texto conhecido já dito: o texto é
 * consumido até `RESUME_CONSUME_MARGIN_FRAMES` antes da fronteira, para a janela da retomada não
 * crescer sem limite. Antes disso a retomada ESPERA mais texto (realinhar desde o começo do trecho
 * com o texto todo acerta mais que consumir aos pedaços — o fim de cada pedaço é chute).
 */
const RESUME_CONSUME_AFTER_FRAMES = MAX_WINDOW_FRAMES - 150
const RESUME_CONSUME_MARGIN_FRAMES = 100
const RATE_MIN = 0.6
const RATE_MAX = 1.6
const INITIAL_RATE = 1

export type SpeechAlignerOptions = {
  /** Folga mínima (s) entre a consolidação e a fronteira analisada. */
  commitLagSeconds?: number
}

export class SpeechAligner {
  readonly committed: AlignedPhone[] = []
  provisional: AlignedPhone[] = []
  readonly elements: AlignmentElement[] = [leadingPause()]
  /** Taxa (s reais por s de priori) — média móvel sobre o que já foi consolidado. */
  rate = INITIAL_RATE
  textFinal = false
  audioFinal = false
  /** Maior instante sabidamente ouvido (ou prestes a ser): nada antes dele muda. */
  heardUntil = Number.NEGATIVE_INFINITY
  /** Fim do áudio já recebido (relógio do contexto). */
  receivedAudioUntil = Number.NEGATIVE_INFINITY
  realignCount = 0

  private readonly minLagFrames: number
  private readonly viterbi = new SegmentalViterbi()
  private readonly emissions = new WindowEmissions()
  /** Primeiro elemento e primeiro quadro ainda não consolidados. */
  private nextElement = 0
  private nextFrame = 0
  /** Segundos de fala cobertos em modo só-áudio que o texto ainda deve. */
  private textDebt = 0
  /** Quadro em que a FALA do trecho só-áudio atual começou (−1: não há trecho só-áudio). */
  private audioOnlySpeechFrame = -1
  /** O início da janela atual foi fixado pela retomada pelo áudio (consolidar qualquer coisa a encerra). */
  private resumeLocated = false
  /**
   * Cauda provisória do último passo (segmentos na base de `nextFrame`): é o que `commitHeard`
   * consolida, sem refazer o Viterbi, quando o instante ouvido passa por ela antes de chegar
   * informação nova. `pendingStraddles`: o primeiro é o último fone do texto conhecido, já soando.
   */
  private pending: HsmmSegment[] = []
  private pendingFillerFrom = -1
  private pendingTextOpen = false
  private rateNum = 0
  private rateDen = 0
  private done = false
  private startCosts = new Float64Array(RESUME_MAX_SKIP + 1)

  constructor(
    private readonly store: FeatureFrameStore,
    private readonly landmarks: SpeechLandmarks,
    options: SpeechAlignerOptions = {},
  ) {
    this.minLagFrames = options.commitLagSeconds !== undefined ? Math.round(options.commitLagSeconds / HOP_SECONDS) : MIN_LAG_FRAMES
  }

  reset(): void {
    this.committed.length = 0
    this.clearPending()
    this.elements.length = 0
    this.elements.push(leadingPause())
    this.rate = INITIAL_RATE
    this.textFinal = false
    this.audioFinal = false
    this.heardUntil = Number.NEGATIVE_INFINITY
    this.receivedAudioUntil = Number.NEGATIVE_INFINITY
    this.nextElement = 0
    this.nextFrame = 0
    this.textDebt = 0
    this.audioOnlySpeechFrame = -1
    this.resumeLocated = false
    this.rateNum = 0
    this.rateDen = 0
    this.done = false
    this.realignCount = 0
  }

  addWords(words: readonly G2PWord[]): void {
    buildElements(words, this.elements)
  }

  noteHeard(time: number): void {
    if (time > this.heardUntil) this.heardUntil = time
  }

  get alignedUntil(): number {
    const last = this.committed[this.committed.length - 1]
    return last ? last.end : Number.NEGATIVE_INFINITY
  }

  get coverageEnd(): number {
    const last = this.provisional[this.provisional.length - 1] ?? this.committed[this.committed.length - 1]
    return last ? last.end : Number.NEGATIVE_INFINITY
  }

  /** Palavras do texto recebido que ainda não foram consolidadas. */
  get pendingWords(): number {
    let count = 0
    let lastWord = -1
    for (let k = this.nextElement; k < this.elements.length; k++) {
      const word = this.elements[k].wordIndex
      if (word >= 0 && word !== lastWord) {
        count++
        lastWord = word
      }
    }
    return count
  }

  get isDone(): boolean {
    return this.done
  }

  /** Interrupção: nada depois de `atTime` é dito. Corta os fones e para de alinhar. */
  truncate(atTime: number): void {
    const all: AlignedPhone[] = []
    for (const phone of [...this.committed, ...this.provisional]) {
      if (phone.start >= atTime) break
      all.push(phone.end > atTime ? { ...phone, end: atTime } : phone)
    }
    this.committed.length = 0
    this.committed.push(...all)
    this.clearPending()
    this.done = true
  }

  /**
   * O instante ouvido avançou e vai chegar informação nova (áudio, texto, fim do texto): consolida,
   * com o caminho do ÚLTIMO passo, o que já começou a tocar. Sem isso, um fone provisório que tocou
   * entre dois realinhamentos podia mudar quando o texto chegasse — o ouvido seria reescrito.
   * Só a informação nova muda o caminho; o tempo passando, não — então não há Viterbi aqui.
   */
  commitHeard(): boolean {
    if (this.done || this.pending.length === 0) return false
    const heardFrame = this.store.lowerBound(this.heardUntil + HEARD_GUARD_SECONDS) - this.nextFrame
    const pending = this.pending
    let count = 0
    const open = this.pendingTextOpen && this.pendingFillerFrom >= 0
    const lastText = open ? lastSpokenSegment(pending, this.elements) : -1
    while (count < pending.length && pending[count].start < heardFrame) {
      if (open && holdsTextBoundary(pending[count], count, lastText, heardFrame)) break
      count++
    }
    if (count === 0) return false
    const shift = pending[count - 1].end
    const fillerFrom = this.pendingFillerFrom
    this.commitSegments(pending, count)
    this.setPending(pending.slice(count), shift, fillerFrom, this.pendingTextOpen)
    return true
  }

  /** Realinha a cauda não consolidada. Devolve true se algo mudou. */
  update(): boolean {
    if (this.done) return false
    this.realignCount++
    let changed = false
    for (let round = 0; round < 256; round++) {
      const beforeFrame = this.nextFrame
      const beforeElement = this.nextElement
      const progressed = this.step()
      changed = changed || progressed
      if (this.done || (this.nextFrame === beforeFrame && this.nextElement === beforeElement)) break
    }
    return changed
  }

  // -------------------------------------------------------------------------

  private step(): boolean {
    const store = this.store
    const available = store.count - this.nextFrame
    if (available <= 0 || Number.isNaN(this.landmarks.firstSpeechTime)) return this.closeIfFinished()
    let startCosts: Float64Array | null = null
    this.resumeLocated = false
    // A retomada já aconteceu se o fone em que ela começou já está tocando (ficou provisório por ser o
    // último do texto conhecido): refazê-la poderia trocar um fone ouvido. O que ela pulou foi dito no
    // só-áudio — consumido aqui.
    const head = this.pending[0]
    if (this.textDebt > 0 && head && !head.skipped && head.start === 0 && this.frameTime(this.nextFrame) < this.heardUntil) {
      this.nextElement = head.element
      this.textDebt = 0
      this.audioOnlySpeechFrame = -1
    }
    if (this.textDebt > 0) {
      const resume = this.locateResume()
      if (resume === "consumed" || resume === "wait") this.clearPending()
      if (resume === "consumed") return true
      if (resume === "wait") return this.commitAudioOnlyUntilHeard()
      startCosts = resume
      this.resumeLocated = resume !== null
    }
    const W = Math.min(available, MAX_WINDOW_FRAMES)
    const audioClosed = this.audioFinal && W === available
    const firstElement = this.nextElement
    const K = this.windowElements(W)
    const textExhausted = firstElement + K === this.elements.length
    if (K === 0) {
      this.clearPending()
      if (this.textFinal) return this.commitUntranscribedTail(audioClosed)
      return this.commitAudioOnlyUntilHeard()
    }
    this.emissions.compute(store, this.nextFrame, W, this.landmarks.speechLevelDb)
    // Sem retomada localizada (ou o ponto localizado não cabe nesta janela): retomada pela dívida.
    if (this.textDebt > 0 && (startCosts === null || !hasFiniteStart(startCosts, K))) {
      startCosts = this.resumeCosts(K)
      this.resumeLocated = false
    }
    const ends = this.viterbi.run({
      elements: this.elements,
      firstElement,
      elementCount: K,
      emissions: this.emissions,
      rate: this.rate,
      startCosts,
      openEnd: !audioClosed,
      // Também com o texto encerrado: a transcrição do Live às vezes para antes da fala (ver
      // `commitUntranscribedTail`) — a fala que sobra é enchimento, não um texto esticado por cima dela.
      filler: textExhausted,
      fillerMargin: FILLER_MARGIN,
      fillerEntryCost: this.textFinal ? FINAL_FILLER_ENTRY_COST : 0,
      firstHeldFrames: startCosts === null ? this.heldFrames() : 0,
    })
    if (ends.length === 0) {
      // Nada cabe (não deveria acontecer): consolida o que falta como só-áudio para não travar.
      this.clearPending()
      return this.commitAudioOnlyUntilHeard()
    }
    const best = this.viterbi.backtrack(ends[0])
    const closed = audioClosed && this.textFinal && textExhausted && ends[0].kind === "complete"
    if (closed) {
      this.commitSegments(best, best.length)
      this.clearPending()
      this.done = true
      return true
    }
    if (audioClosed && this.textFinal && textExhausted && ends[0].kind === "filler") {
      // Texto todo dito antes do fim do áudio: consolida e o resto (próximo passo) vira só-áudio.
      this.commitSegments(best, best.length)
      this.clearPending()
      return true
    }
    // Texto esgotado e turno aberto: o áudio recebido costuma ir além da última palavra conhecida
    // (o áudio chega em rajadas maiores que os fragmentos de texto) e o melhor caminho ESTICA o fim
    // do texto para cobrir essa fala. Consolidar por concordância nessa hora trava o erro ("juntos"
    // com 0,7 s e "de fevereiro" sem espaço no fim da frase — capturas de 2026-09-24). Como o texto
    // chega bem antes de o áudio ser ouvido, basta consolidar só o que está prestes a tocar.
    const textOpen = textExhausted && !this.textFinal
    const count = this.committablePrefix(ends, best, W, textOpen)
    const committedSomething = count > 0
    const shift = committedSomething ? best[count - 1].end : 0
    if (committedSomething) this.commitSegments(best, count)
    this.setPending(best.slice(count), shift, ends[0].kind === "filler" ? ends[0].from : -1, textOpen)
    const fillerFrom = this.pendingFillerFrom
    let changed = committedSomething
    // Texto atrasado: o que vai tocar além da cobertura do texto vira só-áudio. A pausa (pulada)
    // entre o último fone conhecido e o enchimento NÃO é consolidada — ela pertence à fronteira com o
    // texto que ainda vem ("feedback?" + pausa + "Vamos": consolidar a pausa pulada colava "Vamos" no
    // fim de "feedback").
    if (fillerFrom >= 0 && count > lastSpokenSegment(best, this.elements)) {
      const fillerStart = this.frameTime(this.nextFrame)
      if (this.heardUntil + HEARD_GUARD_SECONDS > fillerStart) changed = this.commitAudioOnlyUntilHeard() || changed
    }
    return changed
  }

  /**
   * O primeiro elemento da janela é um fone provisório que já começou a tocar (o último do texto
   * conhecido, mantido aberto): quantos quadros dele já foram desenhados — ele continua presente e
   * não encolhe para antes disso (0 se não é o caso).
   */
  private heldFrames(): number {
    const head = this.pending[0]
    if (!head || head.skipped || head.start !== 0 || head.element !== this.nextElement) return 0
    const start = this.frameTime(this.nextFrame)
    const shownUntil = Math.min(this.frameTime(this.nextFrame + head.end), this.heardUntil)
    return shownUntil > start ? Math.max(1, Math.ceil((shownUntil - start) / HOP_SECONDS - 1e-6)) : 0
  }

  /** Cauda provisória: segmentos que o último passo não consolidou, rebaseados em `nextFrame`. */
  private setPending(rest: HsmmSegment[], shift: number, fillerFrom: number, textOpen: boolean): void {
    this.pending = shift === 0 ? rest : rest.map((segment) => ({ ...segment, start: segment.start - shift, end: segment.end - shift }))
    this.pendingFillerFrom = fillerFrom >= 0 ? fillerFrom - shift : -1
    this.pendingTextOpen = textOpen
    this.provisional = this.toPhones(this.pending, this.pendingFillerFrom)
  }

  private clearPending(): void {
    this.pending = []
    this.pendingFillerFrom = -1
    this.pendingTextOpen = false
    this.provisional = []
  }

  /**
   * Quantos elementos entram na janela: até onde um caminho poderia chegar em `W` quadros mesmo
   * falando rápido (metade da duração esperada), com teto.
   */
  private windowElements(W: number): number {
    const elements = this.elements
    let k = this.nextElement
    let reach = 0
    const limit = W * 2.2 + 30
    while (k < elements.length && k - this.nextElement < MAX_WINDOW_ELEMENTS) {
      const element = elements[k]
      if (!element.optional) reach += (element.expectedMs * this.rate) / 10
      if (reach > limit) break
      k++
    }
    return k - this.nextElement
  }

  /**
   * Retomada pelo ÁUDIO depois de um trecho só-áudio: o texto que chegou é alinhado desde o começo
   * da fala que tocou sem ele — é esse áudio que diz quanto do texto já foi dito. O elemento que
   * ainda soa na fronteira consolidada é onde o texto retoma (custos de início que o fixam, com
   * folga de um elemento para cada lado). Se TODO o texto conhecido ficou antes da fronteira, ele já
   * foi dito: o trecho continua só-áudio ("wait") e a próxima retomada realinha desde o mesmo começo
   * com mais texto — só um trecho longo demais consome o texto ("consumed").
   *
   * Por que não só a "dívida" (fala coberta × duração esperada do texto): ela erra quando o texto
   * conhecido é curto perto da fala que já passou — sobravam fones de palavras ditas há meio segundo
   * para "encaixar" no áudio novo (frase-03 com o texto 1,5 s atrasado).
   */
  private locateResume(): Float64Array | "consumed" | "wait" | null {
    const store = this.store
    const from = this.audioOnlySpeechFrame
    const boundary = this.nextFrame - from
    if (from < 0 || boundary <= 0) return null
    const available = store.count - from
    const W = Math.min(available, MAX_WINDOW_FRAMES)
    if (W - boundary < RESUME_LOOKAHEAD_FRAMES) return null
    const firstElement = this.nextElement
    const K = this.windowElements(W)
    if (K === 0) return null
    const textExhausted = firstElement + K === this.elements.length
    this.emissions.compute(store, from, W, this.landmarks.speechLevelDb)
    const ends = this.viterbi.run({
      elements: this.elements,
      firstElement,
      elementCount: K,
      emissions: this.emissions,
      rate: this.rate,
      startCosts: null,
      openEnd: !(this.audioFinal && W === available),
      filler: textExhausted,
      fillerEntryCost: this.textFinal ? FINAL_FILLER_ENTRY_COST : 0,
      fillerMargin: FILLER_MARGIN,
    })
    if (ends.length === 0) return null
    const path = this.viterbi.backtrack(ends[0])
    let resumeAt = -1
    for (const segment of path) {
      if (segment.skipped || segment.end <= boundary) continue
      // Já soou mais da metade dele no só-áudio: retoma no seguinte.
      resumeAt = !segment.partial && boundary - segment.start > segment.end - boundary ? segment.element + 1 : segment.element
      break
    }
    if (resumeAt < 0) {
      if (ends[0].kind !== "filler" || ends[0].from > boundary) return null
      // Todo o texto conhecido já foi dito. Texto encerrado: nada mais vai chegar — consome tudo e o
      // resto do áudio vira só-áudio (`commitUntranscribedTail`).
      if (this.textFinal) {
        this.nextElement = this.elements.length
        this.textDebt = 0
        this.audioOnlySpeechFrame = -1
        return "consumed"
      }
      // Texto aberto: o só-áudio continua e a próxima retomada realinha desde o mesmo começo com mais
      // texto. Trecho longo demais: consome o que acabou bem antes da fronteira (até o último fone — a
      // pausa depois dele fica, para o próximo trecho poder começar em silêncio).
      if (boundary < RESUME_CONSUME_AFTER_FRAMES) return "wait"
      let last = -1
      let lastEnd = 0
      for (const segment of path) {
        if (segment.skipped || this.elements[segment.element].phone === "_" || segment.end > boundary - RESUME_CONSUME_MARGIN_FRAMES) continue
        last = segment.element
        lastEnd = segment.end
      }
      if (last < firstElement) return "wait"
      this.nextElement = last + 1
      this.audioOnlySpeechFrame = from + lastEnd
      this.textDebt = Math.max(0.01, this.audioOnlySpeechSince(this.frameTime(this.audioOnlySpeechFrame)))
      return "consumed"
    }
    const costs = this.startCosts
    costs.fill(Number.POSITIVE_INFINITY)
    const skip = resumeAt - firstElement
    for (const [s, cost] of [[skip, 0], [skip - 1, RESUME_NEIGHBOR_COST], [skip + 1, RESUME_NEIGHBOR_COST]] as const) {
      if (s >= 0 && s < costs.length) costs[s] = cost
    }
    return costs
  }

  /** Segundos de fala (fones só-áudio que não são pausa) consolidados a partir de `time`. */
  private audioOnlySpeechSince(time: number): number {
    let speech = 0
    for (let k = this.committed.length - 1; k >= 0; k--) {
      const phone = this.committed[k]
      if (phone.end <= time || phone.source !== "audio-only") break
      if (phone.phone !== "_") speech += phone.end - Math.max(phone.start, time)
    }
    return speech
  }

  /**
   * Custo de retomar o texto pulando `s` elementos depois de um trecho só-áudio: a fala esperada
   * dos pulados deve bater com a dívida (log da razão), e retomar no meio da palavra custa mais.
   */
  private resumeCosts(K: number): Float64Array {
    const costs = this.startCosts
    costs.fill(Number.POSITIVE_INFINITY)
    const debt = this.textDebt
    let skipped = 0
    for (let s = 0; s <= Math.min(K - 1, RESUME_MAX_SKIP); s++) {
      const element = this.elements[this.nextElement + s]
      const ratio = (skipped + 0.08) / (debt + 0.08)
      const midWord = element.phone !== "_" && !element.wordStart ? 1.5 : 0
      costs[s] = RESUME_WEIGHT * Math.abs(Math.log(ratio)) + midWord
      if (element.phone !== "_") skipped += (element.expectedMs * this.rate) / 1000
    }
    return costs
  }

  /**
   * Prefixo consolidável do melhor caminho: segmentos em que os melhores finais concordam, longe da
   * fronteira; mais tudo o que começa antes do instante ouvido (+ folga), concordando ou não.
   */
  private committablePrefix(ends: HsmmEnd[], best: HsmmSegment[], W: number, textOpen: boolean): number {
    let agreed = best.length
    const top = ends[0].score
    for (let e = 1; e < ends.length && e < CONVERGE_ENDS; e++) {
      if (ends[e].score < top - CONVERGE_BEAM) break
      const other = this.viterbi.backtrack(ends[e])
      let k = 0
      while (k < agreed && k < other.length && sameSegment(best[k], other[k])) k++
      agreed = k
    }
    // Com o texto esgotado (enchimento no fim), o fim do texto conhecido ainda pode mudar quando o
    // próximo fragmento chegar: a consolidação para `TEXT_TAIL_FRAMES` antes do enchimento.
    const limit = ends[0].kind === "filler" ? Math.min(W - this.minLagFrames, ends[0].from - TEXT_TAIL_FRAMES) : W - this.minLagFrames
    // Texto aberto: as duas últimas palavras conhecidas ficam provisórias (são as que o melhor
    // caminho estica para cobrir fala cujo texto ainda não chegou). A pausa ENTRE palavras pertence à
    // palavra seguinte: consolidar a pausa antes de uma palavra provisória fixaria o começo dela (era
    // o que puxava "aqui" 350 ms para frente com o texto 0,5 s atrasado na resposta longa).
    const lastWord = textOpen ? this.lastKnownWord() : Number.POSITIVE_INFINITY
    // Mais que duas palavras quando elas são curtas: o fim do texto conhecido protegido cobre pelo menos
    // `TEXT_OPEN_PROTECTED_SECONDS` de fala esperada — o caminho pode encaixar a última palavra por cima
    // da fala da PRÓXIMA ("feedback?" sobre "Vamos ver" na voz Kore) e o esticão chega a "passar um".
    // Só perto do instante ouvido: com o áudio recebido muito à frente (resposta longa, até 39 s), um
    // erro ali ainda tem tempo de ser refeito, e realinhar uma cauda maior a cada chunk triplicava a CPU.
    const nearHeard = this.frameTime(this.nextFrame + W) - this.heardUntil < TEXT_OPEN_NEAR_HEARD_SECONDS
    const protectedWord = textOpen ? Math.min(lastWord - 1, nearHeard ? this.protectedTailWord() : Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY
    let count = 0
    while (count < agreed && !best[count].partial && best[count].end <= limit && this.wordOfElement(best[count].element) < protectedWord) count++
    // Nunca termina a consolidação num elemento pulado seguido de nada: tudo bem, é só índice.
    const heardFrame = this.store.lowerBound(this.heardUntil + HEARD_GUARD_SECONDS) - this.nextFrame
    const open = textOpen && ends[0].kind === "filler"
    const lastText = open ? lastSpokenSegment(best, this.elements) : -1
    while (count < best.length && best[count].start < heardFrame) {
      // O último fone do texto conhecido, ainda soando, logo antes do enchimento: o COMEÇO dele já
      // está fixo (é o início da janela), mas o FIM depende do texto que vai chegar — consolidar
      // agora cravaria o fim que o enchimento escolheu e empurraria a palavra seguinte para trás
      // ("às" 200 ms antes da hora, com o texto atrasado e em rajadas).
      if (open && holdsTextBoundary(best[count], count, lastText, heardFrame)) break
      count++
    }
    return count
  }

  /** Primeira palavra do fim protegido do texto conhecido (`TEXT_OPEN_PROTECTED_SECONDS` de fala esperada). */
  private protectedTailWord(): number {
    let speech = 0
    for (let k = this.elements.length - 1; k >= this.nextElement; k--) {
      const element = this.elements[k]
      if (element.phone === "_") continue
      speech += (element.expectedMs * this.rate) / 1000
      if (speech >= TEXT_OPEN_PROTECTED_SECONDS) return element.wordIndex
    }
    return Number.NEGATIVE_INFINITY
  }

  /** Palavra do elemento; pausa conta como da palavra SEGUINTE (∞ se ainda não chegou). */
  private wordOfElement(index: number): number {
    for (let k = index; k < this.elements.length; k++) if (this.elements[k].wordIndex >= 0) return this.elements[k].wordIndex
    return Number.POSITIVE_INFINITY
  }

  private lastKnownWord(): number {
    for (let k = this.elements.length - 1; k >= 0; k--) if (this.elements[k].wordIndex >= 0) return this.elements[k].wordIndex
    return Number.POSITIVE_INFINITY
  }

  private commitSegments(segments: HsmmSegment[], count: number): void {
    const phones = this.toPhones(segments.slice(0, count), -1)
    let lastElement = this.nextElement - 1
    let lastEnd = 0
    for (let k = 0; k < count; k++) {
      lastElement = segments[k].element
      lastEnd = segments[k].end
    }
    this.updateRate(segments, count)
    this.committed.push(...phones)
    this.nextElement = lastElement + 1
    this.nextFrame += lastEnd
    // Retomada pelo áudio: o primeiro elemento consolidado já é o ponto certo (mesmo uma pausa).
    // Pela dívida: só um fone de verdade confirma que o texto voltou a andar junto com o áudio.
    if (this.textDebt > 0 && (this.resumeLocated || phones.some((phone) => phone.phone !== "_"))) {
      this.textDebt = 0
      this.audioOnlySpeechFrame = -1
    }
  }

  /** Segmentos (quadros locais da janela atual) → fones no relógio do contexto. */
  private toPhones(segments: HsmmSegment[], fillerFrom: number): AlignedPhone[] {
    const out: AlignedPhone[] = []
    const level = this.landmarks.speechLevelDb
    for (const segment of segments) {
      if (segment.skipped || segment.end <= segment.start) continue
      if (fillerFrom >= 0 && segment.start >= fillerFrom) break
      const element = this.elements[segment.element]
      const start = this.frameTime(this.nextFrame + segment.start)
      const end = this.frameTime(this.nextFrame + segment.end)
      out.push({
        phone: element.phone,
        start,
        end,
        stressed: element.stressed,
        nucleus: element.nucleus,
        wordIndex: element.wordIndex,
        source: "aligned",
        loudness: element.phone === "_" ? 0 : segmentLoudness(this.store, level, start, end),
      })
    }
    return out
  }

  /** Fronteira antes do quadro `f` (quadros centrados: meio salto antes do centro). */
  private frameTime(f: number): number {
    const store = this.store
    if (f < store.count) return store.time[f] - HOP_SECONDS / 2
    return store.time[store.count - 1] + HOP_SECONDS / 2 + (f - store.count) * HOP_SECONDS
  }

  private updateRate(segments: HsmmSegment[], count: number): void {
    let actual = 0
    let prior = 0
    for (let k = 0; k < count; k++) {
      const segment = segments[k]
      const element = this.elements[segment.element]
      if (segment.skipped || element.phone === "_") continue
      actual += (segment.end - segment.start) * HOP_SECONDS
      prior += element.expectedMs / 1000
    }
    if (prior <= 0 || actual <= 0) return
    // Média móvel exponencial ponderada pela duração (~ últimos 5 s de fala), com priori 1.
    const decay = Math.exp(-actual / 5)
    this.rateNum = this.rateNum * decay + actual
    this.rateDen = this.rateDen * decay + prior
    const blended = (this.rateNum + INITIAL_RATE * 1.5) / (this.rateDen + 1.5)
    this.rate = Math.max(RATE_MIN, Math.min(RATE_MAX, blended))
  }

  /** Sem texto para alinhar: o que vai tocar logo vira fones só-áudio (a fala coberta vira dívida). */
  private commitAudioOnlyUntilHeard(): boolean {
    const store = this.store
    if (store.count <= this.nextFrame) return false
    const from = this.frameTime(this.nextFrame)
    const until = this.heardUntil + HEARD_GUARD_SECONDS + AUDIO_ONLY_AHEAD_SECONDS
    if (until <= from) return false
    const to = audioOnlyEnd(store, this.landmarks, from, until)
    const endFrame = Math.min(store.count, store.lowerBound(to))
    if (endFrame <= this.nextFrame) return false
    const end = this.frameTime(endFrame)
    // A cauda provisória era relativa ao começo deste trecho: deixa de valer.
    this.clearPending()
    const phones = audioOnlyPhones(store, this.landmarks, from, end)
    let speech = 0
    for (const phone of phones) if (phone.phone !== "_") speech += phone.end - phone.start
    this.committed.push(...phones)
    this.textDebt += speech
    if (this.audioOnlySpeechFrame < 0) {
      const first = phones.find((phone) => phone.phone !== "_")
      if (first) this.audioOnlySpeechFrame = Math.min(store.lowerBound(first.start), endFrame)
    }
    this.nextFrame = endFrame
    // Pula a pausa inicial opcional: o turno já começou.
    if (this.nextElement === 0 && speech > 0) this.nextElement = 1
    return true
  }

  /**
   * Texto todo consolidado e encerrado: o resto do áudio recebido vira só-áudio — o silêncio final é
   * pausa, mas fala cuja transcrição o Live não mandou continua mexendo a boca. Acontece: em
   * 2026-10-07, 3 de 13 frases curtas vieram com a transcrição parada no meio ("Amanhã, às" numa fala
   * de 4,6 s) ou sem um trecho do meio; antes, a boca ficava fechada 1–2,5 s com a fala tocando.
   */
  private commitUntranscribedTail(audioClosed: boolean): boolean {
    const store = this.store
    if (store.count <= this.nextFrame) return this.closeIfFinished()
    const from = this.frameTime(this.nextFrame)
    const end = this.frameTime(store.count)
    // Fala = há núcleo silábico depois do último fone; respiração e ruído no fim do turno não abrem a boca.
    const nuclei = this.landmarks.nuclei
    const lastNucleus = nuclei.length > 0 ? nuclei[nuclei.length - 1].time : Number.NEGATIVE_INFINITY
    // O fim da fala é onde a energia cai bem abaixo do nível de fala (não o piso de ruído): a boca
    // começa a fechar junto com o som, não 100 ms depois.
    const speechFloor = this.landmarks.speechLevelDb - TAIL_SPEECH_FLOOR_DB
    let lastSpeech = -1
    if (lastNucleus >= from) {
      for (let f = store.count - 1; f >= this.nextFrame; f--) {
        if (store.energyDb[f] >= speechFloor && store.time[f] <= lastNucleus + MAX_RELEASE_AFTER_NUCLEUS_SECONDS) {
          lastSpeech = f
          break
        }
      }
    }
    this.clearPending()
    const speechEnd = lastSpeech < 0 ? from : Math.min(end, this.frameTime(lastSpeech + 1) + TAIL_RELEASE_SECONDS)
    const phones = speechEnd > from ? audioOnlyPhones(store, this.landmarks, from, speechEnd) : []
    const tailStart = phones.length > 0 ? phones[phones.length - 1].end : from
    if (end > tailStart) phones.push({ phone: "_", start: tailStart, end, stressed: false, nucleus: false, wordIndex: -1, source: phones.length > 0 ? "audio-only" : "aligned", loudness: 0 })
    this.committed.push(...phones)
    this.nextFrame = store.count
    if (audioClosed) this.done = true
    return true
  }

  /** Texto e áudio encerrados sem nada a alinhar: fim do turno (o que sobrou de texto não soou). */
  private closeIfFinished(): boolean {
    if (this.textFinal && this.audioFinal && !this.done) {
      this.clearPending()
      this.done = true
      return true
    }
    return false
  }
}

/**
 * Texto aberto, caminho terminando no enchimento: a consolidação forçada (o que está para tocar) para
 * no último fone falado se ele ainda soa ou foi ouvido há menos de `TEXT_END_GRACE_SECONDS` (o FIM
 * dele depende do texto que vem) e nunca inclui o que vem depois dele — pausas e pulados antes do
 * enchimento são a fronteira com o texto que ainda não chegou.
 */
function holdsTextBoundary(segment: HsmmSegment, index: number, lastText: number, heardFrame: number): boolean {
  if (index > lastText) return true
  return index === lastText && segment.end > heardFrame - TEXT_END_GRACE_SECONDS / HOP_SECONDS
}

/** Índice do último segmento que é fone de verdade (nem pulado, nem pausa); −1 se não há. */
function lastSpokenSegment(segments: readonly HsmmSegment[], elements: readonly AlignmentElement[]): number {
  for (let k = segments.length - 1; k >= 0; k--) if (!segments[k].skipped && elements[segments[k].element].phone !== "_") return k
  return -1
}

function hasFiniteStart(costs: Float64Array, K: number): boolean {
  for (let s = 0; s < K && s < costs.length; s++) if (Number.isFinite(costs[s])) return true
  return false
}

function sameSegment(a: HsmmSegment, b: HsmmSegment): boolean {
  return a.element === b.element && a.start === b.start && a.end === b.end && a.skipped === b.skipped && a.partial === b.partial
}
