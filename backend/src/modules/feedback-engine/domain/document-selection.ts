import { chunkKnowledgeDocument } from "../../knowledge/domain/knowledge-chunking.js"
import { rankChunks } from "../../knowledge/domain/lexical-retrieval.js"
import { selectPrimaryProcessDocument } from "../../knowledge/domain/primary-process.js"
import type { RulePerspective, SourceDocument } from "./procedure.js"

/**
 * QUAIS PROCEDIMENTOS O ANALISTA LÊ (domínio puro). Documentos INTEIROS — nunca trechos soltos — das bases autorizadas para o
 * especialista, na versão vigente na data da chamada. Cabendo no orçamento, entram todos (é o modelo quem decide qual rege o
 * cenário, e o sistema confere a escolha contra o assunto registrado). Não cabendo, a ordem é: documento ancorado pelo ASSUNTO
 * registrado (título) → relevância lexical do documento para a conversa → os demais; o que ficou de fora é registrado.
 */
export const DOCUMENT_BUDGET_CHARS = 90_000

export type CandidateDocument = { documentId: string; title: string; version: number; content: string; contentHash: string; perspective: RulePerspective }

/**
 * `PRODUCT_APPLICABILITY_V1`: documentos com abrangência por produto cadastrada (`productScoped`) nunca são ordenados ENTRE SI pela
 * relevância léxica — a palavra que aparece na conversa não escolhe o produto. Todos recebem a maior relevância do grupo e ficam juntos
 * na ordem neutra (título); o que o orçamento cortar fica registrado, e a identificação continua vendo o catálogo inteiro.
 */
export function selectDocumentsForCall(documents: readonly CandidateDocument[], input: { subject: string | null; transcript: string; budgetChars?: number; productScoped?: ReadonlySet<string> }): { selected: SourceDocument[]; omitted: { documentId: string; title: string; reason: "BUDGET" }[]; anchoredDocumentIds: string[] } {
  const budget = input.budgetChars ?? DOCUMENT_BUDGET_CHARS
  const primary = selectPrimaryProcessDocument(documents.map((document) => ({ documentId: document.documentId, documentTitle: document.title })), input.subject)
  const anchored = new Set(primary.candidates.map((candidate) => candidate.documentId))
  const chunks = documents.flatMap((document) => chunkKnowledgeDocument({ id: document.documentId, title: document.title, content: document.content }))
  const ranked = rankChunks(`${input.subject ?? ""}\n${input.transcript}`, chunks)
  const relevance = new Map<string, number>()
  const seen = new Map<string, number>()
  for (const chunk of ranked) {
    const count = seen.get(chunk.documentId) ?? 0
    if (count >= 3) continue
    seen.set(chunk.documentId, count + 1)
    relevance.set(chunk.documentId, (relevance.get(chunk.documentId) ?? 0) + chunk.score)
  }
  const scoped = documents.filter((document) => input.productScoped?.has(document.documentId))
  if (scoped.length > 1) {
    const top = Math.max(...scoped.map((document) => relevance.get(document.documentId) ?? 0))
    for (const document of scoped) relevance.set(document.documentId, top)
  }
  const ordered = [...documents].sort((a, b) => Number(anchored.has(b.documentId)) - Number(anchored.has(a.documentId)) || (relevance.get(b.documentId) ?? 0) - (relevance.get(a.documentId) ?? 0) || a.title.localeCompare(b.title, "pt-BR"))
  const total = ordered.reduce((sum, document) => sum + document.content.length, 0)
  const selected: SourceDocument[] = []
  const omitted: { documentId: string; title: string; reason: "BUDGET" }[] = []
  let used = 0
  for (const document of ordered) {
    const fits = total <= budget || used + document.content.length <= budget || selected.length === 0
    if (!fits) {
      omitted.push({ documentId: document.documentId, title: document.title, reason: "BUDGET" })
      continue
    }
    used += document.content.length
    selected.push({ ...document, selection: anchored.has(document.documentId) ? "SUBJECT_ANCHOR" : total <= budget ? "INCLUDED_ALL" : "RELEVANCE", relevance: relevance.get(document.documentId) ?? 0 })
  }
  return { selected, omitted, anchoredDocumentIds: [...anchored] }
}
