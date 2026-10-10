/**
 * V1.7.1m — DOCUMENTO PRIMÁRIO DO PROCESSO (`PRIMARY_PROCESS_DOCUMENT_V1`, domínio puro, sem LLM, nunca pelo ranking).
 *
 * No smoke V1.7.1l o plano de cobertura do fechamento elegeu como "processo" o documento de MAIOR relevância somada no ranking
 * lexical — o "Procedimento Operacional Jeito Vivo de Atender", uma diretriz TRANSVERSAL de atendimento — e as seções de
 * fechamento do procedimento ESPECÍFICO (46. Recapitulação obrigatória, 47, 48 de "Contestação de Contas Móvel") ficaram fora.
 * A recapitulação composta do processo real foi substituída pelo "Recapitulei as ações?" genérico.
 *
 * Regra: o documento primário é o que representa o PROCESSO desta interação, pela evidência mais determinística disponível — o
 * ASSUNTO estruturado da interação (motivo registrado, nunca o texto do modelo) ancorado no TÍTULO do documento (≥ 1 termo de
 * conteúdo em comum, fora das palavras genéricas de título: "procedimento", "operacional", "atendimento", "checklist"…).
 *
 *   exatamente 1 documento ancorado  → PRIMARY (SUBJECT_TITLE_ANCHOR);
 *   2+ documentos ancorados          → AMBIGUOUS — nenhum é escolhido em silêncio (todos continuam candidatos, em ordem de título);
 *   nenhum / sem assunto             → nenhum primário (NO_SUBJECT_ANCHOR / NO_SUBJECT).
 * Os demais documentos são SUPPLEMENTAL (transversais: diretriz de atendimento, checklist geral) — reforçam, nunca substituem.
 */
export const PRIMARY_PROCESS_VERSION = "PRIMARY_PROCESS_DOCUMENT_V1" as const
export type PrimaryProcessBasis = "SUBJECT_TITLE_ANCHOR" | "AMBIGUOUS_SUBJECT_ANCHOR" | "NO_SUBJECT_ANCHOR" | "NO_SUBJECT"
export type PrimaryProcessSelection = {
  version: typeof PRIMARY_PROCESS_VERSION
  basis: PrimaryProcessBasis
  primaryDocumentId: string | null
  /** Documentos ancorados no assunto (1 = o primário; 2+ = ambíguo). */
  candidates: { documentId: string; documentTitle: string; sharedTerms: string[] }[]
  supplemental: { documentId: string; documentTitle: string }[]
}

const GENERIC_TITLE_WORDS = new Set(["procedimento", "procedimentos", "operacional", "operacionais", "processo", "processos", "atendimento", "atender", "manual", "guia", "politica", "norma", "normas", "checklist", "chamada", "chamadas", "cliente", "clientes", "operador", "operadores", "padrao", "orientacoes", "orientacao", "diretriz", "diretrizes", "fluxo", "geral"])
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
/** Termos de conteúdo (≥ 4 letras, radical de 6 — "contestação" × "contestar"; "conteúdo" não casa com "contestação"). */
export function titleTerms(text: string): Set<string> {
  const terms = new Set<string>()
  for (const word of fold(text).match(/\p{L}{4,}/gu) ?? []) if (!GENERIC_TITLE_WORDS.has(word)) terms.add(word.slice(0, 6))
  return terms
}

/** O título do documento está ancorado no assunto da interação? Devolve os termos em comum. */
export function subjectAnchorTerms(documentTitle: string, subject: string | null | undefined): string[] {
  if (!subject) return []
  const subjectTerms = titleTerms(subject)
  return [...titleTerms(documentTitle)].filter((term) => subjectTerms.has(term))
}

export function selectPrimaryProcessDocument(documents: readonly { documentId: string; documentTitle: string }[], subject: string | null | undefined): PrimaryProcessSelection {
  const unique = [...new Map(documents.map((document) => [document.documentId, document])).values()]
  const candidates = unique.map((document) => ({ ...document, sharedTerms: subjectAnchorTerms(document.documentTitle, subject) })).filter((document) => document.sharedTerms.length > 0).sort((a, b) => a.documentTitle.localeCompare(b.documentTitle, "pt-BR"))
  const basis: PrimaryProcessBasis = !subject ? "NO_SUBJECT" : candidates.length === 1 ? "SUBJECT_TITLE_ANCHOR" : candidates.length > 1 ? "AMBIGUOUS_SUBJECT_ANCHOR" : "NO_SUBJECT_ANCHOR"
  const primaryDocumentId = basis === "SUBJECT_TITLE_ANCHOR" ? candidates[0]!.documentId : null
  const anchored = new Set(candidates.map((candidate) => candidate.documentId))
  return { version: PRIMARY_PROCESS_VERSION, basis, primaryDocumentId, candidates, supplemental: unique.filter((document) => !anchored.has(document.documentId)).map(({ documentId, documentTitle }) => ({ documentId, documentTitle })) }
}
