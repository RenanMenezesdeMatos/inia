import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveOfficialClosure } from "../../indicators/application/official-closure.js"
import { selectSample, periodDaysOf, type SamplingMetadata } from "../../investigation/domain/sampling-strategy.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf, startOfLocalDate } from "../../workflows/application/time-window.js"
import { selectedForInvestigation, triageClosing, type PrvTriage, type StrategyForTriage, type TriageDecision } from "../domain/closing-triage.js"
import { runtimeParametersOf, type DiagnosisRuntimeParameters } from "../domain/diagnostic-strategy.js"
import { buildSegments, diagnosisMetricOf, selectDiagnosisSegment, type DiagnosisMetric, type DiagnosisSegment } from "../domain/indicator-diagnosis.js"
import { choosableSteps, fixedStepsOf, selectInvestigationSteps, stepAvailabilityOf, type InvestigationStepSelection, type StepAvailability, type StepChoice } from "../domain/investigation-steps.js"
import { signalDistributionOf, signalEvolutionOf, type SignalDistribution, type SignalEvolution, type SignalRow } from "../domain/signal-population.js"
import { interactionReuseOf, type InteractionReuse, type StoredObservation } from "../domain/observation-compatibility.js"
import type { MixSegmentRow } from "../domain/population-mix.js"
import { referencePeriodDates, type OfficialIndicatorSnapshot, type PrvClosing } from "../domain/prv-closing.js"
import { directDiagnosisIdempotencyKey, prvDiagnosisIdempotencyKey, PRV_ASSESSMENT_LOGIC_VERSION, type DiagnosisSourceKind } from "../domain/prv-investigation.js"
import { loadEffectiveStrategy, loadStrategyVersion, type ResolvedStrategy } from "./diagnostic-strategy-service.js"
import { findPrvDiagnosis, latestClosingPeriod, latestIndicatorClosingPeriod, loadIndicatorClosing, loadPrvClosing, loadPublishedVersions, loadSegmentInteractions, loadSegmentRows, loadSignalFlag, loadSignalRows, loadStoredObservations, loadSubjectNames, type SegmentRow } from "./load-prv-closing-data.js"

/**
 * INDICATOR DIAGNOSIS V1 — PLANO DETERMINÍSTICO DO DIAGNÓSTICO DO FECHAMENTO (ZERO modelo). A MESMA função roda no nó "Chamar
 * agente" (para saber QUAIS chamadas ainda precisam de avaliação) e em "Gerar feedback" (que recalcula tudo e só aceita avaliação
 * das chamadas que o sistema teria pedido — a saída do nó de origem nunca é confiada):
 *
 *   fechamento oficial (competência mais recente já fechada) → estratégia EFETIVA por indicador (presa na saída do nó e reaplicada)
 *   → triagem → para cada indicador triado: janela da competência (fuso da organização) → população por motivo → motivo investigado
 *   (regra única do V1.6.1) → chamadas elegíveis (com transcrição) → REUSO das observações compatíveis → amostra determinística só
 *   do que falta avaliar → PREFLIGHT (população, amostra mínima) antes de qualquer IA.
 *
 * Nada aqui escolhe chamada "para provar hipótese": o motivo é o da regra única, a amostra é reproduzível (mesma entrada → mesmas
 * chamadas) e o que foi reaproveitado entra inteiro (não só as que confirmariam algo).
 */
export const PRV_CLOSING_PLAN_VERSION = "PRV_CLOSING_PLAN_V1" as const
/** O contrato de avaliação por chamada ao Agent aceita até 10 atendimentos (I1…I10). */
export const MAX_ASSESSMENTS_PER_RUN = 10

