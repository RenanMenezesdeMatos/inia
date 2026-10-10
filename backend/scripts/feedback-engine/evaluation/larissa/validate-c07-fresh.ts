/**
 * VALIDAÇÃO DA C07 COM ANÁLISE INICIAL NOVA (versão corrigida inteira: análise → revisão → composição). O padrão NÃO envia nada.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/validate-c07-fresh.ts             → ENSAIO: zero requisição; mede o que seria enviado
 *   npx tsx scripts/feedback-engine/evaluation/larissa/validate-c07-fresh.ts --execute   → rodada PAGA única (só com autorização)
 *
 * Diferença para `validate-c07.ts`: as propostas da rodada de 30/09 NÃO entram. O analisador da versão vigente faz a primeira
 * leitura; a revisão confirma/refuta/contesta; a composição escreve e é verificada. A rodada de 01/10 (tarde) foi executada com
 * CALL_ANALYSIS_LOGIC_V5 / prompt V3 / CALL_REVIEW_V2 / composição V6-V5 e REPROVADA na prioridade (ver docs/dev/feedback-engine.md);
 * a correção (CALL_REVIEW_V3) foi provada por replay sem custo (`replay-c07-fresh.ts`). Uma nova execução paga é recusada enquanto
 * existir artefato pago desta rodada — só com `--allow-new-round`, depois de autorização explícita. Identidade e fontes CONGELADAS (selection.json: pessoa, matrícula, sha256 da transcrição,
 * versão/hash das bases); banco em transação SOMENTE LEITURA; memória e mensagens só na RAM (sobreposição sobre a memória do banco,
 * que nada apaga nem invalida); nada é publicado, entregue ou notificado; nenhum gabarito entra no contexto do motor.
 *
 * Travas: orçamento na fronteira HTTP (`paid-budget.ts`: cada POST ao provedor, inclusive nova tentativa, com reserva do pior caso
 * antes de enviar; uso desconhecido = reserva) + medidor do motor (teto de chamadas); retry de transporte 0; só a Larissa pode ser
 * analisada; sem pares. Se o orçamento interromper a cadeia, o relatório diz `INCOMPLETE` — nunca há texto substituto.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { generateForRoute } from "../../../../src/shared/application/model-routing/llm-gateway.js"
import { DEFAULT_ENGINE_BUDGET } from "../../../../src/modules/feedback-engine/application/engine-meter.js"
import { createEngineDeps } from "../../../../src/modules/feedback-engine/application/engine-wiring.js"
import { generateFeedback } from "../../../../src/modules/feedback-engine/application/generate-feedback.js"
import type { EngineModelPort } from "../../../../src/modules/feedback-engine/application/ports.js"
import { CALL_ANALYSIS_LOGIC_VERSION, CALL_ANALYSIS_PROMPT_VERSION, COMPOSITION_PROMPT_VERSION, COMPOSITION_VERSION, VERIFICATION_PROMPT_VERSION } from "../../../../src/modules/feedback-engine/domain/versions.js"
import { createGatewayEngineModel, ENGINE_MODEL } from "../../../../src/modules/feedback-engine/infrastructure/gateway-engine-model.js"
import { createInMemoryFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { createPostgresFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { createPaidBudget } from "../paid-budget.js"
import { loadFrozenSources } from "./frozen-call.js"

const here = dirname(fileURLToPath(import.meta.url))
const execute = process.argv.includes("--execute")
if (execute && !process.argv.includes("--allow-new-round") && readdirSync(join(here, "results")).some((name) => name.startsWith("validate-c07-fresh-paid-"))) {
  throw new Error("Rodada paga com análise nova já executada (results/validate-c07-fresh-paid-*). Não repita para escolher outro texto; use o replay sem custo (replay-c07-fresh.ts).")
}
/** Esperado: análise + revisão + redação + verificação (4); folga para UMA reescrita (redação + verificação). Coerência não cabe. */
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
const report: Record<string, unknown> = {
  kind: execute ? "PAID_VALIDATION_FRESH_ANALYSIS" : "DRY_RUN_FRESH_ANALYSIS",
  ranAt: new Date().toISOString(),
  model: ENGINE_MODEL,
  call: KEY,
  limits: LIMITS,
  versions: { analysisLogic: CALL_ANALYSIS_LOGIC_VERSION, analysisPrompt: CALL_ANALYSIS_PROMPT_VERSION, composition: COMPOSITION_VERSION, compositionPrompt: COMPOSITION_PROMPT_VERSION, verificationPrompt: VERIFICATION_PROMPT_VERSION },
}
try {
  const frozen = await loadFrozenSources(readDb, KEY)
  const org = frozen.org
  const person = frozen.person.id
  report.sources = { person: { id: person, name: frozen.person.name, matricula: frozen.person.matricula }, interaction: { id: frozen.interaction.id, externalId: frozen.call.externalId, transcriptSha256: frozen.call.transcriptSha256, subject: frozen.subject }, agent: { id: frozen.agent.id, name: frozen.agent.name }, knowledge: frozen.selection.knowledge, documentsSelected: frozen.chosen.selected.map((document) => ({ id: document.documentId, title: document.title, version: document.version })), transcriptStatus: frozen.transcriptStatus }
  const overlay = createInMemoryFeedbackMemoryStore()
  const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(readDb), overlay)

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
    generation = await generateFeedback(deps, { organizationId: org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: `validacao-fresh-${KEY}`, sourceNodeId: `analise-fresh-${KEY}`, domain: "MONITORING", sourceNodeOutput: null, collaboratorId: person, interactionId: frozen.interaction.id, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: "Validação da versão corrigida (C07), análise inicial nova.", now: new Date() })
  } catch (error) {
    generation = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), code: (error as { code?: string }).code ?? null }
  }

  const run = [...overlay.runs.values()].find((entry) => entry.kind === "CALL_ANALYSIS" && entry.interactionId === frozen.interaction.id) ?? null
  const assessment = run ? overlay.assessments.find((entry) => entry.analysisRunId === run.id && entry.isCurrent) ?? null : null
  const message = [...overlay.messages.values()][0] ?? null
  const stages = sizes.map((entry) => entry.stage)
  const criteria = assessment?.analysis.criteria ?? []
  const pick = (criterion: (typeof criteria)[number]) => ({ section: criterion.heading, leadIn: criterion.leadIn, rule: criterion.text, origin: criterion.origin, declared: criterion.declaredStatus, proposed: criterion.proposedStatus, final: criterion.status, confirmation: criterion.confirmation, reasons: criterion.confirmationReasons, itemNature: criterion.itemNature ?? null, scenarioRole: criterion.scenarioRole ?? null, evidence: criterion.evidence, opportunityTurn: criterion.opportunityTurn, materiality: criterion.materiality })
  const complete = stages.includes("CALL_ANALYSIS") && stages.includes("CALL_REVIEW") && stages.includes("COMPOSITION") && stages.includes("VERIFICATION")
  report.result = {
    proposalsOrigin: { kind: "FRESH_INITIAL_ANALYSIS", note: "primeira leitura feita pelo analisador da versão atual nesta rodada; nenhuma proposta anterior foi reaproveitada" },
    generation,
    chain: { stages, complete: execute ? complete && Boolean(message) : null, status: !execute ? "DRY_RUN" : complete && message ? "COMPLETE" : "INCOMPLETE" },
    run: run ? { status: run.status, outcome: run.outcome, outcomeReasons: run.outcomeReasons } : null,
    analysis: assessment ? {
      outcome: assessment.analysis.outcome,
      outcomeReasons: assessment.analysis.outcomeReasons,
      scenario: assessment.analysis.scenario,
      review: assessment.analysis.checks.review,
      limitations: assessment.analysis.limitations,
      auditNotes: assessment.analysis.auditNotes ?? [],
      determinate: criteria.filter((criterion) => ["MET", "NOT_MET", "PARTIAL"].includes(criterion.status) || ["MET", "NOT_MET", "PARTIAL"].includes(criterion.proposedStatus)).map(pick),
      reopenedOrChallenged: criteria.filter((criterion) => criterion.origin === "REVIEW_CHALLENGE").map(pick),
      notObservable: criteria.filter((criterion) => criterion.status === "NOT_OBSERVABLE").map(pick),
      notApplicableCount: criteria.filter((criterion) => criterion.status === "NOT_APPLICABLE").length,
    } : null,
    message: message ? { status: message.status, abstainReason: message.abstainReason, heading: message.message?.view?.heading ?? message.brief?.heading ?? null, card: message.message?.card ?? null, text: message.message?.text ?? null, sentences: message.message?.sentences ?? null, communicatedRefs: message.message?.communicatedRefs ?? null, view: message.message?.view ?? null, brief: message.brief, composition: message.composition, deliveredAt: message.deliveredAt } : null,
    automaticChecks: { nothingDelivered: !message?.deliveredAt, freshAnalysisPaid: stages.filter((stage) => stage === "CALL_ANALYSIS").length },
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
const out = join(here, "results", `validate-c07-fresh-${execute ? "paid" : "dry-run"}-${stamp}.json`)
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ kind: report.kind, error: report.error ?? null, requests: report.requests, chain: (report.result as { chain?: unknown } | undefined)?.chain ?? null, generation: (report.result as { generation?: unknown } | undefined)?.generation ?? null }, null, 2))
console.log(`\nArtefato: ${out}`)
