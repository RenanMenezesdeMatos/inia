import { projectDisplayEvidence, type DisplayEvidenceResult, type DisplayProjectionContext } from "../../investigation/domain/feedback-display-evidence.js"
import type { Ownership } from "../../investigation/domain/outcome-attribution.js"
import { projectTranscript, verifyEvidenceUnit, type ProjectedInteraction, type VerifiedEvidence } from "../../investigation/domain/transcript-projection.js"
import type { FeedbackInvestigationResultV1, InvestigationClaim } from "./feedback-investigation-result.js"
import type { ReliableFact, ReliableFactRole, ReliableItemDraft } from "./reliable-feedback-item.js"

/**
 * V1.5.12 — MONITORING FEEDBACK ADAPTER (domínio puro): conclusões de um Agent/Orquestrador sobre UMA interação →
 * itens confiáveis, validados contra a TRANSCRIÇÃO REAL.
 *
 * Nunca confia na citação do modelo: o trecho que ele diz ser literal é decomposto nas falas que contém (rótulos de falante
 * inline e reticências) e CADA parte precisa existir literalmente em um turno da transcrição real (o MESMO verificador por
 * turno da investigação — sem fuzzy, sem paráfrase). Todas as partes verificadas (ALL) ou o item cai (EVIDENCE_NOT_VERIFIED).
 * O falante vem da TRANSCRIÇÃO, nunca do rótulo que o modelo escreveu.
 *
 * Regras preservadas:
 *   - só evidência do OPERADOR sustenta crítica individual (dono AGENT); fala só do cliente ou evento = sinal, nunca causa
 *     (CUSTOMER/INTERACTION → contexto neutro, não emitível ao colaborador);
 *   - ausência não vira conclusão: sem trecho verificado não há item;
 *   - procedimento citado pela origem NÃO vira orientação obrigatória (sem lineage verificado da base, a V1 não emite
 *     conteúdo procedimental — a orientação é sempre sugestão);
 *   - privacidade: a evidência só sai pela projeção de display canônica (redaction + fail-closed).
 */
export const MONITORING_ADAPTER_VERSION = "MONITORING_FEEDBACK_ADAPTER_V1" as const
const INTERACTION_REF = "I1"
/** Parte mínima de um trecho emendado com reticências (mesma régua do `isVerbatimEvidence`). */
const MIN_ELLIPSIS_SEGMENT = 15

export const MONITORING_SAFE_MEANING = "ponto de desenvolvimento na condução do operador, sustentado por trecho literal desta interação"

