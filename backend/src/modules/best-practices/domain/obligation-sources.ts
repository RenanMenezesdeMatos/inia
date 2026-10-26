import type { ObligationSource, ObligationSourceLine } from "./obligation-check.js"

/**
 * FONTES DE OBRIGAÇÃO em linhas citáveis (domínio puro). O modelo cita a linha pelo handle (D1.L14, G1.3, P5) e copia o trecho; o
 * código confere o trecho contra a linha. Nada aqui interpreta o sentido de uma regra — só formata.
 */

/** `BEST_PRACTICE_OBLIGATION_PROMPT_V2`: o "Vale para" de cada fonte (produtos do cadastro de abrangência); fonte sem abrangência fica como está. */
export function withAppliesTo(sources: readonly ObligationSource[], scopeOf: (source: ObligationSource) => readonly string[]): ObligationSource[] {
  return sources.map((source) => {
    const names = [...new Set(scopeOf(source).map((name) => name.trim()).filter((name) => name.length > 0))]
    return names.length > 0 ? { ...source, appliesTo: names } : source
  })
}
export const MAX_LINES_PER_DOCUMENT = 400
export const MAX_PRACTICES = 80

export function documentSource(handle: string, input: { sourceId: string; title: string; version: number | null; content: string }): ObligationSource {
  const lines: ObligationSourceLine[] = []
  let heading: string | null = null
  for (const raw of input.content.split(/\r?\n/)) {
    const text = raw.trim()
    if (text.length === 0) continue
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(text)
    if (headingMatch) {
      heading = headingMatch[1]!.trim()
      continue
    }
    if (lines.length >= MAX_LINES_PER_DOCUMENT) break
    lines.push({ handle: `${handle}.L${lines.length + 1}`, text: text.replace(/^[-*•]\s+/, ""), heading, marker: null })
  }
  return { handle, kind: "DOCUMENT", sourceId: input.sourceId, title: input.title, version: input.version, lines }
}

/** Marca do campo do argumentário (estrutura do cadastro, nunca leitura do texto): DEVE/PODE da orientação, ponto obrigatório, evitar. */
export type ScriptItem = { marker: "DEVE" | "PODE" | "EVITAR" | "PONTO OBRIGATÓRIO" | "ORIENTAÇÃO"; text: string }
export function argumentScriptSource(handle: string, input: { sourceId: string; title: string; version: number | null; items: readonly ScriptItem[] }): ObligationSource {
  return { handle, kind: "ARGUMENT_SCRIPT", sourceId: input.sourceId, title: input.title, version: input.version, lines: input.items.map((item, index) => ({ handle: `${handle}.${index + 1}`, text: item.text, heading: null, marker: item.marker })) }
}

export function practiceSource(practices: readonly { practiceKey: string; title: string; example: string | null }[]): ObligationSource | null {
  if (practices.length === 0) return null
  return {
    handle: "P",
    kind: "PRACTICE",
    sourceId: "knowledge_practices",
    title: "Pontos do processo usados no diagnóstico",
    version: null,
    lines: practices.slice(0, MAX_PRACTICES).map((practice, index) => ({ handle: `P${index + 1}`, text: practice.example ? `${practice.title} — ${practice.example}` : practice.title, heading: null, marker: null })),
  }
}
