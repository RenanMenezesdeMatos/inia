import { ACTIONABLE_CONCLUSIONS } from "../../indicator-diagnosis/domain/prv-investigation.js"
import { referencePeriodLabel } from "../../indicator-diagnosis/domain/prv-closing.js"
import { closingCanonicalContextOf, buildPrvClosingItems, PRV_CLOSING_ITEMS_VERSION } from "../domain/prv-closing-items.js"
import { prvNarrativeBriefOf, PRV_NARRATIVE_VERSION, type PrvClosingArtifactData } from "../domain/prv-closing-views.js"
import { PRV_NARRATIVE_PROMPT_VERSION } from "../domain/prv-narrative-prompt.js"
import { currentDisposition, emittedItems, findingsSummaryOf, RELIABLE_FEEDBACK_ARTIFACT_CONTRACT, SECTION_LABELS, type ArtifactItem, type ArtifactReviewState, type ReliableFeedbackArtifactV1 } from "../domain/reliable-feedback-artifact.js"
import { decideReliableItem, holdForStrategy, isEmittableSection, type ReliableWriterOutcome } from "../domain/reliable-feedback-item.js"
import { toIndicatorWriterItem, validateIndicatorWording } from "../domain/reliable-writer.js"
import type { ReliableGenerationDeps, ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import type { ArtifactRecord, NewReliableReview, ReviewAnalysisContext } from "./ports.js"
import { isDirectIndicatorSource, runPrvClosingStep, type PrvStepDeps } from "./prv-closing-step.js"

/**
 * INDICATOR DIAGNOSIS V1 — "GERAR FEEDBACK" PARA O FECHAMENTO DO PRV (o mesmo caso de uso, outro domínio de origem). Nenhuma
 * investigação nova e nenhum modelo para contar: o passo do fechamento verifica/reaproveita/agrega; aqui só:
 *
 *   itens do SISTEMA (resultado oficial + padrões do colaborador) → autovalidação pelos MESMOS validadores do indicador →
 *   política por item (READY | HOLD_FOR_QA | BLOCKED; a estratégia decide o que fazer sem diagnóstico) → redator da interpretação/
 *   narrativa (UMA chamada, só com itens a emitir; falha = texto do sistema) → artefato + revisões de QA + observações novas +
 *   diagnóstico do fechamento, numa transação só (idempotente pela chave do fechamento).
 */
export type PrvGenerationDeps = { prv: Pick<PrvStepDeps, "preparePrvClosingPlan" | "loadTeamObservations"> & Partial<Pick<PrvStepDeps, "prepareDirectIndicatorPlan">> }

export async function completePrvClosingArtifact(deps: ReliableGenerationDeps & Partial<PrvGenerationDeps>, request: ReliableGenerationRequest, artifactId: string): Promise<ArtifactRecord> {
  const base = { contract: RELIABLE_FEEDBACK_ARTIFACT_CONTRACT, domain: "INDICATOR" as const, sourceNodeId: request.sourceNodeId, sourceType: request.sourceType, subject: { collaboratorId: request.collaboratorId, interactionId: null, indicatorMeasurementId: null }, policyVersion: deps.policy.version }
  const blocked = (reason: string, label = "Fechamento do PRV") => {
    const artifact: ReliableFeedbackArtifactV1 = { ...base, label, items: [], uncertainties: [], blockedReason: reason, writer: { invoked: false, skippedReason: reason, error: null, promptVersion: null } }
    return deps.store.complete(request.organizationId, artifactId, { disposition: "BLOCKED", policyVersion: deps.policy.version, normalizedInput: { failure: reason }, canonicalContext: null, artifact, writerInput: null, writerRawOutput: null, writerError: null, writerProvenance: null, reviews: [] }, deps.now())
  }
  if (!deps.prv) return blocked("PRV_CLOSING_NOT_SUPPORTED")
  const step = await runPrvClosingStep({ loadMonitoringContext: deps.loadMonitoringContext, loadPublishedKnowledge: deps.loadPublishedKnowledge, preparePrvClosingPlan: deps.prv.preparePrvClosingPlan, ...(deps.prv.prepareDirectIndicatorPlan ? { prepareDirectIndicatorPlan: deps.prv.prepareDirectIndicatorPlan } : {}), loadTeamObservations: deps.prv.loadTeamObservations, now: deps.now }, { organizationId: request.organizationId, collaboratorId: request.collaboratorId, agentId: request.configuredAgentId, sourceNodeOutput: request.sourceNodeOutput })
  // V2 — o diagnóstico DIRETO não é "fechamento do PRV": o rótulo é o indicador e o período.
  const labelOf = (plan: typeof step.plan) => plan?.closing ? (plan.source?.kind === "DIRECT_INDICATOR" ? `${plan.closing.indicators[0]?.indicatorName ?? plan.source.indicatorCode ?? "Indicador"} · ${referencePeriodLabel(plan.closing.referencePeriod)}` : `Fechamento de ${referencePeriodLabel(plan.closing.referencePeriod)}`) : undefined
  if (!step.ok) return blocked(step.reason, labelOf(step.plan) ?? (isDirectIndicatorSource(request.sourceNodeOutput) ? "Indicador" : undefined))

  const diagnosis = step.diagnosis
  const label = labelOf(step.plan)!
  const loadedAt = deps.now().toISOString()
  const built = buildPrvClosingItems(diagnosis)
  const canonicalByCode = new Map(diagnosis.investigations.map((investigation) => [investigation.indicatorCode, closingCanonicalContextOf(investigation, request.collaboratorId, loadedAt)]))
  // Sem diagnóstico acionável, a ESTRATÉGIA de cada indicador decide (nunca "sugestão genérica"): factual, QA ou nada.
  const behaviorOf = (code: string) => step.noDiagnosisBehaviors.get(code) ?? "FACTUAL_ONLY"
  const actionable = (code: string) => {
    const investigation = diagnosis.investigations.find((entry) => entry.indicatorCode === code)!
    return ACTIONABLE_CONCLUSIONS.includes(investigation.conclusion.type) || investigation.conclusion.type === "POSITIVE_PATTERN" || investigation.conclusion.strengthPatterns.length > 0
  }
  const kept = built.items.filter((item) => actionable(built.indicatorOf.get(item.index)!) || behaviorOf(built.indicatorOf.get(item.index)!) !== "NO_FEEDBACK")
  const items: ArtifactItem[] = kept.map((item) => {
    const code = built.indicatorOf.get(item.index)!
    const canonical = canonicalByCode.get(code)!
    const wording = built.wordings.get(item.index)!
    // Autovalidação: o texto do sistema passa pelos MESMOS validadores do feedback de indicador (números, causa, pares, rótulo…).
    const writerItem = isEmittableSection(item.section) && item.section !== "ATTENTION" ? toIndicatorWriterItem(item, `ITEM_${item.index + 1}`, canonical) : null
    const violations = writerItem ? validateIndicatorWording(wording, writerItem, canonical) : []
    const outcome: ReliableWriterOutcome = { invoked: false, writerError: null, source: "SYSTEM", violations, wording, claimModes: null }
    const decided = decideReliableItem(item, outcome, deps.policy)
    const decision = !actionable(code) && behaviorOf(code) === "HOLD_FOR_QA" ? holdForStrategy(decided) : decided
    const { analysis, ...rest } = item
    void analysis
    return { ...rest, analysisUsed: false, slot: null, proposedWording: wording, wordingSource: "SYSTEM" as const, writerViolations: violations, decision }
  })
  const itemRefs = kept.map((item) => ({ index: item.index, indicatorCode: built.indicatorOf.get(item.index)!, practiceKey: item.claimRef.split(":").slice(1).join(":") === "OFFICIAL" ? null : item.claimRef.split(":").slice(1).join(":") }))
  const recipient = deps.loadRecipient ? await deps.loadRecipient(request.organizationId, request.collaboratorId) : null
  const prvClosing: PrvClosingArtifactData = {
    contract: "PRV_CLOSING_FEEDBACK_V1",
    idempotencyKey: diagnosis.idempotencyKey,
    referencePeriod: diagnosis.referencePeriod,
    diagnosis,
    itemRefs,
    recipient,
    narrative: null,
    usage: { reanalysis: { agentRunId: step.agentRunId, assessedInteractions: diagnosis.investigations.reduce((sum, investigation) => sum + investigation.sample.reanalyzedInteractionCount, 0) }, narrative: null },
  }
  const artifact: ReliableFeedbackArtifactV1 = {
    ...base,
    label,
    items,
    uncertainties: [],
    blockedReason: items.length === 0 ? "NO_ACTIONABLE_DIAGNOSIS_NO_FEEDBACK" : null,
    writer: { invoked: false, skippedReason: null, error: null, promptVersion: null },
    prvClosing,
  }
  // O redator INTERPRETA o que vai sair (os itens que o QA aprovaria) — uma chamada; nada a emitir = nenhuma chamada.
  const prospective = emittedItems(artifact, items.filter((item) => item.decision.disposition === "HOLD_FOR_QA").map((item): ArtifactReviewState => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED", finalWording: null })))
  // Só há o que INTERPRETAR com padrão ou mudança de mix: resultado só factual (amostra insuficiente, sem padrão) = texto do
  // sistema, ZERO chamada ao modelo.
  const interpretable = prospective.some((item) => item.kind === "INDICATOR_DEVELOPMENT_PATTERN" || item.kind === "INDICATOR_STRENGTH_PATTERN") || diagnosis.investigations.some((investigation) => investigation.conclusion.mixShift)
  if (prospective.length > 0 && interpretable && deps.writer.writePrvNarrative) {
    const brief = prvNarrativeBriefOf(prospective, prvClosing)
    const written = await deps.writer.writePrvNarrative(brief).catch((error: unknown) => ({ draft: null, error: `PRV_NARRATIVE_WRITER_ERROR:${error instanceof Error ? error.name : "UNKNOWN"}`, provenance: null }))
    prvClosing.narrative = { version: PRV_NARRATIVE_VERSION, promptVersion: PRV_NARRATIVE_PROMPT_VERSION, itemsKey: brief.itemsKey, draft: written.draft, error: written.error, provenance: written.provenance }
    prvClosing.usage.narrative = written.provenance
    artifact.writer = { invoked: true, skippedReason: null, error: written.error, promptVersion: PRV_NARRATIVE_PROMPT_VERSION }
  } else {
    artifact.writer = { invoked: false, skippedReason: prospective.length === 0 ? "NO_EMITTABLE_ITEM" : !interpretable ? "NOTHING_TO_INTERPRET" : "PRV_NARRATIVE_WRITER_NOT_CONFIGURED", error: null, promptVersion: null }
  }

  const DISPOSITION_LABELS = { READY: "segue no feedback", HOLD_FOR_QA: "aguarda QA", BLOCKED: "bloqueado pela estrutura (não entra no feedback)" } as const
  const analysisOf = (item: ArtifactItem): ReviewAnalysisContext => ({
    position: items.indexOf(item) + 1,
    total: items.length,
    priorityBasis: item.priority?.basis ?? [],
    others: items.filter((other) => other !== item).map((other) => ({ position: items.indexOf(other) + 1, sectionLabel: isEmittableSection(other.section) ? SECTION_LABELS[other.section] : "Contexto", stepTitle: other.process?.stepTitle ?? null, dispositionLabel: DISPOSITION_LABELS[other.decision.disposition] })),
    presentation: null,
  })
  const reviews: NewReliableReview[] = items.flatMap((item): NewReliableReview[] => {
    if (item.decision.disposition !== "HOLD_FOR_QA" || !item.proposedWording || (item.section !== "STRENGTH" && item.section !== "OPPORTUNITY")) return []
    const canonical = canonicalByCode.get(built.indicatorOf.get(item.index)!)!
    return [{
      itemIndex: item.index,
      section: item.section,
      itemKind: item.kind,
      subjectLabel: label,
      reviewItem: { domain: "INDICATOR", writerItem: toIndicatorWriterItem({ ...item, analysis: null }, `ITEM_${item.index + 1}`, canonical), canonical, knowledge: item.knowledge, process: item.process, analysis: analysisOf(item) },
      // Texto do sistema é gravado como FALLBACK: a tabela de revisão só conhece redator × determinístico.
      wordingSource: "FALLBACK",
      writerViolations: item.writerViolations,
      proposedWording: item.proposedWording,
      reviewRequiredBy: [item.decision.policyVersion, ...item.decision.reasons],
    }]
  })
  const pending = reviews.map((review): ArtifactReviewState => ({ itemIndex: review.itemIndex, status: "PENDING_REVIEW", finalWording: null }))
  artifact.findings = findingsSummaryOf(artifact, pending)
  const disposition = currentDisposition(artifact, pending)
  return deps.store.complete(request.organizationId, artifactId, {
    disposition,
    policyVersion: deps.policy.version,
    normalizedInput: null,
    canonicalContext: null,
    artifact,
    writerInput: prvClosing.narrative ? { itemsVersion: PRV_CLOSING_ITEMS_VERSION, itemsKey: prvClosing.narrative.itemsKey } : null,
    writerRawOutput: prvClosing.narrative?.draft ?? null,
    writerError: prvClosing.narrative?.error ?? null,
    writerProvenance: null,
    reviews,
    observations: step.observations,
    prvDiagnosis: {
      sourceKind: diagnosis.source?.kind ?? "PRV_CLOSING",
      personId: request.collaboratorId,
      referencePeriod: diagnosis.referencePeriod,
      idempotencyKey: diagnosis.idempotencyKey,
      logicVersion: diagnosis.version,
      strategyVersions: step.plan.strategies.map((entry) => ({ indicatorCode: entry.indicatorCode, strategyVersionId: entry.strategyVersionId })),
      closing: { prv: step.plan.closing!.prv, indicators: step.plan.closing!.indicators, previous: step.plan.closing!.previous },
      diagnosis,
      enrollmentId: request.enrollmentId,
      generatedAt: diagnosis.generatedAt,
    },
  }, deps.now())
}
