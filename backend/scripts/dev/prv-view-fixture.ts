/**
 * Indicator Diagnosis V1 — gera o view model REAL (colaborador + supervisor) de um diagnóstico de fechamento sintético, pelas
 * MESMAS funções do backend, para a fixture dos testes do frontend. Sem banco, sem modelo.
 *   npx tsx scripts/dev/prv-view-fixture.ts > ../frontend/src/components/feedbacks/__fixtures__/prv-indicator-views.json
 */
import { triageIndicator } from "../../src/modules/indicator-diagnosis/domain/closing-triage.js"
import { summarizeOperationalPatterns, type OperationalObservation } from "../../src/modules/indicator-diagnosis/domain/operational-patterns.js"
import { mixShiftOf } from "../../src/modules/indicator-diagnosis/domain/population-mix.js"
import type { OfficialIndicatorSnapshot, PrvClosing } from "../../src/modules/indicator-diagnosis/domain/prv-closing.js"
import { buildIndicatorInvestigation, buildPrvClosingDiagnosis } from "../../src/modules/indicator-diagnosis/domain/prv-investigation.js"
import { buildPrvClosingItems } from "../../src/modules/reliable-feedback/domain/prv-closing-items.js"
import { prvCollaboratorViewOf, prvSupervisorViewOf, resolvePrvNarrative, type PrvClosingArtifactData } from "../../src/modules/reliable-feedback/domain/prv-closing-views.js"
import { emittedItems, type ReliableFeedbackArtifactV1 } from "../../src/modules/reliable-feedback/domain/reliable-feedback-artifact.js"
import { decideReliableItem, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../../src/modules/reliable-feedback/domain/reliable-feedback-item.js"

const TMA: OfficialIndicatorSnapshot = { snapshotId: "snap", indicatorId: "ind", indicatorCode: "TMA", indicatorName: "TMA", unit: "SECONDS", direction: "LOWER", referencePeriod: "2026-08", value: 495, target: 450, achievementPercent: 90.9, weightPercent: 25, quartile: "Q4", subteamId: null }
const closing: PrvClosing = { contract: "PRV_CLOSING_V1", organizationId: "org", personId: "person", referencePeriod: "2026-08", prv: { snapshotId: "prv", referencePeriod: "2026-08", achievementPercent: 88, quartile: "Q4" }, indicators: [TMA], previous: { referencePeriod: "2026-07", prv: null, indicators: [{ ...TMA, snapshotId: "prev", referencePeriod: "2026-07", value: 410, quartile: "Q2" }] } }
const rule = { documentId: "doc-contestacao", documentTitle: "Procedimento de Contestação de Cobrança", heading: "46. Recapitulação", quote: "Antes de encerrar, recapitule o que foi feito, o próximo passo e o prazo." }
const obs = (id: string, status: OperationalObservation["status"], overrides: Partial<OperationalObservation> = {}): OperationalObservation => ({ interactionId: id, practiceKey: "BEHAVIOR:RECAPITULATE_INTERACTION", behavior: "RECAPITULATE_INTERACTION", title: "Recapitulação", requirement: "Recapitular", documentId: rule.documentId, documentTitle: rule.documentTitle, status, completeness: status === "NOT_FOLLOWED" ? "PARTIAL" : null, analyticsStatus: "VERIFIED", origin: "ASSESSED", evidence: [{ text: status === "NOT_FOLLOWED" ? "Então fica aberta a contestação, tá bom?" : "Resumindo: abri a contestação e o prazo é de até cinco dias úteis.", truncated: false }], rule, guidance: null, ...overrides })
const ids = ["i1", "i2", "i3", "i4", "i5", "i6"]
const triage = triageIndicator(TMA, closing.previous!.indicators[0]!, { versionId: "v1", version: 1, closingTriage: { enabled: true, developmentQuartiles: ["Q3", "Q4"], belowTarget: false, quartileWorsened: false, recognitionQuartiles: ["Q1"] } })
const observations = [...ids.map((id, index) => obs(id, index < 4 ? "NOT_FOLLOWED" : "FOLLOWED")), ...ids.map((id) => obs(id, "FOLLOWED", { practiceKey: "BEHAVIOR:PROVIDE_PROTOCOL", behavior: "PROVIDE_PROTOCOL", title: "Protocolo", completeness: null, evidence: [{ text: "Anota o protocolo da contestação, por favor.", truncated: false }] }))]
const investigation = buildIndicatorInvestigation({
  closing, triage, strategy: { versionId: "v1", version: 1 },
  snapshot: { indicatorId: "ind", indicatorCode: "TMA", indicatorName: "TMA", unit: "SECONDS", direction: "LOWER", snapshotId: "snap" },
  window: { startDate: "2026-08-01", endDate: "2026-09-01", timeZone: "America/Sao_Paulo" },
  metric: "INTERACTION_DURATION_SECONDS", interactionsInPeriod: 50,
  segments: [{ key: "CONT", label: "Contestação de cobrança", canonical: true, interactions: 17, withTranscript: 12, averageDurationSeconds: 620, sharePercent: 34, eligible: true }, { key: "SEG", label: "Segunda via", canonical: true, interactions: 33, withTranscript: 20, averageDurationSeconds: 380, sharePercent: 66, eligible: true }],
  selectedSegment: { key: "CONT", label: "Contestação de cobrança", reason: "maior tempo registrado acima da média geral do período, ponderado pelo volume de atendimentos" },
  overallAverageDurationSeconds: 462,
  sample: { eligibleCount: 12, reusableCount: 2, incompatibleCount: 0, unobservedCount: 10, selectedForAssessment: 4, analyzedCount: 6, reusedObservationCount: 4, reanalyzedInteractionCount: 4, newObservationCount: 8, selectionReason: "2 reaproveitadas; 4 novas", sampling: null, discarded: [] },
  minimumAnalyzed: 3,
  mix: mixShiftOf([{ key: "CONT", label: "Contestação de cobrança", interactions: 17, totalDurationSeconds: 17 * 620 }, { key: "SEG", label: "Segunda via", interactions: 33, totalDurationSeconds: 33 * 380 }], [{ key: "CONT", label: "Contestação de cobrança", interactions: 9, totalDurationSeconds: 9 * 600 }, { key: "SEG", label: "Segunda via", interactions: 41, totalDurationSeconds: 41 * 370 }]),
  patterns: summarizeOperationalPatterns({ interactions: ids.map((id, index) => ({ interactionId: id, localDate: `2026-08-${String(4 + index * 4).padStart(2, "0")}`, weekday: 1 + (index % 5), hour: 10, segmentKey: "CONT", segmentLabel: "Contestação de cobrança", origin: index < 2 ? "REUSED" : "ASSESSED" })), observations, eligiblePopulation: 12 }),
  team: { status: "AVAILABLE", contributors: 6, observedInteractions: 18, behaviors: [{ practiceKey: "BEHAVIOR:CONFIRM_UNDERSTANDING", title: "Confirmação de entendimento", eligible: 18, followed: 5, notFollowed: 13, classification: "DEVELOPMENT" }] },
})
const diagnosis = buildPrvClosingDiagnosis({ closing, triage: { version: "CLOSING_TRIAGE_V1", referencePeriod: "2026-08", decisions: [triage] }, investigations: [investigation], idempotencyKey: "PRV_DIAGNOSIS_V1:2026-08:fixture", generatedAt: "2026-09-29T12:00:00.000Z" })
const built = buildPrvClosingItems(diagnosis)
const items = built.items.map((item) => { const wording = built.wordings.get(item.index)!; const { analysis, ...rest } = item; void analysis; return { ...rest, analysisUsed: false, slot: null, proposedWording: wording, wordingSource: "SYSTEM" as const, writerViolations: [], decision: decideReliableItem(item, { invoked: false, writerError: null, source: "SYSTEM", violations: [], wording, claimModes: null }, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY) } })
const data: PrvClosingArtifactData = { contract: "PRV_CLOSING_FEEDBACK_V1", idempotencyKey: diagnosis.idempotencyKey, referencePeriod: "2026-08", diagnosis, itemRefs: built.items.map((item) => ({ index: item.index, indicatorCode: "TMA", practiceKey: item.claimRef.endsWith(":OFFICIAL") ? null : item.claimRef.slice("TMA:".length) })), recipient: { firstName: "Larissa" }, narrative: null, usage: { reanalysis: { agentRunId: null, assessedInteractions: 4 }, narrative: null } }
const artifact = { contract: "RELIABLE_FEEDBACK_ARTIFACT_V1", domain: "INDICATOR", sourceNodeId: "agent", sourceType: "AGENT", subject: { collaboratorId: "person", interactionId: null, indicatorMeasurementId: null }, label: "Fechamento de agosto de 2026", items, uncertainties: [], blockedReason: null, policyVersion: "P", writer: { invoked: false, skippedReason: null, error: null, promptVersion: null }, prvClosing: data } as ReliableFeedbackArtifactV1
const emitted = emittedItems(artifact, [])
const narrative = resolvePrvNarrative(null, emitted, data)
process.stdout.write(JSON.stringify({ collaborator: prvCollaboratorViewOf(emitted, data, narrative), supervisor: prvSupervisorViewOf(data, narrative) }, null, 2) + "\n")
