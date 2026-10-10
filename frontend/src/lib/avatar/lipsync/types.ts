/**
 * Contratos do lip-sync da INIA (PT-BR, áudio do Gemini Live em streaming).
 *
 * Divisão de responsabilidades — cada peça é pura/testável e não conhece React nem three.js:
 * - `pt-br/*`: texto → palavras → sílabas → fones (G2P por regras, com tonicidade e prioris de duração).
 * - `phones.ts`: inventário de fones do PT-BR e suas propriedades acústicas/articulatórias.
 * - `articulation.ts`: fone → alvo articulatório (canais da boca) + parâmetros de dominância.
 * - `audio-features.ts`: PCM recebido → quadros de 10 ms com energia, vozeamento, fricção etc.
 * - `aligner.ts`: alinhamento incremental fones × quadros de áudio (sem timestamps do Gemini).
 * - `coarticulation.ts`: segmentos alinhados → pose da boca em qualquer instante (modelo de dominância).
 * - `speech-lipsync-engine.ts`: orquestra um turno (áudio + texto em fragmentos + interrupção).
 * - `text-timed-lipsync.ts`: mesma saída a partir de texto + eventos de fronteira de palavra
 *   (speechSynthesis da despedida, que não expõe o áudio).
 *
 * Relógio: todo tempo de áudio é em SEGUNDOS no relógio do `AudioContext` de reprodução
 * (`startAt` do chunk agendado). O avatar consulta a pose no instante OUVIDO
 * (ver `audio/types.ts › SpeechClock.heardTime`), nunca em estado do React.
 */

// ---------------------------------------------------------------------------
// Fones
// ---------------------------------------------------------------------------

/**
 * Inventário (notação X-SAMPA simplificada):
 * vogais orais  a (á tônico aberto), 6 (ɐ: â, a átono/final), e (ê), E (é), i, o (ô), O (ó), u
 * vogais nasais 6~ (ã/an/am), e~, i~, o~, u~
 * glides        j, w (orais) e j~, w~ (nasais: "bem" [bẽj̃], "mão" [mɐ̃w̃])
 * oclusivas     p b t d k g
 * africadas     tS (ti/te final), dZ (di/de final)
 * fricativas    f v s z S (ch/x) Z (j/ge)
 * nasais        m n J (nh)
 * laterais      l L (lh)
 * róticos       r (tepe: caro, prato) R (forte: rato, carro, coda "porta" no carioca/nordeste)
 * pausa         _ (silêncio: pontuação, respiração)
 */
export type PhoneSymbol =
  | "a" | "6" | "e" | "E" | "i" | "o" | "O" | "u"
  | "6~" | "e~" | "i~" | "o~" | "u~"
  | "j" | "w" | "j~" | "w~"
  | "p" | "b" | "t" | "d" | "k" | "g"
  | "tS" | "dZ"
  | "f" | "v" | "s" | "z" | "S" | "Z"
  | "m" | "n" | "J"
  | "l" | "L"
  | "r" | "R"
  | "_"

export type PhoneClass =
  | "vowel"
  | "glide"
  | "stop"
  | "affricate"
  | "fricative"
  | "nasal"
  | "lateral"
  | "tap"
  | "rhotic"
  | "pause"

export type PhoneInfo = {
  symbol: PhoneSymbol
  class: PhoneClass
  voiced: boolean
  /** Duração típica em ms numa fala conversacional (~5,5 sílabas/s), antes de tonicidade/posição. */
  baseDurationMs: number
  /** Duração mínima plausível em ms (limita o alinhador). */
  minDurationMs: number
}

/** Um fone produzido pelo G2P, já com contexto prosódico. */
export type PhoneToken = {
  phone: PhoneSymbol
  /** Índice da palavra no texto do turno (monotônico entre fragmentos). */
  wordIndex: number
  /** Índice global da sílaba no turno (monotônico entre fragmentos). */
  syllableIndex: number
  /** O fone é o núcleo (vogal) da sílaba. */
  nucleus: boolean
  /** Sílaba tônica da palavra (palavras átonas/clíticos: sempre false). */
  stressed: boolean
  /** Duração esperada em ms (base × tonicidade × posição). */
  durationPriorMs: number
  /**
   * Vogal epentética que a fala pode não ter ("fid[i]back" falado "fídbék"): o alinhador pode pulá-la.
   * Marcada no léxico com parênteses — `(i)`.
   */
  optional?: boolean
}

export type PauseStrength = "none" | "short" | "long"

export type G2PWord = {
  /** Texto original da palavra (como veio do transcript). */
  text: string
  /** Forma normalizada falada (ex.: "8h30" → "oito e trinta"); pode conter várias palavras faladas. */
  spoken: string
  phones: PhoneToken[]
  /** Pausa provável depois da palavra, derivada da pontuação (",;:" → short; ".!?…" → long). */
  pauseAfter: PauseStrength
  /** Pergunta: a palavra termina uma oração interrogativa (útil para sobrancelha/cabeça). */
  questionEnd: boolean
}

