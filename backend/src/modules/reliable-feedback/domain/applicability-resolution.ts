import type { ApplicabilitySource, ApplicabilityStatus } from "../../agents/domain/process-assessment-contract.js"
import { compareQuantities, parseQuantity, type ValueComparison } from "../../investigation/domain/procedural-semantics.js"
import { terms } from "./verified-omission.js"

/**
 * V1.7.1b — RESOLUÇÃO DE APLICABILIDADE (domínio puro, sem LLM): qual produto/processo se aplica a ESTA chamada quando a base
 * tem procedimentos parecidos para produtos diferentes (ex.: mudança de endereço DDR × SIP × Linha Analógica, cada um com o
 * seu prazo). Documento RECUPERADO ≠ documento APLICÁVEL, e ranking semântico nunca decide aplicabilidade.
 *
 *   O especialista PROPÕE: o produto de cada processo e, quando há dúvida, os candidatos (produto, documento, trecho da regra) e
 *   a fala do operador sobre o ponto que muda. O código VERIFICA (em process-assessment.ts) cada candidato — documento apresentado
 *   nesta execução, trecho literal na versão publicada, nome do produto presente no título/seção/trecho do PRÓPRIO documento — e
 *   as falas; e aqui CALCULA o status, na ordem de confiança das fontes:
 *
 *     1. dado estruturado do sistema (assunto registrado do atendimento) nomeia exatamente um candidato → CONFIRMED (SYSTEM_DATA)
 *     2. fala conferida da chamada nomeia exatamente um candidato                                     → CONFIRMED (TRANSCRIPT)
 *     3. fontes nomeiam mais de um candidato                                                          → AMBIGUOUS
 *     4. o especialista indica um produto entre os candidatos, sem confirmação literal                → INFERRED (INFERENCE)
 *     5. dois ou mais candidatos verificados, nada que decida                                        → AMBIGUOUS
 *     6. sem base                                                                                     → UNKNOWN
 *
 * O status declarado NUNCA promove: "CONFIRMED" sem fala/dado que nomeie o produto vira INFERRED. INCERTEZA DO SISTEMA ≠ ERRO
 * DO COLABORADOR: sem CONFIRMED, etapa que depende do produto nunca vira "não seguida" (process-assessment.ts rebaixa).
 */
export const APPLICABILITY_RESOLUTION_VERSION = "APPLICABILITY_RESOLUTION_V1" as const

export type VerifiedApplicabilityCandidate = {
  product: string
  documentId: string
  documentTitle: string
  heading: string | null
  version: number | null
  /** Trecho LITERAL da regra que muda entre os produtos (verificado na versão publicada). */
  quote: string
  href: string
  /** Comparação da fala do operador com a regra deste candidato (quantidades: prazo, valor…). */
  statementComparison: ValueComparison
}
export type ApplicabilityCandidateRejection = { product: string; documentTitle: string; reason: "DOCUMENT_NOT_VERIFIED" | "QUOTE_NOT_VERIFIED" | "PRODUCT_NOT_IN_DOCUMENT" | "DUPLICATE" }
export type StatementComparisonSummary = "COMPATIBLE_WITH_ONE" | "COMPATIBLE_WITH_SEVERAL" | "COMPATIBLE_WITH_NONE" | "NOT_COMPARABLE" | "NO_STATEMENT"

