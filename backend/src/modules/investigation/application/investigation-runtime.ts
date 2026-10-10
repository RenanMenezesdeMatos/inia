import type { Database } from "../../../infrastructure/database/pool.js"
import { env } from "../../../config/env.js"
import type { FunctionCall } from "../../assistant/infrastructure/gemini-function-calling-client.js"
import { AiCallBlockedError, EMPTY_USAGE, type LlmContextBreakdown, type LlmUsage } from "../../../shared/application/llm-telemetry.js"
import type { SupportMaterialCandidate, SupportMaterialsOutcome } from "../../feedbacks/domain/support-material.js"
import { findTool, toolsForCapabilities, type ToolDefinition } from "../domain/tool-catalog.js"
import { injectRuntimeDefaults, toModelDeclaration, type ToolSchemaMode } from "../domain/tool-declarations.js"
import type { InvestigationCapability } from "../domain/capabilities.js"
import type { InvestigationSummary, OperationalUniverseRecord, ToolInvocationTrace } from "../domain/tool-trace.js"
import type { ToolResult } from "../domain/tool-output.js"
import { ledgerEntryFromTrace, renderLedger, type LedgerEntry } from "../domain/evidence-ledger.js"
import { addTokens, EMPTY_TOKENS, evaluateTokenBudget, type TokenThresholds } from "../domain/token-budget.js"
import { HandleRegistry, projectForModel, resolveModelArgs, UnknownHandleError } from "../domain/handle-registry.js"
import { criticalFactsOf, extractDecisionSignals } from "../domain/decision-critical-facts.js"
import { evaluateStop, extractStopDeclaration, renderStopRejection, STOP_REASON_LABELS, type StopDeclaration, type StopEvaluation, type StopReason } from "../domain/evidence-sufficiency.js"
import { assessLedgerRepresentativeness } from "../domain/evidence-representativeness.js"
import { renderObjectiveForModel, resolveInvestigationObjective, type InvestigationObjective, type ObjectiveContext } from "../domain/investigation-objective.js"
import { periodIntentOf, temporalBucketCountOf, type InteractionAnalysisObjective } from "../domain/interaction-analysis.js"
import { consolidatedTemporalStatus, emptyTemporalTelemetry, renderTemporalConclusion, temporalBucketsOf, temporalConclusionOfLedger, temporalFactsOf, type TemporalConclusion } from "../domain/temporal-semantics.js"
import { defaultSamplingStrategy, periodDaysOf } from "../domain/sampling-strategy.js"
import { evidenceSourceCoverage, renderEvidenceSources, sourcesAvailable, sourcesUsed } from "../domain/evidence-sources.js"
import { generateForRoute, routeFor, routeRecordOf } from "../../../shared/application/model-routing/llm-gateway.js"
import { estimateTokens } from "../../../shared/application/model-routing/token-estimate.js"
import { composeUserTurn, promptProfile, type AssembledPrompt } from "../../../shared/application/prompting/prompt-components.js"
import type { SystemPromptParts } from "../../agents/application/build-system-prompt.js"
import { assembleInvestigationPrompt, INVESTIGATION_POLICY } from "./investigation-prompt.js"
import { executeTool, ToolArgumentError } from "./tool-executor.js"
import { summarizeToolResult } from "./tool-summaries.js"
import { pruneToolsForRound, type PruningState } from "./tool-phases.js"
import type { InvestigationPeriod, InvestigationRequest, InvestigationSubject, ToolContext } from "./tool-context.js"
import { countInteractions } from "./tools/interaction-tools.js"

/** LIMITES DE INVESTIGAÇÃO — custo e loops sob controle (V1.1: alvo + teto + rodadas; V1.2: o
 * orçamento é só das Tools ESCOLHIDAS pelo Agent — o preflight determinístico tem contagem própria
 * e um teto de segurança global cobre a soma). */
export const DEFAULT_MAX_TOOL_CALLS = 12
export const MAX_TOOL_CALLS_CEILING = 12
/** Teto de segurança da execução inteira (preflight + investigação) — nunca é o orçamento do Agent. */
export const MAX_TOTAL_TOOL_CALLS_SAFETY = 16
/** Alvo de chamadas (o modelo é orientado a ficar abaixo; o teto é `maxToolCalls`). */
export const TARGET_TOOL_CALLS = 8
/** Rodadas de PLANEJAMENTO (cada uma = 1 request que pode pedir várias Tools em paralelo). A request de notas e a síntese final não contam. */
export const DEFAULT_MAX_PLANNING_ROUNDS = 3
export const PREFERRED_PLANNING_ROUNDS = 2
export const TOOL_TIMEOUT_MS = 40_000
export const INVESTIGATION_TIMEOUT_MS = 180_000
/** Teto do JSON devolvido ao modelo por Tool NA RODADA em que foi pedida (depois vira uma linha do ledger). */
const TOOL_RESPONSE_MAX_CHARS = 10_000
/** Chamadas que o modelo deve reservar para evidência profunda quando pretende afirmar algo comportamental. */
const DEEP_EVIDENCE_RESERVE = 3

/** Política da investigação — definida em investigation-prompt.ts (reexportada por compatibilidade). */
export { INVESTIGATION_POLICY }

export type InvestigationInput = {
  db: Database
  organizationId: string
  agentId: string
  /** Prompt do Agent já montado (identidade, instruções, KB, restrições) — a política soma-se a ele. */
  systemPrompt: string
  /** Partes estático × dinâmico do prompt do Agent (V1.3, perfil COMPACT) — ausente = composição da V1.2. */
  promptParts?: SystemPromptParts | null | undefined
  /** Declaração das Tools ao modelo — padrão: env INIA_TOOL_SCHEMA. */
  toolSchemaMode?: ToolSchemaMode | undefined
  capabilities: InvestigationCapability[]
  subject: InvestigationSubject
  defaultPeriod: InvestigationPeriod
  /** Objetivo/contexto inicial mínimo (o input do Workflow/chamada). */
  objective: string
  /** Contexto para derivar o INVESTIGATION OBJECTIVE (V1.3.1) — ausente = derivado só do sujeito. */
  objectiveContext?: Partial<ObjectiveContext> | undefined
  /** Transcrição em foco já no input (feedback de chamada) — conta como evidência comportamental da interação. */
  transcriptInFocus?: boolean | undefined
  /** V1.3.2: sinal/flag que trouxe a interação em foco (Workflow por gatilho) — alimenta a necessidade E_SIGNAL_CONTEXT. */
  signalFlag?: string | null | undefined
  /** Há base de conhecimento real nesta execução (retrieval inicial) — necessidade de procedimento satisfeita. */
  knowledgeAvailable?: boolean | undefined
  now: Date
  timeZone: string
  maxToolCalls?: number | undefined
  maxPlanningRounds?: number | undefined
  targetToolCalls?: number | undefined
  /** Limiares de aviso do Token Budget — padrão: env INVESTIGATION_TOKEN_WARNING_*. */
  tokenThresholds?: TokenThresholds | undefined
  /** Materiais cujos trechos JÁ entraram no prompt do Agent (retrieval inicial) — candidatos reais
   * desde o início, como na V1; `query_knowledge` acrescenta os que consultar. */
  initialKnowledgeCandidates?: SupportMaterialCandidate[] | undefined
}

export type InvestigationOutcome = {
  /** Notas finais do modelo (fatos/hipóteses/limitações) — insumo da resposta, nunca a resposta. */
  notes: string
  trace: ToolInvocationTrace[]
  summary: InvestigationSummary
  /** Evidence Ledger compacto (F1..Fn) — o que a síntese final recebe no lugar do trace. */
  ledger: LedgerEntry[]
  /** Limitações conhecidas pela aplicação (orçamento, recusas, falhas, sem interações). */
  limitations: string[]
  /** Candidatos reais consultados (query_knowledge) — a seleção acontece na síntese final (validação V1). */
  knowledgeCandidates: SupportMaterialCandidate[]
  /** Dossiê pronto para entrar na chamada de resposta: só fatos apurados pela aplicação. */
  dossier: string
  /** Requests ao modelo feitas pela investigação (planejamento, notas, análise semântica). */
  requests: InvestigationRequest[]
  /** Universo operacional do indicador em foco (volume) — null = não determinado (V1.3). */
  operationalUniverse: OperationalUniverseRecord | null
  /** Objetivo derivado e motivo da parada (V1.3.1). */
  objective: InvestigationObjective
  stopReason: StopReason
} & SupportMaterialsOutcome

