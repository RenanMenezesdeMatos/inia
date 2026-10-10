import { GU_WITH_W, QU_WITH_W, X_AS_KS, X_AS_S } from "./lexicon"

/**
 * Silabação FONOLÓGICA do PT-BR sobre a ortografia (não a do dicionário).
 *
 * Diferenças deliberadas da divisão escolar, porque o que importa é o que se ouve:
 * - Consoante obstruinte em coda (rit-mo, ad-vo-ga-do, tec-ni-co, pneu) ganha a sílaba epentética
 *   [i] que o brasileiro pronuncia ([ˈhitʃimu], [adʒivoˈgadu], [piˈnew]); ela é marcada `epenthetic`
 *   e nunca conta para a tonicidade.
 * - "s" + consoante no início da palavra (status, smartphone) ganha o [i] ANTES: [isˈtatus].
 * - "x" é resolvido já na ortografia para o som que tem ("ks", "ss", "z", "s" ou "ch"), assim a
 *   silabação e as regras de fone não precisam conhecer o "x".
 * - rr, ss, sc, sç, xc continuam separados entre sílabas (car-ro, pas-so, des-cer): as regras de coda
 *   em `phonetics.ts` apagam a coda redundante e deixam um único som.
 */

export type GraphemeUnit = {
  /** Grafema da unidade, em minúsculas: letra única ou dígrafo ("ch", "lh", "nh", "qu", "gu"). */
  g: string
  kind: "C" | "V"
  /** "qu"/"gu": o u é pronunciado ([kw]/[gw]: quando, água, cinquenta). */
  withGlide: boolean
}

export type OrthoSyllable = {
  onset: GraphemeUnit[]
  /** Letra do núcleo (com diacrítico). Nas epentéticas é "i". */
  vowel: string
  /** Semivogal do ditongo ("i"/"u"; "o" de "ão"; "e" de "ãe"/"õe"). */
  glide: string | null
  coda: GraphemeUnit[]
  /** Sílaba criada pela vogal epentética [i] (não existe na escrita). */
  epenthetic: boolean
}

const VOWEL_CHARS = new Set(["a", "e", "i", "o", "u", "á", "à", "â", "ã", "é", "ê", "í", "ó", "ô", "õ", "ú", "ü"])
const FRONT_CHARS = new Set(["e", "i", "é", "ê", "í"])
const ONSET_CLUSTER_FIRST = new Set(["p", "b", "t", "d", "c", "k", "g", "f", "v"])
/** Consoantes que ficam em coda sem vogal epentética. */
const CODA_OK = new Set(["s", "z", "r", "l", "m", "n"])

export function isVowelChar(char: string | undefined): boolean {
  return char !== undefined && VOWEL_CHARS.has(char)
}

export function isFrontVowelChar(char: string | undefined | null): boolean {
  return char !== undefined && char !== null && FRONT_CHARS.has(char)
}

/**
 * Ortografia → forma "fonológica" escrita: minúsculas, h mudo removido, empréstimos (ph, th, sh,
 * y, w, consoantes dobradas) regularizados e todo "x" resolvido para o som que tem.
 */
