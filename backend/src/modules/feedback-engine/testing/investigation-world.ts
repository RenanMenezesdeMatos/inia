import { runtimeParametersOf } from "../../indicator-diagnosis/domain/diagnostic-strategy.js"
import type { InvestigationCapability } from "../../investigation/domain/capabilities.js"
import type { ToolResult } from "../../investigation/domain/tool-output.js"
import type { AnalyzeCallDeps } from "../application/analyze-call.js"
import type { InvestigateIndicatorDeps, InvestigateIndicatorRequest } from "../application/investigate-indicator.js"
import type { EngineModelPort, FeedbackMemoryStore } from "../application/ports.js"
import type { IndicatorInvestigation, OfficialFacts } from "../domain/indicator-investigation.js"
import type { SliceFilter } from "../domain/investigation-slices.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import type { CatalogToolCall, CatalogToolRunner, CatalogToolScope } from "../infrastructure/catalog-tool-runner.js"
import type { IndicatorDataPort } from "../infrastructure/postgres-indicator-data.js"
import type { InteractionForAnalysis } from "../infrastructure/postgres-engine-loaders.js"
import { fakeEngineModel } from "./fake-engine-model.js"
import { CHECKLIST_ID, CHECKLIST_V1, DOC_ID, PROCEDURE_V1, TRANSCRIPT } from "./fixtures.js"

/**
 * MUNDO DE DADOS das provas da investigação (sem banco, sem IA): um TMA (segundos, menor é melhor), as chamadas do colaborador
 * por assunto e as do dia 14/08, um executor FALSO das ferramentas do catálogo. O real é coberto pelas provas de banco.
 */
export const ORG = "00000000-0000-4000-8000-000000000001"
export const PERSON = "00000000-0000-4000-8000-0000000000aa"
export const AGENT = "00000000-0000-4000-8000-00000000a001"
/** Assunto CONTESTAÇÃO (agosto). */
export const CALLS = ["00000000-0000-4000-8000-00000000f101", "00000000-0000-4000-8000-00000000f102", "00000000-0000-4000-8000-00000000f103"]
/** Chamadas do DIA 14/08 (assunto Troca de plano) — só um recorte por dia as alcança. */
export const DAY_CALLS = ["00000000-0000-4000-8000-00000000f141", "00000000-0000-4000-8000-00000000f142", "00000000-0000-4000-8000-00000000f143"]
export const PEAK_DAY = "2026-08-14"
/** Dia sem nenhuma chamada com transcrição. */
export const EMPTY_DAY = "2026-08-20"
export const FULL_CAPABILITIES: InvestigationCapability[] = ["INDICATOR_ANALYSIS", "SEGMENTATION", "INTERACTION_ANALYSIS", "OPERATIONAL_COMPARISON", "KNOWLEDGE"]