export function defaultTokenThresholds(): TokenThresholds {
  return { total: env.INVESTIGATION_TOKEN_WARNING_TOTAL || null, input: env.INVESTIGATION_TOKEN_WARNING_INPUT || null, output: env.INVESTIGATION_TOKEN_WARNING_OUTPUT || null }
}

function stableArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, Object.keys(args).sort())
}

function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (Array.isArray(value)) summary[key] = value.length > 6 ? [...value.slice(0, 6).map(shorten), `… (+${value.length - 6})`] : value.map(shorten)
    else summary[key] = shorten(value)
  }
  return summary
}

function shorten(value: unknown): unknown {
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 157)}…` : value
  if (value && typeof value === "object") return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === "string" && item.length > 160 ? `${item.slice(0, 157)}…` : item)))
  return value
}

/** O que o modelo recebe de um resultado NA RODADA em que o pediu: `data` PROJETADO (ids → handles,
 * chaves técnicas removidas — handle-registry.ts) + qualidade; a proveniência vai reduzida a período e
 * população (sem `method`, sem fonte técnica, sem filtros técnicos). */
function compactForModel(result: ToolResult, handles: HandleRegistry): Record<string, unknown> {
  const provenance = result.provenance ? { period: result.provenance.period?.label ?? null, population: result.provenance.population } : null
  const compact = { data: projectForModel(result.data, handles), quality: result.quality, provenance }
  const text = JSON.stringify(compact)
  if (text.length <= TOOL_RESPONSE_MAX_CHARS) return compact
  return { quality: result.quality, provenance, truncated: true, dataText: JSON.stringify(compact.data).slice(0, TOOL_RESPONSE_MAX_CHARS), note: `resultado cortado em ${TOOL_RESPONSE_MAX_CHARS} caracteres — peça um recorte menor (período/limite) se precisar do restante` }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Ledger a partir do trace: só chamadas concluídas/cache viram fato (F1..Fn, na ordem lógica).
 * As refs são estáveis ao longo da investigação (novas chamadas só acrescentam) e ficam gravadas
 * no próprio trace (`ledgerRef`) para o QA Lab/Feedback ligarem fato ↔ chamada. */
export function buildLedger(trace: ToolInvocationTrace[], defaultPeriodLabel: string | null): LedgerEntry[] {
  return [...trace]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((item) => item.status === "COMPLETED" || item.status === "CACHED")
    .map((item, index) => {
      const ref = `F${index + 1}`
      item.ledgerRef = ref
      return ledgerEntryFromTrace(item, ref, defaultPeriodLabel)
    })
}

/** Dossiê da síntese final: ledger compacto + o que NÃO foi investigado + notas do Agent. */
export function renderDossier(trace: ToolInvocationTrace[], notes: string, options?: { defaultPeriodLabel?: string | null; limitations?: string[]; stopReason?: StopReason | null; objective?: InvestigationObjective | null; temporalConclusion?: TemporalConclusion | null }): string {
  const ledger = buildLedger(trace, options?.defaultPeriodLabel ?? null)
  const skipped = trace.filter((item) => item.status === "BUDGET_EXCEEDED" || item.status === "REJECTED" || item.status === "FAILED")
  const limitations = [...(options?.limitations ?? [])]
  if (skipped.length > 0) limitations.push(`chamadas não executadas por orçamento, recusa ou falha: ${[...new Set(skipped.map((item) => item.label))].join(", ")}`)
  // A síntese precisa saber POR QUE a investigação parou: limite/dados insuficientes nunca viram suficiência (§19/20).
  const stopLine = options?.stopReason
    ? `RESULTADO DA INVESTIGAÇÃO: ${STOP_REASON_LABELS[options.stopReason]}.${options.stopReason === "ANSWER_SUFFICIENT" ? "" : " A evidência é INCOMPLETA para o objetivo — conclua só o que os fatos sustentam e declare a limitação; nunca apresente causa não investigada como identificada."}`
    : null
  // V1.3.4.2 (§9/§10): a CONCLUSÃO TEMPORAL AUTORIZADA vai à síntese com a formulação segura — só quando houve comparação.
  const conclusionLine = options?.temporalConclusion && options.temporalConclusion.kind !== "NOT_COMPARED" ? renderTemporalConclusion(options.temporalConclusion) : null
  return [
    ...(options?.objective ? [renderObjectiveForModel(options.objective)] : []),
    ...(stopLine ? [stopLine] : []),
    ...(conclusionLine ? [conclusionLine] : []),
    "EVIDÊNCIAS DA INVESTIGAÇÃO (fatos apurados pela aplicação — use SOMENTE estes números, citando as refs; não calcule nem invente outros):",
    ledger.length > 0 ? renderLedger(ledger) : "Nenhuma ferramenta produziu fato nesta investigação.",
    ...(limitations.length > 0 ? ["", `LIMITAÇÕES E NÃO INVESTIGADO: ${limitations.join("; ")} — não afirme nada sobre o que não foi investigado; declare como limitação quando relevante.`] : []),
    "",
    "NOTAS DO AGENT (interpretação — fatos acima têm precedência):",
    notes.trim() || "(sem notas)",
  ].join("\n")
}

type RuntimeState = {
  context: ToolContext
  tools: ToolDefinition[]
  budget: number
  trace: ToolInvocationTrace[]
  summary: InvestigationSummary
  cache: Map<string, Promise<ToolResult>>
  sequence: number
  limitations: string[]
  preflight: PruningState["preflight"]
  schemaMode: ToolSchemaMode
  operationalUniverse: OperationalUniverseRecord | null
}

/**
 * INVESTIGAÇÃO V1.1: PREFLIGHT determinístico (fatos que o gatilho já exige) → rodadas de
 * PLANEJAMENTO (1 request cada; o modelo pede N Tools independentes que rodam em PARALELO) com
 * contexto COMPACTADO (objetivo + ledger + limitações + resultados só da última onda + Tools da
 * rodada) → NOTAS → síntese final fora daqui. Orçamento de chamadas (alvo + teto), cache por
 * execução, timeout por Tool/investigação, trace completo persistido (o ledger é só o que o
 * modelo lê). Nunca pré-calcula o diagnóstico: preflight é factual.
 */
export async function runInvestigation(input: InvestigationInput): Promise<InvestigationOutcome> {
  const tools = toolsForCapabilities(input.capabilities)
  const budget = Math.min(input.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS, MAX_TOOL_CALLS_CEILING)
  const maxRounds = Math.max(1, Math.min(input.maxPlanningRounds ?? DEFAULT_MAX_PLANNING_ROUNDS, DEFAULT_MAX_PLANNING_ROUNDS))
  const target = Math.min(input.targetToolCalls ?? TARGET_TOOL_CALLS, budget)
  const thresholds = input.tokenThresholds ?? defaultTokenThresholds()
  const context: ToolContext = {
    db: input.db,
    organizationId: input.organizationId,
    agentId: input.agentId,
    now: input.now,
    timeZone: input.timeZone,
    subject: input.subject,
    defaultPeriod: input.defaultPeriod,
    workdayCache: new Map(),
    knowledgeCandidates: new Map((input.initialKnowledgeCandidates ?? []).map((candidate) => [candidate.materialId, { materialId: candidate.materialId, title: candidate.title }])),
    knowledgeExcerpts: new Map(),
    collectedFacts: [],
    telemetry: { requests: [] },
    handles: new HandleRegistry(),
    // Estado investigativo compartilhado com as Tools (V1.3.2) — preenchido depois do objetivo/preflight e atualizado por rodada.
    investigation: { analysisObjective: null, recordedUniverseCount: null, samplingStrategy: "RECENT", temporalBuckets: 1 },
  }
  const summary: InvestigationSummary = { toolCalls: 0, cachedCalls: 0, rejectedCalls: 0, budget, outcome: "NO_TOOLS", preflightCalls: 0, investigationToolCalls: 0, planningRounds: 0, maxPlanningRounds: maxRounds, targetToolCalls: target, parallelWaves: 0, requests: 0, tokens: EMPTY_TOKENS }
  const schemaMode: ToolSchemaMode = input.toolSchemaMode ?? env.INIA_TOOL_SCHEMA ?? "FULL"
  const state: RuntimeState = { context, tools, budget, trace: [], summary, cache: new Map(), sequence: 0, limitations: [], preflight: { indicatorPreflighted: false, interactionsInPeriod: null, availableDimensions: null }, schemaMode, operationalUniverse: null }
  const objective = resolveInvestigationObjective({ interactionId: input.subject.interactionId, indicatorCode: input.subject.indicatorCode, ...(input.objectiveContext ?? {}) })
  summary.objective = objective
  if (tools.length === 0) return { notes: "", trace: [], summary, ledger: [], limitations: [], knowledgeCandidates: [], dossier: "", requests: [], operationalUniverse: null, objective, stopReason: "NO_MORE_SUPPORTED_PATHS" }

  const startedAt = Date.now()
  await runPreflight(state)
  // Objetivo derivado pode refinar-se com o preflight (indicador dentro da meta → descrever, não explicar).
  const refinedObjective = state.preflight.withinTarget !== null && input.objectiveContext?.withinTarget === undefined ? resolveInvestigationObjective({ interactionId: input.subject.interactionId, indicatorCode: input.subject.indicatorCode, ...(input.objectiveContext ?? {}), withinTarget: state.preflight.withinTarget }) : objective
  summary.objective = refinedObjective
  // AMOSTRAGEM E ANÁLISE CONSCIENTES DO OBJETIVO (V1.3.2): estratégia padrão de find_interactions e blocos temporais
  // decididos pelo objetivo × tamanho da janela (nunca por conteúdo); a análise semântica recebe o estado investigativo.
  const periodDays = periodDaysOf(input.defaultPeriod)
  const periodIntent = periodIntentOf(refinedObjective, periodDays, Boolean(input.transcriptInFocus))
  context.investigation.samplingStrategy = defaultSamplingStrategy(refinedObjective.kind, periodDays)
  context.investigation.temporalBuckets = temporalBucketCountOf(periodDays)
  context.investigation.recordedUniverseCount = state.preflight.interactionsInPeriod
  const analysisObjectiveOf = (evaluation: StopEvaluation | null, declaration: StopDeclaration | null): InteractionAnalysisObjective => ({
    investigationObjective: refinedObjective.kind,
    question: refinedObjective.question,
    requiredClaimScope: refinedObjective.requiredScope,
    periodIntent,
    periodLabel: input.defaultPeriod.label,
    openEvidenceNeeds: (evaluation?.needs ?? []).filter((need) => need.material && need.status === "OPEN" && need.source === "RUNTIME").map((need) => ({ id: need.id, question: need.question })),
    materialQuestions: (declaration?.unresolvedQuestions ?? []).filter((item) => item.material).map((item) => item.question),
    materialHypotheses: (declaration?.hypotheses ?? []).filter((item) => item.material && item.status !== "REFUTED").map((item) => ({ hypothesis: item.hypothesis, status: item.status })),
    contradictoryEvidenceSummary: (declaration?.contradictoryEvidence ?? []).filter((item) => item.status === "OPEN").map((item) => item.description),
    analysisPurpose: "",
    recordedUniverseCount: state.preflight.interactionsInPeriod,
  })
  context.investigation.analysisObjective = analysisObjectiveOf(null, null)
  summary.samplingStrategy = context.investigation.samplingStrategy
  summary.periodIntent = periodIntent

  // PROMPT POR COMPONENTES (V1.3): perfil CURRENT reproduz a V1.2 (tudo no sistema); COMPACT separa o
  // prefixo estático (cacheável, sem dado de colaborador) do dinâmico (sujeito, KB) — ver investigation-prompt.ts.
  const profile = input.promptParts ? promptProfile() : "CURRENT"
  const promptInput = { systemPrompt: input.systemPrompt, parts: input.promptParts ?? null, capabilities: input.capabilities, tools, subject: input.subject, defaultPeriod: input.defaultPeriod, interactionHandle: input.subject.interactionId ? context.handles.register("I", input.subject.interactionId) : null, schemaMode }
  const planningPrompt = assembleInvestigationPrompt("PLANNING", promptInput, profile)
  const declarationContext = { mode: schemaMode, indicatorInFocus: Boolean(input.subject.indicatorCode) }
  const cacheOf = (assembled: AssembledPrompt) => ({ cacheable: profile === "COMPACT", cacheKeyVersion: assembled.cacheKeyVersion })

  let notes = ""
  let outcome: InvestigationSummary["outcome"] = "ANSWERED"
  let stopReason: StopReason | null = null
  let lastEvaluation: StopEvaluation | null = null
  let lastDeclaration: StopDeclaration | null = null
  let rejectionBlock: string | null = null
  const rejectionLog: { round: number; reasons: string[] }[] = []
  let lastWave: WaveResult[] = []
  const objectiveBlock = renderObjectiveForModel(refinedObjective)
  const sufficiencyContextOf = (ledger: LedgerEntry[], declaredKeys: ToolDefinition[], round: number) => ({
    objective: refinedObjective,
    ledger,
    assessments: assessLedgerRepresentativeness(ledger, state.preflight.interactionsInPeriod, state.operationalUniverse),
    interactionsInPeriod: state.preflight.interactionsInPeriod,
    transcriptInFocus: Boolean(input.transcriptInFocus),
    knowledgeAvailable: Boolean(input.knowledgeAvailable) || context.knowledgeCandidates.size > 0,
    availableTools: declaredKeys.map((tool) => tool.key),
    roundsRemaining: maxRounds - round,
    budgetRemaining: budget - (summary.investigationToolCalls ?? 0),
    periodIntent,
    signalFlag: input.signalFlag ?? null,
    // V1.3.4: blocos da janela — comparação temporal só existe com ≥ 2.
    temporalBuckets: context.investigation.temporalBuckets,
  })
  // Recusa na ÚLTIMA rodada (§42): instrumentada, nunca remediada aqui — primeiro medir.
  let finalRoundRejection: { remainingMaterialNeeds: string[]; candidateToolsAvailable: string[] } | null = null
  for (let round = 1; round <= maxRounds; round += 1) {
    if (Date.now() - startedAt > INVESTIGATION_TIMEOUT_MS) {
      outcome = "TIMEOUT"
      stopReason = "SAFETY_STOP"
      break
    }
    if ((summary.investigationToolCalls ?? 0) >= budget || summary.toolCalls >= MAX_TOTAL_TOOL_CALLS_SAFETY) {
      outcome = "BUDGET_EXHAUSTED"
      stopReason = "INVESTIGATION_TOOL_BUDGET"
      break
    }
    // Limiar de tokens (aviso configurável): parar de planejar quando o total já o ultrapassou — nunca antes da 1ª rodada.
    if (round > 1 && thresholds.total && context.telemetry.requests.reduce((sum, request) => sum + (request.usage.totalTokens ?? 0), 0) >= thresholds.total) {
      stopReason = "TOKEN_WARNING_STOP"
      state.limitations.push(`limiar de tokens (${thresholds.total}) atingido — investigação interrompida antes de esgotar as lacunas`)
      break
    }
    const ledger = buildLedger(state.trace, input.defaultPeriod.label)
    const { declared } = pruneToolsForRound(tools, { subject: input.subject, ledger, preflight: state.preflight, defaultPeriodLabel: input.defaultPeriod.label })
    if (declared.length === 0) {
      stopReason = "NO_MORE_SUPPORTED_PATHS"
      break
    }
    // FONTES DE EVIDÊNCIA (V1.3.2): o que existe nesta execução × o que já foi consultado — pergunta de lacuna, não checklist.
    const sourcesBlock = renderEvidenceSources(evidenceSourceCoverage(declared.map((tool) => tool.key), ledger))
    const prompt = composeUserTurn(planningPrompt, [rejectionBlock, objectiveBlock, renderRoundPrompt({ objective: input.objective, ledger, lastWave, limitations: state.limitations, preflight: state.preflight, round, maxRounds, used: summary.investigationToolCalls ?? 0, budget, target }), sourcesBlock].filter(Boolean).join("\n\n"))
    rejectionBlock = null
    // A análise semântica desta rodada conhece as lacunas materiais que o controlador já derivou (estado do último STOP avaliado).
    context.investigation.analysisObjective = analysisObjectiveOf(lastEvaluation ?? evaluateStop(lastDeclaration, sufficiencyContextOf(ledger, declared, round - 1)), lastDeclaration)
    const declarations = declared.map((tool) => toModelDeclaration(tool, declarationContext))
    const route = routeFor({ purpose: "PLANNING", phase: "PLANNING", toolSchemaCount: declarations.length, estimatedInputTokens: estimateTokens(planningPrompt.system, prompt, JSON.stringify(declarations)) })
    const response = await generateForRoute({
      classification: { phase: "PLANNING", purpose: "PLANNING", source: "AGENT", semanticType: "INVESTIGATION" },
      contextBreakdown: contextBreakdownOf({ assembled: planningPrompt, toolSchemas: JSON.stringify(declarations), ledger, lastWave, objective: input.objective }),
      promptComponents: planningPrompt.components,
      cache: cacheOf(planningPrompt),
      systemPrompt: planningPrompt.system,
      contents: [{ role: "user", text: prompt }],
      tools: declarations,
      structuredOutput: false,
      route,
    })
    context.telemetry.requests.push({ phase: "PLANNING", model: response.model ?? route.profile.model, usage: response.usage ?? EMPTY_USAGE, durationMs: response.durationMs ?? 0, toolCalls: response.kind === "functionCalls" ? response.calls.map((call) => call.name) : [], route: routeRecordOf(route) })
    if (response.kind === "text") {
      // O modelo PROPÕE parar; o runtime decide (§6–8). Sem declaração = proposta sem estado → avaliada só pelas necessidades do runtime.
      const extracted = extractStopDeclaration(response.text)
      lastDeclaration = extracted.declaration
      const evaluation = evaluateStop(extracted.declaration, sufficiencyContextOf(ledger, declared, round))
      lastEvaluation = evaluation
      if (!evaluation.accepted) {
        rejectionLog.push({ round, reasons: evaluation.rejections.map((item) => item.reason) })
        rejectionBlock = renderStopRejection(evaluation)
        console.warn(JSON.stringify({ event: "investigation_stop_rejected", round, rejections: evaluation.rejections.map((item) => item.needId) }))
        continue
      }
      notes = extracted.notes
      stopReason = evaluation.reason
      for (const limitation of evaluation.limitations) if (!state.limitations.includes(limitation)) state.limitations.push(limitation)
      // Lacuna material com caminho na última rodada: aceito por limite (LIMITED) — registrado como recusa da rodada final (§42).
      if (evaluation.rejections.length > 0) {
        rejectionLog.push({ round, reasons: evaluation.rejections.map((item) => item.reason) })
        finalRoundRejection = { remainingMaterialNeeds: evaluation.rejections.map((item) => item.needId), candidateToolsAvailable: [...new Set(evaluation.rejections.flatMap((item) => item.candidateTools))] }
      }
      break
    }
    summary.planningRounds = (summary.planningRounds ?? 0) + 1
    lastWave = await executeWave(state, response.calls, round, new Set(declared.map((tool) => tool.key)))
    if (round === maxRounds) {
      state.limitations.push(`limite de ${maxRounds} rodadas de planejamento atingido`)
      stopReason = "MAX_PLANNING_ROUNDS"
    }
  }
  if (((summary.investigationToolCalls ?? 0) >= budget || summary.toolCalls >= MAX_TOTAL_TOOL_CALLS_SAFETY) && outcome === "ANSWERED") outcome = "BUDGET_EXHAUSTED"
  if (outcome === "BUDGET_EXHAUSTED") {
    state.limitations.push(`orçamento de ${budget} chamadas esgotado`)
    stopReason = "INVESTIGATION_TOOL_BUDGET"
  }
  if (!stopReason) stopReason = "MAX_PLANNING_ROUNDS"

  // NOTAS: quando o loop terminou por Tools (última rodada/orçamento/timeout), uma request SEM
  // ferramentas organiza fatos, hipóteses e limitações a partir do ledger (compacto).
  if (!notes && state.trace.some((item) => item.status === "COMPLETED" || item.status === "CACHED")) {
    const ledger = buildLedger(state.trace, input.defaultPeriod.label)
    // Notas com o MESMO prefixo estático do planejamento (mesma chave de cache) — só o turno do usuário muda.
    const notesPrompt = assembleInvestigationPrompt("INVESTIGATION_NOTES", promptInput, profile)
    const prompt = composeUserTurn(notesPrompt, `${objectiveBlock}\n\n${renderNotesPrompt({ objective: input.objective, ledger, lastWave, limitations: state.limitations, preflight: state.preflight })}`)
    try {
      const route = routeFor({ purpose: "INVESTIGATION_NOTES", phase: "SYNTHESIS", estimatedInputTokens: estimateTokens(notesPrompt.system, prompt) })
      const response = await generateForRoute({
        classification: { phase: "SYNTHESIS", purpose: "INVESTIGATION_NOTES", source: "AGENT", semanticType: "INVESTIGATION" },
        contextBreakdown: contextBreakdownOf({ assembled: notesPrompt, toolSchemas: "", ledger, lastWave, objective: input.objective }),
        promptComponents: notesPrompt.components,
        cache: cacheOf(notesPrompt),
        systemPrompt: notesPrompt.system,
        contents: [{ role: "user", text: prompt }],
        tools: [],
        structuredOutput: false,
        route,
      })
      context.telemetry.requests.push({ phase: "SYNTHESIS", model: response.model ?? route.profile.model, usage: response.usage ?? EMPTY_USAGE, durationMs: response.durationMs ?? 0, toolCalls: [], route: routeRecordOf(route) })
      if (response.kind === "text") {
        // As notas pós-limite também trazem o estado (claims/hipóteses/limitações) — o motivo da parada já está fixado pelo limite.
        const extracted = extractStopDeclaration(response.text)
        notes = extracted.notes
        lastDeclaration = extracted.declaration
        // As Tools que AINDA poderiam rodar (pruning) dizem se a lacuna ficou por limite ou por falta de caminho.
        const { declared } = pruneToolsForRound(tools, { subject: input.subject, ledger, preflight: state.preflight, defaultPeriodLabel: input.defaultPeriod.label })
        lastEvaluation = evaluateStop(extracted.declaration ? { ...extracted.declaration, proposedAction: "STOP" } : null, { ...sufficiencyContextOf(ledger, declared, maxRounds), roundsRemaining: 0, budgetRemaining: 0 })
        for (const limitation of lastEvaluation.limitations) if (!state.limitations.includes(limitation)) state.limitations.push(limitation)
        if (lastEvaluation.rejections.length > 0) {
          rejectionLog.push({ round: maxRounds + 1, reasons: lastEvaluation.rejections.map((item) => item.reason) })
          finalRoundRejection = { remainingMaterialNeeds: lastEvaluation.rejections.map((item) => item.needId), candidateToolsAvailable: [...new Set(lastEvaluation.rejections.flatMap((item) => item.candidateTools))] }
        }
      }
    } catch (error) {
      if (error instanceof AiCallBlockedError) throw error
      state.limitations.push("o Agent não conseguiu escrever as notas da investigação")
    }
  }

  summary.outcome = outcome
  summary.interactionsInPeriod = state.preflight.interactionsInPeriod
  summary.operationalUniverse = state.operationalUniverse
  summary.handles = context.handles.entries()
  state.trace.sort((left, right) => left.sequence - right.sequence)
  const ledger = buildLedger(state.trace, input.defaultPeriod.label)
  accountRequests(summary, context.telemetry.requests, thresholds)
  // Estado de suficiência persistido (QA Lab/auditoria): mesmo sem declaração do modelo, as necessidades do runtime são avaliadas.
  const finalEvaluation = lastEvaluation ?? evaluateStop(lastDeclaration, { ...sufficiencyContextOf(ledger, pruneToolsForRound(tools, { subject: input.subject, ledger, preflight: state.preflight, defaultPeriodLabel: input.defaultPeriod.label }).declared, maxRounds), roundsRemaining: 0, budgetRemaining: 0 })
  for (const limitation of finalEvaluation.limitations) if (!state.limitations.includes(limitation)) state.limitations.push(limitation)
  const status = stopReason === "ANSWER_SUFFICIENT" ? "SUFFICIENT" : stopReason === "INSUFFICIENT_DATA" ? "INSUFFICIENT_DATA" : stopReason === "NO_MORE_SUPPORTED_PATHS" ? "NO_PATH" : "LIMITED"
  summary.stopReason = stopReason
  summary.sufficiency = {
    status,
    requiredScope: refinedObjective.requiredScope,
    stopProposed: finalEvaluation.stopProposed && Boolean(lastDeclaration || notes),
    stopAccepted: stopReason === "ANSWER_SUFFICIENT" || stopReason === "INSUFFICIENT_DATA" || stopReason === "NO_MORE_SUPPORTED_PATHS",
    rejections: rejectionLog,
    evidenceNeeds: finalEvaluation.needs,
    hypotheses: finalEvaluation.hypotheses,
    contradictoryEvidence: finalEvaluation.contradictoryEvidence,
    additionalEvidenceCouldChangeConclusion: lastDeclaration?.additionalEvidenceCouldChangeConclusion ?? (status !== "SUFFICIENT"),
    additionalEvidenceCouldIncreaseRequiredScope: lastDeclaration?.additionalEvidenceCouldIncreaseRequiredScope ?? false,
    dataLimitations: lastDeclaration?.dataLimitations ?? [],
    criticalFacts: criticalFactsOf(ledger, refinedObjective).map((fact) => ({ ref: fact.ref, kind: fact.kind, label: fact.label })),
    // V1.3.2 (§42): recusa na última rodada — o que ficou aberto e com que caminho.
    stopRejectedAtFinalRound: finalRoundRejection !== null,
    remainingMaterialNeeds: finalRoundRejection?.remainingMaterialNeeds ?? [],
    candidateToolsAvailable: finalRoundRejection?.candidateToolsAvailable ?? [],
  }
  // Rastreabilidade das FONTES (V1.3.2 — §52): disponíveis (capacidades efetivas) × consultadas (trace) — nunca score.
  summary.evidenceSources = { available: sourcesAvailable(tools.map((tool) => tool.key)), used: sourcesUsed(ledger) }
  // V1.4.0 (§41): cobertura da camada semântica — soma das chamadas de analyze_interactions que produziram frames.
  const semanticSummary = semanticCoverageOf(ledger)
  if (semanticSummary) summary.semantic = semanticSummary
  const proceduralSummary = proceduralCoverageSummaryOf(ledger)
  if (proceduralSummary) summary.procedural = proceduralSummary
  const outcomeSummary = outcomeAttributionSummaryOf(ledger)
  if (outcomeSummary) summary.outcomeAttribution = outcomeSummary
  // V1.4.6 (§26): custo por ESTÁGIO da análise semântica — extração × síntese de patterns × sidecar, separados, para saber
  // exatamente quanto o procedural/atribuição custa.
  const stageTokens = context.telemetry.requests.filter((request) => request.phase === "SEMANTIC_ANALYSIS").reduce<Record<string, number>>((acc, request) => { const stage = request.stage ?? "EXTRACTION"; acc[stage] = (acc[stage] ?? 0) + (request.usage.totalTokens ?? 0); return acc }, {})
  if (Object.keys(stageTokens).length > 0) summary.semanticStageTokens = stageTokens
  // SEMÂNTICA TEMPORAL (V1.3.4): comparação exigida × realizada, blocos disponíveis/analisados/comparados. As contagens de
  // claims temporais entram depois da síntese (run-agent), quando o gating as valida.
  const temporalNeed = finalEvaluation.needs.find((need) => need.id === "E_TEMPORAL_COMPARISON") ?? null
  const behavioralComparisons = temporalFactsOf(ledger).filter((fact) => fact.signal !== null).map((fact) => fact.signal!)
  const temporalBucketList = temporalBucketsOf(input.defaultPeriod, context.investigation.temporalBuckets, (date) => date.toLocaleDateString("sv-SE", { timeZone: context.timeZone }))
  const consolidated = consolidatedTemporalStatus(behavioralComparisons)
  // V1.3.4.2: conclusão temporal AUTORIZADA (derivada por código) — vai ao dossiê (formulação segura) e ao gating do texto final.
  const temporalConclusion = temporalConclusionOfLedger(ledger)
  summary.temporal = {
    ...emptyTemporalTelemetry(temporalNeed !== null, context.investigation.temporalBuckets),
    temporalComparisonStatus: temporalNeed === null ? "NOT_REQUIRED" : consolidated ?? (temporalNeed.status === "SATISFIED" ? "DIFFERENCE_OBSERVED" : ledger.some((entry) => entry.tool === "analyze_interactions" && entry.signals?.temporalComparison) ? "INSUFFICIENT_EVIDENCE" : "NOT_PERFORMED"),
    analyzedBuckets: ledger.filter((entry) => entry.tool === "analyze_interactions").reduce((max, entry) => Math.max(max, entry.signals?.temporalCoverage?.bucketsCovered ?? 0), 0),
    comparedBuckets: [...new Set(behavioralComparisons.flatMap((signal) => signal.comparedBuckets))].sort(),
    // V1.3.4.1: diferença entre amostras (sustentada ou não) e ausência estabelecida por cobertura — sinais, nunca julgamento.
    sampleDifferenceDetected: ledger.some((entry) => entry.signals?.temporalComparison?.findings.some((finding) => finding.sampleDifference === true || finding.relationValidationStatus === "SAMPLE_DIFFERENCE_ONLY")),
    absenceEstablished: ledger.some((entry) => entry.signals?.temporalComparison?.absenceEstablished === true),
    buckets: temporalBucketList,
    conclusion: temporalConclusion,
  }
  return {
    notes,
    trace: state.trace,
    summary,
    ledger,
    limitations: state.limitations,
    knowledgeCandidates: [...context.knowledgeCandidates.values()],
    dossier: renderDossier(state.trace, notes, { defaultPeriodLabel: input.defaultPeriod.label, limitations: state.limitations, stopReason, objective: refinedObjective, temporalConclusion }),
    requests: context.telemetry.requests,
    operationalUniverse: state.operationalUniverse,
    objective: refinedObjective,
    stopReason,
  }
}

/** Soma requests (planejamento, notas, análise semântica, e a síntese final quando o chamador a acrescenta) no resumo persistido. */
export function accountRequests(summary: InvestigationSummary, requests: { usage: LlmUsage; phase?: string; model?: string; route?: { tier: string; escalated: boolean } }[], thresholds: TokenThresholds = defaultTokenThresholds()): void {
  const tokens = requests.reduce((acc, request) => addTokens(acc, request.usage), EMPTY_TOKENS)
  summary.requests = requests.length
  summary.requestLog = requests.map((request) => ({ phase: request.phase ?? "—", model: request.model ?? "—", tier: request.route?.tier ?? null, total: request.usage.totalTokens, reasoning: request.usage.reasoningTokens, escalated: request.route?.escalated ?? false }))
  summary.tokens = tokens
  summary.tokenBudget = evaluateTokenBudget(tokens, thresholds)
}

// ---------------------------------------------------------------------------------------------
// PREFLIGHT determinístico — só o contexto mínimo que o próprio gatilho exige. Nunca o diagnóstico.
// ---------------------------------------------------------------------------------------------
async function runPreflight(state: RuntimeState): Promise<void> {
  const { subject } = state.context
  const available = new Set(state.tools.map((tool) => tool.key))
  const calls: FunctionCall[] = []
  if (subject.indicatorCode) {
    if (available.has("get_indicator_snapshot")) calls.push({ name: "get_indicator_snapshot", args: { indicatorCode: subject.indicatorCode } })
    if (available.has("validate_data_quality")) calls.push({ name: "validate_data_quality", args: { indicatorCode: subject.indicatorCode } })
    if (available.has("get_available_dimensions")) calls.push({ name: "get_available_dimensions", args: { indicatorCode: subject.indicatorCode } })
  }
  if (subject.interactionId && available.has("get_interaction_context")) calls.push({ name: "get_interaction_context", args: {} })
  if (calls.length > 0) {
    const wave = await executeWave(state, calls, 0, new Set(calls.map((call) => call.name)))
    state.summary.preflightCalls = wave.filter((item) => !("error" in item.response)).length
    // O orçamento do Agent começa do zero: preflight é da aplicação, não uma escolha do modelo.
    state.summary.investigationToolCalls = 0
    state.preflight.indicatorPreflighted = Boolean(subject.indicatorCode) && wave.some((item) => item.call.name === "get_indicator_snapshot" && !("error" in item.response))
    // Universo OPERACIONAL (V1.3): o volume que compõe o indicador (denominador de médias ponderadas/
    // taxas) — distinto das interações registradas; a relação entre os dois nunca é presumida.
    const snapshot = wave.find((item) => item.call.name === "get_indicator_snapshot" && !("error" in item.response))
    if (snapshot) {
      state.operationalUniverse = operationalUniverseOf(snapshot.response)
      const target = (snapshot.response as { data?: { target?: { withinTarget?: boolean | null } | null } }).data?.target
      state.preflight.withinTarget = target?.withinTarget ?? null
    }
    const dimensions = wave.find((item) => item.call.name === "get_available_dimensions" && !("error" in item.response))
    if (dimensions) {
      const data = (dimensions.response as { data?: { dimensions?: { dimension: string; available: boolean }[]; interactionsInPeriod?: number } }).data
      state.preflight.availableDimensions = (data?.dimensions ?? []).filter((item) => item.available).map((item) => item.dimension)
      if (typeof data?.interactionsInPeriod === "number") state.preflight.interactionsInPeriod = data.interactionsInPeriod
    }
  }
  if (state.preflight.interactionsInPeriod === null && state.tools.some((tool) => tool.capability === "INTERACTION_ANALYSIS")) {
    try {
      state.preflight.interactionsInPeriod = await countInteractions(state.context, state.context.defaultPeriod)
    } catch {
      state.preflight.interactionsInPeriod = null
    }
  }
  if (state.preflight.interactionsInPeriod === 0) state.limitations.push("nenhuma interação do colaborador registrada no período — análise de comportamento na chamada não é possível")
}

function operationalUniverseOf(response: Record<string, unknown>): OperationalUniverseRecord | null {
  const data = (response as { data?: { indicator?: { aggregation?: string }; operational?: { denominator?: number | null } } }).data
  const aggregation = data?.indicator?.aggregation
  const denominator = data?.operational?.denominator
  if (typeof denominator !== "number" || denominator <= 0) return null
  if (aggregation === "WEIGHTED_AVERAGE") return { count: Math.round(denominator), source: "get_indicator_snapshot", label: "contatos/avaliações (denominador do indicador)" }
  if (aggregation === "RATE") return { count: Math.round(denominator), source: "get_indicator_snapshot", label: "elegíveis (base do indicador)" }
  return null
}

// ---------------------------------------------------------------------------------------------
// ONDA: N chamadas pedidas numa única resposta do modelo, executadas em PARALELO. A sequência é
// lógica (ordem do pedido); o orçamento é reservado de forma síncrona antes de qualquer await.
// ---------------------------------------------------------------------------------------------
type WaveResult = { call: FunctionCall; response: Record<string, unknown>; sequence: number }

async function executeWave(state: RuntimeState, calls: FunctionCall[], round: number, declared: Set<string>): Promise<WaveResult[]> {
  if (calls.length >= 2) state.summary.parallelWaves = (state.summary.parallelWaves ?? 0) + 1
  const firstSequence = state.sequence + 1
  const results = await Promise.all(calls.map((call) => invoke(state, call, round, calls.length, declared)))
  return results.map((response, index) => ({ call: calls[index]!, response, sequence: firstSequence + index }))
}

async function invoke(state: RuntimeState, call: FunctionCall, round: number, concurrency: number, declared: Set<string>): Promise<Record<string, unknown>> {
  const { context, tools, cache, trace, summary, budget } = state
  const startedAt = new Date().toISOString()
  const tool = findTool(call.name)
  state.sequence += 1
  // Handles (I1/K1/M1) → ids reais ANTES de validar/executar; a auditoria guarda os dois lados.
  // COMPACT (V1.3): o indicador em foco é injetado pelo runtime quando o modelo o omitiu.
  const modelArgs = tool && state.schemaMode === "COMPACT" ? injectRuntimeDefaults(tool, call.args ?? {}, { indicatorCode: context.subject.indicatorCode }) : (call.args ?? {})
  let realArgs: Record<string, unknown> = modelArgs
  let handleError: UnknownHandleError | null = null
  try {
    realArgs = resolveModelArgs(modelArgs, context.handles)
  } catch (error) {
    if (error instanceof UnknownHandleError) handleError = error
    else throw error
  }
  const base = { sequence: state.sequence, tool: call.name, label: tool?.label ?? call.name, capability: tool?.capability ?? "—", argumentsSummary: summarizeArgs(realArgs), modelArguments: summarizeArgs(call.args ?? {}), startedAt, round, concurrency }
  const finish = (partial: Omit<ToolInvocationTrace, "sequence" | "tool" | "label" | "capability" | "argumentsSummary" | "modelArguments" | "startedAt" | "completedAt" | "round" | "concurrency">) => {
    trace.push({ ...base, ...partial, completedAt: new Date().toISOString() })
  }
  // Só o que foi DECLARADO nesta rodada pode rodar (capacidades efetivas ∩ pruning da rodada).
  if (!tool || !tools.some((available) => available.key === tool.key) || !declared.has(tool.key)) {
    summary.rejectedCalls += 1
    finish({ resultSummary: "ferramenta não disponível nesta execução", quality: null, provenance: null, status: "REJECTED", error: "TOOL_NOT_AVAILABLE" })
    return { error: `A ferramenta "${call.name}" não está disponível nesta execução. Use apenas as ferramentas declaradas.` }
  }
  if (handleError) {
    summary.rejectedCalls += 1
    finish({ resultSummary: handleError.message, quality: null, provenance: null, status: "REJECTED", error: "UNKNOWN_HANDLE" })
    return { error: handleError.message }
  }
  const cacheKey = `${tool.key}:${stableArgs(realArgs)}`
  const cached = cache.get(cacheKey)
  if (cached) {
    summary.cachedCalls += 1
    try {
      const result = await cached
      finish({ resultSummary: `(cache) ${summarizeToolResult(tool.key, result)}`, quality: result.quality, provenance: result.provenance, status: "CACHED" })
      return { ...compactForModel(result, context.handles), cached: true, note: "mesma ferramenta com os mesmos argumentos já foi executada nesta investigação — resultado reaproveitado" }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida na ferramenta."
      finish({ resultSummary: `(cache) falha: ${message}`, quality: null, provenance: null, status: "FAILED", error: message })
      return { error: message }
    }
  }
  // Orçamento: só as chamadas ESCOLHIDAS pelo Agent (round ≥ 1) consomem `budget`; o preflight
  // (round 0) responde só ao teto de segurança global.
  const investigative = round > 0
  if ((investigative && (summary.investigationToolCalls ?? 0) >= budget) || summary.toolCalls >= MAX_TOTAL_TOOL_CALLS_SAFETY) {
    summary.rejectedCalls += 1
    finish({ resultSummary: "orçamento de ferramentas esgotado", quality: null, provenance: null, status: "BUDGET_EXCEEDED" })
    return { error: `Orçamento de ${budget} chamadas esgotado. Escreva as notas com o que já foi apurado.` }
  }
  // Validação dos argumentos ANTES de reservar orçamento (síncrona — rejeição nunca consome chamada).
  const parsed = tool.inputSchema.safeParse(realArgs)
  if (!parsed.success) {
    const message = `Argumentos inválidos para ${tool.key}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`).join("; ")}`
    summary.rejectedCalls += 1
    finish({ resultSummary: message, quality: null, provenance: null, status: "REJECTED", error: message })
    return { error: message }
  }
  summary.toolCalls += 1
  if (investigative) summary.investigationToolCalls = (summary.investigationToolCalls ?? 0) + 1
  const execution = withTimeout(executeTool(context, tool, realArgs), TOOL_TIMEOUT_MS, `A ferramenta ${tool.key} excedeu o tempo limite.`)
  cache.set(cacheKey, execution)
  try {
    const result = await execution
    const resultSummary = summarizeToolResult(tool.key, result)
    context.collectedFacts.push({ tool: tool.key, label: tool.label, summary: resultSummary, provenance: result.provenance })
    finish({ resultSummary, quality: result.quality, provenance: result.provenance, status: "COMPLETED", signals: extractDecisionSignals(tool.key, result.data) })
    return compactForModel(result, context.handles)
  } catch (error) {
    if (error instanceof AiCallBlockedError) throw error
    cache.delete(cacheKey)
    const message = error instanceof Error ? error.message : "Falha desconhecida na ferramenta."
    if (error instanceof ToolArgumentError) {
      summary.toolCalls -= 1
      if (investigative) summary.investigationToolCalls = (summary.investigationToolCalls ?? 0) - 1
      summary.rejectedCalls += 1
      finish({ resultSummary: message, quality: null, provenance: null, status: "REJECTED", error: message })
      return { error: message }
    }
    finish({ resultSummary: `falha: ${message}`, quality: null, provenance: null, status: "FAILED", error: message })
    return { error: message }
  }
}

