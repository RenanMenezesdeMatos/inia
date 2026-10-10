/**
 * RODADA REAL V11 (02/10/2026) — Larissa Monteiro (DEMO-OP-0001) apenas. Orçamento PRÓPRIO (livro-razão `round-v11-budget.ts`:
 * US$ 0,60 e 17 requisições para tudo; o livro-razão encerrado da V10 fica intocado).
 *   A) C07 e B) DEMO-INT-0001-08: a ANÁLISE inicial é a resposta PAGA da comparação de contratos da V10 (`OBLIGATIONS_V1`, prompt
 *      congelado `CALL_ANALYSIS_PROMPT_V8`, mesmas fontes por hash, mesma mensagem do usuário) — reaproveitada como etapa já paga
 *      (análise suspensa → o motor retoma da revisão). Pagas AQUI: revisão com o prompt atual (V2), confirmação focal, redação e
 *      verificação. Nenhuma resposta antiga de revisão/redação é reaproveitada.
 *   C) TMA de agosto/2026 com ferramentas numa cópia ISOLADA da configuração (as mesmas capacidades da V10), com o planejador atual.
 * Critérios: `round-v11-ground-truth.md` (registrado antes; nunca enviado ao motor).
 * CONGELAMENTO: o ensaio grava `results/round-v11-freeze.json` (hash de cada arquivo do motor, do harness e dos critérios); a rodada
 * paga recusa rodar se algum arquivo mudou depois do congelamento.
 *
 * Reservas: B precisa de 4 (revisão, confirmação, redação, verificação), C de 5 (dois planejamentos, redação, verificação e folga).
 * Em C, a 3ª chamada da Larissa só com ≥ 7 sobrando e só se o planejador a pedir — registrada em arquivo ANTES do pedido.
 *
 * Isolamento: banco SOMENTE LEITURA; memória e mensagens em RAM; nada publicado, entregue ou notificado; só a Larissa.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/evaluate-round-v11.ts                                → ENSAIO + congelamento
 *   npx tsx scripts/feedback-engine/evaluation/larissa/evaluate-round-v11.ts --execute --authorized-by-user → rodada PAGA única
 */
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { generateForRoute } from "../../../../src/shared/application/model-routing/llm-gateway.js"
import { projectTranscript } from "../../../../src/modules/investigation/domain/transcript-projection.js"
import { DEFAULT_ENGINE_BUDGET, type EngineBudgetLimits } from "../../../../src/modules/feedback-engine/application/engine-meter.js"
import { analysisKeysOf, TRANSCRIPT_MAX_CHARS } from "../../../../src/modules/feedback-engine/application/analyze-call.js"
import { createEngineDeps } from "../../../../src/modules/feedback-engine/application/engine-wiring.js"
import { generateFeedback } from "../../../../src/modules/feedback-engine/application/generate-feedback.js"
import { investigateIndicator } from "../../../../src/modules/feedback-engine/application/investigate-indicator.js"
import type { EngineModelPort, EngineModelResponse } from "../../../../src/modules/feedback-engine/application/ports.js"
import { CALL_ANALYSIS_CHECKPOINT_VERSION } from "../../../../src/modules/feedback-engine/domain/analysis-recovery.js"
import { selectDocumentsForCall } from "../../../../src/modules/feedback-engine/domain/document-selection.js"
import { INDICATOR_ANALYSIS_NODE_OUTPUT_KIND } from "../../../../src/modules/feedback-engine/domain/node-output.js"
import { OBLIGATION_ANALYSIS_PROMPT_VERSION, OBLIGATION_ANALYSIS_SYSTEM_PROMPT } from "../../../../src/modules/feedback-engine/domain/obligation-analysis-prompt.js"
import { OBLIGATION_REVIEW_PROMPT_VERSION, OBLIGATION_REVIEW_VERSION } from "../../../../src/modules/feedback-engine/domain/obligation-review.js"
import { buildProcedureContext, transcriptStatusOf } from "../../../../src/modules/feedback-engine/domain/procedure.js"
import { CALL_ANALYSIS_LOGIC_VERSION, COMPOSITION_PROMPT_VERSION, COMPOSITION_VERSION, INDICATOR_INVESTIGATION_LOGIC_VERSION, VERIFICATION_PROMPT_VERSION } from "../../../../src/modules/feedback-engine/domain/versions.js"
import { ENGINE_INVESTIGATION_TOOLS_VERSION, ENGINE_PLANNER_PROMPT_VERSION, INVESTIGATION_CLOSURE_VERSION } from "../../../../src/modules/feedback-engine/domain/investigation-toolbox.js"
import type { InvestigationCapability } from "../../../../src/modules/investigation/domain/capabilities.js"
import { createGatewayEngineModel, ENGINE_MODEL } from "../../../../src/modules/feedback-engine/infrastructure/gateway-engine-model.js"
import { createInMemoryFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { createPostgresFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { loadAgentDocumentsAt, loadInteractionForAnalysis } from "../../../../src/modules/feedback-engine/infrastructure/postgres-engine-loaders.js"
import { attachmentArgumentScripts } from "./attachment-argument-scripts.js"
import { loadFrozenSources } from "./frozen-call.js"
import { openRoundV11Budget, readRoundV11Ledger, roundV11Totals, ROUND_V11_LIMITS } from "./round-v11-budget.js"

const here = dirname(fileURLToPath(import.meta.url))
const execute = process.argv.includes("--execute")
// REPLAY SEM CUSTO: as respostas PAGAS gravadas de uma rodada V11 passam de novo pelo código ATUAL (rede bloqueada). Mostra o efeito
// de correções feitas DEPOIS da rodada sobre as MESMAS saídas do modelo — não é validação com modelo, nem saída paga do motor.
const replayIndex = process.argv.indexOf("--replay")
const replayArtifact = replayIndex >= 0 ? process.argv[replayIndex + 1] ?? null : null
if (execute && replayArtifact) throw new Error("--replay não combina com --execute.")
const replayed = replayArtifact ? (JSON.parse(readFileSync(join(here, replayArtifact), "utf8")) as { globalBudget: { before: { requests: number; spentUsd: number } }; responses: { phase: string; stage: string; tag: string | null; text: string | null; usage: unknown; finishReason: string | null }[] }) : null
const stored = replayed ? replayed.responses.filter((entry) => entry.text) : []
const used = new Set<number>()
if (execute && !process.argv.includes("--authorized-by-user")) throw new Error("Rodada paga só com autorização explícita do usuário (--authorized-by-user).")
if (execute && readdirSync(join(here, "results")).some((name) => name.startsWith("round-v11-paid-"))) throw new Error("Rodada V11 já executada: não repita para escolher outro texto.")
const COMPARISON = "results/round-v10-comparison-paid-2026-10-02T14-44-16-633Z.json"
const V9_PROMPTS = "results/round-v9-paid-2026-10-02T13-39-47-453Z.prompts.json"
const RESERVE = { B: 4, C: 5 } as const
const B_EXTERNAL_ID = "DEMO-INT-0001-08"
const INDICATOR = { code: "TMA", referencePeriod: "2026-08" }
const ISOLATED_CAPABILITIES: InvestigationCapability[] = ["INDICATOR_ANALYSIS", "SEGMENTATION", "INTERACTION_ANALYSIS", "KNOWLEDGE"]
const GROUND_TRUTH = join(here, "round-v11-ground-truth.md")
const GROUND_TRUTH_V9 = join(here, "round-v9-ground-truth.md")
const sha = (value: string) => createHash("sha256").update(value).digest("hex")

// CONGELAMENTO do código e dos critérios: hash de cada arquivo que decide algo nesta rodada.
const backendRoot = join(here, "..", "..", "..", "..")
const FREEZE_FILE = join(here, "results", "round-v11-freeze.json")
const FROZEN_DIRS = ["src/modules/feedback-engine", "src/modules/knowledge", "src/modules/investigation/domain", "src/modules/investigation/application", "src/shared/application/model-routing", "src/shared/application/prompting"]
function listFiles(dir: string): string[] {
  return readdirSync(join(backendRoot, dir), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [join(dir, entry.name)] : []))
}
const freezeManifest = () => Object.fromEntries([...FROZEN_DIRS.flatMap(listFiles), "scripts/feedback-engine/evaluation/larissa/evaluate-round-v11.ts", "scripts/feedback-engine/evaluation/larissa/round-v11-budget.ts", "scripts/feedback-engine/evaluation/larissa/round-v11-ground-truth.md", "scripts/feedback-engine/evaluation/larissa/round-v9-ground-truth.md"].sort().map((file) => [file, createHash("sha256").update(readFileSync(join(backendRoot, file))).digest("hex")]))
const currentFreeze = freezeManifest()
if (execute) {
  if (!existsSync(FREEZE_FILE)) throw new Error("Rodada paga sem congelamento: rode o ensaio antes (grava round-v11-freeze.json).")
  const frozenFiles = (JSON.parse(readFileSync(FREEZE_FILE, "utf8")) as { files: Record<string, string> }).files
  const changed = [...new Set([...Object.keys(frozenFiles), ...Object.keys(currentFreeze)])].filter((file) => frozenFiles[file] !== currentFreeze[file])
  if (changed.length > 0) throw new Error(`Código/critérios mudaram depois do congelamento: ${changed.join(", ")}`)
} else if (!replayArtifact) writeFileSync(FREEZE_FILE, JSON.stringify({ frozenAt: new Date().toISOString(), files: currentFreeze }, null, 2))

const realFetch = globalThis.fetch
if (!execute) globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (ROUND_V11_LIMITS.hostPattern.test(url) || /anthropic|openai|x\.ai/.test(url)) throw new Error(`ENSAIO: requisição a ${new URL(url).host} bloqueada.`)
  return realFetch(input, init)
}) as typeof fetch