/** V2: + EVIDENCE_SOURCE_UNAVAILABLE (a estratégia pede uma evidência que o contrato de dados não tem) e PROCESS_NOT_SELECTED (a investigação escolhida não incluiu a avaliação de processos). */
export type InvestigationPlanStatus = "READY" | "NOT_DECOMPOSABLE" | "STRATEGY_NOT_CONFIGURED" | "SEGMENTATION_DISABLED" | "INVESTIGATION_DISABLED" | "DOMAIN_NOT_ALLOWED" | "NO_ELIGIBLE_POPULATION" | "NO_ELIGIBLE_SEGMENT" | "INSUFFICIENT_SAMPLE" | "EVIDENCE_SOURCE_UNAVAILABLE" | "PROCESS_NOT_SELECTED"

export type AssessmentRequest = { handle: string; interactionId: string; startedAt: string; localDate: string; indicatorCode: string }

export type IndicatorInvestigationPlan = {
  indicatorCode: string
  indicatorId: string
  snapshot: OfficialIndicatorSnapshot
  decision: TriageDecision
  strategy: ResolvedStrategy | null
  parameters: DiagnosisRuntimeParameters
  status: InvestigationPlanStatus
  window: { start: Date; end: Date; startDate: string; endDate: string; timeZone: string }
  metric: DiagnosisMetric | null
  interactionsInPeriod: number
  overallAverageDurationSeconds: number | null
  segments: DiagnosisSegment[]
  selectedSegment: { key: string; label: string; reason: string } | null
  mixRows: { current: MixSegmentRow[]; previous: MixSegmentRow[] }
  eligibleInteractions: { id: string; startedAt: Date }[]
  reuse: InteractionReuse[]
  storedObservations: StoredObservation[]
  toAssess: AssessmentRequest[]
  sampling: SamplingMetadata | null
  selectionReason: string
  /** V2 — passos escolhidos (estratégia × IA × disponibilidade). */
  steps: InvestigationStepSelection
  /** V2 — AGENT_SELECTED com escolha real e ainda sem escolha: o nó chama o planejador e recalcula o plano com ela. */
  needsPlanner: boolean
  /** V2 — população sinalizada (flag da estratégia); null = sem sinal declarado. */
  signal: { flagName: string; flagValid: boolean; distribution: SignalDistribution | null; evolution: SignalEvolution | null } | null
}

export type PrvClosingPlan = {
  version: typeof PRV_CLOSING_PLAN_VERSION
  /** V2 — origem: fechamento do PRV (N indicadores triados) ou diagnóstico DIRETO de um indicador. Ausente = fechamento do PRV. */
  source?: { kind: DiagnosisSourceKind; indicatorCode: string | null }
  status: "READY" | "NO_CLOSING" | "ALREADY_DIAGNOSED" | "NOTHING_TO_INVESTIGATE"
  organizationId: string
  personId: string
  timeZone: string
  closing: PrvClosing | null
  triage: PrvTriage | null
  strategies: { indicatorId: string; indicatorCode: string; strategyVersionId: string | null }[]
  idempotencyKey: string | null
  existingDiagnosis: { id: string; sourceArtifactId: string | null } | null
  investigations: IndicatorInvestigationPlan[]
  /** União das chamadas que precisam de avaliação (handles I1…In, ordem estável). Vazio = NENHUM modelo é chamado. */
  toAssess: AssessmentRequest[]
}

const round = (value: number) => Math.round(value)
const weekdayFormatters = new Map<string, Intl.DateTimeFormat>()
/** Dia da semana (0 = domingo) e hora LOCAIS da organização. */
export function localWeekdayAndHour(date: Date, timeZone: string): { weekday: number; hour: number } {
  const formatter = weekdayFormatters.get(timeZone) ?? new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" })
  weekdayFormatters.set(timeZone, formatter)
  const parts = formatter.formatToParts(date)
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((part) => part.type === "weekday")?.value ?? "Sun")
  return { weekday: Math.max(weekday, 0), hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24 }
}

function toMixRows(rows: readonly SegmentRow[], names: ReadonlyMap<string, string>): MixSegmentRow[] {
  return rows.filter((row) => row.key !== null).map((row) => ({ key: row.key!, label: row.canonical ? names.get(row.key!) ?? row.key! : row.key!, interactions: row.interactions, totalDurationSeconds: row.totalDurationSeconds }))
}

