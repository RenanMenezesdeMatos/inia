/**
 * REPLAY SEM CUSTO da rodada paga com análise inicial nova (C07, 01/10 à tarde) pelo código `CALL_ANALYSIS_LOGIC_V7` /
 * `SEMANTIC_AUDITABILITY_V1`. As respostas GRAVADAS da análise e da revisão (contrato V4/V2, anterior a esta versão) passam pela
 * verificação, revisão e brief atuais; nenhuma requisição a provedor (fetch bloqueado; o modelo falso devolve as respostas gravadas e
 * PARA na composição).
 *
 * Ajuste necessário: na V7 TODA linha da base recebe handle (o título da seção virou pista). As respostas gravadas citam os handles da
 * numeração antiga (só seções "executáveis" numeradas) — o script reconstrói a numeração antiga a partir da MESMA base e traduz cada
 * referência (linha da análise, orientação, grupos, conflitos; ids da revisão) para a linha certa. Nada mais é alterado.
 *
 * O que isto mostra: o que a lógica atual faz com as MESMAS leituras pagas (as leituras não têm os campos novos — aplicabilidade e
 * observabilidade derivam do status e da natureza que o próprio modelo deu). NÃO valida o que o modelo responderia ao contrato V5 nem
 * a redação — isso só uma rodada nova mediria (não executada).
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/replay-c07-v7.ts [--artifact results/validate-c07-fresh-paid-<ts>.json]
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { DEFAULT_ENGINE_BUDGET } from "../../../../src/modules/feedback-engine/application/engine-meter.js"
import { createEngineDeps } from "../../../../src/modules/feedback-engine/application/engine-wiring.js"
import { generateFeedback } from "../../../../src/modules/feedback-engine/application/generate-feedback.js"
import type { EngineModelPort } from "../../../../src/modules/feedback-engine/application/ports.js"
import { canonicalHandle } from "../../../../src/modules/feedback-engine/domain/call-analysis.js"
import { CALL_ANALYSIS_LOGIC_VERSION } from "../../../../src/modules/feedback-engine/domain/versions.js"
import { createInMemoryFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { createPostgresFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { loadFrozenSources } from "./frozen-call.js"

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const artifactPath = args.includes("--artifact") && args[args.indexOf("--artifact") + 1] ? args[args.indexOf("--artifact") + 1]! : "results/validate-c07-fresh-paid-2026-10-01T18-46-57-958Z.json"
type Paid = { responses: { stage: string; text: string | null }[]; result: { message: { brief: { strengths: { ref: string; title: string }[]; developments: { ref: string; title: string }[]; openPoints?: { ref: string; title: string }[] }; card: string | null } } }
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

/** Numeração ANTIGA (só linhas de seções "executáveis" pelo título, em ordem) → handle NOVO da mesma linha. */
function oldToNewHandles(context: Awaited<ReturnType<typeof loadFrozenSources>>["context"]): Map<string, string> {
  const map = new Map<string, string>()
  let counter = 0
  for (const document of context.documents) {
    for (const section of document.sections) {
      if (!section.executable) continue
      for (const line of section.lines) map.set(`L${++counter}`, line.handle)
    }
  }
  return map
}
function remapAnalysis(text: string, map: ReadonlyMap<string, string>): string {
  const json = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1")) as Record<string, unknown>
  const swap = (value: unknown) => (typeof value === "string" ? map.get(canonicalHandle(value)) ?? value : value)
  for (const criterion of (json.criteria as Record<string, unknown>[] | undefined) ?? []) {
    criterion.line = swap(criterion.line)
    const guidance = criterion.guidance as { ruleLines?: unknown[] } | null | undefined
    if (guidance?.ruleLines) guidance.ruleLines = guidance.ruleLines.map(swap)
  }
  for (const group of (json.groupDispositions as { lines: unknown[] }[] | undefined) ?? []) group.lines = group.lines.map(swap)
  for (const conflict of (json.sourceConflicts as { lines: unknown[] }[] | undefined) ?? []) conflict.lines = conflict.lines.map(swap)
  return JSON.stringify(json)
}
function remapReview(text: string, map: ReadonlyMap<string, string>): string {
  const json = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1")) as Record<string, unknown>
  for (const key of ["claims", "linesToAssess", "exclusions"]) for (const entry of (json[key] as { id: string }[] | undefined) ?? []) entry.id = map.get(canonicalHandle(entry.id)) ?? entry.id
  return JSON.stringify(json)
}

