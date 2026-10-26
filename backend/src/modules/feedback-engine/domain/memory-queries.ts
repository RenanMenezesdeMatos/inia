import { createHash } from "node:crypto"
import type { MemoryArgument, MemoryRow } from "./indicator-investigation.js"
import { criterionProductOf, ruleScopeNamesOf, type CriterionProductApplicability, type ProductApplicabilityRecord } from "./product-applicability.js"

/**
 * AGREGAÇÕES da memória (domínio puro) — calculadas sobre a MESMA leitura primitiva (`currentMemory`) em qualquer armazenamento.
 * Só entram leituras vigentes e utilizáveis (USABLE/PARTIAL) da lógica de análise atual; regra em conflito nunca conta.
 */
export type MemoryWindow = { start: Date; end: Date }
export type MemoryAssessment = { /** `PRODUCT_IN_FEEDBACK_V1`: o registro de produto da leitura (solicitações e cadastro), para resolver o produto de cada critério. */ productRecord?: ProductApplicabilityRecord | null; callAssessmentId: string; analysisRunId: string; interactionId: string; personId: string; occurredAt: Date; asOf: Date; segmentKey: string | null; pathAssessment: string | null; outcome: string; logicVersion: string | null; /** Regra vigente na data × regra atual usada para reavaliar a chamada. */ rulePerspective?: string | null }
/** `anchorLineKey`: a linha-âncora da obrigação (chave de linha antes do '#'); `sourceLineKeys`: as linhas da obrigação em ordem — a
 * prática é a da primeira dessas linhas que pede conduta (`PRACTICE_IDENTITY_V1`). `obligationLineKey`: a chave da obrigação de várias
 * linhas (com '#') — organizada como regra COMPOSTA quando nenhuma das linhas pede conduta sozinha; é a última procurada. */
export type MemoryCriterionRow = MemoryRow & { callAssessmentId: string; segmentKey: string | null; anchorLineKey?: string; sourceLineKeys?: string[]; /** `PRODUCT_IN_FEEDBACK_V1`: documentos das linhas-fonte da obrigação (para o "Vale para" da regra ser o da fonte dela). */ sourceDocumentIds?: string[]; obligationLineKey?: string; /** Dado cru da avaliação (`PRODUCT_IN_FEEDBACK_V1`): a solicitação e o "Vale para" da regra; o produto é resolvido em `memoryRowsOf`. */ productApplicability?: Pick<CriterionProductApplicability, "request" | "scope"> | null; argumentItem?: MemoryArgument | null }
/** Linhas pelas quais a prática de uma leitura é procurada, em ordem (âncora primeiro, a obrigação composta por último). */
export const practiceLineKeysOf = (row: Pick<MemoryCriterionRow, "anchorLineKey" | "sourceLineKeys" | "obligationLineKey">) => [...new Set([...(row.anchorLineKey ? [row.anchorLineKey] : []), ...(row.sourceLineKeys ?? []), ...(row.obligationLineKey ? [row.obligationLineKey] : [])])]
export type MemorySnapshot = { assessments: MemoryAssessment[]; criteria: MemoryCriterionRow[] }
export type MemoryQuery = { personIds: readonly string[]; window?: MemoryWindow; interactionIds?: readonly string[] }
const usable = (assessment: MemoryAssessment, logicVersion: string) => (assessment.outcome === "USABLE" || assessment.outcome === "PARTIAL") && assessment.logicVersion === logicVersion

/** Chamadas que já têm leitura vigente e utilizável (reuso — nunca contadas duas vezes). */
export function analyzedInteractionIds(snapshot: MemorySnapshot, logicVersion: string): Set<string> {
  return new Set(snapshot.assessments.filter((assessment) => usable(assessment, logicVersion)).map((assessment) => assessment.interactionId))
}

/** Critérios vigentes das leituras utilizáveis, opcionalmente num assunto. */
export function memoryRowsOf(snapshot: MemorySnapshot, logicVersion: string, segmentKey: string | null, personIds?: readonly string[]): MemoryRow[] {
  const valid = new Set(snapshot.assessments.filter((assessment) => usable(assessment, logicVersion)).map((assessment) => assessment.callAssessmentId))
  const perspective = new Map(snapshot.assessments.map((assessment) => [assessment.callAssessmentId, assessment.rulePerspective ?? null]))
  const assessmentOf = new Map(snapshot.assessments.map((assessment) => [assessment.callAssessmentId, assessment]))
  return snapshot.criteria
    .filter((row) => valid.has(row.callAssessmentId) && (segmentKey === null || row.segmentKey === segmentKey) && (!personIds || personIds.includes(row.personId)))
    .map((row): MemoryRow => ({ interactionId: row.interactionId, personId: row.personId, criterionKey: row.criterionKey, ...(row.practiceKey ? { practiceKey: row.practiceKey } : {}), ...(row.practiceTitle ? { practiceTitle: row.practiceTitle } : {}), documentId: row.documentId, documentTitle: row.documentTitle, heading: row.heading, text: row.text, status: row.status, localDate: row.localDate, evidence: row.evidence, rationale: row.rationale, guidance: row.guidance, materiality: row.materiality, reevaluation: perspective.get(row.callAssessmentId) === "CURRENT_RULE_REEVALUATION", ...contextOf(row, assessmentOf.get(row.callAssessmentId)) }))
}

