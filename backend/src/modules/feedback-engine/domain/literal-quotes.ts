import type { BriefRule, FeedbackBrief } from "./feedback-brief.js"

/**
 * FALAS LITERAIS POR REFERÊNCIA (`LITERAL_QUOTES_V1`, 21/10/2026). O redator nunca digita uma fala: cita pelo id dela ([[Q3]]) e o
 * SISTEMA coloca o texto exato da chamada, entre aspas — a IA escolhe o trecho, o texto é sempre o da fonte (citação determinística).
 * Fala com mais de uma frase tem partes ([[Q3.2]] = a 2ª frase; [[Q3.1-2]] = da 1ª à 2ª): numa fala longa, cita-se só o que importa.
 * Tudo o que aparecer entre aspas na mensagem tem de ser igual a uma fala da chamada, a uma linha de regra ou à fraseologia do
 * argumentário (uma ou mais frases inteiras seguidas — recorte no meio da frase não vale); senão a frase é recusada. Integridade de
 * dado, nunca leitura de sentido.
 * V2 (22/10/2026, `BASE_PRACTICES_IN_TEXT_V1`): [[B1]] coloca a fala sugerida da prática da base B1 (exemplo para experimentar, nunca fala
 * de uma chamada), exata, entre aspas — e essa fala passa a valer como texto literal.
 */
export const LITERAL_QUOTES_VERSION = "LITERAL_QUOTES_V2" as const

/** Falas da chamada que o caso traz, na ordem em que aparecem, sem repetir — base dos ids e da checagem. */
export function callQuoteTextsOf(brief: FeedbackBrief): string[] {
  const texts = [
    ...(brief.scenarioQuotes ?? []).map((quote) => quote.text),
    ...[...brief.developments, ...brief.strengths].flatMap((finding) => [...finding.quotes.map((quote) => quote.text), ...(finding.absence?.opportunity ? [finding.absence.opportunity.text] : []), ...(finding.steps ?? []).flatMap((step) => step.quotes.map((quote) => quote.text))]),
    ...(brief.openPoints ?? []).flatMap((point) => point.quotes.map((quote) => quote.text)),
    ...(brief.coverageLimits ?? []).flatMap((limit) => (limit.saidIn ?? []).map((said) => said.quote)),
  ]
  return [...new Set(texts.filter((text) => text.trim().length > 0))]
}

/** Id de cada fala (texto → "Q1", "Q2"…), estável para o mesmo brief: o redator e o sistema usam o mesmo. */
export const quoteIdsOf = (brief: FeedbackBrief) => new Map(callQuoteTextsOf(brief).map((text, index) => [text, `Q${index + 1}`]))

/** Frases de uma fala (mesma divisão da checagem literal): a parte n de [[Qk.n]]. */
export const quoteSentencesOf = (text: string) => text.split(/(?<=[.!?…])\s+/u).map((sentence) => sentence.trim()).filter(Boolean)

// O ponto logo depois da referência entra no grupo 4: quando a fala já termina com pontuação final, ele não se repete (“…fraude.”.).
const REFERENCE = /\[\[\s*(Q\d{1,3})(?:\.(\d{1,2})(?:\s*-\s*(\d{1,2}))?)?\s*\]\](\.(?![.\d]))?/giu
const PRACTICE_REFERENCE = /\[\[\s*(B\d{1,2})\s*\]\](\.(?![.\d]))?/giu
const ENDS_SENTENCE = /[.!?…]$/u
/** Troca cada [[Qn]] (ou a parte [[Qn.k]] / [[Qn.k-m]]) pela fala exata entre aspas curvas — e cada [[Bn]] pela fala sugerida da prática. Referência desconhecida — ou parte que a fala
 * não tem — fica como está (a checagem local a recusa). Se a fala termina com ponto, interrogação, exclamação ou reticências e a frase
 * do redator acaba logo depois dela, o ponto final do redator sai (a fala já fecha a frase); a fala nunca muda. */
