/**
 * RODADA V13 (02/10/2026) — Larissa Monteiro (DEMO-OP-0001) apenas, contra `round-v13-criteria.md` (registrado antes). Livro-razão
 * PRÓPRIO (`round-v13-budget.ts`: 24 requisições e US$ 1,20 para os dois cenários; V8–V12 e a linha de base intocados).
 *
 * Cenários (`--scenario`):
 *   A — C07: pipeline COMPLETO com análise NOVA (prompt V9) → revisão → confirmação → redação → verificação (+ reparo/coerência).
 *   C — TMA de agosto/2026: investigação com ferramentas (planejador, consultas, até 2 análises de chamadas da própria pessoa, grupo de
 *       referência pela memória existente) → "Gerar feedback" com as boas práticas dos colegas.
 *   C-compose — (decisões 1 e 3 de `round-v13-decisions.md`) a investigação do C REPRODUZIDA com as respostas PAGAS do planejador e
 *       da análise/revisão (mesmo pedido, conferido byte a byte; pedido diferente = recusa, nada enviado) e o código atual montando a
 *       evidência e o brief; só redação + verificação (+ reescrita se o código pedir) vão ao modelo.
 *
 * Sem `--execute` é ENSAIO: nada sai para o provedor (o modelo responde com erro, o motor segue pelo caminho sem IA) e o artefato
 * mostra o que dá para ver sem custo (no C: a investigação sem IA e o brief que iria ao redator). O ensaio grava o congelamento só se
 * ele ainda não existir (`--refreeze` sobrescreve — registrar). Cada cenário pago roda uma vez só. Isolamento: banco SOMENTE LEITURA;
 * memória e mensagens em RAM; nada publicado, entregue, notificado ou gravado.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/evaluate-round-v13.ts --scenario C
 *   npx tsx scripts/feedback-engine/evaluation/larissa/evaluate-round-v13.ts --scenario C --execute --authorized-by-user
 */
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { generateForRoute } from "../../../../src/shared/application/model-routing/llm-gateway.js"
import { DEFAULT_ENGINE_BUDGET, type EngineBudgetLimits } from "../../../../src/modules/feedback-engine/application/engine-meter.js"
import { createEngineDeps } from "../../../../src/modules/feedback-engine/application/engine-wiring.js"
import { generateFeedback } from "../../../../src/modules/feedback-engine/application/generate-feedback.js"
import { investigateIndicator } from "../../../../src/modules/feedback-engine/application/investigate-indicator.js"
import type { EngineModelPort, EngineModelResponse } from "../../../../src/modules/feedback-engine/application/ports.js"
import { buildIndicatorBrief } from "../../../../src/modules/feedback-engine/domain/indicator-brief.js"
import { INDICATOR_ANALYSIS_NODE_OUTPUT_KIND, type IndicatorAnalysisNodeOutput } from "../../../../src/modules/feedback-engine/domain/node-output.js"
import { OBLIGATION_ANALYSIS_PROMPT_VERSION } from "../../../../src/modules/feedback-engine/domain/obligation-analysis-prompt.js"
import { OBLIGATION_REVIEW_PROMPT_VERSION, OBLIGATION_REVIEW_VERSION } from "../../../../src/modules/feedback-engine/domain/obligation-review.js"
import { CALL_ANALYSIS_LOGIC_VERSION, COMPOSITION_PROMPT_VERSION, COMPOSITION_VERSION, INDICATOR_INVESTIGATION_LOGIC_VERSION, VERIFICATION_PROMPT_VERSION } from "../../../../src/modules/feedback-engine/domain/versions.js"
import { ENGINE_INVESTIGATION_TOOLS_VERSION, ENGINE_PLANNER_PROMPT_VERSION, INVESTIGATION_CLOSURE_VERSION } from "../../../../src/modules/feedback-engine/domain/investigation-toolbox.js"
import type { InvestigationCapability } from "../../../../src/modules/investigation/domain/capabilities.js"
import { createGatewayEngineModel, ENGINE_MODEL } from "../../../../src/modules/feedback-engine/infrastructure/gateway-engine-model.js"
import { createInMemoryFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { createPostgresFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { attachmentArgumentScripts } from "./attachment-argument-scripts.js"
import { loadFrozenSources } from "./frozen-call.js"
import { openRoundV13Budget, readRoundV13Ledger, roundV13Totals, ROUND_V13_LIMITS } from "./round-v13-budget.js"

const here = dirname(fileURLToPath(import.meta.url))
const SCENARIOS = ["A", "C", "C-compose"] as const
type Scenario = (typeof SCENARIOS)[number]
const scenarioArg = process.argv[process.argv.indexOf("--scenario") + 1] as Scenario | undefined
if (!process.argv.includes("--scenario") || !scenarioArg || !SCENARIOS.includes(scenarioArg)) throw new Error(`--scenario obrigatório: ${SCENARIOS.join(" | ")}`)
const scenario: Scenario = scenarioArg
const execute = process.argv.includes("--execute")
if (execute && !process.argv.includes("--authorized-by-user")) throw new Error("Cenário pago só com autorização registrada (--authorized-by-user).")
const resultsDir = join(here, "results")
const paidOf = (name: Scenario) => readdirSync(resultsDir).filter((file) => file.startsWith(`round-v13-${name}-paid-`) && file.endsWith(".json") && !file.endsWith(".prompts.json")).sort()
if (execute && paidOf(scenario).length > 0) throw new Error(`Cenário ${scenario} já executado (${paidOf(scenario)[0]}): não repita para escolher outro resultado.`)

const INDICATOR = { code: "TMA", referencePeriod: "2026-08" }
const CAPABILITIES: InvestigationCapability[] = ["INDICATOR_ANALYSIS", "SEGMENTATION", "INTERACTION_ANALYSIS", "KNOWLEDGE", "OPERATIONAL_COMPARISON"]
/** Teto de chamadas de modelo por cenário (o livro-razão global continua sendo o limite final). */
const SCENARIO_CAP: Record<Scenario, number> = { A: 9, C: 15, "C-compose": 4 }
const C_MAX_CALL_ANALYSES = 2
const CRITERIA = join(here, "round-v13-criteria.md")
const sha = (value: string) => createHash("sha256").update(value).digest("hex")

// CONGELAMENTO do código e dos critérios: hash de cada arquivo que decide algo nesta rodada.
const backendRoot = join(here, "..", "..", "..", "..")
const FREEZE_FILE = join(resultsDir, "round-v13-freeze.json")
const FROZEN_DIRS = ["src/modules/feedback-engine", "src/modules/knowledge", "src/modules/investigation/domain", "src/modules/investigation/application", "src/shared/application/model-routing", "src/shared/application/prompting"]
function listFiles(dir: string): string[] {
  return readdirSync(join(backendRoot, dir), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [join(dir, entry.name)] : []))
}
const harnessFiles = ["evaluate-round-v13.ts", "round-v13-budget.ts", "round-v13-criteria.md", "round-v13-decisions.md"].map((file) => `scripts/feedback-engine/evaluation/larissa/${file}`)
const freezeManifest = () => Object.fromEntries([...FROZEN_DIRS.flatMap(listFiles), ...harnessFiles].sort().map((file) => [file, sha(readFileSync(join(backendRoot, file), "utf8"))]))
const currentFreeze = freezeManifest()
if (execute) {
  if (!existsSync(FREEZE_FILE)) throw new Error("Cenário pago sem congelamento: rode o ensaio antes (grava round-v13-freeze.json).")
  const frozenFiles = (JSON.parse(readFileSync(FREEZE_FILE, "utf8")) as { files: Record<string, string> }).files
  const changed = [...new Set([...Object.keys(frozenFiles), ...Object.keys(currentFreeze)])].filter((file) => frozenFiles[file] !== currentFreeze[file])
  if (changed.length > 0) throw new Error(`Código/critérios mudaram depois do congelamento: ${changed.join(", ")}`)
} else if (!existsSync(FREEZE_FILE) || process.argv.includes("--refreeze")) writeFileSync(FREEZE_FILE, JSON.stringify({ frozenAt: new Date().toISOString(), files: currentFreeze }, null, 2))

const realFetch = globalThis.fetch
if (!execute) globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (ROUND_V13_LIMITS.hostPattern.test(url) || /anthropic|openai|x\.ai/.test(url)) throw new Error(`ENSAIO: requisição a ${new URL(url).host} bloqueada.`)
  return realFetch(input, init)
}) as typeof fetch