/** Decompõe a citação da origem nas unidades que ela contém: uma por fala (rótulo inline) e por trecho entre reticências. */
export function decomposeClaimedEvidence(quote: string): { speaker: string | null; text: string }[] {
  const turns = projectTranscript(quote).turns
  const units: { speaker: string | null; text: string }[] = []
  for (const turn of turns) {
    const segments = turn.text.split(/\s*(?:\[\s*(?:\.\.\.|…)\s*\]|\.\.\.|…)\s*/).map((segment) => segment.trim()).filter((segment) => segment.length > 0)
    const parts = segments.length > 1 ? segments.filter((segment) => segment.length >= MIN_ELLIPSIS_SEGMENT) : segments
    // Um trecho emendado com reticências cujos pedaços são curtos demais não é verificável com segurança — recusado inteiro.
    if (segments.length > 1 && parts.length !== segments.length) return []
    for (const text of parts) units.push({ speaker: turn.speaker, text: text.replace(/^["“'”]+|["“'”]+$/g, "").trim() })
  }
  return units.filter((unit) => unit.text.length > 0)
}

const roleOf = (speaker: string | null): ReliableFactRole => (speaker === "OPERADOR" ? "OPERADOR" : speaker === "CLIENTE" ? "CLIENTE" : speaker === "EVENTO" ? "EVENTO" : "OUTRO")

function ownershipOf(verified: readonly VerifiedEvidence[]): Ownership {
  if (verified.some((unit) => unit.speaker === "OPERADOR")) return "AGENT"
  if (verified.some((unit) => unit.speaker === "CLIENTE")) return "CUSTOMER"
  if (verified.some((unit) => unit.speaker === "EVENTO")) return "INTERACTION"
  return "UNKNOWN"
}

export type MonitoringAdapterInput = {
  result: FeedbackInvestigationResultV1
  interactionId: string
  transcript: string
  displayContext?: DisplayProjectionContext
}

function itemFromClaim(claim: InvestigationClaim, index: number, input: MonitoringAdapterInput, interactions: ReadonlyMap<string, ProjectedInteraction>): ReliableItemDraft {
  const base = {
    index,
    claimRef: claim.ref,
    domain: "MONITORING" as const,
    kind: "MONITORING_DEVELOPMENT_POINT" as const,
    polarity: "NEGATIVE" as const,
    safeMeaning: MONITORING_SAFE_MEANING,
    guidanceSource: "COACHING_SUGGESTION" as const,
    // V1.6.0 — caminho LEGADO (sem avaliação de processo): nenhuma regra da base verificada ⇒ nenhuma orientação ("o que
    // fazer") pode ser escrita; o feedback informa só o que aconteceu. A citação de procedimento da origem não é evidência.
    grounding: "NO_GROUNDED_GUIDANCE" as const,
    knowledge: null,
    process: null,
    analysis: { observation: claim.observation, summary: claim.summary, recommendation: claim.recommendation },
    analysisConflicts: [],
  }
  const empty = (block: ReliableItemDraft["structuralBlock"], rejected: { reason: string }[] = []): ReliableItemDraft => ({ ...base, section: "NEUTRAL_CONTEXT", ownership: "UNKNOWN", facts: [], withheldFacts: 0, structuralBlock: block, audit: { evidence: [], rejectedUnits: rejected } })
  if (!claim.claimedEvidence) return empty("NO_EVIDENCE")
  const units = decomposeClaimedEvidence(claim.claimedEvidence)
  if (units.length === 0) return empty("EVIDENCE_NOT_VERIFIED", [{ reason: "UNVERIFIABLE_SHAPE" }])
  const verified: VerifiedEvidence[] = []
  const rejected: { reason: string }[] = []
  for (const unit of units) {
    const verdict = verifyEvidenceUnit({ interactionRef: INTERACTION_REF, speaker: unit.speaker, quote: unit.text }, interactions)
    if (verdict.ok) verified.push(verdict.evidence)
    else rejected.push({ reason: verdict.reason })
  }
  // ALL: uma parte não verificada contamina a citação inteira (poderia ser exatamente a parte que sustenta a crítica).
  if (rejected.length > 0 || verified.length === 0) return empty("EVIDENCE_NOT_VERIFIED", rejected)
  const display: DisplayEvidenceResult[] = verified.map((unit, factIndex) => projectDisplayEvidence({ turnRef: unit.turnRef, speaker: unit.speaker, quote: unit.quote }, { factIndex, evidenceType: "FINDING_EVIDENCE" }, input.displayContext ?? {}))
  const shown = display.flatMap((entry): ReliableFact[] => (entry.status === "DISPLAYED" ? [{ role: roleOf(entry.speaker), text: entry.text, truncated: entry.truncated, masked: entry.wasRedacted }] : []))
  const ownership = ownershipOf(verified)
  const audit = { evidence: display.map((entry, factIndex) => ({ turnRef: entry.origin.turnRef, speaker: verified[factIndex]!.speaker, rawSha256: entry.origin.rawSha256 })), rejectedUnits: [] }
  const withheld = display.length - shown.length
  // Só a condução do OPERADOR, exibível, sustenta um ponto de desenvolvimento individual.
  const operatorShown = shown.some((fact) => fact.role === "OPERADOR")
  if (ownership !== "AGENT") return { ...base, section: "NEUTRAL_CONTEXT", ownership, facts: shown, withheldFacts: withheld, structuralBlock: "NOT_ATTRIBUTABLE_TO_COLLABORATOR", audit }
  if (!operatorShown) return { ...base, section: "OPPORTUNITY", ownership, facts: shown, withheldFacts: withheld, structuralBlock: "INSUFFICIENT_DISPLAY_EVIDENCE", audit }
  return { ...base, section: "OPPORTUNITY", ownership, facts: shown, withheldFacts: withheld, structuralBlock: null, audit }
}

/** Conclusões → itens (um por conclusão; ordem da origem). Sem conclusão nenhuma = artefato sem itens (BLOCKED adiante). */
export function buildMonitoringItems(input: MonitoringAdapterInput): { items: ReliableItemDraft[]; projection: { turns: number; sourceHash: string } } {
  const projection = projectTranscript(input.transcript)
  const interactions = new Map<string, ProjectedInteraction>([[INTERACTION_REF, { interactionRef: INTERACTION_REF, interactionId: input.interactionId, projection }]])
  const items = input.result.claims.map((claim, index) => itemFromClaim(claim, index, input, interactions))
  return { items, projection: { turns: projection.turns.length, sourceHash: projection.sourceHash } }
}
