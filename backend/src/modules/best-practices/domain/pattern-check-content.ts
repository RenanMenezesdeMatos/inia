import { markSpan, neutralizeMarks, type MarkedContent } from "../../governance/domain/response-compliance.js"

export type PatternTexts = { name: string; description: string; guidance: string; suggestedPhrasing: string | null; notApplicableWhen: string | null; howItHelps: string | null }

/**
 * O que a conferência das respostas lê de uma boa prática, na aprovação (PEN-018): o texto próprio dela. A sugestão de fala orienta e conta como voz da INIA. Os
 * trechos de evidência das chamadas ficam de fora: são citação.
 */
export function patternCheckContent(pattern: PatternTexts): { text: string; content: MarkedContent } {
  const lines: [string, string | null][] = [["Nome", pattern.name], ["Descrição", pattern.description], ["Como aplicar", pattern.guidance], ["Como ajuda no resultado", pattern.howItHelps], ["Não se aplica quando", pattern.notApplicableWhen]]
  const present = lines.filter((line): line is [string, string] => Boolean(line[1]?.trim()))
  const phrasing = pattern.suggestedPhrasing?.trim() || null
  const plain = [...present.map(([label, value]) => `${label}: ${value}`), ...(phrasing ? [`Sugestão de fala: ${phrasing}`] : [])]
  const marked = [...present.map(([label, value]) => `${label}: ${neutralizeMarks(value)}`), ...(phrasing ? [`Sugestão de fala: ${markSpan("SUGGESTED", neutralizeMarks(phrasing))}`] : [])]
  return { text: plain.join("\n"), content: { marked: marked.join("\n"), protectedSpans: [] } }
}
