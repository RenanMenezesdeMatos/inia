/**
 * REPLAY SEM CUSTO — Larissa Monteiro, artefatos da rodada paga de 30/09 (lógica V3) pelo pipeline ATUAL (análise V4 com revisão,
 * identidade V3, investigação com ferramentas, composição V3). ZERO chamada de modelo: o "modelo" do replay RECUSA toda chamada
 * (e registra o tamanho do pedido, para o plano de validação); o orçamento do medidor é 0. Banco em transação SOMENTE LEITURA,
 * memória sobreposta em RAM. Nada é gravado, entregue ou notificado. O gabarito NÃO é lido.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/replay-v4.ts [--artifact results/paid-….json]
 *
 * O que isto PROVA: o que o pipeline novo faz com as propostas REAIS do analisador da rodada paga quando não há revisão (nada vira
 * fato; a mensagem não é escrita), quais propostas iriam para a revisora e com que foco, e o que a investigação do TMA faria antes
 * de qualquer IA. O que NÃO prova: o comportamento da revisora, do planejador ou do redator com modelo real.
 */
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { reviewAnalysis } from "../../../../src/modules/feedback-engine/application/analyze-call.js"
import { createEngineDeps } from "../../../../src/modules/feedback-engine/application/engine-wiring.js"
import { DEFAULT_ENGINE_BUDGET } from "../../../../src/modules/feedback-engine/application/engine-meter.js"
import { investigateIndicator } from "../../../../src/modules/feedback-engine/application/investigate-indicator.js"
import type { EngineModelPort, EngineModelRequest, ModelCallMetric } from "../../../../src/modules/feedback-engine/application/ports.js"
import { verifyCallAnalysis } from "../../../../src/modules/feedback-engine/domain/call-analysis.js"
import { listContextOf } from "../../../../src/modules/feedback-engine/domain/procedure.js"
import { reviewTargetsOf } from "../../../../src/modules/feedback-engine/domain/call-review.js"
import { createInMemoryFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { createPostgresFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { createCatalogToolRunner } from "../../../../src/modules/feedback-engine/infrastructure/catalog-tool-runner.js"
import { loadFrozenCall, readSelection } from "./frozen-call.js"

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] ?? null : null }
const artifactPath = join(here, arg("--artifact") ?? "results/paid-2026-09-30T21-55-34-903Z.json")
const selection = readSelection()
const ORG = selection.person.organizationId
const LARISSA = selection.person.id
/** Tarifa usada na rodada de 30/09 (estimativa; o custo real depende do provedor). */
const PRICE = { input: 0.75, output: 3.75 }

/** "Modelo" do replay: nenhuma resposta gravada para a lógica nova → recusa; registra o tamanho do pedido. */
const refused: { stage: string; tag: string | null; chars: number }[] = []
const replayModel: EngineModelPort = {
  async generate(request: EngineModelRequest) {
    refused.push({ stage: request.stage, tag: request.tag ?? null, chars: request.systemPrompt.length + request.contents.reduce((sum, part) => sum + part.text.length, 0) })
    throw Object.assign(new Error("Replay sem resposta gravada para este pedido (lógica nova)."), { name: "ReplayNoRecordedResponse" })
  },
}

