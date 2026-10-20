import type { KnowledgeChunk } from "./knowledge-chunking.js"

/**
 * CATÁLOGO das bases para o esclarecimento — puro e ESTRUTURAL. Nada aqui interpreta a pergunta: não há ranqueamento, lista de
 * palavras, radical nem expressão sobre o texto de quem pergunta. O código só expõe a estrutura que o próprio documento tem (o
 * título da base, os títulos de seção na ordem em que aparecem, o começo de um trecho sem título) e lê uma seção pelo id quando a
 * IA pede. Quem decide o que é pertinente é a IA (`knowledge-clarification`).
 */
export const KNOWLEDGE_CATALOG_VERSION = "KNOWLEDGE_CATALOG_V1" as const

export type CatalogSource = { documentId: string; documentTitle: string; versionId: string; documentType: string | null; chunks: readonly KnowledgeChunk[] }

/** Uma entrada do sumário: a seção (pela primeira parte dela) ou, num documento sem títulos, um trecho com o começo do texto. */
export type CatalogSection = { documentId: string; documentTitle: string; versionId: string; heading: string; chunkIndex: number; preview: string | null }

export const SECTION_PREVIEW_CHARS = 140

/** Sumário de uma base na ordem do documento: uma entrada por seção (partes seguidas com o mesmo título contam uma vez) e uma por
 * trecho sem título de seção (com o começo do texto, para a IA saber do que se trata). */
export function sectionsOf(source: CatalogSource, previewChars = SECTION_PREVIEW_CHARS): CatalogSection[] {
  const sections: CatalogSection[] = []
  let previousHeading: string | null = null
  for (const chunk of [...source.chunks].sort((left, right) => left.index - right.index)) {
    const base = { documentId: source.documentId, documentTitle: source.documentTitle, versionId: source.versionId, chunkIndex: chunk.index }
    if (chunk.heading) {
      if (chunk.heading === previousHeading) continue
      previousHeading = chunk.heading
      sections.push({ ...base, heading: chunk.heading, preview: null })
      continue
    }
    previousHeading = null
    const text = chunk.text.split("\n").map((line) => line.trim()).filter(Boolean).join(" ")
    sections.push({ ...base, heading: "", preview: text.length > previewChars ? `${text.slice(0, previewChars - 1).trimEnd()}…` : text })
  }
  return sections
}

/** Caracteres que o sumário de uma base ocupa no prompt (título ou prévia de cada entrada). */
export function outlineSize(source: CatalogSource): number {
  return sectionsOf(source).reduce((sum, section) => sum + (section.heading || section.preview || "").length + 8, 0)
}

/**
 * CONSULTA DIRECIONADA: o texto inteiro da seção de um trecho (as partes seguidas com o mesmo título), limitado. Seção sem título
 * = só o próprio trecho. null = o trecho não existe nesta versão da base.
 */
export function sectionOf(source: CatalogSource, chunkIndex: number, maxChars = 6_000): { heading: string; text: string; chunkIndexes: number[] } | null {
  const sorted = [...source.chunks].sort((left, right) => left.index - right.index)
  const position = sorted.findIndex((chunk) => chunk.index === chunkIndex)
  if (position === -1) return null
  const anchor = sorted[position]!
  if (!anchor.heading) return { heading: "", text: anchor.text.slice(0, maxChars), chunkIndexes: [anchor.index] }
  let start = position
  while (start > 0 && sorted[start - 1]!.heading === anchor.heading) start -= 1
  const parts: KnowledgeChunk[] = []
  let chars = 0
  for (let index = start; index < sorted.length && sorted[index]!.heading === anchor.heading; index += 1) {
    const chunk = sorted[index]!
    if (parts.length > 0 && chars + chunk.text.length > maxChars) break
    parts.push(chunk)
    chars += chunk.text.length
  }
  return { heading: anchor.heading, text: parts.map((chunk) => chunk.text).join("\n\n").slice(0, maxChars), chunkIndexes: parts.map((chunk) => chunk.index) }
}
