import { SpeechAligner } from "./aligner"
import { MAX_JAW } from "./articulation"
import { AudioFeatureExtractor } from "./audio-features"
import { audioOnlyPhones } from "./audio-only-phones"
import { MouthTimeline } from "./coarticulation"
import { PROMINENCE_LOOKAHEAD_SECONDS, ProsodyTracker } from "./prosody"
import { createTranscriptPhonemizer } from "./pt-br/g2p"
import { HOP_SECONDS, SpeechLandmarks } from "./speech-landmarks"
import type {
  G2PWord,
  LipsyncDebugSnapshot,
  MouthChannels,
  ScheduledAudioChunk,
  SpeechFrame,
  SpeechLipsyncEngine,
  TranscriptFragment,
  TranscriptPhonemizer,
} from "./types"
import { REST_MOUTH } from "./types"

/**
 * Motor de lip-sync de um turno do Gemini Live: áudio agendado + fragmentos de transcrição →
 * pose da boca no instante OUVIDO.
 *
 * Fluxo: cada chunk é analisado assim que chega (`audio-features`), os marcos de fala são
 * atualizados (`SpeechLandmarks`), o texto vira fones pelo G2P incremental e o alinhador casa um
 * com o outro (`SpeechAligner`). A linha do tempo da boca (`MouthTimeline`) recebe o que foi
 * consolidado + a cauda provisória; `sample()` só lê typed arrays — nada de estado do React, nada
 * de alocação por quadro.
 *
 * Turnos: `beginTurn` descarta tudo do turno anterior (a mesma instância é reaproveitada, sem
 * lixo para o GC). Pacotes de outro turno são ignorados — inclusive os da geração ANTIGA que o
 * Live ainda entrega entre o `activityStart` e o `interrupted` (verificado em 2026-09-24). Um
 * turnId maior que o atual abre um turno novo sozinho (defensivo: o `beginTurn` pode ter se perdido).
 *
 * Interrupção: os fones são cortados em `atTime`, a boca volta ao repouso em ~100 ms e nada mais
 * do turno é aceito.
 *
 * Ênfase (`SpeechFrame.emphasis`, aceno de cabeça e sobrancelha): pulso só nos ACENTOS DE FRASE —
 * tônica com a maior excursão de F0 num raio de `ACCENT_RIVAL_SECONDS` (`prosody.ts`), mais o
 * acento nuclear do fim de cada frase —, não em toda tônica (≈ 0,7–1,2/s nas capturas, contra
 * 1,5–2,8/s quando toda tônica pulsava). Junto do pulso vão a DIREÇÃO do F0 desse acento
 * (`accentDirection`: subida/queda/pico, `prosody.ts › direction`) e se ele é o nuclear
 * (`accentNuclear`) — a cabeça acena para baixo na queda e no nuclear, levanta e ergue a
 * sobrancelha na subida, e a piscada procura o fim da frase.
 */

export type SpeechLipsyncEngineOptions = {
  /** Fábrica do G2P incremental (padrão: PT-BR por regras). */
  phonemizerFactory?: () => TranscriptPhonemizer
  /**
   * Antecipação da boca em relação ao áudio ouvido (s). Lábios naturalmente adiantam o som, e a
   * detectabilidade é assimétrica (ITU-R BT.1359: boca adiantada incomoda menos que atrasada).
   */
  anticipationSeconds?: number
  /** Quanto atrás da fronteira analisada o alinhamento é consolidado (s). */
  commitLagSeconds?: number
  /** Fade de volta ao repouso na interrupção (s). */
  interruptEaseSeconds?: number
}

