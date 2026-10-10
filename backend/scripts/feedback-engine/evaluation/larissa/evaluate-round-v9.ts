/**
 * RODADA REAL V9 (02/10/2026) — Larissa Monteiro (DEMO-OP-0001) apenas; três cenários numa execução, um orçamento GLOBAL:
 *   A) C07 (contestação após cancelamento) — análise nova (contrato V7), revisão V7, composição;
 *   B) DEMO-INT-0001-08 (segunda via; argumentário "Segunda via" aplicável) — análise nova, revisão V7, composição;
 *   C) TMA de agosto/2026 — investigação COM FERRAMENTAS numa cópia ISOLADA da configuração, reaproveitando as análises de A e B.
 * Gabarito revisado (registrado ANTES, nunca enviado ao motor): `round-v9-ground-truth.md` (sha256 gravado no artefato).
 *
 * Fontes: base publicada do "Especialista de Faturamento" (conferida contra a congelada) + os 6 argumentários do anexo como
 * REAVALIAÇÃO pela regra atual (nunca fingem vigência na data das chamadas).
 *
 * ORÇAMENTO GLOBAL (declarado antes; nunca reiniciado): trava HTTP 16 requisições / US$ 0,60, reserva do pior caso por requisição, retries
 * de transporte 0 no gateway (os do motor contam). Sem teto arbitrário por fase: o medidor do motor recebe, a cada cenário, o teto
 * GLOBAL menos a RESERVA mínima dos cenários seguintes — B precisa de 4 (análise, revisão, redação, verificação), C de 3 (planejamento,
 * redação, verificação). Assim A pode usar até 9 e B até 13, e a verificação de um reparo nunca é cortada enquanto há orçamento.
 * Em C, com R requisições restantes: 1 análise nova só com R ≥ 8 (a 3ª chamada, se uma pergunta material a justificar); rodadas de
 * planejamento = máx(1, mín(2, R − 2·análises − 4)) — 4 ficam para a mensagem (redação, verificação, reescrita, nova verificação).
 *
 * CONFIGURAÇÃO ISOLADA (cópia em memória; NADA persistido muda): o perfil do agente devolvido ao motor tem as capacidades mínimas do
 * catálogo para as perguntas do indicador — INDICATOR_ANALYSIS (detect_anomalies, snapshot, qualidade do dado: "há dia fora do
 * padrão?"), SEGMENTATION (segment_indicator: "há concentração por assunto/dia/horário?"), INTERACTION_ANALYSIS (read_call_memory,
 * analyze_calls: "o que as chamadas desse recorte mostram?") e KNOWLEDGE (query_knowledge: "o procedimento sustenta orientação?").
 * Fora: OPERATIONAL_COMPARISON (nenhum outro colaborador nesta rodada; a estratégia publicada desliga pares) e WORK_CONTEXT (escala/
 * ausências não fazem parte das perguntas). Estratégia, Workflows e permissões persistidos: intocados.
 *
 * Isolamento: banco SOMENTE LEITURA; memória e mensagens em RAM (sobreposição); nada publicado, entregue ou notificado; só a Larissa.
 * A 3ª chamada (se houver) é REGISTRADA em arquivo antes do pedido de análise sair.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/evaluate-round-v9.ts                                → ENSAIO (zero requisição)
 *   npx tsx scripts/feedback-engine/evaluation/larissa/evaluate-round-v9.ts --execute --authorized-by-user → rodada PAGA única
 */
import { createHash } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
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
import { ENGINE_INVESTIGATION_TOOLS_VERSION, ENGINE_PLANNER_PROMPT_VERSION, INVESTIGATION_CLOSURE_VERSION } from "../../../../src/modules/feedback-engine/domain/investigation-toolbox.js"
import type { InvestigationCapability } from "../../../../src/modules/investigation/domain/capabilities.js"
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
if (execute && readdirSync(join(here, "results")).some((name) => name.startsWith("round-v9-paid-"))) throw new Error("Rodada V9 já executada: não repita para escolher outro texto.")

