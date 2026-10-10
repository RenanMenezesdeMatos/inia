/**
 * REPLAY SEM CUSTO da rodada paga com análise inicial NOVA (C07, 01/10 à tarde): as respostas GRAVADAS da análise e da revisão
 * passam pelo código atual (decisão de confirmação, alvos da revisão, brief) — nenhuma requisição a provedor (fetch bloqueado; o
 * modelo falso devolve as respostas gravadas e PARA na composição). Mostra (1) o pedido de revisão que o código atual montaria a
 * partir da MESMA análise e (2) o que a decisão atual faz com a MESMA resposta da revisão. Não valida redação nem o que uma revisora
 * responderia ao pedido novo — isso só uma rodada nova mediria.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/replay-c07-fresh.ts [--artifact results/validate-c07-fresh-paid-<ts>.json]
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { DEFAULT_ENGINE_BUDGET } from "../../../../src/modules/feedback-engine/application/engine-meter.js"
import { createEngineDeps } from "../../../../src/modules/feedback-engine/application/engine-wiring.js"
import { generateFeedback } from "../../../../src/modules/feedback-engine/application/generate-feedback.js"
import type { EngineModelPort } from "../../../../src/modules/feedback-engine/application/ports.js"
import { createInMemoryFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { createPostgresFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { loadFrozenSources } from "./frozen-call.js"

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const artifactPath = args.includes("--artifact") && args[args.indexOf("--artifact") + 1] ? args[args.indexOf("--artifact") + 1]! : "results/validate-c07-fresh-paid-2026-10-01T18-46-57-958Z.json"
type Paid = { responses: { stage: string; text: string | null }[]; result: { message: { brief: { strengths: { ref: string; title: string }[]; developments: { ref: string; title: string }[]; openPoints?: { ref: string; title: string }[] }; card: string | null; text: string | null } } }
const paid = JSON.parse(readFileSync(join(here, artifactPath), "utf8")) as Paid
const recorded = (stage: string) => paid.responses.find((entry) => entry.stage === stage)?.text ?? null
const analysisText = recorded("CALL_ANALYSIS")
const reviewText = recorded("CALL_REVIEW")
if (!analysisText || !reviewText) throw new Error("Artefato sem as respostas da análise e da revisão — nada a reproduzir.")

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (/generativelanguage|anthropic|openai|x\.ai/.test(url)) throw new Error(`REPLAY: requisição a ${new URL(url).host} bloqueada.`)
  return realFetch(input, init)
}) as typeof fetch

const readDb = createReadOnlyDatabase(pool)
try {
  const frozen = await loadFrozenSources(readDb, "C07")
  const overlay = createInMemoryFeedbackMemoryStore()
  const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(readDb), overlay)
  const stages: string[] = []
  let reviewRequest: string | null = null
  const model: EngineModelPort = {
    async generate(request) {
      stages.push(request.stage)
      const reply = (text: string) => ({ text, model: "replay", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 0, costUsd: 0, finishReason: "STOP" })
      if (request.stage === "CALL_ANALYSIS") return reply(analysisText)
      if (request.stage === "CALL_REVIEW") {
        reviewRequest = request.contents[0]!.text
        return reply(reviewText)
      }
      throw Object.assign(new Error("REPLAY: composição não é chamada."), { name: "ReplayStop" })
    },
  }
  const deps = createEngineDeps({ db: readDb, stores, model, peerCallAnalyses: false, allowCollaborator: (id) => id === frozen.person.id, budget: { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: 3 } })
  await generateFeedback(deps, { organizationId: frozen.org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "replay-fresh-C07", sourceNodeId: "analise-fresh-C07", domain: "MONITORING", sourceNodeOutput: null, collaboratorId: frozen.person.id, interactionId: frozen.interaction.id, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: "Validação da versão corrigida (C07), análise inicial nova.", now: new Date() }).catch(() => undefined)
  const message = [...overlay.messages.values()][0]
  const assessment = overlay.assessments.find((entry) => entry.isCurrent)
  if (!message?.brief || !assessment) throw new Error("Replay sem brief.")
  const payload = reviewRequest ? (JSON.parse((reviewRequest as string).split("PROPOSTAS DA ANÁLISE A REVISAR (JSON):")[1]!) as { claims: { id: string; attention: string[]; rule: { text: string; sameList: unknown[] } }[]; exclusions?: { id: string; excludedAs: string; rule: { text: string } }[]; linesToAssess?: unknown[] }) : null
  const before = paid.result.message
  console.log(JSON.stringify({
    stages,
    providerRequests: 0,
    reviewRequestNow: payload && {
      openingClaims: payload.claims.filter((claim) => claim.attention.includes("LIST_OPENING")).map((claim) => ({ rule: claim.rule.text, items: claim.rule.sameList.length })),
      aggregatedTargets: (payload.exclusions ?? []).filter((target) => target.excludedAs === "AGGREGATED").map((target) => target.rule.text),
      otherExclusions: (payload.exclusions ?? []).filter((target) => target.excludedAs !== "AGGREGATED").length,
      linesToAssess: (payload.linesToAssess ?? []).length,
    },
    decisions: assessment.analysis.criteria.filter((criterion) => ["MET", "NOT_MET", "PARTIAL"].includes(criterion.proposedStatus)).map((criterion) => `${criterion.text.slice(0, 60)} | proposta ${criterion.proposedStatus} → ${criterion.status} (${criterion.confirmation}${criterion.confirmationReasons.length ? `: ${criterion.confirmationReasons.join("+")}` : ""})`),
    review: assessment.analysis.checks.review,
    auditNotes: assessment.analysis.auditNotes,
    before: { developments: before.brief.developments.map((finding) => `${finding.ref} ${finding.title}`), strengths: before.brief.strengths.map((finding) => `${finding.ref} ${finding.title}`), openPoints: (before.brief.openPoints ?? []).map((point) => `${point.ref} ${point.title}`), card: before.card },
    after: { tone: message.brief.tone, developments: message.brief.developments.map((finding) => `${finding.ref} ${finding.title}`), strengths: message.brief.strengths.map((finding) => `${finding.ref} ${finding.title} (${finding.role ?? "—"})`), openPoints: (message.brief.openPoints ?? []).map((point) => `${point.ref} ${point.title}: ${point.why}`), readerNotes: message.brief.readerNotes ?? [] },
  }, null, 1))
} finally {
  await pool.end()
}