export function preprocessOrthography(word: string): string {
  let w = word.normalize("NFC").toLowerCase().replace(/['’`´]/g, "")
  w = w.replace(/ph/g, "f").replace(/th/g, "t").replace(/sh/g, "ch").replace(/ck/g, "k").replace(/y/g, "i").replace(/w/g, "u")
  // Consoantes dobradas de empréstimos ("feedback" já vem do léxico); rr e ss são do português.
  w = w.replace(/([bcdfgklmnptvz])\1+/g, "$1")
  // h mudo: só sobra em ch/lh/nh.
  w = w.replace(/(^|[^cln])h+/g, "$1")
  if (w.includes("x")) w = resolveX(w)
  return w
}

/**
 * "x": léxico ([ks] táxi, [s] próximo) → final [ks] (tórax) → inicial [ʃ] (xícara) → "ex" inicial
 * + vogal [z] (exame, êxito, inexistente) → x antes de consoante [s] (texto, explicar, exceto) →
 * [ʃ] no resto (caixa, peixe, enxame, lixo, mexer).
 */
function resolveX(w: string): string {
  if (X_AS_KS.test(w)) return w.replace(/x/g, "ks")
  if (X_AS_S.test(w)) return w.replace(/x/g, "ss")
  let out = ""
  for (let i = 0; i < w.length; i++) {
    const char = w[i]
    if (char !== "x") {
      out += char
      continue
    }
    const prev = w[i - 1]
    const next = w[i + 1]
    if (i === w.length - 1) out += "ks"
    else if (i === 0) out += "ch"
    else if ((prev === "e" || prev === "ê" || prev === "é") && (i === 1 || w.slice(0, i - 1) === "in")) out += isVowelChar(next) ? "z" : "s"
    else if (!isVowelChar(next)) out += "s"
    else out += "ch"
  }
  return out
}

/** Ortografia pré-processada → unidades (letras e dígrafos). `word` = forma para os radicais lexicais. */
export function graphemeUnits(w: string, word: string = w): GraphemeUnit[] {
  const units: GraphemeUnit[] = []
  for (let i = 0; i < w.length; i++) {
    const char = w[i]
    if (isVowelChar(char)) {
      units.push({ g: char === "ü" ? "u" : char, kind: "V", withGlide: false })
      continue
    }
    const next = w[i + 1]
    if ((char === "c" || char === "l" || char === "n") && next === "h") {
      units.push({ g: char + "h", kind: "C", withGlide: false })
      i += 1
      continue
    }
    if ((char === "q" || char === "g") && (next === "u" || next === "ü") && isVowelChar(w[i + 2])) {
      const front = isFrontVowelChar(w[i + 2])
      const lexical = char === "q" ? QU_WITH_W.test(word) : GU_WITH_W.test(word)
      units.push({ g: char + "u", kind: "C", withGlide: next === "ü" || !front || lexical })
      i += 1
      continue
    }
    if (char === "q") {
      units.push({ g: "k", kind: "C", withGlide: false })
      continue
    }
    if ((char >= "a" && char <= "z") || char === "ç") units.push({ g: char, kind: "C", withGlide: false })
  }
  return units
}

type Nucleus = { vowel: string; glide: string | null }

const TILDE_DIPHTHONG: Readonly<Record<string, ReadonlySet<string>>> = {
  ã: new Set(["o", "e", "i"]),
  õ: new Set(["e"]),
}

/**
 * i/u depois de vogal vira semivogal (ditongo decrescente: pai, céu, muito), EXCETO quando acentuado
 * (saída, baú), antes de "nh" (rainha) ou antes de l/m/n/r/z da mesma sílaba (ruim, raiz, cair,
 * ainda, juiz, Raul).
 */
function joinsAsGlide(current: Nucleus, vowel: string, after: GraphemeUnit | undefined, afterNext: GraphemeUnit | undefined): boolean {
  if (current.glide !== null) return false
  const tilde = TILDE_DIPHTHONG[current.vowel]
  if (tilde) return tilde.has(vowel)
  if (vowel !== "i" && vowel !== "u") return false
  if (current.vowel === vowel) return false
  if (after && after.kind === "C") {
    if (after.g === "nh") return false
    const sameSyllableCoda = afterNext === undefined || afterNext.kind === "C"
    if (sameSyllableCoda && (after.g === "l" || after.g === "m" || after.g === "n" || after.g === "r" || after.g === "z")) return false
  }
  return true
}

function isLegalOnsetCluster(first: GraphemeUnit, second: GraphemeUnit): boolean {
  if (!ONSET_CLUSTER_FIRST.has(first.g)) return false
  if (second.g === "r") return true
  // tl/dl/vl não são ataque no PT-BR (at-le-ta).
  return second.g === "l" && first.g !== "t" && first.g !== "d" && first.g !== "v"
}

function epentheticSyllable(onset: GraphemeUnit[], coda: GraphemeUnit[] = []): OrthoSyllable {
  return { onset, vowel: "i", glide: null, coda, epenthetic: true }
}

/** Ataque inicial ilegal (pneu, psicologia, status): consoantes soltas ganham [i]. */
function initialOnset(cluster: GraphemeUnit[], out: OrthoSyllable[]): GraphemeUnit[] {
  let rest = cluster
  while (rest.length > 1 && !(rest.length === 2 && isLegalOnsetCluster(rest[0], rest[1]))) {
    const first = rest[0]
    out.push(first.g === "s" ? epentheticSyllable([], [first]) : epentheticSyllable([first]))
    rest = rest.slice(1)
  }
  return rest
}

/** Coda com obstruinte (p b t d k g f v…) abre sílaba epentética: rit-mo → ri·tʃi·mu. */
function attachCoda(syllable: OrthoSyllable, coda: GraphemeUnit[], out: OrthoSyllable[]): void {
  let target = syllable
  for (const unit of coda) {
    if (CODA_OK.has(unit.g)) target.coda.push(unit)
    else {
      target = epentheticSyllable([unit])
      out.push(target)
    }
  }
}

/**
 * Silaba uma palavra já pré-processada (`preprocessOrthography`). Sem vogal nenhuma ("hmm", "tsc")
 * devolve lista vazia — não há o que articular.
 */
export function syllabifyOrthography(w: string, word: string = w): OrthoSyllable[] {
  const units = graphemeUnits(w, word)
  const clusters: GraphemeUnit[][] = [[]]
  const nuclei: Nucleus[] = []
  let current: Nucleus | null = null
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]
    if (unit.kind === "C") {
      if (current) {
        nuclei.push(current)
        current = null
        clusters.push([])
      }
      clusters[clusters.length - 1].push(unit)
      continue
    }
    if (current && joinsAsGlide(current, unit.g, units[i + 1], units[i + 2])) {
      current.glide = unit.g
      continue
    }
    if (current) {
      nuclei.push(current)
      clusters.push([])
    }
    current = { vowel: unit.g, glide: null }
  }
  if (current) {
    nuclei.push(current)
    clusters.push([])
  }
  if (nuclei.length === 0) return []

  // clusters[j] = consoantes antes do núcleo j; clusters[nuclei.length] = consoantes finais.
  const out: OrthoSyllable[] = []
  let onset = initialOnset(clusters[0], out)
  for (let j = 0; j < nuclei.length; j++) {
    const syllable: OrthoSyllable = { onset, vowel: nuclei[j].vowel, glide: nuclei[j].glide, coda: [], epenthetic: false }
    out.push(syllable)
    const cluster = clusters[j + 1] ?? []
    if (j === nuclei.length - 1) {
      attachCoda(syllable, cluster, out)
      break
    }
    let coda: GraphemeUnit[]
    if (cluster.length <= 1) {
      coda = []
      onset = cluster
    } else if (isLegalOnsetCluster(cluster[cluster.length - 2], cluster[cluster.length - 1])) {
      coda = cluster.slice(0, -2)
      onset = cluster.slice(-2)
    } else {
      coda = cluster.slice(0, -1)
      onset = cluster.slice(-1)
    }
    attachCoda(syllable, coda, out)
  }
  return out
}

export function syllabify(word: string): OrthoSyllable[] {
  const lower = word.normalize("NFC").toLowerCase()
  return syllabifyOrthography(preprocessOrthography(lower), lower)
}

/** Representação legível ("rit-mo" → "ri-t(i)-mo"), para testes e depuração. */
export function syllablesToText(syllables: readonly OrthoSyllable[]): string {
  return syllables
    .map((syllable) => {
      const onset = syllable.onset.map((unit) => unit.g).join("")
      const coda = syllable.coda.map((unit) => unit.g).join("")
      return syllable.epenthetic ? `${onset}(i)${coda}` : `${onset}${syllable.vowel}${syllable.glide ?? ""}${coda}`
    })
    .join("-")
}
