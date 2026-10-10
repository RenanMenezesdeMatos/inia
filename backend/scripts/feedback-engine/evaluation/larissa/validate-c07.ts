/**
 * VALIDAÇÃO MÍNIMA DA C07 DA LARISSA (preparada — o padrão NÃO envia nada).
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/validate-c07.ts             → ENSAIO: zero requisição; mede o que seria enviado
 *   npx tsx scripts/feedback-engine/evaluation/larissa/validate-c07.ts --execute   → rodada PAGA (só com autorização explícita)
 *
 * Identidade e fontes CONGELADAS (selection.json: pessoa, matrícula, sha256 da transcrição, versão/hash das bases); banco em
 * transação SOMENTE LEITURA; memória e mensagens só na RAM (sobreposição); nada é publicado, entregue ou notificado.
 *
 * Reaproveita a análise PAGA de 30/09 pelo MESMO mecanismo que o motor usa para retomar uma revisão pendente: as propostas do
 * analisador entram como uma análise SUSPENSA (com a chave de proposta calculada pelo motor) e a próxima execução paga SÓ a
 * revisão independente — depois, a composição (redator + verificador, e coerência se frases saírem). Nunca a análise de novo.
 *
 * Travas: orçamento na fronteira HTTP (`paid-budget.ts`: cada POST ao provedor, inclusive nova tentativa, com reserva do pior caso
 * antes de enviar; uso desconhecido = reserva) + medidor do motor (teto de chamadas); retry de transporte 0; só a Larissa pode ser
 * analisada; sem pares.
 *
 * ABSTENÇÃO NÃO É SUCESSO AUTOMÁTICO: se a revisão CONFIRMAR um ajuste material e o motor não entregar orientação útil, o relatório
 * marca `REVIEW_NEEDED` — a leitura humana decide se a abstenção foi correta.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { generateForRoute } from "../../../../src/shared/application/model-routing/llm-gateway.js"
import { analysisKeysOf } from "../../../../src/modules/feedback-engine/application/analyze-call.js"
import { DEFAULT_ENGINE_BUDGET } from "../../../../src/modules/feedback-engine/application/engine-meter.js"
import { createEngineDeps } from "../../../../src/modules/feedback-engine/application/engine-wiring.js"
import { generateFeedback } from "../../../../src/modules/feedback-engine/application/generate-feedback.js"
import type { EngineModelPort } from "../../../../src/modules/feedback-engine/application/ports.js"
import { CALL_ANALYSIS_CHECKPOINT_VERSION } from "../../../../src/modules/feedback-engine/domain/analysis-recovery.js"
import { createGatewayEngineModel, ENGINE_MODEL } from "../../../../src/modules/feedback-engine/infrastructure/gateway-engine-model.js"
import { createInMemoryFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { createPostgresFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { createPaidBudget } from "../paid-budget.js"
import { DEFAULT_PAID_ARTIFACT, loadFrozenCall } from "./frozen-call.js"

const here = dirname(fileURLToPath(import.meta.url))
const execute = process.argv.includes("--execute")
/** Esperado: 1 revisão + 1 redação + 1 verificação (+1 coerência se frases saírem); teto com folga para 1 reescrita. */
const LIMITS = { maxRequests: 6, maxUsd: 0.25, pricePerMillion: { input: 0.75, output: 3.75 }, hostPattern: /generativelanguage\.googleapis\.com/ }
const KEY = "C07"

const realFetch = globalThis.fetch
// No ensaio, NENHUMA requisição a provedor de IA sai, mesmo indireta.
if (!execute) globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (LIMITS.hostPattern.test(url) || /anthropic|openai|x\.ai/.test(url)) throw new Error(`ENSAIO: requisição a ${new URL(url).host} bloqueada.`)
  return realFetch(input, init)
}) as typeof fetch