const readDb = createReadOnlyDatabase(pool)
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
// No replay, o orçamento é o que a rodada gravada tinha ao começar (mesmas reservas e tetos — reproduz as mesmas decisões).
const globalBefore = replayed ? { ...replayed.globalBudget.before, blocked: 0 } : roundV11Totals(readRoundV11Ledger())
const report: Record<string, unknown> = {
  kind: execute ? "PAID_ROUND_V11" : replayArtifact ? "ZERO_COST_REPLAY_V11_NOT_A_MODEL_VALIDATION" : "DRY_RUN_V11",
  ...(replayArtifact ? { replayOf: replayArtifact } : {}),
  ranAt: new Date().toISOString(),
  model: ENGINE_MODEL,
  globalBudget: { limits: { maxRequests: ROUND_V11_LIMITS.maxRequests, maxUsd: ROUND_V11_LIMITS.maxUsd }, before: globalBefore },
  reserve: RESERVE,
  groundTruth: { file: "round-v11-ground-truth.md", sha256: sha(readFileSync(GROUND_TRUTH, "utf8")), modifiedAt: statSync(GROUND_TRUTH).mtime.toISOString(), facts: { file: "round-v9-ground-truth.md", sha256: sha(readFileSync(GROUND_TRUTH_V9, "utf8")) }, registeredBeforeExecution: true, sentToEngine: false },
  freeze: { file: "round-v11-freeze.json", manifestSha256: sha(JSON.stringify(currentFreeze)), files: Object.keys(currentFreeze).length },
  versions: { analysisLogic: CALL_ANALYSIS_LOGIC_VERSION, analysisPrompt: OBLIGATION_ANALYSIS_PROMPT_VERSION, review: OBLIGATION_REVIEW_VERSION, reviewPrompt: OBLIGATION_REVIEW_PROMPT_VERSION, composition: COMPOSITION_VERSION, compositionPrompt: COMPOSITION_PROMPT_VERSION, verificationPrompt: VERIFICATION_PROMPT_VERSION, investigation: INDICATOR_INVESTIGATION_LOGIC_VERSION, investigationTools: ENGINE_INVESTIGATION_TOOLS_VERSION, plannerPrompt: ENGINE_PLANNER_PROMPT_VERSION, closure: INVESTIGATION_CLOSURE_VERSION },
  analysisReuse: { from: COMPARISON, why: "a resposta paga da comparação V10 é a análise no contrato atual (prompt V8 congelado, mesma entrada, mesmas fontes por hash) — etapa reaproveitada; revisão, confirmação, redação e verificação rodam de novo com as instruções atuais" },
  isolatedConfiguration: { capabilities: ISOLATED_CAPABILITIES, persisted: "INTOCADO (perfil do agente substituído só na memória deste processo)" },
}
const requests: { phase: string; stage: string; tag: string | null; chars: number; text: string }[] = []
const responses: { phase: string; stage: string; tag: string | null; text: string | null; error: string | null; usage: unknown; finishReason: string | null }[] = []
let phase = "setup"
let lastPlannerAnalyzeQuestions: { interactions: unknown; question: string }[] = []
const opened = execute ? openRoundV11Budget("evaluate-round-v11", realFetch) : null
if (opened) globalThis.fetch = opened.budget.fetch
const remainingRequests = opened ? opened.remaining.maxRequests : ROUND_V11_LIMITS.maxRequests - globalBefore.requests
const remainingUsd = opened ? opened.remaining.maxUsd : ROUND_V11_LIMITS.maxUsd - globalBefore.spentUsd
try {
  const frozen = await loadFrozenSources(readDb, "C07")
  const org = frozen.org
  const person = frozen.person
  const overlay = createInMemoryFeedbackMemoryStore()
  const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(readDb), overlay)
  const real = createGatewayEngineModel({ generate: (request) => generateForRoute({ ...request, transport: { ...request.transport, retries: 0 } }) })
  const model: EngineModelPort = {
    async generate(request) {
      const text = [request.systemPrompt, ...request.contents.map((turn) => turn.text)].join("\n\n")
      requests.push({ phase, stage: request.stage, tag: request.tag ?? null, chars: text.length, text })
      if (replayArtifact) {
        const index = stored.findIndex((entry, position) => !used.has(position) && entry.phase === phase && entry.stage === request.stage && entry.tag === (request.tag ?? null))
        if (index < 0) {
          responses.push({ phase, stage: request.stage, tag: request.tag ?? null, text: null, error: "REPLAY: sem resposta paga gravada para este pedido", usage: null, finishReason: null })
          throw Object.assign(new Error(`REPLAY: sem resposta paga gravada para ${phase} · ${request.stage}:${request.tag ?? ""}`), { name: "ReplayMissing" })
        }
        used.add(index)
        const entry = stored[index]!
        responses.push({ phase, stage: request.stage, tag: request.tag ?? null, text: entry.text, error: null, usage: entry.usage, finishReason: entry.finishReason })
        // Uso GRAVADO da rodada paga (o do pedido original): sem ele o medidor contaria a reserva máxima de cada chamada e o replay
        // recusaria por custo etapas que a rodada paga executou. Pedido que mudou de tamanho depois da rodada fica com o uso antigo.
        return { text: entry.text!, model: ENGINE_MODEL, usage: (entry.usage as EngineModelResponse["usage"]) ?? null, durationMs: null, costUsd: null, finishReason: entry.finishReason }
      }
      if (!execute) throw Object.assign(new Error("ENSAIO: pedido medido, não enviado."), { name: "DryRunStop" })
      opened!.budget.setLabel(`V11 ${phase} · ${request.stage}${request.tag ? `:${request.tag}` : ""}`)
      try {
        const response = await real.generate(request)
        responses.push({ phase, stage: request.stage, tag: request.tag ?? null, text: response.text, error: null, usage: response.usage ?? null, finishReason: response.finishReason })
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
        responses.push({ phase, stage: request.stage, tag: request.tag ?? null, text: null, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), usage: null, finishReason: null })
        throw error
      }
    },
  }
  const engineBudget: EngineBudgetLimits = { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: Math.max(0, remainingRequests - RESERVE.B - RESERVE.C), maxCostUsd: Math.max(0, remainingUsd) }
  const deps = createEngineDeps({ db: readDb, stores, model, peerCallAnalyses: false, allowCollaborator: (id) => id === person.id, budget: engineBudget, price: { inputPerMillion: ROUND_V11_LIMITS.pricePerMillion.input, outputPerMillion: ROUND_V11_LIMITS.pricePerMillion.output } })
  const scripts = attachmentArgumentScripts()
  deps.analyze.loadArgumentScripts = async () => scripts
  const loadAgent = deps.analyze.loadAgent
  deps.analyze.loadAgent = async (organizationId, agentId) => {
    const profile = await loadAgent(organizationId, agentId)
    return profile && agentId === frozen.agent.id ? { ...profile, investigationCapabilities: [...ISOLATED_CAPABILITIES] } : profile
  }

  const bRow = (await readDb.query<{ id: string }>(`select id from interactions where organization_id = $1 and operator_id = $2 and external_id = $3`, [org, person.id, B_EXTERNAL_ID])).rows
  if (bRow.length !== 1) throw new Error(`${B_EXTERNAL_ID}: chamada da Larissa ausente ou ambígua.`)
  const comparison = JSON.parse(readFileSync(join(here, COMPARISON), "utf8")) as { results: Record<string, { text?: string }> }
  const v9Prompts = JSON.parse(readFileSync(join(here, V9_PROMPTS), "utf8")) as { phase: string; stage: string; text: string }[]

  // A análise PAGA da comparação entra como análise SUSPENSA (revisão pendente): o motor retoma da revisão. Conferências: fontes
  // congeladas, mesma mensagem do usuário da comparação (o motor atual a reproduz) e o mesmo prompt de sistema.
  const seeds: Record<string, unknown> = {}
  const knownCalls = new Set<string>()
  for (const key of ["A", "B"] as const) {
    const interactionId = key === "A" ? frozen.interaction.id : bRow[0]!.id
    knownCalls.add(interactionId)
    const interaction = await loadInteractionForAnalysis(readDb, org, interactionId)
    if (!interaction?.transcript || interaction.operatorId !== person.id) throw new Error(`${key}: chamada sem transcrição ou de outra pessoa.`)
    const candidates = await loadAgentDocumentsAt(readDb, org, frozen.agent.id, interaction.startedAt)
    for (const known of frozen.selection.knowledge) if (!candidates.some((document) => document.documentId === known.documentId && document.contentHash === known.contentHash)) throw new Error(`Base ${known.documentId} difere da congelada — nada executado.`)
    const subject = interaction.subjectCanonical?.name ?? interaction.reason
    const selection = selectDocumentsForCall(candidates, { subject, transcript: interaction.transcript.content })
    const context = buildProcedureContext(selection.selected, scripts)
    const projection = projectTranscript(interaction.transcript.content, { maxChars: TRANSCRIPT_MAX_CHARS })
    const transcriptStatus = transcriptStatusOf(projection)
    const keys = analysisKeysOf({ interaction, agent: frozen.agent, documents: selection.selected, context, projection, transcriptStatus, subject })
    const v9Text = v9Prompts.find((entry) => entry.phase === key && entry.stage === "CALL_ANALYSIS")!.text
    const comparisonUserTurn = v9Text.slice(v9Text.indexOf("ESPECIALISTA CONFIGURADO:"))
    const text = comparison.results[`ALT-${key}`]?.text
    if (!text) throw new Error(`${key}: resposta da comparação ausente.`)
    const seededAt = new Date()
    const claim = await overlay.claimAnalysis({ organizationId: org, kind: "CALL_ANALYSIS", analysisKey: keys.analysisKey, personId: person.id, interactionId, indicatorDefinitionId: null, periodStart: null, periodEnd: null, agentId: frozen.agent.id, trigger: { kind: "EVALUATION", selectionReason: `Rodada V11 (${key}): análise paga da comparação de contratos (V10), reaproveitada.` }, logicVersion: "seed", asOf: seededAt }, seededAt, 60)
    if (claim.kind !== "CLAIMED") throw new Error(`${key}: semente da análise não pôde ser criada.`)
    await overlay.suspendCallAnalysis(org, claim.runId, {
      error: "REVIEW_PENDING:COMPARISON_PROPOSALS",
      checkpoint: { version: CALL_ANALYSIS_CHECKPOINT_VERSION, stage: "REVIEW_PENDING", proposalKey: keys.proposalKey, reason: "TECHNICAL", error: "PAID_COMPARISON_PROPOSALS", reviewAttempts: 0, since: seededAt.toISOString(), lastAttemptAt: seededAt.toISOString() },
      provenance: { proposalKey: keys.proposalKey, modelResponses: { analysis: { requestSha256: sha(`${OBLIGATION_ANALYSIS_SYSTEM_PROMPT}\n${comparisonUserTurn}`), text }, review: null }, seededFrom: COMPARISON },
      metrics: {},
    }, seededAt)
    seeds[key] = { interactionId, proposalKey: keys.proposalKey, analysisKey: keys.analysisKey, comparisonResponseSha256: sha(text) }
  }
  report.seeds = seeds

  // A 3ª chamada (só em C): registrada em arquivo ANTES do pedido de análise sair.
  const thirdCallSelections: Record<string, unknown>[] = []
  const loadInteraction = deps.analyze.loadInteraction
  deps.analyze.loadInteraction = async (organizationId, interactionId) => {
    const loaded = await loadInteraction(organizationId, interactionId)
    if (phase === "C" && loaded && !knownCalls.has(interactionId)) {
      const selection = { registeredAt: new Date().toISOString(), interactionId, externalId: (await readDb.query<{ external_id: string }>(`select external_id from interactions where id = $1`, [interactionId])).rows[0]?.external_id ?? null, operatorId: loaded.operatorId, subject: loaded.subjectCanonical?.name ?? loaded.reason, startedAt: loaded.startedAt.toISOString(), plannerAnalyzeRequests: lastPlannerAnalyzeQuestions }
      thirdCallSelections.push(selection)
      writeFileSync(join(here, "results", `round-v11-${execute ? "paid" : "dry-run"}-${stamp}.third-call-selection.json`), JSON.stringify(thirdCallSelections, null, 2))
    }
    return loaded
  }

  const messageDetail = async (messageId: string | null | undefined) => {
    if (!messageId) return null
    const record = await stores.getMessage(org, messageId)
    if (!record) return null
    return { status: record.status, abstainReason: record.abstainReason, heading: record.message?.view?.heading ?? null, card: record.message?.card ?? null, text: record.message?.text ?? null, brief: record.brief, composition: record.composition }
  }
  const analysisDetail = (interactionId: string) => {
    const assessment = overlay.assessments.find((entry) => entry.isCurrent && entry.snapshot.interactionId === interactionId)
    if (!assessment) return null
    const analysis = assessment.analysis
    return {
      outcome: analysis.outcome,
      outcomeReasons: analysis.outcomeReasons,
      scenario: { customerNeed: analysis.scenario.customerNeed, conditions: analysis.scenario.conditions, procedure: analysis.scenario.procedureTitle, rulePerspective: analysis.scenario.rulePerspective, declaredPath: analysis.scenario.declaredPathAssessment, proposedPath: analysis.scenario.proposedPathAssessment, pathAssessment: analysis.scenario.pathAssessment, pathConfirmation: analysis.scenario.pathConfirmation, pathCompleteness: analysis.scenario.pathCompleteness ?? null, pathTaken: analysis.scenario.pathTaken, pathRationale: analysis.scenario.pathRationale },
      argumentScripts: analysis.argumentScripts ?? null,
      coverage: analysis.coverage,
      coverageLimits: analysis.coverageLimits ?? null,
      review: analysis.checks.review,
      contractViolations: analysis.checks.contractViolations,
      auditNotes: analysis.auditNotes,
      limitations: analysis.limitations,
      criteria: analysis.criteria.map((criterion) => ({ handle: criterion.lineHandle, origin: criterion.origin, title: criterion.titleText ?? criterion.text.slice(0, 120), sources: (criterion.sources ?? []).map((source) => source.handle), action: criterion.requiredAction ?? null, condition: criterion.condition ?? null, items: criterion.items ?? null, itemsMode: criterion.itemsMode ?? null, declared: criterion.declaredStatus, proposed: criterion.proposedStatus, final: criterion.status, confirmation: criterion.confirmation, reasons: criterion.confirmationReasons, reviewReading: criterion.review ? { verdict: criterion.review.verdict, evidenceReading: criterion.review.evidenceReading ?? null, outsideDependency: criterion.review.outsideDependency ?? null, listReading: criterion.review.listReading, issues: criterion.review.issues, note: criterion.review.note } : null, observability: criterion.observability ?? null, executionClaim: criterion.executionClaim ?? null, evidenceKind: criterion.evidenceKind, evidence: criterion.evidence.map((quote, index) => `${quote.turn} ${quote.speaker}${criterion.evidenceRoles?.[index] ? ` [${criterion.evidenceRoles[index]}]` : ""}: ${quote.quote}`), opportunityTurn: criterion.opportunityTurn, materiality: criterion.materiality, role: criterion.scenarioRole ?? null, downgrades: criterion.downgrades, rationale: criterion.rationale })),
    }
  }
  const scenario = async (key: "A" | "B", interactionId: string, selectionReason: string, cap: number) => {
    phase = key
    engineBudget.maxModelCalls = cap
    const startCalls = deps.meter.callsMade
    let generation: unknown
    try {
      const result = await generateFeedback(deps, { organizationId: org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: `round-v11-${key}`, sourceNodeId: `round-v11-analysis-${key}`, domain: "MONITORING", sourceNodeOutput: null, collaboratorId: person.id, interactionId, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason, now: new Date() })
      generation = { kind: result.kind, messageId: result.messageId, message: await messageDetail(result.messageId) }
    } catch (error) {
      generation = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
    }
    return { cap, modelCalls: deps.meter.callsMade - startCalls, generation, analysis: analysisDetail(interactionId) }
  }
  report.A = await scenario("A", frozen.interaction.id, "Avaliação real V11 (cenário A): contestação de cobrança após cancelamento.", Math.max(0, remainingRequests - RESERVE.B - RESERVE.C))
  report.B = await scenario("B", bRow[0]!.id, "Avaliação real V11 (cenário B): segunda via com argumentário aplicável.", deps.meter.callsMade + Math.max(0, remainingRequests - deps.meter.callsMade - RESERVE.C))

  // C: o que SOBROU do orçamento global, com reserva só para a mensagem (redação + verificação).
  phase = "C"
  const remaining = Math.max(0, remainingRequests - deps.meter.callsMade)
  engineBudget.maxModelCalls = deps.meter.callsMade + remaining
  const newAnalyses = remaining >= 7 ? 1 : 0
  const planningRounds = remaining >= 6 ? 3 : remaining >= 4 ? 2 : 1
  const investigate = deps.investigate as { maxCallAnalyses?: number; maxPlanningRounds?: number }
  investigate.maxCallAnalyses = newAnalyses
  investigate.maxPlanningRounds = planningRounds
  const startCalls = deps.meter.callsMade
  let investigation: unknown = null
  let generation: unknown = null
  try {
    const investigated = await investigateIndicator(deps.investigate, { organizationId: org, personId: person.id, agentId: frozen.agent.id, agentConfiguredAt: frozen.agent.updatedAt.toISOString(), enrollmentId: null, target: { kind: "OFFICIAL_CLOSING", indicatorCode: INDICATOR.code, referencePeriod: INDICATOR.referencePeriod }, trigger: { kind: "EVALUATION", selectionReason: "Avaliação real V11 (cenário C): TMA de agosto/2026." }, now: new Date() })
    const stored = await Promise.all(investigated.investigations.map((entry) => stores.getIndicatorInvestigationByRun(org, entry.runId)))
    investigation = { refs: investigated, stored: stored.map((entry) => entry?.investigation ?? null) }
    const source = { kind: INDICATOR_ANALYSIS_NODE_OUTPUT_KIND, personId: person.id, agentId: frozen.agent.id, investigations: investigated.investigations.map((entry) => ({ analysisRunId: entry.runId, investigationId: entry.investigationId, indicatorCode: entry.indicatorCode, periodLabel: entry.periodLabel, conclusion: entry.conclusion, reused: entry.reused })), skippedReason: investigated.skippedReason, text: "" }
    const result = await generateFeedback(deps, { organizationId: org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "round-v11-C", sourceNodeId: "round-v11-investigation-C", domain: "INDICATOR", sourceNodeOutput: source, collaboratorId: person.id, interactionId: null, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: "Avaliação real V11 (cenário C): TMA de agosto/2026.", now: new Date() })
    generation = { kind: result.kind, messageId: result.messageId, message: await messageDetail(result.messageId) }
  } catch (error) {
    generation = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
  report.C = { remainingAtStart: remaining, newCallAnalysesAllowed: newAnalyses, planningRoundsAllowed: planningRounds, modelCalls: deps.meter.callsMade - startCalls, thirdCallSelections, investigation, generation }
  report.isolation = { otherCollaboratorsAnalyzed: overlay.assessments.filter((entry) => entry.snapshot.personId !== person.id).length, analyses: overlay.assessments.map((entry) => ({ interactionId: entry.snapshot.interactionId, current: entry.isCurrent })), messages: overlay.messages.size, persisted: "NONE (banco somente leitura; memória e mensagens em RAM)" }
  report.meter = deps.meter.summary()
} catch (error) {
  report.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
} finally {
  if (opened) report.budget = { ledger: opened.budget.ledger, globalAfter: opened.persist() }
  await pool.end()
}
report.requests = requests.map((entry) => ({ phase: entry.phase, stage: entry.stage, tag: entry.tag, chars: entry.chars, estimatedInputTokens: Math.ceil(entry.chars / 3) }))
report.responses = responses
const out = join(here, "results", `${replayArtifact ? "replay-round-v11" : `round-v11-${execute ? "paid" : "dry-run"}`}-${stamp}.json`)
writeFileSync(out, JSON.stringify(report, null, 2))
writeFileSync(out.replace(/\.json$/, ".prompts.json"), JSON.stringify(requests, null, 2))
console.log(JSON.stringify({ kind: report.kind, error: report.error ?? null, requests: report.requests, budget: (report.budget as { globalAfter?: unknown } | undefined)?.globalAfter ?? null }, null, 2))
console.log(`\nArtefato: ${out}`)