const DEFAULT_ANTICIPATION_SECONDS = 0.02
const DEFAULT_INTERRUPT_EASE_SECONDS = 0.1
/** Novo realinhamento depois de tantos quadros novos (10 ms cada) sem marco novo. */
const REALIGN_EVERY_FRAMES = 8
/** Pausa a partir da qual `speaking` é falso e a frase recomeça. */
const LONG_PAUSE_SECONDS = 0.25
const PHRASE_PAUSE_SECONDS = 0.15
/** Janela de busca dos núcleos tônicos para o pulso de ênfase (s) e largura do pulso. */
const EMPHASIS_WINDOW_SECONDS = 0.25
const EMPHASIS_WIDTH_SECONDS = 0.07
/** Proeminência tonal mínima (semitons) de um acento; o nuclear (fim de frase) pede menos. */
const ACCENT_MIN_SEMITONES = 3.5
const NUCLEAR_ACCENT_MIN_SEMITONES = 2
/** Uma tônica só é acento se nenhuma rival mais proeminente estiver a menos disso (s). */
const ACCENT_RIVAL_SECONDS = 0.5
/**
 * Núcleo só-áudio "parece tônica" (sem texto a tônica é desconhecida): ln(duração ÷ mediana dos até
 * dois núcleos vizinhos de cada lado) + (loudness − a maior das duas adjacentes) × 30 dB ÷ 6 ≥ isto.
 * Calibrado nas 14 capturas com texto completo lidas SEM o texto (o alinhamento diz qual é a tônica):
 * escolhe 40% dos núcleos (as tônicas são 40%), 68% deles tônicos — sem o filtro, só 50% dos acentos
 * sem texto caíam em tônica e havia 20% mais acentos que com o texto.
 */
const STRESS_LIKE_THRESHOLD = -0.1
const STRESS_LOUDNESS_DB_SCALE = 30 / 6
/** `nextNucleusInPhrase`: a frase acaba antes do próximo núcleo / a linha do tempo ainda não diz. */
const NO_NUCLEUS = -1
const UNKNOWN_NUCLEUS = -2
/** Proeminência que dá o pulso cheio (semitons). */
const ACCENT_FULL_SEMITONES = 8
/** Tônica é a última da frase se uma pausa ≥ isto (s) vem antes da próxima tônica... */
const PHRASE_BREAK_SECONDS = 0.15
/** ...dentro desta distância (s). */
const PHRASE_FINAL_REACH_SECONDS = 0.45
const ENERGY_HALF_WINDOW_SECONDS = 0.03
/**
 * Prévia só-áudio: além do que o alinhador cobre, a linha do tempo de EXIBIÇÃO ganha fones só-áudio
 * até este tanto depois do instante ouvido (ou até o áudio analisado). Refeita a cada sincronização,
 * então precisa durar até a próxima: o Live às vezes para de mandar áudio por alguns segundos com a
 * fala ainda tocando do que já chegou (2,5 s não bastaram na resposta longa da Kore).
 */
const AUDIO_ONLY_PREVIEW_SECONDS = 10

class LipsyncEngine implements SpeechLipsyncEngine {
  private readonly phonemizerFactory: () => TranscriptPhonemizer
  private phonemizer: TranscriptPhonemizer | null = null
  private readonly anticipation: number
  private readonly interruptEase: number
  private readonly extractor = new AudioFeatureExtractor()
  private readonly landmarks: SpeechLandmarks
  private readonly aligner: SpeechAligner
  private readonly timeline = new MouthTimeline()
  private readonly prosody: ProsodyTracker
  /** Proeminência tonal por fone da linha do tempo (0 fora das tônicas); definitiva até `accentStable`. */
  private accentScore = new Float32Array(256)
  /** Direção do F0 por fone (−1 queda … +1 subida; 0 fora dos candidatos a acento); mesma estabilidade. */
  private accentDirection = new Float32Array(256)
  /** Fone que pode carregar acento de frase (tônica do texto, ou núcleo só-áudio que parece tônica); mesma estabilidade. */
  private accentCandidate = new Uint8Array(256)
  private readonly neighborDurations = new Float64Array(4)
  /** Saídas do `emphasisAt` além do pulso (campos: nada de objeto por quadro). */
  private emphasisDirection = 0
  private emphasisNuclear = false
  private accentStable = 0

  private turnId: number | null = null
  private highestTurnId = Number.NEGATIVE_INFINITY
  private interrupted = false
  private interruptedAt = Number.POSITIVE_INFINITY
  private firstAudioStart = Number.NaN
  private scheduledEnd = Number.NEGATIVE_INFINITY
  private minLookahead: number | null = null
  private syncedCommitted = 0
  private framesAtLastRealign = 0
  private questionByWord = new Uint8Array(256)
  private clauseStart = 0