const readDb = createReadOnlyDatabase(pool)
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const globalBefore = roundV13Totals(readRoundV13Ledger())
const report: Record<string, unknown> = {
  kind: execute ? "PAID_ROUND_V13_SCENARIO" : "DRY_RUN_V13_SCENARIO",
  scenario,
  ranAt: new Date().toISOString(),
  model: ENGINE_MODEL,
  globalBudget: { limits: { maxRequests: ROUND_V13_LIMITS.maxRequests, maxUsd: ROUND_V13_LIMITS.maxUsd }, before: globalBefore },
  scenarioCap: SCENARIO_CAP[scenario],
  criteria: { file: "round-v13-criteria.md", sha256: sha(readFileSync(CRITERIA, "utf8")), registeredBeforeExecution: true, sentToEngine: false },
  freeze: { file: "round-v13-freeze.json", manifestSha256: sha(JSON.stringify(currentFreeze)), files: Object.keys(currentFreeze).length },
  versions: { analysisLogic: CALL_ANALYSIS_LOGIC_VERSION, analysisPrompt: OBLIGATION_ANALYSIS_PROMPT_VERSION, review: OBLIGATION_REVIEW_VERSION, reviewPrompt: OBLIGATION_REVIEW_PROMPT_VERSION, composition: COMPOSITION_VERSION, compositionPrompt: COMPOSITION_PROMPT_VERSION, verificationPrompt: VERIFICATION_PROMPT_VERSION, investigation: INDICATOR_INVESTIGATION_LOGIC_VERSION, investigationTools: ENGINE_INVESTIGATION_TOOLS_VERSION, plannerPrompt: ENGINE_PLANNER_PROMPT_VERSION, closure: INVESTIGATION_CLOSURE_VERSION },
  isolatedConfiguration: { capabilities: CAPABILITIES, peerComparison: "LIGADA só nesta execução (a estratégia publicada do TMA está desligada)", peerCallAnalyses: false, maxCallAnalyses: scenario === "C" ? C_MAX_CALL_ANALYSES : null, persisted: "INTOCADO (perfil do agente e estratégia substituídos só na memória deste processo)" },
}
const requests: { stage: string; tag: string | null; chars: number; text: string }[] = []
const responses: { stage: string; tag: string | null; text: string | null; error: string | null; usage: unknown; finishReason: string | null }[] = []
const opened = execute ? openRoundV13Budget(`evaluate-round-v13:${scenario}`, realFetch) : null
if (opened) globalThis.fetch = opened.budget.fetch
const remainingRequests = opened ? opened.remaining.maxRequests : ROUND_V13_LIMITS.maxRequests - globalBefore.requests
const remainingUsd = opened ? opened.remaining.maxUsd : ROUND_V13_LIMITS.maxUsd - globalBefore.spentUsd
try {
  const frozen = await loadFrozenSources(readDb, "C07")
  const org = frozen.org
  const person = frozen.person
  const overlay = createInMemoryFeedbackMemoryStore()
  const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(readDb), overlay)
  const real = createGatewayEngineModel({ generate: (request) => generateForRoute({ ...request, transport: { ...request.transport, retries: 0 } }) })
  // C-compose: respostas PAGAS do cenário C para tudo que não é redação — na mesma ordem e só com o MESMO pedido.
  const REPLAYED_STAGES = new Set(["INVESTIGATION_PLANNING", "CALL_ANALYSIS", "CALL_REVIEW", "CALL_CONFIRMATION"])
  const replay = scenario === "C-compose" ? (() => {
    const source = paidOf("C")[0]
    if (!source) throw new Error("C-compose precisa do cenário C pago.")
    const paidResponses = (JSON.parse(readFileSync(join(resultsDir, source), "utf8")) as { responses: { stage: string; tag: string | null; text: string | null; usage: EngineModelResponse["usage"]; finishReason: string | null }[] }).responses
    const paidPrompts = JSON.parse(readFileSync(join(resultsDir, source.replace(/\.json$/, ".prompts.json")), "utf8")) as { stage: string; tag: string | null; text: string }[]
    const queue = paidPrompts.map((prompt, index) => ({ ...prompt, response: paidResponses[index]!, used: false })).filter((entry) => REPLAYED_STAGES.has(entry.stage))
    report.replay = { from: source, available: queue.map((entry) => `${entry.stage}:${entry.tag}`) }
    return queue
  })() : null
  const replayLog: { stage: string; tag: string | null; matched: boolean }[] = []
  const model: EngineModelPort = {
    async generate(request) {
      const text = [request.systemPrompt, ...request.contents.map((turn) => turn.text)].join("\n\n")
      if (replay && REPLAYED_STAGES.has(request.stage)) {
        const next = replay.find((entry) => !entry.used && entry.stage === request.stage && entry.tag === (request.tag ?? null))
        const matched = Boolean(next && next.text === text && next.response.text)
        replayLog.push({ stage: request.stage, tag: request.tag ?? null, matched })
        report.replayLog = replayLog
        if (!next || !matched) throw Object.assign(new Error(`REPLAY_MISMATCH: ${request.stage}:${request.tag} — o pedido difere do pago (nada enviado).`), { name: "ReplayMismatch" })
        next.used = true
        return { text: next.response.text!, model: ENGINE_MODEL, usage: next.response.usage, durationMs: 0, costUsd: 0, finishReason: next.response.finishReason }
      }
      // Teto das requisições REAIS do C-compose (as reproduzidas não saem para a rede nem entram no livro-razão).
      if (scenario === "C-compose" && requests.length >= SCENARIO_CAP["C-compose"]) throw Object.assign(new Error("C-compose: teto de requisições reais atingido (nada enviado)."), { name: "ScenarioCap" })
      requests.push({ stage: request.stage, tag: request.tag ?? null, chars: text.length, text })
      if (!execute) {
        responses.push({ stage: request.stage, tag: request.tag ?? null, text: null, error: "ENSAIO: pedido medido, não enviado", usage: null, finishReason: null })
        throw Object.assign(new Error("ENSAIO: pedido medido, não enviado."), { name: "DryRunStop" })
      }
      opened!.budget.setLabel(`V13 ${scenario} · ${request.stage}${request.tag ? `:${request.tag}` : ""}`)
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
  const cap = Math.max(0, Math.min(SCENARIO_CAP[scenario], remainingRequests))
  if (cap === 0) throw new Error(`Cenário ${scenario} não cabe: ${remainingRequests} requisição(ões) restante(s) — não iniciado.`)
  // C-compose: o MESMO orçamento do motor do C pago (as respostas reproduzidas passam pelo medidor como na execução original, para os
  // pedidos do planejador saírem idênticos); o limite real é o teto de requisições reais e o livro-razão.
  const engineBudget: EngineBudgetLimits = scenario === "C-compose"
    ? { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: SCENARIO_CAP.C, maxCostUsd: Math.max(0, remainingUsd), transientRetries: 0 }
    : { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: execute ? cap : DEFAULT_ENGINE_BUDGET.maxModelCalls, maxCostUsd: Math.max(0, remainingUsd), transientRetries: 0 }
  report.engineBudget = { maxModelCalls: engineBudget.maxModelCalls, maxCostUsd: engineBudget.maxCostUsd, transientRetries: 0, compositionReserve: engineBudget.compositionReserve ?? null }
  const deps = createEngineDeps({ db: readDb, stores, model, peerCallAnalyses: false, allowCollaborator: (id) => id === person.id, budget: engineBudget, price: { inputPerMillion: ROUND_V13_LIMITS.pricePerMillion.input, outputPerMillion: ROUND_V13_LIMITS.pricePerMillion.output } })
  const scripts = attachmentArgumentScripts()
  deps.analyze.loadArgumentScripts = async () => scripts
  const loadAgent = deps.analyze.loadAgent
  deps.analyze.loadAgent = async (organizationId, agentId) => {
    const profile = await loadAgent(organizationId, agentId)
    return profile && agentId === frozen.agent.id ? { ...profile, investigationCapabilities: [...CAPABILITIES] } : profile
  }
  const strategy = deps.investigate.strategy
  deps.investigate.strategy = async (organizationId, enrollmentId, indicatorId) => {
    const parameters = await strategy(organizationId, enrollmentId, indicatorId)
    return parameters.configured ? { ...parameters, peer: { ...parameters.peer, enabled: true } } : parameters
  }

  if (scenario === "A") {
    const interactionId = frozen.interaction.id
    try {
      const result = await generateFeedback(deps, { organizationId: org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "round-v13-A", sourceNodeId: "round-v13-analysis-A", domain: "MONITORING", sourceNodeOutput: null, collaboratorId: person.id, interactionId, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: "Avaliação real V13 (cenário A): C07 com análise nova.", now: new Date() })
      const record = await stores.getMessage(org, result.messageId)
      report.generation = { kind: result.kind, reason: result.kind === "ABSTAINED" ? result.reason : null, status: record?.status ?? null, abstainReason: record?.abstainReason ?? null, heading: record?.message?.view?.heading ?? null, card: record?.message?.card ?? null, text: record?.message?.text ?? null, brief: record?.brief ?? null, composition: record?.composition ?? null }
    } catch (error) {
      report.generation = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
    }
    const assessment = overlay.assessments.find((entry) => entry.isCurrent && entry.snapshot.interactionId === interactionId)
    report.analysis = assessment ? { outcome: assessment.analysis.outcome, scenario: assessment.analysis.scenario, criteria: assessment.analysis.criteria.map((criterion) => ({ handle: criterion.lineHandle, document: criterion.documentId ?? null, heading: criterion.heading ?? null, title: criterion.titleText ?? criterion.text.slice(0, 140), action: criterion.requiredAction ?? null, condition: criterion.condition ?? null, items: criterion.items ?? null, declared: criterion.declaredStatus, final: criterion.status, confirmation: criterion.confirmation, reasons: criterion.confirmationReasons, observability: criterion.observability ?? null, materiality: criterion.materiality, evidence: criterion.evidence.map((quote) => `${quote.turn} ${quote.speaker}: ${quote.quote}`), rationale: criterion.rationale })), coverage: (assessment.analysis as { coverage?: unknown }).coverage ?? null } : null
  } else {
    // C e C-compose: a mesma investigação (no C-compose, planejador e análise reproduzidos com as respostas pagas).
    const investigate = deps.investigate as { maxCallAnalyses?: number }
    investigate.maxCallAnalyses = C_MAX_CALL_ANALYSES
    try {
      const investigated = await investigateIndicator(deps.investigate, { organizationId: org, personId: person.id, agentId: frozen.agent.id, agentConfiguredAt: frozen.agent.updatedAt.toISOString(), enrollmentId: null, target: { kind: "OFFICIAL_CLOSING", indicatorCode: INDICATOR.code, referencePeriod: INDICATOR.referencePeriod }, trigger: { kind: "EVALUATION", selectionReason: "Avaliação real V13 (cenário C): TMA de agosto/2026." }, now: new Date() })
      const stored = await Promise.all(investigated.investigations.map((entry) => stores.getIndicatorInvestigationByRun(org, entry.runId)))
      const investigations = stored.flatMap((entry) => (entry ? [entry.investigation] : []))
      report.investigation = { refs: investigated, stored: investigations }
      report.briefPreview = investigations.map((investigation) => buildIndicatorBrief(investigation, { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false }))
      const sourceNodeOutput: IndicatorAnalysisNodeOutput = { kind: INDICATOR_ANALYSIS_NODE_OUTPUT_KIND, personId: person.id, agentId: frozen.agent.id, investigations: investigated.investigations.map((entry) => ({ analysisRunId: entry.runId, investigationId: entry.investigationId, indicatorCode: entry.indicatorCode, periodLabel: entry.periodLabel, conclusion: entry.conclusion, reused: entry.reused })), skippedReason: investigated.skippedReason, text: "" }
      const result = await generateFeedback(deps, { organizationId: org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "round-v13-C", sourceNodeId: "round-v13-agent-C", domain: "INDICATOR", sourceNodeOutput, collaboratorId: person.id, interactionId: null, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: "Avaliação real V13 (cenário C): TMA de agosto/2026.", now: new Date() })
      const record = await stores.getMessage(org, result.messageId)
      report.generation = { kind: result.kind, reason: result.kind === "ABSTAINED" ? result.reason : null, status: record?.status ?? null, abstainReason: record?.abstainReason ?? null, heading: record?.message?.view?.heading ?? null, card: record?.message?.card ?? null, text: record?.message?.text ?? null, brief: record?.brief ?? null, composition: record?.composition ?? null }
    } catch (error) {
      report.generation = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
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
const out = join(resultsDir, `round-v13-${scenario}-${execute ? "paid" : "dry-run"}-${stamp}.json`)
writeFileSync(out, JSON.stringify(report, null, 2))
writeFileSync(out.replace(/\.json$/, ".prompts.json"), JSON.stringify(requests, null, 2))
console.log(JSON.stringify({ kind: report.kind, scenario, error: report.error ?? null, generation: report.generation ? { kind: (report.generation as { kind?: string }).kind, reason: (report.generation as { reason?: string }).reason, error: (report.generation as { error?: string }).error } : null, requests: report.requests, budget: (report.budget as { globalAfter?: unknown } | undefined)?.globalAfter ?? null }, null, 2))
console.log(`\nArtefato: ${out}`)