/** Tamanho lógico (caracteres) do que compõe o prompt desta request — telemetria de contexto (V1.2). */
function contextBreakdownOf(parts: { assembled: AssembledPrompt; toolSchemas: string; ledger: LedgerEntry[]; lastWave: WaveResult[]; objective: string }): LlmContextBreakdown {
  return {
    // Estático = o que é igual entre colaboradores (perfil COMPACT) — no CURRENT o sistema inteiro (inclui KB e sujeito).
    staticPromptChars: parts.assembled.profile === "CURRENT" ? parts.assembled.system.length : parts.assembled.staticChars,
    dynamicPromptChars: parts.assembled.profile === "CURRENT" ? 0 : parts.assembled.dynamicChars,
    toolSchemaChars: parts.toolSchemas.length,
    evidenceLedgerChars: renderLedger(parts.ledger).length,
    interactionContentChars: parts.lastWave.reduce((sum, item) => sum + (["find_interactions", "get_interaction_context", "analyze_interactions", "analyze_peer_patterns", "find_comparable_interactions", "get_interaction_flags"].includes(item.call.name) ? JSON.stringify(item.response).length : 0), 0),
    knowledgeContentChars: parts.lastWave.reduce((sum, item) => sum + (item.call.name === "query_knowledge" ? JSON.stringify(item.response).length : 0), 0),
    structuredSchemaChars: 0,
    objectiveChars: parts.objective.length,
  }
}