  constructor(options: SpeechLipsyncEngineOptions) {
    this.phonemizerFactory = options.phonemizerFactory ?? createTranscriptPhonemizer
    this.anticipation = options.anticipationSeconds ?? DEFAULT_ANTICIPATION_SECONDS
    this.interruptEase = options.interruptEaseSeconds ?? DEFAULT_INTERRUPT_EASE_SECONDS
    this.landmarks = new SpeechLandmarks(this.extractor.store)
    this.prosody = new ProsodyTracker(this.extractor.store)
    this.aligner = new SpeechAligner(this.extractor.store, this.landmarks, { commitLagSeconds: options.commitLagSeconds })
  }

  beginTurn(turnId: number): void {
    this.clearTurn()
    this.turnId = turnId
    if (turnId > this.highestTurnId) this.highestTurnId = turnId
  }

  pushAudio(chunk: ScheduledAudioChunk): void {
    if (!this.accept(chunk.turnId) || chunk.pcm.length === 0) return
    this.aligner.noteHeard(chunk.receivedAt)
    const heardCommitted = this.aligner.commitHeard()
    if (Number.isNaN(this.firstAudioStart)) this.firstAudioStart = chunk.startAt
    const lookahead = chunk.startAt - chunk.receivedAt
    if (this.minLookahead === null || lookahead < this.minLookahead) this.minLookahead = lookahead
    this.extractor.push(chunk.pcm, chunk.startAt, chunk.sampleRate)
    this.prosody.update()
    const end = chunk.startAt + chunk.pcm.length / chunk.sampleRate
    if (end > this.scheduledEnd) this.scheduledEnd = end
    this.aligner.receivedAudioUntil = this.scheduledEnd
    const changed = this.landmarks.update(false)
    const frames = this.extractor.store.count
    if (changed || frames - this.framesAtLastRealign >= REALIGN_EVERY_FRAMES) this.realign()
    else if (heardCommitted) this.syncTimeline()
  }

  pushTranscript(fragment: TranscriptFragment): void {
    if (!this.accept(fragment.turnId)) return
    this.aligner.noteHeard(fragment.receivedAt)
    const heardCommitted = this.aligner.commitHeard()
    const words = this.ensurePhonemizer().push(fragment.text)
    if (words.length === 0) {
      if (heardCommitted) this.syncTimeline()
      return
    }
    this.addWords(words)
    this.realign()
  }

  endOfText(turnId: number): void {
    if (this.turnId !== turnId || this.interrupted) return
    this.aligner.commitHeard()
    const words = this.ensurePhonemizer().flush()
    if (words.length > 0) this.addWords(words)
    this.aligner.textFinal = true
    // turnComplete/generationComplete: todo o áudio do turno já chegou.
    this.extractor.flush()
    this.prosody.update()
    this.landmarks.update(true)
    this.aligner.audioFinal = true
    this.realign()
  }

  interrupt(atTime: number): void {
    if (this.turnId === null || this.interrupted) return
    this.interrupted = true
    this.interruptedAt = atTime
    this.aligner.truncate(atTime)
    const store = this.extractor.store
    store.truncate(store.lowerBound(atTime))
    this.prosody.update()
    this.timeline.clear()
    this.timeline.appendAll(this.aligner.committed)
    this.syncedCommitted = this.aligner.committed.length
    this.accentStable = Math.min(this.accentStable, this.syncedCommitted)
    this.scoreAccents()
    this.timeline.fadeStart = atTime
    this.timeline.fadeDuration = this.interruptEase
    this.phonemizer?.reset()
  }

  reset(): void {
    this.clearTurn()
    this.turnId = null
  }

