import { DEFAULT_HYPOTHESES, definitionHashOf, type BehaviorCandidate, type ModelCall } from "../domain/candidates.js"
import { CODING_BATCH_SIZE, CODING_SYSTEM_PROMPT, codingSchemaFor, isCodingResponseUsable, renderCodingTurn, verifyCodings, type CodingBehavior } from "../domain/coding-prompt.js"
import { callOutcomeLabelsOf, callOutcomeOf } from "../../channel-flags/domain/call-outcome.js"
import { classifyOperators, COMPARISON_LABELS, signalComparisonLabels, type ComparisonMode, type GroupKind } from "../domain/comparison.js"
import { DISCOVERY_SYSTEM_PROMPT, discoverySchemaFor, parseDiscovery, renderDiscoveryTurn, type DiscoveryRejection, type HypothesisForPrompt, type KnownPatternForPrompt } from "../domain/discovery-prompt.js"
import { assessCandidateInContext, EVIDENCE_METHOD, strongestOf, type CodedCall, type EvidenceStrength } from "../domain/evidence-criteria.js"
import { decideObligation, OBLIGATION_SYSTEM_PROMPT, obligationSchemaFor, parseObligationReadings, renderObligationTurn, type ObligationCandidate, type ObligationCheck } from "../domain/obligation-check.js"
import type { StoredObligationStatus } from "../domain/pattern.js"
import { contextLabelOf, planSample, samplingSeedOf, type CallMeta, type CellPlan, type SampledCall } from "../domain/sampling.js"
import { BEST_PRACTICE_ANALYSIS_LOGIC_VERSION, BEST_PRACTICE_CODING_PROMPT_VERSION, BEST_PRACTICE_DISCOVERY_PROMPT_VERSION, BEST_PRACTICE_EVIDENCE_VERSION, BEST_PRACTICE_OBLIGATION_PROMPT_VERSION } from "../domain/versions.js"
import { selectEvidence } from "./evidence-selection.js"
import { AnalysisModelBudget, type ModelUsageSummary } from "./model-budget.js"
import { reuseKeyOf, type AnalysisRequest, type BestPracticeModelPort, type BestPracticeStore, type CallCorpus, type CodingRecord, type ContextResult, type CorpusCall, type CorpusOperator, type IndicatorInfo, type KnownPattern, type PatternScope, type PatternWrite, type SignalInfo } from "./ports.js"

/**
 * ANÁLISE DE BOAS PRÁTICAS — "o que os operadores com melhores resultados fazem nas conversas que pode ajudar os outros?"
 *
 *  1. grupos pelo quartil OFICIAL do indicador (comparison.ts) — ou, pelo SINAL da chamada, chamadas boas × ruins pelo critério
 *     cadastrado no sinal (call-outcome.ts) — e contextos/amostra reproduzíveis (sampling.ts);
 *  2. sem contexto elegível → INSUFFICIENT_DATA, nenhuma chamada ao modelo;
 *  3. DESCOBERTA contrastiva (hipóteses; padrões já existentes do mesmo escopo entram sempre para serem medidos de novo);
 *  4. CODIFICAÇÃO cega ao grupo de TODAS as chamadas da amostra × candidatos, com trecho literal conferido (reaproveita a
 *     codificação já feita da mesma chamada, mesma definição, mesmo texto e mesmo modo de modelo);
 *  5. NÚMEROS por contexto (evidence-criteria.ts) — só o código calcula;
 *  6. OBRIGAÇÃO: só para o que se sustentou; obrigação/conflito nunca vira padrão; dúvida fica pendente e fora das recomendações;
 *  7. grava padrões (novo ou nova versão do existente), evidências mascaradas e todas as codificações; o relatório explica cada
 *     descarte (isolado, concentrado, sem diferença, obrigação, áudio…).
 */
/** `indicator` quando o resultado é o indicador; `signal` quando é o sinal da chamada (exatamente um, como no pedido). */
export type RunAnalysisDeps = { corpus: CallCorpus; store: BestPracticeStore; model: BestPracticeModelPort; indicator: IndicatorInfo | null; signal?: SignalInfo | null; now: () => Date }