// ---------------------------------------------------------------------------------------------
// CONTEXT COMPACTION — cada rodada recebe objetivo + contexto inicial + ledger + limitações +
// resultados detalhados SÓ da última onda + orçamento. Nunca o trace bruto de novo.
// ---------------------------------------------------------------------------------------------
type PromptState = { objective: string; ledger: LedgerEntry[]; lastWave: WaveResult[]; limitations: string[]; preflight: PruningState["preflight"] }

function renderContextBlocks(state: PromptState): string[] {
  const preflight = state.ledger.filter((entry) => entry.preflight)
  const accumulated = state.ledger.filter((entry) => !entry.preflight)
  const lastSequences = new Set(state.lastWave.map((item) => item.sequence))
  const refOf = (sequence: number) => state.ledger.find((entry) => entry.sequence === sequence)?.ref
  const initial = [
    ...(preflight.length > 0 ? [renderLedger(preflight)] : []),
    ...(state.preflight.availableDimensions ? [`Dimensões disponíveis para segmentar: ${state.preflight.availableDimensions.join(", ") || "nenhuma"}.`] : []),
    ...(state.preflight.interactionsInPeriod !== null ? [`Interações do colaborador no período: ${state.preflight.interactionsInPeriod}.`] : []),
  ]
  const lastWave = state.lastWave.map(({ call, response, sequence }) => `## ${refOf(sequence) ?? "(sem fato)"} ${call.name} ${Object.keys(call.args ?? {}).length > 0 ? JSON.stringify(call.args) : ""}\n${JSON.stringify(response)}`)
  return [
    `OBJETIVO DA INVESTIGAÇÃO:\n${state.objective}`,
    ...(initial.length > 0 ? [`CONTEXTO INICIAL (apurado pela aplicação, sem gastar rodada):\n${initial.join("\n")}`] : []),
    `EVIDÊNCIAS ACUMULADAS (ledger — cite as refs):\n${renderLedger(accumulated.filter((entry) => !lastSequences.has(entry.sequence)))}`,
    ...(lastWave.length > 0 ? [`RESULTADOS DA ÚLTIMA RODADA (detalhe; ids/valores daqui podem alimentar a próxima consulta — nas próximas rodadas ficam só no ledger):\n${lastWave.join("\n")}`] : []),
    ...(state.limitations.length > 0 ? [`LIMITAÇÕES E RECUSAS: ${state.limitations.join("; ")}.`] : []),
  ]
}

