/**
 * RODADA V12 (02/10/2026) — Larissa Monteiro (DEMO-OP-0001) apenas. Por ETAPAS, cada uma decidida e registrada antes
 * (`round-v12-decisions.md`), contra critérios escritos antes (`round-v12-ground-truth.md`). Livro-razão PRÓPRIO
 * (`round-v12-budget.ts`: 8 requisições e US$ 0,30 para TUDO, somando as etapas; V10 e V11 intocados).
 *
 * Etapas (`--stage`):
 *   A-review  — C07: análise paga da comparação V10 reaproveitada (análise suspensa); paga a revisão V3 e, só se o código achar
 *               achado/divergência conferível, a confirmação focal. Para ANTES da redação.
 *   A-compose — C07: reaproveita a análise (V10) E a revisão/confirmação pagas da A-review (mesma assinatura de pedido; o harness
 *               recusa se o motor tentar pagá-las de novo); paga só redação + verificação (+ reparo/coerência se o código pedir).
 *   B-review  — DEMO-INT-0001-08: como A-review.
 *   C-plan    — TMA de agosto/2026: só o planejador (até 2 rodadas), ZERO análise de chamada nova, sem redação.
 *   A-verify  — C07: o RASCUNHO pago da A-compose, sem nenhuma alteração, vai ao verificador atual com o brief refeito pelo código atual
 *               (análise e revisão reaproveitadas; o redator é bloqueado). 1 requisição: a verificação.
 *
 * Sem `--execute` é ENSAIO: o envio ao provedor é bloqueado e a 1ª chamada de modelo para a etapa (mede o pedido). O ensaio grava o
 * congelamento só se ele ainda não existir (`--refreeze` sobrescreve — e precisa ser registrado nas decisões). Uma etapa paga roda uma
 * vez só. Isolamento: banco SOMENTE LEITURA; memória e mensagens em RAM; nada publicado, entregue, notificado ou gravado.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/evaluate-round-v12.ts --stage A-review
 *   npx tsx scripts/feedback-engine/evaluation/larissa/evaluate-round-v12.ts --stage A-review --execute --authorized-by-user
 */
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { generateForRoute } from "../../../../src/shared/application/model-routing/llm-gateway.js"
import { projectTranscript } from "../../../../src/modules/investigation/domain/transcript-projection.js"
import { DEFAULT_ENGINE_BUDGET, type EngineBudgetLimits } from "../../../../src/modules/feedback-engine/application/engine-meter.js"
import { analysisKeysOf, analyzeCall, TRANSCRIPT_MAX_CHARS } from "../../../../src/modules/feedback-engine/application/analyze-call.js"
import { createEngineDeps } from "../../../../src/modules/feedback-engine/application/engine-wiring.js"
import { generateFeedback } from "../../../../src/modules/feedback-engine/application/generate-feedback.js"
import { investigateIndicator } from "../../../../src/modules/feedback-engine/application/investigate-indicator.js"
import type { EngineModelPort } from "../../../../src/modules/feedback-engine/application/ports.js"
import { CALL_ANALYSIS_CHECKPOINT_VERSION, type StageResponse } from "../../../../src/modules/feedback-engine/domain/analysis-recovery.js"
import { selectDocumentsForCall } from "../../../../src/modules/feedback-engine/domain/document-selection.js"
import { OBLIGATION_ANALYSIS_PROMPT_VERSION, OBLIGATION_ANALYSIS_SYSTEM_PROMPT } from "../../../../src/modules/feedback-engine/domain/obligation-analysis-prompt.js"
import { OBLIGATION_REVIEW_PROMPT_VERSION, OBLIGATION_REVIEW_VERSION } from "../../../../src/modules/feedback-engine/domain/obligation-review.js"
import { buildProcedureContext, transcriptStatusOf } from "../../../../src/modules/feedback-engine/domain/procedure.js"
import { renderVerificationUserTurn, VERIFICATION_RESPONSE_SCHEMA, VERIFICATION_SYSTEM_PROMPT } from "../../../../src/modules/feedback-engine/domain/composition-prompt.js"
import { analysisClaimsOf, parseVerdicts, parseWriterDraft } from "../../../../src/modules/feedback-engine/domain/composition.js"
import type { FeedbackBrief } from "../../../../src/modules/feedback-engine/domain/feedback-brief.js"
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
import { openRoundV12Budget, readRoundV12Ledger, roundV12Totals, ROUND_V12_LIMITS } from "./round-v12-budget.js"

