/**
 * Indicator Diagnosis V1 — REPLAY OFFLINE de um smoke do diagnóstico do fechamento: pega a resposta REAL gravada do Agent
 * (`agent_runs.output_text`), reconstrói o que foi apresentado a ele (plano + recuperação de base, ambos determinísticos) e roda o
 * MESMO "Gerar feedback" do fechamento com store em memória e SEM redator — nada é gravado, nenhum modelo é chamado.
 *   npx tsx scripts/dev/replay-prv-closing-smoke.ts <agentRunId> <personId> <agentId>
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import { renderDiagnosisSampleForAgent } from "../../src/modules/agents/domain/indicator-diagnosis-contract.js"
import { parseInteractionAssessments } from "../../src/modules/agents/domain/indicator-diagnosis-contract.js"
import { retrieveKnowledgeForAgent } from "../../src/modules/knowledge/application/retrieve-knowledge.js"
import { preparePrvClosingPlan } from "../../src/modules/indicator-diagnosis/application/prepare-prv-closing.js"
import { loadTeamObservations } from "../../src/modules/indicator-diagnosis/application/load-prv-closing-data.js"
import { referencePeriodLabel } from "../../src/modules/indicator-diagnosis/domain/prv-closing.js"
import { generateReliableFeedback } from "../../src/modules/reliable-feedback/application/generate-reliable-feedback.js"
import { createReliableGenerationDeps } from "../../src/modules/reliable-feedback/application/reliable-feedback-wiring.js"
import { PRV_CLOSING_SOURCE_CONTRACT, PRV_CLOSING_SOURCE_KIND } from "../../src/modules/reliable-feedback/application/prv-closing-step.js"
import { createInMemoryReliableFeedbackStore } from "../../src/modules/reliable-feedback/infrastructure/in-memory-reliable-feedback-store.js"
import { emittedItems } from "../../src/modules/reliable-feedback/domain/reliable-feedback-artifact.js"
import { prvCollaboratorViewOf, prvSupervisorViewOf, resolvePrvNarrative } from "../../src/modules/reliable-feedback/domain/prv-closing-views.js"
import { loadLatestTranscript } from "../../src/modules/workflows/application/transcript.js"
/** O mesmo recorte do JSON da resposta (texto em volta tolerado) que o runAgent aplica. */
const parseJsonOutput = (text: string): unknown => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))

const [agentRunId, personId, agentId] = process.argv.slice(2)
const ORG = "00000000-0000-4000-8000-000000000001"
const now = new Date()
const raw = (await pool.query<{ output_text: string }>("select output_text from agent_runs where id = $1", [agentRunId])).rows[0]!.output_text
const plan = await preparePrvClosingPlan(pool, ORG, { personId: personId!, now, agentId: agentId! })
const transcripts = await Promise.all(plan.toAssess.map(async (request) => ({ handle: request.handle, localDate: request.localDate, transcript: (await loadLatestTranscript(pool, request.interactionId))?.content ?? "" })))
const first = plan.investigations.find((investigation) => investigation.toAssess.length > 0)!
const period = referencePeriodLabel(plan.closing!.referencePeriod)
const query = renderDiagnosisSampleForAgent({ segmentText: first.selectedSegment ? `Motivo investigado pelo sistema: ${first.selectedSegment.label} (fechamento de ${period}). O sistema já escolheu as chamadas; avalie os processos de cada uma.` : null, periodLabel: period, sample: transcripts })
const knowledge = await retrieveKnowledgeForAgent(pool, agentId!, query, undefined, process.env.REPLAY_COVERAGE === "0" ? null : { phases: ["CLOSING"], subject: first.selectedSegment?.label ?? null }, { markProcessRoles: true, governanceSubjectPersonId: personId! })
const presented = knowledge.trace.retrieved.map((entry) => ({ documentId: entry.documentId, documentTitle: entry.documentTitle, heading: entry.heading, excerpt: entry.excerpt, ...(typeof entry.chunkIndex === "number" ? { chunkIndex: entry.chunkIndex } : {}) }))
const parsed = parseInteractionAssessments((parseJsonOutput(raw) as { interactionAssessments?: unknown }).interactionAssessments, plan.toAssess.map((request) => request.handle), presented, knowledge.trace.checkpointCatalog ?? null)
console.log(JSON.stringify({ plan: { status: plan.status, toAssess: plan.toAssess.map((request) => request.handle), investigations: plan.investigations.map((investigation) => ({ code: investigation.indicatorCode, status: investigation.status, segment: investigation.selectedSegment?.label, eligible: investigation.eligibleInteractions.length })) }, parse: { valid: parsed.valid, accepted: parsed.accepted.map((entry) => entry.interactionRef), rejected: parsed.rejected.map((entry) => ({ ref: entry.interactionRef, issues: entry.issues.map((issue) => `${issue.code}@${issue.path}`) })) } }, null, 2))
const source = { kind: PRV_CLOSING_SOURCE_KIND, contract: PRV_CLOSING_SOURCE_CONTRACT, organizationId: ORG, personId, referencePeriod: plan.closing!.referencePeriod, idempotencyKey: plan.idempotencyKey, strategies: plan.strategies, sample: plan.toAssess.map((request) => ({ handle: request.handle, interactionId: request.interactionId })), assessment: { agentRunId, interactionAssessments: parsed.accepted, knowledgeExcerpts: presented, ...(knowledge.trace.checkpointGovernance ? { checkpointGovernance: knowledge.trace.checkpointGovernance } : {}) } }
const store = createInMemoryReliableFeedbackStore()
const deps = { ...createReliableGenerationDeps({ db: pool }), store, writer: { writeMonitoring: async () => ({ rawOutput: null }), writeIndicator: async () => ({ rawOutput: null }) }, prv: { preparePrvClosingPlan: (organizationId: string, request: Parameters<typeof preparePrvClosingPlan>[2]) => preparePrvClosingPlan(pool, organizationId, request), loadTeamObservations: (organizationId: string, request: { personId: string; start: Date; end: Date; practiceKeys: readonly string[] }) => loadTeamObservations(pool, { organizationId, ...request }) } }
const result = await generateReliableFeedback(deps, { organizationId: ORG, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "feedback", sourceNodeId: "agent", sourceType: "AGENT", domain: "INDICATOR", sourceNodeOutput: source, collaboratorId: personId!, interactionId: null, indicatorMeasurementId: null, configuredAgentId: agentId! })
const artifact = result.record.artifact!
const data = artifact.prvClosing!
const items = emittedItems(artifact, [])
const narrative = resolvePrvNarrative(null, items, data)
const investigation = data?.diagnosis.investigations[0]
console.log(JSON.stringify({
  disposition: result.nodeOutput.disposition,
  blockedReason: artifact.blockedReason,
  items: artifact.items.map((item) => ({ kind: item.kind, disposition: item.decision.disposition, reasons: item.decision.reasons, violations: item.writerViolations, observed: item.proposedWording?.observed })),
  conclusion: investigation?.conclusion,
  sample: investigation?.sample,
  patterns: investigation?.patterns?.behaviors.map((behavior) => ({ title: behavior.title, classification: behavior.classification, eligible: behavior.eligible, counts: behavior.counts })),
  mix: investigation?.mix?.shifted,
  discarded: investigation?.sample.discarded,
  collaborator: prvCollaboratorViewOf(items, data, narrative).narrative,
  supervisor: prvSupervisorViewOf(data, narrative).indicators[0]?.limitations,
}, null, 2))
await pool.end()
