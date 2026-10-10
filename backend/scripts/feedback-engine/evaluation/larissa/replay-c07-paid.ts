/**
 * REPLAY SEM CUSTO da rodada paga da C07 (01/10): mesmas propostas congeladas, a RESPOSTA DA REVISÃO gravada no artefato pago e
 * a versão atual do brief — nenhuma requisição a provedor (fetch bloqueado; o modelo falso devolve a revisão gravada e PARA na
 * composição). Serve para ver o que a versão atual do brief entrega ao redator a partir da MESMA leitura da revisão e para gerar o
 * fixture do teste (`testing/c07-reviewed-analysis.json`). Não avalia redação (a composição não é chamada).
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/replay-c07-paid.ts [--artifact results/validate-c07-paid-<ts>.json] [--write-fixture]
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { analysisKeysOf } from "../../../../src/modules/feedback-engine/application/analyze-call.js"
import { DEFAULT_ENGINE_BUDGET } from "../../../../src/modules/feedback-engine/application/engine-meter.js"
import { createEngineDeps } from "../../../../src/modules/feedback-engine/application/engine-wiring.js"
import { generateFeedback } from "../../../../src/modules/feedback-engine/application/generate-feedback.js"
import type { EngineModelPort } from "../../../../src/modules/feedback-engine/application/ports.js"
import { CALL_ANALYSIS_CHECKPOINT_VERSION } from "../../../../src/modules/feedback-engine/domain/analysis-recovery.js"
import { createInMemoryFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { createPostgresFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { DEFAULT_PAID_ARTIFACT, loadFrozenCall } from "./frozen-call.js"

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const artifactPath = args[args.indexOf("--artifact") + 1] && args.includes("--artifact") ? args[args.indexOf("--artifact") + 1]! : "results/validate-c07-paid-2026-10-01T13-48-48-413Z.json"
const paid = JSON.parse(readFileSync(join(here, artifactPath), "utf8")) as { responses: { stage: string; text: string | null }[]; result: { message: { brief: { strengths: { ref: string; title: string }[]; developments: { ref: string; title: string }[] } } } }
const review = paid.responses.find((entry) => entry.stage === "CALL_REVIEW")?.text
if (!review) throw new Error("Artefato sem a resposta da revisão — nada a reproduzir.")

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (/generativelanguage|anthropic|openai|x\.ai/.test(url)) throw new Error(`REPLAY: requisição a ${new URL(url).host} bloqueada.`)
  return realFetch(input, init)
}) as typeof fetch

const readDb = createReadOnlyDatabase(pool)
try {
  const frozen = await loadFrozenCall(readDb, "C07")
  const overlay = createInMemoryFeedbackMemoryStore()
  const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(readDb), overlay)
  const { proposalKey, analysisKey } = analysisKeysOf({ interaction: frozen.interaction, agent: frozen.agent, documents: frozen.chosen.selected, context: frozen.context, projection: frozen.projection, transcriptStatus: frozen.transcriptStatus, subject: frozen.subject })
  const at = new Date()
  const claim = await overlay.claimAnalysis({ organizationId: frozen.org, kind: "CALL_ANALYSIS", analysisKey, personId: frozen.person.id, interactionId: frozen.interaction.id, indicatorDefinitionId: null, periodStart: null, periodEnd: null, agentId: frozen.agent.id, trigger: { kind: "EVALUATION", selectionReason: "Replay sem custo (C07)." }, logicVersion: "seed", asOf: at }, at, 60)
  if (claim.kind !== "CLAIMED") throw new Error("Semente não criada.")
  await overlay.suspendCallAnalysis(frozen.org, claim.runId, { error: "REVIEW_PENDING:FROZEN_PROPOSALS", checkpoint: { version: CALL_ANALYSIS_CHECKPOINT_VERSION, stage: "REVIEW_PENDING", proposalKey, reason: "TECHNICAL", error: "FROZEN_PROPOSALS_FROM_PAID_RUN", reviewAttempts: 0, since: at.toISOString(), lastAttemptAt: at.toISOString() }, provenance: { proposalKey, modelResponses: { analysis: { requestSha256: "FROZEN_PAID_RUN_2026-09-30", text: JSON.stringify(frozen.proposals) }, review: null }, frozenFrom: DEFAULT_PAID_ARTIFACT }, metrics: {} }, at)
  const stages: string[] = []
  const model: EngineModelPort = {
    async generate(request) {
      stages.push(request.stage)
      if (request.stage === "CALL_REVIEW") return { text: review, model: "replay", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 0, costUsd: 0, finishReason: "STOP" }
      throw Object.assign(new Error("REPLAY: composição não é chamada."), { name: "ReplayStop" })
    },
  }
  const deps = createEngineDeps({ db: readDb, stores, model, peerCallAnalyses: false, allowCollaborator: (id) => id === frozen.person.id, budget: { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: 3 } })
  await generateFeedback(deps, { organizationId: frozen.org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "replay-C07", sourceNodeId: "analise-C07", domain: "MONITORING", sourceNodeOutput: null, collaboratorId: frozen.person.id, interactionId: frozen.interaction.id, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: "Validação mínima (C07).", now: new Date() }).catch(() => undefined)
  const message = [...overlay.messages.values()][0]
  const assessment = overlay.assessments.find((entry) => entry.analysisRunId === claim.runId && entry.isCurrent)
  if (!message?.brief || !assessment) throw new Error("Replay sem brief.")
  const before = paid.result.message.brief
  console.log(JSON.stringify({
    stages,
    providerRequests: 0,
    before: { strengths: before.strengths.map((finding) => `${finding.ref} ${finding.title}`), developments: before.developments.map((finding) => `${finding.ref} ${finding.title}`) },
    after: { strengths: message.brief.strengths.map((finding) => ({ ref: finding.ref, title: finding.title, situational: finding.situational ?? false, quotes: finding.quotes.map((quote) => `${quote.turn} ${quote.speaker}: ${quote.text}`) })), developments: message.brief.developments.map((finding) => `${finding.ref} ${finding.title}`), heading: message.brief.heading },
  }, null, 1))
  if (args.includes("--write-fixture")) {
    const fixture = { source: `replay de ${artifactPath} (resposta da revisão gravada; propostas congeladas de ${DEFAULT_PAID_ARTIFACT})`, interactionId: frozen.interaction.id, analysis: assessment.analysis, criterionKeys: assessment.criterionKeys, documentTitles: Object.fromEntries(frozen.chosen.selected.map((document) => [document.documentId, document.title])) }
    writeFileSync(join(here, "../../../../src/modules/feedback-engine/testing/c07-reviewed-analysis.json"), JSON.stringify(fixture, null, 1))
    console.log("fixture gravado: src/modules/feedback-engine/testing/c07-reviewed-analysis.json")
  }
} finally {
  await pool.end()
}