export function resolveQuoteRefs(text: string, brief: FeedbackBrief): string {
  const byId = new Map([...quoteIdsOf(brief)].map(([quote, id]) => [id, quote]))
  return text.replace(REFERENCE, (reference, id: string, from?: string, to?: string, period?: string) => {
    const quote = byId.get(id.toUpperCase())
    if (!quote) return reference
    let cited = quote.trim()
    if (from) {
      const sentences = quoteSentencesOf(quote)
      const start = Number(from)
      const end = to ? Number(to) : start
      if (start < 1 || end < start || end > sentences.length) return reference
      cited = sentences.slice(start - 1, end).join(" ")
    }
    return `“${cited}”${period && !ENDS_SENTENCE.test(cited) ? period : ""}`
  }).replace(PRACTICE_REFERENCE, (reference, id: string, period?: string) => {
    const phrasing = (brief.basePractices ?? []).find((practice) => practice.ref === id.toUpperCase())?.suggestedPhrasing?.trim()
    if (!phrasing) return reference
    return `“${phrasing}”${period && !ENDS_SENTENCE.test(phrasing) ? period : ""}`
  })
}
export const hasUnresolvedReference = (text: string) => /\[\[[^\]]*\]\]/u.test(text)

const rulesOfBrief = (brief: FeedbackBrief): BriefRule[] => [
  ...[...brief.developments, ...brief.strengths].flatMap((finding) => [...finding.rules, ...finding.quotes.flatMap((quote) => (quote.call ? [quote.call.rule] : [])), ...(finding.steps ?? []).flatMap((step) => step.rules ?? (step.rule ? [step.rule] : []))]),
  ...(brief.openPoints ?? []).flatMap((point) => point.rules),
  ...(brief.referencePractices ?? []).map((practice) => practice.rule),
  ...(brief.centralNeedOpen?.rules ?? []),
  ...(brief.productScope?.rulesNotEstablished ?? []),
]
/** Textos que podem aparecer entre aspas: falas da chamada, cada linha de regra (sem o marcador de lista), a fraseologia do argumentário
 * e a fala sugerida das práticas da base (V2). */
function literalSourcesOf(brief: FeedbackBrief): string[] {
  const ruleLines = rulesOfBrief(brief).flatMap((rule) => [rule.text, ...(rule.leadIn ? [rule.leadIn] : []), ...(rule.phrasing ? [rule.phrasing.text] : [])]).flatMap((text) => text.split("\n"))
  const practicePhrasings = (brief.basePractices ?? []).flatMap((practice) => (practice.suggestedPhrasing ? [practice.suggestedPhrasing] : []))
  return [...callQuoteTextsOf(brief), ...ruleLines.map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, "")), ...practicePhrasings]
}

/** Mesma grafia: sem negrito, aspas e espaços nas pontas, sem a pontuação final e sem diferença de maiúscula (acento conta). */
const normalized = (text: string) => text.replace(/\*\*/gu, "").replace(/\s+/gu, " ").trim().replace(/^["“”'‘’«»\s]+|["“”'‘’«»\s]+$/gu, "").replace(/[.,;:!?…]+$/u, "").trim().toLowerCase()
/** Uma ou mais frases inteiras SEGUIDAS de cada fonte (a fala “Lá eles te atendem. Aguarda que vou transferir.” vale inteira ou por frase). */
function literalRunsOf(source: string): string[] {
  const sentences = quoteSentencesOf(source)
  const runs: string[] = []
  for (let start = 0; start < sentences.length; start += 1) for (let end = start; end < sentences.length; end += 1) runs.push(normalized(sentences.slice(start, end + 1).join(" ")))
  return runs
}
const QUOTED = /“([^”]+)”|"([^"\n]+)"|«([^»]+)»|‘([^’]+)’|(?<![\p{L}\p{N}])'([^'\n]{2,}?)'(?![\p{L}\p{N}])/gu
export const quotedSegmentsOf = (text: string) => [...text.matchAll(QUOTED)].map((match) => (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? "").trim()).filter(Boolean)

/** Trechos entre aspas que NÃO são literais da chamada, da regra nem do argumentário (vazio = tudo certo). */
export function nonLiteralQuotesOf(text: string, brief: FeedbackBrief): string[] {
  const segments = quotedSegmentsOf(text)
  if (segments.length === 0) return []
  const allowed = new Set(literalSourcesOf(brief).flatMap(literalRunsOf))
  return segments.filter((segment) => !allowed.has(normalized(segment)))
}
