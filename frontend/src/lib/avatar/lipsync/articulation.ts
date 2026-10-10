import type { ArticulationTarget, MouthChannelKey, MouthChannels, PhoneSymbol } from "./types"
import { MOUTH_CHANNEL_KEYS } from "./types"

/**
 * Fone → alvo articulatório (canais semânticos da boca) + dominância por canal.
 *
 * Modelo de dominância (Cohen–Massaro): cada fone "puxa" os canais com que se importa, com força
 * `dominance` que decai com a distância no tempo (`decayRate`, 1/s, só nos LÁBIOS — a mandíbula usa
 * um decaimento rápido único, ver `coarticulation.ts`). Canal com dominância baixa = o fone não se
 * importa, e os vizinhos decidem — é isso que faz o "u" de "você" arredondar o "v" antes da hora.
 *
 * PT-BR, fala conversacional, afinado contra as formas renderizadas e medido nas capturas reais do
 * Live (`scripts/dev/lipsync-dynamics.ts`, 2026-10-07):
 * - MANDÍBULA: todo fone se importa com ela (menos o tepe), em proporções de Keating et al. (1994,
 *   altura da mandíbula em VCVs): a ≫ é/ó > ê/ô > i/u ≈ t/d/n > s/z; a coarticulação dela é o
 *   limite de velocidade da trajetória (sílaba curta não chega ao alvo), não a média dos vizinhos —
 *   a média achatava o contraste a ~50% (consoante mostrava o dobro da abertura-alvo);
 * - bilabiais p/b/m fecham os lábios com dominância máxima em `lipClose`/`lowerLipTuck`; a mandíbula
 *   deles é a menos rígida das consoantes (os lábios fecham sozinhos);
 * - labiodentais f/v: lábio inferior sob os dentes, mandíbula quase fechada;
 * - sibilantes s/z: dentes quase fechados, lábios um pouco estirados; ʃ/ʒ/tʃ/dʒ projetam os lábios;
 * - t/d/n/l/k/g/R: quase sem alvo labial (a língua trabalha escondida);
 * - tepe r: transparente (a mandíbula passa direto entre as vogais vizinhas);
 * - vogais pela abertura/arredondamento do PT-BR; nasais = oral com ~25% menos mandíbula.
 * A mandíbula nunca passa de `MAX_JAW` (boca escancarada lê como grito).
 */

export const MAX_JAW = 0.7

type ChannelSpec = Partial<Record<MouthChannelKey, [target: number, dominance: number]>>

function articulation(spec: ChannelSpec, defaultDominance: number, decayRate: number): ArticulationTarget {
  const target: Partial<MouthChannels> = {}
  const dominance: Partial<Record<MouthChannelKey, number>> = {}
  for (const key of MOUTH_CHANNEL_KEYS) {
    const entry = spec[key]
    if (!entry) continue
    target[key] = key === "jaw" ? Math.min(MAX_JAW, entry[0]) : entry[0]
    dominance[key] = entry[1]
  }
  return { target, dominance, defaultDominance, decayRate }
}

// Vogais: importam-se com tudo que dá forma à boca aberta; lábios sempre separados. Vogal não
// arredondada DESARREDONDA ativamente (dominância alta em round/pucker = 0): sem isso o "u" final
// (-o átono), o "ô" e o ʃ vizinhos vazavam 0,15–0,30 de bico em "a"/"e"/"i" (medido em 2026-10-07).
// O decaimento só vale para os LÁBIOS — a mandíbula usa `JAW_DECAY_RATE` (coarticulation.ts).
const VOWEL_DECAY = 40
const vowel = (jaw: number, extra: ChannelSpec = {}): ArticulationTarget =>
  articulation(
    {
      jaw: [jaw, 0.9],
      lipClose: [0, 0.55],
      lowerLipTuck: [0, 0.55],
      spread: [0, 0.35],
      round: [0, 0.9],
      pucker: [0, 0.9],
      upperLipRaise: [0, 0.25],
      lowerLipDown: [0, 0.3],
      jawForward: [0, 0.6],
      lipCompress: [0, 0.55],
      ...extra,
    },
    0.3,
    VOWEL_DECAY,
  )

/** Nasal = oral correspondente com ~25% menos mandíbula (o véu baixa, a boca abre menos). */
function nasalize(oral: ArticulationTarget): ArticulationTarget {
  const target = { ...oral.target }
  if (target.jaw !== undefined) target.jaw *= 0.75
  return { ...oral, target }
}

const A = vowel(0.62, { lowerLipDown: [0.35, 0.6], spread: [0.1, 0.35] })
const A_REDUCED = vowel(0.38, { lowerLipDown: [0.15, 0.45] })
const E_OPEN = vowel(0.45, { spread: [0.35, 0.6], upperLipRaise: [0.15, 0.4], lowerLipDown: [0.2, 0.45] })
const E_CLOSED = vowel(0.3, { spread: [0.45, 0.65], upperLipRaise: [0.1, 0.35] })
const I = vowel(0.2, { spread: [0.6, 0.75], upperLipRaise: [0.1, 0.35] })
const O_OPEN = vowel(0.48, { round: [0.5, 0.75], lowerLipDown: [0.15, 0.4], spread: [0, 0.6] })
const O_CLOSED = vowel(0.3, { round: [0.65, 0.8], pucker: [0.2, 0.6], spread: [0, 0.7] })
const U = vowel(0.18, { pucker: [0.85, 0.85], round: [0.3, 0.6], spread: [0, 0.75] })
/** "ã" é mais aberto que o "a" átono: parte de um "a" intermediário antes de nasalizar. */
const A_NASAL = nasalize(vowel(0.5, { lowerLipDown: [0.2, 0.5] }))