/**
 * G2P incremental: recebe o texto em fragmentos (como `outputTranscription`) e devolve só
 * palavras COMPLETAS — o resto fica guardado até o próximo fragmento ou `flush()`.
 */
export interface TranscriptPhonemizer {
  push(fragment: string): G2PWord[]
  /** Fim do texto do turno: devolve a palavra pendente, se houver. */
  flush(): G2PWord[]
  reset(): void
}

// ---------------------------------------------------------------------------
// Articulação (independente do rig; o mixer facial traduz para ARKit)
// ---------------------------------------------------------------------------

/** Canais semânticos da boca, todos 0..1. */
export type MouthChannels = {
  /** Abertura da mandíbula. */
  jaw: number
  /** Lábios selados (p, b, m). Precisa vencer sorriso e mandíbula de vizinhos. */
  lipClose: number
  /** Arredondamento aberto/protrusão (o, ó, ʃ, ʒ). */
  round: number
  /** Arredondamento fechado/bico (u, w, coda l). */
  pucker: number
  /** Lábios estirados (i, e, s). */
  spread: number
  /** Lábio inferior sob os dentes superiores (f, v). */
  lowerLipTuck: number
  /** Lábio superior elevado, mostrando dentes (s, ʃ, e aberto). */
  upperLipRaise: number
  /** Lábio inferior abaixado, mostrando dentes inferiores (a, ó). */
  lowerLipDown: number
  /** Mandíbula projetada para frente (s/z, e menos em ʃ/ʒ: alinha os incisivos para o sibilo). */
  jawForward: number
  /** Compressão dos lábios selados (p > b > m): rola os lábios para dentro e sobe o queixo. */
  lipCompress: number
}

export const MOUTH_CHANNEL_KEYS = [
  "jaw",
  "lipClose",
  "round",
  "pucker",
  "spread",
  "lowerLipTuck",
  "upperLipRaise",
  "lowerLipDown",
  "jawForward",
  "lipCompress",
] as const satisfies readonly (keyof MouthChannels)[]

export type MouthChannelKey = (typeof MOUTH_CHANNEL_KEYS)[number]

export const REST_MOUTH: Readonly<MouthChannels> = Object.freeze({
  jaw: 0,
  lipClose: 0,
  round: 0,
  pucker: 0,
  spread: 0,
  lowerLipTuck: 0,
  upperLipRaise: 0,
  lowerLipDown: 0,
  jawForward: 0,
  lipCompress: 0,
})

/**
 * Alvo articulatório de um fone. Canais ausentes = o fone não se importa com eles (dominância
 * baixa), e os vizinhos decidem — é assim que o "u" arredonda o "v" de "você" antes da hora.
 */
export type ArticulationTarget = {
  target: Partial<MouthChannels>
  /** Dominância por canal (0..1); canais sem valor usam `defaultDominance`. */
  dominance: Partial<Record<MouthChannelKey, number>>
  defaultDominance: number
  /** Taxa de decaimento da dominância (1/s): maior = influência mais curta no tempo. */
  decayRate: number
}

// ---------------------------------------------------------------------------
// Áudio → quadros de características
// ---------------------------------------------------------------------------

export type AudioFeatureFrame = {
  /** Centro do quadro no relógio do AudioContext (s). */
  time: number
  /** Energia RMS em dB (full scale). */
  energyDb: number
  /** Energia na banda de vogais (≈300–3000 Hz), dB. */
  vowelBandDb: number
  /** Razão de energia acima de ~4 kHz (0..1): fricativas s/ʃ/f. */
  highBandRatio: number
  /** Taxa de cruzamento por zero (0..1 por amostra). */
  zeroCrossingRate: number
  /** Vozeamento por autocorrelação normalizada (0..1). */
  voicing: number
}

// ---------------------------------------------------------------------------
// Alinhamento e linha do tempo
// ---------------------------------------------------------------------------

/** Um fone posicionado no relógio do AudioContext. */
export type AlignedPhone = {
  phone: PhoneSymbol
  start: number
  end: number
  stressed: boolean
  nucleus: boolean
  wordIndex: number
  /** De onde veio o posicionamento: texto alinhado ao áudio, ou só áudio (texto atrasado/ausente). */
  source: "aligned" | "audio-only"
  /** Loudness relativo (0..1) do trecho, usado para escalar a abertura. */
  loudness: number
  /**
   * Mandíbula-base estimada pelo áudio (só fones "só áudio": a vogal genérica não sabe qual vogal
   * é, mas o áudio diz o quanto abre — `audio-only-phones.ts › estimateOpening`); substitui o alvo
   * da tabela e passa pela mesma escala de loudness.
   */
  jawTarget?: number
}

