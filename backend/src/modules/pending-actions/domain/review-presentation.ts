import { readSupportMaterials } from "../../feedbacks/domain/support-material.js"
import type { InvestigationSummary, ToolInvocationTrace } from "../../investigation/domain/tool-trace.js"
import { readToolTrace } from "./review-content.js"

/**
 * HUMAN REVIEW CONTEXT (V1.2): o que o revisor lê — legível, sem JSON técnico como conteúdo
 * principal. Deriva do MESMO valor persistido no Execution Context (nada muda na persistência):
 * colaborador/tipo/indicador ficam no resumo da pendência; aqui vai o resultado, a evolução e a
 * comparação apuradas pelas Tools, as evidências principais (F-n), limitações, base de cada
 * recomendação, materiais e o resumo das ferramentas. O payload técnico completo continua
 * disponível em "Ver detalhes técnicos" (frontend), nunca como UX principal.
 */
export type ReviewPresentation = {
  kind: "indicator" | "monitoring" | "orchestrator" | "text" | "other"
  title: string | null
  summary: string | null
  indicator: { name: string; evidence: string | null; observed: string | null } | null
  /** Trechos do Feedback que o colaborador vai ler. */
  fields: { label: string; text: string }[]
  /** Fatos da investigação (F-n) — evolução, comparação e os demais, já em linguagem de resumo. */
  evolution: string | null
  comparison: string | null
  keyEvidence: string[]
  limitations: string[]
  supportedHypotheses: string[]
  unsupportedHypotheses: string[]
  behavioralClaims: { text: string; scope: string | null; evidenceRefs: string[] }[]
  recommendationSupport: { text: string; basis: string; evidenceRefs: string[] }[]
  representativeness: { ref: string; analyzed: number; universe: number | null; level: string; /** V1.3: cobertura operacional (null = não determinada) e relação entre universos. */ operationalUniverse?: number | null; operationalCoverage?: number | null; universeRelationship?: string | null }[]
  materials: { title: string; reason: string }[]
  toolSummary: { executed: number; preflight: number | null; investigation: number | null; budget: number | null; outcome: string | null; rejectedClaims: number; corrected: boolean | null } | null
  /** V1.3 (§48): status do gating fail-closed em uma linha — ausente em Feedbacks anteriores. */
  gating?: { status: "PASSED" | "CORRECTED" | "FALLBACK" | "DISCARDED"; envelopePresent: boolean | null; fallbackReason: string | null } | null
}

const FIELD_LABELS: Record<string, string> = {
  impactedIndicator: "Indicador impactado",
  evidenceFound: "Evidência encontrada",
  observedBehavior: "Comportamento observado",
  relatedProcedure: "Procedimento relacionado",
  recommendation: "Recomendação",
}

function readInvestigation(record: Record<string, unknown>): InvestigationSummary | null {
  const own = record.investigation
  if (own && typeof own === "object" && "toolCalls" in (own as object)) return own as InvestigationSummary
  if (Array.isArray(record.results)) {
    const first = (record.results as { investigation?: unknown }[]).find((result) => result?.investigation && typeof result.investigation === "object")
    if (first) return first.investigation as InvestigationSummary
  }
  return null
}

function factLine(item: ToolInvocationTrace): string {
  return `${item.ledgerRef ? `${item.ledgerRef} · ` : ""}${item.label}: ${item.resultSummary.replace(/^\(cache\) /, "")}`
}

export function buildReviewPresentation(value: unknown): ReviewPresentation | null {
  if (value === undefined || value === null) return null
  if (typeof value === "string") {
    return { kind: "text", title: null, summary: value, indicator: null, fields: [], evolution: null, comparison: null, keyEvidence: [], limitations: [], supportedHypotheses: [], unsupportedHypotheses: [], behavioralClaims: [], recommendationSupport: [], representativeness: [], materials: [], toolSummary: null }
  }
  if (typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const input = (record.input && typeof record.input === "object" ? record.input : {}) as Record<string, unknown>
  const structured = (input.structured && typeof input.structured === "object" ? input.structured : {}) as Record<string, unknown>
  const kind: ReviewPresentation["kind"] = record.kind === "indicator" ? "indicator" : record.kind === "monitoring" ? "monitoring" : Array.isArray(record.results) ? "orchestrator" : typeof record.text === "string" ? "text" : "other"
  const trace = readToolTrace(record).filter((item) => item.status === "COMPLETED" || item.status === "CACHED")
  const investigation = readInvestigation(record)
  const synthesis = investigation?.synthesis
  const evolution = trace.find((item) => item.tool === "compare_periods")
  const comparison = trace.find((item) => item.tool === "compare_population")
  const fields = Object.entries(structured)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0 && entry[0] !== "title" && entry[0] !== "summary")
    .map(([key, text]) => ({ label: FIELD_LABELS[key] ?? key, text }))
  return {
    kind,
    title: typeof structured.title === "string" ? structured.title : null,
    summary: typeof structured.summary === "string" ? structured.summary : typeof record.text === "string" ? record.text : null,
    indicator: typeof input.indicatorName === "string" ? { name: input.indicatorName, evidence: typeof input.evidenceFound === "string" ? input.evidenceFound : null, observed: typeof input.observedBehavior === "string" ? input.observedBehavior : null } : null,
    fields,
    evolution: evolution ? factLine(evolution) : null,
    comparison: comparison ? factLine(comparison) : null,
    keyEvidence: trace.filter((item) => item !== evolution && item !== comparison).map(factLine),
    limitations: synthesis?.limitations ?? [],
    supportedHypotheses: synthesis?.supportedHypotheses ?? [],
    unsupportedHypotheses: synthesis?.unsupportedHypotheses ?? [],
    behavioralClaims: (synthesis?.behavioralClaims ?? []).map((claim) => ({ text: claim.text, scope: claim.scope ?? null, evidenceRefs: claim.evidenceRefs })),
    recommendationSupport: (synthesis?.recommendationSupport ?? []).map((item) => ({ text: item.text, basis: item.basis, evidenceRefs: item.evidenceRefs })),
    representativeness: (synthesis?.evidenceRepresentativeness ?? []).map((item) => ({ ref: item.ref, analyzed: item.analyzed, universe: item.universe, level: item.level, operationalUniverse: item.operationalUniverseCount ?? null, operationalCoverage: item.operationalCoverage ?? null, universeRelationship: item.universeRelationship ?? null })),
    materials: readSupportMaterials(record).map((item) => ({ title: item.title, reason: item.reason })),
    toolSummary: investigation
      ? { executed: investigation.toolCalls, preflight: investigation.preflightCalls ?? null, investigation: investigation.investigationToolCalls ?? null, budget: investigation.budget, outcome: investigation.outcome, rejectedClaims: investigation.evidenceGating?.rejectedClaims.length ?? 0, corrected: investigation.evidenceGating?.corrected ?? null }
      : trace.length > 0
        ? { executed: trace.length, preflight: null, investigation: null, budget: null, outcome: null, rejectedClaims: 0, corrected: null }
        : null,
    gating: investigation?.evidenceGating
      ? {
          status: investigation.evidenceGating.fallbackUsed ? "FALLBACK" : investigation.evidenceGating.correctionAttempted && !investigation.evidenceGating.correctionSucceeded ? "DISCARDED" : investigation.evidenceGating.corrected ? "CORRECTED" : "PASSED",
          envelopePresent: investigation.evidenceGating.envelopePresent ?? null,
          fallbackReason: investigation.evidenceGating.fallbackReason ?? null,
        }
      : null,
  }
}