  sample(heardTime: number, out: SpeechFrame): void {
    const timeline = this.timeline
    if (this.turnId === null || (timeline.count === 0 && this.extractor.store.count === 0)) {
      writeRestFrame(out)
      return
    }
    // O relógio ouvido também empurra a consolidação: nada que já tocou é reescrito.
    if (!this.interrupted && heardTime >= this.firstAudioStart && heardTime <= this.scheduledEnd) this.aligner.noteHeard(heardTime)
    const t = heardTime + this.anticipation
    const coverageEnd = timeline.count > 0 ? timeline.end[timeline.count - 1] : Number.NEGATIVE_INFINITY
    const store = this.extractor.store
    const analyzedEnd = store.count > 0 ? store.time[store.count - 1] : Number.NEGATIVE_INFINITY
    const live = !this.interrupted && !this.aligner.isDone && t > coverageEnd && t <= analyzedEnd
    if (live) this.liveAudioMouth(t, out.mouth)
    else timeline.sample(t, out.mouth)

    const index = timeline.indexAt(heardTime)
    out.energy = this.energyAt(heardTime)
    if (heardTime >= this.interruptedAt || heardTime > this.scheduledEnd) out.speaking = false
    else if (live) out.speaking = out.energy > 0.05
    else if (index < 0) out.speaking = false
    else if (!timeline.isPause(index)) out.speaking = true
    // Pausa: curta no meio da fala ainda é "falando" (respiração entre palavras); longa ou a pausa
    // final do turno não é — o corpo sai do modo fala e a boca descansa.
    else out.speaking = index < timeline.count - 1 && timeline.end[index] - timeline.start[index] < LONG_PAUSE_SECONDS
    out.emphasis = this.emphasisAt(t)
    out.accentDirection = this.emphasisDirection
    out.accentNuclear = this.emphasisNuclear
    out.phraseTime = this.phraseTimeAt(heardTime, index)
    out.question = this.questionAt(index)
    out.debugPhone = index >= 0 ? timeline.phoneAt(index) : null
    out.debugSource = index >= 0 ? (timeline.isAudioOnly(index) ? "audio-only" : "aligned") : live ? "audio-only" : null
  }

  heardWordCount(atTime: number): number {
    let last = -1
    for (const list of [this.aligner.committed, this.aligner.provisional]) {
      for (const phone of list) {
        if (phone.start >= atTime) break
        if (phone.wordIndex > last) last = phone.wordIndex
      }
    }
    return last + 1
  }

  debugSnapshot(options: { frames?: boolean } = {}): LipsyncDebugSnapshot {
    return {
      turnId: this.turnId,
      phones: [...this.aligner.committed, ...this.aligner.provisional],
      frames: options.frames === false ? [] : this.extractor.store.toFrames(),
      analyzedUntil: this.extractor.analyzedUntil,
      alignedUntil: this.aligner.alignedUntil,
      pendingWords: this.aligner.pendingWords,
      minLookahead: this.minLookahead,
    }
  }

  // -------------------------------------------------------------------------

  private accept(turnId: number): boolean {
    if (this.turnId === turnId) return !this.interrupted
    if (turnId > this.highestTurnId) {
      this.beginTurn(turnId)
      return true
    }
    return false
  }

  private ensurePhonemizer(): TranscriptPhonemizer {
    if (!this.phonemizer) this.phonemizer = this.phonemizerFactory()
    return this.phonemizer
  }

  private clearTurn(): void {
    this.phonemizer?.reset()
    this.extractor.reset()
    this.prosody.reset()
    this.landmarks.reset()
    this.aligner.reset()
    this.timeline.clear()
    this.interrupted = false
    this.interruptedAt = Number.POSITIVE_INFINITY
    this.firstAudioStart = Number.NaN
    this.scheduledEnd = Number.NEGATIVE_INFINITY
    this.minLookahead = null
    this.syncedCommitted = 0
    this.accentStable = 0
    this.framesAtLastRealign = 0
    this.questionByWord.fill(0)
    this.clauseStart = 0
  }

  private addWords(words: G2PWord[]): void {
    this.aligner.addWords(words)
    for (const word of words) {
      const index = word.phones.length > 0 ? word.phones[0].wordIndex : -1
      if (index < 0) continue
      if (index >= this.questionByWord.length) {
        const grown = new Uint8Array(Math.max(index + 1, this.questionByWord.length * 2))
        grown.set(this.questionByWord)
        this.questionByWord = grown
      }
      if (word.pauseAfter !== "none" || word.questionEnd) {
        // Fecha a oração: todas as palavras dela herdam "é pergunta?".
        for (let w = this.clauseStart; w <= index; w++) this.questionByWord[w] = word.questionEnd ? 1 : 0
        this.clauseStart = index + 1
      }
    }
  }