export type ApplicabilityResolution = {
  version: typeof APPLICABILITY_RESOLUTION_VERSION
  ref: string
  declaredStatus: ApplicabilityStatus
  status: ApplicabilityStatus
  resolvedProduct: string | null
  source: ApplicabilitySource
  /** Falas conferidas que nomeiam o produto (turno + falante + trecho). */
  evidence: { turnRef: string; speaker: string | null; quote: string }[]
  candidates: VerifiedApplicabilityCandidate[]
  rejectedCandidates: ApplicabilityCandidateRejection[]
  /** Fala conferida do OPERADOR sobre o ponto que muda conforme o produto. */
  operatorStatement: { turnRef: string; quote: string } | null
  statementComparison: StatementComparisonSummary
  compatibleProducts: string[]
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim()
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** O texto NOMEIA o produto (palavra/expressão inteira, sem acento/caixa): "é um DDR" nomeia DDR; "DDRX" não. */
export function mentionsProduct(text: string, product: string): boolean {
  const needle = fold(product)
  if (needle.length === 0) return false
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(needle)}(?![\\p{L}\\p{N}])`, "u").test(fold(text))
}
export const sameProduct = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && fold(a) === fold(b))

/** O nome do produto precisa estar no PRÓPRIO documento (título, seção ou trecho) — o rótulo do candidato nunca é do modelo. */
export const productInDocument = (product: string, document: { title: string; heading: string | null; quote: string }) => [document.title, document.heading ?? "", document.quote].some((text) => mentionsProduct(text, product))

export function compareStatement(statement: string | null, ruleQuote: string): ValueComparison {
  if (!statement) return "NO_VALUE"
  return compareQuantities(parseQuantity(statement), parseQuantity(ruleQuote))
}

export function summarizeStatement(statement: { quote: string } | null, candidates: readonly VerifiedApplicabilityCandidate[]): { summary: StatementComparisonSummary; compatible: string[] } {
  if (!statement) return { summary: "NO_STATEMENT", compatible: [] }
  const compatible = candidates.filter((candidate) => candidate.statementComparison === "COMPATIBLE").map((candidate) => candidate.product)
  if (compatible.length === 1) return { summary: "COMPATIBLE_WITH_ONE", compatible }
  if (compatible.length > 1) return { summary: "COMPATIBLE_WITH_SEVERAL", compatible }
  if (candidates.length > 0 && candidates.every((candidate) => candidate.statementComparison === "INCOMPATIBLE")) return { summary: "COMPATIBLE_WITH_NONE", compatible }
  return { summary: "NOT_COMPARABLE", compatible }
}

/** Regra única do status (ver o cabeçalho). Entradas já verificadas; nada aqui lê texto não conferido como fato. */
export function resolveApplicabilityStatus(input: {
  declaredStatus: ApplicabilityStatus
  declaredProduct: string | null
  candidates: readonly VerifiedApplicabilityCandidate[]
  evidenceTexts: readonly string[]
  subject: string | null
}): { status: ApplicabilityStatus; resolvedProduct: string | null; source: ApplicabilitySource } {
  const products = [...new Map(input.candidates.map((candidate) => [fold(candidate.product), candidate.product])).values()]
  const named = (texts: readonly string[]) => products.filter((product) => texts.some((text) => mentionsProduct(text, product)))
  const system = input.subject ? named([input.subject]) : []
  if (system.length === 1) return { status: "CONFIRMED", resolvedProduct: system[0]!, source: "SYSTEM_DATA" }
  const transcript = named(input.evidenceTexts)
  if (system.length === 0 && transcript.length === 1) return { status: "CONFIRMED", resolvedProduct: transcript[0]!, source: "TRANSCRIPT" }
  if (system.length > 1 || transcript.length > 1) return { status: "AMBIGUOUS", resolvedProduct: null, source: "NONE" }
  const declared = products.find((product) => sameProduct(product, input.declaredProduct))
  if (declared && (input.declaredStatus === "CONFIRMED" || input.declaredStatus === "INFERRED")) return { status: "INFERRED", resolvedProduct: declared, source: "INFERENCE" }
  if (products.length >= 2) return { status: "AMBIGUOUS", resolvedProduct: null, source: "NONE" }
  return { status: "UNKNOWN", resolvedProduct: null, source: "NONE" }
}

/**
 * DOCUMENTOS IRMÃOS: outro documento apresentado nesta execução com o título quase igual (mesmo processo, outro produto — ex.:
 * "Mudança de endereço DDR" × "Mudança de endereço SIP"). Sem aplicabilidade declarada, a escolha do especialista entre irmãos
 * nunca sustenta "não seguiu" (seria escolher em silêncio). Termos do título: a mesma regra conservadora da âncora.
 */
export function siblingDocumentTitles(title: string, presentedTitles: readonly string[]): string[] {
  const own = terms(title)
  if (own.size < 2) return []
  return [...new Set(presentedTitles)].filter((other) => {
    if (fold(other) === fold(title)) return false
    const theirs = terms(other)
    const shared = [...own].filter((term) => theirs.has(term)).length
    return shared >= 2 && shared / Math.min(own.size, theirs.size) >= 0.75
  })
}