const here = dirname(fileURLToPath(import.meta.url))
const STAGES = ["A-review", "A-compose", "B-review", "C-plan", "A-verify"] as const
type Stage = (typeof STAGES)[number]
const stageArg = process.argv[process.argv.indexOf("--stage") + 1] as Stage | undefined
if (!process.argv.includes("--stage") || !stageArg || !STAGES.includes(stageArg)) throw new Error(`--stage obrigatório: ${STAGES.join(" | ")}`)
const stage: Stage = stageArg
const execute = process.argv.includes("--execute")
if (execute && !process.argv.includes("--authorized-by-user")) throw new Error("Etapa paga só com autorização registrada (--authorized-by-user).")
const resultsDir = join(here, "results")
const paidOf = (name: Stage) => readdirSync(resultsDir).filter((file) => file.startsWith(`round-v12-${name}-paid-`) && file.endsWith(".json") && !file.endsWith(".prompts.json")).sort()
if (execute && paidOf(stage).length > 0) throw new Error(`Etapa ${stage} já executada (${paidOf(stage)[0]}): não repita para escolher outro resultado.`)

const COMPARISON = "results/round-v10-comparison-paid-2026-10-02T14-44-16-633Z.json"
const V9_PROMPTS = "results/round-v9-paid-2026-10-02T13-39-47-453Z.prompts.json"
const B_EXTERNAL_ID = "DEMO-INT-0001-08"
const INDICATOR = { code: "TMA", referencePeriod: "2026-08" }
const ISOLATED_CAPABILITIES: InvestigationCapability[] = ["INDICATOR_ANALYSIS", "SEGMENTATION", "INTERACTION_ANALYSIS", "KNOWLEDGE"]
/** Teto de chamadas de modelo por etapa (o livro-razão global continua sendo o limite final). */
const STAGE_CAP: Record<Stage, number> = { "A-review": 2, "A-compose": 4, "B-review": 2, "C-plan": 2, "A-verify": 1 }
const GROUND_TRUTH = join(here, "round-v12-ground-truth.md")
const DIAGNOSIS = join(here, "round-v12-diagnosis.md")
const sha = (value: string) => createHash("sha256").update(value).digest("hex")

// CONGELAMENTO do código e dos critérios: hash de cada arquivo que decide algo nesta rodada.
const backendRoot = join(here, "..", "..", "..", "..")
const FREEZE_FILE = join(resultsDir, "round-v12-freeze.json")
const FROZEN_DIRS = ["src/modules/feedback-engine", "src/modules/knowledge", "src/modules/investigation/domain", "src/modules/investigation/application", "src/shared/application/model-routing", "src/shared/application/prompting"]
function listFiles(dir: string): string[] {
  return readdirSync(join(backendRoot, dir), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [join(dir, entry.name)] : []))
}
const harnessFiles = ["evaluate-round-v12.ts", "round-v12-budget.ts", "round-v12-ground-truth.md", "round-v12-diagnosis.md", "round-v9-ground-truth.md"].map((file) => `scripts/feedback-engine/evaluation/larissa/${file}`)
const freezeManifest = () => Object.fromEntries([...FROZEN_DIRS.flatMap(listFiles), ...harnessFiles].sort().map((file) => [file, sha(readFileSync(join(backendRoot, file), "utf8"))]))
const currentFreeze = freezeManifest()
if (execute) {
  if (!existsSync(FREEZE_FILE)) throw new Error("Etapa paga sem congelamento: rode o ensaio antes (grava round-v12-freeze.json).")
  const frozenFiles = (JSON.parse(readFileSync(FREEZE_FILE, "utf8")) as { files: Record<string, string> }).files
  const changed = [...new Set([...Object.keys(frozenFiles), ...Object.keys(currentFreeze)])].filter((file) => frozenFiles[file] !== currentFreeze[file])
  if (changed.length > 0) throw new Error(`Código/critérios mudaram depois do congelamento: ${changed.join(", ")}`)
} else if (!existsSync(FREEZE_FILE) || process.argv.includes("--refreeze")) writeFileSync(FREEZE_FILE, JSON.stringify({ frozenAt: new Date().toISOString(), files: currentFreeze }, null, 2))