  private realign(): void {
    if (this.interrupted) return
    this.framesAtLastRealign = this.extractor.store.count
    this.aligner.update()
    this.syncTimeline()
  }

  private syncTimeline(): void {
    // Linha do tempo = consolidado (só cresce) + cauda provisória (refeita a cada realinhamento).
    const committed = this.aligner.committed
    this.timeline.truncate(this.syncedCommitted)
    this.accentStable = Math.min(this.accentStable, this.syncedCommitted)
    for (let i = this.syncedCommitted; i < committed.length; i++) this.timeline.append(committed[i])
    this.syncedCommitted = committed.length
    this.timeline.appendAll(this.aligner.provisional)
    this.appendAudioOnlyPreview()
    this.scoreAccents()
  }

  /**
   * Fala já analisada que o alinhador ainda não cobre (texto atrasado ou faltando, e o instante
   * ouvido ainda longe de forçar o só-áudio): a linha do tempo de exibição ganha os MESMOS fones
   * só-áudio que o alinhador consolidaria ali (`audio-only-phones`), provisórios como a cauda do
   * texto — saem na próxima sincronização. Sem isso esse trecho era desenhado quadro a quadro pela
   * boca "ao vivo", sem limite de velocidade: era de onde vinham os trancos de mandíbula com a
   * transcrição incompleta e quando o áudio parava de chegar por 1–2 s (capturas Kore, 2026-10-08).
   */
  private appendAudioOnlyPreview(): void {
    if (this.interrupted || this.aligner.isDone) return
    const store = this.extractor.store
    if (store.count === 0) return
    const timeline = this.timeline
    const from = timeline.count > 0 ? timeline.end[timeline.count - 1] : store.time[0] - HOP_SECONDS / 2
    const frontier = store.time[store.count - 1] + HOP_SECONDS / 2
    const to = Math.min(frontier, this.aligner.heardUntil + AUDIO_ONLY_PREVIEW_SECONDS)
    if (!(to - from >= 2 * HOP_SECONDS)) return
    timeline.appendAll(audioOnlyPhones(store, this.landmarks, from, to))
  }

  /**
   * Proeminência tonal das tônicas ainda não definitivas. Fica definitiva quando o fone já está
   * consolidado e todo o áudio de que ela depende (±0,6 s) foi analisado.
   */
  private scoreAccents(): void {
    const timeline = this.timeline
    if (this.accentScore.length < timeline.count) {
      const size = Math.max(timeline.count, this.accentScore.length * 2)
      const kept = Math.min(this.accentScore.length, this.accentStable)
      const grown = new Float32Array(size)
      grown.set(this.accentScore.subarray(0, kept))
      this.accentScore = grown
      const direction = new Float32Array(size)
      direction.set(this.accentDirection.subarray(0, kept))
      this.accentDirection = direction
      const candidate = new Uint8Array(size)
      candidate.set(this.accentCandidate.subarray(0, kept))
      this.accentCandidate = candidate
    }
    const analyzed = this.extractor.analyzedUntil
    const done = this.aligner.isDone
    // Os vizinhos de um núcleo só-áudio (duração, loudness) também precisam estar consolidados.
    const committedEnd = this.syncedCommitted > 0 ? timeline.end[this.syncedCommitted - 1] : Number.NEGATIVE_INFINITY
    let stable = true
    for (let i = this.accentStable; i < timeline.count; i++) {
      const candidate = timeline.isStressedNucleus(i) || (timeline.isAudioOnly(i) && timeline.isNucleus(i) && this.audioOnlyCandidate(i))
      this.accentCandidate[i] = candidate ? 1 : 0
      // Sem áudio analisado ainda, não há F0: 0 (é recalculado quando o áudio chegar).
      const score = candidate && timeline.start[i] < analyzed ? this.prosody.prominence(timeline.start[i], timeline.end[i]) : 0
      this.accentScore[i] = score
      // Direção só de quem pode ser acento (a do nuclear pede a menor proeminência).
      this.accentDirection[i] = score >= NUCLEAR_ACCENT_MIN_SEMITONES ? this.prosody.direction(timeline.start[i], timeline.end[i]) : 0
      const settled = done || (timeline.end[i] + PROMINENCE_LOOKAHEAD_SECONDS <= analyzed && (!timeline.isAudioOnly(i) || timeline.end[i] + PROMINENCE_LOOKAHEAD_SECONDS <= committedEnd))
      if (stable && i < this.syncedCommitted && settled) this.accentStable = i + 1
      else stable = false
    }
  }

