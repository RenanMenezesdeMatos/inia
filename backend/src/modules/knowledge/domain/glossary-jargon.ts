import { createHash } from "node:crypto"
import { definitionForSearch } from "./query-acronyms.js"

/**
 * GÍRIA DO GLOSSÁRIO NO VETOR (opção 4, medida em 23/11/2026 — `docs/dev/busca-em-escala/README.md`, "Gíria do Glossário na seção").
 * O operador escreve "conta gêmea"; a base escreve "Duplicidade de cobrança". O Glossário liga os dois: termo = como a operação fala,
 * 1ª oração da definição = o termo oficial escrito na base. O trecho que cita o termo oficial ganha "Também chamado: conta gêmea" SÓ no
 * texto que vira vetor — a pergunta, o índice de texto (BM25) e o trecho lido pela IA não mudam.
 *
 * Não é lista de palavras da INIA: os pares vêm do cadastro do Glossário da organização. A comparação ignora acento e maiúsculas e é por
 * trecho contido (a mesma regra da medição). Sem regras = texto exatamente como antes (o hash do vetor não muda).
 */
export const GLOSSARY_JARGON_VERSION = "GLOSSARY_JARGON_VECTOR_V1" as const

/** Termo oficial com menos caracteres do que isto não enriquece nada (casaria com pedaços de palavra). */
export const MIN_OFFICIAL_CHARS = 3

export type JargonRule = { term: string; official: string }

export function foldForJargon(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
}

/** Regras do Glossário ativo: termo → termo oficial (1ª oração da definição, sem acento e minúsculo). Ordem estável, sem repetição. */
export function jargonRulesOf(glossary: readonly { term: string; definition: string }[]): JargonRule[] {
  const rules = new Map<string, JargonRule>()
  for (const entry of glossary) {
    const term = entry.term.trim()
    const official = foldForJargon(definitionForSearch(entry.definition ?? "")).trim()
    // Definição que começa pelo próprio termo não ensina nada à busca.
    if (!term || official.length < MIN_OFFICIAL_CHARS || official === foldForJargon(term)) continue
    rules.set(`${term}\u0000${official}`, { term, official })
  }
  return [...rules.values()].sort((left, right) => left.term.localeCompare(right.term, "pt-BR") || left.official.localeCompare(right.official))
}

/** Chave do Glossário com que uma versão foi indexada (`knowledge_embedding_index.jargon_key`). Sem regras = null (como antes). */
export function jargonKeyOf(rules: readonly JargonRule[]): string | null {
  if (rules.length === 0) return null
  return createHash("sha256").update(`${GLOSSARY_JARGON_VERSION}\n${rules.map((rule) => `${rule.term}\u0000${rule.official}`).join("\n")}`).digest("hex")
}

/** Termos do Glossário cujo termo oficial aparece no título da seção ou no texto do trecho. */
export function jargonTermsFor(chunk: { heading: string; text: string }, rules: readonly JargonRule[]): string[] {
  if (rules.length === 0) return []
  const folded = foldForJargon(`${chunk.heading}\n${chunk.text}`)
  return [...new Set(rules.filter((rule) => folded.includes(rule.official)).map((rule) => rule.term))]
}

export function jargonLine(terms: readonly string[]): string {
  return terms.length === 0 ? "" : `Também chamado: ${terms.join("; ")}.`
}
