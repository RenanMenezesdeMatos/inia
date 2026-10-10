import { createHash } from "node:crypto"
import { indicatorPeriodKey, PERIOD_ALREADY_DELIVERED } from "../domain/delivery-guards.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { signalLabelOf, type DiagnosisRuntimeParameters, type PopulationSignal } from "../../indicator-diagnosis/domain/diagnostic-strategy.js"
import type { InvestigationCapability } from "../../investigation/domain/capabilities.js"
import { extractDecisionSignals } from "../../investigation/domain/decision-critical-facts.js"
import { HandleRegistry, isHandle, projectForModel } from "../../investigation/domain/handle-registry.js"
import { ANALYSIS_DIMENSIONS } from "../../investigation/domain/analysis-dimensions.js"
import { summarizeToolResult } from "../../investigation/application/tool-summaries.js"
import type { ToolResult } from "../../investigation/domain/tool-output.js"
import { startOfLocalDate } from "../../workflows/application/time-window.js"
import { formatIndicatorValue } from "../../indicators/domain/indicator-definition.js"
import {
  compareSegments,
  concludeInvestigation,
  criterionPatternsOf,
  dailyProfileOf,
  durationComparisonOf,
  localizationVolumeGapOf,
  patternConfirmationCandidatesOf,
  PERIOD_SAMPLE_VERSION,
  periodSampleOf,
  practiceCoverageOf,
  REFERENCE_MINIMUM_ASSESSMENTS,
  REFERENCE_MINIMUM_CONTRIBUTORS,
  referencePracticesOf,
  selectFocusSegments,
  topReferenceMembers,
  type Direction,
  type IndicatorInvestigation,
  type InvestigationToolRecord,
  type Localization,
  type PeriodSampleRecord,
  type PeriodSampleSubject,
  type PlannerQuestionRecord,
  type OfficialFacts,
  type ProxyKind,
  type ReferenceGroup,
  type SampleBasis,
  type SegmentEvidence,
  type SegmentInput,
} from "../domain/indicator-investigation.js"
import {
  contractStepsOf,
  CONTEXT_TOOLS,
  diagnosticSignalsOf,
  engineToolAvailability,
  ENGINE_INVESTIGATION_TOOLS_VERSION,
  ENGINE_NATIVE_TOOLS,
  ENGINE_PLANNER_SYSTEM_PROMPT,
  ENGINE_TOOL_SPECS,
  FREE_CALL_TOOLS,
  INVESTIGATION_CLOSURE_VERSION,
  MAX_CALLS_PER_ROUND,
  MAX_PLANNER_QUESTIONS,
  openQuestionsOf,
  parsePlannerDecision,
  plannerArgsView,
  plannerResponseSchemaFor,
  renderPlannerUserTurn,
  resolveEngineCapabilities,
  stopReasonOf,
  WHERE_TOOLS,
  type ContractSteps,
  type EngineNativeTool,
  type EngineToolKey,
  type InvestigationState,
  type OpenQuestion,
  type PlannedCall,
  type PlannerStop,
  type QuestionDisposition,
  type ReusedCatalogTool,
  type SliceQuestionState,
  type StrategyView,
  type ToolLedgerEntry,
  type ToolRefusal,
  validatePlannedArgs,
} from "../domain/investigation-toolbox.js"
import { compactForModel, detailOf, scalarContextOf, perResultBudget, toolOutcomeOf, TOOL_OUTCOME_LABEL, TOOL_RESULT_VIEW_VERSION } from "../domain/tool-result-view.js"
import { effectiveRuleText } from "../domain/criteria-identity.js"
import { buildProcedureContext } from "../domain/procedure.js"
import { analyzedInteractionIds, memoryRowsOf, memoryStateOf, pathStatsOf, pathStatsOfInteractions, segmentsWithMemoryOf, type MemorySnapshot } from "../domain/memory-queries.js"
import { SliceRegistry, slicesFromToolResult, type InvestigationSlice } from "../domain/investigation-slices.js"
import { CALL_ANALYSIS_LOGIC_VERSION, CRITERIA_EXTRACTION_VERSION, INDICATOR_INVESTIGATION_LOGIC_VERSION } from "../domain/versions.js"
import type { CandidateDocument } from "../domain/document-selection.js"
import { NO_SIGNAL, type IndicatorDataPort, type IndicatorMeta } from "../infrastructure/postgres-indicator-data.js"
import type { CatalogToolRunner } from "../infrastructure/catalog-tool-runner.js"
import { AnalysisInProgressError, analyzeCall, CallReviewPendingError, callModel, type AnalyzeCallDeps } from "./analyze-call.js"
import { isBudgetExhausted } from "./engine-meter.js"
import type { AnalysisTrigger, FeedbackMemoryStore, ModelCallMetric } from "./ports.js"

/**
 * CASO DE USO: INVESTIGAR UM INDICADOR (`INDICATOR_INVESTIGATION_V3`) — fatos do código, perguntas abertas, ferramentas escolhidas
 * pela IA só para o que continua aberto, parada explícita.
 *
 *   fato oficial → ONDE mudou (assunto/período; dia com medição diária) e o que a MEMÓRIA já sabe (só conclusões confirmadas) →
 *   PERGUNTAS ABERTAS (onde mudou? é da pessoa ou do contexto? o que se vê nas chamadas do recorte? o dado é confiável? que conduta
 *   sustenta o resultado bom?) → para as materiais, a IA escolhe consultas entre as ferramentas PERMITIDAS (até 3 rodadas, teto de
 *   consultas e de análises de chamada, orçamento de modelo compartilhado) → conclusão por código com os resultados das ferramentas
 *   (lacuna individual × grupo comparável, qualidade do dado) e as limitações.
 * Sem pergunta material aberta = nenhuma chamada de modelo (ex.: resultado dentro da meta com a memória já sustentando).
 * Estratégia em modo FIXO (escolha explícita do admin) = passos das chaves, sem planejamento por IA, pelo MESMO executor.
 * Analisar chamadas = a MESMA análise da monitoria, gravada na MESMA memória (reuso por chave; nada é recontado).
 *
 * VALIDADE E REUSO: a chave da investigação representa as FONTES (oficial, estratégia, especialista, lógica, base, chamadas e
 * transcrições, memória, pares, permissões efetivas). Mesmas fontes = reuso; mudança relevante = nova revisão; uma execução antiga
 * que termina depois não substitui a mais nova. Abrir uma tela nunca investiga.
 */
export const DEFAULT_MAX_CALL_ANALYSES = 8
export const DEFAULT_SAMPLE_TARGET = 5
export const PEER_CALLS_PER_MEMBER = 2
/** Análises de chamadas de COLEGAS para a referência, à parte do orçamento das chamadas da pessoa (a referência nunca tira a amostra
 * dela, e a dela nunca deixa a referência vazia). */
export const DEFAULT_MAX_PEER_CALL_ANALYSES = 6
export const INVESTIGATION_LEASE_SECONDS = 900
export const DEFAULT_MAX_TOOL_CALLS = 10
/** Rodadas de planejamento: 4 por padrão (descoberta → aprofundar → corrigir/detalhar → parar), teto 6. Cada rodada é UMA chamada de modelo
 * e passa pelo orçamento da execução, que guarda a reserva da redação. */
export const DEFAULT_MAX_PLANNING_ROUNDS = 4
export const MAX_PLANNING_ROUNDS_CAP = 6
const FIND_INTERACTIONS_LIMIT = 15

export type InvestigationTarget = { kind: "MEASUREMENT"; measurementId: string } | { kind: "OFFICIAL_CLOSING"; indicatorCode: string; referencePeriod?: string | null } | { kind: "PRV_CLOSING"; referencePeriod?: string | null }
export type InvestigateIndicatorRequest = {
  organizationId: string
  personId: string
  agentId: string | null
  agentConfiguredAt: string | null
  enrollmentId: string | null
  target: InvestigationTarget
  trigger: AnalysisTrigger
  now: Date
  /** Restrição do nó do Workflow ("Ferramentas nesta execução") — ausente/null = as do Agent; nunca concede o que o Agent não tem. */
  allowedCapabilities?: InvestigationCapability[] | null
  /** `ONE_INDICATOR_FEEDBACK_PER_PERIOD_V1`: false só para SIMULAÇÃO ("Testar diagnóstico", avaliação) — nada é entregue nelas. */
  skipDeliveredPeriods?: boolean
}
export type InvestigationRef = { runId: string; investigationId: string | null; reused: boolean; indicatorCode: string; periodLabel: string; conclusion: IndicatorInvestigation["conclusion"] | null }
export type InvestigateIndicatorResult = { investigations: InvestigationRef[]; skippedReason: string | null }

export type InvestigateIndicatorDeps = {
  memory: FeedbackMemoryStore
  data: IndicatorDataPort
  analyze: AnalyzeCallDeps
  strategy: (organizationId: string, enrollmentId: string | null, indicatorId: string) => Promise<DiagnosisRuntimeParameters>
  now: () => Date
  /** Teto de análises de chamada por investigação (padrão 8; a estratégia pode reduzir). */
  maxCallAnalyses?: number
  /** Análises de chamadas de colegas para o grupo de referência (padrão `DEFAULT_MAX_PEER_CALL_ANALYSES`). */
  maxPeerCallAnalyses?: number
  /** false = nunca analisa chamadas de COLEGAS (só agregados já existentes na memória) — ensaio restrito a uma pessoa. */
  peerCallAnalyses?: boolean
  /** Ferramentas do catálogo de investigação (produção: banco). Ausente = só as ferramentas do próprio motor. */
  tools?: CatalogToolRunner
  maxToolCalls?: number
  maxPlanningRounds?: number
}