/** O que o avatar lê a cada quadro, no instante ouvido. */
export type SpeechFrame = {
  /** Há fala audível agora (fora de pausas longas e dentro do áudio agendado). */
  speaking: boolean
  mouth: MouthChannels
  /** Loudness suavizado 0..1 no instante ouvido (cabeça, sobrancelhas, respiração). */
  energy: number
  /** Pulso 0..1 nos acentos de frase (micro-acenos, sobrancelhas, piscada). */
  emphasis: number
  /**
   * Direção do F0 do acento que está pulsando (`emphasis`): +1 = subida (L+H*, continuação,
   * pergunta sim/não), −1 = queda (H+L*, o nuclear declarativo), ~0 = pico/nível. 0 sem acento.
   */
  accentDirection: number
  /** O acento que está pulsando é o nuclear (última tônica antes de uma pausa de frase). */
  accentNuclear: boolean
  /** Segundos desde o início da frase atual (0 em pausa); útil para gesto no começo de frase. */
  phraseTime: number
  /** A frase atual termina em pergunta (para o final: sobrancelha/inclinação). */
  question: boolean
  /** Diagnóstico (laboratório): fone ativo e origem. */
  debugPhone: PhoneSymbol | null
  debugSource: AlignedPhone["source"] | null
}

export function createSpeechFrame(): SpeechFrame {
  return {
    speaking: false,
    mouth: { ...REST_MOUTH },
    energy: 0,
    emphasis: 0,
    accentDirection: 0,
    accentNuclear: false,
    phraseTime: 0,
    question: false,
    debugPhone: null,
    debugSource: null,
  }
}

// ---------------------------------------------------------------------------
// Motor por turno
// ---------------------------------------------------------------------------

export type ScheduledAudioChunk = {
  /** Geração/turno de áudio a que o chunk pertence (muda a cada resposta e a cada interrupção). */
  turnId: number
  /** PCM mono já decodificado (−1..1). */
  pcm: Float32Array
  sampleRate: number
  /** Instante agendado de início no relógio do AudioContext (s). */
  startAt: number
  /** Instante do relógio do AudioContext em que o chunk chegou (s) — mede a folga de lookahead. */
  receivedAt: number
}

export type TranscriptFragment = {
  turnId: number
  text: string
  /** Relógio do AudioContext quando o fragmento chegou (s). */
  receivedAt: number
  /** Fim do áudio já agendado quando o fragmento chegou (s) — âncora grosseira de tempo. */
  audioScheduledUntil: number
}

export type LipsyncDebugSnapshot = {
  turnId: number | null
  phones: AlignedPhone[]
  frames: AudioFeatureFrame[]
  /** Até onde o áudio já foi analisado / o texto já foi alinhado (relógio do AudioContext). */
  analyzedUntil: number
  alignedUntil: number
  pendingWords: number
  /** Menor folga observada entre chegada e início de reprodução (s). */
  minLookahead: number | null
}

export interface SpeechLipsyncEngine {
  /** Começa um novo turno; descarta qualquer coisa do turno anterior. */
  beginTurn(turnId: number): void
  pushAudio(chunk: ScheduledAudioChunk): void
  pushTranscript(fragment: TranscriptFragment): void
  /** O texto do turno terminou (turnComplete/generationComplete): alinha o que faltar. */
  endOfText(turnId: number): void
  /**
   * Interrupção (local ou `serverContent.interrupted`): nada depois de `atTime` é mais dito.
   * A boca volta ao repouso suavemente a partir daí; texto/áudio do turno são descartados.
   */
  interrupt(atTime: number): void
  /** Esquece tudo (desconexão). */
  reset(): void
  /** Pose no instante OUVIDO (relógio do AudioContext). Não aloca. */
  sample(heardTime: number, out: SpeechFrame): void
  /** Estado do alinhamento para diagnóstico. `frames: false` pula a cópia dos quadros de áudio (cara). */
  debugSnapshot(options?: { frames?: boolean }): LipsyncDebugSnapshot
  /**
   * Quantas palavras do texto do turno começaram a soar antes de `atTime` — usado para registrar só
   * o trecho OUVIDO de uma resposta interrompida (o texto chega bem antes do áudio).
   */
  heardWordCount?(atTime: number): number
}

// ---------------------------------------------------------------------------
// Fala sem acesso ao áudio (speechSynthesis do navegador)
// ---------------------------------------------------------------------------

/**
 * Lip-sync temporizado por texto + eventos de fronteira de palavra. Mesma saída (`SpeechFrame`) do
 * motor de áudio, mas no relógio `performance.now() / 1000`. Usado na despedida ("Até já!"), que é
 * falada pelo speechSynthesis — o navegador não expõe esse áudio para análise.
 */
export interface TextTimedLipsync {
  /** Começa a fala `text` no instante `atTime` (s). Fones são distribuídos pelas prioris de duração. */
  start(text: string, atTime: number, ratePerSecond?: number): void
  /** `SpeechSynthesisUtterance.onboundary`: a palavra que começa em `charIndex` começou em `atTime`. */
  boundary(charIndex: number, atTime: number): void
  /** Fim (onend): fecha a boca a partir de `atTime`. */
  end(atTime: number): void
  cancel(atTime: number): void
  isActive(time: number): boolean
  sample(time: number, out: SpeechFrame): void
}