export type CandidateDecision = "PATTERN_CREATED" | "PATTERN_UPDATED" | "PATTERN_WEAKENED" | "DISCARDED_OBLIGATION" | "DISCARDED_CONFLICT" | "NOT_SUPPORTED"
export type CandidateReport = {
  key: string
  name: string
  origin: BehaviorCandidate["origin"]
  patternId: string | null
  definitionHash: string
  observableDefinition: string
  hypothesisRef: string | null
  contexts: ContextResult[]
  strength: EvidenceStrength
  obligation: ObligationCheck | null
  decision: CandidateDecision
  decisionNote: string
}
export type AnalysisOutcome = "PATTERNS_FOUND" | "NO_PATTERN" | "INSUFFICIENT_DATA" | "PARTIAL"
export type AnalysisReport = {
  version: typeof BEST_PRACTICE_ANALYSIS_LOGIC_VERSION
  outcome: AnalysisOutcome
  summary: string
  indicator: IndicatorInfo | null
  /** Pelo sinal da chamada: o sinal e os critérios de chamada boa e ruim usados. */
  signal: { id: string; name: string; good: string; bad: string } | null
  population: { label: string; origin: AnalysisRequest["origin"] }
  period: { start: string; end: string; referencePeriods: string[] }
  comparison: { mode: AnalysisRequest["comparison"]; top: string; reference: string; method: string }
  groups: { top: number; reference: number; excluded: { reason: string; count: number }[] }
  cells: (CellPlan & { label: string; callsPerOperator: Record<GroupKind, { min: number; max: number } | null> })[]
  discovery: { calls: number; proposed: number; rejected: DiscoveryRejection[]; recognizedKnown: string[]; noCandidateReason: string | null; failed: boolean }
  candidates: CandidateReport[]
  codings: { total: number; reused: number; unclear: number; unverifiedQuotes: number; fromCustomer: number; modelFailures: number }
  limitations: string[]
  method: readonly string[]
  usage: ModelUsageSummary
  created: string[]
  updated: string[]
}

const DIRECTION_TEXT: Record<IndicatorInfo["direction"], string> = { HIGHER: "maior é melhor", LOWER: "menor é melhor", TARGET: "mais perto da meta é melhor" }
/** Comportamentos por pedido de codificação (com os padrões já conhecidos, raramente passa disso). */
const BEHAVIOR_CHUNK = 12
const OBLIGATION_CHUNK = 8

function windowOf(periods: readonly string[]): { start: string; endExclusive: string; endInclusive: string } {
  const sorted = [...periods].sort()
  const last = sorted.at(-1)!
  const [year, month] = last.split("-").map(Number) as [number, number]
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`
  const end = new Date(`${next}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() - 1)
  return { start: `${sorted[0]}-01`, endExclusive: next, endInclusive: end.toISOString().slice(0, 10) }
}

const dateLabel = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

function candidateFromKnown(pattern: KnownPattern): Omit<BehaviorCandidate, "key"> {
  const base = { observableDefinition: pattern.observableDefinition, appliesWhen: pattern.appliesWhen, notApplicableWhen: pattern.notApplicableWhen }
  return { origin: "KNOWN_PATTERN", patternId: pattern.id, name: pattern.name, description: pattern.description, ...base, guidance: pattern.guidance, suggestedPhrasing: pattern.suggestedPhrasing, phrasingContexts: pattern.phrasingContexts, howItHelps: pattern.howItHelps ?? null, requiresAudio: false, exampleRefs: [], hypothesisRef: null, definitionHash: definitionHashOf(base) }
}

function spreadOf(sample: readonly SampledCall[], cellKey: string, group: GroupKind): { min: number; max: number } | null {
  const counts = new Map<string, number>()
  for (const call of sample) if (call.cellKey === cellKey && call.group === group) counts.set(call.operatorRef, (counts.get(call.operatorRef) ?? 0) + 1)
  return counts.size === 0 ? null : { min: Math.min(...counts.values()), max: Math.max(...counts.values()) }
}