export class IndicatorNotInvestigableError extends DomainError {
  constructor(message: string, code: string) {
    super(message, code, 422)
    this.name = "IndicatorNotInvestigableError"
  }
}

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
const spanDays = (start: string, end: string) => Math.round((new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000) + 1
const shortDate = (date: string) => date.slice(5).split("-").reverse().join("/")
const proxyValueOf = (value: number, kind: ProxyKind) => (kind === "DURATION_SECONDS" ? `${Math.round(value)} s` : kind === "SIGNAL_RATE" ? `${(value * 100).toFixed(1)}%` : `${Math.round(value)}`)

/**
 * A métrica das chamadas que aproxima o indicador e o SENTIDO dela. Duração e volume seguem o sentido do próprio indicador; a taxa
 * de chamadas com o sinal segue o que o sinal REPRESENTA, declarado na estratégia (`POPULATION_SIGNAL_V2`): sinal ADVERSO (ex.:
 * `nota_ura` ≤ 2, `rechamada`) = quanto mais chamadas com ele, pior — mesmo num indicador em que "maior é melhor" (NOTA_URA). Sem a
 * declaração (versões anteriores), o sentido do indicador, como antes.
 */
function proxyOf(meta: IndicatorMeta, parameters: DiagnosisRuntimeParameters): { kind: ProxyKind | null; label: string; description: string; signal: PopulationSignal | null; direction: Direction } {
  if (meta.unit === "SECONDS") return { kind: "DURATION_SECONDS", label: "a duração média registrada das chamadas", description: "aproximação pela duração registrada das chamadas, não o valor oficial do indicador.", signal: null, direction: meta.direction }
  const signal = parameters.populationSignal
  if (signal) return { kind: "SIGNAL_RATE", label: `a taxa de chamadas com o sinal "${signalLabelOf(signal)}"`, description: "aproximação pelo sinal registrado nas chamadas, não o valor oficial do indicador.", signal, direction: signal.effect === "ADVERSE" ? "LOWER" : signal.effect === "FAVORABLE" ? "HIGHER" : meta.direction }
  if (meta.unit === "COUNT") return { kind: "VOLUME", label: "o número de chamadas", description: "contagem das chamadas registradas no período.", signal: null, direction: meta.direction }
  return { kind: null, label: "", description: "", signal: null, direction: meta.direction }
}

function windowsOf(official: OfficialFacts, timeZone: string) {
  let startDate = official.periodStart
  const endDate = official.periodEnd
  if (official.sourceKind === "MEASUREMENT" && spanDays(startDate, endDate) < 7) startDate = addDays(endDate, -6)
  const length = spanDays(startDate, endDate)
  const previousLength = official.sourceKind === "OFFICIAL_CLOSING" ? spanDays(addDays(startDate, -1).slice(0, 8) + "01", addDays(startDate, -1)) : Math.max(length, 28)
  const previousEnd = addDays(startDate, -1)
  const previousStart = addDays(previousEnd, -(previousLength - 1))
  const at = (date: string) => startOfLocalDate(date, timeZone)
  return {
    current: { start: at(startDate), end: at(addDays(endDate, 1)), startDate, endDate },
    previous: { start: at(previousStart), end: at(addDays(previousEnd, 1)), startDate: previousStart, endDate: previousEnd },
  }
}
type Windows = ReturnType<typeof windowsOf>

/** A estratégia como o motor a lê: modo DECLARADO pelo admin × estratégia anterior ao bloco de investigação. */
export function strategyViewOf(parameters: DiagnosisRuntimeParameters): StrategyView {
  return {
    configured: parameters.configured,
    mode: !parameters.configured || !parameters.investigation.declared ? "UNDECLARED" : parameters.investigation.mode,
    allowedSteps: [...parameters.investigation.allowedSteps],
    segmentationEnabled: !parameters.configured || parameters.segmentation.enabled,
    segmentationDimensions: parameters.configured ? [...parameters.segmentation.dimensions] : [],
    sampleEnabled: !parameters.configured || parameters.sample.enabled,
    processEnabled: !parameters.configured || parameters.processAssessment,
    peerEnabled: !parameters.configured || parameters.peer.enabled,
  }
}

export async function investigateIndicator(deps: InvestigateIndicatorDeps, request: InvestigateIndicatorRequest): Promise<InvestigateIndicatorResult> {
  const targets: { meta: IndicatorMeta; official: OfficialFacts }[] = []
  if (request.target.kind === "MEASUREMENT") {
    const official = await deps.data.officialFromMeasurement(request.organizationId, request.target.measurementId, request.personId, request.now)
    if (!official) throw new IndicatorNotInvestigableError("Medição não encontrada para o colaborador nesta organização.", "FEEDBACK_INDICATOR_MEASUREMENT_NOT_FOUND")
    const meta = await deps.data.indicatorById(request.organizationId, official.indicatorId)
    targets.push({ meta: meta!, official })
  } else if (request.target.kind === "OFFICIAL_CLOSING") {
    const meta = await deps.data.indicatorByCode(request.organizationId, request.target.indicatorCode)
    if (!meta) return { investigations: [], skippedReason: "INDICATOR_NOT_FOUND" }
    const official = await deps.data.officialFromClosing(request.organizationId, request.personId, meta.id, request.now, request.target.referencePeriod ?? null)
    if (!official) return { investigations: [], skippedReason: "NO_OFFICIAL_CLOSING" }
    targets.push({ meta, official })
  } else {
    const closing = await deps.data.closingIndicators(request.organizationId, request.personId, request.now)
    if (!closing) return { investigations: [], skippedReason: "NO_OFFICIAL_CLOSING" }
    for (const indicatorId of closing.indicatorIds) {
      const meta = await deps.data.indicatorById(request.organizationId, indicatorId)
      const official = meta ? await deps.data.officialFromClosing(request.organizationId, request.personId, indicatorId, request.now, closing.referencePeriod) : null
      if (meta && official) targets.push({ meta, official })
    }
    // `PRV_CLOSING_STRATEGY_SCOPE_V1` (05/10/2026): do fechamento só entram os indicadores com estratégia de diagnóstico PUBLICADA e
    // ATIVA (a versão em vigor no nascimento da execução) — é ela que diz que existe insumo para diagnosticar; os demais ficam fora do
    // feedback até terem estratégia (antes viravam "dados insuficientes" e abstenção).
    const configured: typeof targets = []
    for (const target of targets) if ((await deps.strategy(request.organizationId, request.enrollmentId, target.meta.id)).configured) configured.push(target)
    if (targets.length > 0 && configured.length === 0) return { investigations: [], skippedReason: "NO_INDICATOR_WITH_STRATEGY" }
    // Triagem do fechamento: investiga o que está fora da meta ou piorou; reconhece o que melhorou dentro da meta. Até 3.
    const relevant = configured.filter(({ official }) => official.withinTarget === false || official.movement === "WORSENED" || (official.withinTarget === true && official.movement === "IMPROVED"))
    targets.splice(0, targets.length, ...relevant.sort((a, b) => Number(a.official.withinTarget === true) - Number(b.official.withinTarget === true)).slice(0, 3))
    if (targets.length === 0) return { investigations: [], skippedReason: "NOTHING_TO_INVESTIGATE" }
  }
  // `ONE_INDICATOR_FEEDBACK_PER_PERIOD_V1`: indicador × período já ENTREGUE à pessoa não é investigado de novo (nada é pago) — o
  // feedback desse período já existe. Se nada sobra, a execução encerra com o motivo.
  if (request.skipDeliveredPeriods !== false && targets.length > 0) {
    const delivered = await deps.memory.deliveredIndicatorPeriods(request.organizationId, request.personId)
    const pending = targets.filter(({ official }) => !delivered.has(indicatorPeriodKey(official.code, official.periodStart, official.periodEnd)))
    if (pending.length === 0) return { investigations: [], skippedReason: PERIOD_ALREADY_DELIVERED }
    targets.splice(0, targets.length, ...pending)
  }
  const investigations: InvestigationRef[] = []
  for (const target of targets) investigations.push(await investigateOne(deps, request, target.meta, target.official))
  return { investigations, skippedReason: null }
}

/**
 * CHAVE DE EVIDÊNCIA: o que, se mudar, torna a investigação anterior desatualizada — mesmo com o mesmo valor oficial. Leituras
 * baratas (uma consulta por componente), nenhuma chamada de modelo.
 */
async function evidenceKeyOf(deps: InvestigateIndicatorDeps, request: InvestigateIndicatorRequest, meta: IndicatorMeta, official: OfficialFacts, parameters: DiagnosisRuntimeParameters, windows: Windows, documents: readonly CandidateDocument[], peers: readonly string[], capabilities: readonly string[]): Promise<{ key: string; components: Record<string, unknown> }> {
  const org = request.organizationId
  const person = await deps.memory.currentMemory(org, { personIds: [request.personId], window: windows.current })
  const components: Record<string, unknown> = {
    logic: [INDICATOR_INVESTIGATION_LOGIC_VERSION, CALL_ANALYSIS_LOGIC_VERSION, CRITERIA_EXTRACTION_VERSION, ENGINE_INVESTIGATION_TOOLS_VERSION],
    person: request.personId,
    indicator: meta.id,
    official: [official.sourceKind, official.sourceRef, official.value, official.target, official.previous?.value ?? null, official.periodStart, official.periodEnd],
    strategy: parameters.strategyVersionId ?? "none",
    agent: request.agentId ? `${request.agentId}@${request.agentConfiguredAt ?? ""}` : "none",
    capabilities: [...capabilities].sort(),
    knowledge: documents.map((document) => `${document.documentId}@${document.version}@${document.contentHash}`).sort(),
    calls: [await deps.data.interactionEvidence(org, [request.personId], windows.current, "FULL"), await deps.data.interactionEvidence(org, [request.personId], windows.previous, "FULL")],
    memory: memoryStateOf(person, CALL_ANALYSIS_LOGIC_VERSION).key,
  }
  if (peers.length > 0) {
    const peerMemory = await deps.memory.currentMemory(org, { personIds: peers, window: windows.current })
    components.peers = [await deps.data.interactionEvidence(org, peers, windows.current, "AGGREGATE"), memoryStateOf(peerMemory, CALL_ANALYSIS_LOGIC_VERSION).key]
  }
  return { key: createHash("sha256").update(JSON.stringify(components)).digest("hex"), components }
}

/** Uma análise que a investigação precisava ficou com a revisão PENDENTE por falha técnica (ou em andamento em outra execução):
 * a investigação não é concluída com essa lacuna — a política de nova tentativa do motor a retoma, e só a revisão é refeita. */
export class InvestigationAnalysisPendingError extends DomainError {
  constructor(readonly interactionIds: string[]) {
    super(`A investigação depende de ${interactionIds.length} análise(s) de chamada com revisão pendente — será retomada.`, "FEEDBACK_INVESTIGATION_ANALYSIS_PENDING", 503, { category: "PROVIDER_ERROR", pending: interactionIds.length })
    this.name = "InvestigationAnalysisPendingError"
  }
}

async function investigateOne(deps: InvestigateIndicatorDeps, request: InvestigateIndicatorRequest, meta: IndicatorMeta, official: OfficialFacts): Promise<InvestigationRef> {
  const parameters = await deps.strategy(request.organizationId, request.enrollmentId, meta.id)
  const timeZone = await deps.data.timeZone(request.organizationId)
  const windows = windowsOf(official, timeZone)
  const documents = request.agentId ? await deps.analyze.loadDocuments(request.organizationId, request.agentId, request.now) : []
  const agent = request.agentId ? await deps.analyze.loadAgent(request.organizationId, request.agentId) : null
  const view = strategyViewOf(parameters)
  const capabilities = resolveEngineCapabilities({ agentCapabilities: agent?.investigationCapabilities ?? [], workflowAllowed: request.allowedCapabilities ?? null })
  // Domínio do especialista × domínios permitidos pela estratégia: fora dele, as chamadas não são confrontadas com o procedimento.
  const domainAllowed = !parameters.configured || parameters.allowedBusinessDomainIds.length === 0 || (agent?.businessDomainId !== null && agent?.businessDomainId !== undefined && parameters.allowedBusinessDomainIds.includes(agent.businessDomainId))
  const contract = contractStepsOf({ strategy: view, workflowAllowed: capabilities.workflowAllowed, hasAgent: request.agentId !== null && domainAllowed })
  const placement = await deps.data.placement(request.organizationId, request.personId)
  const comparisonPossible = view.peerEnabled && (contract.reference.allowed || capabilities.capabilities.includes("OPERATIONAL_COMPARISON"))
  const peers = placement?.teamId && comparisonPossible ? await deps.data.teamPeers(request.organizationId, placement.teamId, request.personId) : []
  const before = await evidenceKeyOf(deps, request, meta, official, parameters, windows, documents, peers, capabilities.capabilities)
  const reuse = async (runId: string): Promise<InvestigationRef> => {
    const stored = await deps.memory.getIndicatorInvestigationByRun(request.organizationId, runId)
    return { runId, investigationId: stored?.id ?? null, reused: true, indicatorCode: meta.code, periodLabel: official.periodLabel, conclusion: stored?.investigation.conclusion ?? null }
  }
  // Mesmas fontes que uma investigação COMPLETA (inclusive o estado DEPOIS das análises que ela mesma fez) = reuso. Uma
  // investigação interrompida pelo orçamento não é reutilizável (a chave dela foi liberada ao concluir).
  const reusable = await deps.memory.findCompletedByReuseKey(request.organizationId, "INDICATOR_INVESTIGATION", before.key)
  if (reusable) return reuse(reusable.id)
  const startedAt = deps.now()
  const claim = await deps.memory.claimAnalysis({ organizationId: request.organizationId, kind: "INDICATOR_INVESTIGATION", analysisKey: before.key, personId: request.personId, interactionId: null, indicatorDefinitionId: meta.id, periodStart: official.periodStart, periodEnd: official.periodEnd, agentId: request.agentId, trigger: request.trigger, logicVersion: INDICATOR_INVESTIGATION_LOGIC_VERSION, asOf: startedAt }, startedAt, INVESTIGATION_LEASE_SECONDS)
  if (claim.kind === "IN_PROGRESS") throw new DomainError("A investigação deste indicador está em andamento em outra execução — será retomada.", "FEEDBACK_INVESTIGATION_IN_PROGRESS", 409, { category: "PROVIDER_ERROR" })
  if (claim.kind === "COMPLETED") return reuse(claim.run.id)
  const runId = claim.runId
  const metrics: ModelCallMetric[] = []
  try {
    const investigation = await runInvestigation(deps, request, { meta, official, parameters, view, capabilities, contract, analysisAgentId: domainAllowed ? request.agentId : null, domainAllowed }, runId, windows, documents, peers, metrics)
    const after = await evidenceKeyOf(deps, request, meta, official, parameters, windows, documents, peers, capabilities.capabilities)
    const complete = investigation.completeness?.status !== "INTERRUPTED_BY_BUDGET"
    const saved = await deps.memory.completeIndicatorInvestigation(request.organizationId, runId, {
      investigation,
      reusable: complete,
      provenance: { logicVersion: INDICATOR_INVESTIGATION_LOGIC_VERSION, strategyVersionId: parameters.strategyVersionId, agentId: request.agentId, official: { sourceKind: official.sourceKind, sourceRef: official.sourceRef }, capabilities: { source: capabilities.source, effective: capabilities.capabilities, workflowAllowed: capabilities.workflowAllowed }, contract, evidence: { before: before.components, afterKey: after.key }, reuseKeys: complete ? [...new Set([before.key, after.key])] : [] },
      metrics: { durationMs: deps.now().getTime() - startedAt.getTime(), callAnalyses: investigation.budget.callAnalyses, reusedCalls: investigation.budget.reusedCalls, toolCalls: investigation.tools?.budget.toolCalls ?? 0, plannerRounds: investigation.tools?.planner.rounds ?? 0, modelCalls: metrics.length, planner: metrics.filter((metric) => metric.stage === "INVESTIGATION_PLANNING") },
    }, deps.now())
    return { runId, investigationId: saved.investigationId, reused: false, indicatorCode: meta.code, periodLabel: official.periodLabel, conclusion: investigation.conclusion }
  } catch (error) {
    await deps.memory.failAnalysis(request.organizationId, runId, error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 2_000) : "erro desconhecido", deps.now()).catch(() => undefined)
    throw error
  }
}

/**
 * A regra de um padrão ainda está na base publicada HOJE? Pela IDENTIDADE do critério (`KNOWLEDGE_CRITERIA_V3` — abertura da lista
 * incluída): a chave do critério existe na extração da versão atual = em vigor; não existe = mudou; base indisponível = desconhecido.
 */
