/**
 * GROUNDING NUMÉRICO POR PAPEL SEMÂNTICO (`TYPED_NUMBER_GROUNDING_V1`, domínio puro, sem LLM).
 *
 * A presença do mesmo dígito em qualquer lugar da chamada ou da base NÃO sustenta uma afirmação: "seu protocolo é 7" não é
 * sustentado por "a análise leva até 7 dias úteis" (PRAZO) nem por "7. Registrar protocolo." (NUMERAÇÃO DE LISTA). Cada número
 * recebe um PAPEL pelo seu contexto imediato, e um número afirmado só é sustentado por uma fonte com o MESMO papel e o MESMO valor.
 *
 *   PHONE         "(11) 98765-4321", ou número ligado a telefone/celular/WhatsApp/contato;
 *   LIST_ORDINAL  numeração editorial ("7. Registrar protocolo", "(3) confirme…", "35. Prazo da análise") — nunca sustenta nada
 *                 além de outra numeração igual;
 *   MONEY         "R$ 14,90", "14,90 reais";
 *   DATE          "29/09/2026", "dia 10", "22 de julho", ano depois de mês;
 *   DEADLINE      duração: "7 dias úteis", "48 horas", "2 semanas";
 *   PROTOCOL      número ligado a "protocolo" na mesma oração;
 *   QUANTITY      o resto (contagens soltas).
 *
 * Fatos de SISTEMA já tipados (ex.: um protocolo registrado vindo de uma fonte estruturada) entram como `TypedNumber` prontos.
 */
export const TYPED_NUMBER_GROUNDING_VERSION = "TYPED_NUMBER_GROUNDING_V1" as const

export type NumberRole = "PROTOCOL" | "DEADLINE" | "MONEY" | "DATE" | "PHONE" | "LIST_ORDINAL" | "QUANTITY"
export type TypedNumber = { role: NumberRole; value: string; raw: string }

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
/** Dígitos agrupados em blocos ("2026 0929 1234", "98765-4321") contam como UM número; decimal com vírgula/ponto também. */
const NUMBER_SPAN = /\(\d{2}\)\s?\d{4,5}-?\d{4}|\d{3,4}(?:[ \-.]\d{3,5}){1,4}(?!\d)|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d+(?:[.,]\d+)*/g
const MONTHS = "(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)"
const DURATION_AFTER = /^\s*(?:\p{L}+\s+)?(?:dias?|horas?|semanas?|mes(?:es)?|minutos?|uteis|corridos)(?!\p{L})/u
const DATE_AFTER = new RegExp(`^\\s*de\\s+${MONTHS}(?!\\p{L})`, "u")
const DAY_BEFORE = /(?<!\p{L})dia\s*$/u
const YEAR_BEFORE = new RegExp(`${MONTHS}\\s+de\\s*$`, "u")
const MONEY_BEFORE = /r\$\s*$/u
const MONEY_AFTER = /^\s*(?:reais|centavos)(?!\p{L})/u
const PHONE_CONTEXT = /(?<!\p{L})(?:telefone|celular|whats\s?app|contato|ddd)(?!\p{L})[^.!?\n]{0,30}$/u
const PROTOCOL_CONTEXT = /(?<!\p{L})protocolos?(?!\p{L})[^.!?\n]{0,40}$/u
/** Numeração editorial: início de linha (com marcador de lista opcional) seguido de "." ou ")" e texto; "(3)" numa enumeração. */
const ORDINAL_LINE_BEFORE = /(?:^|\n|[:;])\s*(?:[-*•]\s*)?(?:\[\s?[xX]?\]\s*)?$/u
const ORDINAL_AFTER = /^[.)]\s+\p{L}/u
const PAREN_ORDINAL = /\(\s*$/u

const valueOf = (role: NumberRole, raw: string) => {
  if (role === "MONEY") return raw.replace(/\s/g, "").replace(/\.(\d{2})$/, ",$1")
  if (role === "PROTOCOL" || role === "PHONE") return raw.replace(/\D/g, "")
  return raw.replace(/\s/g, "")
}

/** Prazo por extenso ("cinco dias úteis") é o MESMO dado que "5 dias úteis" — só com unidade de duração logo depois. */
const SPELLED: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, sessenta: 60, noventa: 90 }
const SPELLED_DURATION = new RegExp(`(?<!\\p{L})(${Object.keys(SPELLED).join("|")})(?=\\s+(?:\\p{L}+\\s+)?(?:dias?|horas?|semanas?|mes(?:es)?|minutos?)(?!\\p{L}))`, "gu")

/** Cada número do texto com o seu papel pelo contexto imediato (ordem: telefone, numeração, dinheiro, data, prazo, protocolo). */
export function typedNumbersIn(text: string, options: { spelled?: boolean } = {}): TypedNumber[] {
  const found: TypedNumber[] = []
  for (const match of text.matchAll(NUMBER_SPAN)) {
    const raw = match[0]
    const start = match.index ?? 0
    const beforeRaw = text.slice(Math.max(0, start - 80), start)
    const before = fold(beforeRaw)
    const after = fold(text.slice(start + raw.length, start + raw.length + 40))
    const role: NumberRole =
      /^\(\d{2}\)/.test(raw) || (PHONE_CONTEXT.test(before) && raw.replace(/\D/g, "").length >= 8) ? "PHONE"
      : /^\d{1,2}$/.test(raw) && ((ORDINAL_LINE_BEFORE.test(beforeRaw) && ORDINAL_AFTER.test(after)) || (PAREN_ORDINAL.test(before) && /^\s*\)/.test(after))) ? "LIST_ORDINAL"
      : MONEY_BEFORE.test(before) || MONEY_AFTER.test(after) ? "MONEY"
      : raw.includes("/") || DATE_AFTER.test(after) || DAY_BEFORE.test(before) || (/^(?:19|20)\d{2}$/.test(raw) && YEAR_BEFORE.test(before)) ? "DATE"
      : DURATION_AFTER.test(after) ? "DEADLINE"
      : PROTOCOL_CONTEXT.test(before) ? "PROTOCOL"
      : "QUANTITY"
    found.push({ role, value: valueOf(role, raw), raw })
  }
  if (options.spelled !== false) for (const match of fold(text).matchAll(SPELLED_DURATION)) found.push({ role: "DEADLINE", value: String(SPELLED[match[1]!]), raw: match[1]! })
  return found
}

/**
 * Números AFIRMADOS no texto sem uma fonte do mesmo papel e valor (entre os textos-fonte e os fatos de sistema já tipados).
 * Vazio = todo número está sustentado.
 */
export function unsupportedTypedNumbers(claim: string, sources: readonly string[], systemFacts: readonly TypedNumber[] = []): TypedNumber[] {
  const grounded = new Set([...sources.flatMap((source) => typedNumbersIn(source)), ...systemFacts].map((entry) => `${entry.role}|${entry.value}`))
  // O lado AFIRMADO confere só dígitos (por extenso segue com as guardas de sempre); as FONTES valem também por extenso.
  return typedNumbersIn(claim, { spelled: false }).filter((entry) => !grounded.has(`${entry.role}|${entry.value}`))
}

/** O número afirmado aparece, com o MESMO papel, em algum texto (usado para distinguir "fato só de exemplo da base"). */
export const hasTypedNumber = (entry: TypedNumber, texts: readonly string[]) => texts.flatMap((text) => typedNumbersIn(text)).some((other) => other.role === entry.role && other.value === entry.value)
