/**
 * RODADA REAL V8 (02/10/2026) — Larissa Monteiro (DEMO-OP-0001) apenas; três cenários numa execução, um orçamento GLOBAL:
 *   A) C07 (contestação após cancelamento) — análise nova, revisão, composição;
 *   B) DEMO-INT-0001-08 (segunda via com falha no app; conta antiga paga com atraso) — caso POSITIVO de argumentário;
 *   C) TMA de agosto/2026 (fechamento oficial) — investigação reaproveitando as análises desta rodada.
 * Gabarito (registrado ANTES, nunca enviado ao motor): `round-v8-ground-truth.md`.
 *
 * Fontes: base publicada do "Especialista de Faturamento" (a mesma da C07 congelada) + os 6 argumentários do anexo como REAVALIAÇÃO
 * pela regra atual (`perspective = CURRENT_RULE_REEVALUATION`, início = data do anexo) — nunca fingem vigência na data das chamadas.
 *
 * Orçamento (declarado antes): trava HTTP global 12 requisições / US$ 0,60 (reserva do pior caso por requisição; retries de
 * transporte 0 no gateway; retries/reparos do motor contam). Divisão no medidor do motor: A até 5 chamadas; A+B até 9 (3 ficam para C,
 * que o ensaio mostrou sem análise de chamadas: resultado dentro da meta = reconhecimento); C usa o resto até 12. Em C, análises NOVAS de chamadas = ⌊(restante − 3) / 2⌋ (3 ficam para redação, verificação e coerência); as análises
 * desta rodada são reaproveitadas sem custo. Configuração persistida intocada (capacidades do agente, estratégia, Workflows).
 *
 * Isolamento: banco SOMENTE LEITURA; memória e mensagens em RAM (sobreposição); nada publicado, entregue ou notificado; nenhum
 * registro operacional; só a Larissa (trava de sujeito); sem pares.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/evaluate-round-v8.ts                                → ENSAIO (zero requisição)
 *   npx tsx scripts/feedback-engine/evaluation/larissa/evaluate-round-v8.ts --execute --authorized-by-user → rodada PAGA única
 */
import { createHash } from "node:crypto"
import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { generateForRoute } from "../../../../src/shared/application/model-routing/llm-gateway.js"
import { DEFAULT_ENGINE_BUDGET, type EngineBudgetLimits } from "../../../../src/modules/feedback-engine/application/engine-meter.js"
import { createEngineDeps } from "../../../../src/modules/feedback-engine/application/engine-wiring.js"
import { generateFeedback } from "../../../../src/modules/feedback-engine/application/generate-feedback.js"
import { investigateIndicator } from "../../../../src/modules/feedback-engine/application/investigate-indicator.js"
import type { EngineModelPort } from "../../../../src/modules/feedback-engine/application/ports.js"
import { INDICATOR_ANALYSIS_NODE_OUTPUT_KIND } from "../../../../src/modules/feedback-engine/domain/node-output.js"
import { CALL_ANALYSIS_LOGIC_VERSION, CALL_ANALYSIS_PROMPT_VERSION, COMPOSITION_PROMPT_VERSION, COMPOSITION_VERSION, INDICATOR_INVESTIGATION_LOGIC_VERSION, VERIFICATION_PROMPT_VERSION } from "../../../../src/modules/feedback-engine/domain/versions.js"
import { CALL_REVIEW_PROMPT_VERSION, CALL_REVIEW_VERSION } from "../../../../src/modules/feedback-engine/domain/call-review.js"
import { createGatewayEngineModel, ENGINE_MODEL } from "../../../../src/modules/feedback-engine/infrastructure/gateway-engine-model.js"
import { createInMemoryFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { createPostgresFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { loadAgentDocumentsAt, loadInteractionForAnalysis } from "../../../../src/modules/feedback-engine/infrastructure/postgres-engine-loaders.js"
import { createPaidBudget } from "../paid-budget.js"
import { attachmentArgumentScripts } from "./attachment-argument-scripts.js"
import { loadFrozenSources } from "./frozen-call.js"

const here = dirname(fileURLToPath(import.meta.url))
const execute = process.argv.includes("--execute")
if (execute && !process.argv.includes("--authorized-by-user")) throw new Error("Rodada paga só com autorização explícita do usuário (--authorized-by-user).")
if (execute && readdirSync(join(here, "results")).some((name) => name.startsWith("round-v8-paid-"))) throw new Error("Rodada V8 já executada: não repita para escolher outro texto.")

const LIMITS = { maxRequests: 12, maxUsd: 0.6, pricePerMillion: { input: 0.75, output: 3.75 }, hostPattern: /generativelanguage\.googleapis\.com/ }
/** Teto CUMULATIVO de chamadas do medidor do motor ao fim de cada cenário (declarado antes da execução). */
const PHASE_CAPS = { A: 5, B: 9, C: 12 } as const
const C_RESERVED_FOR_MESSAGE = 3
const B_EXTERNAL_ID = "DEMO-INT-0001-08"
const INDICATOR = { code: "TMA", referencePeriod: "2026-08" }
const sha = (value: string) => createHash("sha256").update(value).digest("hex")

const realFetch = globalThis.fetch
// Ensaio: nenhuma requisição a provedor sai deste processo.
if (!execute) globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (LIMITS.hostPattern.test(url) || /anthropic|openai|x\.ai/.test(url)) throw new Error(`ENSAIO: requisição a ${new URL(url).host} bloqueada.`)
  return realFetch(input, init)
}) as typeof fetch