function renderRoundPrompt(state: PromptState & { round: number; maxRounds: number; used: number; budget: number; target: number }): string {
  const remaining = state.budget - state.used
  const last = state.round === state.maxRounds
  return [
    ...renderContextBlocks(state),
    `ORÇAMENTO: rodada ${state.round} de ${state.maxRounds} (preferencialmente ${Math.min(PREFERRED_PLANNING_ROUNDS, state.maxRounds)}); chamadas usadas ${state.used} de ${state.budget} (alvo ≤ ${state.target}; restam ${remaining}). Se pretende afirmar algo sobre comportamento na chamada, reserve ao menos ${DEEP_EVIDENCE_RESERVE} chamadas para interações/transcrições.`,
    last
      ? "ÚLTIMA RODADA DE FERRAMENTAS: peça agora, de uma vez, tudo que ainda muda a conclusão — ou, se a evidência já é suficiente, escreva as NOTAS DA INVESTIGAÇÃO em texto (fatos com refs F-n, hipóteses sustentadas, hipóteses descartadas, limitações)."
      : "O QUE FAZER AGORA: peça nesta única resposta TODAS as ferramentas independentes de que precisa (várias chamadas de função; rodam em paralelo), só se o resultado puder confirmar, refutar ou mudar uma hipótese. Se a evidência já é suficiente, NÃO chame ferramentas: escreva as NOTAS DA INVESTIGAÇÃO em texto (fatos com refs F-n, hipóteses sustentadas, hipóteses descartadas, limitações).",
  ].join("\n\n")
}