// Glides: mesma forma da vogal, com menos dominância (são curtos e cedem aos vizinhos).
const glide = (base: ArticulationTarget, jaw: number): ArticulationTarget => ({
  target: { ...base.target, jaw },
  dominance: Object.fromEntries(Object.entries(base.dominance).map(([key, value]) => [key, value * 0.7])),
  defaultDominance: base.defaultDominance * 0.7,
  decayRate: 20,
})

/**
 * Bilabiais: `lipCompress` diferencia a oclusiva com pressão (p > b) do [m] contínuo, que só encosta
 * os lábios. Dominância dura (≥ 0,95): vale o mesmo envelope do selo.
 */
const bilabial = (compress: number): ArticulationTarget => articulation(
  {
    lipClose: [1, 1],
    lipCompress: [compress, 1],
    lowerLipTuck: [0, 0.9],
    lowerLipDown: [0, 0.85],
    upperLipRaise: [0, 0.6],
    jaw: [0.1, 0.6],
    round: [0, 0.1],
    pucker: [0, 0.1],
    spread: [0, 0.12],
  },
  0.2,
  22,
)

const LABIODENTAL = articulation(
  {
    lowerLipTuck: [0.8, 0.95],
    upperLipRaise: [0.15, 0.6],
    jaw: [0.1, 0.9],
    lipClose: [0, 0.8],
    lowerLipDown: [0, 0.8],
    spread: [0.1, 0.3],
    round: [0, 0.15],
    pucker: [0, 0.15],
  },
  0.2,
  22,
)

const SIBILANT = articulation(
  {
    jaw: [0.08, 0.92],
    jawForward: [0.5, 0.7],
    spread: [0.3, 0.5],
    upperLipRaise: [0.2, 0.4],
    lipClose: [0, 0.5],
    lowerLipTuck: [0, 0.5],
    lowerLipDown: [0.05, 0.3],
    round: [0, 0.2],
    pucker: [0, 0.2],
  },
  0.2,
  20,
)

/** ʃ/ʒ/tʃ/dʒ: lábios projetados (arredondamento aberto) com os dentes quase juntos. */
const POSTALVEOLAR = articulation(
  {
    round: [0.5, 0.8],
    pucker: [0.15, 0.5],
    jaw: [0.1, 0.85],
    jawForward: [0.3, 0.6],
    upperLipRaise: [0.25, 0.4],
    spread: [0, 0.6],
    lipClose: [0, 0.5],
    lowerLipTuck: [0, 0.5],
  },
  0.2,
  18,
)

const CORONAL = (jaw: number, jawDominance = 0.9, extra: ChannelSpec = {}): ArticulationTarget =>
  articulation({ jaw: [jaw, jawDominance], lipClose: [0, 0.4], lowerLipTuck: [0, 0.3], ...extra }, 0.15, 20)

const VELAR = articulation({ jaw: [0.2, 0.6], lipClose: [0, 0.3] }, 0.08, 20)
const RHOTIC = articulation({ jaw: [0.25, 0.6], lipClose: [0, 0.25] }, 0.08, 20)
/** Tepe: transparente para a mandíbula (a meta dele é a média das vogais vizinhas). */
const TAP = articulation({ jaw: [0.25, 0.02] }, 0.02, 24)
const PAUSE = articulation(
  { jaw: [0, 0.9], lipClose: [0, 0.9], round: [0, 0.9], pucker: [0, 0.9], spread: [0, 0.9], lowerLipTuck: [0, 0.9], upperLipRaise: [0, 0.9], lowerLipDown: [0, 0.9] },
  0.9,
  30,
)

export const ARTICULATION: Readonly<Record<PhoneSymbol, ArticulationTarget>> = Object.freeze({
  a: A,
  "6": A_REDUCED,
  e: E_CLOSED,
  E: E_OPEN,
  i: I,
  o: O_CLOSED,
  O: O_OPEN,
  u: U,
  "6~": A_NASAL,
  "e~": nasalize(E_CLOSED),
  "i~": nasalize(I),
  "o~": nasalize(O_CLOSED),
  "u~": nasalize(U),
  j: glide(I, 0.15),
  w: glide(U, 0.15),
  "j~": glide(nasalize(I), 0.12),
  "w~": glide(nasalize(U), 0.12),
  p: bilabial(1),
  b: bilabial(0.8),
  m: bilabial(0.4),
  f: LABIODENTAL,
  v: LABIODENTAL,
  s: SIBILANT,
  z: SIBILANT,
  S: POSTALVEOLAR,
  Z: POSTALVEOLAR,
  tS: POSTALVEOLAR,
  dZ: POSTALVEOLAR,
  t: CORONAL(0.12),
  d: CORONAL(0.15),
  n: CORONAL(0.15),
  l: CORONAL(0.2, 0.85),
  L: CORONAL(0.15, 0.85),
  J: CORONAL(0.15, 0.85, { spread: [0.2, 0.3] }),
  k: VELAR,
  g: VELAR,
  R: RHOTIC,
  r: TAP,
  _: PAUSE,
})

export function articulationOf(phone: PhoneSymbol): ArticulationTarget {
  return ARTICULATION[phone]
}

/** Valor-alvo e dominância de um canal (com os padrões do fone para canais não declarados). */
export function channelTarget(articulationTarget: ArticulationTarget, key: MouthChannelKey): { target: number; dominance: number } {
  return {
    target: articulationTarget.target[key] ?? 0,
    dominance: articulationTarget.dominance[key] ?? articulationTarget.defaultDominance,
  }
}
