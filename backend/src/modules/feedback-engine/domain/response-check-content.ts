import { markSpan, neutralizeMarks, type ComplianceMark, type MarkedContent } from "../../governance/domain/response-compliance.js"
import type { FeedbackBrief } from "./feedback-brief.js"
import type { FeedbackView, FeedbackViewQuote } from "./feedback-view.js"
import { replaceQuotesWithOrigin } from "./literal-quotes.js"

/**
 * O que a conferência das respostas lê de uma mensagem do motor (PEN-018): todo texto que a pessoa recebe, com a origem de cada citação marcada. O sistema já
 * sabe a origem, porque ele mesmo coloca as falas no texto. Blocos montados só com dados (ciclo, assuntos, materiais) e as boas práticas, conferidas na aprovação,
 * ficam de fora. Só lê: nada aqui muda a mensagem.
 */
export function feedbackMessageContent(view: FeedbackView, brief: FeedbackBrief): { text: string; content: MarkedContent } {
  const plain: string[] = []
  const marked: string[] = []
  const protectedSpans = new Set<string>()
  const cite = (mark: ComplianceMark, value: string) => {
    if (mark !== "SUGGESTED") protectedSpans.add(value)
    return markSpan(mark, neutralizeMarks(value))
  }
  /** Texto na voz da INIA, que pode trazer citações entre aspas. */
  const voice = (value: string | null | undefined) => {
    if (!value?.trim()) return
    plain.push(value)
    marked.push(replaceQuotesWithOrigin(neutralizeMarks(value), brief, (origin, segment) => `“${cite(origin, segment)}”`))
  }
  const quoted = (mark: ComplianceMark, value: string | null | undefined) => {
    if (!value?.trim()) return
    plain.push(value)
    marked.push(cite(mark, value))
  }
  const callQuote = (quote: FeedbackViewQuote | null) => {
    if (!quote) return
    voice(quote.intro)
    quoted("CALL", quote.text)
  }
  voice(view.card)
  voice(view.greeting)
  view.narrative.forEach(voice)
  for (const development of view.developments) {
    voice(development.title)
    voice(development.whatHappened)
    if (development.call.kind === "QUOTES") development.call.quotes.forEach(callQuote)
    if (development.call.kind === "ABSENCE") {
      voice(development.call.statement)
      callQuote(development.call.context)
    }
    development.adjustment.forEach(voice)
    development.guidance.rules.forEach((rule) => quoted("RULE", rule.text))
    development.guidance.avoid.forEach(voice)
    development.guidance.examples.forEach((example) => quoted("SUGGESTED", example))
    development.whyItMatters.forEach(voice)
    voice(development.howToApply)
    quoted("SUGGESTED", development.suggestedResponse)
  }
  voice(view.maintain?.summary)
  for (const evidence of view.maintain?.evidence ?? []) {
    voice(evidence.title)
    voice(evidence.statement)
    evidence.quotes.forEach(callQuote)
  }
  for (const item of view.attention) {
    voice(item.title)
    voice(item.markdown)
  }
  voice(view.context)
  return { text: plain.join("\n"), content: { marked: marked.join("\n"), protectedSpans: [...protectedSpans] } }
}
