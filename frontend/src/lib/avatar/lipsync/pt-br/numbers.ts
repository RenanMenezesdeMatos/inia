/**
 * Números por extenso em PT-BR (cardinais, ordinais, decimais, dinheiro, horas, datas).
 *
 * Saída = lista de palavras faladas em minúsculas, prontas para o G2P. Regra do "e" entre grupos:
 * entra antes do ÚLTIMO grupo não nulo quando ele é < 100 ou centena redonda — "dois mil e vinte e
 * seis", "mil e quinhentos", "um milhão e quinhentos mil", mas "mil cento e dez".
 */

const UNITS_M = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"]
const UNITS_F = ["zero", "uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"]
const TEENS = ["dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
const HUNDREDS_M = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"]
const HUNDREDS_F = ["", "cento", "duzentas", "trezentas", "quatrocentas", "quinhentas", "seiscentas", "setecentas", "oitocentas", "novecentas"]

const ORDINAL_UNITS = ["", "primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto", "sétimo", "oitavo", "nono"]
const ORDINAL_TENS = ["", "décimo", "vigésimo", "trigésimo", "quadragésimo", "quinquagésimo", "sexagésimo", "septuagésimo", "octogésimo", "nonagésimo"]
const ORDINAL_HUNDREDS = ["", "centésimo", "ducentésimo", "trecentésimo", "quadringentésimo", "quingentésimo", "sexcentésimo", "septingentésimo", "octingentésimo", "noningentésimo"]

const MONTHS = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]

/** Acima disso a leitura por extenso vira ruído; lê dígito a dígito. */
const MAX_CARDINAL = 999_999_999_999

function below1000(n: number, feminine: boolean): string[] {
  if (n === 0) return []
  if (n === 100) return ["cem"]
  const words: string[] = []
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  if (hundreds > 0) words.push((feminine ? HUNDREDS_F : HUNDREDS_M)[hundreds])
  if (rest > 0) {
    if (hundreds > 0) words.push("e")
    if (rest < 10) words.push((feminine ? UNITS_F : UNITS_M)[rest])
    else if (rest < 20) words.push(TEENS[rest - 10])
    else {
      words.push(TENS[Math.floor(rest / 10)])
      if (rest % 10 > 0) words.push("e", (feminine ? UNITS_F : UNITS_M)[rest % 10])
    }
  }
  return words
}

/** Cardinal por extenso. `feminine` concorda unidades/centenas ("duas", "duzentas"), nunca "milhão". */
export function cardinalWords(n: number, feminine = false): string[] {
  if (!Number.isFinite(n)) return []
  if (n < 0) return ["menos", ...cardinalWords(-n, feminine)]
  const value = Math.floor(n)
  if (value === 0) return ["zero"]
  if (value > MAX_CARDINAL) return digitWords(String(value))
  const billions = Math.floor(value / 1e9)
  const millions = Math.floor((value % 1e9) / 1e6)
  const thousands = Math.floor((value % 1e6) / 1e3)
  const units = value % 1e3
  const groups: { words: string[]; value: number }[] = []
  if (billions > 0) groups.push({ words: [...below1000(billions, false), billions === 1 ? "bilhão" : "bilhões"], value: billions })
  if (millions > 0) groups.push({ words: [...below1000(millions, false), millions === 1 ? "milhão" : "milhões"], value: millions })
  if (thousands > 0) groups.push({ words: thousands === 1 ? ["mil"] : [...below1000(thousands, feminine), "mil"], value: thousands })
  if (units > 0) groups.push({ words: below1000(units, feminine), value: units })
  const words: string[] = []
  groups.forEach((group, index) => {
    const last = index === groups.length - 1
    if (index > 0 && last && (group.value < 100 || group.value % 100 === 0)) words.push("e")
    words.push(...group.words)
  })
  return words
}