const readDb = createReadOnlyDatabase(pool)
const report: Record<string, unknown> = {
  kind: execute ? "PAID_ROUND_V8" : "DRY_RUN_V8",
  ranAt: new Date().toISOString(),
  model: ENGINE_MODEL,
  limits: LIMITS,
  phaseCaps: PHASE_CAPS,
  versions: { analysisLogic: CALL_ANALYSIS_LOGIC_VERSION, analysisPrompt: CALL_ANALYSIS_PROMPT_VERSION, review: CALL_REVIEW_VERSION, reviewPrompt: CALL_REVIEW_PROMPT_VERSION, composition: COMPOSITION_VERSION, compositionPrompt: COMPOSITION_PROMPT_VERSION, verificationPrompt: VERIFICATION_PROMPT_VERSION, investigation: INDICATOR_INVESTIGATION_LOGIC_VERSION },
}
const requests: { phase: string; stage: string; tag: string | null; chars: number; text: string }[] = []
const responses: { phase: string; stage: string; tag: string | null; text: string | null; error: string | null; usage: unknown }[] = []
let phase = "setup"
try {
  const frozen = await loadFrozenSources(readDb, "C07")
  const org = frozen.org
  const person = frozen.person
  const overlay = createInMemoryFeedbackMemoryStore()
  const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(readDb), overlay)
  const budget = createPaidBudget(LIMITS, realFetch)
  if (execute) globalThis.fetch = budget.fetch
  const real = createGatewayEngineModel({ generate: (request) => generateForRoute({ ...request, transport: { ...request.transport, retries: 0 } }) })
  const model: EngineModelPort = {
    async generate(request) {
      const text = [request.systemPrompt, ...request.contents.map((turn) => turn.text)].join("\n\n")
      requests.push({ phase, stage: request.stage, tag: request.tag ?? null, chars: text.length, text })
      if (!execute) throw Object.assign(new Error("ENSAIO: pedido medido, não enviado."), { name: "DryRunStop" })
      budget.setLabel(`${phase} · ${request.stage}${request.tag ? `:${request.tag}` : ""}`)
      try {
        const response = await real.generate(request)
        responses.push({ phase, stage: request.stage, tag: request.tag ?? null, text: response.text, error: null, usage: response.usage ?? null })
        return response
      } catch (error) {
        responses.push({ phase, stage: request.stage, tag: request.tag ?? null, text: null, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), usage: null })
        throw error
      }
    },
  }
  const engineBudget: EngineBudgetLimits = { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: PHASE_CAPS.A }
  const deps = createEngineDeps({ db: readDb, stores, model, peerCallAnalyses: false, allowCollaborator: (id) => id === person.id, budget: engineBudget })
  const scripts = attachmentArgumentScripts()
  deps.analyze.loadArgumentScripts = async () => scripts

  // Cenário B: a chamada é conferida por pessoa e transcrição; as fontes do especialista são as mesmas da C07 congelada.
  const bRow = (await readDb.query<{ id: string }>(`select id from interactions where organization_id = $1 and operator_id = $2 and external_id = $3`, [org, person.id, B_EXTERNAL_ID])).rows
  if (bRow.length !== 1) throw new Error(`${B_EXTERNAL_ID}: chamada da Larissa ausente ou ambígua.`)
  const bInteraction = await loadInteractionForAnalysis(readDb, org, bRow[0]!.id)
  if (!bInteraction?.transcript || bInteraction.operatorId !== person.id) throw new Error(`${B_EXTERNAL_ID} sem transcrição ou de outra pessoa.`)
  const bDocuments = await loadAgentDocumentsAt(readDb, org, frozen.agent.id, bInteraction.startedAt)
  for (const known of frozen.selection.knowledge) if (!bDocuments.some((document) => document.documentId === known.documentId && document.contentHash === known.contentHash)) throw new Error(`Base ${known.documentId} difere da congelada — nada executado.`)

  report.sources = {
    person: { id: person.id, name: person.name, matricula: person.matricula },
    agent: { id: frozen.agent.id, name: frozen.agent.name },
    knowledge: frozen.selection.knowledge,
    argumentScripts: scripts.map((script) => ({ name: script.name, version: script.version, effectiveFrom: script.effectiveFrom.toISOString(), perspective: script.perspective, injected: "IN_MEMORY_REEVALUATION" })),
    calls: {
      A: { externalId: frozen.call.externalId, interactionId: frozen.interaction.id, startedAt: frozen.interaction.startedAt.toISOString(), transcriptSha256: frozen.call.transcriptSha256 },
      B: { externalId: B_EXTERNAL_ID, interactionId: bInteraction.id, startedAt: bInteraction.startedAt.toISOString(), transcriptSha256: sha(bInteraction.transcript.content), reason: bInteraction.reason },
    },
    indicator: frozen.selection.indicator,
  }

  const messageDetail = async (messageId: string | null | undefined) => {
    if (!messageId) return null
    const record = await stores.getMessage(org, messageId)
    if (!record) return null
    return { status: record.status, abstainReason: record.abstainReason, heading: record.message?.view?.heading ?? null, card: record.message?.card ?? null, text: record.message?.text ?? null, view: record.message?.view ?? null, brief: record.brief, composition: record.composition }
  }
  const analysisDetail = (interactionId: string) => {
    const assessment = overlay.assessments.find((entry) => entry.isCurrent && entry.snapshot.interactionId === interactionId)
    if (!assessment) return null
    const analysis = assessment.analysis
    return {
      outcome: analysis.outcome,
      outcomeReasons: analysis.outcomeReasons,
      scenario: { customerNeed: analysis.scenario.customerNeed, conditions: analysis.scenario.conditions, procedure: analysis.scenario.procedureTitle, rulePerspective: analysis.scenario.rulePerspective, pathAssessment: analysis.scenario.pathAssessment, proposedPath: analysis.scenario.proposedPathAssessment, correctPath: analysis.scenario.correctPath, pathTaken: analysis.scenario.pathTaken },
      argumentScripts: analysis.argumentScripts ?? null,
      duplicates: analysis.duplicates ?? null,
      sourceConflicts: analysis.sourceConflicts,
      coverage: analysis.coverage,
      coverageLimits: analysis.coverageLimits ?? null,
      review: analysis.checks.review,
      auditNotes: analysis.auditNotes,
      limitations: analysis.limitations,
      criteria: analysis.criteria.map((criterion) => ({ handle: criterion.lineHandle, source: criterion.argument ? `Argumentário: ${criterion.argument.scriptName}` : criterion.heading, text: criterion.obligation?.lineText ?? criterion.text, part: criterion.obligation?.part ?? null, origin: criterion.origin, declared: criterion.declaredStatus, proposed: criterion.proposedStatus, final: criterion.status, confirmation: criterion.confirmation, reasons: criterion.confirmationReasons, applicability: criterion.applicability ?? null, observability: criterion.observability ?? null, executionClaim: criterion.executionClaim ?? null, evidenceKind: criterion.evidenceKind, evidence: criterion.evidence.map((quote) => `${quote.turn} ${quote.speaker}: ${quote.quote}`), opportunityTurn: criterion.opportunityTurn, role: criterion.scenarioRole ?? null, materiality: criterion.materiality, downgrades: criterion.downgrades, rationale: criterion.rationale, alsoRequiredBy: criterion.alsoRequiredBy ?? null })),
      notRequirements: analysis.notRequirements.length,
    }
  }
  const scenario = async (key: "A" | "B", interactionId: string, selectionReason: string) => {
    phase = key
    engineBudget.maxModelCalls = PHASE_CAPS[key]
    const startCalls = deps.meter.callsMade
    let generation: unknown
    try {
      const result = await generateFeedback(deps, { organizationId: org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: `round-v8-${key}`, sourceNodeId: `round-v8-analysis-${key}`, domain: "MONITORING", sourceNodeOutput: null, collaboratorId: person.id, interactionId, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason, now: new Date() })
      generation = { kind: result.kind, messageId: result.messageId, message: await messageDetail(result.messageId) }
    } catch (error) {
      generation = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
    }
    return { modelCalls: deps.meter.callsMade - startCalls, generation, analysis: analysisDetail(interactionId) }
  }

  report.A = await scenario("A", frozen.interaction.id, "Avaliação real V8 (cenário A): contestação de cobrança após cancelamento.")
  report.B = await scenario("B", bInteraction.id, "Avaliação real V8 (cenário B): chamada com situação prevista em argumentário (segunda via).")

  // Cenário C: o que sobrou do orçamento GLOBAL (nunca reiniciado).
  phase = "C"
  engineBudget.maxModelCalls = PHASE_CAPS.C
  const remaining = Math.max(0, PHASE_CAPS.C - deps.meter.callsMade)
  const newAnalyses = Math.max(0, Math.floor((remaining - C_RESERVED_FOR_MESSAGE) / 2))
  ;(deps.investigate as { maxCallAnalyses?: number }).maxCallAnalyses = newAnalyses
  const startCalls = deps.meter.callsMade
  let investigation: unknown = null
  let generation: unknown = null
  try {
    const investigated = await investigateIndicator(deps.investigate, { organizationId: org, personId: person.id, agentId: frozen.agent.id, agentConfiguredAt: frozen.agent.updatedAt.toISOString(), enrollmentId: null, target: { kind: "OFFICIAL_CLOSING", indicatorCode: INDICATOR.code, referencePeriod: INDICATOR.referencePeriod }, trigger: { kind: "EVALUATION", selectionReason: "Avaliação real V8 (cenário C): TMA de agosto/2026." }, now: new Date() })
    const stored = await Promise.all(investigated.investigations.map((entry) => stores.getIndicatorInvestigationByRun(org, entry.runId)))
    investigation = { refs: investigated, stored: stored.map((entry) => entry?.investigation ?? null) }
    const source = { kind: INDICATOR_ANALYSIS_NODE_OUTPUT_KIND, personId: person.id, agentId: frozen.agent.id, investigations: investigated.investigations.map((entry) => ({ analysisRunId: entry.runId, investigationId: entry.investigationId, indicatorCode: entry.indicatorCode, periodLabel: entry.periodLabel, conclusion: entry.conclusion, reused: entry.reused })), skippedReason: investigated.skippedReason, text: "" }
    const result = await generateFeedback(deps, { organizationId: org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "round-v8-C", sourceNodeId: "round-v8-investigation-C", domain: "INDICATOR", sourceNodeOutput: source, collaboratorId: person.id, interactionId: null, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: "Avaliação real V8 (cenário C): TMA de agosto/2026.", now: new Date() })
    generation = { kind: result.kind, messageId: result.messageId, message: await messageDetail(result.messageId) }
  } catch (error) {
    generation = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
  report.C = { remainingAtStart: remaining, newCallAnalysesAllowed: newAnalyses, modelCalls: deps.meter.callsMade - startCalls, investigation, generation }

  report.isolation = { otherCollaboratorsAnalyzed: overlay.assessments.filter((entry) => entry.snapshot.personId !== person.id).length, analyses: overlay.assessments.map((entry) => ({ interactionId: entry.snapshot.interactionId, current: entry.isCurrent })), messages: overlay.messages.size, persisted: "NONE (banco somente leitura; memória e mensagens em RAM)" }
  report.budget = execute ? { totals: budget.totals(), ledger: budget.ledger } : null
  report.meter = deps.meter.summary()
} catch (error) {
  report.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
} finally {
  await pool.end()
}
report.requests = requests.map((entry) => ({ phase: entry.phase, stage: entry.stage, tag: entry.tag, chars: entry.chars }))
report.responses = responses
mkdirSync(join(here, "results"), { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const out = join(here, "results", `round-v8-${execute ? "paid" : "dry-run"}-${stamp}.json`)
writeFileSync(out, JSON.stringify(report, null, 2))
writeFileSync(join(here, "results", `round-v8-${execute ? "paid" : "dry-run"}-${stamp}.prompts.json`), JSON.stringify(requests, null, 2))
console.log(JSON.stringify({ kind: report.kind, error: report.error ?? null, requests: report.requests, budget: (report.budget as { totals?: unknown } | null)?.totals ?? null }, null, 2))
console.log(`\nArtefato: ${out}`)