const db = createReadOnlyDatabase(pool)
const report: Record<string, unknown> = { kind: "REPLAY_V4_NO_MODEL", ranAt: new Date().toISOString(), artifact: artifactPath.replace(here, "."), modelCalls: 0, calls: {} as Record<string, unknown>, indicator: null as unknown }
try {
  // Identidade congelada: a mesma pessoa, as mesmas chamadas e transcrições — senão nada roda.
  const person = (await db.query<{ id: string; name: string; matricula: string }>(`select id, name, matricula from people where id = $1 and organization_id = $2`, [LARISSA, ORG])).rows[0]
  if (!person || person.name !== selection.person.name || person.matricula !== selection.person.matricula) throw new Error("Identidade congelada não confere — replay abortado.")
  for (const call of selection.calls) {
    // Identidade, fontes, contexto e propostas pelo MESMO módulo da validação (lança se algo mudou desde o congelamento).
    const frozen = await loadFrozenCall(db, call.key, artifactPath.replace(`${here}/`, ""))
    const { stored, interaction, subject, chosen, context, projection, transcriptStatus } = frozen
    const model = frozen.proposals
    const remap = { size: frozen.remapped }
    const mismatched = 0
    const metrics: ModelCallMetric[] = []
    const before = refused.length
    const { analysis, review, pending } = await reviewAnalysis({ model: replayModel }, { model, context, projection, transcriptStatus, interactionId: interaction.id, subject, anchored: chosen.anchoredDocumentIds }, metrics)
    const reviewRequest = refused.slice(before).find((entry) => entry.stage === "CALL_REVIEW") ?? null
    // Alvos da revisão (o que a revisora receberia): da passagem preliminar, com o foco de cada proposta.
    const preliminary = verifyCallAnalysis({ model: { ...model, contractViolations: [] }, context, projection, transcriptStatus, interactionId: interaction.id, subjectAnchoredDocumentIds: chosen.anchoredDocumentIds, repairAttempted: false })
    const targets = reviewTargetsOf({ criteria: preliminary.criteria, lists: listContextOf(context), projection, path: null, missing: [] })
    const focus = targets.claims.reduce<Record<string, number>>((acc, claim) => {
      for (const item of claim.focus) acc[item] = (acc[item] ?? 0) + 1
      return acc
    }, {})
    const highlight = targets.claims.filter((claim) => (claim.status === "NOT_MET" || claim.status === "PARTIAL") && claim.focus.some((item) => item === "LIST_ITEM_WITH_MET_SIBLING" || item === "SAME_EVIDENCE_AS_SIBLING" || item === "CONDITIONAL_RULE"))
    const proposed = analysis.criteria.reduce<Record<string, number>>((acc, criterion) => ({ ...acc, [criterion.proposedStatus]: (acc[criterion.proposedStatus] ?? 0) + 1 }), {})
    const final = analysis.criteria.reduce<Record<string, number>>((acc, criterion) => ({ ...acc, [criterion.status]: (acc[criterion.status] ?? 0) + 1 }), {})
    ;(report.calls as Record<string, unknown>)[call.key] = {
      interactionId: call.interactionId,
      handlesRemapped: remap.size,
      handlesNotFound: mismatched,
      storedV3: { outcome: stored.outcome, statuses: stored.criteria.reduce<Record<string, number>>((acc, criterion) => ({ ...acc, [criterion.status]: (acc[criterion.status] ?? 0) + 1 }), {}) },
      proposedV4: proposed,
      coverageGaps: analysis.criteria.filter((criterion) => criterion.origin === "COVERAGE_GAP").map((criterion) => `${criterion.heading ?? "—"} › ${criterion.leadIn ? `${criterion.leadIn} ` : ""}${criterion.text}`),
      // Sem revisão: no motor real a execução ficaria SUSPENSA (revisão pendente, nada na memória) — este é o estado preliminar.
      finalV4WithoutReview: { persisted: pending ? `NÃO — execução suspensa (revisão pendente: ${pending.reason})` : "sim", outcome: analysis.outcome, outcomeReasons: analysis.outcomeReasons, statuses: final, review: { attempted: review.attempted, available: Boolean(review.review), error: review.error } },
      reviewTargets: { claims: targets.claims.length, focus, conditionalRules: targets.claims.filter((claim) => claim.rule.conditional).length, adverseClaimsNeedingListOrCondition: highlight.map((claim) => ({ rule: claim.rule.text, leadIn: claim.rule.leadIn, status: claim.status, focus: claim.focus, sameListMet: claim.rule.sameList.filter((sibling) => sibling.proposedStatus === "MET").map((sibling) => sibling.text) })) },
      reviewRequestChars: reviewRequest?.chars ?? null,
      reviewRequestEstimatedTokens: reviewRequest ? Math.ceil(reviewRequest.chars / 3) : null,
      reviewRequestEstimatedCostUsd: reviewRequest ? Math.round((Math.ceil(reviewRequest.chars / 3) * PRICE.input + 12_288 * PRICE.output) / 1e6 * 1e4) / 1e4 : null,
    }
  }

  // Investigação do TMA de agosto ANTES de qualquer IA: orçamento de modelo 0 (planejamento recusado sem chamada), ferramentas do
  // catálogo lidas do banco (somente leitura), pares desligados, trava de colaborador.
  const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(db), createInMemoryFeedbackMemoryStore())
  const deps = createEngineDeps({ db, stores, model: replayModel, budget: { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: 0 }, tools: createCatalogToolRunner(db), peerCallAnalyses: false, allowCollaborator: (id) => id === LARISSA })
  const agentConfiguredAt = (await db.query<{ updated_at: Date }>(`select updated_at from agents where id = $1`, [selection.agent.id])).rows[0]!.updated_at.toISOString()
  const result = await investigateIndicator(deps.investigate, { organizationId: ORG, personId: LARISSA, agentId: selection.agent.id, agentConfiguredAt, enrollmentId: null, target: { kind: "OFFICIAL_CLOSING", indicatorCode: selection.indicator.code, referencePeriod: selection.indicator.referencePeriod }, trigger: { kind: "EVALUATION", selectionReason: "Replay V4 sem custo" }, now: new Date() })
  const ref = result.investigations[0]
  const investigation = ref ? (await stores.getIndicatorInvestigationByRun(ORG, ref.runId))?.investigation ?? null : null
  report.indicator = investigation && {
    official: { value: investigation.official.value, target: investigation.official.target, withinTarget: investigation.official.withinTarget, movement: investigation.official.movement },
    localization: { direction: investigation.localization.overall.direction, focus: investigation.localization.focus, limitations: investigation.localization.limitations },
    tools: investigation.tools && { mode: investigation.tools.mode, capabilities: investigation.tools.capabilities, available: investigation.tools.availability.filter((entry) => entry.available).map((entry) => entry.tool), unavailable: investigation.tools.availability.filter((entry) => !entry.available).map((entry) => `${entry.tool}: ${entry.reason}`), openQuestions: investigation.tools.openQuestions, stopReason: investigation.tools.stopReason, ledger: investigation.tools.ledger },
    conclusion: investigation.conclusion,
    limitations: investigation.limitations,
  }
  report.meter = deps.meter.summary()
  report.refusedRequests = refused
  report.modelCalls = refused.length > 0 ? `0 enviadas (${refused.length} recusadas antes de sair)` : 0
} finally {
  await pool.end()
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const out = join(here, "results", `replay-v4-${stamp}.json`)
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, (key, value) => (key === "ledger" || key === "openQuestions" ? undefined : value), 2).slice(0, 12_000))
console.log(`\nArtefato: ${out}`)