/** Ordinal por extenso até 999 ("1º" → "primeiro", "21ª" → "vigésima primeira"); acima, cardinal. */
export function ordinalWords(n: number, feminine = false): string[] {
  if (!Number.isInteger(n) || n <= 0 || n > 999) return cardinalWords(n, feminine)
  const words: string[] = []
  const hundreds = Math.floor(n / 100)
  const tens = Math.floor((n % 100) / 10)
  const units = n % 10
  if (hundreds > 0) words.push(ORDINAL_HUNDREDS[hundreds])
  if (tens > 0) words.push(ORDINAL_TENS[tens])
  if (units > 0) words.push(ORDINAL_UNITS[units])
  return feminine ? words.map((word) => word.replace(/o$/, "a")) : words
}

const DIGIT_NAMES = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"]

/** Dígito a dígito (protocolos, telefones, "0800"). */
export function digitWords(digits: string): string[] {
  const words: string[] = []
  for (const char of digits) {
    const digit = char.charCodeAt(0) - 48
    if (digit >= 0 && digit <= 9) words.push(DIGIT_NAMES[digit])
  }
  return words
}

export type ParsedNumber = {
  integer: number
  /** Dígitos depois da vírgula decimal (string, para preservar zeros à esquerda). */
  fraction: string | null
  /** Separador decimal escrito (",": vírgula; ".": ponto, leitura em inglês/técnica). */
  decimalMark: "," | "." | null
  negative: boolean
  /** Sequência de dígitos que só faz sentido lida um a um (protocolo, 0800…). */
  digitString: string | null
}

const THOUSANDS_DOT = /^(\d{1,3})((?:\.\d{3})+)(?:,(\d+))?$/
const PLAIN_COMMA = /^(\d+)(?:,(\d+))?$/
const DOT_DECIMAL = /^(\d+)\.(\d{1,2}|\d{4,})$/

/** Número escrito em PT-BR ("1.234,56", "3,5", "2026", "-5"). null se não for número. */
export function parseNumber(text: string): ParsedNumber | null {
  let body = text
  let negative = false
  if (body.startsWith("-") || body.startsWith("−")) {
    negative = true
    body = body.slice(1)
  } else if (body.startsWith("+")) body = body.slice(1)
  if (body.length === 0) return null
  let match = THOUSANDS_DOT.exec(body)
  if (match) {
    return { integer: Number(match[1] + match[2].replace(/\./g, "")), fraction: match[3] ?? null, decimalMark: match[3] ? "," : null, negative, digitString: null }
  }
  match = PLAIN_COMMA.exec(body)
  if (match) {
    const integerText = match[1]
    // Sequências longas ou com zero à esquerda (protocolo, 0800) são lidas dígito a dígito.
    if (!match[2] && (integerText.length > 12 || (integerText.length > 1 && integerText.startsWith("0")))) {
      return { integer: 0, fraction: null, decimalMark: null, negative, digitString: integerText }
    }
    return { integer: Number(integerText), fraction: match[2] ?? null, decimalMark: match[2] ? "," : null, negative, digitString: null }
  }
  match = DOT_DECIMAL.exec(body)
  if (match) return { integer: Number(match[1]), fraction: match[2], decimalMark: ".", negative, digitString: null }
  return null
}

/** Parte decimal: até dois dígitos sem zero à esquerda viram número ("3,50" → "cinquenta"); senão dígito a dígito. */
function fractionWords(fraction: string): string[] {
  if (fraction.length <= 2 && !fraction.startsWith("0")) return cardinalWords(Number(fraction))
  return digitWords(fraction)
}

export function numberWords(parsed: ParsedNumber, feminine = false): string[] {
  if (parsed.digitString) return digitWords(parsed.digitString)
  const words = cardinalWords(parsed.integer, feminine && parsed.fraction === null)
  if (parsed.fraction !== null) words.push(parsed.decimalMark === "." ? "ponto" : "vírgula", ...fractionWords(parsed.fraction))
  return parsed.negative ? ["menos", ...words] : words
}

export type CurrencyName = { singular: string; plural: string; fractionSingular: string; fractionPlural: string }