export async function runBestPracticeAnalysis(deps: RunAnalysisDeps, request: AnalysisRequest): Promise<{ report: AnalysisReport; provenance: Record<string, unknown>; completedInStore: boolean }> {
  const scope: PatternScope = { organizationId: request.organizationId, origin: request.origin, syntheticDatasetId: request.syntheticDatasetId, indicatorDefinitionId: request.indicatorDefinitionId, channelFlagId: request.channelFlagId, teamId: request.teamId, subteamId: request.subteamId }
  const signal = request.channelFlagId ? deps.signal ?? null : null
  if (request.channelFlagId && !signal) throw new Error("BEST_PRACTICE_SIGNAL_MISSING")
  if (!request.channelFlagId && !deps.indicator) throw new Error("BEST_PRACTICE_INDICATOR_MISSING")
  const signalLabels = signal ? callOutcomeLabelsOf(signal.name, signal.outcome) : null
  const budget = new AnalysisModelBudget(deps.model, request.parameters.maxModelCalls)
  const window = windowOf(request.referencePeriods)
  const comparison = { mode: request.comparison, ...(signalLabels ? signalComparisonLabels(signalLabels) : COMPARISON_LABELS[request.comparison as ComparisonMode]) }
  const limitations: string[] = [
    "Associação observada, nunca causa: o comportamento aparecer mais entre os melhores resultados não mostra que ele produz o resultado.",
    "Só o que está na transcrição é avaliado: tom de voz, entonação e pausas (que exigiriam o áudio) ficam fora.",
    "A comparação considera a população (Grupo ou Subgrupo), o contexto (motivo/submotivo), o canal e o período; fila e produto não fazem parte dos dados de interação.",
  ]
  if (request.origin === "SYNTHETIC") limitations.unshift("DADOS SINTÉTICOS: validam o mecanismo, não provam que as hipóteses funcionam no mundo real. Nunca alimentam recomendações de produção.")
  if (request.modelMode === "SIMULATED_ANSWER_KEY") limitations.unshift("Modelo SIMULADO: as respostas de descoberta, codificação e verificação de obrigação vieram do gabarito do dataset sintético (zero IA). Validação do mecanismo, não do modelo.")

  // 1) Grupos e amostra. Indicador: grupo do OPERADOR pelo quartil oficial. Sinal: grupo da CHAMADA pelo valor do sinal nela.
  const operators = await deps.corpus.operators()
  const operatorByRef = new Map(operators.map((operator) => [operator.ref, operator]))
  const excludedCounts = new Map<string, number>()
  const exclude = (reason: string) => excludedCounts.set(reason, (excludedCounts.get(reason) ?? 0) + 1)
  let calls: CorpusCall[]
  let groupOf: (call: CallMeta) => GroupKind | null
  let groupCounts: { top: number; reference: number }
  if (signal) {
    calls = operators.length > 0 ? await deps.corpus.calls(operators.map((operator) => operator.ref), window, request.channel) : []
    const values = await deps.corpus.callSignals(calls.map((call) => call.ref), signal)
    const groupByCall = new Map<string, GroupKind | null>()
    for (const call of calls) {
      const value = values.get(call.ref)
      const outcome = callOutcomeOf(signal.outcome, value)
      groupByCall.set(call.ref, outcome === "GOOD" ? "TOP" : outcome === "BAD" ? "REFERENCE" : null)
      if (!outcome) exclude(value ? "SIGNAL_MIDDLE_VALUE" : "NO_SIGNAL")
    }
    groupOf = (call) => groupByCall.get(call.ref) ?? null
    groupCounts = { top: [...groupByCall.values()].filter((group) => group === "TOP").length, reference: [...groupByCall.values()].filter((group) => group === "REFERENCE").length }
  } else {
    const classification = classifyOperators(operators.map((operator) => operator.ref), await deps.corpus.quartiles(request.indicatorDefinitionId!, request.referencePeriods), request.comparison as ComparisonMode)
    const classified = [...classification.values()]
    for (const item of classified) if (!item.group) exclude(item.reason)
    const groupRefs = classified.filter((item) => item.group).map((item) => item.operatorRef)
    calls = groupRefs.length > 0 ? await deps.corpus.calls(groupRefs, window, request.channel) : []
    groupOf = (call) => classification.get(call.operatorRef)?.group ?? null
    groupCounts = { top: classified.filter((item) => item.group === "TOP").length, reference: classified.filter((item) => item.group === "REFERENCE").length }
  }
  const callByRef = new Map<string, CorpusCall>(calls.map((call) => [call.ref, call]))
  // O Subgrupo e o sinal só entram na semente quando existem: a análise do Grupo pelo indicador pedida de novo escolhe as mesmas chamadas.
  const seed = samplingSeedOf([request.organizationId, request.origin, request.syntheticDatasetId, request.indicatorDefinitionId, request.teamId, [...request.referencePeriods].sort().join(","), request.contextLevel, request.channel, request.comparison, ...(request.subteamId ? [request.subteamId] : []), ...(request.channelFlagId ? [request.channelFlagId] : [])])
  const plan = planSample({ calls, groupOf, level: request.contextLevel, parameters: request.parameters, seed })
  const transcripts = await deps.corpus.transcripts([...new Set([...plan.sample, ...plan.discovery].map((call) => call.ref))])
  const sample = plan.sample.filter((call) => transcripts.has(call.ref))
  const missingTranscripts = plan.sample.length - sample.length
  if (missingTranscripts > 0) limitations.push(`${missingTranscripts} chamada(s) sorteada(s) sem transcrição utilizável ficaram fora.`)
  const eligible = plan.cells.filter((cell) => cell.status === "ELIGIBLE")
  const fewCalls = eligible.reduce((sum, cell) => sum + cell.groups.TOP.fewCalls + cell.groups.REFERENCE.fewCalls, 0)
  if (fewCalls > 0) limitations.push(`${fewCalls} operador(es) com poucas chamadas transcritas num contexto ficaram fora daquele contexto (menos de ${Math.max(2, request.parameters.minCallsPerOperator)}).`)
  // Em indicador de TEMPO a duração é o próprio resultado; nos demais, duração muito diferente sugere complexidade diferente.
  if (deps.indicator?.unit !== "SECONDS") {
    for (const cell of eligible) {
      const top = cell.groups.TOP.medianDurationSeconds
      const reference = cell.groups.REFERENCE.medianDurationSeconds
      if (top !== null && reference !== null && Math.max(top, reference) > 0 && Math.abs(top - reference) / Math.max(top, reference) > 0.3) limitations.push(`Em ${contextLabelOf(cell)}, a duração mediana das chamadas difere entre os grupos (${top} s × ${reference} s): a complexidade das chamadas pode não ser a mesma.`)
    }
  }

  const cellsReport = plan.cells.map((cell) => ({ ...cell, label: contextLabelOf(cell), callsPerOperator: { TOP: spreadOf(sample, cell.cellKey, "TOP"), REFERENCE: spreadOf(sample, cell.cellKey, "REFERENCE") } }))
  const baseReport = {
    version: BEST_PRACTICE_ANALYSIS_LOGIC_VERSION,
    indicator: deps.indicator,
    signal: signal && signalLabels ? { id: signal.id, name: signal.name, good: signalLabels.good, bad: signalLabels.bad } : null,
    population: { label: deps.corpus.populationLabel, origin: request.origin },
    period: { start: window.start, end: window.endInclusive, referencePeriods: [...request.referencePeriods].sort() },
    comparison,
    groups: { ...groupCounts, excluded: [...excludedCounts.entries()].map(([reason, count]) => ({ reason, count })) },
    cells: cellsReport,
    method: signalLabels ? [comparison.method, ...EVIDENCE_METHOD] : EVIDENCE_METHOD,
  }
  const provenance = { logicVersion: BEST_PRACTICE_ANALYSIS_LOGIC_VERSION, discoveryPromptVersion: BEST_PRACTICE_DISCOVERY_PROMPT_VERSION, codingPromptVersion: BEST_PRACTICE_CODING_PROMPT_VERSION, obligationPromptVersion: BEST_PRACTICE_OBLIGATION_PROMPT_VERSION, evidenceVersion: BEST_PRACTICE_EVIDENCE_VERSION, modelMode: request.modelMode, seed }

  if (eligible.length === 0 || sample.length === 0) {
    const reason = baseReport.groups.top === 0
      ? signalLabels ? `nenhuma chamada com resultado bom (${signalLabels.good}) no período` : "nenhum operador com o 1º quartil oficial do indicador nas competências pedidas"
      : baseReport.groups.reference === 0
        ? signalLabels ? `nenhuma chamada com resultado ruim (${signalLabels.bad}) no período` : "nenhum operador no grupo de referência"
        : "nenhum contexto com operadores e chamadas transcritas suficientes nos dois grupos"
    limitations.push(`Dados insuficientes: ${reason}. Nenhuma descoberta foi gerada.`)
    const report: AnalysisReport = { ...baseReport, outcome: "INSUFFICIENT_DATA", summary: `Dados insuficientes para comparar: ${reason}.`, discovery: { calls: 0, proposed: 0, rejected: [], recognizedKnown: [], noCandidateReason: null, failed: false }, candidates: [], codings: { total: 0, reused: 0, unclear: 0, unverifiedQuotes: 0, fromCustomer: 0, modelFailures: 0 }, limitations, usage: budget.summary(), created: [], updated: [] }
    return { report, provenance: { ...provenance, usage: budget.summary() }, completedInStore: false }
  }

  // 2) Descoberta.
  const known = await deps.store.knownPatterns(scope)
  const testable = known.filter((pattern) => pattern.reviewStatus === "PENDING_REVIEW" || pattern.reviewStatus === "APPROVED")
  const knownForPrompt: KnownPatternForPrompt[] = known.map((pattern, index) => ({ handle: `X${index + 1}`, patternId: pattern.id, name: pattern.name, observableDefinition: pattern.observableDefinition }))
  const hypotheses: HypothesisForPrompt[] = (request.parameters.hypotheses.length > 0 ? request.parameters.hypotheses : [...DEFAULT_HYPOTHESES]).map((text, index) => ({ handle: `H${index + 1}`, text }))
  const discoveryCalls: ModelCall[] = plan.discovery.filter((call) => transcripts.has(call.ref)).map((call, index) => ({ handle: `C${index + 1}`, callRef: call.ref, group: call.group, context: contextLabelOf({ reason: call.reason, subReason: request.contextLevel === "REASON" ? null : call.subReason }), transcript: transcripts.get(call.ref)!.content }))
  const discoveryInput = { calls: discoveryCalls, known: knownForPrompt, hypotheses }
  const discoveryRequest = { stage: "DISCOVERY" as const, systemPrompt: DISCOVERY_SYSTEM_PROMPT, userText: renderDiscoveryTurn({ indicator: signal && signalLabels ? { name: signal.name, directionText: `sinal da chamada — GRUPO A = chamadas com ${signalLabels.good}; GRUPO B = chamadas com ${signalLabels.bad}` } : { name: deps.indicator!.name, directionText: DIRECTION_TEXT[deps.indicator!.direction] }, contexts: eligible.map((cell) => contextLabelOf(cell)), ...discoveryInput }), responseSchema: discoverySchemaFor(knownForPrompt.length, hypotheses.length), tag: BEST_PRACTICE_DISCOVERY_PROMPT_VERSION }
  let discovery = null as ReturnType<typeof parseDiscovery> | null
  for (let attempt = 0; attempt < 2 && (!discovery || !discovery.ok); attempt += 1) {
    const response = await budget.call(discoveryRequest)
    if (!response) break
    discovery = parseDiscovery(response.text, discoveryInput)
  }
  const discoveryOk = discovery?.ok ? discovery.result : null
  if (!discoveryOk) limitations.push("A descoberta de comportamentos novos não foi concluída nesta análise; só os padrões já existentes foram medidos de novo.")
  const blockedIds = new Set(known.filter((pattern) => pattern.reviewStatus === "REJECTED" || pattern.reviewStatus === "INACTIVE").map((pattern) => pattern.id))
  const recognizedKnown = (discoveryOk?.candidates ?? []).filter((candidate) => candidate.patternId).map((candidate) => `${candidate.name} → ${known.find((pattern) => pattern.id === candidate.patternId)?.name ?? "padrão existente"}${candidate.patternId && blockedIds.has(candidate.patternId) ? " (rejeitado/desativado — não medido)" : ""}`)
  // A fala sugerida vale para o assunto das chamadas de exemplo (C-n da descoberta → contexto da amostra).
  const discoveryCellByHandle = new Map(discoveryCalls.map((call) => [call.handle, plan.discovery.find((sampled) => sampled.ref === call.callRef)?.cellKey ?? null]))
  const phrasingContextsOf = (exampleRefs: readonly string[]) => [...new Set(exampleRefs.flatMap((ref) => { const cell = discoveryCellByHandle.get(ref.split(":")[0] ?? ""); return cell ? [cell] : [] }))]
  const candidates: BehaviorCandidate[] = [...testable.map(candidateFromKnown), ...(discoveryOk?.candidates ?? []).filter((candidate) => !candidate.patternId).map((candidate) => ({ ...candidate, phrasingContexts: phrasingContextsOf(candidate.exampleRefs) }))].map((candidate, index) => ({ ...candidate, key: `B${index + 1}` }))

  // 3) Codificação cega (reaproveitando o que já foi pago com a mesma definição e o mesmo texto).
  const codingByKey = new Map<string, CodingRecord>()
  const recordOf = (candidate: BehaviorCandidate, call: SampledCall, values: Pick<CodingRecord, "status" | "turnRef" | "quote" | "quoteVerified" | "unclearReason" | "reusedFromAnalysisId">): CodingRecord => {
    const corpusCall = callByRef.get(call.ref)
    return { candidateKey: candidate.key, definitionHash: candidate.definitionHash, callRef: call.ref, interactionId: corpusCall?.interactionId ?? null, personId: corpusCall?.personId ?? null, operatorRef: call.operatorRef, group: call.group, cellKey: call.cellKey, transcriptChecksum: transcripts.get(call.ref)?.checksum ?? null, ...values }
  }
  const reusable = candidates.length > 0 ? await deps.store.reusableCodings(request.organizationId, request.id, request.modelMode, sample.flatMap((call) => candidates.map((candidate) => ({ callRef: call.ref, definitionHash: candidate.definitionHash, transcriptChecksum: transcripts.get(call.ref)!.checksum })))) : new Map()
  let reused = 0
  const pending = new Map<string, BehaviorCandidate[]>()
  for (const call of sample) {
    for (const candidate of candidates) {
      const previous = reusable.get(reuseKeyOf({ callRef: call.ref, definitionHash: candidate.definitionHash, transcriptChecksum: transcripts.get(call.ref)!.checksum }))
      if (previous) {
        reused += 1
        codingByKey.set(`${candidate.key}|${call.ref}`, recordOf(candidate, call, { status: previous.status, turnRef: previous.turnRef, quote: previous.quote, quoteVerified: previous.quoteVerified, unclearReason: previous.unclearReason, reusedFromAnalysisId: previous.analysisId }))
      } else pending.set(call.ref, [...(pending.get(call.ref) ?? []), candidate])
    }
  }
  const pendingCalls = sample.filter((call) => pending.has(call.ref))
  for (let start = 0; start < pendingCalls.length; start += CODING_BATCH_SIZE) {
    const batch = pendingCalls.slice(start, start + CODING_BATCH_SIZE)
    const behaviorsInBatch = candidates.filter((candidate) => batch.some((call) => pending.get(call.ref)!.includes(candidate)))
    for (let chunkStart = 0; chunkStart < behaviorsInBatch.length; chunkStart += BEHAVIOR_CHUNK) {
      const behaviors: CodingBehavior[] = behaviorsInBatch.slice(chunkStart, chunkStart + BEHAVIOR_CHUNK)
      const modelCalls: ModelCall[] = batch.map((call, index) => ({ handle: `C${index + 1}`, callRef: call.ref, group: call.group, context: contextLabelOf({ reason: call.reason, subReason: request.contextLevel === "REASON" ? null : call.subReason }), transcript: transcripts.get(call.ref)!.content }))
      const codingRequest = { stage: "CODING" as const, systemPrompt: CODING_SYSTEM_PROMPT, userText: renderCodingTurn(modelCalls, behaviors), responseSchema: codingSchemaFor(modelCalls, behaviors), tag: BEST_PRACTICE_CODING_PROMPT_VERSION }
      // Resposta fora do formato (JSON cortado/inválido): UMA nova tentativa; persistindo, o lote fica "sem decisão" (nunca inventado).
      let response = await budget.call(codingRequest)
      if (response && !isCodingResponseUsable(response.text)) response = (await budget.call({ ...codingRequest, tag: `${BEST_PRACTICE_CODING_PROMPT_VERSION}:retry` })) ?? response
      for (const coding of verifyCodings(response?.text ?? null, modelCalls, behaviors)) {
        const call = batch.find((item) => item.ref === coding.callRef)!
        const candidate = candidates.find((item) => item.key === coding.behaviorKey)!
        if (!pending.get(call.ref)!.includes(candidate)) continue
        codingByKey.set(`${candidate.key}|${call.ref}`, recordOf(candidate, call, { status: coding.status, turnRef: coding.turnRef, quote: coding.quote, quoteVerified: coding.verified, unclearReason: coding.unclearReason, reusedFromAnalysisId: null }))
      }
    }
  }
  const codings = [...codingByKey.values()]
  const modelFailures = codings.filter((coding) => coding.unclearReason === "MODEL_FAILURE").length
  if (modelFailures > 0) limitations.push(`${modelFailures} codificação(ões) ficaram sem resposta do modelo (falha ou limite de chamadas): contam como "não dá para decidir".`)

  // 4) Números por contexto.
  const contextsOf = (candidate: BehaviorCandidate): ContextResult[] =>
    eligible.map((cell) => {
      const coded: CodedCall[] = sample.filter((call) => call.cellKey === cell.cellKey).flatMap((call) => {
        const coding = codingByKey.get(`${candidate.key}|${call.ref}`)
        return coding ? [{ callRef: call.ref, operatorRef: call.operatorRef, group: call.group, status: coding.status }] : []
      })
      return { cellKey: cell.cellKey, reason: cell.reason, subReason: cell.subReason, level: request.contextLevel, label: contextLabelOf(cell), assessment: assessCandidateInContext(coded) }
    })
  const assessed = candidates.map((candidate) => ({ candidate, contexts: contextsOf(candidate) }))

  // 5) Obrigação — só para o que se sustentou em algum contexto.
  const supported = assessed.filter((entry) => entry.contexts.some((context) => context.assessment.outcome === "SUPPORTED"))
  const checks = new Map<string, ObligationCheck>()
  if (supported.length > 0) {
    const supportedCells = eligible.filter((cell) => supported.some((entry) => entry.contexts.some((context) => context.cellKey === cell.cellKey && context.assessment.outcome === "SUPPORTED")))
    const sources = await deps.corpus.obligationSources({ cells: supportedCells.map((cell) => ({ reason: cell.reason, subReason: cell.subReason })), candidatesText: supported.map((entry) => `${entry.candidate.name}. ${entry.candidate.observableDefinition}`).join("\n"), at: new Date(`${window.endInclusive}T23:59:59Z`) })
    for (let start = 0; start < supported.length; start += OBLIGATION_CHUNK) {
      const chunk = supported.slice(start, start + OBLIGATION_CHUNK)
      const obligationCandidates: ObligationCandidate[] = chunk.map((entry, index) => ({ key: `K${index + 1}`, name: entry.candidate.name, observableDefinition: entry.candidate.observableDefinition, examples: codings.filter((coding) => coding.candidateKey === entry.candidate.key && coding.group === "TOP" && coding.status === "PRESENT" && coding.quote).slice(0, 3).map((coding) => coding.quote!) }))
      const response = sources.sources.length > 0 ? await budget.call({ stage: "OBLIGATION_CHECK", systemPrompt: OBLIGATION_SYSTEM_PROMPT, userText: renderObligationTurn(sources, obligationCandidates), responseSchema: obligationSchemaFor(obligationCandidates), tag: BEST_PRACTICE_OBLIGATION_PROMPT_VERSION }) : null
      const readings = parseObligationReadings(response?.text ?? null)
      chunk.forEach((entry, index) => checks.set(entry.candidate.key, decideObligation(readings.get(`K${index + 1}`) ?? null, sources)))
    }
  }

  // 6) Decisão por candidato e escrita.
  const allContexts = new Set(eligible.map((cell) => cell.cellKey))
  const knownById = new Map(known.map((pattern) => [pattern.id, pattern]))
  const writes: PatternWrite[] = []
  const candidateReports: CandidateReport[] = []
  for (const { candidate, contexts } of assessed) {
    const supportedContexts = contexts.filter((context) => context.assessment.outcome === "SUPPORTED")
    const strength = supportedContexts.length > 0 ? strongestOf(supportedContexts.map((context) => context.assessment.strength)) : strongestOf(contexts.map((context) => context.assessment.strength))
    const check = checks.get(candidate.key) ?? null
    const unsupportedLabels = contexts.filter((context) => context.assessment.outcome !== "SUPPORTED").map((context) => `${context.label} (${context.assessment.explanation})`)
    const versionLimitations = [...limitations, ...(supportedContexts.length > 0 && unsupportedLabels.length > 0 ? [`Sem associação sustentada — não use como orientação em: ${unsupportedLabels.join("; ")}`] : [])]
    const operatorsAnalyzed = new Set(sample.map((call) => call.operatorRef)).size
    const evidence = selectEvidence({ codings: codings.filter((coding) => coding.candidateKey === candidate.key), cellKeys: new Set(supportedContexts.map((context) => context.cellKey)), calls: callByRef, operators: operatorByRef as ReadonlyMap<string, CorpusOperator> })
    const report = (decision: CandidateDecision, decisionNote: string): CandidateReport => ({ key: candidate.key, name: candidate.name, origin: candidate.origin, patternId: candidate.patternId, definitionHash: candidate.definitionHash, observableDefinition: candidate.observableDefinition, hypothesisRef: candidate.hypothesisRef, contexts, strength, obligation: check, decision, decisionNote })
    const write = (obligationStatus: StoredObligationStatus, resetObligationConfirmation: boolean, updateNote: string): PatternWrite => ({ patternId: candidate.patternId, candidate, contexts, strength, obligation: check, obligationStatus, resetObligationConfirmation, evidence, limitations: versionLimitations, callsAnalyzed: sample.length, operatorsAnalyzed, updateNote })
    const existing = candidate.patternId ? knownById.get(candidate.patternId) ?? null : null

    if (supportedContexts.length === 0) {
      if (existing) {
        writes.push(write(existing.obligationStatus, false, `Análise sem associação sustentada em nenhum contexto (${allContexts.size} analisado(s)): o padrão deixa de orientar até uma nova análise sustentá-lo.`))
        candidateReports.push(report("PATTERN_WEAKENED", "Padrão existente sem associação sustentada nesta análise: fica indisponível para recomendações."))
      } else candidateReports.push(report("NOT_SUPPORTED", contexts.map((context) => `${context.label}: ${context.assessment.explanation}`).join(" ")))
      continue
    }
    const status = check?.status ?? "UNDETERMINED"
    if (status === "OBLIGATION" || status === "CONFLICT") {
      if (existing) {
        writes.push(write("UNDETERMINED", true, `A verificação desta análise indicou ${status === "OBLIGATION" ? "obrigação do processo" : "conflito com o processo"}: o padrão volta para validação humana e sai das recomendações.`))
        candidateReports.push(report("PATTERN_WEAKENED", check?.explanation ?? ""))
      } else candidateReports.push(report(status === "OBLIGATION" ? "DISCARDED_OBLIGATION" : "DISCARDED_CONFLICT", check?.explanation ?? ""))
      continue
    }
    writes.push(write(status, false, existing ? "Nova versão: números e evidências recalculados nesta análise." : "Padrão criado por esta análise (pendente de revisão)."))
    candidateReports.push(report(existing ? "PATTERN_UPDATED" : "PATTERN_CREATED", status === "UNDETERMINED" ? `${check?.explanation ?? ""} Fica pendente e fora das recomendações até a validação.` : check?.explanation ?? ""))
  }

  const discarded = candidateReports.filter((entry) => entry.decision === "DISCARDED_OBLIGATION" || entry.decision === "DISCARDED_CONFLICT").length
  const found = candidateReports.filter((entry) => entry.decision === "PATTERN_CREATED" || entry.decision === "PATTERN_UPDATED").length
  const buildReport = (saved: { created: string[]; updated: string[] }): AnalysisReport => {
    const usage = budget.summary()
    const partial = !discoveryOk || usage.budgetExhausted || modelFailures > codings.length * 0.1
    const outcome: AnalysisOutcome = partial ? "PARTIAL" : found > 0 ? "PATTERNS_FOUND" : "NO_PATTERN"
    const summary = `${found} padrão(ões) com associação sustentada (${saved.created.length} novo(s), ${saved.updated.length} atualizado(s)); ${discarded} descartado(s) por ser obrigação ou contrariar o processo; ${candidateReports.filter((entry) => entry.decision === "NOT_SUPPORTED").length} sem sustentação. ${sample.length} chamadas de ${new Set(sample.map((call) => call.operatorRef)).size} operadores em ${eligible.length} contexto(s), ${dateLabel(window.start)} a ${dateLabel(window.endInclusive)}.`
    return {
      ...baseReport,
      outcome,
      summary,
      discovery: { calls: discoveryCalls.length, proposed: discoveryOk?.candidates.length ?? 0, rejected: discoveryOk?.rejected ?? [], recognizedKnown, noCandidateReason: discoveryOk?.noCandidateReason ?? null, failed: !discoveryOk },
      candidates: candidateReports,
      codings: { total: codings.length, reused, unclear: codings.filter((coding) => coding.status === "UNCLEAR").length, unverifiedQuotes: codings.filter((coding) => coding.unclearReason === "QUOTE_NOT_VERIFIED").length, fromCustomer: codings.filter((coding) => coding.unclearReason === "QUOTE_NOT_FROM_OPERATOR").length, modelFailures },
      limitations,
      usage,
      created: saved.created,
      updated: saved.updated,
    }
  }
  const saved = await deps.store.saveAnalysis(scope, request.id, { codings, patterns: writes, period: { start: window.start, end: window.endInclusive }, referencePeriods: [...request.referencePeriods].sort() }, deps.now(), (ids) => {
    const built = buildReport(ids)
    return { outcome: built.outcome, report: built, provenance: { ...provenance, usage: built.usage } }
  })
  const report = saved.completion.report as AnalysisReport
  return { report, provenance: saved.completion.provenance, completedInStore: true }
}