export type PreparePrvClosingInput = {
  personId: string
  now: Date
  agentId: string | null
  /** Versões de estratégia PRESAS (saída do nó "Chamar agente"). Ausente = a versão EFETIVA agora (o nó que abre a execução). */
  pinnedStrategies?: readonly { indicatorId: string; strategyVersionId: string | null }[] | null
  /** Competência PRESA (saída do nó). Ausente = a mais recente já fechada. */
  referencePeriod?: string | null
  /** V2 — escolha de passos por indicador (AGENT_SELECTED): a do planejador no nó, ou a presa na saída do nó ("Gerar feedback"). */
  stepChoices?: Readonly<Record<string, { choice: StepChoice[] | null; planner: InvestigationStepSelection["planner"] }>> | null
}

/** V2 — diagnóstico DIRETO de UM indicador (sem PRV): o indicador é do Workflow; o resto (estratégia, período, sujeito) é do sistema. */
export type PrepareDirectDiagnosisInput = Omit<PreparePrvClosingInput, "pinnedStrategies"> & { indicatorCode: string; pinnedStrategyVersionId?: string | null }

/**
 * Hoje NENHUM contrato de interação traz vínculo explícito entre atendimentos (qual atendimento precedeu uma rechamada, de qual
 * cliente/caso): o passo que dependeria dele é declarado indisponível — nunca substituído por pareamento por semelhança.
 */
export const LINKED_INTERACTIONS_SUPPORTED = false

const round1 = (value: number) => Math.round(value * 10) / 10
void round1

type SharedRows = { names: Map<string, string>; currentRows: SegmentRow[]; previousRows: SegmentRow[]; agentDomain: string | null; start: Date; end: Date; previousStart: Date; startDate: string; endDate: string }

async function loadSharedRows(db: Pick<Database, "query">, organizationId: string, input: { personId: string; agentId: string | null; referencePeriod: string; timeZone: string }): Promise<SharedRows> {
  const { startDate, endDate, previousPeriod } = referencePeriodDates(input.referencePeriod)
  const previousDates = referencePeriodDates(previousPeriod)
  const start = startOfLocalDate(startDate, input.timeZone)
  const end = startOfLocalDate(endDate, input.timeZone)
  const previousStart = startOfLocalDate(previousDates.startDate, input.timeZone)
  const names = await loadSubjectNames(db, organizationId)
  const currentRows = await loadSegmentRows(db, { organizationId, personId: input.personId, start, end })
  const previousRows = await loadSegmentRows(db, { organizationId, personId: input.personId, start: previousStart, end: start })
  const agentDomain = input.agentId ? (await db.query<{ business_domain_id: string | null }>(`select business_domain_id from agents where id = $1 and organization_id = $2`, [input.agentId, organizationId])).rows[0]?.business_domain_id ?? null : null
  return { names, currentRows, previousRows, agentDomain, start, end, previousStart, startDate, endDate }
}

const labelOf = (row: { key: string | null; canonical: boolean }, names: ReadonlyMap<string, string>) => (row.canonical ? names.get(row.key!) ?? row.key! : row.key!)

/**
 * PLANO DE UMA INVESTIGAÇÃO DE INDICADOR (a peça genérica): a MESMA função para o fechamento do PRV e para o diagnóstico direto.
 * Nenhum código de indicador aqui — só unidade, estratégia (sinal, passos, população do processo) e dados.
 */