const readDb = createReadOnlyDatabase(pool)
const report: Record<string, unknown> = { kind: execute ? "PAID_VALIDATION" : "DRY_RUN", ranAt: new Date().toISOString(), model: ENGINE_MODEL, call: KEY, limits: LIMITS, frozenArtifact: DEFAULT_PAID_ARTIFACT }
try {
  const frozen = await loadFrozenCall(readDb, KEY)
  const org = frozen.org
  const person = frozen.person.id
  const overlay = createInMemoryFeedbackMemoryStore()
  const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(readDb), overlay)

  // As propostas pagas entram como análise SUSPENSA (revisão pendente) — o motor retoma só a revisão.
  const { proposalKey, analysisKey } = analysisKeysOf({ interaction: frozen.interaction, agent: frozen.agent, documents: frozen.chosen.selected, context: frozen.context, projection: frozen.projection, transcriptStatus: frozen.transcriptStatus, subject: frozen.subject })
  const seededAt = new Date()
  const claim = await overlay.claimAnalysis({ organizationId: org, kind: "CALL_ANALYSIS", analysisKey, personId: person, interactionId: frozen.interaction.id, indicatorDefinitionId: null, periodStart: null, periodEnd: null, agentId: frozen.agent.id, trigger: { kind: "EVALUATION", selectionReason: "Validação mínima (C07): propostas congeladas da rodada paga de 30/09." }, logicVersion: "seed", asOf: seededAt }, seededAt, 60)
  if (claim.kind !== "CLAIMED") throw new Error("Semente da análise não pôde ser criada.")
  await overlay.suspendCallAnalysis(org, claim.runId, {
    error: "REVIEW_PENDING:FROZEN_PROPOSALS",
    checkpoint: { version: CALL_ANALYSIS_CHECKPOINT_VERSION, stage: "REVIEW_PENDING", proposalKey, reason: "TECHNICAL", error: "FROZEN_PROPOSALS_FROM_PAID_RUN", reviewAttempts: 0, since: seededAt.toISOString(), lastAttemptAt: seededAt.toISOString() },
    provenance: { proposalKey, modelResponses: { analysis: { requestSha256: "FROZEN_PAID_RUN_2026-09-30", text: JSON.stringify(frozen.proposals) }, review: null }, frozenFrom: DEFAULT_PAID_ARTIFACT },
    metrics: {},
  }, seededAt)

  const sizes: { stage: string; tag: string | null; chars: number }[] = []
  /** Resposta crua de CADA etapa (auditoria da rodada; nada disso volta ao motor). */
  const responses: { stage: string; tag: string | null; text: string | null; error: string | null; usage: unknown }[] = []
  const budget = createPaidBudget(LIMITS, realFetch)
  if (execute) globalThis.fetch = budget.fetch
  const real = createGatewayEngineModel({ generate: (request) => generateForRoute({ ...request, transport: { ...request.transport, retries: 0 } }) })
  const model: EngineModelPort = {
    async generate(request) {
      sizes.push({ stage: request.stage, tag: request.tag ?? null, chars: request.systemPrompt.length + request.contents.reduce((sum, turn) => sum + turn.text.length, 0) })
      if (!execute) throw Object.assign(new Error("ENSAIO: pedido medido, não enviado."), { name: "DryRunStop" })
      budget.setLabel(`${KEY} · ${request.stage}${request.tag ? `:${request.tag}` : ""}`)
      try {
        const response = await real.generate(request)
        responses.push({ stage: request.stage, tag: request.tag ?? null, text: response.text, error: null, usage: response.usage ?? null })
        return response
      } catch (error) {
        responses.push({ stage: request.stage, tag: request.tag ?? null, text: null, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), usage: null })
        throw error
      }
    },
  }
  const deps = createEngineDeps({ db: readDb, stores, model, peerCallAnalyses: false, allowCollaborator: (id) => id === person, budget: { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: LIMITS.maxRequests } })

  let generation: unknown = null
  try {
    generation = await generateFeedback(deps, { organizationId: org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: `validacao-${KEY}`, sourceNodeId: `analise-${KEY}`, domain: "MONITORING", sourceNodeOutput: null, collaboratorId: person, interactionId: frozen.interaction.id, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: "Validação mínima (C07).", now: new Date() })
  } catch (error) {
    generation = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), code: (error as { code?: string }).code ?? null }
  }

  const run = overlay.runs.get(claim.runId)!
  const assessment = overlay.assessments.find((entry) => entry.analysisRunId === claim.runId && entry.isCurrent) ?? null
  const reviewed = (assessment?.analysis.criteria ?? []).filter((criterion) => criterion.proposedStatus === "MET" || criterion.proposedStatus === "NOT_MET" || criterion.proposedStatus === "PARTIAL").map((criterion) => ({ rule: criterion.text, leadIn: criterion.leadIn, section: criterion.heading, proposed: criterion.proposedStatus, final: criterion.status, confirmation: criterion.confirmation, reasons: criterion.confirmationReasons, review: criterion.review }))
  const message = [...overlay.messages.values()][0] ?? null
  const confirmedDevelopments = reviewed.filter((entry) => (entry.final === "NOT_MET" || entry.final === "PARTIAL") && entry.confirmation === "CONFIRMED")
  const stages = sizes.map((entry) => entry.stage)
  report.result = {
    // As propostas NÃO são uma nova primeira análise da versão atual: foram RECONSTRUÍDAS do artefato pago de 30/09 (o analisador da
    // época) e entram como análise suspensa — esta rodada paga só a revisão independente e a comunicação.
    proposalsOrigin: { kind: "RECONSTRUCTED_FROM_PAID_ARTIFACT", artifact: DEFAULT_PAID_ARTIFACT, note: "propostas do analisador da rodada paga de 30/09, reaproveitadas pelo mecanismo de retomada da revisão; não representam a análise inicial da versão atual", proposedCriteria: frozen.proposals.criteria.length },
    generation,
    analysisPaidAgain: stages.filter((stage) => stage === "CALL_ANALYSIS").length,
    reviewCalls: stages.filter((stage) => stage === "CALL_REVIEW").length,
    run: { status: run.status, outcome: run.outcome, outcomeReasons: run.outcomeReasons, stageReuse: (run.provenance as { stageReuse?: unknown }).stageReuse ?? null },
    analysis: assessment ? { outcome: assessment.analysis.outcome, outcomeReasons: assessment.analysis.outcomeReasons, path: { proposed: assessment.analysis.scenario.proposedPathAssessment, final: assessment.analysis.scenario.pathAssessment, confirmation: assessment.analysis.scenario.pathConfirmation }, review: assessment.analysis.checks.review, reviewed } : null,
    message: message ? { status: message.status, abstainReason: message.abstainReason, heading: message.message?.view?.heading ?? message.brief?.heading ?? null, card: message.message?.card ?? null, text: message.message?.text ?? null, sentences: message.message?.sentences ?? null, communicatedRefs: message.message?.communicatedRefs ?? null, view: message.message?.view ?? null, brief: message.brief, composition: message.composition, deliveredAt: message.deliveredAt } : null,
    scenario: assessment ? assessment.analysis.scenario : null,
    reviewResponse: (run.provenance as { modelResponses?: { review?: unknown } }).modelResponses?.review ?? null,
    // Leitura OBRIGATÓRIA por humano — nada aqui é "aprovado" automaticamente.
    automaticChecks: {
      frozenProposalsReused: stages.filter((stage) => stage === "CALL_ANALYSIS").length === 0,
      nothingDelivered: !message?.deliveredAt,
      abstentionNeedsReading: message?.status === "ABSTAINED" && confirmedDevelopments.length > 0 ? "REVIEW_NEEDED: a revisão confirmou ajuste(s) e o motor não entregou mensagem — ler se a abstenção foi correta" : null,
    },
    humanChecklist: [
      "\"Estorno\" (lista \"Quando o cliente já tiver pago…, avaliar:\"): refutado ou incerto — nunca confirmado como obrigação descumprida.",
      "\"Corrigir o status\" (\"Se o cancelamento não tiver sido concluído por falha interna:\"): confirmado só com a condição evidenciada na conversa (T7).",
      "Itens da recapitulação (\"Antes de encerrar, informar:\"): só confirmados com leitura cumulativa e oportunidade real.",
      "Mensagem: sem narração do atendimento, sem frase pronta do sistema, sem consequência acrescentada; útil para o ajuste principal — ou abstenção com motivo que se sustenta na leitura.",
    ],
  }
  report.requests = sizes
  report.responses = responses
  report.budget = execute ? { totals: budget.totals(), ledger: budget.ledger } : null
  report.meter = deps.meter.summary()
} catch (error) {
  report.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
} finally {
  await pool.end()
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
mkdirSync(join(here, "results"), { recursive: true })
const out = join(here, "results", `validate-c07-${execute ? "paid" : "dry-run"}-${stamp}.json`)
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ kind: report.kind, error: report.error ?? null, requests: report.requests, result: report.result && { generation: (report.result as { generation: unknown }).generation, automaticChecks: (report.result as { automaticChecks: unknown }).automaticChecks } }, null, 2))
console.log(`\nArtefato: ${out}`)