function renderNotesPrompt(state: PromptState): string {
  return [...renderContextBlocks(state), "A investigação terminou (sem mais ferramentas). Escreva agora as NOTAS DA INVESTIGAÇÃO em texto: fatos principais (com refs F-n e os números exatos), hipóteses sustentadas, hipóteses descartadas/não testáveis e limitações. Não conclua nada sobre comportamento na chamada sem fato de interação/transcrição no ledger."].join("\n\n")
}

/** Soma a telemetria semântica (V1.4.0) das entradas de analyze_interactions do ledger — null quando nenhuma produziu frames. */
export function semanticCoverageOf(ledger: LedgerEntry[]): import("../domain/tool-trace.js").SemanticCoverageSummary | null {
  const items = ledger.map((entry) => entry.signals?.interactionAnalysis?.semantic ?? null).filter((item): item is NonNullable<typeof item> => item !== null)
  if (items.length === 0) return null
  const sum = (pick: (item: (typeof items)[number]) => number) => items.reduce((total, item) => total + pick(item), 0)
  const merge = (pick: (item: (typeof items)[number]) => Record<string, number>) => items.reduce<Record<string, number>>((acc, item) => { for (const [key, value] of Object.entries(pick(item))) acc[key] = (acc[key] ?? 0) + value; return acc }, {})
  const contracts = items.map((item) => item.frameContract ?? null).filter((item): item is NonNullable<typeof item> => item !== null)
  const finalOf = (contract: (typeof contracts)[number]) => contract.afterRetry ?? contract.initial
  return {
    analysisCalls: items.length,
    ...(contracts.length > 0 ? { frameContract: {
      calls: contracts.length,
      initialComplete: contracts.filter((contract) => contract.initial.status === "COMPLETE").length,
      finalComplete: contracts.filter((contract) => finalOf(contract).status === "COMPLETE").length,
      retries: contracts.filter((contract) => contract.retryAttempted).length,
      expectedFrames: contracts.reduce((total, contract) => total + contract.initial.expectedFrameCount, 0),
      initialMissingFrames: contracts.reduce((total, contract) => total + contract.initial.missingFrameCount, 0),
      finalMissingFrames: contracts.reduce((total, contract) => total + finalOf(contract).missingFrameCount, 0),
      emptyFrames: contracts.reduce((total, contract) => total + finalOf(contract).emptyFrameCount, 0),
      duplicateFrames: contracts.reduce((total, contract) => total + finalOf(contract).duplicateFrameCount, 0),
      duplicateFrameObservationsDropped: contracts.reduce((total, contract) => total + finalOf(contract).duplicateFrameObservationsDropped, 0),
      unexpectedFrames: contracts.reduce((total, contract) => total + finalOf(contract).unexpectedFrameCount, 0),
      exampleRefEchoed: contracts.reduce((total, contract) => total + finalOf(contract).exampleRefEchoed, 0),
    } } : {}),
    semanticFramesCreated: sum((item) => item.semanticFramesCreated),
    framesNotReturned: sum((item) => item.framesNotReturned),
    framesEmpty: sum((item) => item.framesEmpty),
    interactionsWithFindings: sum((item) => item.interactionsWithFindings),
    interactionsWithoutMaterialFindings: sum((item) => item.interactionsWithoutMaterialFindings),
    customerNeedsCount: sum((item) => item.customerNeedsCount),
    unresolvedNeedsCount: sum((item) => item.unresolvedNeedsCount),
    partialNeedsCount: sum((item) => item.partialNeedsCount),
    strengthFindingsCount: sum((item) => item.strengthFindingsCount),
    riskFindingsCount: sum((item) => item.riskFindingsCount),
    proceduralQuestionsCount: sum((item) => item.proceduralQuestionsCount),
    procedureAssertionsCount: sum((item) => item.procedureAssertionsCount),
    crossInteractionPatternsCount: sum((item) => item.crossInteractionPatternsCount),
    patternsBySupport: merge((item) => item.patternsBySupport),
    patternsByKind: merge((item) => item.patternsByKind),
    observationsDropped: sum((item) => item.observationsDropped),
    findingsDropped: sum((item) => item.findingsDropped),
    patternsDropped: sum((item) => item.patternsDropped),
    contractViolations: items.filter((item) => item.contractViolation !== "NONE").length,
    phaseAFindings: sum((item) => item.phaseAFindings ?? 0),
    phaseBPromotedFindings: sum((item) => item.phaseBPromotedFindings ?? 0),
    promotionRejectedCount: sum((item) => item.promotionRejectedCount ?? 0),
    interactionFrictionFindingsCount: sum((item) => item.interactionFrictionFindingsCount ?? 0),
    findingKindDowngraded: sum((item) => item.findingKindDowngraded ?? 0),
    interactionEventsCount: sum((item) => item.interactionEventsCount ?? 0),
    patternsByScope: merge((item) => item.patternsByScope ?? {}),
    frictionDowngradedByCompleteAnswer: sum((item) => item.frictionDowngradedByCompleteAnswer ?? 0),
    contradictionDowngradedByCorrection: sum((item) => item.contradictionDowngradedByCorrection ?? 0),
    proceduralConsistencyFindings: sum((item) => item.proceduralFindings?.consistent ?? 0),
    proceduralDivergenceFindings: sum((item) => item.proceduralFindings?.divergence ?? 0),
    proceduralQuestionFindings: sum((item) => item.proceduralFindings?.question ?? 0),
    patternsByOwnership: merge((item) => item.patternsByOwnership ?? {}),
    patternsScopeCappedByOwnership: sum((item) => item.patternsScopeCappedByOwnership ?? 0),
  }
}