async function planIndicatorInvestigation(db: Pick<Database, "query">, organizationId: string, input: { personId: string; timeZone: string; decision: TriageDecision; snapshot: OfficialIndicatorSnapshot; strategy: ResolvedStrategy | null; shared: SharedRows; stepChoice: { choice: StepChoice[] | null; planner: InvestigationStepSelection["planner"] } | null }): Promise<IndicatorInvestigationPlan> {
  const { snapshot, decision, strategy, shared } = input
  const { names, currentRows, previousRows, agentDomain, start, end, previousStart, startDate, endDate } = shared
  const timeZone = input.timeZone
  const parameters = runtimeParametersOf(strategy)
  const metric = diagnosisMetricOf(snapshot.unit, parameters.populationSignal)
  const interactionsInPeriod = currentRows.reduce((sum, row) => sum + row.interactions, 0)
  const totalDuration = currentRows.every((row) => row.totalDurationSeconds !== null) ? currentRows.reduce((sum, row) => sum + (row.totalDurationSeconds ?? 0), 0) : null
  const overallAverageDurationSeconds = totalDuration !== null && interactionsInPeriod > 0 ? round(totalDuration / interactionsInPeriod) : null

  // V2 — SINAL DA POPULAÇÃO (flag já calculada pela fonte): lido só quando a estratégia declara; a flag precisa existir e ser de sim/não.
  let signal: IndicatorInvestigationPlan["signal"] = null
  if (strategy && parameters.populationSignal) {
    const flag = await loadSignalFlag(db, organizationId, parameters.populationSignal.flagName)
    if (flag.valid) {
      const toSignalRows = (rows: Awaited<ReturnType<typeof loadSignalRows>>): SignalRow[] => rows.filter((row) => row.key !== null).map((row) => ({ key: row.key!, label: labelOf(row, names), interactions: row.interactions, signaled: row.signaled }))
      const current = toSignalRows(await loadSignalRows(db, { organizationId, personId: input.personId, start, end, channelFlagIds: flag.channelFlagIds }))
      const previous = toSignalRows(await loadSignalRows(db, { organizationId, personId: input.personId, start: previousStart, end: start, channelFlagIds: flag.channelFlagIds }))
      signal = { flagName: parameters.populationSignal.flagName, flagValid: true, distribution: signalDistributionOf(current, parameters.populationSignal.flagName), evolution: signalEvolutionOf(current, previous) }
    } else signal = { flagName: parameters.populationSignal.flagName, flagValid: false, distribution: null, evolution: null }
  }

  // V2 — PASSOS: disponibilidade real × estratégia × (AGENT_SELECTED) escolha da IA. FIXED = as chaves, exatamente como antes.
  const availability: StepAvailability[] = stepAvailabilityOf({
    decomposable: metric !== null,
    segmentationEnabled: parameters.segmentation.enabled && parameters.segmentation.dimensions.includes("SUBJECT"),
    processEnabled: parameters.sample.enabled && parameters.processAssessment,
    processPopulation: parameters.processPopulation,
    signalConfigured: parameters.populationSignal !== null,
    signalFlagValid: signal?.flagValid ?? false,
    linkedInteractionsSupported: LINKED_INTERACTIONS_SUPPORTED,
  })
  const agentSelected = strategy !== null && parameters.investigation.mode === "AGENT_SELECTED"
  const fixed = fixedStepsOf({ segmentationEnabled: parameters.segmentation.enabled, processEnabled: parameters.sample.enabled && parameters.processAssessment, signalConfigured: parameters.populationSignal !== null })
  const choosable = agentSelected ? choosableSteps(parameters.investigation.allowedSteps, availability) : []
  const plannerStatus: InvestigationStepSelection["planner"] = input.stepChoice?.planner ?? { status: !agentSelected ? "NOT_APPLICABLE" : choosable.length <= 1 ? "SKIPPED_NO_CHOICE" : "FALLBACK_DEFAULT", agentRunId: null, attempts: 0, error: null }
  const steps = selectInvestigationSteps({ mode: agentSelected ? "AGENT_SELECTED" : "FIXED", allowed: parameters.investigation.allowedSteps, fixed, availability, choice: agentSelected ? input.stepChoice?.choice ?? null : null, planner: plannerStatus })
  const needsPlanner = agentSelected && choosable.length > 1 && !input.stepChoice

  const plan: IndicatorInvestigationPlan = {
    indicatorCode: snapshot.indicatorCode,
    indicatorId: snapshot.indicatorId,
    snapshot,
    decision,
    strategy,
    parameters,
    status: "READY",
    window: { start, end, startDate, endDate, timeZone },
    metric,
    interactionsInPeriod,
    overallAverageDurationSeconds,
    segments: [],
    selectedSegment: null,
    mixRows: { current: toMixRows(currentRows, names), previous: toMixRows(previousRows, names) },
    eligibleInteractions: [],
    reuse: [],
    storedObservations: [],
    toAssess: [],
    sampling: null,
    selectionReason: "",
    steps,
    needsPlanner,
    signal,
  }
  if (!strategy) { plan.status = "STRATEGY_NOT_CONFIGURED"; return plan }
  if (!metric) { plan.status = "NOT_DECOMPOSABLE"; return plan }
  if (!parameters.segmentation.enabled || !parameters.segmentation.dimensions.includes("SUBJECT")) { plan.status = "SEGMENTATION_DISABLED"; return plan }
  if (parameters.allowedBusinessDomainIds.length > 0 && (!agentDomain || !parameters.allowedBusinessDomainIds.includes(agentDomain))) { plan.status = "DOMAIN_NOT_ALLOWED"; return plan }
  if (interactionsInPeriod === 0) { plan.status = "NO_ELIGIBLE_POPULATION"; return plan }
  plan.segments = buildSegments(currentRows.filter((row) => row.key !== null).map((row) => ({ key: row.key!, label: labelOf(row, names), canonical: row.canonical, interactions: row.interactions, withTranscript: row.withTranscript, averageDurationSeconds: row.totalDurationSeconds !== null && row.interactions > 0 ? round(row.totalDurationSeconds / row.interactions) : null })), parameters.segmentation.minimumSegmentInteractions)

  // V2 — processo sobre os atendimentos ANTERIORES vinculados ao sinal: sem vínculo no contrato de dados, nada é presumido.
  const processAvailability = availability.find((entry) => entry.step === "PROCESS_ASSESSMENT")!
  if (parameters.sample.enabled && parameters.processAssessment && processAvailability.reason === "DATA_CONTRACT_NO_INTERACTION_LINK") {
    plan.selectedSegment = signal?.distribution?.concentration ? { key: signal.distribution.concentration.key, label: signal.distribution.concentration.label, reason: "motivo em que as interações sinalizadas se concentram" } : null
    plan.status = "EVIDENCE_SOURCE_UNAVAILABLE"
    return plan
  }

  // Reconhecimento: nunca procura onde há "excesso" — o motivo mais representativo. Desenvolvimento: regra única do V1.6.1.
  // V2 — com métrica de SINAL, o motivo investigado é aquele em que o sinal se concentra (regra da população sinalizada).
  plan.selectedSegment = metric === "INTERACTION_SIGNAL_RATE" && signal?.distribution?.concentration && plan.segments.some((segment) => segment.key === signal!.distribution!.concentration!.key && segment.eligible)
    ? { key: signal.distribution.concentration.key, label: signal.distribution.concentration.label, reason: "motivo em que as interações sinalizadas se concentram" }
    : selectDiagnosisSegment(plan.segments, { metric, direction: snapshot.direction, withinTarget: decision.decision === "RECOGNIZE" ? true : decision.official.withinReference, overallAverageDurationSeconds })
  if (!plan.selectedSegment) { plan.status = "NO_ELIGIBLE_SEGMENT"; return plan }
  if (!parameters.sample.enabled || !parameters.processAssessment) { plan.status = "INVESTIGATION_DISABLED"; return plan }
  if (steps.mode === "AGENT_SELECTED" && !steps.selected.includes("PROCESS_ASSESSMENT")) { plan.status = "PROCESS_NOT_SELECTED"; return plan }

  plan.eligibleInteractions = await loadSegmentInteractions(db, { organizationId, personId: input.personId, start, end, segmentKey: plan.selectedSegment.key })
  if (plan.eligibleInteractions.length === 0) { plan.status = "NO_ELIGIBLE_POPULATION"; return plan }
  plan.storedObservations = await loadStoredObservations(db, { organizationId, personId: input.personId, interactionIds: plan.eligibleInteractions.map((entry) => entry.id) })
  const versions = await loadPublishedVersions(db, organizationId, plan.storedObservations.map((observation) => observation.documentId))
  // V1.0.2 — pendência gravada por lógica anterior é reavaliada (nunca reaproveitada com a pendência antiga).
  plan.reuse = plan.eligibleInteractions.map((entry) => interactionReuseOf(entry.id, plan.storedObservations, versions, PRV_ASSESSMENT_LOGIC_VERSION))
  const reusable = plan.reuse.filter((entry) => entry.status === "REUSABLE").length
  // Só o que FALTA até o teto da estratégia é avaliado: reaproveitadas contam primeiro (custo zero), sem descartar nenhuma.
  const missing = Math.max(0, parameters.sample.maxInteractions - reusable)
  const candidates = plan.eligibleInteractions.filter((entry) => plan.reuse.find((reuse) => reuse.interactionId === entry.id)!.status !== "REUSABLE")
  const periodDays = periodDaysOf({ start, end })
  const sampled = missing > 0 && candidates.length > 0
    ? selectSample({ candidates, strategy: "TEMPORAL_STRATIFIED", limit: missing, period: { start, end }, periodDays, startedAtOf: (entry) => entry.startedAt, keyOf: (entry) => entry.id, dateLabelOf: (date) => localDateOf(date, timeZone) })
    : { selected: [] as { id: string; startedAt: Date }[], metadata: null }
  plan.sampling = sampled.metadata
  plan.selectionReason = `${reusable} chamada(s) do motivo já avaliada(s) de forma compatível reaproveitada(s) integralmente; ${sampled.selected.length} nova(s) escolhida(s) de forma determinística e distribuída no período entre as ${candidates.length} ainda sem avaliação compatível, até o teto de ${parameters.sample.maxInteractions} da estratégia`
  // PREFLIGHT: amostra possível abaixo do mínimo = nenhuma IA (a conclusão é INSUFFICIENT_SAMPLE).
  if (reusable + sampled.selected.length < parameters.sample.minimumAnalyzed) { plan.status = "INSUFFICIENT_SAMPLE"; return plan }
  plan.toAssess = sampled.selected.map((entry) => ({ handle: "", interactionId: entry.id, startedAt: entry.startedAt.toISOString(), localDate: localDateOf(entry.startedAt, timeZone), indicatorCode: snapshot.indicatorCode }))
  return plan
}