/** `PRODUCT_IN_FEEDBACK_V1`: produto da solicitação, "Vale para" da regra, item do argumentário e quando a chamada aconteceu. */
function contextOf(row: MemoryCriterionRow, assessment: MemoryAssessment | undefined): Pick<MemoryRow, "product" | "ruleScope" | "argument" | "occurredAt"> {
  const product = criterionProductOf(assessment?.productRecord, row.productApplicability ?? null)
  const ruleScope = ruleScopeNamesOf(assessment?.productRecord, row.productApplicability?.scope, row.documentId, row.sourceDocumentIds ?? [])
  return {
    ...(product ? { product } : {}),
    ...(ruleScope.length > 0 ? { ruleScope } : {}),
    ...(row.argumentItem ? { argument: row.argumentItem } : {}),
    ...(assessment?.occurredAt ? { occurredAt: new Date(assessment.occurredAt).toISOString() } : {}),
  }
}

export function pathStatsOf(snapshot: MemorySnapshot, logicVersion: string, personId: string, segmentKey: string): { assessed: number; incorrect: number } {
  const rows = snapshot.assessments.filter((assessment) => usable(assessment, logicVersion) && assessment.personId === personId && assessment.segmentKey === segmentKey)
  return { assessed: rows.filter((row) => row.pathAssessment === "CORRECT" || row.pathAssessment === "INCORRECT" || row.pathAssessment === "PARTIALLY_CORRECT").length, incorrect: rows.filter((row) => row.pathAssessment === "INCORRECT" || row.pathAssessment === "PARTIALLY_CORRECT").length }
}

/** Caminho avaliado nas leituras utilizáveis de um conjunto de chamadas (recorte que não é um assunto). */
export function pathStatsOfInteractions(snapshot: MemorySnapshot, logicVersion: string, personId: string, interactionIds: ReadonlySet<string>): { assessed: number; incorrect: number } {
  const rows = snapshot.assessments.filter((assessment) => usable(assessment, logicVersion) && assessment.personId === personId && interactionIds.has(assessment.interactionId))
  return { assessed: rows.filter((row) => row.pathAssessment === "CORRECT" || row.pathAssessment === "INCORRECT" || row.pathAssessment === "PARTIALLY_CORRECT").length, incorrect: rows.filter((row) => row.pathAssessment === "INCORRECT" || row.pathAssessment === "PARTIALLY_CORRECT").length }
}

/** Assuntos com leitura na memória (para descrever o que foi observado quando não dá para localizar onde o resultado mudou). */
export function segmentsWithMemoryOf(snapshot: MemorySnapshot, logicVersion: string, personId: string): { segmentKey: string; calls: number }[] {
  const counts = new Map<string, Set<string>>()
  for (const assessment of snapshot.assessments) {
    if (!usable(assessment, logicVersion) || assessment.personId !== personId || !assessment.segmentKey) continue
    counts.set(assessment.segmentKey, (counts.get(assessment.segmentKey) ?? new Set()).add(assessment.interactionId))
  }
  return [...counts.entries()].map(([segmentKey, calls]) => ({ segmentKey, calls: calls.size })).sort((a, b) => b.calls - a.calls || a.segmentKey.localeCompare(b.segmentKey))
}

/**
 * ESTADO da evidência de memória: quais leituras vigentes existem (identidade + instante). Uma leitura nova, uma reanálise que
 * substituiu outra ou uma leitura que deixou de valer mudam o estado; abrir a mesma coisa de novo, não.
 */
export function memoryStateOf(snapshot: MemorySnapshot, logicVersion: string): { assessments: number; key: string } {
  const entries = snapshot.assessments.filter((assessment) => usable(assessment, logicVersion)).map((assessment) => `${assessment.interactionId}:${assessment.callAssessmentId}:${assessment.asOf.toISOString()}`).sort()
  return { assessments: entries.length, key: createHash("sha256").update(entries.join("|")).digest("hex").slice(0, 16) }
}

/** Sobreposição (ensaio/QA Lab): a leitura da RAM substitui a do banco para a MESMA chamada; o resto do banco continua valendo. */
export function overlaySnapshots(base: MemorySnapshot, overlay: MemorySnapshot): MemorySnapshot {
  const replaced = new Set(overlay.assessments.map((assessment) => assessment.interactionId))
  const assessments = [...base.assessments.filter((assessment) => !replaced.has(assessment.interactionId)), ...overlay.assessments]
  const kept = new Set(assessments.map((assessment) => assessment.callAssessmentId))
  const criteria: MemoryCriterionRow[] = [...base.criteria, ...overlay.criteria].filter((row) => kept.has(row.callAssessmentId))
  return { assessments, criteria }
}
