import { createHash } from "node:crypto"
import type { KnowledgeChunk } from "./knowledge-chunking.js"
import { sectionsOf, type CatalogSource } from "./knowledge-catalog.js"
import { jargonLine, jargonTermsFor, type JargonRule } from "./glossary-jargon.js"

/**
 * O QUE VIRA VETOR numa base publicada — só a estrutura que o documento já tem, nunca uma palavra escolhida pela INIA:
 *   - cada TRECHO (o mesmo corte de `knowledge-chunking.ts` usado pela busca de sempre), com o título da base e o da seção, para o
 *     significado do trecho não depender do vizinho;
 *   - um CARTÃO por documento (título, tipo e o sumário na ordem do documento), que serve para achar QUAL procedimento se aplica
 *     (motor de feedback) antes de ler o procedimento inteiro.
 * A chave do vetor é o hash do texto: mudou o texto, muda o hash e o vetor é gerado de novo; o que não mudou é reaproveitado.
 */
export const KNOWLEDGE_EMBEDDING_TEXT_VERSION = "KNOWLEDGE_EMBEDDING_TEXT_V1" as const

/** Caracteres do cartão (o sumário de documento muito longo é cortado no fim). */
export const DOCUMENT_CARD_MAX_CHARS = 6_000

export function contentHashOf(text: string): string {
  return createHash("sha256").update(`${KNOWLEDGE_EMBEDDING_TEXT_VERSION}\n${text}`).digest("hex")
}

/**
 * `products`: produtos cadastrados da base ("Família › Produto; …", `knowledge-products.ts`) — ausente = texto exatamente como antes.
 * `jargon`: regras do Glossário (`glossary-jargon.ts`); o trecho que cita um termo oficial ganha "Também chamado: …" — vazio = como antes.
 */
export function chunkEmbeddingText(chunk: Pick<KnowledgeChunk, "documentTitle" | "heading" | "text">, products?: string | null, jargon: readonly JargonRule[] = []): string {
  const header = [chunk.documentTitle, products ? `Produto: ${products}` : "", chunk.heading].map((line) => line.trim()).filter(Boolean).join("\n")
  const also = jargonLine(jargonTermsFor(chunk, jargon))
  return `${header}\n\n${chunk.text.trim()}${also ? `\n${also}` : ""}`.trim()
}

/** Cartão do documento: título e sumário na ordem do documento (o motor de feedback não conhece o tipo da base, então ele não entra). */
export function documentCardText(source: Pick<CatalogSource, "documentId" | "documentTitle" | "versionId" | "chunks">, products?: string | null): string {
  const outline = sectionsOf({ ...source, documentType: null }).map((section) => `- ${section.heading || section.preview || ""}`.trimEnd())
  let text = products ? `${source.documentTitle.trim()}\nProduto: ${products}` : source.documentTitle.trim()
  for (const entry of outline) {
    if (text.length + entry.length + 1 > DOCUMENT_CARD_MAX_CHARS) break
    text += `\n${entry}`
  }
  return text
}

/** Textos de uma versão: um por trecho (na ordem) + o cartão. `key` identifica o trecho (documentId#index) ou o cartão (documentId#card). */
export type EmbeddingText = { key: string; kind: "CHUNK" | "CARD"; documentId: string; chunkIndex: number | null; text: string; hash: string }

/**
 * `cardTitle`: o título com que o motor de feedback conhece o documento (o do cadastro da base), quando difere do título da versão que
 * vai nos trechos (o que o chat mostra). O cartão é gerado com o título que quem consulta vai usar — senão o hash não casa.
 */
export function embeddingTextsOf(source: Pick<CatalogSource, "documentId" | "documentTitle" | "versionId" | "chunks">, options: { cardTitle?: string; products?: string | null; jargon?: readonly JargonRule[] } = {}): EmbeddingText[] {
  const chunks = [...source.chunks].sort((left, right) => left.index - right.index).map((chunk): EmbeddingText => {
    const text = chunkEmbeddingText(chunk, options.products, options.jargon)
    return { key: `${source.documentId}#${chunk.index}`, kind: "CHUNK", documentId: source.documentId, chunkIndex: chunk.index, text, hash: contentHashOf(text) }
  })
  const card = documentCardText({ ...source, documentTitle: options.cardTitle ?? source.documentTitle }, options.products)
  return [...chunks, { key: `${source.documentId}#card`, kind: "CARD", documentId: source.documentId, chunkIndex: null, text: card, hash: contentHashOf(card) }]
}