/** Handles estáveis na união (a mesma chamada investigada por dois indicadores é avaliada UMA vez); teto do contrato I1…I10. */
function assignHandles(investigations: IndicatorInvestigationPlan[]): AssessmentRequest[] {
  const union: AssessmentRequest[] = []
  for (const plan of investigations) {
    plan.toAssess = plan.toAssess.filter((request) => {
      const known = union.find((entry) => entry.interactionId === request.interactionId)
      if (known) { request.handle = known.handle; return true }
      if (union.length >= MAX_ASSESSMENTS_PER_RUN) return false
      request.handle = `I${union.length + 1}`
      union.push(request)
      return true
    })
  }
  return union
}

export async function preparePrvClosingPlan(db: Pick<Database, "query">, organizationId: string, input: PreparePrvClosingInput): Promise<PrvClosingPlan> {
  const timeZone = await resolveOrganizationTimezone(db as Database, organizationId)
  const empty = (status: PrvClosingPlan["status"], extra: Partial<PrvClosingPlan> = {}): PrvClosingPlan => ({ version: PRV_CLOSING_PLAN_VERSION, status, organizationId, personId: input.personId, timeZone, closing: null, triage: null, strategies: [], idempotencyKey: null, existingDiagnosis: null, investigations: [], toAssess: [], ...extra })
  const closure = await resolveOfficialClosure(db as Database, organizationId, input.now)
  const referencePeriod = input.referencePeriod && input.referencePeriod <= closure.lastClosedPeriod ? input.referencePeriod : await latestClosingPeriod(db, { organizationId, personId: input.personId, lastClosedPeriod: closure.lastClosedPeriod })
  if (!referencePeriod) return empty("NO_CLOSING")
  const closing = await loadPrvClosing(db, { organizationId, personId: input.personId, referencePeriod })
  if (!closing) return empty("NO_CLOSING")

  // Estratégia por indicador: a PRESA (quando informada) — só vale se for uma versão publicada DESTE indicador — ou a efetiva agora.
  const pinned = new Map((input.pinnedStrategies ?? []).map((entry) => [entry.indicatorId, entry.strategyVersionId]))
  const resolved = new Map<string, ResolvedStrategy | null>()
  for (const snapshot of closing.indicators) {
    const pin = input.pinnedStrategies ? pinned.get(snapshot.indicatorId) ?? null : undefined
    resolved.set(snapshot.indicatorId, pin === undefined ? await loadEffectiveStrategy(db, organizationId, { id: snapshot.indicatorId }) : pin ? await loadStrategyVersion(db, organizationId, pin, snapshot.indicatorId) : null)
  }
  const forTriage = new Map<string, StrategyForTriage>([...resolved.entries()].map(([indicatorId, strategy]) => [indicatorId, strategy ? { versionId: strategy.id, version: strategy.version, closingTriage: strategy.config.closingTriage } : null]))
  const triage = triageClosing(closing, forTriage)
  const strategies = closing.indicators.map((snapshot) => ({ indicatorId: snapshot.indicatorId, indicatorCode: snapshot.indicatorCode, strategyVersionId: resolved.get(snapshot.indicatorId)?.id ?? null }))
  const idempotencyKey = prvDiagnosisIdempotencyKey({ organizationId, personId: input.personId, referencePeriod, strategies })
  const existing = await findPrvDiagnosis(db, organizationId, idempotencyKey)
  const base = { closing, triage, strategies, idempotencyKey }
  if (existing) return empty("ALREADY_DIAGNOSED", { ...base, existingDiagnosis: { id: existing.id, sourceArtifactId: existing.sourceArtifactId } })

  const selected = selectedForInvestigation(triage)
  if (selected.length === 0) return empty("NOTHING_TO_INVESTIGATE", base)

  const shared = await loadSharedRows(db, organizationId, { personId: input.personId, agentId: input.agentId, referencePeriod, timeZone })
  const investigations: IndicatorInvestigationPlan[] = []
  for (const decision of selected) {
    const snapshot = closing.indicators.find((entry) => entry.snapshotId === decision.snapshotId)!
    investigations.push(await planIndicatorInvestigation(db, organizationId, { personId: input.personId, timeZone, decision, snapshot, strategy: resolved.get(snapshot.indicatorId) ?? null, shared, stepChoice: input.stepChoices?.[snapshot.indicatorCode] ?? null }))
  }
  // Teto do contrato de avaliação (I1…I10 por chamada ao Agent): o que excede fica fora desta execução, nunca é avaliado em silêncio.
  const union = assignHandles(investigations)
  return { version: PRV_CLOSING_PLAN_VERSION, status: "READY", organizationId, personId: input.personId, timeZone, ...base, existingDiagnosis: null, investigations, toAssess: union }
}