async function currentCriterionKeysOf(deps: InvestigateIndicatorDeps, organizationId: string, documents: readonly CandidateDocument[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  for (const document of documents) {
    try {
      const context = buildProcedureContext([{ ...document, selection: "INCLUDED_ALL", relevance: 0 }])
      const lines = [...context.lines.values()].map((line) => ({ lineKey: line.lineKey, heading: line.heading, text: effectiveRuleText(line), position: line.position }))
      const identities = await deps.memory.resolveCriteria(organizationId, { documentId: document.documentId, version: document.version, lines }, async () => {
        const previous = await deps.analyze.loadPreviousVersion(organizationId, document.documentId, document.version)
        if (!previous) return null
        const previousContext = buildProcedureContext([{ ...document, version: previous.version, content: previous.content, contentHash: "", selection: "INCLUDED_ALL", relevance: 0 }])
        return { version: previous.version, lines: [...previousContext.lines.values()].map((line) => ({ lineKey: line.lineKey, heading: line.heading, text: effectiveRuleText(line), position: line.position })) }
      })
      // Só as linhas da versão ATUAL (pela chave da linha — abertura da lista incluída) contam como regra em vigor. A PRÁTICA dessas
      // linhas também (`PRACTICE_IDENTITY_V1`): o padrão agregado pela prática está em vigor se alguma linha atual pede a mesma conduta.
      const currentLines = [...context.lines.values()]
      const practices = await deps.memory.practiceMemberships(organizationId, currentLines.map((line) => line.lineKey))
      out.set(document.documentId, new Set(currentLines.flatMap((line) => {
        const identity = identities.get(line.lineKey)
        const practiceKey = practices.get(line.lineKey)?.practiceKey
        return [...(identity ? [identity.criterionKey] : []), ...(practiceKey ? [practiceKey] : [])]
      })))
    } catch {
      // Sem a identidade atual, a regra fica "desconhecida" (nunca presumida em vigor).
    }
  }
  return out
}
const currentRuleOf = (pattern: { documentId: string; criterionKey: string }, current: ReadonlyMap<string, ReadonlySet<string>>): "IN_FORCE" | "CHANGED" | "UNKNOWN" => {
  const keys = current.get(pattern.documentId)
  return !keys ? "UNKNOWN" : keys.has(pattern.criterionKey) ? "IN_FORCE" : "CHANGED"
}

type Setup = { meta: IndicatorMeta; official: OfficialFacts; parameters: DiagnosisRuntimeParameters; view: StrategyView; capabilities: ReturnType<typeof resolveEngineCapabilities>; contract: ContractSteps; analysisAgentId: string | null; domainAllowed: boolean }
type CallRow = { id: string; startedAt: Date; durationSeconds: number | null }
type AnalyzeOutcome = "ANALYZED" | "REUSED" | "BUDGET" | "FAILED" | "PENDING"
const DETERMINATE = new Set(["MET", "NOT_MET", "PARTIAL"])

async function runInvestigation(deps: InvestigateIndicatorDeps, request: InvestigateIndicatorRequest, setup: Setup, runId: string, windows: Windows, documents: readonly CandidateDocument[], peers: readonly string[], metrics: ModelCallMetric[]): Promise<IndicatorInvestigation> {
  const { meta, official, parameters, view, capabilities, contract, analysisAgentId } = setup
  const org = request.organizationId
  const person = request.personId
  const timeZone = await deps.data.timeZone(org)
  const placement = await deps.data.placement(org, person)
  const proxy = proxyOf(meta, parameters)
  const memoryOf = (personIds: readonly string[]) => deps.memory.currentMemory(org, { personIds, window: windows.current })
  const signalFlagIds = proxy.signal ? await deps.data.resolveSignal(org, proxy.signal) : NO_SIGNAL
  const minimumPerSegment = Math.max(parameters.segmentation.minimumSegmentInteractions ?? 3, 3)
  const minimumAnalyzed = Math.max(parameters.configured ? parameters.sample.minimumAnalyzed : 3, 3)
  const limitations: string[] = []
  const subjectNames = await deps.data.subjectNames(org)
  const labelOf = (key: string) => subjectNames.get(key) ?? key
  const officialAdverse = official.withinTarget === false || official.movement === "WORSENED"
  if (capabilities.removedByWorkflow.length > 0) limitations.push(`O Workflow restringiu as ferramentas desta execução (sem: ${capabilities.removedByWorkflow.join(", ")}).`)
  if (!setup.domainAllowed) limitations.push("O especialista configurado não pertence aos domínios permitidos pela estratégia do indicador: as chamadas não foram confrontadas com o procedimento.")
  if (!request.agentId) limitations.push("Nenhum especialista com base de conhecimento configurado: as chamadas do recorte não puderam ser confrontadas com o procedimento.")
  if (parameters.configured && parameters.processPopulation === "LINKED_PREVIOUS_OF_SIGNAL") limitations.push("A estratégia pede avaliar o atendimento ANTERIOR de cada interação sinalizada, mas os dados não trazem esse vínculo: só os atendimentos do próprio recorte foram considerados.")

  // 1. ONDE mudou (fato do código; o contrato — estratégia e Workflow — decide se a segmentação por assunto vale).
  let segments: Localization["segments"] = []
  let overall: Localization["overall"] = { current: null, previous: null, change: null, direction: "UNKNOWN" }
  let decomposition: Localization["decomposition"] = null
  if (proxy.kind && contract.localization.allowed) {
    const [currentRows, previousRows] = await Promise.all([deps.data.segmentRows(org, [person], windows.current, signalFlagIds), deps.data.segmentRows(org, [person], windows.previous, signalFlagIds)])
    const valueOf = (row: { n: number; avgDuration: number | null; signaled: number }) => (proxy.kind === "DURATION_SECONDS" ? row.avgDuration ?? 0 : proxy.kind === "SIGNAL_RATE" ? (row.n > 0 ? row.signaled / row.n : 0) : row.n)
    const keys = [...new Set([...currentRows, ...previousRows].map((row) => row.key))]
    const inputs: SegmentInput[] = keys.map((key) => {
      const current = currentRows.find((row) => row.key === key)
      const previous = previousRows.find((row) => row.key === key)
      return { key, label: labelOf(key), current: current ? { n: current.n, value: valueOf(current) } : null, previous: previous ? { n: previous.n, value: valueOf(previous) } : null }
    })
    const compared = compareSegments(inputs, proxy.direction, proxy.kind, minimumPerSegment)
    segments = compared.segments
    overall = compared.overall
    decomposition = compared.decomposition
    if (keys.length === 0) limitations.push("Não há chamadas registradas por assunto no período para localizar a mudança.")
    else if (overall.direction === "UNKNOWN") limitations.push(`Volume de chamadas insuficiente para comparar os períodos (${overall.previous?.n ?? 0} no anterior, ${overall.current?.n ?? 0} no atual): não é possível dizer em quais assuntos o resultado mudou.`)
  } else if (!proxy.kind) {
    limitations.push(`O indicador ${meta.name} não se decompõe por assunto com os dados disponíveis (sem métrica de chamada correspondente).`)
  } else {
    limitations.push(`A segmentação por assunto não foi feita nesta execução (${contract.localization.reason}).`)
  }
  const officialAgreement: Localization["officialAgreement"] = official.movement && overall.direction !== "UNKNOWN" && overall.direction !== "STABLE" ? ((official.movement === "WORSENED") === (overall.direction === "WORSE") ? "AGREES" : "DISAGREES") : "UNKNOWN"
  if (officialAgreement === "DISAGREES") limitations.push("A aproximação pelas chamadas não acompanha o sentido do indicador oficial neste período; a localização por assunto é indicativa.")
  let daily: Localization["daily"] = { available: false, points: [], outliers: [], weekdays: [] }
  /** Volume que o indicador mediu em cada dia (denominador), quando registrado — comparabilidade dos recortes por dia. */
  const dailyVolume = new Map<string, number>()
  if (meta.dailySupported) {
    const points = await deps.data.dailyPoints(org, meta.id, person, windows.current, timeZone)
    for (const point of points as { date: string; volume?: number | null }[]) if (typeof point.volume === "number" && point.volume > 0) dailyVolume.set(point.date, point.volume)
    daily = dailyProfileOf(points.map((point) => ({ date: point.date, value: point.value })), meta.direction)
  }
  else limitations.push(`${meta.name} não tem medição diária: não é possível apontar dias específicos.`)
  const focus = selectFocusSegments(segments, official, overall.direction)
  const localization: Localization = {
    proxy: { kind: proxy.kind, label: proxy.label, description: proxy.description },
    windows: { current: { start: windows.current.startDate, end: windows.current.endDate, label: `${shortDate(windows.current.startDate)} a ${shortDate(windows.current.endDate)}` }, previous: { start: windows.previous.startDate, end: windows.previous.endDate, label: `${shortDate(windows.previous.startDate)} a ${shortDate(windows.previous.endDate)}` } },
    overall,
    officialAgreement,
    decomposition,
    segments: segments.slice(0, 12),
    daily,
    focus,
    limitations: [],
  }
  if (proxy.kind && focus.length === 0 && segments.length > 0 && overall.direction !== "UNKNOWN") localization.limitations.push("Nenhum assunto teve mudança material com volume suficiente nos dois períodos.")
  const formatIndicator = (value: number) => formatIndicatorValue(value, meta.unit)

  // 2. RECORTES: a localização do código abre os primeiros; os resultados das ferramentas abrem os seguintes (dia, horário…).
  const sliceRegistry = new SliceRegistry()
  const universes = new Map<string, CallRow[]>()
  const known = new Map<string, { date: string; subject: string | null; durationSeconds: number | null; slices: Set<string> }>()
  const handles = new HandleRegistry()
  const registerCalls = (rows: readonly CallRow[], subject: string | null, sliceRef: string | null) => {
    for (const row of rows) {
      handles.register("I", row.id)
      const entry = known.get(row.id) ?? { date: row.startedAt.toISOString().slice(0, 10), subject, durationSeconds: row.durationSeconds, slices: new Set<string>() }
      if (sliceRef) entry.slices.add(sliceRef)
      if (!entry.subject && subject) entry.subject = subject
      known.set(row.id, entry)
    }
  }
  const orderFor = (slice: InvestigationSlice): "LONGEST" | "SIGNALED" | "TEMPORAL" => (proxy.kind === "DURATION_SECONDS" && slice.adverse ? "LONGEST" : proxy.kind === "SIGNAL_RATE" ? "SIGNALED" : "TEMPORAL")
  /** Recorte novo: seleciona as chamadas COMPATÍVEIS (mesmos filtros, mesma janela, com transcrição) — a memória delas é lida no estado. */
  const openSlice = async (candidate: Parameters<SliceRegistry["add"]>[0]): Promise<InvestigationSlice | null> => {
    const added = sliceRegistry.add(candidate)
    if (!added) return null
    if (added.created) {
      const rows = await deps.data.sliceInteractions(org, person, windows.current, added.slice.filters, orderFor(added.slice), signalFlagIds, timeZone)
      universes.set(added.slice.ref, rows)
      // COMPARABILIDADE (fato do sistema, para decidir se vale aprofundar): num recorte por dia, quantas chamadas gravadas com transcrição
      // o dia tem frente ao volume que o indicador mediu — poucas chamadas gravadas de um volume grande não explicam o dia.
      const day = added.slice.filters.length === 1 && added.slice.filters[0]!.dimension === "DAY" ? added.slice.filters[0]!.value : null
      if (day) added.slice.observation = `${added.slice.observation} Chamadas gravadas com transcrição nesse dia: ${rows.length}${dailyVolume.has(day) ? `; volume medido pelo indicador no dia: ${dailyVolume.get(day)}` : ""}.`
      const subject = added.slice.filters.find((filter) => filter.dimension === "SUBJECT")?.label ?? null
      registerCalls(rows, subject, added.slice.ref)
    }
    return added.slice
  }
  for (const segment of focus) {
    const comparison = segments.find((entry) => entry.key === segment.key)
    await openSlice({ filters: [{ dimension: "SUBJECT", value: segment.key, label: segment.label }], reason: segment.reason, adverse: segment.reason !== "IMPROVED", origin: { kind: "LOCALIZATION", ref: null, tool: null, round: 0 }, observation: comparison?.current && comparison.previous && proxy.kind ? `${proxy.label} no assunto ${segment.label}: ${proxyValueOf(comparison.previous.value, proxy.kind)} (${comparison.previous.n} chamadas) → ${proxyValueOf(comparison.current.value, proxy.kind)} (${comparison.current.n} chamadas).` : `Assunto ${segment.label} ${segment.reason === "IMPROVED" ? "melhorou" : "piorou"} entre os períodos.` })
  }
  // Dia fora do padrão da PRÓPRIA medição diária abre recorte mesmo com o mês dentro da meta ou melhor (`INVESTIGATION_CLOSURE_V1`):
  // o resultado do mês é contexto — não mostra que o problema localizado deixou de existir. Aprofundar ou não é decisão do
  // planejador (ou fica registrado sem ferramenta, no plano do contrato).
  for (const day of daily.outliers.slice(0, 2)) await openSlice({ filters: [{ dimension: "DAY", value: day.date, label: shortDate(day.date) }], reason: "ATYPICAL_DAY", adverse: true, origin: { kind: "DAILY_PROFILE", ref: null, tool: null, round: 0 }, observation: `Dia ${shortDate(day.date)} fora do padrão da própria medição diária: ${formatIndicator(day.value)}${daily.median !== undefined ? ` contra a mediana de ${formatIndicator(daily.median)} dos dias do período` : ""}.` })
  const hasInteractions = (overall.current?.n ?? 0) > 0 || [...universes.values()].some((universe) => universe.length > 0) || !(await deps.data.interactionEvidence(org, [person], windows.current, "AGGREGATE")).startsWith("0:")

  // 3. FERRAMENTAS: o que está disponível (capacidades do Agent ∩ Workflow ∩ estratégia ∩ dados) e quem conduz.
  const availability = engineToolAvailability({ capabilities: capabilities.capabilities, strategy: view, hasAgent: analysisAgentId !== null, hasKnowledge: documents.length > 0, peerCallAnalysesAllowed: deps.peerCallAnalyses !== false, hasInteractions })
  const available = new Set(availability.filter((entry) => entry.available && (deps.tools || (ENGINE_NATIVE_TOOLS as readonly string[]).includes(entry.tool))).map((entry) => entry.tool))
  const plan: "PLANNER" | "CONTRACT" = view.mode === "FIXED" || available.size === 0 ? "CONTRACT" : "PLANNER"
  const planReason = view.mode === "FIXED" ? "STRATEGY_FIXED" : available.size > 0 ? "INVESTIGATION_TOOLS" : capabilities.source === "NONE_CONFIGURED" ? "NO_INVESTIGATION_CAPABILITIES" : "NO_AVAILABLE_TOOL"
  const maxCalls = Math.min(deps.maxCallAnalyses ?? DEFAULT_MAX_CALL_ANALYSES, parameters.configured ? parameters.sample.maxInteractions : DEFAULT_MAX_CALL_ANALYSES)
  const sampleTarget = Math.min(Math.max(parameters.sample.maxInteractions ?? DEFAULT_SAMPLE_TARGET, 3), 8)
  const maxToolCalls = deps.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS
  const maxRounds = Math.max(1, Math.min(deps.maxPlanningRounds ?? DEFAULT_MAX_PLANNING_ROUNDS, MAX_PLANNING_ROUNDS_CAP))
  const ledger: ToolLedgerEntry[] = []
  /** Decisões do planejador sobre perguntas de recorte ao parar (todas registradas; só as aceitas pelo código valem no estado). */
  const dispositions: QuestionDisposition[] = []
  let callAnalyses = 0
  let peerCallAnalyses = 0
  const maxPeerCalls = Math.max(0, deps.maxPeerCallAnalyses ?? DEFAULT_MAX_PEER_CALL_ANALYSES)
  let reusedCalls = 0
  let stoppedBy: string | null = null
  let modelBudgetHit = false
  let lastReference: ReferenceGroup | null = null
  const analyzeFailures: unknown[] = []
  let peerAnalyzeFailures = 0
  const pendingTechnical = new Set<string>()
  const analyzedNow = new Set<string>()
  const allowedDimensions = view.segmentationDimensions.length > 0 ? ANALYSIS_DIMENSIONS.filter((dimension) => view.segmentationDimensions.includes(dimension)) : [...ANALYSIS_DIMENSIONS]
  const windowOf = (value: unknown) => (value === "PREVIOUS" ? windows.previous : windows.current)
  const periodOf = (value: unknown) => {
    const window = windowOf(value)
    return { from: window.startDate, to: window.endDate }
  }

  /** Uma chamada: memória primeiro (já analisada = reaproveitada, sem custo); senão a MESMA análise da monitoria. */
  const analyzeOne = async (interactionId: string, collaboratorId: string, reason: string, pool: "PERSON" | "PEER" = "PERSON"): Promise<AnalyzeOutcome> => {
    const done = analyzedInteractionIds(await deps.memory.currentMemory(org, { personIds: [collaboratorId], interactionIds: [interactionId] }), CALL_ANALYSIS_LOGIC_VERSION)
    if (done.has(interactionId)) {
      reusedCalls += 1
      return "REUSED"
    }
    if (pool === "PEER" ? peerCallAnalyses >= maxPeerCalls : callAnalyses >= maxCalls) {
      if (pool === "PERSON") stoppedBy = stoppedBy ?? "CALL_ANALYSIS_BUDGET"
      return "BUDGET"
    }
    const count = () => {
      if (pool === "PEER") peerCallAnalyses += 1
      else callAnalyses += 1
    }
    try {
      const result = await analyzeCall({ ...deps.analyze }, { organizationId: org, interactionId, collaboratorId, agentId: analysisAgentId, trigger: { kind: "INDICATOR_INVESTIGATION", selectionReason: reason, parentRunId: runId, enrollmentId: request.enrollmentId } })
      if (result.reused) {
        reusedCalls += 1
        return "REUSED"
      }
      count()
      if (pool === "PERSON") analyzedNow.add(interactionId)
      return "ANALYZED"
    } catch (error) {
      if (isBudgetExhausted(error)) {
        stoppedBy = "MODEL_BUDGET"
        modelBudgetHit = true
        return "BUDGET"
      }
      if (error instanceof CallReviewPendingError || error instanceof AnalysisInProgressError) {
        if (error instanceof CallReviewPendingError) count()
        // Chamada de COLEGA pendente só fica fora da referência — nunca suspende a investigação da pessoa.
        if (pool === "PERSON") pendingTechnical.add(interactionId)
        return "PENDING"
      }
      count()
      if (pool === "PERSON") analyzeFailures.push(error)
      else peerAnalyzeFailures += 1
      return "FAILED"
    }
  }

  /**
   * Grupo de referência (`REFERENCE_GROUP_V2`): primeiro os colegas com melhor resultado NO ASSUNTO (quando a aproximação pelas chamadas
   * existe); se esse grupo não tem avaliações suficientes para comparar práticas, os colegas com melhor resultado OFICIAL no indicador
   * no mesmo período — com a limitação dita. A segunda opção só lê a memória que já existe (nenhuma chamada de colega é analisada por
   * ela). Mínimos: os do produto ou os da estratégia, o que for maior.
   */
  const referenceFor = async (segmentKey: string, segmentLabel: string): Promise<ReferenceGroup | null> => {
    if (!placement?.teamId || peers.length === 0) return null
    const personPatterns = criterionPatternsOf(memoryRowsOf(await memoryOf([person]), CALL_ANALYSIS_LOGIC_VERSION, segmentKey, [person]))
    const minimums = parameters.configured ? { assessments: parameters.peer.minimumObservedInteractions, contributors: parameters.peer.minimumContributors } : undefined
    const minimumPopulation = parameters.configured ? Math.max(4, parameters.peer.minimumPopulation) : 4
    const needAssessments = Math.max(REFERENCE_MINIMUM_ASSESSMENTS, minimums?.assessments ?? 0)
    const needContributors = Math.max(REFERENCE_MINIMUM_CONTRIBUTORS, minimums?.contributors ?? 0)
    const peerAnalysesBefore = peerCallAnalyses
    let chosenMembers: string[] = []
    // `PEER_ANALYSIS_AUTHORIZATION_V1`: chamada de colega analisada (custa IA) só com a comparação AUTORIZADA — estratégia publicada
    // com pares ligados e o Workflow sem restringir a comparação (o passo `reference` do contrato). Sem isso, `reference_practices`
    // pedida pelo planejador continua lendo só a memória que já existe. Dev 05/10/2026: execução sem estratégia (sem pino) pagou 12
    // análises de colegas por `reference_practices` do planejador enquanto o passo do contrato era recusado ("sem estratégia").
    const peerAnalysisAllowed = contract.reference.allowed && analysisAgentId !== null && view.sampleEnabled && deps.peerCallAnalyses !== false && (contract.callAnalysis.allowed || capabilities.capabilities.includes("INTERACTION_ANALYSIS"))
    const referenceLimitations: string[] = []
    const groupOf = async (basis: "SUBJECT_METRIC" | "OVERALL_INDICATOR") => {
      if (basis === "SUBJECT_METRIC") {
        const peerRows = (await deps.data.segmentRows(org, peers, windows.current, signalFlagIds)).filter((row) => row.key === segmentKey)
        return topReferenceMembers(peerRows.map((row) => ({ personId: row.personId, n: row.n, value: proxy.kind === "DURATION_SECONDS" ? row.avgDuration ?? 0 : row.n > 0 ? row.signaled / row.n : 0 })), proxy.direction, minimumPerSegment, needContributors)
      }
      const values = await deps.data.peerOfficialValues(org, peers, meta.id, official.referencePeriod!)
      return topReferenceMembers(values.map((value) => ({ ...value, n: minimumPerSegment })), meta.direction, minimumPerSegment, needContributors)
    }
    const order: ("SUBJECT_METRIC" | "OVERALL_INDICATOR")[] = [...(proxy.kind === "DURATION_SECONDS" || proxy.kind === "SIGNAL_RATE" ? ["SUBJECT_METRIC" as const] : []), ...(official.referencePeriod ? ["OVERALL_INDICATOR" as const] : [])]
    let chosen: ReferenceGroup | null = null
    let firstPopulation = 0
    for (const [index, basis] of order.entries()) {
      const { members, population } = await groupOf(basis)
      if (index === 0) firstPopulation = population
      if (members.length === 0 || population < minimumPopulation) {
        if (basis === "SUBJECT_METRIC") referenceLimitations.push(population > 0 ? `O grupo de colegas comparáveis no assunto ${segmentLabel} é pequeno demais (${population}) para uma comparação que preserve a privacidade.` : `Não há colegas comparáveis com dados suficientes no assunto ${segmentLabel} nesse período.`)
        continue
      }
      let rows = memoryRowsOf(await memoryOf(members), CALL_ANALYSIS_LOGIC_VERSION, segmentKey, members)
      // `REFERENCE_GROUP_V3`: com memória insuficiente, analisa chamadas do assunto dos colegas do grupo — no grupo escolhido (por
      // assunto ou pelo resultado oficial), na ordem do resultado, pulando quem não tem chamada no assunto, até os mínimos de chamadas e
      // de colegas (ou o orçamento próprio das análises de colegas). Ensaio da V14: com 2 chamadas por colega em profundidade, 6
      // análises davam 3 colegas — abaixo dos 4 da estratégia, nenhuma prática sairia.
      const coverage = () => ({ calls: new Set(rows.map((row) => row.interactionId)).size, contributors: new Set(rows.map((row) => row.personId)).size })
      // A referência serve para comparar onde ELA falha: o mínimo vale para cada prática em que ela não cumpriu (rodada real V14: prazo
      // ficou com 4 de 5 avaliações no grupo porque a parada olhava o total de chamadas, não a prática).
      const targets = personPatterns.filter((pattern) => pattern.notMet + pattern.partial > 0).map((pattern) => pattern.criterionKey)
      const targetsCovered = () => targets.every((key) => practiceCoverageOf(rows, key).eligible >= needAssessments && practiceCoverageOf(rows, key).contributors >= needContributors)
      const enough = () => coverage().calls >= needAssessments && coverage().contributors >= needContributors && targetsCovered()
      // Em LARGURA: uma chamada de cada colega primeiro (os mínimos pedem colegas diferentes), depois a segunda de cada um.
      if (peerAnalysisAllowed && !enough()) {
        const reason = basis === "SUBJECT_METRIC" ? `colega com melhor resultado no assunto ${segmentLabel}` : `colega com melhor resultado oficial de ${meta.name}`
        const callsOf = new Map<string, { id: string }[]>()
        const stop = () => enough() || peerCallAnalyses >= maxPeerCalls || modelBudgetHit
        for (let pass = 0; pass < PEER_CALLS_PER_MEMBER && !stop(); pass++) {
          for (const member of members) {
            if (stop()) break
            if (!callsOf.has(member)) callsOf.set(member, await deps.data.segmentInteractions(org, member, windows.current, segmentKey, "TEMPORAL", signalFlagIds))
            const entry = callsOf.get(member)![pass]
            if (!entry) continue
            await analyzeOne(entry.id, member, `Referência comparável para ${meta.name}: ${reason} (${official.periodLabel}).`, "PEER")
            rows = memoryRowsOf(await memoryOf(members), CALL_ANALYSIS_LOGIC_VERSION, segmentKey, members)
          }
        }
      }
      chosenMembers = members
      const practices = referencePracticesOf(rows, personPatterns, minimums)
      const calls = new Set(rows.map((row) => row.interactionId)).size
      if (practices.length === 0) {
        if (basis === "SUBJECT_METRIC") referenceLimitations.push(`Os ${members.length} colegas com melhor resultado no assunto ${segmentLabel} ainda não têm avaliações suficientes das chamadas (${calls}) para comparar práticas.`)
        chosen = chosen ?? { basis, segmentKey, segmentLabel, population, members: members.length, practices: [], limitations: [] }
        continue
      }
      if (peerCallAnalyses === peerAnalysesBefore) referenceLimitations.push("A comparação com colegas usou só avaliações que já existiam (nenhuma chamada de colega foi analisada para ela nesta execução).")
      if (basis === "OVERALL_INDICATOR") referenceLimitations.push(`O grupo de referência são os ${members.length} colegas com melhor resultado oficial de ${meta.name} em ${official.periodLabel}, não o melhor resultado nesse assunto; a comparação usa as chamadas deles no assunto ${segmentLabel}.`)
      chosen = { basis, segmentKey, segmentLabel, population, members: members.length, practices, limitations: [] }
      break
    }
    if (!chosen) return { basis: "UNAVAILABLE", segmentKey, segmentLabel, population: firstPopulation, members: 0, practices: [], limitations: referenceLimitations.length > 0 ? referenceLimitations : ["Não há colegas comparáveis com dados suficientes nesse assunto e período."] }
    if (chosen.practices.length === 0) referenceLimitations.push("Ainda não há avaliações suficientes das chamadas do grupo de referência nesse assunto para comparar práticas.")
    // `REFERENCE_DURATION_V1`: onde está a diferença de tempo (duração registrada no assunto), nunca por quê.
    let durationComparison: ReferenceGroup["durationComparison"] = null
    if (proxy.kind === "DURATION_SECONDS" && chosenMembers.length > 0) {
      const rowsOf = async (ids: readonly string[]) => (await deps.data.segmentRows(org, ids, windows.current, signalFlagIds)).filter((row) => row.key === segmentKey)
      const own = (await rowsOf([person]))[0] ?? null
      durationComparison = durationComparisonOf(own ? { avgDuration: own.avgDuration, n: own.n } : null, (await rowsOf(chosenMembers)).map((row) => ({ avgDuration: row.avgDuration, n: row.n })))
    }
    return { ...chosen, limitations: [...new Set(referenceLimitations)], ...(durationComparison ? { durationComparison } : {}) }
  }

  /** Valores DINÂMICOS do contrato dos argumentos: dimensões da estratégia e assuntos dos recortes já localizados nesta execução. */
  const argConfig = () => ({ allowedDimensions, subjectSlices: [...new Set(sliceRegistry.list().filter((slice) => slice.filters.length === 1 && slice.filters[0]!.dimension === "SUBJECT").map((slice) => String(slice.filters[0]!.value)))], resultRefs: [...lastData.keys()] })
  /** Chamadas de um recorte (R-n) ou, sem recorte, de um assunto — só as já registradas nesta execução. */
  const sliceIdsOf = (ref: unknown): Set<string> | null => (typeof ref === "string" && universes.has(ref) ? new Set((universes.get(ref) ?? []).map((row) => row.id)) : null)

  /**
   * Executa UMA consulta (do planejador ou do contrato): permissão → tradução → execução → registro → recortes que o resultado
   * revela. A permissão é checada ANTES de qualquer leitura ou modelo; pedido fora da permissão nunca roda.
   */
  const execute = async (call: PlannedCall, round: number, via: "PLANNER" | "CONTRACT"): Promise<{ entry: ToolLedgerEntry; data: unknown }> => {
    const ref = `F${ledger.length + 1}`
    const base = { ref, round, question: call.question, requestedArgs: call.args, cached: false, signals: null, via, scope: scopeOfCall(call), ...(call.defaulted && call.defaulted.length > 0 ? { defaulted: call.defaulted } : {}) }
    const reject = (status: ToolLedgerEntry["status"], error: string): { entry: ToolLedgerEntry; data: unknown } => ({ entry: { ...base, tool: (call.tool in ENGINE_TOOL_SPECS ? call.tool : "read_call_memory") as EngineToolKey, summary: error, quality: { status: "NOT_SUPPORTED", note: null, sampleCount: null }, provenance: { period: null, population: "—", dataSource: "—" }, status, error }, data: null })
    if (!(call.tool in ENGINE_TOOL_SPECS)) return reject("REJECTED", `ferramenta desconhecida: ${call.tool}`)
    const tool = call.tool as EngineToolKey
    if (via === "PLANNER" && !available.has(tool)) return reject("REJECTED", availability.find((entry) => entry.tool === tool)?.reason ?? "ferramenta indisponível nesta execução")
    if (via === "CONTRACT") {
      const step = tool === "analyze_calls" ? contract.callAnalysis : tool === "reference_practices" ? contract.reference : { allowed: false, reason: "não é passo do contrato" }
      if (!step.allowed) return reject("REJECTED", step.reason ?? "passo do contrato não autorizado")
    }
    const resolveInteraction = (value: unknown) => {
      if (typeof value !== "string" || !isHandle(value)) return null
      const real = handles.resolve(value)
      return real && handles.handleOf("I", real) !== undefined ? real : null
    }
    try {
      if ((ENGINE_NATIVE_TOOLS as readonly string[]).includes(tool)) {
        const native = tool as EngineNativeTool
        if (native === "read_call_memory") {
          const ids = sliceIdsOf(call.args.slice)
          const subjectKey = !ids && typeof call.args.subject === "string" ? call.args.subject : null
          const window = windowOf(call.args.window)
          const snapshot = await deps.memory.currentMemory(org, { personIds: [person], window })
          const rows = memoryRowsOf(snapshot, CALL_ANALYSIS_LOGIC_VERSION, subjectKey, [person]).filter((row) => !ids || ids.has(row.interactionId))
          const patterns = criterionPatternsOf(rows).filter((pattern) => pattern.eligible > 0).slice(0, 6)
          const calls = new Set(rows.map((row) => row.interactionId)).size
          const summary = calls === 0 ? "nenhuma chamada com conclusão confirmada na memória para este recorte" : `${calls} chamada(s) com conclusões confirmadas — ${patterns.map((pattern) => `"${pattern.text.slice(0, 60)}": cumpriu ${pattern.met}, não cumpriu ${pattern.notMet + pattern.partial} de ${pattern.eligible}`).join("; ")}`
          return { entry: { ...base, tool, summary, quality: { status: calls > 0 ? "SUFFICIENT" : "NO_DATA", note: null, sampleCount: calls }, provenance: { period: `${shortDate(window.startDate)} a ${shortDate(window.endDate)}`, population: ids ? `colaborador · recorte ${String(call.args.slice)}` : "colaborador", dataSource: "MEMÓRIA DO MOTOR" }, status: "OK", error: null }, data: { calls, patterns: patterns.map((pattern) => ({ step: pattern.text, section: pattern.heading, eligible: pattern.eligible, met: pattern.met, notMet: pattern.notMet, partial: pattern.partial, inconclusive: pattern.inconclusive, classification: pattern.classification })) } }
        }
        if (native === "analyze_calls") {
          const requested = Array.isArray(call.args.interactions) ? call.args.interactions : []
          const ids = requested.map(resolveInteraction)
          if (ids.length === 0 || ids.some((id) => id === null)) return reject("REJECTED", "referência de chamada desconhecida (use só as I-n apresentadas)")
          const outcomes: Record<AnalyzeOutcome, number> = { ANALYZED: 0, REUSED: 0, BUDGET: 0, FAILED: 0, PENDING: 0 }
          for (const id of ids as string[]) outcomes[await analyzeOne(id, person, `Investigação de ${meta.name} (${official.periodLabel}): ${call.question}`)] += 1
          const snapshot = await deps.memory.currentMemory(org, { personIds: [person], interactionIds: ids as string[] })
          const rows = memoryRowsOf(snapshot, CALL_ANALYSIS_LOGIC_VERSION, null, [person])
          const patterns = criterionPatternsOf(rows).filter((pattern) => pattern.eligible > 0).slice(0, 6)
          const confirmedCalls = new Set(rows.filter((row) => DETERMINATE.has(row.status)).map((row) => row.interactionId)).size
          const summary = `${ids.length} chamada(s): ${outcomes.ANALYZED} analisada(s) agora, ${outcomes.REUSED} reaproveitada(s) da memória${outcomes.PENDING > 0 ? `, ${outcomes.PENDING} com revisão pendente` : ""}${outcomes.BUDGET > 0 ? `, ${outcomes.BUDGET} fora do limite` : ""}${outcomes.FAILED > 0 ? `, ${outcomes.FAILED} com falha` : ""}; ${confirmedCalls} com conclusões confirmadas${patterns.length > 0 ? ` — ${patterns.map((pattern) => `"${pattern.text.slice(0, 60)}": cumpriu ${pattern.met}, não cumpriu ${pattern.notMet + pattern.partial} de ${pattern.eligible}`).join("; ")}` : ""}`
          return { entry: { ...base, tool, summary, quality: { status: confirmedCalls > 0 ? "SUFFICIENT" : outcomes.BUDGET > 0 || outcomes.PENDING > 0 ? "INSUFFICIENT_SAMPLE" : "NO_DATA", note: outcomes.BUDGET > 0 ? "limite de análises da execução" : outcomes.PENDING > 0 ? "revisão pendente" : null, sampleCount: confirmedCalls }, provenance: { period: null, population: "chamadas do colaborador", dataSource: "ANÁLISE DE CHAMADA DO MOTOR" }, status: outcomes.BUDGET === ids.length ? "BUDGET" : "OK", error: null }, data: { outcomes, confirmedCalls, patterns: patterns.map((pattern) => ({ step: pattern.text, eligible: pattern.eligible, met: pattern.met, notMet: pattern.notMet, partial: pattern.partial, inconclusive: pattern.inconclusive })) } }
        }
        if (native === "inspect_result") {
          // DETALHE de um resultado JÁ obtido (`TOOL_RESULT_VIEW_V2`), em páginas: nenhuma leitura de dados, nenhum modelo — o mesmo escopo
          // e a mesma proveniência da consulta original. Inexistente, sem dados, vazio, parcial e completo são estados DIFERENTES.
          const target = typeof call.args.ref === "string" ? call.args.ref.trim().toUpperCase() : ""
          const original = ledger.find((entry) => entry.ref === target)
          if (!original) return reject("REJECTED", `resultado ${target || "—"} não existe nesta investigação`)
          if (!lastData.has(target)) return reject("REJECTED", `${target} não tem dados para detalhar: a consulta ${original.status === "FAILED" ? "falhou" : original.status === "BUDGET" ? "não foi executada (orçamento)" : original.status === "REJECTED" ? "foi recusada" : "não devolveu dados"}`)
          const requestedPath = typeof call.args.path === "string" && call.args.path.trim() ? call.args.path.trim() : null
          const page = detailOf(lastData.get(target), { path: requestedPath, offset: typeof call.args.offset === "number" ? Math.max(0, Math.floor(call.args.offset)) : 0, limit: typeof call.args.limit === "number" ? Math.floor(call.args.limit) : null })
          const unit = page.kind === "TEXT" ? "caracteres" : "itens"
          const range = page.kind === "TEXT" || page.kind === "ITEMS" ? `${unit} ${page.from + 1}–${page.to} de ${page.total}` : "campo"
          const summary = page.status === "NOT_FOUND" ? `campo "${page.path}" não existe em ${target} (campos: ${page.fields.join(", ") || "—"})`
            : page.status === "EMPTY" ? `detalhe de ${target} · ${page.path}: vazio`
            : `detalhe de ${target} · ${page.path}: ${range}${page.next !== null ? ` — continua em offset ${page.next}` : ""}${page.omitted.length > 0 ? ` — ${page.omitted.length} parte(s) ainda resumida(s)` : ""}`
          return {
            entry: { ...base, tool, scope: original.scope ?? base.scope, summary, quality: { status: page.status === "NOT_FOUND" ? "NO_DATA" : original.quality.status, note: page.status === "NOT_FOUND" ? "campo inexistente" : page.status === "EMPTY" ? "vazio" : null, sampleCount: original.quality.sampleCount }, provenance: original.provenance, status: "OK", error: null },
            data: page.status === "NOT_FOUND" ? null : {
              of: target,
              ofTool: original.tool,
              path: page.path,
              page: { status: page.status, kind: page.kind, ...(page.kind === "TEXT" || page.kind === "ITEMS" ? { from: page.from, to: page.to, total: page.total, unit } : {}), ...(page.next !== null ? { continueWith: { ref: target, path: page.path, offset: page.next } } : {}) },
              value: page.value,
              ...(page.omitted.length > 0 ? { omitted: page.omitted } : {}),
              ...(requestedPath ? { context: scalarContextOf(lastData.get(target)) } : {}),
            },
          }
        }
        const subjectSlice = sliceRegistry.list().find((slice) => slice.filters.length === 1 && slice.filters[0]!.dimension === "SUBJECT")
        const subjectKey = typeof call.args.subject === "string" && call.args.subject.trim().length > 0 ? call.args.subject.trim() : subjectSlice?.filters[0]!.value ?? null
        if (!subjectKey) return reject("REJECTED", "assunto não informado e nenhum recorte por assunto localizado")
        const reference = await referenceFor(subjectKey, labelOf(subjectKey))
        if (reference) lastReference = reference
        const summary = !reference ? "sem grupo de colegas comparável" : reference.practices.length === 0 ? `grupo de ${reference.members} colega(s) (população ${reference.population}); ${reference.limitations[0] ?? "sem prática comparável"}` : `grupo de ${reference.members} colega(s) com melhor resultado: ${reference.practices.slice(0, 4).map((practice) => `"${practice.text.slice(0, 50)}" cumprida em ${practice.reference.met} de ${practice.reference.eligible} (${practice.person ? `pessoa: ${practice.person.met} de ${practice.person.eligible}` : "pessoa sem avaliação dessa etapa"})`).join("; ")}`
        return { entry: { ...base, tool, summary, quality: { status: reference && reference.practices.length > 0 ? "SUFFICIENT" : "INSUFFICIENT_SAMPLE", note: reference?.limitations[0] ?? null, sampleCount: reference?.practices.reduce((sum, practice) => sum + practice.reference.eligible, 0) ?? 0 }, provenance: { period: null, population: reference ? `grupo de referência (n=${reference.members})` : "—", dataSource: "MEMÓRIA DO MOTOR (agregado)" }, status: "OK", error: null }, data: reference ? { basis: reference.basis, members: reference.members, population: reference.population, practices: reference.practices.map((practice) => ({ step: practice.text, reference: practice.reference, person: practice.person, contrast: practice.contrast })) } : null }
      }
      // Ferramenta do CATÁLOGO: tradução de argumentos — o sujeito, o indicador e as datas são do sistema.
      const catalog = tool as ReusedCatalogTool
      const args: Record<string, unknown> = {}
      if (["get_indicator_snapshot", "inspect_indicator_composition", "validate_data_quality", "detect_anomalies", "get_available_dimensions", "segment_indicator", "compare_population", "get_employee_history", "compare_periods"].includes(catalog)) args.indicatorCode = meta.code
      if (["get_indicator_snapshot", "inspect_indicator_composition", "validate_data_quality", "detect_anomalies", "get_available_dimensions", "segment_indicator", "compare_population", "inspect_work_context", "find_interactions", "get_interaction_flags"].includes(catalog)) args.period = periodOf(call.args.window)
      if (catalog === "compare_periods") Object.assign(args, { currentPeriod: periodOf("CURRENT"), referencePeriod: periodOf("PREVIOUS") })
      if (catalog === "get_employee_history") {
        args.layer = call.args.layer === "OFFICIAL" ? "OFFICIAL" : "OPERATIONAL"
        args.period = { from: windows.previous.startDate, to: windows.current.endDate }
      }
      if (catalog === "segment_indicator") {
        // Rodada real V9: o planejador pediu a segmentação SEM dimensão, com uma única dimensão permitida pela estratégia — a consulta
        // foi recusada e a pergunta do recorte ficou aberta. Dimensão AUSENTE com uma só permitida é decidida pela configuração (como o
        // indicador e o período); dimensão errada continua recusada (`SEGMENT_DIMENSION_DEFAULT_V1`, corrigido depois da rodada).
        const requested = typeof call.args.dimension === "string" ? call.args.dimension.trim().toUpperCase() : ""
        const dimension = requested === "" && allowedDimensions.length === 1 ? allowedDimensions[0]! : requested
        if (!allowedDimensions.includes(dimension as (typeof ANALYSIS_DIMENSIONS)[number])) return reject("REJECTED", `dimensão não permitida (${dimension || "—"}); permitidas: ${allowedDimensions.join(", ")}`)
        args.dimension = dimension
        const filters = { ...(typeof call.args.subject === "string" ? { subject: call.args.subject } : {}), ...(typeof call.args.flag === "string" ? { flag: call.args.flag } : {}) }
        if (Object.keys(filters).length > 0) args.filters = filters
      }
      if (catalog === "compare_population") args.reference = call.args.reference === "GROUP" ? "GROUP" : "SUBGROUP"
      if (catalog === "find_interactions") Object.assign(args, { ...(typeof call.args.subject === "string" ? { subject: call.args.subject } : {}), ...(typeof call.args.flag === "string" ? { flag: call.args.flag } : {}), ...(call.args.orderBy === "LONGEST" || call.args.orderBy === "SHORTEST" || call.args.orderBy === "RECENT" ? { orderBy: call.args.orderBy } : {}), limit: Math.min(typeof call.args.limit === "number" ? call.args.limit : 10, FIND_INTERACTIONS_LIMIT) })
      if (catalog === "get_interaction_context") {
        const id = resolveInteraction(call.args.interaction)
        if (!id) return reject("REJECTED", "referência de chamada desconhecida (use só as I-n apresentadas)")
        args.interactionId = id
      }
      if (catalog === "get_interaction_flags" && Array.isArray(call.args.interactions)) {
        const ids = call.args.interactions.map(resolveInteraction)
        if (ids.some((id) => id === null)) return reject("REJECTED", "referência de chamada desconhecida (use só as I-n apresentadas)")
        args.interactionIds = ids
      }
      if (catalog === "find_comparable_interactions") {
        const subjectSlice = sliceRegistry.list().find((slice) => slice.filters.length === 1 && slice.filters[0]!.dimension === "SUBJECT")
        Object.assign(args, { subject: typeof call.args.subject === "string" ? call.args.subject : subjectSlice?.filters[0]!.value ?? "", reference: call.args.reference === "GROUP" ? "GROUP" : "SUBGROUP", period: periodOf("CURRENT") })
      }
      if (catalog === "query_knowledge") args.query = typeof call.args.query === "string" ? call.args.query.slice(0, 600) : ""
      const window = windowOf(call.args.window)
      const result: ToolResult = await deps.tools!({ tool: catalog, args }, { organizationId: org, personId: person, agentId: analysisAgentId, indicatorCode: meta.code, window: { start: window.start, end: window.end, label: `${window.startDate} a ${window.endDate}` }, now: request.now })
      // Chamadas que a ferramenta devolveu viram referências desta execução (as do colaborador podem ser analisadas depois).
      if (catalog === "find_interactions") {
        const rows = ((result.data as { interactions?: { interactionId?: string; id?: string; localDate?: string; subject?: string | null; durationSeconds?: number | null }[] } | null)?.interactions ?? [])
        for (const row of rows) {
          const id = row.interactionId ?? row.id
          if (!id) continue
          handles.register("I", id)
          if (!known.has(id)) known.set(id, { date: row.localDate ?? "", subject: row.subject ?? null, durationSeconds: row.durationSeconds ?? null, slices: new Set() })
        }
      }
      const decision = extractDecisionSignals(catalog, result.data)
      const seriesPattern = catalog === "detect_anomalies" ? (result.data as { pattern?: string } | null)?.pattern ?? null : null
      // O RESULTADO pode revelar onde olhar: recortes novos (ou a corroboração de um já conhecido).
      const sliceRefs: string[] = []
      if (result.quality.status === "SUFFICIENT") {
        for (const candidate of slicesFromToolResult(result.data, call.args, { direction: meta.direction, proxyKind: proxy.kind, minimumPerSegment, formatIndicator, subjectLabel: labelOf, ref, tool: catalog, round })) {
          const slice = await openSlice(candidate)
          if (slice) sliceRefs.push(slice.ref)
        }
      }
      return {
        entry: { ...base, tool, summary: summarizeToolResult(catalog, result), quality: { status: result.quality.status, note: result.quality.note ?? null, sampleCount: result.quality.sampleCount }, provenance: { period: result.provenance.period?.label ?? null, population: result.provenance.population, dataSource: result.provenance.dataSource }, status: "OK", error: null, signals: decision || seriesPattern ? { ...(decision ?? {}), ...(seriesPattern ? { seriesPattern } : {}) } : null, ...(sliceRefs.length > 0 ? { slices: sliceRefs } : {}) },
        data: projectForModel(result.data, handles),
      }
    } catch (error) {
      if (isBudgetExhausted(error)) {
        modelBudgetHit = true
        return reject("BUDGET", "orçamento de modelo da execução atingido")
      }
      return reject("FAILED", error instanceof DomainError ? error.message.slice(0, 200) : error instanceof Error ? error.message.slice(0, 200) : "erro desconhecido")
    }
  }

  /**
   * ESTADO da investigação (recalculado depois de cada rodada): a memória de cada recorte é lida AQUI — antes de qualquer análise
   * nova —, as perguntas avaliam o que os resultados ESCLARECERAM (não só se a ferramenta rodou).
   */
  const stateOf = async (): Promise<{ state: InvestigationState; pending: Set<string> }> => {
    const snapshot = await memoryOf([person])
    const rowsAll = memoryRowsOf(snapshot, CALL_ANALYSIS_LOGIC_VERSION, null, [person])
    const pending = await deps.memory.pendingReviewInteractions(org, [...known.keys()])
    const signals = diagnosticSignalsOf(ledger, { adverse: officialAdverse || focus.some((segment) => segment.reason !== "IMPROVED") })
    const triedOk = (tools: readonly EngineToolKey[]) => tools.filter((tool) => ledger.some((entry) => entry.tool === tool && entry.status === "OK"))
    const slices: SliceQuestionState[] = sliceRegistry.list().map((slice) => {
      const ids = new Set((universes.get(slice.ref) ?? []).map((row) => row.id))
      const rows = rowsAll.filter((row) => ids.has(row.interactionId))
      // V4: consultas SEM modelo já feitas sobre as chamadas deste recorte (memória do recorte, sinais/contexto das chamadas dele).
      const freeToolsTried = FREE_CALL_TOOLS.filter((tool) => ledger.some((entry) => entry.tool === tool && sliceIdsOfScope(entry, slice.ref) !== null))
      return { ref: slice.ref, label: slice.label, adverse: slice.adverse, reason: slice.reason, universe: ids.size, confirmedAnalyzed: new Set(rows.filter((row) => DETERMINATE.has(row.status)).map((row) => row.interactionId)).size, pendingReview: [...ids].filter((id) => pending.has(id)).length, strengthPattern: criterionPatternsOf(rows).some((pattern) => pattern.classification === "STRENGTH_PATTERN"), origin: slice.origin.kind, freeToolsTried }
    })
    const adverse = officialAdverse || focus.some((segment) => segment.reason !== "IMPROVED")
    return {
      pending,
      state: {
        officialAdverse,
        adverse,
        good: !adverse && (official.withinTarget === true || official.movement === "IMPROVED"),
        measurementBased: official.sourceKind === "MEASUREMENT",
        localized: slices.some((slice) => slice.adverse) || decomposition?.dominant === "MIX",
        whereTools: { available: WHERE_TOOLS.filter((tool) => available.has(tool)), tried: triedOk(WHERE_TOOLS) },
        attribution: signals.attribution,
        contextTools: { available: CONTEXT_TOOLS.filter((tool) => available.has(tool)), tried: triedOk(CONTEXT_TOOLS) },
        workContextChecked: ledger.some((entry) => entry.tool === "inspect_work_context" && entry.status === "OK" && entry.quality.status === "SUFFICIENT"),
        dataQuality: signals.dataQuality,
        dataQualityTool: { available: available.has("validate_data_quality"), tried: triedOk(["validate_data_quality"]).length > 0 },
        slices,
        minimumAnalyzed,
        analyzeAvailable: plan === "PLANNER" ? available.has("analyze_calls") : contract.callAnalysis.allowed,
        callAnalysesLeft: maxCalls - callAnalyses,
        freeCallTools: FREE_CALL_TOOLS.filter((tool) => available.has(tool)),
        modelBudgetExhausted: modelBudgetHit,
        strengthEvidence: criterionPatternsOf(rowsAll).some((pattern) => pattern.classification === "STRENGTH_PATTERN"),
        plan,
        dispositions: dispositions.filter((entry) => entry.accepted),
        localizedByCode: overall.direction !== "UNKNOWN" && segments.some((segment) => segment.sufficient) && (!meta.dailySupported || (daily.available && daily.points.length >= 5)),
      },
    }
  }

  /** Uma consulta JÁ FEITA fala das chamadas deste recorte (memória do recorte ou chamadas dele)? — pertencer ao recorte é
   * NECESSÁRIO para responder a pergunta dele, nunca suficiente (ver `resolutionOf`). */
  const sliceIdsOfScope = (entry: ToolLedgerEntry, sliceRef: string): Set<string> | null => {
    if (entry.status !== "OK" || !entry.scope) return null
    const universe = new Set((universes.get(sliceRef) ?? []).map((row) => row.id))
    if (entry.scope.kind === "SLICE") return entry.scope.ref === sliceRef ? universe : null
    if (entry.scope.kind !== "INTERACTIONS" || entry.scope.refs.length === 0) return null
    const ids = entry.scope.refs.map((handle) => handles.resolve(handle))
    return ids.every((id): id is string => typeof id === "string" && universe.has(id)) ? new Set(ids as string[]) : null
  }
  /**
   * O que a evidência citada DEMONSTRA para a pergunta "o que aconteceu nas chamadas do recorte, confrontado com o procedimento"
   * (`INVESTIGATION_CLOSURE_V2`):
   *   - ANSWERS: análise/memória das chamadas do recorte com conclusões confirmadas em quantas a pergunta pede (o mesmo mínimo
   *     do estado — da estratégia, limitado ao universo do recorte);
   *   - CONTEXT_ONLY: sinais estruturados/contexto de TODAS as chamadas do recorte com algum sinal presente — explica o contexto,
   *     não confronta com o procedimento: pode JUSTIFICAR não aprofundar, nunca vira resposta;
   *   - INSUFFICIENT: análise que cobre menos do que a pergunta pede; consulta que cobre parte das chamadas; ausência de sinal
   *     (não demonstra ausência de falha); evidência do período inteiro ou de outra população.
   */
  const resolutionOf = (question: OpenQuestion, evidence: readonly string[]): { kind: "ANSWERS" | "CONTEXT_ONLY" | "INSUFFICIENT"; detail: string; refs: string[] } => {
    const universe = new Set((universes.get(question.sliceRef!) ?? []).map((row) => row.id))
    const entries = evidence.flatMap((ref) => {
      const entry = ledger.find((candidate) => candidate.ref === ref)
      return entry ? [entry] : []
    })
    const scoped = entries.flatMap((entry) => {
      const ids = sliceIdsOfScope(entry, question.sliceRef!)
      return ids ? [{ entry, ids }] : []
    })
    if (scoped.length === 0) return { kind: "INSUFFICIENT", detail: "a evidência citada não é sobre as chamadas deste recorte (é do período inteiro ou de outra população)", refs: [] }
    const procedure = scoped.filter(({ entry }) => entry.tool === "analyze_calls" || entry.tool === "read_call_memory")
    const confirmed = question.progress?.confirmed ?? 0
    const needed = question.progress?.needed ?? Math.max(1, Math.min(minimumAnalyzed, universe.size))
    if (procedure.length > 0) {
      return confirmed >= needed
        ? { kind: "ANSWERS", detail: `${confirmed} de ${universe.size} chamada(s) do recorte com conclusões confirmadas`, refs: procedure.map(({ entry }) => entry.ref) }
        : { kind: "INSUFFICIENT", detail: `só ${confirmed} de ${universe.size} chamada(s) do recorte têm conclusão confirmada (a pergunta pede ${needed})`, refs: procedure.map(({ entry }) => entry.ref) }
    }
    const context = scoped.filter(({ entry }) => entry.tool === "get_interaction_flags" || entry.tool === "get_interaction_context")
    if (context.length === 0) return { kind: "INSUFFICIENT", detail: "a consulta citada não mostra o que aconteceu nas chamadas do recorte", refs: scoped.map(({ entry }) => entry.ref) }
    const covered = new Set(context.flatMap(({ ids }) => [...ids]))
    const affirmative = context.some(({ entry }) => {
      const data = lastData.get(entry.ref) as { flags?: { count?: number }[] } | null | undefined
      return entry.tool === "get_interaction_flags" ? (data?.flags ?? []).some((flag) => (flag.count ?? 0) > 0) : entry.quality.status === "SUFFICIENT"
    })
    const gaps = [
      ...(covered.size < universe.size ? [`cobre ${covered.size} de ${universe.size} chamada(s) do recorte`] : []),
      ...(!affirmative ? ["nenhum sinal encontrado — ausência de sinal não demonstra ausência de falha"] : []),
    ]
    return gaps.length > 0
      ? { kind: "INSUFFICIENT", detail: `${gaps.join("; ")}; sinais estruturados não confrontam as chamadas com o procedimento`, refs: context.map(({ entry }) => entry.ref) }
      : { kind: "CONTEXT_ONLY", detail: `sinais estruturados de todas as ${universe.size} chamada(s) do recorte — explicam o contexto, não confrontam com o procedimento`, refs: context.map(({ entry }) => entry.ref) }
  }
  /**
   * O planejador PAROU: cada pergunta de recorte ainda aberta recebe uma decisão. "Resolvida" só vale quando a evidência RESPONDE a
   * pergunta (`resolutionOf`); contexto do próprio recorte pode justificar não aprofundar; o resto fica "não aprofundada" — nunca
   * "respondida". "Não aprofundar" fica registrado com a justificativa dele (ou a falta dela).
   */
  const settleSliceQuestions = (stop: PlannerStop, questions: readonly OpenQuestion[], round: number, violations: string[]) => {
    const open = questions.filter((question) => question.sliceRef && question.material)
    const settled = new Set<string>()
    for (const item of stop.resolved) {
      const question = open.find((entry) => entry.id === item.question)
      if (!question) {
        dispositions.push({ question: item.question, decision: "RESOLVED", evidence: item.evidence, why: null, round, accepted: false, reason: "não é uma pergunta de recorte em aberto" })
        continue
      }
      const resolution = resolutionOf(question, item.evidence)
      settled.add(question.id)
      if (resolution.kind === "ANSWERS") {
        dispositions.push({ question: question.id, decision: "RESOLVED", evidence: resolution.refs, why: null, round, accepted: true, reason: resolution.detail })
        continue
      }
      dispositions.push({ question: question.id, decision: "RESOLVED", evidence: item.evidence, why: null, round, accepted: false, reason: resolution.detail })
      if (resolution.kind === "CONTEXT_ONLY") {
        // Contexto do PRÓPRIO recorte é uma justificativa sustentada para não aprofundar — registrada como tal, não como resposta.
        dispositions.push({ question: question.id, decision: "DECLINED", evidence: resolution.refs, why: stop.note ?? resolution.detail, round, accepted: true, reason: resolution.detail })
      } else {
        dispositions.push({ question: question.id, decision: "DECLINED", evidence: item.evidence, why: null, round, accepted: true, reason: `o planejador parou considerando a pergunta respondida por ${item.evidence.join(", ")}, mas ${resolution.detail}` })
        violations.push(`RESOLVED_INSUFFICIENT:${question.id}`)
      }
    }
    for (const item of stop.declined) {
      const question = open.find((entry) => entry.id === item.question)
      if (!question || settled.has(question.id)) {
        dispositions.push({ question: item.question, decision: "DECLINED", evidence: [], why: item.why, round, accepted: false, reason: question ? "pergunta já decidida nesta parada" : "não é uma pergunta de recorte em aberto" })
        continue
      }
      dispositions.push({ question: question.id, decision: "DECLINED", evidence: [], why: item.why, round, accepted: true, reason: null })
      settled.add(question.id)
    }
    for (const question of open.filter((entry) => !settled.has(entry.id))) {
      dispositions.push({ question: question.id, decision: "DECLINED", evidence: [], why: null, round, accepted: true, reason: "o planejador parou sem decidir sobre esta pergunta de recorte" })
      violations.push(`STOP_WITHOUT_DECISION:${question.id}`)
    }
  }

  /** O planejador PAROU: cada pergunta própria ainda aberta é resolvida (só com consultas JÁ feitas e com estado ok) ou deixada de lado
   * com o porquê; sem decisão = deixada de lado, registrada como violação. Nada disso vira fato do diagnóstico. */
  const settlePlannerQuestions = (stop: PlannerStop, violations: string[]) => {
    for (const entry of plannerQuestions.filter((item) => item.status === "OPEN")) {
      const resolved = stop.resolved.find((item) => item.question === entry.id)
      const declined = stop.declined.find((item) => item.question === entry.id)
      if (resolved) {
        const answered = resolved.evidence.filter((ref) => {
          const cited = ledger.find((candidate) => candidate.ref === ref)
          return cited !== undefined && toolOutcomeOf(cited) === "OK"
        })
        Object.assign(entry, answered.length > 0 ? { status: "RESOLVED", evidence: answered, accepted: true, reason: null } : { status: "DECLINED", evidence: resolved.evidence, accepted: false, reason: "a evidência citada não é uma consulta concluída com estado ok" })
        if (answered.length === 0) violations.push(`RESOLVED_WITHOUT_OK_EVIDENCE:${entry.id}`)
      } else if (declined) Object.assign(entry, { status: "DECLINED", decisionWhy: declined.why, accepted: true, reason: null })
      else {
        Object.assign(entry, { status: "DECLINED", accepted: false, reason: "o planejador parou sem decidir sobre esta pergunta" })
        violations.push(`STOP_WITHOUT_DECISION:${entry.id}`)
      }
    }
  }

  const record: InvestigationToolRecord = { version: ENGINE_INVESTIGATION_TOOLS_VERSION, mode: view.mode === "FIXED" ? "FIXED" : "AUTONOMOUS", capabilities, availability, ledger, planner: { status: "NOT_USED", rounds: 0, proposals: [] }, stopReason: "NO_OPEN_QUESTION", openQuestions: [], budget: { maxToolCalls, toolCalls: 0, maxPlanningRounds: maxRounds }, contract, plan, planReason, questionHistory: [], closureVersion: INVESTIGATION_CLOSURE_VERSION, dispositions }
  const snapshotQuestions = (round: number, after: string[], questions: readonly OpenQuestion[]) => record.questionHistory!.push({ round, after, questions: questions.map((question) => ({ id: question.id, status: question.status, material: question.material })) })
  const lastData = new Map<string, unknown>()
  // PERGUNTAS DO PLANEJADOR (`PLANNER_QUESTIONS_V1`): uma descoberta que nenhuma pergunta prevista cobre pode virar pergunta própria —
  // fica aberta (e mantém a investigação andando) até o planejador decidir ao parar; nunca é fato nem vai à mensagem.
  const plannerQuestions: PlannerQuestionRecord[] = []
  record.plannerQuestions = plannerQuestions
  record.resultView = TOOL_RESULT_VIEW_VERSION
  const plannerOpen = (): OpenQuestion[] => plannerQuestions.filter((entry) => entry.status === "OPEN").map((entry) => ({ id: entry.id, kind: "PLANNER", sliceRef: null, question: entry.question, status: "OPEN", material: true, answered: false, reason: entry.why, candidateTools: [...available].filter((tool) => tool !== "inspect_result") }))
  const meter = (deps.analyze.model as { meter?: { remainingCallsFor?: (stage: "INVESTIGATION_PLANNING") => number } }).meter
  // Ferramentas oferecidas ao planejador nesta rodada: `inspect_result` só com resultado para detalhar; análise de chamadas só enquanto
  // cabe uma análise NOVA (V4 — sem isso o planejador pedia uma análise que voltaria "fora do limite" sem nada esclarecer).
  const plannerTools = () => [...available].filter((tool) => (tool !== "inspect_result" || lastData.size > 0) && (tool !== "analyze_calls" || maxCalls - callAnalyses > 0))
  const run = async (calls: PlannedCall[], round: number, via: "PLANNER" | "CONTRACT") => {
    for (const call of calls) {
      if (record.budget.toolCalls >= maxToolCalls) {
        record.stopReason = "TOOL_BUDGET"
        return
      }
      record.budget.toolCalls += 1
      const { entry, data } = await execute(call, round, via)
      ledger.push(entry)
      if (data !== null) lastData.set(entry.ref, data)
    }
  }

  if (plan === "CONTRACT") {
    // PLANO DO CONTRATO (estratégia em modo FIXO, ou nenhuma ferramenta de investigação disponível): os passos que a estratégia
    // publicada autoriza — a amostra dos assuntos localizados, pela MESMA análise da monitoria — sem planejador e sem ferramentas.
    snapshotQuestions(0, [], openQuestionsOf((await stateOf()).state))
    for (const slice of sliceRegistry.list().filter((entry) => entry.origin.kind === "LOCALIZATION")) {
      if (!contract.callAnalysis.allowed) break
      const universe = universes.get(slice.ref) ?? []
      const already = analyzedInteractionIds(await deps.memory.currentMemory(org, { personIds: [person], interactionIds: universe.map((entry) => entry.id) }), CALL_ANALYSIS_LOGIC_VERSION)
      const need = Math.max(0, Math.min(sampleTarget, universe.length) - already.size)
      const pick = universe.filter((item) => !already.has(item.id)).slice(0, need).map((item) => handles.handleOf("I", item.id)!)
      if (pick.length > 0) await run([{ tool: "analyze_calls", args: { interactions: pick }, question: `${slice.adverse ? "CALLS" : "RECOGNITION"}:${slice.ref}` }], 0, "CONTRACT")
    }
    const subjectSlice = sliceRegistry.list().find((slice) => slice.origin.kind === "LOCALIZATION")
    if (subjectSlice && contract.reference.allowed) await run([{ tool: "reference_practices", args: { subject: subjectSlice.filters[0]!.value }, question: "CONTEXT" }], 0, "CONTRACT")
    record.openQuestions = openQuestionsOf((await stateOf()).state)
    snapshotQuestions(1, ledger.map((entry) => entry.ref), record.openQuestions)
    record.stopReason = view.mode === "FIXED" ? "FIXED_PLAN_DONE" : "CONTRACT_PLAN_DONE"
    if (!contract.callAnalysis.allowed && sliceRegistry.list().length > 0) limitations.push(`As chamadas dos recortes localizados não foram analisadas nesta execução (${contract.callAnalysis.reason}).`)
  } else {
    for (let round = 1; round <= maxRounds; round++) {
      const { state, pending } = await stateOf()
      const questions = [...openQuestionsOf(state), ...plannerOpen()]
      record.openQuestions = questions
      if (round === 1) snapshotQuestions(0, [], questions)
      const material = questions.filter((question) => question.material && (question.candidateTools.some((tool) => available.has(tool)) || question.needsDecision))
      if (material.length === 0) {
        record.stopReason = stopReasonOf(questions)
        break
      }
      if (record.budget.toolCalls >= maxToolCalls) {
        record.stopReason = "TOOL_BUDGET"
        break
      }
      const official_ = { indicator: meta.name, unit: meta.unit, direction: meta.direction, period: official.periodLabel, value: official.value, target: official.target, withinTarget: official.withinTarget, previous: official.previous, movement: official.movement, source: official.sourceKind === "OFFICIAL_CLOSING" ? "fechamento oficial" : "medição" }
      const analyzedNowIds = analyzedInteractionIds(await memoryOf([person]), CALL_ANALYSIS_LOGIC_VERSION)
      const confirmedIds = new Set(memoryRowsOf(await memoryOf([person]), CALL_ANALYSIS_LOGIC_VERSION, null, [person]).filter((row) => DETERMINATE.has(row.status)).map((row) => row.interactionId))
      const materialSlices = new Set(material.flatMap((question) => (question.sliceRef ? [question.sliceRef] : [])))
      const interactionList = [...known.entries()]
        .map(([id, info]) => ({ id, info, priority: [...info.slices].some((ref) => materialSlices.has(ref)) ? 0 : info.slices.size > 0 ? 1 : 2 }))
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 25)
        .map(({ id, info }) => ({ ref: handles.handleOf("I", id)!, date: info.date, subject: info.subject, durationSeconds: info.durationSeconds, analysis: confirmedIds.has(id) ? ("CONFIRMED" as const) : pending.has(id) ? ("REVIEW_PENDING" as const) : analyzedNowIds.has(id) ? ("INCONCLUSIVE" as const) : ("NOT_ANALYZED" as const), slices: [...info.slices] }))
      const turn = renderPlannerUserTurn({
        objective: plannerObjectiveOf(meta, official, parameters, state.adverse),
        operationGuidance: parameters.configured && parameters.investigation.declared && parameters.investigation.instructions.trim().length > 0 ? parameters.investigation.instructions.slice(0, 2_000) : null,
        official: official_,
        known: knownFactsOf(localization, proxy.kind),
        // Estado EXPLÍCITO de cada consulta (`TOOL_RESULT_VIEW_V2`): só "ok" responde; recusa, falha, sem dados e orçamento nunca parecem resposta.
        evidence: ledger.map((entry) => `${entry.ref} [${TOOL_OUTCOME_LABEL[toolOutcomeOf(entry)]}] (${entry.tool}${entry.question ? ` · ${entry.question}` : ""}): ${entry.summary}${entry.slices && entry.slices.length > 0 ? ` → recorte(s) ${entry.slices.join(", ")}` : ""}`),
        // Resultados da rodada anterior no tamanho que cabe (listas por item inteiro, o que faltou declarado); o restante por inspect_result.
        lastResults: (() => {
          const previous = ledger.filter((entry) => entry.round === round - 1 && lastData.has(entry.ref))
          return previous.map((entry) => {
            // Página de `inspect_result` já vem no tamanho pedido (até 6.000 caracteres): entregue inteira — recortá-la de novo pelo
            // orçamento da rodada faria o planejador pedir a mesma página outra vez. O restante dos resultados divide o orçamento.
            const view = entry.tool === "inspect_result" ? { value: lastData.get(entry.ref), omitted: [] } : compactForModel(lastData.get(entry.ref), perResultBudget(previous.filter((other) => other.tool !== "inspect_result").length))
            return { ref: entry.ref, tool: entry.tool, outcome: TOOL_OUTCOME_LABEL[toolOutcomeOf(entry)], data: view.value, ...(view.omitted.length > 0 ? { omitted: view.omitted } : {}) }
          })
        })(),
        openQuestions: questions,
        slices: sliceRegistry.list().map((slice) => {
          const sliceState = state.slices.find((entry) => entry.ref === slice.ref)!
          return { ref: slice.ref, label: slice.label, reason: slice.reason, origin: slice.origin.kind === "TOOL" ? `${slice.origin.tool} (${slice.origin.ref})` : slice.origin.kind === "DAILY_PROFILE" ? "medição diária (código)" : "localização por assunto (código)", observation: slice.observation, universe: sliceState.universe, confirmedAnalyzed: sliceState.confirmedAnalyzed, pendingReview: sliceState.pendingReview, interactions: (universes.get(slice.ref) ?? []).slice(0, 8).map((row) => handles.handleOf("I", row.id)!) }
        }),
        tools: plannerTools().map((tool) => ({ tool, purpose: ENGINE_TOOL_SPECS[tool].purpose, args: plannerArgsView(tool, argConfig()) })),
        allowedDimensions: available.has("segment_indicator") ? allowedDimensions : [],
        refused: ledger.filter((entry) => entry.round === round - 1 && entry.status === "REJECTED" && entry.refusal).map((entry) => ({ ref: entry.ref, tool: entry.tool, question: entry.question, code: entry.refusal!.code, argument: entry.refusal!.argument, allowed: entry.refusal!.allowed, message: entry.refusal!.message })),
        interactions: interactionList,
        limits: { roundsLeft: maxRounds - round + 1, toolCallsLeft: maxToolCalls - record.budget.toolCalls, callAnalysesLeft: maxCalls - callAnalyses, ...(meter?.remainingCallsFor ? { modelCallsLeft: meter.remainingCallsFor("INVESTIGATION_PLANNING") } : {}) },
      })
      let decision: ReturnType<typeof parsePlannerDecision> | null = null
      try {
        const responseSchema = plannerResponseSchemaFor({ tools: plannerTools(), allowedDimensions: available.has("segment_indicator") ? allowedDimensions : [] })
        const response = await callModel(deps.analyze.model, { stage: "INVESTIGATION_PLANNING", systemPrompt: ENGINE_PLANNER_SYSTEM_PROMPT, contents: [{ role: "user", text: turn }], responseSchema, tag: `plan:${round}` }, metrics)
        decision = parsePlannerDecision(response.text)
        if (!decision.ok) {
          const retry = await callModel(deps.analyze.model, { stage: "INVESTIGATION_PLANNING", systemPrompt: ENGINE_PLANNER_SYSTEM_PROMPT, contents: [{ role: "user", text: turn }, { role: "model", text: response.text.slice(0, 8_000) }, { role: "user", text: "A resposta anterior não era um JSON válido do schema. Responda novamente somente com o JSON." }], responseSchema, tag: `plan:${round}:retry:format` }, metrics)
          decision = parsePlannerDecision(retry.text)
        }
      } catch (error) {
        const budget = isBudgetExhausted(error)
        if (budget) modelBudgetHit = true
        record.stopReason = budget ? "MODEL_BUDGET" : "PLANNER_UNAVAILABLE"
        record.planner.status = record.planner.rounds > 0 ? "USED" : "UNAVAILABLE"
        if (!budget) limitations.push("O planejamento da investigação não pôde ser feito nesta execução: a conclusão usa só os fatos calculados e a memória existente.")
        break
      }
      record.planner.status = "USED"
      record.planner.rounds = round
      if (!decision.ok) {
        record.stopReason = "PLANNER_UNAVAILABLE"
        record.planner.proposals.push({ round, calls: [], stop: null, violations: [`CONTRACT:${decision.error}`] })
        break
      }
      const accepted: PlannedCall[] = []
      const proposal: InvestigationToolRecord["planner"]["proposals"][number] = { round, calls: [], stop: decision.decision.stop, violations: decision.violations }
      for (const call of decision.decision.calls.slice(0, MAX_CALLS_PER_ROUND)) {
        // Permissão e CONTRATO DOS ARGUMENTOS checados ANTES de executar (`TOOL_ARGUMENT_CONTRACT_V1`): pedido fora da lista ou com
        // argumento obrigatório ausente/inválido nunca consulta dado nem consome IA — volta ao planejador como recusa estruturada.
        const known = call.tool in ENGINE_TOOL_SPECS
        const checked = known && available.has(call.tool as EngineToolKey) ? validatePlannedArgs(call.tool as EngineToolKey, call.args, argConfig()) : null
        const normalized = checked?.ok ? checked.args : call.args
        const duplicate = ledger.some((entry) => entry.status === "OK" && entry.tool === call.tool && JSON.stringify(entry.requestedArgs) === JSON.stringify(normalized))
        const refusal: ToolRefusal | null = !known ? { code: "UNKNOWN_TOOL", argument: null, allowed: [...available], message: `ferramenta desconhecida: ${call.tool}` }
          : !available.has(call.tool as EngineToolKey) ? { code: "TOOL_NOT_AVAILABLE", argument: null, allowed: [...available], message: availability.find((entry) => entry.tool === call.tool)?.reason ?? "ferramenta não permitida/indisponível" }
          : checked && !checked.ok ? checked.refusal
          : duplicate ? { code: "DUPLICATE", argument: null, allowed: null, message: "consulta repetida (já está nas evidências)" }
          : null
        proposal.calls.push({ tool: call.tool, question: call.question, accepted: refusal === null, reason: refusal?.message ?? null })
        if (refusal === null) accepted.push({ ...call, args: normalized, ...(checked?.ok && checked.defaulted.length > 0 ? { defaulted: checked.defaulted } : {}) })
        else ledger.push({ ref: `F${ledger.length + 1}`, round, tool: (known ? call.tool : "read_call_memory") as EngineToolKey, question: call.question, requestedArgs: call.args, summary: `recusada: ${refusal.message}`, quality: { status: "NOT_SUPPORTED", note: null, sampleCount: null }, provenance: { period: null, population: "—", dataSource: "—" }, status: "REJECTED", error: refusal.message, refusal, cached: false, signals: null, via: "PLANNER" })
      }
      record.planner.proposals.push(proposal)
      // Perguntas novas do planejador: só junto de consultas, ids H1–H3 únicos, até o total permitido.
      for (const draft of decision.decision.newQuestions) {
        if (plannerQuestions.some((entry) => entry.id === draft.id)) proposal.violations.push(`newQuestions:${draft.id}:DUPLICATE_ID`)
        else if (plannerQuestions.length >= MAX_PLANNER_QUESTIONS) proposal.violations.push(`newQuestions:${draft.id}:LIMIT`)
        else plannerQuestions.push({ id: draft.id, question: draft.question, why: draft.why, round, status: "OPEN", evidence: [], decisionWhy: null, accepted: null, reason: null })
      }
      if (decision.decision.stop) {
        record.stopReason = `PLANNER_${decision.decision.stop.reason}`
        const own = new Set(plannerQuestions.map((entry) => entry.id))
        const stop = decision.decision.stop
        settleSliceQuestions({ ...stop, resolved: stop.resolved.filter((item) => !own.has(item.question)), declined: stop.declined.filter((item) => !own.has(item.question)) }, questions, round, proposal.violations)
        settlePlannerQuestions(stop, proposal.violations)
        break
      }
      if (accepted.length === 0) {
        // Rodada só com consultas recusadas por argumento/ferramenta: o erro estruturado volta ao planejador na próxima rodada
        // (enquanto houver rodada) — antes a investigação parava aqui e a pergunta ficava sem nenhuma consulta executada.
        const correctable = ledger.some((entry) => entry.round === round && entry.status === "REJECTED" && entry.refusal && entry.refusal.code !== "DUPLICATE")
        if (correctable && round < maxRounds) continue
        record.stopReason = "PLANNER_NO_VALID_CALL"
        break
      }
      const before = ledger.length
      await run(accepted, round, "PLANNER")
      snapshotQuestions(round, ledger.slice(before).map((entry) => entry.ref), openQuestionsOf((await stateOf()).state))
      if (record.stopReason === "TOOL_BUDGET") break
      if (round === maxRounds) record.stopReason = "MAX_PLANNING_ROUNDS"
    }
    record.openQuestions = [...openQuestionsOf((await stateOf()).state), ...plannerOpen()]
    // Pergunta do planejador é registro da investigação (texto do modelo): nunca vira limitação comunicável.
    const stillOpen = record.openQuestions.filter((question) => question.kind !== "PLANNER" && !question.sliceRef && (question.material || question.status === "BUDGET"))
    if (stillOpen.length > 0 && record.stopReason !== "NO_OPEN_QUESTION") limitations.push(`A investigação parou (${record.stopReason}) com perguntas ainda abertas: ${stillOpen.map((question) => question.question).join(" ")}`)
  }
  // `PATTERN_CONFIRMATION_V1`: no assunto que piorou, etapa que falhou na amostra abaixo do mínimo de padrão pede mais chamadas do MESMO
  // assunto (as próximas da mesma ordem da amostra), dentro do orçamento de análises da pessoa e do teto da estratégia — a pergunta "isso
  // se repete?" não fecha com 2 chamadas. Passo do contrato (a estratégia autoriza a amostra), nunca escolha do planejador.
  if (contract.callAnalysis.allowed) {
    for (const slice of sliceRegistry.list().filter((entry) => entry.origin.kind === "LOCALIZATION" && entry.adverse)) {
      const universe = universes.get(slice.ref) ?? []
      const ids = new Set(universe.map((item) => item.id))
      const snapshotNow = await memoryOf([person])
      const candidates = patternConfirmationCandidatesOf(criterionPatternsOf(memoryRowsOf(snapshotNow, CALL_ANALYSIS_LOGIC_VERSION, null, [person]).filter((row) => ids.has(row.interactionId))))
      if (candidates.length === 0) continue
      const analyzed = analyzedInteractionIds(snapshotNow, CALL_ANALYSIS_LOGIC_VERSION)
      const room = Math.min(Math.min(sampleTarget, universe.length) - universe.filter((item) => analyzed.has(item.id)).length, maxCalls - callAnalyses)
      const pick = room > 0 ? universe.filter((item) => !analyzed.has(item.id)).slice(0, room).flatMap((item) => (handles.handleOf("I", item.id) ? [handles.handleOf("I", item.id)!] : [])) : []
      record.patternConfirmation = [...(record.patternConfirmation ?? []), { sliceRef: slice.ref, candidates: candidates.map((pattern) => pattern.heading ?? pattern.text.slice(0, 80)), requested: pick.length }]
      if (pick.length > 0) await run([{ tool: "analyze_calls", args: { interactions: pick, question: "A etapa que falhou nas chamadas analisadas se repete nas demais chamadas deste assunto?" }, question: `CALLS:${slice.ref}` }], maxRounds + 1, "CONTRACT")
    }
    // A referência já consultada compara os colegas com o que a memória da pessoa tinha ANTES dessas chamadas (validação V14B: "você 1
    // de 1" na confirmação de entendimento quando, com as chamadas a mais, era 1 de 4 — e o contraste com os colegas, 6 de 6, sumia):
    // com chamadas novas, o grupo é consultado de novo (memória; análises de colegas só com orçamento próprio sobrando).
    // (Atribuída dentro de `execute`: o compilador não acompanha a atribuição feita num fechamento.)
    const previousReference = lastReference as ReferenceGroup | null
    if ((record.patternConfirmation ?? []).some((entry) => entry.requested > 0) && previousReference?.segmentKey && contract.reference.allowed && record.budget.toolCalls < maxToolCalls) {
      record.budget.toolCalls += 1
      const { entry, data } = await execute({ tool: "reference_practices", args: { subject: previousReference.segmentKey }, question: "REFERENCE" }, maxRounds + 1, "CONTRACT")
      ledger.push(entry)
      if (data !== null) lastData.set(entry.ref, data)
    }
  }

  // `PERIOD_SAMPLE_V1` (dev 05/10/2026: Denisy Feitoza, Fernanda Nunes Alves e Icaro Elias — estratégia do TMA autorizando a análise e
  // ZERO chamadas analisadas, porque o volume não permitia localizar por assunto e nada era examinado; o feedback ficava só com o
  // número). Sem localizar POR VOLUME, com a análise de chamadas autorizada pelo CONTRATO (estratégia publicada com a amostra ligada,
  // especialista no domínio, Workflow sem restringir) e o mínimo da estratégia em chamadas com transcrição no período: uma amostra
  // determinística delas (o assunto com mais chamadas primeiro, depois os demais), no teto de análises da estratégia, no teto de
  // consultas e no orçamento de IA da execução. O que se vê nela é OBSERVAÇÃO do período (evidência `UNLOCATED`), nunca a causa da
  // variação. Sem autorização: nada é consultado nem analisado (só o motivo fica registrado).
  const volumeGap = proxy.kind && contract.localization.allowed ? localizationVolumeGapOf({ segments, overall, focus, minimumPerSegment }) : null
  let periodSample: PeriodSampleRecord | null = null
  /** Assuntos do período com as chamadas com transcrição — só quando a amostra do período vale (a evidência do período sai deles). */
  let periodSubjects: PeriodSampleSubject[] | null = null
  if (volumeGap) {
    const base = { version: PERIOD_SAMPLE_VERSION, gap: volumeGap, minimumAnalyzed, already: 0, requested: 0, analyzedNow: 0, topSubject: null, subjects: [] }
    if (!contract.callAnalysis.allowed) periodSample = { ...base, status: "NOT_ALLOWED", reason: contract.callAnalysis.reason, universe: null, target: 0 }
    else {
      const subjects: PeriodSampleSubject[] = []
      for (const segment of segments.filter((entry) => (entry.current?.n ?? 0) > 0)) {
        // Indicador por sinal: as chamadas COM o sinal vêm primeiro (são o evento que o indicador conta) e o assunto com mais delas
        // abre a amostra; nos demais, espalhadas no tempo.
        const calls = await deps.data.segmentInteractions(org, person, windows.current, segment.key, proxy.kind === "SIGNAL_RATE" ? "SIGNALED" : "TEMPORAL", signalFlagIds)
        if (calls.length === 0) continue
        registerCalls(calls, segment.label, null)
        subjects.push({ key: segment.key, label: segment.label, calls, ...(proxy.kind === "SIGNAL_RATE" ? { signaled: calls.filter((call) => call.signaled).length } : {}) })
      }
      const universeIds = subjects.flatMap((subject) => subject.calls.map((call) => call.id))
      const analyzed = universeIds.length > 0 ? analyzedInteractionIds(await deps.memory.currentMemory(org, { personIds: [person], interactionIds: universeIds }), CALL_ANALYSIS_LOGIC_VERSION) : new Set<string>()
      const sample = periodSampleOf({ subjects, analyzed, target: Math.max(sampleTarget, minimumAnalyzed), room: maxCalls - callAnalyses })
      const planned = { ...base, universe: sample.universe, target: sample.target, already: sample.already, topSubject: sample.topSubject?.label ?? null, subjects: sample.subjects }
      if (sample.universe < minimumAnalyzed) {
        periodSample = { ...planned, status: "BELOW_MINIMUM", reason: `${sample.universe} chamada(s) com transcrição no período; a estratégia pede ao menos ${minimumAnalyzed}` }
        limitations.push(`Não foi possível localizar em qual assunto o resultado mudou, e o período tem ${sample.universe} chamada(s) com transcrição — abaixo do mínimo de ${minimumAnalyzed} da estratégia para analisar uma amostra do período.`)
      } else {
        periodSubjects = subjects
        // Faltam chamadas na amostra: o que impede analisá-las agora (nunca passa do teto de análises nem do orçamento da execução).
        const skipped = modelBudgetHit ? { status: "MODEL_BUDGET" as const, reason: "orçamento de IA da execução atingido" }
          : sample.pick.length === 0 ? { status: "NO_ROOM" as const, reason: "limite de análises de chamadas da execução atingido" }
          : record.budget.toolCalls >= maxToolCalls ? { status: "TOOL_BUDGET" as const, reason: "limite de consultas da investigação atingido" }
          : null
        if (sample.already >= sample.target) periodSample = { ...planned, status: "MEMORY_SUFFICIENT", reason: null }
        else if (skipped) {
          periodSample = { ...planned, ...skipped }
          limitations.push(`A amostra das chamadas do período não foi analisada nesta investigação (${skipped.reason}): só ${sample.already} das ${sample.universe} chamadas com transcrição já tinham análise.`)
        } else {
          const picked = sample.pick.map((entry) => handles.handleOf("I", entry.id)!)
          const before = callAnalyses
          await run([{ tool: "analyze_calls", args: { interactions: picked, question: "O que se observa numa amostra das chamadas do período, já que não foi possível localizar em qual assunto o resultado mudou?" }, question: "CALLS:PERIOD" }], maxRounds + 1, "CONTRACT")
          periodSample = { ...planned, ...(modelBudgetHit ? { status: "MODEL_BUDGET" as const, reason: "orçamento de IA da execução atingido durante a amostra" } : { status: "SAMPLED" as const, reason: null }), requested: picked.length, analyzedNow: callAnalyses - before }
        }
        // No plano do CONTRATO, o passo de referência vale para o assunto que a amostra escolheu (como vale para o assunto localizado);
        // chamadas de colegas só são analisadas com a comparação autorizada (`PEER_ANALYSIS_AUTHORIZATION_V1`, em `referenceFor`).
        if (plan === "CONTRACT" && sample.topSubject && contract.reference.allowed && peers.length > 0 && !lastReference && record.budget.toolCalls < maxToolCalls) {
          await run([{ tool: "reference_practices", args: { subject: sample.topSubject.key }, question: "REFERENCE" }], maxRounds + 1, "CONTRACT")
        }
      }
    }
    if (periodSample) record.periodSample = periodSample
  }

  // `REFERENCE_STEP_V1`: com a comparação com pares LIGADA na estratégia e a capacidade presente, o grupo de referência é um PASSO do
  // diagnóstico — uma consulta à memória agregada, sem modelo —, não uma escolha que o planejador precisa lembrar. Com resultado bom
  // nenhuma pergunta aberta levava a ela, e a boa prática dos colegas nunca chegava ao feedback. Assunto: o recorte por assunto
  // localizado ou, sem localização, o assunto com mais chamadas já avaliadas da pessoa.
  if (!lastReference && peers.length > 0 && available.has("reference_practices") && record.budget.toolCalls < maxToolCalls) {
    const subjectSlice = sliceRegistry.list().find((slice) => slice.filters.length === 1 && slice.filters[0]!.dimension === "SUBJECT")
    const subject = subjectSlice ? String(subjectSlice.filters[0]!.value) : segmentsWithMemoryOf(await memoryOf([person]), CALL_ANALYSIS_LOGIC_VERSION, person)[0]?.segmentKey ?? null
    if (subject) {
      record.budget.toolCalls += 1
      const { entry, data } = await execute({ tool: "reference_practices", args: { subject }, question: "REFERENCE" }, 0, "CONTRACT")
      ledger.push(entry)
      if (data !== null) lastData.set(entry.ref, data)
    }
  }

  // Recorte que piorou e cujas chamadas NÃO foram examinadas: dito como tal (o motivo do sistema — a justificativa do planejador
  // fica no registro, nunca vira frase da mensagem). Falta de dado já tem a limitação própria (mais abaixo).
  // Para o COLABORADOR (detalhes da tela) vai só o FATO — o recorte não foi examinado — nunca o funcionamento da investigação
  // (orçamento, ferramentas, rodadas). Decisão justificada de não aprofundar (materialidade, dado insuficiente) não vira nota.
  const readerNotes: string[] = []
  for (const question of record.openQuestions.filter((entry) => entry.kind === "CALLS" && entry.sliceRef && ["DECLINED", "NO_TOOL", "BUDGET", "OPEN", "PARTIAL"].includes(entry.status))) {
    const slice = sliceRegistry.get(question.sliceRef!)
    if (!slice) continue
    const why = question.status === "DECLINED" ? "o planejamento da investigação decidiu não aprofundar este recorte" : question.status === "NO_TOOL" ? question.reason : question.status === "BUDGET" ? question.reason : question.needsDecision ? "não cabia análise nova nesta execução e a investigação terminou antes de decidir sobre o recorte" : "a investigação parou antes de examiná-las"
    limitations.push(`As chamadas do recorte ${slice.label} não foram examinadas nesta investigação (${why}): nada foi concluído sobre o que aconteceu nelas.`)
    if (!(question.status === "DECLINED" && question.resolution?.justified)) readerNotes.push(`No recorte ${slice.label} o resultado ficou fora do seu padrão, mas as chamadas desse recorte não foram examinadas: este retorno não diz o que aconteceu nelas.`)
  }

  // Uma análise que a investigação pediu ficou com a revisão PENDENTE por falha técnica: a investigação não fecha com essa lacuna.
  if (pendingTechnical.size > 0) throw new InvestigationAnalysisPendingError([...pendingTechnical])

  // 4. EVIDÊNCIA final (da memória — inclusive o que acabou de ser analisado) por RECORTE: os do código e os descobertos.
  // Regras em vigor lidas AGORA (`CURRENT_RULES_AFTER_ANALYSIS_V1`, 06/10/2026): as análises desta execução organizam práticas novas
  // (`PRACTICE_IDENTITY_V1`); lidas no início, essas práticas pareciam "regra que mudou na base" e o padrão era descartado (Reincidência
  // da Larissa: recapitulação ausente em 3 de 4 retornos tratada como regra alterada, conclusão "sem causa").
  const currentKeys = await currentCriterionKeysOf(deps, org, documents)
  const snapshot: MemorySnapshot = await memoryOf([person])
  const rowsAll = memoryRowsOf(snapshot, CALL_ANALYSIS_LOGIC_VERSION, null, [person])
  const pendingNow = await deps.memory.pendingReviewInteractions(org, [...known.keys()])
  const evidence: SegmentEvidence[] = []
  // Todo recorte que piorou entra na evidência (mesmo com o mês bom) — inclusive sem chamada examinada, com o denominador.
  const evidenceSlices = sliceRegistry.list().filter((slice) => slice.origin.kind === "LOCALIZATION" || slice.adverse)
  for (const slice of evidenceSlices) {
    const universe = universes.get(slice.ref) ?? []
    const ids = new Set(universe.map((row) => row.id))
    const rows = rowsAll.filter((row) => ids.has(row.interactionId))
    const patterns = criterionPatternsOf(rows).map((pattern) => ({ ...pattern, currentRule: currentRuleOf(pattern, currentKeys) }))
    const analyzedIds = new Set(rows.map((row) => row.interactionId))
    const path = pathStatsOfInteractions(snapshot, CALL_ANALYSIS_LOGIC_VERSION, person, ids)
    const order = orderFor(slice)
    const basis: SampleBasis = order === "LONGEST" ? "LONGEST_DURATION" : order === "SIGNALED" ? "SIGNALED" : "TEMPORAL"
    const subjectOnly = slice.filters.length === 1 && slice.filters[0]!.dimension === "SUBJECT"
    const newly = [...analyzedIds].filter((id) => analyzedNow.has(id)).length
    const pendingReview = [...ids].filter((id) => pendingNow.has(id)).length
    evidence.push({
      sliceRef: slice.ref,
      filters: slice.filters,
      scope: slice.scope,
      origin: slice.origin,
      pendingReview,
      segmentKey: subjectOnly ? slice.filters[0]!.value : slice.key,
      segmentLabel: subjectOnly ? slice.filters[0]!.label : slice.label,
      focusReason: slice.reason,
      universe: universe.length,
      analyzedCalls: analyzedIds.size,
      reusedCalls: analyzedIds.size - newly,
      newlyAnalyzed: newly,
      sampleBasis: basis,
      sampleNote: `${analyzedIds.size} de ${universe.length} chamadas ${subjectOnly ? `do assunto ${slice.filters[0]!.label}` : `do recorte ${slice.label}`} no período têm análise${basis === "LONGEST_DURATION" ? ", escolhidas entre as mais longas (amostra dirigida: mostra o que acontece nessas chamadas, não a taxa de todas)" : basis === "SIGNALED" ? ", escolhidas entre as que têm o sinal (amostra dirigida)" : ""}${pendingReview > 0 ? `; ${pendingReview} com revisão pendente (não contam)` : ""}; só conclusões confirmadas entram nas contagens.`,
      patterns,
      pathIncorrect: path.incorrect,
      pathAssessed: path.assessed,
      quality: sampleQualityOf(snapshot, ids, rows),
    })
    const universeAnalyzed = universe.filter((entry) => analyzedIds.has(entry.id)).length
    if (subjectOnly && parameters.configured && parameters.sample.minimumCoveragePercent !== null && universe.length > 0 && (universeAnalyzed / universe.length) * 100 < parameters.sample.minimumCoveragePercent) limitations.push(`A cobertura das chamadas analisadas no assunto ${slice.filters[0]!.label} (${universeAnalyzed} de ${universe.length}) está abaixo do mínimo da estratégia (${parameters.sample.minimumCoveragePercent}%).`)
    if (slice.origin.kind !== "LOCALIZATION" && universe.length === 0) limitations.push(`O recorte ${slice.label} não tem chamadas com transcrição: nada foi concluído sobre o que aconteceu nele.`)
  }
  const comparable = overall.direction !== "UNKNOWN" && segments.some((segment) => segment.sufficient)
  // Sem LOCALIZAR onde o resultado mudou por assunto: o que a memória JÁ tem das chamadas do período (observação, nunca causa).
  // `UNLOCATED_MEMORY_V2` (rodada real V13): antes só entrava com a evidência VAZIA — examinar um recorte descoberto (o dia 04/08)
  // apagava do diagnóstico a conduta consistente das chamadas do período, e o feedback do resultado bom ficava só com o número.
  // Agora entra sempre que nenhum recorte por assunto foi localizado, ao lado dos recortes descobertos pelas ferramentas.
  // `PERIOD_SAMPLE_V1`: com a amostra do período valendo, a evidência é UMA entrada do PERÍODO (todos os assuntos: a amostra e a memória
  // que já existia), com o denominador de chamadas com transcrição — as entradas por assunto repetiriam as mesmas práticas.
  if (!comparable && !evidence.some((entry) => entry.origin?.kind === "LOCALIZATION") && periodSubjects) {
    const ids = new Set(periodSubjects.flatMap((subject) => subject.calls.map((call) => call.id)))
    const rows = rowsAll.filter((row) => ids.has(row.interactionId))
    const analyzedIds = new Set(rows.map((row) => row.interactionId))
    if (analyzedIds.size > 0) {
      const newly = [...analyzedIds].filter((id) => analyzedNow.has(id)).length
      const pendingReview = [...ids].filter((id) => pendingNow.has(id)).length
      const path = pathStatsOfInteractions(snapshot, CALL_ANALYSIS_LOGIC_VERSION, person, ids)
      const top = periodSample?.topSubject ?? null
      evidence.push({
        scope: "Nas chamadas analisadas do período",
        pendingReview,
        segmentKey: "PERIOD",
        segmentLabel: "Amostra do período",
        focusReason: "UNLOCATED",
        universe: ids.size,
        analyzedCalls: analyzedIds.size,
        reusedCalls: analyzedIds.size - newly,
        newlyAnalyzed: newly,
        sampleBasis: "PERIOD_SAMPLE",
        sampleNote: `${analyzedIds.size} de ${ids.size} chamadas com transcrição do período têm análise — amostra do período escolhida pelo sistema${top ? `, começando pelo assunto ${top} (o de mais chamadas) e depois os demais` : ""}, porque o volume não permitiu localizar em qual assunto o resultado mudou: descreve essas chamadas, não explica a variação do indicador${pendingReview > 0 ? `; ${pendingReview} com revisão pendente (não contam)` : ""}; só conclusões confirmadas entram nas contagens.`,
        patterns: criterionPatternsOf(rows).map((pattern) => ({ ...pattern, currentRule: currentRuleOf(pattern, currentKeys) })),
        pathIncorrect: path.incorrect,
        pathAssessed: path.assessed,
        quality: sampleQualityOf(snapshot, ids, rows),
        periodSubjects: periodSubjects.map((subject) => ({ key: subject.key, label: subject.label, universe: subject.calls.length, analyzed: subject.calls.filter((call) => analyzedIds.has(call.id)).length })),
      })
    }
  } else if (!comparable && !evidence.some((entry) => entry.origin?.kind === "LOCALIZATION")) {
    for (const entry of segmentsWithMemoryOf(snapshot, CALL_ANALYSIS_LOGIC_VERSION, person).slice(0, 2)) {
      const universe = await deps.data.segmentInteractions(org, person, windows.current, entry.segmentKey, "TEMPORAL", signalFlagIds)
      const rows = memoryRowsOf(snapshot, CALL_ANALYSIS_LOGIC_VERSION, entry.segmentKey, [person])
      const analyzed = new Set(rows.map((row) => row.interactionId)).size
      const path = pathStatsOf(snapshot, CALL_ANALYSIS_LOGIC_VERSION, person, entry.segmentKey)
      const label = labelOf(entry.segmentKey)
      evidence.push({
        segmentKey: entry.segmentKey,
        segmentLabel: label,
        focusReason: "UNLOCATED",
        universe: universe.length,
        analyzedCalls: analyzed,
        reusedCalls: analyzed,
        newlyAnalyzed: 0,
        sampleBasis: "EXISTING_MEMORY",
        sampleNote: `${analyzed} de ${universe.length} chamadas do assunto ${label} no período já tinham análise; não foi possível localizar onde o resultado mudou.`,
        patterns: criterionPatternsOf(rows).map((pattern) => ({ ...pattern, currentRule: currentRuleOf(pattern, currentKeys) })),
        pathIncorrect: path.incorrect,
        pathAssessed: path.assessed,
        quality: sampleQualityOf(snapshot, new Set(universe.map((row) => row.id)), rows),
      })
    }
  }
  if (analyzeFailures.length > 0) limitations.push(`${analyzeFailures.length} chamada(s) não puderam ser analisadas nesta execução.`)
  if (analyzeFailures.length > 0 && callAnalyses > 0 && analyzeFailures.length === callAnalyses && evidence.every((entry) => entry.analyzedCalls === 0) && ledger.every((entry) => entry.status !== "OK")) throw analyzeFailures[analyzeFailures.length - 1]
  if (stoppedBy === "MODEL_BUDGET" || modelBudgetHit) limitations.push("O orçamento de IA da execução acabou antes de todas as análises pedidas.")
  const reevaluated = evidence.some((entry) => entry.patterns.some((pattern) => (pattern.reevaluated ?? 0) > 0 && pattern.classification !== "NONE"))
  if (reevaluated) limitations.push("Parte das chamadas foi avaliada pela versão ATUAL do procedimento, publicada depois delas: o que ela aponta orienta daqui para frente e não explica o resultado do período.")

  // 5. Referência + sinais das ferramentas + conclusão (os recortes descobertos entram na conclusão e na mensagem).
  const adverseNow = officialAdverse || focus.some((segment) => segment.reason !== "IMPROVED")
  const signals = diagnosticSignalsOf(ledger, { adverse: adverseNow })
  const slices = sliceRegistry.list()
  const sliceStatuses = Object.fromEntries(record.openQuestions.filter((question) => question.kind === "CALLS" && question.sliceRef).map((question) => [question.sliceRef!, question.status]))
  const { conclusion, questions } = concludeInvestigation({ official, localization, evidence, reference: lastReference, signals, minimumAnalyzed, slices, sliceStatuses })
  const pendingReviews = evidence.reduce((sum, entry) => sum + (entry.pendingReview ?? 0), 0)
  const interrupted = modelBudgetHit && (record.openQuestions.some((question) => question.status === "BUDGET" || question.material) || pendingReviews > 0)
  return {
    logicVersion: INDICATOR_INVESTIGATION_LOGIC_VERSION,
    official,
    localization,
    evidence,
    reference: lastReference,
    questions,
    conclusion,
    limitations: [...new Set([...limitations, ...signals.limitations])],
    budget: { maxCallAnalyses: maxCalls, callAnalyses, maxPeerCallAnalyses: maxPeerCalls, peerCallAnalyses, peerAnalyzeFailures, reusedCalls, stoppedBy: stoppedBy ?? (modelBudgetHit ? "MODEL_BUDGET" : null) },
    strategy: { versionId: parameters.strategyVersionId, configured: parameters.configured, mode: view.mode, prohibitedClaims: parameters.configured && parameters.investigation.declared ? [...parameters.investigation.prohibitedClaims] : [], noDiagnosisBehavior: parameters.configured ? parameters.noDiagnosisBehavior : null },
    teamId: placement?.teamId ?? null,
    subteamId: placement?.subteamId ?? null,
    tools: record,
    signals,
    slices,
    completeness: { status: interrupted ? "INTERRUPTED_BY_BUDGET" : "COMPLETE", pendingReviews, note: interrupted ? "o orçamento de IA da execução acabou com perguntas em aberto: a próxima execução retoma" : null },
    readerNotes,
  }
}

