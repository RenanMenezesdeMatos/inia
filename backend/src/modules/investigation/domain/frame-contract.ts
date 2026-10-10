/**
 * V1.4.6.8 — SEMANTIC FRAME CONTRACT HYGIENE & COMPLETENESS (determinístico, sem LLM).
 *
 * Dois princípios, descobertos nos experimentos V1.4.6.5–V1.4.6.7:
 *
 *  1. EXEMPLO NUNCA USA UM HANDLE QUE PODE SER REAL. O contrato da Fase A ilustrava o formato com "I6" — um handle que
 *     também existe em requests reais. Os handles de exemplo agora são `EXAMPLE_INTERACTION_REF`, que não casa o formato
 *     de handle (`/^I\d+$/`) e por isso nunca pode ser uma referência válida de execução. Os handles reais continuam
 *     chegando só pelas listas DINÂMICAS (`renderFrameExtractionInstructions(handles)`).
 *
 *  2. JSON VÁLIDO ≠ CONTRATO COMPLETO. `assessFrameContract` mede, por código, se a resposta trouxe exatamente um frame
 *     por referência esperada — sem depender do modelo. COMPLETE só quando cada esperado aparece exatamente uma vez, sem
 *     ausente, sem duplicado e sem inesperado. Frame VAZIO (presente, 0 observações declaradas) continua estruturalmente
 *     presente: não torna o contrato INCOMPLETE, mas é contado à parte (qualidade de conteúdo ≠ estrutura).
 *
 * Só mede: não muda o descarte do verifier (ref desconhecido cai fora; duplicado = o primeiro vence) nem o retry
 * dirigido para ausentes.
 */

/** Placeholder de DOCUMENTAÇÃO do formato. Nunca é handle de execução: não casa `HANDLE_FORMAT`. */
export const EXAMPLE_INTERACTION_REF = "<INTERACTION_REF>"
/** Formato dos handles de interação emitidos pelo HandleRegistry (I1, I2, …). */
export const HANDLE_FORMAT = /^I\d+$/

const DECLARED_OBSERVATION_KEYS = ["customerNeeds", "questions", "answers", "agentActions", "agentStatements", "commitments", "customerSignals", "procedureAssertions", "interactionEvents"] as const

export type DeclaredFrameShape = { interactionRef: string } & Partial<Record<(typeof DECLARED_OBSERVATION_KEYS)[number], readonly unknown[]>>

export type FrameContractStatus = "COMPLETE" | "INCOMPLETE"

export type FrameContractAssessment = {
  parsed: boolean
  status: FrameContractStatus
  expectedInteractionRefs: string[]
  returnedInteractionRefs: string[]
  /** MISSING_FRAME: esperado que não apareceu em nenhum frame. */
  missingInteractionRefs: string[]
  /** EMPTY_FRAME: esperado cujo PRIMEIRO frame (o que o runtime usa) não declara nenhuma observação. */
  emptyInteractionRefs: string[]
  duplicateInteractionRefs: string[]
  /** Refs devolvidos fora do conjunto esperado (inventados como I0/I2, ou o próprio placeholder de exemplo). */
  unexpectedInteractionRefs: string[]
  expectedFrameCount: number
  returnedFrameCount: number
  uniqueExpectedReturned: number
  missingFrameCount: number
  emptyFrameCount: number
  /** Frames excedentes para refs esperados (o 2º, 3º… frame do mesmo ref) — o runtime os descarta. */
  duplicateFrameCount: number
  /** Observações DECLARADAS nos frames duplicados — o que o descarte "primeiro vence" leva embora. */
  duplicateFrameObservationsDropped: number
  unexpectedFrameCount: number
  /** Frames devolvidos com o placeholder de exemplo como ref (eco do contrato). */
  exampleRefEchoed: number
  frameCoveragePercent: number
}

const norm = (ref: string) => ref.trim().toUpperCase()
const declaredObservations = (frame: DeclaredFrameShape) => DECLARED_OBSERVATION_KEYS.reduce((total, key) => total + (frame[key]?.length ?? 0), 0)