  /**
   * Núcleo só-áudio que pode carregar acento. Nas duas últimas sílabas da frase, só a que tem mais cara
   * de tônica entre elas (`stressContrast`): é onde fica o nuclear — a vogal final decai e perderia no
   * filtro (o "cê" de "você."), e a pós-tônica de uma paroxítona não pode virar um segundo acento (no
   * texto ela nunca é candidata). Nas demais, a cara de tônica (`looksStressed`).
   */
  private audioOnlyCandidate(i: number): boolean {
    const timeline = this.timeline
    const next = this.nextNucleusInPhrase(i)
    if (next === NO_NUCLEUS) {
      const previous = this.previousNucleusInPhrase(i)
      return previous < 0 || !timeline.isAudioOnly(previous) || this.stressContrast(i, previous) <= 0
    }
    if (next === UNKNOWN_NUCLEUS) return true
    if (timeline.isAudioOnly(next) && this.nextNucleusInPhrase(next) === NO_NUCLEUS && this.stressContrast(next, i) > 0) return true
    return this.looksStressed(i)
  }

  /**
   * O quanto o núcleo `b` tem mais cara de tônica que `a`: ln(duração b ÷ a) + diferença de loudness
   * (× 30 dB ÷ 6). No fim de frase sem texto, acerta qual das duas últimas sílabas é a tônica em 90%
   * dos casos (43 de 48, capturas lidas sem texto); a mais proeminente no F0 acertava 73% — a janela
   * da pós-tônica pega a queda que vem da tônica.
   */
  private stressContrast(a: number, b: number): number {
    const timeline = this.timeline
    const durationA = timeline.end[a] - timeline.start[a]
    const durationB = timeline.end[b] - timeline.start[b]
    if (durationA <= 0 || durationB <= 0) return 0
    return Math.log(durationB / durationA) + (timeline.loudness[b] - timeline.loudness[a]) * STRESS_LOUDNESS_DB_SCALE
  }

  /**
   * Próximo núcleo da mesma frase depois de `i`; `NO_NUCLEUS` se uma pausa de frase (≥ 150 ms) ou o fim
   * do turno vem antes; `UNKNOWN_NUCLEUS` se a linha do tempo acaba antes de dizer (turno aberto) ou o
   * próximo fone está longe demais (`PHRASE_FINAL_REACH_SECONDS`).
   */
  private nextNucleusInPhrase(i: number): number {
    const timeline = this.timeline
    for (let j = i + 1; j < timeline.count; j++) {
      if (timeline.start[j] - timeline.end[i] > PHRASE_FINAL_REACH_SECONDS) return UNKNOWN_NUCLEUS
      if (timeline.isPause(j) && timeline.end[j] - timeline.start[j] >= PHRASE_BREAK_SECONDS) return NO_NUCLEUS
      if (timeline.isNucleus(j)) return j
    }
    return this.aligner.isDone ? NO_NUCLEUS : UNKNOWN_NUCLEUS
  }

  /** Núcleo anterior da mesma frase (sem pausa de frase entre eles, a até `PHRASE_FINAL_REACH_SECONDS`); −1 se não há. */
  private previousNucleusInPhrase(i: number): number {
    const timeline = this.timeline
    for (let j = i - 1; j >= 0; j--) {
      if (timeline.start[i] - timeline.end[j] > PHRASE_FINAL_REACH_SECONDS) return -1
      if (timeline.isPause(j) && timeline.end[j] - timeline.start[j] >= PHRASE_BREAK_SECONDS) return -1
      if (timeline.isNucleus(j)) return j
    }
    return -1
  }

