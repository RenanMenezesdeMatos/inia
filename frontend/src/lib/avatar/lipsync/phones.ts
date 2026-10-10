import type { PhoneClass, PhoneInfo, PhoneSymbol } from "./types"

/**
 * Inventário de fones do PT-BR usado pelo G2P e pelo alinhador.
 *
 * Durações base (ms) calibradas para fala conversacional em torno de 5,5 sílabas/s — a voz do
 * Gemini Live nas capturas de 2026-09-24 fica nessa faixa (≈ 3,5–4 s para 20 sílabas). Tonicidade
 * e posição (pré-pausa alonga, átona final encurta) são aplicadas pelo G2P em `durationPriorMs`.
 */
function phone(symbol: PhoneSymbol, phoneClass: PhoneClass, voiced: boolean, baseDurationMs: number, minDurationMs: number): PhoneInfo {
  return { symbol, class: phoneClass, voiced, baseDurationMs, minDurationMs }
}

export const PHONES: Readonly<Record<PhoneSymbol, PhoneInfo>> = Object.freeze({
  a: phone("a", "vowel", true, 95, 40),
  "6": phone("6", "vowel", true, 70, 30),
  e: phone("e", "vowel", true, 80, 35),
  E: phone("E", "vowel", true, 90, 40),
  i: phone("i", "vowel", true, 70, 30),
  o: phone("o", "vowel", true, 85, 35),
  O: phone("O", "vowel", true, 95, 40),
  u: phone("u", "vowel", true, 70, 30),
  "6~": phone("6~", "vowel", true, 100, 45),
  "e~": phone("e~", "vowel", true, 95, 40),
  "i~": phone("i~", "vowel", true, 90, 40),
  "o~": phone("o~", "vowel", true, 100, 45),
  "u~": phone("u~", "vowel", true, 95, 40),
  j: phone("j", "glide", true, 45, 20),
  w: phone("w", "glide", true, 45, 20),
  "j~": phone("j~", "glide", true, 50, 20),
  "w~": phone("w~", "glide", true, 55, 20),
  p: phone("p", "stop", false, 80, 45),
  b: phone("b", "stop", true, 70, 40),
  t: phone("t", "stop", false, 70, 35),
  d: phone("d", "stop", true, 60, 30),
  k: phone("k", "stop", false, 75, 40),
  g: phone("g", "stop", true, 60, 30),
  tS: phone("tS", "affricate", false, 95, 50),
  dZ: phone("dZ", "affricate", true, 85, 45),
  f: phone("f", "fricative", false, 90, 50),
  v: phone("v", "fricative", true, 65, 35),
  s: phone("s", "fricative", false, 95, 50),
  z: phone("z", "fricative", true, 70, 35),
  S: phone("S", "fricative", false, 100, 55),
  Z: phone("Z", "fricative", true, 75, 40),
  m: phone("m", "nasal", true, 70, 40),
  n: phone("n", "nasal", true, 60, 30),
  J: phone("J", "nasal", true, 70, 35),
  l: phone("l", "lateral", true, 55, 25),
  L: phone("L", "lateral", true, 70, 35),
  r: phone("r", "tap", true, 30, 15),
  R: phone("R", "rhotic", false, 70, 35),
  _: phone("_", "pause", false, 180, 60),
})

export function phoneInfo(symbol: PhoneSymbol): PhoneInfo {
  return PHONES[symbol]
}

export function isVowel(symbol: PhoneSymbol): boolean {
  return PHONES[symbol].class === "vowel"
}

export function isNasalVowel(symbol: PhoneSymbol): boolean {
  return symbol.endsWith("~") && PHONES[symbol].class === "vowel"
}

/** Fones que fecham os lábios — restrição visual forte (o erro de lip-sync mais perceptível). */
export function isBilabial(symbol: PhoneSymbol): boolean {
  return symbol === "p" || symbol === "b" || symbol === "m"
}

export function isLabiodental(symbol: PhoneSymbol): boolean {
  return symbol === "f" || symbol === "v"
}