/** Qualidade das análises da amostra de um recorte (só leituras utilizáveis da lógica atual): completas × parciais e chamadas com
 * alguma conclusão confirmada — o denominador de qualquer frase sobre "o que se viu" nelas. */
function sampleQualityOf(snapshot: MemorySnapshot, interactionIds: ReadonlySet<string>, rows: readonly { interactionId: string; status: string }[]): NonNullable<SegmentEvidence["quality"]> {
  const assessments = snapshot.assessments.filter((assessment) => interactionIds.has(assessment.interactionId) && assessment.logicVersion === CALL_ANALYSIS_LOGIC_VERSION)
  return {
    usable: assessments.filter((assessment) => assessment.outcome === "USABLE").length,
    partial: assessments.filter((assessment) => assessment.outcome === "PARTIAL").length,
    confirmedCalls: new Set(rows.filter((row) => DETERMINATE.has(row.status)).map((row) => row.interactionId)).size,
  }
}

/** De QUE a consulta fala (`INVESTIGATION_CLOSURE_V1`): chamadas específicas (I-n), a memória de um recorte (R-n), um filtro
 * de assunto/sinal ou o período inteiro. Só as duas primeiras podem encerrar a pergunta "o que aconteceu nas chamadas do recorte". */
function scopeOfCall(call: PlannedCall): NonNullable<ToolLedgerEntry["scope"]> {
  const interactionRefs = (value: unknown) => (Array.isArray(value) ? value : [value]).filter((entry): entry is string => typeof entry === "string" && /^I\d{1,4}$/.test(entry))
  if (call.tool === "analyze_calls" || call.tool === "get_interaction_flags") {
    const refs = interactionRefs(call.args.interactions)
    if (refs.length > 0) return { kind: "INTERACTIONS", refs }
  }
  if (call.tool === "get_interaction_context") {
    const refs = interactionRefs(call.args.interaction)
    if (refs.length > 0) return { kind: "INTERACTIONS", refs }
  }
  if (call.tool === "read_call_memory" && typeof call.args.slice === "string" && /^R\d{1,2}$/.test(call.args.slice)) return { kind: "SLICE", ref: call.args.slice }
  const filters: Record<string, string> = {}
  if (typeof call.args.subject === "string" && call.args.subject.trim()) filters.SUBJECT = call.args.subject.trim()
  if (typeof call.args.flag === "string" && call.args.flag.trim()) filters.FLAG = call.args.flag.trim()
  return Object.keys(filters).length > 0 ? { kind: "FILTERS", filters } : { kind: "PERIOD" }
}