  /** Núcleo só-áudio com cara de tônica: ver `STRESS_LIKE_THRESHOLD`. Não aloca. */
  private looksStressed(i: number): boolean {
    const timeline = this.timeline
    const durations = this.neighborDurations
    let count = 0
    let adjacentLoudness = Number.NEGATIVE_INFINITY
    for (let direction = -1; direction <= 1; direction += 2) {
      let found = 0
      for (let j = i + direction; j >= 0 && j < timeline.count && found < 2; j += direction) {
        if (!timeline.isNucleus(j)) continue
        // Inserção ordenada (no máximo 4 valores).
        let k = count++
        const duration = timeline.end[j] - timeline.start[j]
        while (k > 0 && durations[k - 1] > duration) {
          durations[k] = durations[k - 1]
          k--
        }
        durations[k] = duration
        if (found === 0 && timeline.loudness[j] > adjacentLoudness) adjacentLoudness = timeline.loudness[j]
        found++
      }
    }
    if (count === 0) return true
    const median = count % 2 === 1 ? durations[count >> 1] : (durations[(count >> 1) - 1] + durations[count >> 1]) / 2
    const duration = timeline.end[i] - timeline.start[i]
    if (median <= 0 || duration <= 0) return true
    return Math.log(duration / median) + (timeline.loudness[i] - adjacentLoudness) * STRESS_LOUDNESS_DB_SCALE >= STRESS_LIKE_THRESHOLD
  }

  /** Loudness 0..1 suavizada (média de ±30 ms de quadros) no instante `t`. */
  private energyAt(t: number): number {
    const store = this.extractor.store
    if (store.count === 0) return 0
    let first = store.lowerBound(t - ENERGY_HALF_WINDOW_SECONDS)
    const last = store.lowerBound(t + ENERGY_HALF_WINDOW_SECONDS)
    if (first >= store.count) return 0
    let acc = 0
    let n = 0
    for (; first < last && first < store.count; first++) {
      acc += Math.pow(10, store.energyDb[first] / 10)
      n++
    }
    if (n === 0) return 0
    const db = 10 * Math.log10(acc / n + 1e-10)
    const level = this.landmarks.speechLevelDb
    return Math.max(0, Math.min(1, (db - (level - 30)) / 30))
  }

  /**
   * Pulso do acento de frase mais forte em `t`; deixa a direção e o "nuclear" dele em
   * `emphasisDirection`/`emphasisNuclear` (0/false sem acento).
   */
  private emphasisAt(t: number): number {
    this.emphasisDirection = 0
    this.emphasisNuclear = false
    const timeline = this.timeline
    if (timeline.count === 0 || t >= this.interruptedAt) return 0
    let i = timeline.lastStartingBefore(t + EMPHASIS_WINDOW_SECONDS)
    let best = 0
    let bestIndex = -1
    for (; i >= 0 && timeline.end[i] >= t - EMPHASIS_WINDOW_SECONDS; i--) {
      if (this.accentCandidate[i] !== 1 || !this.isAccent(i)) continue
      const center = (timeline.start[i] + timeline.end[i]) / 2
      const x = (t - center) / EMPHASIS_WIDTH_SECONDS
      const strength = Math.min(1, this.accentScore[i] / ACCENT_FULL_SEMITONES)
      const pulse = Math.exp(-x * x) * (0.55 + 0.45 * strength)
      if (pulse > best) {
        best = pulse
        bestIndex = i
      }
    }
    if (bestIndex >= 0) {
      this.emphasisDirection = this.accentDirection[bestIndex]
      this.emphasisNuclear = this.isPhraseFinal(bestIndex)
    }
    return best
  }

  /**
   * A tônica `i` carrega acento de frase: proeminência mínima e nenhuma rival mais proeminente
   * a menos de `ACCENT_RIVAL_SECONDS` (o acento nuclear, último da frase, só disputa com outro nuclear).
   */
  private isAccent(i: number): boolean {
    const timeline = this.timeline
    const score = this.accentScore[i]
    const nuclear = this.isPhraseFinal(i)
    if (score < (nuclear ? NUCLEAR_ACCENT_MIN_SEMITONES : ACCENT_MIN_SEMITONES)) return false
    const center = (timeline.start[i] + timeline.end[i]) / 2
    for (let direction = -1; direction <= 1; direction += 2) {
      for (let j = i + direction; j >= 0 && j < timeline.count; j += direction) {
        const other = (timeline.start[j] + timeline.end[j]) / 2
        if (Math.abs(other - center) > ACCENT_RIVAL_SECONDS) break
        if (this.accentCandidate[j] !== 1) continue
        const rival = this.accentScore[j]
        if (rival < score || (rival === score && j > i)) continue
        if (nuclear && !this.isPhraseFinal(j)) continue
        return false
      }
    }
    return true
  }