const readDb = createReadOnlyDatabase(pool)
try {
  const frozen = await loadFrozenSources(readDb, "C07")
  const map = oldToNewHandles(frozen.context)
  const analysis = remapAnalysis(analysisText, map)
  const review = remapReview(reviewText, map)
  const overlay = createInMemoryFeedbackMemoryStore()
  const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(readDb), overlay)
  const stages: string[] = []
  const model: EngineModelPort = {
    async generate(request) {
      stages.push(request.stage)
      const reply = (text: string) => ({ text, model: "replay", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 0, costUsd: 0, finishReason: "STOP" })
      if (request.stage === "CALL_ANALYSIS") return reply(analysis)
      if (request.stage === "CALL_REVIEW") return reply(review)
      throw Object.assign(new Error("REPLAY: composição não é chamada."), { name: "ReplayStop" })
    },
  }
  const deps = createEngineDeps({ db: readDb, stores, model, peerCallAnalyses: false, allowCollaborator: (id) => id === frozen.person.id, budget: { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: 3 } })
  await generateFeedback(deps, { organizationId: frozen.org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "replay-v7-C07", sourceNodeId: "analise-v7-C07", domain: "MONITORING", sourceNodeOutput: null, collaboratorId: frozen.person.id, interactionId: frozen.interaction.id, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: "Replay sem custo (V7) das respostas pagas da C07.", now: new Date() }).catch(() => undefined)
  const message = [...overlay.messages.values()][0]
  const assessment = overlay.assessments.find((entry) => entry.isCurrent)
  if (!message?.brief || !assessment) throw new Error("Replay sem brief.")
  const criteria = assessment.analysis.criteria
  const pick = (text: string) => criteria.filter((criterion) => criterion.text.includes(text)).map((criterion) => ({ rule: criterion.text, proposed: criterion.proposedStatus, final: criterion.status, observability: criterion.observability ?? null, executionClaim: criterion.executionClaim ?? null, downgrades: criterion.downgrades }))
  const before = paid.result.message
  const report = {
    kind: "ZERO_COST_REPLAY_NOT_A_MODEL_VALIDATION",
    logic: CALL_ANALYSIS_LOGIC_VERSION,
    stages,
    providerRequests: 0,
    handleRemap: { oldLines: map.size, newLines: frozen.context.lines.size },
    focus: { corrigirStatus: pick("Corrigir o status"), registrar: pick("Registrar"), contestar: pick("Contestar cobranças posteriores"), servicoCancelado: pick("Serviço cancelado"), estorno: pick("Estorno") },
    coverageLimits: assessment.analysis.coverageLimits,
    decisions: criteria.filter((criterion) => ["MET", "NOT_MET", "PARTIAL"].includes(criterion.proposedStatus)).map((criterion) => `${criterion.text.slice(0, 70)} | proposta ${criterion.proposedStatus} → ${criterion.status} (${criterion.confirmation}${criterion.downgrades.length ? `; ${criterion.downgrades.join("+")}` : ""})`),
    before: { developments: before.brief.developments.map((finding) => `${finding.ref} ${finding.title}`), strengths: before.brief.strengths.map((finding) => `${finding.ref} ${finding.title}`), openPoints: (before.brief.openPoints ?? []).map((point) => `${point.ref} ${point.title}`), card: before.card },
    after: { tone: message.brief.tone, developments: message.brief.developments.map((finding) => `${finding.ref} ${finding.title}`), strengths: message.brief.strengths.map((finding) => `${finding.ref} ${finding.title} (${finding.role ?? "—"})`), openPoints: (message.brief.openPoints ?? []).map((point) => `${point.ref} ${point.title}: ${point.why}`), coverageLimits: (message.brief.coverageLimits ?? []).map((limit) => `${limit.title} [${limit.reason}${limit.executionClaim ? ` · ${limit.executionClaim}` : ""}]`), readerNotes: message.brief.readerNotes ?? [] },
  }
  const out = join(here, "results", `replay-c07-v7-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 1))
  console.log(`\nArtefato: ${out}`)
} finally {
  await pool.end()
}