function plannerObjectiveOf(meta: IndicatorMeta, official: OfficialFacts, parameters: DiagnosisRuntimeParameters, adverse: boolean): string {
  const base = adverse
    ? `Entender onde e por que o resultado de ${meta.name} em ${official.periodLabel} ${official.withinTarget === false ? "ficou fora da meta" : "piorou"}, separando o que é contexto (demanda, dias, grupo, escala, dados) do que é conduta, e o que a pessoa pode ajustar — sem atribuir a ela o que os dados não explicam.`
    : `Entender o que sustenta o resultado de ${meta.name} em ${official.periodLabel}, para reconhecer com especificidade — sem inventar a conduta que o produziu.`
  return parameters.configured && parameters.investigation.declared && parameters.investigation.objective.trim().length > 0 ? `${parameters.investigation.objective.trim()} (${base})` : base
}

function knownFactsOf(localization: Localization, proxyKind: ProxyKind | null): string[] {
  const facts: string[] = []
  const fmt = (value: number) => (proxyKind === "SIGNAL_RATE" ? `${(value * 100).toFixed(1)}%` : proxyKind === "DURATION_SECONDS" ? `${Math.round(value)} s` : `${Math.round(value)}`)
  if (localization.overall.current && localization.overall.previous) facts.push(`Chamadas (${localization.proxy.label}): ${fmt(localization.overall.previous.value)} em ${localization.windows.previous.label} (${localization.overall.previous.n}) → ${fmt(localization.overall.current.value)} em ${localization.windows.current.label} (${localization.overall.current.n}); direção ${localization.overall.direction}.`)
  for (const segment of localization.segments.slice(0, 6)) if (segment.current || segment.previous) facts.push(`Assunto ${segment.label}: ${segment.previous ? `${fmt(segment.previous.value)} (${segment.previous.n})` : "—"} → ${segment.current ? `${fmt(segment.current.value)} (${segment.current.n})` : "—"}${segment.sufficient ? `, ${segment.changeDirection}` : ", volume insuficiente"}.`)
  if (localization.decomposition) facts.push(`Decomposição: mix ${localization.decomposition.mixEffect.toFixed(1)} × dentro ${localization.decomposition.withinEffect.toFixed(1)} (${localization.decomposition.dominant}).`)
  for (const focus of localization.focus) facts.push(`Recorte em foco: ${focus.label} (${focus.reason}).`)
  for (const day of localization.daily.outliers.slice(0, 3)) facts.push(`Dia fora do padrão: ${day.date} (${day.value}).`)
  facts.push(...localization.limitations)
  return facts
}