/**
 * V1.4.5 (§48) — FUNIL PROCEDIMENTAL da execução: afirmação normativa → regra da base com trecho literal → comparação
 * determinística → estado. Somado das entradas de `analyze_interactions`; null quando nenhuma afirmação normativa existiu.
 */
export function proceduralCoverageSummaryOf(ledger: LedgerEntry[]): import("../domain/tool-trace.js").ProceduralCoverageSummary | null {
  const items = ledger.map((entry) => entry.signals?.interactionAnalysis?.procedural ?? null).filter((item): item is NonNullable<typeof item> => item !== null)
  if (items.length === 0) return null
  const sum = (pick: (item: (typeof items)[number]) => number) => items.reduce((total, item) => total + pick(item), 0)
  const byStatus = items.reduce<Record<string, number>>((acc, item) => { for (const [key, value] of Object.entries(item.byStatus ?? {})) acc[key] = (acc[key] ?? 0) + value; return acc }, {})
  return {
    analysisCalls: items.length,
    assertionsDeclared: sum((item) => item.assertions),
    quantitiesParsedAssertion: sum((item) => item.quantitiesParsed),
    knowledgeExcerptsAvailable: Math.max(...items.map((item) => item.excerptsAvailable)),
    rulesDeclared: sum((item) => item.rulesDeclared),
    rulesVerified: sum((item) => item.rulesVerified),
    rulesRejected: sum((item) => item.rulesRejected),
    evaluations: sum((item) => item.evaluations),
    byStatus,
    coverage: items.every((item) => item.coverage === "COMPLETE") ? "COMPLETE" : "PARTIAL",
    knowledgeSource: items.map((item) => item.knowledgeSource).find((source) => source !== "NONE") ?? "NONE",
  }
}