/**
 * INDICATOR DIAGNOSIS V2 — PLANO DO DIAGNÓSTICO DIRETO DE UM INDICADOR (sem fechamento do PRV). O Workflow só diz QUAL indicador;
 * o sistema decide o resto com o MESMO planejador por indicador do fechamento: competência oficial mais recente já fechada DAQUELE
 * indicador (contrato OFFICIAL_INDICATOR_PERFORMANCE, nunca PRV), anterior do mesmo indicador, estratégia efetiva (ou a presa),
 * triagem da estratégia, chave própria (indicador + período + colaborador + versão da estratégia + snapshot oficial).
 */
export async function prepareDirectIndicatorPlan(db: Pick<Database, "query">, organizationId: string, input: PrepareDirectDiagnosisInput): Promise<PrvClosingPlan> {
  const timeZone = await resolveOrganizationTimezone(db as Database, organizationId)
  const source = { kind: "DIRECT_INDICATOR" as const, indicatorCode: input.indicatorCode }
  const empty = (status: PrvClosingPlan["status"], extra: Partial<PrvClosingPlan> = {}): PrvClosingPlan => ({ version: PRV_CLOSING_PLAN_VERSION, source, status, organizationId, personId: input.personId, timeZone, closing: null, triage: null, strategies: [], idempotencyKey: null, existingDiagnosis: null, investigations: [], toAssess: [], ...extra })
  const indicator = (await db.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = $2 and active`, [organizationId, input.indicatorCode])).rows[0]
  if (!indicator) return empty("NO_CLOSING")
  const closure = await resolveOfficialClosure(db as Database, organizationId, input.now)
  const referencePeriod = input.referencePeriod && input.referencePeriod <= closure.lastClosedPeriod ? input.referencePeriod : await latestIndicatorClosingPeriod(db, { organizationId, personId: input.personId, indicatorId: indicator.id, lastClosedPeriod: closure.lastClosedPeriod })
  if (!referencePeriod) return empty("NO_CLOSING")
  const closing = await loadIndicatorClosing(db, { organizationId, personId: input.personId, indicatorId: indicator.id, referencePeriod })
  if (!closing) return empty("NO_CLOSING")
  const snapshot = closing.indicators[0]!
  const strategy = input.pinnedStrategyVersionId === undefined ? await loadEffectiveStrategy(db, organizationId, { id: indicator.id }) : input.pinnedStrategyVersionId ? await loadStrategyVersion(db, organizationId, input.pinnedStrategyVersionId, indicator.id) : null
  const triage = triageClosing(closing, new Map<string, StrategyForTriage>([[indicator.id, strategy ? { versionId: strategy.id, version: strategy.version, closingTriage: strategy.config.closingTriage } : null]]))
  const strategies = [{ indicatorId: indicator.id, indicatorCode: snapshot.indicatorCode, strategyVersionId: strategy?.id ?? null }]
  const idempotencyKey = directDiagnosisIdempotencyKey({ organizationId, personId: input.personId, referencePeriod, indicatorCode: snapshot.indicatorCode, strategyVersionId: strategy?.id ?? null, snapshot })
  const existing = await findPrvDiagnosis(db, organizationId, idempotencyKey)
  const base = { closing, triage, strategies, idempotencyKey }
  if (existing) return empty("ALREADY_DIAGNOSED", { ...base, existingDiagnosis: { id: existing.id, sourceArtifactId: existing.sourceArtifactId } })
  const decision = selectedForInvestigation(triage)[0]
  if (!decision) return empty("NOTHING_TO_INVESTIGATE", base)
  const shared = await loadSharedRows(db, organizationId, { personId: input.personId, agentId: input.agentId, referencePeriod, timeZone })
  const investigations = [await planIndicatorInvestigation(db, organizationId, { personId: input.personId, timeZone, decision, snapshot, strategy, shared, stepChoice: input.stepChoices?.[snapshot.indicatorCode] ?? null })]
  const union = assignHandles(investigations)
  return { version: PRV_CLOSING_PLAN_VERSION, source, status: "READY", organizationId, personId: input.personId, timeZone, ...base, existingDiagnosis: null, investigations, toAssess: union }
}