const LIMITS = { maxRequests: 16, maxUsd: 0.6, pricePerMillion: { input: 0.75, output: 3.75 }, hostPattern: /generativelanguage\.googleapis\.com/ }
/** Reserva mínima dos cenários seguintes (não é teto da fase: é o que precisa sobrar para os próximos existirem). */
const RESERVE = { B: 4, C: 3 } as const
const B_EXTERNAL_ID = "DEMO-INT-0001-08"
const INDICATOR = { code: "TMA", referencePeriod: "2026-08" }
const ISOLATED_CAPABILITIES: InvestigationCapability[] = ["INDICATOR_ANALYSIS", "SEGMENTATION", "INTERACTION_ANALYSIS", "KNOWLEDGE"]
const GROUND_TRUTH = join(here, "round-v9-ground-truth.md")
const sha = (value: string) => createHash("sha256").update(value).digest("hex")

const realFetch = globalThis.fetch
// Ensaio: nenhuma requisição a provedor sai deste processo.
if (!execute) globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (LIMITS.hostPattern.test(url) || /anthropic|openai|x\.ai/.test(url)) throw new Error(`ENSAIO: requisição a ${new URL(url).host} bloqueada.`)
  return realFetch(input, init)
}) as typeof fetch

const readDb = createReadOnlyDatabase(pool)
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
mkdirSync(join(here, "results"), { recursive: true })
const report: Record<string, unknown> = {
  kind: execute ? "PAID_ROUND_V9" : "DRY_RUN_V9",
  ranAt: new Date().toISOString(),
  model: ENGINE_MODEL,
  limits: LIMITS,
  reserve: RESERVE,
  groundTruth: { file: "round-v9-ground-truth.md", sha256: sha(readFileSync(GROUND_TRUTH, "utf8")), modifiedAt: statSync(GROUND_TRUTH).mtime.toISOString(), registeredBeforeExecution: true },
  versions: { analysisLogic: CALL_ANALYSIS_LOGIC_VERSION, analysisPrompt: CALL_ANALYSIS_PROMPT_VERSION, review: CALL_REVIEW_VERSION, reviewPrompt: CALL_REVIEW_PROMPT_VERSION, composition: COMPOSITION_VERSION, compositionPrompt: COMPOSITION_PROMPT_VERSION, verificationPrompt: VERIFICATION_PROMPT_VERSION, investigation: INDICATOR_INVESTIGATION_LOGIC_VERSION, investigationTools: ENGINE_INVESTIGATION_TOOLS_VERSION, plannerPrompt: ENGINE_PLANNER_PROMPT_VERSION, closure: INVESTIGATION_CLOSURE_VERSION },
  isolatedConfiguration: { capabilities: ISOLATED_CAPABILITIES, why: { INDICATOR_ANALYSIS: "dia fora do padrão / qualidade do dado (detect_anomalies, validate_data_quality, snapshot)", SEGMENTATION: "concentração por assunto, dia, horário (segment_indicator)", INTERACTION_ANALYSIS: "o que as chamadas do recorte mostram (read_call_memory, analyze_calls)", KNOWLEDGE: "o procedimento sustenta alguma orientação (query_knowledge)" }, excluded: { OPERATIONAL_COMPARISON: "sem outros colaboradores nesta rodada; pares desligados na estratégia publicada", WORK_CONTEXT: "escala/ausências fora das perguntas desta rodada" }, persisted: "INTOCADO (perfil do agente substituído só na memória deste processo)" },
}
const requests: { phase: string; stage: string; tag: string | null; chars: number; text: string }[] = []
const responses: { phase: string; stage: string; tag: string | null; text: string | null; error: string | null; usage: unknown }[] = []
let phase = "setup"
let lastPlannerAnalyzeQuestions: { interactions: unknown; question: string }[] = []
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
        if (request.stage === "INVESTIGATION_PLANNING") {
          try {
            const decision = JSON.parse(response.text) as { calls?: { tool: string; args?: { interactions?: unknown }; question?: string }[] }
            lastPlannerAnalyzeQuestions = (decision.calls ?? []).filter((call) => call.tool === "analyze_calls").map((call) => ({ interactions: call.args?.interactions ?? null, question: call.question ?? "" }))
          } catch {
            lastPlannerAnalyzeQuestions = []
          }
        }
        return response
      } catch (error) {
        responses.push({ phase, stage: request.stage, tag: request.tag ?? null, text: null, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), usage: null })
        throw error
      }
    },
  }
  const engineBudget: EngineBudgetLimits = { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: LIMITS.maxRequests - RESERVE.B - RESERVE.C }
  const deps = createEngineDeps({ db: readDb, stores, model, peerCallAnalyses: false, allowCollaborator: (id) => id === person.id, budget: engineBudget })
  const scripts = attachmentArgumentScripts()
  deps.analyze.loadArgumentScripts = async () => scripts

  // Configuração ISOLADA das ferramentas: só o perfil devolvido ao motor nesta execução (nada é gravado).
  const loadAgent = deps.analyze.loadAgent
  deps.analyze.loadAgent = async (organizationId, agentId) => {
    const profile = await loadAgent(organizationId, agentId)
    return profile && agentId === frozen.agent.id ? { ...profile, investigationCapabilities: [...ISOLATED_CAPABILITIES] } : profile
  }

  const bRow = (await readDb.query<{ id: string }>(`select id from interactions where organization_id = $1 and operator_id = $2 and external_id = $3`, [org, person.id, B_EXTERNAL_ID])).rows
  if (bRow.length !== 1) throw new Error(`${B_EXTERNAL_ID}: chamada da Larissa ausente ou ambígua.`)
  const bInteraction = await loadInteractionForAnalysis(readDb, org, bRow[0]!.id)
  if (!bInteraction?.transcript || bInteraction.operatorId !== person.id) throw new Error(`${B_EXTERNAL_ID} sem transcrição ou de outra pessoa.`)
  const bDocuments = await loadAgentDocumentsAt(readDb, org, frozen.agent.id, bInteraction.startedAt)
  for (const known of frozen.selection.knowledge) if (!bDocuments.some((document) => document.documentId === known.documentId && document.contentHash === known.contentHash)) throw new Error(`Base ${known.documentId} difere da congelada — nada executado.`)

  // A 3ª chamada (só em C): registrada em arquivo ANTES do pedido de análise sair — qual, por qual pergunta do planejamento.
  const knownCalls = new Set([frozen.interaction.id, bInteraction.id])
  const thirdCallSelections: Record<string, unknown>[] = []
  const loadInteraction = deps.analyze.loadInteraction
  deps.analyze.loadInteraction = async (organizationId, interactionId) => {
    const loaded = await loadInteraction(organizationId, interactionId)
    if (phase === "C" && loaded && !knownCalls.has(interactionId)) {
      const selection = { registeredAt: new Date().toISOString(), interactionId, externalId: (await readDb.query<{ external_id: string }>(`select external_id from interactions where id = $1`, [interactionId])).rows[0]?.external_id ?? null, operatorId: loaded.operatorId, subject: loaded.subjectCanonical?.name ?? loaded.reason, startedAt: loaded.startedAt.toISOString(), durationSeconds: loaded.endedAt ? (loaded.endedAt.getTime() - loaded.startedAt.getTime()) / 1000 : null, plannerAnalyzeRequests: lastPlannerAnalyzeQuestions }
      thirdCallSelections.push(selection)
      writeFileSync(join(here, "results", `round-v9-${execute ? "paid" : "dry-run"}-${stamp}.third-call-selection.json`), JSON.stringify(thirdCallSelections, null, 2))
    }
    return loaded
  }

  report.sources = {
    person: { id: person.id, name: person.name, matricula: person.matricula },
    agent: { id: frozen.agent.id, name: frozen.agent.name, persistedCapabilities: frozen.agent.investigationCapabilities ?? [] },
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
      scenario: { customerNeed: analysis.scenario.customerNeed, conditions: analysis.scenario.conditions, procedure: analysis.scenario.procedureTitle, rulePerspective: analysis.scenario.rulePerspective, pathAssessment: analysis.scenario.pathAssessment, proposedPath: analysis.scenario.proposedPathAssessment, pathCompleteness: analysis.scenario.pathCompleteness ?? null, pathRationale: analysis.scenario.pathRationale, correctPath: analysis.scenario.correctPath, pathTaken: analysis.scenario.pathTaken },
      argumentScripts: analysis.argumentScripts ?? null,
      duplicates: analysis.duplicates ?? null,
      sourceConflicts: analysis.sourceConflicts,
      coverage: analysis.coverage,
      coverageLimits: analysis.coverageLimits ?? null,
      review: analysis.checks.review,
      auditNotes: analysis.auditNotes,
      limitations: analysis.limitations,
      criteria: analysis.criteria.map((criterion) => ({ handle: criterion.lineHandle, source: criterion.argument ? `Argumentário: ${criterion.argument.scriptName} · ${criterion.argument.field}` : criterion.heading, leadIn: criterion.leadIn, text: criterion.obligation?.lineText ?? criterion.text, part: criterion.obligation?.part ?? null, lineRole: criterion.lineRole ?? null, origin: criterion.origin, declared: criterion.declaredStatus, proposed: criterion.proposedStatus, final: criterion.status, confirmation: criterion.confirmation, reasons: criterion.confirmationReasons, reviewReading: criterion.review ? { verdict: criterion.review.verdict, evidenceReading: criterion.review.evidenceReading ?? null, outsideDependency: criterion.review.outsideDependency ?? null, listReading: criterion.review.listReading, issues: criterion.review.issues, note: criterion.review.note } : null, itemNature: criterion.itemNature ?? null, applicability: criterion.applicability ?? null, observability: criterion.observability ?? null, executionClaim: criterion.executionClaim ?? null, evidenceKind: criterion.evidenceKind, evidence: criterion.evidence.map((quote) => `${quote.turn} ${quote.speaker}: ${quote.quote}`), opportunityTurn: criterion.opportunityTurn, role: criterion.scenarioRole ?? null, materiality: criterion.materiality, downgrades: criterion.downgrades, rationale: criterion.rationale, alsoRequiredBy: criterion.alsoRequiredBy ?? null })),
      notRequirements: analysis.notRequirements.length,
    }
  }
  const capFor = (key: "A" | "B") => (key === "A" ? LIMITS.maxRequests - RESERVE.B - RESERVE.C : LIMITS.maxRequests - RESERVE.C)
  const scenario = async (key: "A" | "B", interactionId: string, selectionReason: string) => {
    phase = key
    engineBudget.maxModelCalls = capFor(key)
    const startCalls = deps.meter.callsMade
    let generation: unknown
    try {
      const result = await generateFeedback(deps, { organizationId: org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: `round-v9-${key}`, sourceNodeId: `round-v9-analysis-${key}`, domain: "MONITORING", sourceNodeOutput: null, collaboratorId: person.id, interactionId, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason, now: new Date() })
      generation = { kind: result.kind, messageId: result.messageId, message: await messageDetail(result.messageId) }
    } catch (error) {
      generation = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
    }
    return { cap: capFor(key), modelCalls: deps.meter.callsMade - startCalls, generation, analysis: analysisDetail(interactionId) }
  }

  report.A = await scenario("A", frozen.interaction.id, "Avaliação real V9 (cenário A): contestação de cobrança após cancelamento.")
  report.B = await scenario("B", bInteraction.id, "Avaliação real V9 (cenário B): segunda via com argumentário aplicável.")

  // Cenário C: o que sobrou do orçamento GLOBAL (nunca reiniciado), dividido entre investigação e mensagem com reserva para a mensagem.
  phase = "C"
  engineBudget.maxModelCalls = LIMITS.maxRequests
  const remaining = Math.max(0, LIMITS.maxRequests - deps.meter.callsMade)
  const newAnalyses = remaining >= 8 ? 1 : 0
  const planningRounds = Math.max(1, Math.min(2, remaining - 2 * newAnalyses - 4))
  const toolsEnabled = remaining >= 3
  const investigate = deps.investigate as { maxCallAnalyses?: number; maxPlanningRounds?: number; tools?: unknown }
  investigate.maxCallAnalyses = newAnalyses
  investigate.maxPlanningRounds = planningRounds
  if (!toolsEnabled) delete investigate.tools
  const startCalls = deps.meter.callsMade
  let investigation: unknown = null
  let generation: unknown = null
  try {
    const investigated = await investigateIndicator(deps.investigate, { organizationId: org, personId: person.id, agentId: frozen.agent.id, agentConfiguredAt: frozen.agent.updatedAt.toISOString(), enrollmentId: null, target: { kind: "OFFICIAL_CLOSING", indicatorCode: INDICATOR.code, referencePeriod: INDICATOR.referencePeriod }, trigger: { kind: "EVALUATION", selectionReason: "Avaliação real V9 (cenário C): TMA de agosto/2026." }, now: new Date() })
    const stored = await Promise.all(investigated.investigations.map((entry) => stores.getIndicatorInvestigationByRun(org, entry.runId)))
    investigation = { refs: investigated, stored: stored.map((entry) => entry?.investigation ?? null) }
    const source = { kind: INDICATOR_ANALYSIS_NODE_OUTPUT_KIND, personId: person.id, agentId: frozen.agent.id, investigations: investigated.investigations.map((entry) => ({ analysisRunId: entry.runId, investigationId: entry.investigationId, indicatorCode: entry.indicatorCode, periodLabel: entry.periodLabel, conclusion: entry.conclusion, reused: entry.reused })), skippedReason: investigated.skippedReason, text: "" }
    const result = await generateFeedback(deps, { organizationId: org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "round-v9-C", sourceNodeId: "round-v9-investigation-C", domain: "INDICATOR", sourceNodeOutput: source, collaboratorId: person.id, interactionId: null, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: "Avaliação real V9 (cenário C): TMA de agosto/2026.", now: new Date() })
    generation = { kind: result.kind, messageId: result.messageId, message: await messageDetail(result.messageId) }
  } catch (error) {
    generation = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
  report.C = { remainingAtStart: remaining, newCallAnalysesAllowed: newAnalyses, planningRoundsAllowed: planningRounds, toolsEnabled, modelCalls: deps.meter.callsMade - startCalls, thirdCallSelections, investigation, generation }

  report.isolation = { otherCollaboratorsAnalyzed: overlay.assessments.filter((entry) => entry.snapshot.personId !== person.id).length, analyses: overlay.assessments.map((entry) => ({ interactionId: entry.snapshot.interactionId, current: entry.isCurrent })), messages: overlay.messages.size, persisted: "NONE (banco somente leitura; memória e mensagens em RAM)" }
  report.budget = execute ? { totals: budget.totals(), ledger: budget.ledger } : null
  report.meter = deps.meter.summary()
} catch (error) {
  report.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
} finally {
  await pool.end()
}
report.requests = requests.map((entry) => ({ phase: entry.phase, stage: entry.stage, tag: entry.tag, chars: entry.chars, estimatedInputTokens: Math.ceil(entry.chars / 3) }))
report.responses = responses
const out = join(here, "results", `round-v9-${execute ? "paid" : "dry-run"}-${stamp}.json`)
writeFileSync(out, JSON.stringify(report, null, 2))
writeFileSync(join(here, "results", `round-v9-${execute ? "paid" : "dry-run"}-${stamp}.prompts.json`), JSON.stringify(requests, null, 2))
console.log(JSON.stringify({ kind: report.kind, error: report.error ?? null, requests: report.requests, budget: (report.budget as { totals?: unknown } | null)?.totals ?? null }, null, 2))
console.log(`\nArtefato: ${out}`)