/**
 * V1.4.6 (§39) — RESULTADO × ATRIBUIÇÃO agregados das entradas de `analyze_interactions`: quantas necessidades ficaram
 * abertas, de quê elas dependem, quantas atribuições ao operador foram RECUSADAS por falta de ponte e o dono dos patterns.
 */
export function outcomeAttributionSummaryOf(ledger: LedgerEntry[]): import("../domain/tool-trace.js").OutcomeCoverageSummary | null {
  const items = ledger.map((entry) => entry.signals?.interactionAnalysis?.outcome ?? null).filter((item): item is NonNullable<typeof item> => item !== null)
  if (items.length === 0) return null
  const sum = (pick: (item: (typeof items)[number]) => number) => items.reduce((total, item) => total + pick(item), 0)
  const merge = (pick: (item: (typeof items)[number]) => Record<string, number>) => items.reduce<Record<string, number>>((acc, item) => { for (const [key, value] of Object.entries(pick(item))) acc[key] = (acc[key] ?? 0) + value; return acc }, {})
  return {
    analysisCalls: items.length,
    needsTotal: sum((item) => item.needsTotal),
    needsOpen: sum((item) => item.needsOpen),
    attributionsDeclared: sum((item) => item.attributionsDeclared),
    attributionsAccepted: sum((item) => item.attributionsAccepted),
    byAttribution: merge((item) => item.byAttribution),
    agentAttributionRejected: sum((item) => item.agentAttributionRejected),
    bridges: merge((item) => item.bridges),
    findingsNeutralized: sum((item) => item.findingsNeutralized),
    findingsAgentAttributed: sum((item) => item.findingsAgentAttributed),
    patternsByOwnership: merge((item) => item.patternsByOwnership),
    patternsScopeCappedByOwnership: sum((item) => item.patternsScopeCappedByOwnership),
    sidecarStatus: items.map((item) => item.sidecarStatus).find((status) => status !== "OK") ?? "OK",
  }
}
