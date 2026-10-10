/**
 * VALIDAÇÃO V14D (05/10/2026; a V14B acabou o orçamento na redação) — o MESMO cenário e os MESMOS critérios da rodada V14 (`round-v14-criteria.md`), depois das correções
 * registradas em `round-v14-evaluation.md` (confirmação de padrão, cobertura da referência por prática, reincidência no ponto do caminho,
 * resolução das seções das situações). REPRODUÇÃO HÍBRIDA: todo pedido idêntico (byte a byte) a um pedido PAGO da V14 recebe a resposta
 * paga, sem custo; só pedidos NOVOS vão ao modelo. Livro-razão próprio (`round-v14d-budget.ts`: 8 requisições, US$ 0,15). Composição V12 (etapa reincidente é ponto próprio; prática dos colegas como P-n).
 *
 * Sem `--execute`: nada sai para o provedor — os pedidos novos são CONTADOS (com tamanho) e recusados; o restante segue como no ensaio.
 * Uma execução paga só. Banco somente leitura; memória e mensagens em RAM; nada publicado, entregue ou gravado.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/evaluate-round-v14d.ts
 *   npx tsx scripts/feedback-engine/evaluation/larissa/evaluate-round-v14d.ts --execute --authorized-by-user
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
import type { EngineModelPort } from "../../../../src/modules/feedback-engine/application/ports.js"
import { buildIndicatorBrief } from "../../../../src/modules/feedback-engine/domain/indicator-brief.js"
import { INDICATOR_ANALYSIS_NODE_OUTPUT_KIND, type IndicatorAnalysisNodeOutput } from "../../../../src/modules/feedback-engine/domain/node-output.js"
import { OBLIGATION_ANALYSIS_PROMPT_VERSION } from "../../../../src/modules/feedback-engine/domain/obligation-analysis-prompt.js"
import { OBLIGATION_REVIEW_PROMPT_VERSION, OBLIGATION_REVIEW_VERSION } from "../../../../src/modules/feedback-engine/domain/obligation-review.js"
import { FEEDBACK_FIRMNESS_VERSION } from "../../../../src/modules/feedback-engine/domain/firmness.js"
import { CALL_ANALYSIS_LOGIC_VERSION, COMPOSITION_PROMPT_VERSION, COMPOSITION_VERSION, INDICATOR_INVESTIGATION_LOGIC_VERSION, VERIFICATION_PROMPT_VERSION } from "../../../../src/modules/feedback-engine/domain/versions.js"
import { ENGINE_INVESTIGATION_TOOLS_VERSION, ENGINE_PLANNER_PROMPT_VERSION, INVESTIGATION_CLOSURE_VERSION } from "../../../../src/modules/feedback-engine/domain/investigation-toolbox.js"
import { createGatewayEngineModel, ENGINE_MODEL } from "../../../../src/modules/feedback-engine/infrastructure/gateway-engine-model.js"
import { createInMemoryFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { createPostgresFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { openRoundV14DBudget, readRoundV14DLedger, roundV14DTotals, ROUND_V14D_LIMITS } from "./round-v14d-budget.js"

const here = dirname(fileURLToPath(import.meta.url))
const execute = process.argv.includes("--execute")
if (execute && !process.argv.includes("--authorized-by-user")) throw new Error("Rodada paga só com autorização registrada (--authorized-by-user).")
const resultsDir = join(here, "results")
const paid = readdirSync(resultsDir).filter((file) => file.startsWith("round-v14d-paid-") && file.endsWith(".json") && !file.endsWith(".prompts.json")).sort()
if (execute && paid.length > 0) throw new Error(`Rodada V14D já executada (${paid[0]}): não repita para escolher outro resultado.`)

const LARISSA = "DEMO-OP-0001"
const AGENT_NAME = "Especialista de Faturamento"
const MONITORING_CALL = "SCENARIO-TMA-SET-L09"
const INDICATOR = { code: "TMA", referencePeriod: "2026-09" }
const MAX_PERSON_ANALYSES = 6
const MAX_PEER_ANALYSES = 6
const CRITERIA = join(here, "round-v14-criteria.md")
const sha = (value: string) => createHash("sha256").update(value).digest("hex")

// CONGELAMENTO do código e dos critérios.
const backendRoot = join(here, "..", "..", "..", "..")
const FREEZE_FILE = join(resultsDir, "round-v14d-freeze.json")
const FROZEN_DIRS = ["src/modules/feedback-engine", "src/modules/knowledge", "src/modules/investigation/domain", "src/modules/investigation/application", "src/shared/application/model-routing", "src/shared/application/prompting"]
function listFiles(dir: string): string[] {
  return readdirSync(join(backendRoot, dir), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [join(dir, entry.name)] : []))
}
const harnessFiles = ["evaluate-round-v14d.ts", "round-v14d-budget.ts", "round-v14-criteria.md"].map((file) => `scripts/feedback-engine/evaluation/larissa/${file}`)
const freezeManifest = () => Object.fromEntries([...FROZEN_DIRS.flatMap(listFiles), ...harnessFiles].sort().map((file) => [file, sha(readFileSync(join(backendRoot, file), "utf8"))]))
const currentFreeze = freezeManifest()
if (execute) {
  if (!existsSync(FREEZE_FILE)) throw new Error("Rodada paga sem congelamento: rode o ensaio antes (grava round-v14d-freeze.json).")
  const frozenFiles = (JSON.parse(readFileSync(FREEZE_FILE, "utf8")) as { files: Record<string, string> }).files
  const changed = [...new Set([...Object.keys(frozenFiles), ...Object.keys(currentFreeze)])].filter((file) => frozenFiles[file] !== currentFreeze[file])
  if (changed.length > 0) throw new Error(`Código/critérios mudaram depois do congelamento: ${changed.join(", ")}`)
} else if (!existsSync(FREEZE_FILE) || process.argv.includes("--refreeze")) writeFileSync(FREEZE_FILE, JSON.stringify({ frozenAt: new Date().toISOString(), files: currentFreeze }, null, 2))

const realFetch = globalThis.fetch
if (!execute) globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (ROUND_V14D_LIMITS.hostPattern.test(url) || /anthropic|openai|x\.ai/.test(url)) throw new Error(`ENSAIO: requisição a ${new URL(url).host} bloqueada.`)
  return realFetch(input, init)
}) as typeof fetch

const readDb = createReadOnlyDatabase(pool)
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const globalBefore = roundV14DTotals(readRoundV14DLedger())
const report: Record<string, unknown> = {
  kind: execute ? "PAID_ROUND_V14D" : "DRY_RUN_V14D",
  ranAt: new Date().toISOString(),
  model: ENGINE_MODEL,
  globalBudget: { limits: { maxRequests: ROUND_V14D_LIMITS.maxRequests, maxUsd: ROUND_V14D_LIMITS.maxUsd }, before: globalBefore },
  criteria: { file: "round-v14-criteria.md", sha256: sha(readFileSync(CRITERIA, "utf8")), registeredBeforeExecution: true, sentToEngine: false },
  freeze: { file: "round-v14d-freeze.json", manifestSha256: sha(JSON.stringify(currentFreeze)), files: Object.keys(currentFreeze).length },
  versions: { analysisLogic: CALL_ANALYSIS_LOGIC_VERSION, analysisPrompt: OBLIGATION_ANALYSIS_PROMPT_VERSION, review: OBLIGATION_REVIEW_VERSION, reviewPrompt: OBLIGATION_REVIEW_PROMPT_VERSION, composition: COMPOSITION_VERSION, compositionPrompt: COMPOSITION_PROMPT_VERSION, verificationPrompt: VERIFICATION_PROMPT_VERSION, investigation: INDICATOR_INVESTIGATION_LOGIC_VERSION, investigationTools: ENGINE_INVESTIGATION_TOOLS_VERSION, plannerPrompt: ENGINE_PLANNER_PROMPT_VERSION, closure: INVESTIGATION_CLOSURE_VERSION, firmness: FEEDBACK_FIRMNESS_VERSION },
  configuration: { source: "PRODUÇÃO (especialista e estratégia publicada como estão no banco)", maxPersonAnalyses: MAX_PERSON_ANALYSES, maxPeerAnalyses: MAX_PEER_ANALYSES, persisted: "NADA (banco somente leitura; memória e mensagens em RAM)" },
}
// Respostas PAGAS da V14 por pedido idêntico (texto completo do pedido: sistema + turnos). Cada resposta é usada uma vez.
// Respostas pagas da V14 E da V14B (a V14B gravou em `responses` só os pedidos NOVOS — os reaproveitados vieram da V14).
const PAID_SOURCES = ["round-v14-paid-2026-10-02T22-34-25-430Z.json", "round-v14b-paid-2026-10-05T13-11-43-267Z.json", "round-v14c-paid-2026-10-05T13-20-34-795Z.json"]
const V14_PAID = PAID_SOURCES.join(" + ")
const replayPool = PAID_SOURCES.flatMap((file) => {
  const paid = JSON.parse(readFileSync(join(resultsDir, file), "utf8")) as { responses: { stage: string; tag: string | null; text: string | null; usage: unknown; finishReason: string | null }[] }
  const prompts = JSON.parse(readFileSync(join(resultsDir, file.replace(/\.json$/, ".prompts.json")), "utf8")) as { stage: string; tag: string | null; text: string }[]
  return prompts.map((prompt, index) => ({ ...prompt, response: paid.responses[index]!, used: false })).filter((entry) => entry.response?.text)
})
const replayLog: { stage: string; tag: string | null; replayed: boolean; chars: number }[] = []
const requests: { stage: string; tag: string | null; chars: number; text: string }[] = []
const responses: { stage: string; tag: string | null; text: string | null; error: string | null; usage: unknown; finishReason: string | null }[] = []
const opened = execute ? openRoundV14DBudget("evaluate-round-v14d", realFetch) : null
if (opened) globalThis.fetch = opened.budget.fetch
const remainingRequests = opened ? opened.remaining.maxRequests : ROUND_V14D_LIMITS.maxRequests - globalBefore.requests
const remainingUsd = opened ? opened.remaining.maxUsd : ROUND_V14D_LIMITS.maxUsd - globalBefore.spentUsd
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error))
try {
  const person = (await readDb.query<{ id: string; organization_id: string; subteam_id: string | null; name: string }>(`select id, organization_id, subteam_id, name from people where matricula = $1`, [LARISSA])).rows[0]
  if (!person) throw new Error("Larissa não encontrada.")
  const org = person.organization_id
  const agent = (await readDb.query<{ id: string; updated_at: Date }>(`select id, updated_at from agents where organization_id = $1 and name = $2`, [org, AGENT_NAME])).rows[0]
  if (!agent) throw new Error("Especialista não encontrado.")
  const subteam = new Set((await readDb.query<{ id: string }>(`select id from people where organization_id = $1 and subteam_id = $2`, [org, person.subteam_id])).rows.map((row) => row.id))
  const monitoringCall = (await readDb.query<{ id: string; started_at: Date }>(`select id, started_at from interactions where organization_id = $1 and external_id = $2 and operator_id = $3`, [org, MONITORING_CALL, person.id])).rows[0]
  if (!monitoringCall) throw new Error("Chamada da monitoria não encontrada.")
  report.subject = { person: person.id, agent: agent.id, subteamSize: subteam.size, monitoringCall: { id: monitoringCall.id, externalId: MONITORING_CALL, startedAt: monitoringCall.started_at } }

  const overlay = createInMemoryFeedbackMemoryStore()
  const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(readDb), overlay)
  const real = createGatewayEngineModel({ generate: (request) => generateForRoute({ ...request, transport: { ...request.transport, retries: 0 } }) })
  const model: EngineModelPort = {
    async generate(request) {
      const text = [request.systemPrompt, ...request.contents.map((turn) => turn.text)].join("\n\n")
      const stored = replayPool.find((entry) => !entry.used && entry.stage === request.stage && entry.text === text)
      replayLog.push({ stage: request.stage, tag: request.tag ?? null, replayed: Boolean(stored), chars: text.length })
      if (stored) {
        stored.used = true
        return { text: stored.response.text!, model: ENGINE_MODEL, usage: stored.response.usage as never, durationMs: 0, costUsd: 0, finishReason: stored.response.finishReason }
      }
      requests.push({ stage: request.stage, tag: request.tag ?? null, chars: text.length, text })
      if (!execute) {
        responses.push({ stage: request.stage, tag: request.tag ?? null, text: null, error: "ENSAIO: pedido medido, não enviado", usage: null, finishReason: null })
        throw Object.assign(new Error("ENSAIO: pedido medido, não enviado."), { name: "DryRunStop" })
      }
      opened!.budget.setLabel(`V14D · ${request.stage}${request.tag ? `:${request.tag}` : ""}`)
      try {
        const response = await real.generate(request)
        responses.push({ stage: request.stage, tag: request.tag ?? null, text: response.text, error: null, usage: response.usage ?? null, finishReason: response.finishReason })
        return response
      } catch (error) {
        responses.push({ stage: request.stage, tag: request.tag ?? null, text: null, error: describe(error), usage: null, finishReason: null })
        throw error
      }
    },
  }
  const cap = Math.max(0, remainingRequests)
  if (cap === 0) throw new Error("Orçamento esgotado — não iniciado.")
  // As respostas reaproveitadas passam pelo medidor do motor (com o uso gravado) mas não custam; o limite REAL de gasto é a trava de rede
  // do livro-razão (só pedidos novos saem).
  // O saldo de chamadas entra no pedido do planejador ("modelCallsLeft"): o teto do motor é o MESMO da V14 (44) para os pedidos que não
  // mudaram coincidirem byte a byte.
  const engineBudget: EngineBudgetLimits = { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: 44, maxCostUsd: null, transientRetries: 0 }
  report.engineBudget = { maxModelCalls: engineBudget.maxModelCalls, maxCostUsd: engineBudget.maxCostUsd, transientRetries: 0, compositionReserve: engineBudget.compositionReserve ?? null }
  const deps = createEngineDeps({ db: readDb, stores, model, maxCallAnalyses: MAX_PERSON_ANALYSES, allowCollaborator: (id) => id === person.id || subteam.has(id), budget: engineBudget, price: { inputPerMillion: ROUND_V14D_LIMITS.pricePerMillion.input, outputPerMillion: ROUND_V14D_LIMITS.pricePerMillion.output } })
  ;(deps.investigate as { maxPeerCallAnalyses?: number }).maxPeerCallAnalyses = MAX_PEER_ANALYSES

  // ---------------------------------------------------------------- C — TMA de setembro/2026
  const stage = (name: string) => ({ name, requestsBefore: requests.length })
  const cStage = stage("C")
  try {
    const investigated = await investigateIndicator(deps.investigate, { organizationId: org, personId: person.id, agentId: agent.id, agentConfiguredAt: agent.updated_at.toISOString(), enrollmentId: null, target: { kind: "OFFICIAL_CLOSING", indicatorCode: INDICATOR.code, referencePeriod: INDICATOR.referencePeriod }, trigger: { kind: "EVALUATION", selectionReason: "Avaliação real V14 (C): TMA de setembro/2026." }, now: new Date() })
    const stored = await Promise.all(investigated.investigations.map((entry) => stores.getIndicatorInvestigationByRun(org, entry.runId)))
    const investigations = stored.flatMap((entry) => (entry ? [entry.investigation] : []))
    report.investigation = { refs: investigated, stored: investigations }
    report.briefPreview = investigations.map((investigation) => buildIndicatorBrief(investigation, { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false }))
    const sourceNodeOutput: IndicatorAnalysisNodeOutput = { kind: INDICATOR_ANALYSIS_NODE_OUTPUT_KIND, personId: person.id, agentId: agent.id, investigations: investigated.investigations.map((entry) => ({ analysisRunId: entry.runId, investigationId: entry.investigationId, indicatorCode: entry.indicatorCode, periodLabel: entry.periodLabel, conclusion: entry.conclusion, reused: entry.reused })), skippedReason: investigated.skippedReason, text: "" }
    const result = await generateFeedback(deps, { organizationId: org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "round-v14-C", sourceNodeId: "round-v14-agent-C", domain: "INDICATOR", sourceNodeOutput, collaboratorId: person.id, interactionId: null, indicatorMeasurementId: null, configuredAgentId: agent.id, selectionReason: "Avaliação real V14 (C): TMA de setembro/2026.", now: new Date() })
    const record = await stores.getMessage(org, result.messageId)
    report.C = { requests: requests.length - cStage.requestsBefore, kind: result.kind, reason: result.kind === "ABSTAINED" ? result.reason : null, status: record?.status ?? null, abstainReason: record?.abstainReason ?? null, heading: record?.message?.view?.heading ?? null, card: record?.message?.card ?? null, text: record?.message?.text ?? null, brief: record?.brief ?? null, composition: record?.composition ?? null }
  } catch (error) {
    report.C = { requests: requests.length - cStage.requestsBefore, error: describe(error) }
  }

  // ---------------------------------------------------------------- A — monitoria da L09, na mesma memória
  const aStage = stage("A")
  try {
    const result = await generateFeedback(deps, { organizationId: org, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "round-v14-A", sourceNodeId: "round-v14-analysis-A", domain: "MONITORING", sourceNodeOutput: null, collaboratorId: person.id, interactionId: monitoringCall.id, indicatorMeasurementId: null, configuredAgentId: agent.id, selectionReason: "Avaliação real V14 (A): L09 com erro de regra vigente.", now: new Date() })
    const record = await stores.getMessage(org, result.messageId)
    report.A = { requests: requests.length - aStage.requestsBefore, kind: result.kind, reason: result.kind === "ABSTAINED" ? result.reason : null, status: record?.status ?? null, abstainReason: record?.abstainReason ?? null, heading: record?.message?.view?.heading ?? null, card: record?.message?.card ?? null, text: record?.message?.text ?? null, brief: record?.brief ?? null, composition: record?.composition ?? null }
  } catch (error) {
    report.A = { requests: requests.length - aStage.requestsBefore, error: describe(error) }
  }
  const assessment = overlay.assessments.find((entry) => entry.isCurrent && entry.snapshot.interactionId === monitoringCall.id)
  report.analysisA = assessment ? { outcome: assessment.analysis.outcome, scenario: assessment.analysis.scenario, coverage: (assessment.analysis as { coverage?: unknown }).coverage ?? null, criteria: assessment.analysis.criteria.map((criterion) => ({ handle: criterion.lineHandle, heading: criterion.heading ?? null, title: criterion.titleText ?? criterion.text.slice(0, 140), action: criterion.requiredAction ?? null, declared: criterion.declaredStatus, final: criterion.status, confirmation: criterion.confirmation, observability: criterion.observability ?? null, materiality: criterion.materiality, evidence: criterion.evidence.map((quote) => `${quote.turn} ${quote.speaker}: ${quote.quote}`), rationale: criterion.rationale })) } : null
  report.analyzedInIsolation = overlay.assessments.map((entry) => ({ person: entry.snapshot.personId === person.id ? "LARISSA" : "COLEGA", interaction: entry.snapshot.interactionId, outcome: entry.analysis.outcome }))
  report.meter = deps.meter.summary()
} catch (error) {
  report.error = describe(error)
} finally {
  if (opened) report.budget = { ledger: opened.budget.ledger, globalAfter: opened.persist() }
  await pool.end()
}
report.replay = { from: V14_PAID, replayed: replayLog.filter((entry) => entry.replayed).length, newRequests: replayLog.filter((entry) => !entry.replayed).length, log: replayLog }
report.requests = requests.map((entry) => ({ stage: entry.stage, tag: entry.tag, chars: entry.chars, estimatedInputTokens: Math.ceil(entry.chars / 3) }))
report.responses = responses
const out = join(resultsDir, `round-v14d-${execute ? "paid" : "dry-run"}-${stamp}.json`)
writeFileSync(out, JSON.stringify(report, null, 2))
writeFileSync(out.replace(/\.json$/, ".prompts.json"), JSON.stringify(requests, null, 2))
const short = (value: unknown) => (value && typeof value === "object" ? { kind: (value as { kind?: string }).kind, reason: (value as { reason?: string }).reason, error: (value as { error?: string }).error, requests: (value as { requests?: number }).requests } : null)
console.log(JSON.stringify({ kind: report.kind, error: report.error ?? null, C: short(report.C), A: short(report.A), replayed: (report.replay as { replayed: number }).replayed, newRequests: requests.length, budget: (report.budget as { globalAfter?: unknown } | undefined)?.globalAfter ?? null }, null, 2))
console.log(`\nArtefato: ${out}`)