const realFetch = globalThis.fetch
if (!execute) globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (ROUND_V12_LIMITS.hostPattern.test(url) || /anthropic|openai|x\.ai/.test(url)) throw new Error(`ENSAIO: requisição a ${new URL(url).host} bloqueada.`)
  return realFetch(input, init)
}) as typeof fetch

const readDb = createReadOnlyDatabase(pool)
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const globalBefore = roundV12Totals(readRoundV12Ledger())
const report: Record<string, unknown> = {
  kind: execute ? "PAID_ROUND_V12_STAGE" : "DRY_RUN_V12_STAGE",
  stage,
  ranAt: new Date().toISOString(),
  model: ENGINE_MODEL,
  globalBudget: { limits: { maxRequests: ROUND_V12_LIMITS.maxRequests, maxUsd: ROUND_V12_LIMITS.maxUsd }, before: globalBefore },
  stageCap: STAGE_CAP[stage],
  groundTruth: { file: "round-v12-ground-truth.md", sha256: sha(readFileSync(GROUND_TRUTH, "utf8")), registeredBeforeExecution: true, sentToEngine: false },
  diagnosis: { file: "round-v12-diagnosis.md", sha256: sha(readFileSync(DIAGNOSIS, "utf8")) },
  freeze: { file: "round-v12-freeze.json", manifestSha256: sha(JSON.stringify(currentFreeze)), files: Object.keys(currentFreeze).length },
  versions: { analysisLogic: CALL_ANALYSIS_LOGIC_VERSION, analysisPrompt: OBLIGATION_ANALYSIS_PROMPT_VERSION, review: OBLIGATION_REVIEW_VERSION, reviewPrompt: OBLIGATION_REVIEW_PROMPT_VERSION, composition: COMPOSITION_VERSION, compositionPrompt: COMPOSITION_PROMPT_VERSION, verificationPrompt: VERIFICATION_PROMPT_VERSION, investigation: INDICATOR_INVESTIGATION_LOGIC_VERSION, investigationTools: ENGINE_INVESTIGATION_TOOLS_VERSION, plannerPrompt: ENGINE_PLANNER_PROMPT_VERSION, closure: INVESTIGATION_CLOSURE_VERSION },
  isolatedConfiguration: { capabilities: ISOLATED_CAPABILITIES, persisted: "INTOCADO (perfil do agente substituído só na memória deste processo)" },
}
const requests: { stage: string; tag: string | null; chars: number; text: string }[] = []
const responses: { stage: string; tag: string | null; text: string | null; error: string | null; usage: unknown; finishReason: string | null }[] = []
/** Na redação, revisão e confirmação JÁ foram pagas na A-review: se o motor tentar pedi-las de novo, o reaproveitamento falhou. */
const REUSE_ONLY: Partial<Record<Stage, readonly string[]>> = { "A-compose": ["CALL_ANALYSIS", "CALL_REVIEW", "CALL_CONFIRMATION"], "B-review": ["CALL_ANALYSIS"], "A-review": ["CALL_ANALYSIS"], "A-verify": ["CALL_ANALYSIS", "CALL_REVIEW", "CALL_CONFIRMATION"] }
/** A-verify: o redator nunca é chamado (o rascunho é o PAGO da A-compose); só a verificação explícita sai. */
let verifyPhase = false
const opened = execute ? openRoundV12Budget(`evaluate-round-v12:${stage}`, realFetch) : null
if (opened) globalThis.fetch = opened.budget.fetch
const remainingRequests = opened ? opened.remaining.maxRequests : ROUND_V12_LIMITS.maxRequests - globalBefore.requests
const remainingUsd = opened ? opened.remaining.maxUsd : ROUND_V12_LIMITS.maxUsd - globalBefore.spentUsd
try {
  const key = stage.startsWith("B") ? "B" : stage.startsWith("C") ? "C" : "A"
  const frozen = await loadFrozenSources(readDb, "C07")
  const org = frozen.org
  const person = frozen.person
  const overlay = createInMemoryFeedbackMemoryStore()
  const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(readDb), overlay)
  const real = createGatewayEngineModel({ generate: (request) => generateForRoute({ ...request, transport: { ...request.transport, retries: 0 } }) })
  const model: EngineModelPort = {
    async generate(request) {
      const text = [request.systemPrompt, ...request.contents.map((turn) => turn.text)].join("\n\n")
      requests.push({ stage: request.stage, tag: request.tag ?? null, chars: text.length, text })
      if (stage === "A-verify" && (request.stage === "COMPOSITION" || (request.stage === "VERIFICATION" && !verifyPhase))) {
        responses.push({ stage: request.stage, tag: request.tag ?? null, text: null, error: "WRITER_BLOCKED: A-verify usa o rascunho pago — nada enviado", usage: null, finishReason: null })
        throw Object.assign(new Error("WRITER_BLOCKED: o rascunho desta etapa é o pago da A-compose (nada enviado)."), { name: "WriterBlocked" })
      }
      if (REUSE_ONLY[stage]?.includes(request.stage)) {
        responses.push({ stage: request.stage, tag: request.tag ?? null, text: null, error: "REUSE_MISSED: etapa já paga pedida de novo — recusado", usage: null, finishReason: null })
        throw Object.assign(new Error(`REUSE_MISSED: ${request.stage} já foi pago; o reaproveitamento falhou (nada enviado).`), { name: "ReuseMissed" })
      }
      if (!execute) throw Object.assign(new Error("ENSAIO: pedido medido, não enviado."), { name: "DryRunStop" })
      opened!.budget.setLabel(`V12 ${stage} · ${request.stage}${request.tag ? `:${request.tag}` : ""}`)
      try {
        const response = await real.generate(request)
        responses.push({ stage: request.stage, tag: request.tag ?? null, text: response.text, error: null, usage: response.usage ?? null, finishReason: response.finishReason })
        return response
      } catch (error) {
        responses.push({ stage: request.stage, tag: request.tag ?? null, text: null, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), usage: null, finishReason: null })
        throw error
      }
    },
  }
  const cap = Math.max(0, Math.min(STAGE_CAP[stage], remainingRequests))
  const engineBudget: EngineBudgetLimits = { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: cap, maxCostUsd: Math.max(0, remainingUsd), transientRetries: 0, compositionReserve: stage === "A-compose" ? DEFAULT_ENGINE_BUDGET.compositionReserve ?? null : null }
  report.engineBudget = { maxModelCalls: cap, maxCostUsd: Math.max(0, remainingUsd), transientRetries: 0, compositionReserve: engineBudget.compositionReserve }
  if (cap === 0) throw new Error(`Etapa ${stage} não cabe: ${remainingRequests} requisição(ões) restante(s) — não iniciada.`)
  const deps = createEngineDeps({ db: readDb, stores, model, peerCallAnalyses: false, allowCollaborator: (id) => id === person.id, budget: engineBudget, price: { inputPerMillion: ROUND_V12_LIMITS.pricePerMillion.input, outputPerMillion: ROUND_V12_LIMITS.pricePerMillion.output } })
  const scripts = attachmentArgumentScripts()
  deps.analyze.loadArgumentScripts = async () => scripts
  const loadAgent = deps.analyze.loadAgent
  deps.analyze.loadAgent = async (organizationId, agentId) => {
    const profile = await loadAgent(organizationId, agentId)
    return profile && agentId === frozen.agent.id ? { ...profile, investigationCapabilities: [...ISOLATED_CAPABILITIES] } : profile
  }

  const analysisDetail = (interactionId: string) => {
    const assessment = overlay.assessments.find((entry) => entry.isCurrent && entry.snapshot.interactionId === interactionId)
    if (!assessment) return null
    const analysis = assessment.analysis
    return {
      outcome: analysis.outcome,
      outcomeReasons: analysis.outcomeReasons,
      scenario: { customerNeed: analysis.scenario.customerNeed, centralNeed: analysis.scenario.centralNeed ?? null, conditions: analysis.scenario.conditions, procedure: analysis.scenario.procedureTitle, pathAssessment: analysis.scenario.pathAssessment, pathConfirmation: analysis.scenario.pathConfirmation, pathTaken: analysis.scenario.pathTaken, pathRationale: analysis.scenario.pathRationale },
      coverage: analysis.coverage,
      coverageLimits: analysis.coverageLimits ?? null,
      review: analysis.checks.review,
      contractViolations: analysis.checks.contractViolations,
      auditNotes: analysis.auditNotes,
      limitations: analysis.limitations,
      criteria: analysis.criteria.map((criterion) => ({ handle: criterion.lineHandle, origin: criterion.origin, title: criterion.titleText ?? criterion.text.slice(0, 120), sources: (criterion.sources ?? []).map((source) => source.handle), action: criterion.requiredAction ?? null, condition: criterion.condition ?? null, items: criterion.items ?? null, itemsMode: criterion.itemsMode ?? null, declared: criterion.declaredStatus, proposed: criterion.proposedStatus, final: criterion.status, confirmation: criterion.confirmation, reasons: criterion.confirmationReasons, reviewReading: criterion.review ? { verdict: criterion.review.verdict, actPlace: criterion.review.actPlace ?? null, judgedPart: criterion.review.judgedPart ?? null, outsidePart: criterion.review.outsidePart ?? null, evidenceReading: criterion.review.evidenceReading ?? null, outsideDependency: criterion.review.outsideDependency ?? null, listReading: criterion.review.listReading, issues: criterion.review.issues, note: criterion.review.note } : null, judgedPart: criterion.judgedPart ?? null, operationalPart: criterion.operationalPart ?? null, divergence: criterion.divergence ?? null, occurrence: criterion.occurrence ?? null, observability: criterion.observability ?? null, executionClaim: criterion.executionClaim ?? null, evidenceKind: criterion.evidenceKind, evidence: criterion.evidence.map((quote, index) => `${quote.turn} ${quote.speaker}${criterion.evidenceRoles?.[index] ? ` [${criterion.evidenceRoles[index]}]` : ""}: ${quote.quote}`), opportunityTurn: criterion.opportunityTurn, materiality: criterion.materiality, role: criterion.scenarioRole ?? null, downgrades: criterion.downgrades, rationale: criterion.rationale })),
    }
  }

  if (key === "A" || key === "B") {
    const bRow = (await readDb.query<{ id: string }>(`select id from interactions where organization_id = $1 and operator_id = $2 and external_id = $3`, [org, person.id, B_EXTERNAL_ID])).rows
    if (bRow.length !== 1) throw new Error(`${B_EXTERNAL_ID}: chamada da Larissa ausente ou ambígua.`)
    const interactionId = key === "A" ? frozen.interaction.id : bRow[0]!.id
    const comparison = JSON.parse(readFileSync(join(here, COMPARISON), "utf8")) as { results: Record<string, { text?: string }> }
    const v9Prompts = JSON.parse(readFileSync(join(here, V9_PROMPTS), "utf8")) as { phase: string; stage: string; text: string }[]
    const interaction = await loadInteractionForAnalysis(readDb, org, interactionId)
    if (!interaction?.transcript || interaction.operatorId !== person.id) throw new Error(`${key}: chamada sem transcrição ou de outra pessoa.`)
    const candidates = await loadAgentDocumentsAt(readDb, org, frozen.agent.id, interaction.startedAt)
    for (const known of frozen.selection.knowledge) if (!candidates.some((document) => document.documentId === known.documentId && document.contentHash === known.contentHash)) throw new Error(`Base ${known.documentId} difere da congelada — nada executado.`)
    const subject = interaction.subjectCanonical?.name ?? interaction.reason
    const selection = selectDocumentsForCall(candidates, { subject, transcript: interaction.transcript.content })
    const context = buildProcedureContext(selection.selected, scripts)
    const projection = projectTranscript(interaction.transcript.content, { maxChars: TRANSCRIPT_MAX_CHARS })
    const keys = analysisKeysOf({ interaction, agent: frozen.agent, documents: selection.selected, context, projection, transcriptStatus: transcriptStatusOf(projection), subject })
    const v9Text = v9Prompts.find((entry) => entry.phase === key && entry.stage === "CALL_ANALYSIS")!.text
    const comparisonUserTurn = v9Text.slice(v9Text.indexOf("ESPECIALISTA CONFIGURADO:"))
    const text = comparison.results[`ALT-${key}`]?.text
    if (!text) throw new Error(`${key}: resposta da comparação ausente.`)
    // A-compose: revisão e confirmação PAGAS na A-review (respostas cruas com a assinatura do pedido) entram junto da análise.
    let paidStages: { review: StageResponse | null; confirmation: StageResponse | null } = { review: null, confirmation: null }
    if (stage === "A-compose" || stage === "A-verify") {
      const source = paidOf("A-review")[0]
      if (!source) throw new Error("A-compose exige a A-review paga (revisão e confirmação a reaproveitar).")
      const paid = JSON.parse(readFileSync(join(resultsDir, source), "utf8")) as { stageResponses?: { review: StageResponse | null; confirmation: StageResponse | null } }
      if (!paid.stageResponses?.review) throw new Error(`${source}: sem a revisão paga a reaproveitar.`)
      paidStages = { review: paid.stageResponses.review, confirmation: paid.stageResponses.confirmation ?? null }
      report.reuse = { analysis: COMPARISON, review: source, reviewRequestSha256: paidStages.review!.requestSha256, confirmation: paidStages.confirmation ? source : null }
    } else report.reuse = { analysis: COMPARISON, review: null, confirmation: null }
    const seededAt = new Date()
    const claim = await overlay.claimAnalysis({ organizationId: org, kind: "CALL_ANALYSIS", analysisKey: keys.analysisKey, personId: person.id, interactionId, indicatorDefinitionId: null, periodStart: null, periodEnd: null, agentId: frozen.agent.id, trigger: { kind: "EVALUATION", selectionReason: `Rodada V12 (${key}): análise paga da comparação de contratos (V10), reaproveitada.` }, logicVersion: "seed", asOf: seededAt }, seededAt, 60)
    if (claim.kind !== "CLAIMED") throw new Error(`${key}: semente da análise não pôde ser criada.`)
    await overlay.suspendCallAnalysis(org, claim.runId, {
      error: "REVIEW_PENDING:COMPARISON_PROPOSALS",
      checkpoint: { version: CALL_ANALYSIS_CHECKPOINT_VERSION, stage: "REVIEW_PENDING", proposalKey: keys.proposalKey, reason: "TECHNICAL", error: "PAID_COMPARISON_PROPOSALS", reviewAttempts: 0, since: seededAt.toISOString(), lastAttemptAt: seededAt.toISOString() },
      provenance: { proposalKey: keys.proposalKey, modelResponses: { analysis: { requestSha256: sha(`${OBLIGATION_ANALYSIS_SYSTEM_PROMPT}\n${comparisonUserTurn}`), text }, review: paidStages.review, ...(paidStages.confirmation ? { confirmation: paidStages.confirmation } : {}) }, seededFrom: COMPARISON },
      metrics: {},
    }, seededAt)
    report.seed = { key, interactionId, proposalKey: keys.proposalKey, analysisKey: keys.analysisKey, comparisonResponseSha256: sha(text) }
    const reason = key === "A" ? "Avaliação real V12 (cenário A): contestação de cobrança após cancelamento." : "Avaliação real V12 (cenário B): segunda via com argumentário aplicável."
    if (stage === "A-verify") {
      const composeSource = paidOf("A-compose")[0]
      if (!composeSource) throw new Error("A-verify exige a A-compose paga (o rascunho a verificar).")
      const paidCompose = JSON.parse(readFileSync(join(resultsDir, composeSource), "utf8")) as { responses: { stage: string; tag: string | null; text: string | null }[] }
      const draftText = paidCompose.responses.find((entry) => entry.stage === "COMPOSITION" && entry.tag === "draft")?.text
      if (!draftText) throw new Error(`${composeSource}: sem o rascunho pago.`)
      // Brief refeito pelo código atual (redator bloqueado → a geração abstém, mas o brief fica no registro da mensagem).
      const result = await generateFeedback(deps, { organizationId: org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "round-v12-A-verify", sourceNodeId: "round-v12-analysis-A", domain: "MONITORING", sourceNodeOutput: null, collaboratorId: person.id, interactionId, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: reason, now: new Date() })
      const record = result.messageId ? await stores.getMessage(org, result.messageId) : null
      const brief = record?.brief as FeedbackBrief | null | undefined
      if (!brief) throw new Error(`Brief não montado (${record?.abstainReason ?? "sem registro"}).`)
      const parsed = parseWriterDraft(draftText)
      if (!parsed.ok) throw new Error(`Rascunho pago ilegível: ${parsed.error}`)
      const sentenceClaims = [...parsed.draft.sentences.map((sentence, index) => ({ id: `F${index + 1}`, text: sentence.text, stance: sentence.stance, refs: sentence.refs })), { id: "CARD", text: parsed.draft.card.text, stance: "CONTEXT", refs: parsed.draft.card.refs }]
      const claims = [...sentenceClaims, ...analysisClaimsOf(brief)]
      verifyPhase = true
      const response = await model.generate({ stage: "VERIFICATION", systemPrompt: VERIFICATION_SYSTEM_PROMPT, contents: [{ role: "user", text: renderVerificationUserTurn(brief, claims) }], responseSchema: VERIFICATION_RESPONSE_SCHEMA, tag: "reverify:paid-draft" })
      verifyPhase = false
      const verdicts = parseVerdicts(response.text, sentenceClaims.map((claim) => claim.id))
      report.reverification = { draftFrom: composeSource, draftSha256: sha(draftText), claims: sentenceClaims, coverageLimits: brief.coverageLimits ?? null, verdicts: verdicts.ok ? Object.fromEntries(verdicts.verdicts) : null, message: verdicts.ok ? verdicts.message : null, parseError: verdicts.ok ? null : verdicts.error }
    } else if (stage === "A-compose") {
      try {
        const result = await generateFeedback(deps, { organizationId: org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "round-v12-A", sourceNodeId: "round-v12-analysis-A", domain: "MONITORING", sourceNodeOutput: null, collaboratorId: person.id, interactionId, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: reason, now: new Date() })
        const record = result.messageId ? await stores.getMessage(org, result.messageId) : null
        report.generation = { kind: result.kind, messageId: result.messageId, status: record?.status ?? null, abstainReason: record?.abstainReason ?? null, heading: record?.message?.view?.heading ?? null, card: record?.message?.card ?? null, text: record?.message?.text ?? null, brief: record?.brief ?? null, composition: record?.composition ?? null }
      } catch (error) {
        report.generation = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
      }
    } else {
      try {
        const analyzed = await analyzeCall(deps.analyze, { organizationId: org, interactionId, collaboratorId: person.id, agentId: frozen.agent.id, trigger: { kind: "EVALUATION", selectionReason: reason } })
        report.analyzed = { runId: analyzed.runId, reused: analyzed.reused, outcome: analyzed.outcome, outcomeReasons: analyzed.outcomeReasons }
      } catch (error) {
        report.analyzed = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
      }
      // Respostas cruas (com a assinatura do pedido) para a etapa de redação reaproveitar — nunca vão a nenhuma tela.
      const stagesNow = await overlay.findStageResponses(org, { interactionId, proposalKey: keys.proposalKey, legacyAnalysisKeys: [] })
      const latest = stagesNow.find((entry) => entry.review) ?? null
      report.stageResponses = { review: latest?.review ?? null, confirmation: latest?.confirmation ?? null }
    }
    report.analysis = analysisDetail(interactionId)
  } else {
    // C: só o planejador; nenhuma análise de chamada nova (configuração explícita), sem redação.
    const investigate = deps.investigate as { maxCallAnalyses?: number; maxPlanningRounds?: number }
    investigate.maxCallAnalyses = 0
    investigate.maxPlanningRounds = cap
    report.investigationConfig = { maxCallAnalyses: 0, maxPlanningRounds: cap, why: "a pergunta é o comportamento do planejador com as ferramentas sem IA oferecidas; análise de chamada nova não está em jogo" }
    try {
      const investigated = await investigateIndicator(deps.investigate, { organizationId: org, personId: person.id, agentId: frozen.agent.id, agentConfiguredAt: frozen.agent.updatedAt.toISOString(), enrollmentId: null, target: { kind: "OFFICIAL_CLOSING", indicatorCode: INDICATOR.code, referencePeriod: INDICATOR.referencePeriod }, trigger: { kind: "EVALUATION", selectionReason: "Avaliação real V12 (cenário C): TMA de agosto/2026." }, now: new Date() })
      const stored = await Promise.all(investigated.investigations.map((entry) => stores.getIndicatorInvestigationByRun(org, entry.runId)))
      report.investigation = { refs: investigated, stored: stored.map((entry) => entry?.investigation ?? null) }
    } catch (error) {
      report.investigation = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
    }
  }
  report.isolation = { otherCollaboratorsAnalyzed: overlay.assessments.filter((entry) => entry.snapshot.personId !== person.id).length, messages: overlay.messages.size, persisted: "NONE (banco somente leitura; memória e mensagens em RAM)" }
  report.meter = deps.meter.summary()
} catch (error) {
  report.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
} finally {
  if (opened) report.budget = { ledger: opened.budget.ledger, globalAfter: opened.persist() }
  await pool.end()
}
report.requests = requests.map((entry) => ({ stage: entry.stage, tag: entry.tag, chars: entry.chars, estimatedInputTokens: Math.ceil(entry.chars / 3) }))
report.responses = responses
const out = join(resultsDir, `round-v12-${stage}-${execute ? "paid" : "dry-run"}-${stamp}.json`)
writeFileSync(out, JSON.stringify(report, null, 2))
writeFileSync(out.replace(/\.json$/, ".prompts.json"), JSON.stringify(requests, null, 2))
console.log(JSON.stringify({ kind: report.kind, stage, error: report.error ?? null, requests: report.requests, budget: (report.budget as { globalAfter?: unknown } | undefined)?.globalAfter ?? null }, null, 2))
console.log(`\nArtefato: ${out}`)