/** `frames = null` = a resposta não parseou no contrato de frames (INCOMPLETE, todos ausentes). */
export function assessFrameContract(frames: readonly DeclaredFrameShape[] | null, expectedRefs: readonly string[]): FrameContractAssessment {
  const expected = expectedRefs.map(norm)
  const expectedSet = new Set(expected)
  const returned = (frames ?? []).map((frame) => norm(frame.interactionRef))
  const counts = new Map<string, number>()
  for (const ref of returned) counts.set(ref, (counts.get(ref) ?? 0) + 1)
  const first = new Map<string, DeclaredFrameShape>()
  let duplicateFrameCount = 0
  let duplicateFrameObservationsDropped = 0
  for (const frame of frames ?? []) {
    const ref = norm(frame.interactionRef)
    if (!first.has(ref)) { first.set(ref, frame); continue }
    if (expectedSet.has(ref)) { duplicateFrameCount += 1; duplicateFrameObservationsDropped += declaredObservations(frame) }
  }
  const missing = expected.filter((ref) => !counts.has(ref))
  const empty = expected.filter((ref) => first.has(ref) && declaredObservations(first.get(ref)!) === 0)
  const duplicates = expected.filter((ref) => (counts.get(ref) ?? 0) > 1)
  const unexpected = [...new Set(returned.filter((ref) => !expectedSet.has(ref)))]
  const uniqueExpectedReturned = expected.filter((ref) => counts.has(ref)).length
  const complete = frames !== null && expected.length > 0 && missing.length === 0 && duplicates.length === 0 && unexpected.length === 0
  return {
    parsed: frames !== null,
    status: complete ? "COMPLETE" : "INCOMPLETE",
    expectedInteractionRefs: expected,
    returnedInteractionRefs: returned,
    missingInteractionRefs: missing,
    emptyInteractionRefs: empty,
    duplicateInteractionRefs: duplicates,
    unexpectedInteractionRefs: unexpected,
    expectedFrameCount: expected.length,
    returnedFrameCount: returned.length,
    uniqueExpectedReturned,
    missingFrameCount: missing.length,
    emptyFrameCount: empty.length,
    duplicateFrameCount,
    duplicateFrameObservationsDropped,
    unexpectedFrameCount: returned.filter((ref) => !expectedSet.has(ref)).length,
    exampleRefEchoed: returned.filter((ref) => ref === norm(EXAMPLE_INTERACTION_REF)).length,
    frameCoveragePercent: expected.length === 0 ? 0 : Number(((uniqueExpectedReturned / expected.length) * 100).toFixed(1)),
  }
}

/** Versão COMPACTA para telemetria (contagens + refs curtos; nenhuma transcrição, nenhum id interno). */
export type FrameContractSummary = Pick<FrameContractAssessment, "parsed" | "status" | "expectedFrameCount" | "returnedFrameCount" | "uniqueExpectedReturned" | "missingFrameCount" | "emptyFrameCount" | "duplicateFrameCount" | "duplicateFrameObservationsDropped" | "unexpectedFrameCount" | "exampleRefEchoed" | "frameCoveragePercent" | "missingInteractionRefs" | "duplicateInteractionRefs" | "unexpectedInteractionRefs" | "emptyInteractionRefs">

export function summarizeFrameContract(assessment: FrameContractAssessment): FrameContractSummary {
  const { parsed, status, expectedFrameCount, returnedFrameCount, uniqueExpectedReturned, missingFrameCount, emptyFrameCount, duplicateFrameCount, duplicateFrameObservationsDropped, unexpectedFrameCount, exampleRefEchoed, frameCoveragePercent, missingInteractionRefs, duplicateInteractionRefs, emptyInteractionRefs } = assessment
  // Refs inesperados vêm do modelo: só os que têm formato de handle ou o placeholder entram na telemetria (texto livre nunca).
  const unexpectedInteractionRefs = assessment.unexpectedInteractionRefs.filter((ref) => HANDLE_FORMAT.test(ref) || ref === norm(EXAMPLE_INTERACTION_REF)).slice(0, 12)
  return { parsed, status, expectedFrameCount, returnedFrameCount, uniqueExpectedReturned, missingFrameCount, emptyFrameCount, duplicateFrameCount, duplicateFrameObservationsDropped, unexpectedFrameCount, exampleRefEchoed, frameCoveragePercent, missingInteractionRefs, duplicateInteractionRefs, unexpectedInteractionRefs, emptyInteractionRefs }
}