export const CURRENCIES: Readonly<Record<string, CurrencyName>> = {
  "R$": { singular: "real", plural: "reais", fractionSingular: "centavo", fractionPlural: "centavos" },
  "US$": { singular: "dólar", plural: "dólares", fractionSingular: "centavo", fractionPlural: "centavos" },
  $: { singular: "dólar", plural: "dólares", fractionSingular: "centavo", fractionPlural: "centavos" },
  "€": { singular: "euro", plural: "euros", fractionSingular: "cêntimo", fractionPlural: "cêntimos" },
  "£": { singular: "libra", plural: "libras", fractionSingular: "centavo", fractionPlural: "centavos" },
}

const SCALE_WORDS = new Set(["mil", "milhão", "milhões", "bilhão", "bilhões"])

export function isScaleWord(word: string): boolean {
  return SCALE_WORDS.has(word.toLowerCase())
}

/**
 * Dinheiro: "R$ 10,50" → "dez reais e cinquenta centavos"; "R$ 0,50" → "cinquenta centavos";
 * "R$ 2 mil" → "dois mil reais"; "R$ 1,5 milhão" → "um vírgula cinco milhão de reais".
 */
export function currencyWords(currency: CurrencyName, parsed: ParsedNumber, scale: string | null): string[] {
  const feminine = currency.singular === "libra"
  if (scale) {
    const scaleWord = scale.toLowerCase()
    const words = [...numberWords(parsed, feminine && scaleWord === "mil"), scaleWord]
    // "milhão/bilhão" pedem "de": "dois milhões de reais".
    if (scaleWord !== "mil") words.push("de")
    words.push(currency.plural)
    return words
  }
  if (parsed.digitString) return [...digitWords(parsed.digitString), currency.plural]
  const integer = parsed.integer
  const cents = parsed.fraction === null ? 0 : Number(parsed.fraction.padEnd(2, "0").slice(0, 2))
  const words: string[] = parsed.negative ? ["menos"] : []
  if (integer > 0 || cents === 0) {
    const integerWords = cardinalWords(integer, feminine)
    words.push(...integerWords)
    // "um milhão de reais", "dois mil reais".
    const lastWord = integerWords[integerWords.length - 1]
    if (lastWord === "milhão" || lastWord === "milhões" || lastWord === "bilhão" || lastWord === "bilhões") words.push("de")
    words.push(integer === 1 ? currency.singular : currency.plural)
  }
  if (cents > 0) {
    if (integer > 0) words.push("e")
    words.push(...cardinalWords(cents), cents === 1 ? currency.fractionSingular : currency.fractionPlural)
  }
  return words
}

/**
 * Horário ("8h", "8h30", "8:30", "12:00h", "8h30min"). "8h30" → "oito e trinta"; "8h" → "oito
 * horas"; com "min" explícito → "oito horas e trinta minutos". null se não for horário válido.
 */
export function timeWords(text: string): string[] | null {
  let match = /^(\d{1,2})[hH](?:(\d{2})([mM][iI][nN])?)?$/.exec(text)
  let hours: number
  let minutes: number | null
  let explicitMinutes = false
  if (match) {
    hours = Number(match[1])
    minutes = match[2] === undefined ? null : Number(match[2])
    explicitMinutes = match[3] !== undefined
  } else {
    match = /^(\d{1,2}):(\d{2})(?:[hH][sS]?)?$/.exec(text)
    if (!match) return null
    hours = Number(match[1])
    minutes = Number(match[2])
  }
  if (hours > 24 || (minutes !== null && minutes > 59)) return null
  const hourWords = cardinalWords(hours, true)
  if (minutes === null || minutes === 0) return [...hourWords, hours === 1 ? "hora" : "horas"]
  if (explicitMinutes) return [...hourWords, hours === 1 ? "hora" : "horas", "e", ...cardinalWords(minutes), minutes === 1 ? "minuto" : "minutos"]
  return [...hourWords, "e", ...cardinalWords(minutes)]
}

/** Data "24/09" ou "24/09/2026" → "vinte e quatro de setembro (de dois mil e vinte e seis)". */
export function dateWords(text: string): string[] | null {
  const match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(text)
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  if (day < 1 || day > 31 || month < 1 || month > 12) return null
  const words = day === 1 ? ["primeiro"] : cardinalWords(day)
  words.push("de", MONTHS[month])
  if (match[3] !== undefined) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
    words.push("de", ...cardinalWords(year))
  }
  return words
}