  /**
   * Acento nuclear: a última tônica da frase. Sem texto (núcleos só-áudio) a tônica é desconhecida:
   * fica com a que tem mais cara de tônica entre as duas últimas sílabas antes da pausa
   * (`stressContrast`). Sem isso a pós-tônica final virava um segundo acento, quase sempre em nível —
   * nas capturas lidas sem texto, 72 nucleares com 39% em queda, contra 63 e 56% com o texto.
   */
  private isPhraseFinal(i: number): boolean {
    const timeline = this.timeline
    if (!timeline.isAudioOnly(i)) return this.endsPhrase(i)
    const next = this.nextNucleusInPhrase(i)
    if (next === NO_NUCLEUS) {
      const previous = this.previousNucleusInPhrase(i)
      return previous < 0 || !timeline.isAudioOnly(previous) || this.stressContrast(i, previous) <= 0
    }
    return next >= 0 && timeline.isAudioOnly(next) && this.nextNucleusInPhrase(next) === NO_NUCLEUS && this.stressContrast(next, i) > 0
  }

  /** Última candidata da frase: uma pausa ≥ 150 ms (ou o fim do turno) vem antes da próxima candidata. */
  private endsPhrase(i: number): boolean {
    const timeline = this.timeline
    for (let j = i + 1; j < timeline.count; j++) {
      if (timeline.start[j] - timeline.end[i] > PHRASE_FINAL_REACH_SECONDS) return false
      if (timeline.isPause(j) && timeline.end[j] - timeline.start[j] >= PHRASE_BREAK_SECONDS) return true
      if (this.accentCandidate[j] === 1) return false
    }
    return this.aligner.isDone
  }

  private phraseTimeAt(t: number, index: number): number {
    const timeline = this.timeline
    if (index < 0 || timeline.isPause(index)) return 0
    for (let i = index - 1; i >= 0; i--) {
      if (timeline.isPause(i) && timeline.end[i] - timeline.start[i] >= PHRASE_PAUSE_SECONDS) return t - timeline.end[i]
    }
    return t - timeline.speechStart
  }

  private questionAt(index: number): boolean {
    const timeline = this.timeline
    for (let i = index; i >= 0; i--) {
      const word = timeline.wordIndex[i]
      if (word >= 0) return word < this.questionByWord.length && this.questionByWord[word] === 1
    }
    return false
  }

  /**
   * Boca direto das características do áudio, para o raro instante ouvido sem fone posicionado
   * (texto e núcleos ainda não chegaram). Mandíbula pelo envelope de vogais, dentes juntos na fricção.
   */
  private liveAudioMouth(t: number, out: MouthChannels): void {
    const store = this.extractor.store
    const landmarks = this.landmarks
    const center = store.lowerBound(t)
    let env = 0
    let high = 0
    let energy = 0
    let n = 0
    for (let f = Math.max(0, center - 2); f <= center + 2 && f < store.count; f++) {
      env += f < landmarks.envCount ? landmarks.env[f] : store.vowelBandDb[f]
      high += store.highBandRatio[f]
      energy += store.energyDb[f]
      n++
    }
    Object.assign(out, REST_MOUTH)
    if (n === 0) return
    env /= n
    high /= n
    energy /= n
    if (energy < landmarks.silenceDb) return
    const level = landmarks.speechLevelDb
    const open = Math.max(0, Math.min(1, (env - (level - 28)) / 28))
    out.jaw = MAX_JAW * 0.8 * open
    out.lowerLipDown = 0.3 * open
    if (high > 0.35) {
      out.jaw = Math.min(out.jaw, 0.1)
      out.spread = 0.3
      out.upperLipRaise = 0.15
    }
  }
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

export function createSpeechLipsyncEngine(options: SpeechLipsyncEngineOptions = {}): SpeechLipsyncEngine {
  return new LipsyncEngine(options)
}