export const worsened: OfficialFacts = { indicatorId: "ind-tma", code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER", sourceKind: "OFFICIAL_CLOSING", sourceRef: "closing-aug", value: 450, target: 400, withinTarget: false, gapToTarget: 50, periodStart: "2026-08-01", periodEnd: "2026-08-31", periodLabel: "agosto/2026", referencePeriod: "2026-08", previous: { value: 380, periodLabel: "julho/2026", withinTarget: true }, movement: "WORSENED", quartile: null, previousQuartile: null }
export const improved: OfficialFacts = { ...worsened, value: 357, withinTarget: true, gapToTarget: null, previous: { value: 382, periodLabel: "julho/2026", withinTarget: true }, movement: "IMPROVED" }

/** LOCATED = Contestação piorou; UNLOCATED = volume anterior insuficiente; STABLE = assuntos comparáveis e SEM mudança material; IMPROVED = Contestação melhorou. */
export type SubjectScenario = "LOCATED" | "UNLOCATED" | "STABLE" | "IMPROVED"

/** Medição diária de agosto (TMA): dias comuns perto da mediana e o PICO de 14/08 (820 s). */
export const DAILY_WITH_PEAK: readonly { date: string; value: number }[] = [
  { date: "2026-08-04", value: 350 }, { date: "2026-08-05", value: 362 }, { date: "2026-08-06", value: 341 }, { date: "2026-08-07", value: 355 },
  { date: "2026-08-10", value: 368 }, { date: "2026-08-11", value: 349 }, { date: "2026-08-12", value: 358 }, { date: "2026-08-13", value: 344 },
  { date: PEAK_DAY, value: 820 }, { date: "2026-08-17", value: 352 }, { date: "2026-08-18", value: 360 },
]

export function world(official: OfficialFacts, subjects: SubjectScenario, daily: readonly { date: string; value: number }[] = []) {
  const row = (key: string, n: number, avgDuration: number) => ({ personId: PERSON, key, n, avgDuration, signaled: 0 })
  const current = subjects === "IMPROVED" ? [row("CONTESTACAO", 10, 330), row("PLANO", 10, 300)] : subjects === "STABLE" ? [row("CONTESTACAO", 10, 452), row("PLANO", 10, 448)] : [row("CONTESTACAO", 10, 520), row("PLANO", 10, 300)]
  const previous = subjects === "UNLOCATED" ? [row("PLANO", 1, 900)] : subjects === "IMPROVED" ? [row("CONTESTACAO", 10, 450), row("PLANO", 10, 300)] : subjects === "STABLE" ? [row("CONTESTACAO", 10, 440), row("PLANO", 10, 445)] : [row("CONTESTACAO", 10, 380), row("PLANO", 10, 300)]
  const callRows = (ids: readonly string[], date: string) => ids.map((id, index) => ({ id, startedAt: new Date(`${date}T1${index}:00:00Z`), durationSeconds: 520, signaled: false }))
  const sliceQueries: SliceFilter[][] = []
  const data = {
    timeZone: async () => "America/Sao_Paulo",
    indicatorByCode: async () => ({ id: "ind-tma", code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER" as const, dailySupported: daily.length > 0 }),
    indicatorById: async () => ({ id: "ind-tma", code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER" as const, dailySupported: daily.length > 0 }),
    officialFromClosing: async () => official,
    placement: async () => ({ teamId: "team-1", subteamId: "sub-1" }),
    teamPeers: async () => [],
    peerOfficialValues: async () => [],
    subjectNames: async () => new Map([["CONTESTACAO", "Contestação de cobrança"], ["PLANO", "Troca de plano"]]),
    resolveSignal: async () => ({ flagIds: [], condition: null }),
    segmentRows: async (_org: string, _personIds: readonly string[], window: { start: Date }) => (window.start.getUTCMonth() === 7 ? current : previous),
    dailyPoints: async () => [...daily],
    segmentInteractions: async () => callRows(CALLS, "2026-08-11"),
    sliceInteractions: async (_org: string, _personId: string, _window: unknown, filters: SliceFilter[]) => {
      sliceQueries.push(filters)
      if (filters.length === 1 && filters[0]!.dimension === "SUBJECT" && filters[0]!.value === "CONTESTACAO") return callRows(CALLS, "2026-08-11")
      if (filters.length === 1 && filters[0]!.dimension === "DAY" && filters[0]!.value === PEAK_DAY) return callRows(DAY_CALLS, PEAK_DAY)
      return []
    },
    interactionEvidence: async () => "20:v1",
  } as unknown as IndicatorDataPort
  return { data, sliceQueries }
}

export type ToolScript = Partial<Record<CatalogToolCall["tool"], (call: CatalogToolCall, scope: CatalogToolScope) => ToolResult | Promise<ToolResult>>>
export function catalogRunner(script: ToolScript) {
  const invoked: { tool: string; args: Record<string, unknown>; scope: CatalogToolScope }[] = []
  const runner: CatalogToolRunner = async (call, scope) => {
    invoked.push({ tool: call.tool, args: call.args, scope })
    const handler = script[call.tool]
    if (!handler) throw new Error(`ferramenta ${call.tool} não roteirizada`)
    return handler(call, scope)
  }
  return { runner, invoked }
}
export const ok = (data: unknown, population = "colaborador", dataSource = "MEASUREMENT"): ToolResult => ({ data, quality: { status: "SUFFICIENT", sampleCount: 20, coverage: 1, freshness: "FRESH" }, provenance: { period: { start: "2026-08-01", end: "2026-09-01", label: "2026-08-01 a 2026-08-31" }, population, filters: [], dataSource } })
export const anomaly = (date: string, observedValue = 820) => ({ date, observedValue, baseline: 410, classification: "ANOMALY", performance: "WORSE", score: 4.1 })

export type SetupOptions = {
  memory?: FeedbackMemoryStore
  model?: EngineModelPort
  official?: OfficialFacts
  subjects?: SubjectScenario
  /** Ausente = todas as capacidades usadas nas provas; `"MISSING_FIELD"` = perfil sem o campo (carregador antigo). */
  agentCapabilities?: InvestigationCapability[] | "MISSING_FIELD"
  tools?: CatalogToolRunner
  strategy?: Parameters<typeof runtimeParametersOf>[0]
  allowCollaborator?: (id: string) => boolean
  maxCallAnalyses?: number
  maxToolCalls?: number
  /** Medição diária do período (ausente = indicador sem medição diária). */
  daily?: readonly { date: string; value: number }[]
}

export function setup(options: SetupOptions = {}) {
  const memory = options.memory ?? createInMemoryFeedbackMemoryStore()
  const fake = fakeEngineModel()
  const model = options.model ?? fake.model
  const subjectOf = (id: string) => (DAY_CALLS.includes(id) ? { code: "PLANO", name: "Troca de plano" } : { code: "CONTESTACAO", name: "Contestação de cobrança" })
  const interaction = (id: string): InteractionForAnalysis | null => (CALLS.includes(id) || DAY_CALLS.includes(id) ? { id, organizationId: ORG, operatorId: PERSON, operatorName: "Larissa", startedAt: new Date(DAY_CALLS.includes(id) ? `${PEAK_DAY}T13:00:00Z` : "2026-08-11T13:00:00Z"), endedAt: new Date(DAY_CALLS.includes(id) ? `${PEAK_DAY}T13:08:40Z` : "2026-08-11T13:08:40Z"), reason: subjectOf(id).name, channel: "VOICE", subjectCanonical: subjectOf(id), flags: [], transcript: { content: TRANSCRIPT, checksum: `t-${id}` }, teamId: "team-1", subteamId: "sub-1", supervisorId: null, timeZone: "America/Sao_Paulo" } : null)
  const now = () => new Date("2026-09-30T12:00:00Z")
  const analyze: AnalyzeCallDeps = {
    memory,
    model,
    loadInteraction: async (_org, id) => interaction(id),
    loadAgent: async () => {
      const base = { id: AGENT, name: "Especialista de Faturamento", objective: null, contextPrompt: null, updatedAt: new Date("2026-09-01T00:00:00Z"), businessDomainId: null }
      return options.agentCapabilities === "MISSING_FIELD" ? base : { ...base, investigationCapabilities: options.agentCapabilities ?? FULL_CAPABILITIES }
    },
    loadDocuments: async () => [
      { documentId: DOC_ID, title: "Procedimento — Segunda via de conta", version: 1, content: PROCEDURE_V1, contentHash: "h1", perspective: "RULE_IN_FORCE_AT_CALL" as const },
      { documentId: CHECKLIST_ID, title: "Checklist de Encerramento de Chamada", version: 1, content: CHECKLIST_V1, contentHash: "h2", perspective: "RULE_IN_FORCE_AT_CALL" as const },
    ],
    loadPreviousVersion: async () => null,
    now,
    ...(options.allowCollaborator ? { allowCollaborator: options.allowCollaborator } : {}),
  }
  const { data, sliceQueries } = world(options.official ?? worsened, options.subjects ?? "LOCATED", options.daily ?? [])
  const investigate: InvestigateIndicatorDeps = { memory, data, analyze, strategy: async () => runtimeParametersOf(options.strategy ?? null), now, ...(options.tools ? { tools: options.tools } : {}), ...(options.maxCallAnalyses !== undefined ? { maxCallAnalyses: options.maxCallAnalyses } : {}), ...(options.maxToolCalls !== undefined ? { maxToolCalls: options.maxToolCalls } : {}) }
  return { investigate, analyze, memory, fake, sliceQueries }
}

export const request = (overrides: Partial<InvestigateIndicatorRequest> = {}): InvestigateIndicatorRequest => ({ organizationId: ORG, personId: PERSON, agentId: AGENT, agentConfiguredAt: "2026-09-01T00:00:00.000Z", enrollmentId: null, target: { kind: "OFFICIAL_CLOSING", indicatorCode: "TMA" }, trigger: { kind: "EVALUATION", selectionReason: "teste" }, now: new Date("2026-09-30T12:00:00Z"), ...overrides })
export async function investigationOf(memory: FeedbackMemoryStore, runId: string): Promise<IndicatorInvestigation> {
  return (await memory.getIndicatorInvestigationByRun(ORG, runId))!.investigation
}

/** Estratégia publicada com as seções informadas (o resto desligado) — o mesmo formato da V1.6.2. */
export function strategyWith(sections: { segmentation?: boolean; sample?: boolean; peers?: boolean; fixed?: boolean }) {
  return {
    id: "s-test",
    version: 1,
    config: {
      segmentation: { enabled: sections.segmentation ?? false, dimensions: ["SUBJECT" as const], minimumSegmentInteractions: 3 },
      interactionInvestigation: { enabled: sections.sample ?? false, maxInteractions: 5, minimumAnalyzed: 3, minimumCoveragePercent: null },
      processAssessment: { enabled: sections.sample ?? false },
      allowedBusinessDomainIds: [],
      peerComparison: { enabled: sections.peers ?? false, minimumPopulation: 4, minimumContributors: 4, minimumObservedInteractions: 5 },
      noDiagnosisBehavior: "FACTUAL_ONLY" as const,
      ...(sections.fixed ? { investigation: { mode: "FIXED" as const, objective: "", instructions: "", allowedSteps: [], prohibitedClaims: [] } } : {}),
    },
  } as never
}
