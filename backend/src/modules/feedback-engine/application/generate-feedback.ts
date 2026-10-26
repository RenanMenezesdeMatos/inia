import { DomainError } from "../../../shared/domain/domain-error.js"
import { CALL_ALREADY_MONITORED, PERIOD_ALREADY_DELIVERED } from "../domain/delivery-guards.js"
import { startOfLocalDate } from "../../workflows/application/time-window.js"
import { NEUTRAL_INTERACTION_TITLE, readableSubjectOf } from "../../feedbacks/domain/feedback-heading.js"
import { argumentRequirementOf, buildMonitoringBrief, type FeedbackBrief, type SourceLineMeta } from "../domain/feedback-brief.js"
import { buildProcedureContext, listContextOf, type ListContext } from "../domain/procedure.js"
import { buildIndicatorBrief, examplePhrasingKeyOf, informativeHasContent, practiceSubjectKeysOf, type ExamplePhrasings } from "../domain/indicator-brief.js"
import { onePerInteraction, practiceKeyOf, withCurrentPracticeTitles, type IndicatorInvestigation } from "../domain/indicator-investigation.js"
import { callAnalysisRefOf, ENGINE_MESSAGE_NODE_OUTPUT_KIND, isIndicatorAnalysisNodeOutput, sourceAgentIdOf, type EngineMessageNodeOutput } from "../domain/node-output.js"
import { analyzeCall, metricsSummaryOf, type AnalyzeCallDeps } from "./analyze-call.js"
import { isLegacyPendingOutcome } from "../domain/analysis-recovery.js"
import { composeFeedback } from "./compose-feedback.js"
import { investigateIndicator, type InvestigateIndicatorDeps, type InvestigationTarget } from "./investigate-indicator.js"
import { withCitedInText, type FeedbackBestPractices } from "../../best-practices/domain/feedback-section.js"
import { basePracticesOf, citedPracticeIdsOf, establishedProductsOfBrief } from "../domain/base-practices.js"
import type { FeedbackPracticeInput } from "../../best-practices/application/feedback-section.js"
import type { FeedbackMemoryStore, FeedbackMessageStore, MaterialRecommendation, MessageRecord, ModelCallMetric, EngineModelPort, StoredCallAssessment } from "./ports.js"

/**
 * CASO DE USO do nó "Gerar feedback" (motor de feedback).
 *
 *   análise (a da origem, quando compatível; senão feita agora pelo mesmo motor) → memória já gravada → brief (materialidade,
 *   histórico comparável, supressão do que já foi entregue) → composição verificada → mensagem PUBLICÁVEL ou ABSTENÇÃO com motivo.
 *
 * Nunca espera decisão humana. Identidade da ENTREGA (matrícula × nó × origem) separada da identidade da ANÁLISE: retry,
 * concorrência ou reprocessamento devolvem a mesma mensagem, e a mesma análise nunca é recontada. Falha técnica (provedor)
 * lança erro classificado — o motor do Workflow aplica a política de nova tentativa; a análise já gravada continua lá.
 */
export const MESSAGE_LEASE_SECONDS = 600
export const HISTORY_WINDOW_DAYS = 90

export type GenerateFeedbackRequest = {
  organizationId: string
  enrollmentId: string | null
  workflowId: string | null
  workflowVersionId: string | null
  nodeId: string
  sourceNodeId: string
  domain: "MONITORING" | "INDICATOR"
  sourceNodeOutput: unknown
  collaboratorId: string
  interactionId: string | null
  indicatorMeasurementId: string | null
  configuredAgentId: string | null
  /** Como a chamada chegou até aqui (sinal do gatilho, execução manual…) — vira o motivo de seleção na memória. */
  selectionReason: string
  /** Nome do sinal que disparou o Workflow (ex.: nota_ura): as boas práticas do feedback de monitoria vêm das melhores chamadas dele. */
  triggerFlagName?: string | null
  now: Date
}

export type GenerateFeedbackResult =
  | { kind: "PUBLISHABLE"; messageId: string; reused: boolean; nodeOutput: EngineMessageNodeOutput }
  | { kind: "ABSTAINED"; messageId: string; reused: boolean; reason: string; analysisRunIds: string[] }

export type GenerateFeedbackDeps = {
  memory: FeedbackMemoryStore
  messages: FeedbackMessageStore
  model: EngineModelPort
  analyze: AnalyzeCallDeps
  investigate: InvestigateIndicatorDeps
  loadDocumentTitles: (organizationId: string, documentIds: readonly string[]) => Promise<Map<string, string>>
  loadAgentConfiguredAt: (organizationId: string, agentId: string) => Promise<string | null>
  now: () => Date
  /** Medidor do orçamento da execução (o mesmo do modelo) — o resumo vai para as métricas da mensagem. */
  meter?: { summary(): unknown }
  /** Base de boas práticas: seção de oportunidades opcionais, montada pelo sistema DEPOIS da redação (nunca vai ao redator). */
  bestPractices?: (input: FeedbackPracticeInput) => Promise<FeedbackBestPractices | null>
}

export class FeedbackGenerationInProgressError extends DomainError {
  constructor() {
    super("A geração deste feedback está em andamento em outra execução — será retomada.", "FEEDBACK_ENGINE_IN_PROGRESS", 409, { category: "PROVIDER_ERROR" })
    this.name = "FeedbackGenerationInProgressError"
  }
}

export const messageKeyOf = (request: Pick<GenerateFeedbackRequest, "enrollmentId" | "nodeId" | "sourceNodeId">) => `WORKFLOW_NODE:${request.enrollmentId ?? "SIMULATION"}:${request.nodeId}:${request.sourceNodeId}`

export function nodeOutputOfMessage(record: MessageRecord, reused: boolean): EngineMessageNodeOutput {
  const message = record.message!
  const brief = record.brief!
  return {
    kind: ENGINE_MESSAGE_NODE_OUTPUT_KIND,
    messageId: record.id,
    domain: record.domain,
    disposition: "READY",
    label: brief.label,
    card: message.card,
    text: message.text,
    analysisRunIds: record.analysisRunIds,
    findings: { developments: brief.developments.filter((finding) => (message.communicatedRefs ?? [finding.ref]).includes(finding.ref)).length, strengths: brief.strengths.filter((finding) => (message.communicatedRefs ?? [finding.ref]).includes(finding.ref)).length, suppressed: brief.suppressed.length },
    limitations: brief.limitations,
    reused,
  }
}

const resultOf = (record: MessageRecord, reused: boolean): GenerateFeedbackResult =>
  record.status === "PUBLISHABLE" ? { kind: "PUBLISHABLE", messageId: record.id, reused, nodeOutput: nodeOutputOfMessage(record, reused) } : { kind: "ABSTAINED", messageId: record.id, reused, reason: record.abstainReason ?? "ABSTAINED", analysisRunIds: record.analysisRunIds }

/** Nomes do catálogo de assuntos (código → nome). Falha de leitura = sem nome (o título cai no bruto legível ou no neutro). */
async function subjectNamesOf(deps: GenerateFeedbackDeps, organizationId: string): Promise<Map<string, string>> {
  try {
    return (await deps.investigate.data.subjectNames?.(organizationId)) ?? new Map()
  } catch {
    return new Map()
  }
}

const dateLabelOf = (at: Date, timeZone: string) => new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(at)

async function monitoringBrief(deps: GenerateFeedbackDeps, request: GenerateFeedbackRequest): Promise<{ brief: FeedbackBrief | null; runIds: string[]; abstain: string | null; assessment: StoredCallAssessment | null }> {
  if (!request.interactionId) return { brief: null, runIds: [], abstain: "NO_INTERACTION", assessment: null }
  // `ONE_MONITORING_PER_CALL_V1`: chamada já monitorada (qualquer Workflow, qualquer caminho) não recebe outra monitoria — nada é
  // analisado nem composto; a origem desta execução (outro sinal, outro Workflow) não muda isso.
  const monitored = await deps.memory.deliveredMonitoringOf(request.organizationId, request.interactionId)
  if (monitored) return { brief: null, runIds: [], abstain: CALL_ALREADY_MONITORED, assessment: null }
  const ref = callAnalysisRefOf(request.sourceNodeOutput)
  let runId: string
  let assessment: StoredCallAssessment | null
  const analyzeNow = () => analyzeCall(deps.analyze, { organizationId: request.organizationId, interactionId: request.interactionId!, collaboratorId: request.collaboratorId, agentId: sourceAgentIdOf(request.sourceNodeOutput, request.configuredAgentId), trigger: { kind: "FEEDBACK_GENERATION", workflowId: request.workflowId, workflowVersionId: request.workflowVersionId, enrollmentId: request.enrollmentId, nodeId: request.nodeId, selectionReason: request.selectionReason } })
  if (ref && ref.interactionId === request.interactionId && ref.personId === request.collaboratorId) {
    runId = ref.analysisRunId
    assessment = await deps.memory.getCallAssessmentByRun(request.organizationId, runId)
  } else {
    // Origem sem análise do motor (contrato anterior, execução antiga): a análise é feita agora, com o especialista da origem.
    const analyzed = await analyzeNow()
    runId = analyzed.runId
    assessment = analyzed.assessment
  }
  // Leitura gravada antes da correção da recuperação SEM revisão (`REVIEW_UNAVAILABLE`): é pendência técnica, não conclusão —
  // retoma só a revisão (as propostas já pagas são reaproveitadas); se a revisão falhar de novo, a falha é técnica (nova tentativa).
  if (assessment && isLegacyPendingOutcome(assessment.analysis.outcomeReasons)) {
    const resumed = await analyzeNow()
    runId = resumed.runId
    assessment = resumed.assessment
  }
  if (!assessment) return { brief: null, runIds: [runId], abstain: "ANALYSIS_NOT_FOUND", assessment: null }
  const analysis = assessment.analysis
  if (analysis.outcome === "INSUFFICIENT_EVIDENCE") return { brief: null, runIds: [runId], abstain: `INSUFFICIENT_EVIDENCE:${analysis.outcomeReasons.join(",")}`, assessment }
  const keys = Object.values(assessment.criterionKeys)
  const occurredAt = assessment.snapshot.occurredAt
  const practice = await practiceContextOf(deps, request.organizationId, request.collaboratorId, request.interactionId, keys, occurredAt, assessment.snapshot.timeZone)
  const candidateFindings = [...keys.map((key) => `CALL:${request.interactionId}:${key}`), `CALL:${request.interactionId}:PATH:${analysis.scenario.procedureDocumentId ?? "none"}`]
  const delivered = new Set((await deps.memory.deliveredFindings(request.organizationId, request.collaboratorId, candidateFindings)).map((entry) => entry.findingKey))
  const documentIds = [...new Set(analysis.criteria.map((criterion) => criterion.documentId))]
  const titles = await deps.loadDocumentTitles(request.organizationId, documentIds)
  const versions = new Map<string, number>()
  if (analysis.scenario.procedureDocumentId && analysis.scenario.procedureVersion !== null) versions.set(analysis.scenario.procedureDocumentId, analysis.scenario.procedureVersion)
  // Título = assunto sustentado pelos dados DESTA interação (`FEEDBACK_HEADING_V1`): o canônico gravado na análise (pelo código,
  // com o nome do catálogo) ou o bruto legível; sem assunto confiável, título neutro — a data vai à parte, nunca como título.
  const subjectNames = await subjectNamesOf(deps, request.organizationId)
  const subject = readableSubjectOf({ canonicalName: assessment.snapshot.subjectCanonical ? subjectNames.get(assessment.snapshot.subjectCanonical) ?? null : null, raw: assessment.snapshot.subjectRaw, nameOfCode: (code) => subjectNames.get(code) ?? null })
  const { listContext, sourceLines } = await procedureForRun(deps, request.organizationId, runId, assessment.snapshot, occurredAt)
  const argumentPhrasings = await argumentPhrasingsForRun(deps, request.organizationId, runId, assessment.snapshot, occurredAt)
  const lineTitles = await practiceLineTitlesOf(deps, request.organizationId, analysis.criteria.flatMap((criterion) => [criterion.lineKey, ...(criterion.sources ?? []).map((source) => source.lineKey)]))
  const brief = buildMonitoringBrief({
    analysis,
    interactionId: request.interactionId,
    label: subject?.text ?? NEUTRAL_INTERACTION_TITLE,
    subjectSource: subject?.source ?? "NONE",
    dateLabel: dateLabelOf(occurredAt, assessment.snapshot.timeZone),
    selectionReason: assessment.snapshot.selectionReason,
    criterionKeys: new Map(Object.entries(assessment.criterionKeys)),
    documentTitles: titles,
    documentVersions: versions,
    history: practice.history,
    practices: practice.practices,
    delivered,
    ...(listContext ? { listContext } : {}),
    ...(argumentPhrasings ? { argumentPhrasings } : {}),
    ...(sourceLines ? { sourceLines } : {}),
    ...(lineTitles.size > 0 ? { lineTitles } : {}),
  })
  return { brief, runIds: [runId], abstain: null, assessment }
}

/**
 * Reincidência e orientação anterior POR PRÁTICA (`PRACTICE_ANCHOR_V1` + `FEEDBACK_FIRMNESS_V1`). A identidade da obrigação muda
 * entre análises (a mesma etapa vira chaves diferentes conforme o recorte da regra), então o histórico por chave de obrigação
 * fragmentava a contagem ("1 de 1" em vez de "3 de 4"). Aqui a prática é a linha-âncora da base: o histórico conta as OUTRAS
 * chamadas da pessoa nos últimos 90 dias (uma leitura por chamada, a mais grave; só conclusões confirmadas) e a orientação anterior
 * é a última mensagem ENTREGUE que comunicou um ponto de desenvolvimento desta prática antes da chamada.
 */
async function practiceContextOf(deps: GenerateFeedbackDeps, organizationId: string, personId: string, interactionId: string, keys: readonly string[], occurredAt: Date, timeZone: string) {
  const own = (await deps.memory.currentMemory(organizationId, { personIds: [personId], interactionIds: [interactionId] })).criteria
  const practiceOf = new Map(keys.map((key) => [key, own.find((row) => row.criterionKey === key)?.practiceKey ?? key]))
  const past = (await deps.memory.currentMemory(organizationId, { personIds: [personId], window: { start: new Date(occurredAt.getTime() - HISTORY_WINDOW_DAYS * 86_400_000), end: occurredAt } })).criteria
    .filter((row) => row.interactionId !== interactionId)
  const history = new Map<string, { assessed: number; notMet: number; met: number }>()
  for (const [key, practiceKey] of practiceOf.entries()) {
    const rows = onePerInteraction(past.filter((row) => practiceKeyOf(row) === practiceKey))
    const count = (statuses: readonly string[]) => rows.filter((row) => statuses.includes(row.status)).length
    const assessed = count(["MET", "NOT_MET", "PARTIAL"])
    if (assessed > 0) history.set(key, { assessed, notMet: count(["NOT_MET", "PARTIAL"]), met: count(["MET"]) })
  }
  const oriented = new Map((await deps.memory.deliveredPractices(organizationId, personId, [...new Set(practiceOf.values())], occurredAt)).map((entry) => [entry.practiceKey, entry.deliveredAt]))
  const practices = new Map([...practiceOf.entries()].map(([key, practiceKey]) => {
    const at = oriented.get(practiceKey)
    return [key, { practiceKey, priorOrientation: at ? { dateLabel: dateLabelOf(at, timeZone) } : null }] as const
  }))
  return { history, practices }
}

/**
 * Contexto de lista (abertura + itens irmãos) e a ORIGEM de cada linha (`RULE_SOURCES_V1`: documento × argumentário, seção, campo
 * "evitar") da MESMA versão do procedimento e dos argumentários que a análise usou — lidos de novo (a análise guarda só o texto das
 * linhas). Versão diferente da registrada na proveniência = fora (nunca mistura versões); linha sem origem conhecida = a regra continua
 * sendo o texto inteiro da obrigação.
 */
async function procedureForRun(deps: GenerateFeedbackDeps, organizationId: string, runId: string, person: { teamId: string | null; subteamId: string | null }, occurredAt: Date): Promise<{ listContext?: Map<string, ListContext>; sourceLines?: Map<string, SourceLineMeta> }> {
  try {
    const run = await deps.memory.getRun(organizationId, runId)
    if (!run) return {}
    const provenance = run.provenance as { documents?: { documentId: string; version: number }[]; argumentScripts?: { versionId: string | null }[] }
    const usedDocuments = new Set((provenance.documents ?? []).map((document) => `${document.documentId}@${document.version}`))
    const documents = run.agentId ? (await deps.analyze.loadDocuments(organizationId, run.agentId, occurredAt)).filter((document) => usedDocuments.has(`${document.documentId}@${document.version}`)).map((document) => ({ ...document, selection: "INCLUDED_ALL" as const, relevance: 0 })) : []
    const usedScripts = new Set((provenance.argumentScripts ?? []).flatMap((script) => (script.versionId ? [script.versionId] : [])))
    const scripts = usedScripts.size > 0 && deps.analyze.loadArgumentScripts ? (await deps.analyze.loadArgumentScripts(organizationId, person, occurredAt)).filter((script) => usedScripts.has(script.versionId)) : []
    const listContext = documents.length > 0 ? listContextOf(buildProcedureContext(documents)) : undefined
    if (documents.length === 0 && scripts.length === 0) return {}
    // Todos os argumentários que a análise usou (o orçamento do prompt não se aplica aqui: é só a origem das linhas).
    const full = buildProcedureContext(documents, scripts, { scriptBudgetChars: Number.POSITIVE_INFINITY })
    const documentOf = new Map(full.documents.map((document) => [document.handle, document]))
    const sourceLines = new Map<string, SourceLineMeta>()
    for (const line of full.lines.values()) {
      const document = documentOf.get(line.documentHandle)
      if (!document || sourceLines.has(line.lineKey)) continue
      sourceLines.set(line.lineKey, { documentId: line.documentId, documentTitle: document.title, heading: line.heading, source: document.kind === "ARGUMENT_SCRIPT" ? "ARGUMENT_SCRIPT" : "KNOWLEDGE_DOCUMENT", avoid: line.argument?.field === "AVOID", leadIn: line.leadIn, condition: line.argument?.condition ?? null, requirement: argumentRequirementOf(line.argument) })
    }
    return { ...(listContext ? { listContext } : {}), ...(sourceLines.size > 0 ? { sourceLines } : {}) }
  } catch {
    return {}
  }
}

/** `PRACTICE_TITLE_V1`, por linha: o nome curto da prática da linha (o dado na organização em temas), senão o nome da prática. */
async function practiceLineTitlesOf(deps: GenerateFeedbackDeps, organizationId: string, lineKeys: readonly string[]): Promise<Map<string, string>> {
  try {
    const memberships = await deps.memory.practiceMemberships(organizationId, [...new Set(lineKeys)])
    if (memberships.size === 0) return new Map()
    const shortTitles = new Map((await deps.memory.practiceCatalog(organizationId)).map((practice) => [practice.practiceKey, practice.shortTitle?.trim() || practice.title]))
    return new Map([...memberships.entries()].flatMap(([lineKey, membership]) => {
      const title = membership.practiceKey ? shortTitles.get(membership.practiceKey) ?? membership.title : null
      return title ? [[lineKey, title] as const] : []
    }))
  } catch {
    return new Map()
  }
}

/**
 * `ARGUMENT_PHRASING_V1`: a fraseologia sugerida dos argumentários que a análise usou — da MESMA versão registrada na proveniência
 * (versão diferente = sem fraseologia, nunca mistura versões). A análise guarda só os itens avaliados; a fraseologia é relida aqui.
 */
async function argumentPhrasingsForRun(deps: GenerateFeedbackDeps, organizationId: string, runId: string, person: { teamId: string | null; subteamId: string | null }, occurredAt: Date): Promise<Map<string, { name: string; text: string }> | undefined> {
  try {
    if (!deps.analyze.loadArgumentScripts) return undefined
    const run = await deps.memory.getRun(organizationId, runId)
    const used = new Set(((run?.provenance as { argumentScripts?: { versionId: string | null }[] } | undefined)?.argumentScripts ?? []).flatMap((script) => (script.versionId ? [script.versionId] : [])))
    if (used.size === 0) return undefined
    const scripts = (await deps.analyze.loadArgumentScripts(organizationId, { teamId: person.teamId, subteamId: person.subteamId }, occurredAt)).filter((script) => used.has(script.versionId) && Boolean(script.content.suggestedScript?.trim()))
    return scripts.length > 0 ? new Map(scripts.map((script) => [script.scriptId, { name: script.name, text: script.content.suggestedScript!.trim() }])) : undefined
  } catch {
    return undefined
  }
}

/**
 * `PRODUCT_IN_FEEDBACK_V1` (substitui a fraseologia do fim do período): a fala sugerida do argumentário de CADA chamada de exemplo de um
 * padrão — a versão que a análise daquela chamada usou, em vigor na hora da chamada (versão diferente = sem fraseologia, nunca mistura
 * versões). Um padrão com chamadas de produtos diferentes nunca recebe a fala de um produto para todas.
 */
async function examplePhrasingsOf(deps: GenerateFeedbackDeps, organizationId: string, personId: string, investigations: readonly IndicatorInvestigation[]): Promise<ExamplePhrasings | undefined> {
  try {
    if (!deps.analyze.loadArgumentScripts) return undefined
    const examples = investigations.flatMap((investigation) => investigation.evidence.flatMap((entry) => entry.patterns.flatMap((pattern) => pattern.examples))).filter((example) => example.argument && example.occurredAt)
    if (examples.length === 0) return undefined
    const placement = await deps.investigate.data.placement(organizationId, personId)
    const scriptsAt = new Map<string, Awaited<ReturnType<NonNullable<typeof deps.analyze.loadArgumentScripts>>>>()
    const phrasings = new Map<string, { name: string; text: string }>()
    for (const example of examples) {
      const at = example.occurredAt!
      if (!scriptsAt.has(at)) scriptsAt.set(at, await deps.analyze.loadArgumentScripts(organizationId, { teamId: placement?.teamId ?? null, subteamId: placement?.subteamId ?? null }, new Date(at)))
      const script = scriptsAt.get(at)!.find((entry) => entry.scriptId === example.argument!.scriptId && (example.argument!.version === null || entry.version === example.argument!.version))
      const text = script?.content.suggestedScript?.trim()
      if (script && text) phrasings.set(examplePhrasingKeyOf(example.interactionId, script.scriptId), { name: script.name, text })
    }
    return phrasings.size > 0 ? phrasings : undefined
  } catch {
    return undefined
  }
}

/** Várias investigações (fechamento com mais de um indicador) numa mensagem só: cada ponto leva o indicador no contexto. */
function mergeIndicatorBriefs(briefs: readonly FeedbackBrief[]): FeedbackBrief {
  if (briefs.length === 1) return briefs[0]!
  const developments = briefs.flatMap((brief) => brief.developments.map((finding) => ({ ...finding, title: `${brief.indicatorName}: ${finding.title}` })))
  const strengths = briefs.flatMap((brief) => brief.strengths.map((finding) => ({ ...finding, title: finding.origin === "INDICATOR_RESULT" ? finding.title : `${brief.indicatorName}: ${finding.title}` })))
  developments.forEach((finding, index) => (finding.ref = `A${index + 1}`))
  strengths.forEach((finding, index) => (finding.ref = `S${index + 1}`))
  const first = briefs[0]!
  return {
    ...first,
    label: `Fechamento · ${briefs.map((brief) => brief.indicatorName).join(", ")}`,
    heading: { title: `Fechamento de ${first.heading.subtitle ?? ""}`.trim(), subtitle: briefs.map((brief) => brief.indicatorName).join(" · ") },
    context: briefs.flatMap((brief) => brief.context.map((line) => `${brief.indicatorName} — ${line}`)),
    developments,
    strengths,
    limitations: [...new Set(briefs.flatMap((brief) => brief.limitations))],
    materials: briefs.flatMap((brief) => brief.materials),
    officialLines: briefs.flatMap((brief) => brief.officialLines.map((line) => ({ label: `${brief.indicatorName} · ${line.label}`, value: line.value }))),
    officialTable: briefs.flatMap((brief) => brief.officialTable ?? []),
    tone: developments.length > 0 ? (strengths.length > 0 ? "MIXED" : "DEVELOPMENT") : strengths.length > 0 ? "RECOGNITION" : "INFORMATIVE",
    suppressed: briefs.flatMap((brief) => brief.suppressed),
  }
}

async function indicatorBrief(deps: GenerateFeedbackDeps, request: GenerateFeedbackRequest): Promise<{ brief: FeedbackBrief | null; runIds: string[]; abstain: string | null; investigations: IndicatorInvestigation[] }> {
  const source = request.sourceNodeOutput
  let refs: { runId: string }[] = []
  if (isIndicatorAnalysisNodeOutput(source) && source.personId === request.collaboratorId) {
    if (source.skippedReason) return { brief: null, runIds: [], abstain: source.skippedReason === PERIOD_ALREADY_DELIVERED ? PERIOD_ALREADY_DELIVERED : `NOTHING_TO_INVESTIGATE:${source.skippedReason}`, investigations: [] }
    refs = source.investigations.map((entry) => ({ runId: entry.analysisRunId }))
  } else {
    // Origem sem investigação do motor: investiga agora (medição do gatilho; fechamento oficial do diagnóstico direto/PRV).
    const agentId = sourceAgentIdOf(source, request.configuredAgentId)
    const legacyIndicator = source && typeof source === "object" ? (source as { indicatorCode?: unknown; kind?: unknown }) : null
    const target: InvestigationTarget | null = request.indicatorMeasurementId
      ? { kind: "MEASUREMENT", measurementId: request.indicatorMeasurementId }
      : typeof legacyIndicator?.indicatorCode === "string"
        ? { kind: "OFFICIAL_CLOSING", indicatorCode: legacyIndicator.indicatorCode }
        : { kind: "PRV_CLOSING" }
    const result = await investigateIndicator(deps.investigate, { organizationId: request.organizationId, personId: request.collaboratorId, agentId, agentConfiguredAt: agentId ? await deps.loadAgentConfiguredAt(request.organizationId, agentId) : null, enrollmentId: request.enrollmentId, target, trigger: { kind: "FEEDBACK_GENERATION", workflowId: request.workflowId, workflowVersionId: request.workflowVersionId, enrollmentId: request.enrollmentId, nodeId: request.nodeId, selectionReason: request.selectionReason }, now: request.now })
    if (result.skippedReason) return { brief: null, runIds: [], abstain: result.skippedReason === PERIOD_ALREADY_DELIVERED ? PERIOD_ALREADY_DELIVERED : `NOTHING_TO_INVESTIGATE:${result.skippedReason}`, investigations: [] }
    refs = result.investigations.map((entry) => ({ runId: entry.runId }))
  }
  const stored = (await Promise.all(refs.map((ref) => deps.memory.getIndicatorInvestigationByRun(request.organizationId, ref.runId)))).flatMap((entry) => (entry ? [entry.investigation] : []))
  // `CURRENT_PRACTICE_TITLE_V1`: o nome da prática que vai ao redator é o atual (a investigação guardada carrega o da época).
  const practiceTitles = stored.length > 0 ? new Map((await deps.memory.practiceCatalog(request.organizationId)).map((practice) => [practice.practiceKey, practice.title])) : new Map<string, string>()
  const investigations = stored.map((investigation) => withCurrentPracticeTitles(investigation, practiceTitles))
  if (investigations.length === 0) return { brief: null, runIds: refs.map((ref) => ref.runId), abstain: "INVESTIGATION_NOT_FOUND", investigations }
  const findingKeys = investigations.flatMap((investigation) => [...investigation.evidence.flatMap((entry) => entry.patterns.map((pattern) => `IND:${investigation.official.code}:${investigation.official.periodStart}:${investigation.official.periodEnd}:${pattern.criterionKey}`)), `IND:${investigation.official.code}:${investigation.official.periodStart}:${investigation.official.periodEnd}:RESULT`])
  const delivered = new Set((await deps.memory.deliveredFindings(request.organizationId, request.collaboratorId, findingKeys)).map((entry) => entry.findingKey))
  // `FEEDBACK_FIRMNESS_V1`: prática já orientada num retorno entregue ANTES do período investigado (data de entrega por prática).
  const priorOrientations = new Map<string, string>()
  const timeZone = await deps.investigate.data.timeZone(request.organizationId)
  for (const investigation of investigations) {
    const practiceKeys = investigation.evidence.flatMap((entry) => entry.patterns.map((pattern) => pattern.criterionKey))
    const before = startOfLocalDate(investigation.official.periodStart, timeZone)
    for (const entry of await deps.memory.deliveredPractices(request.organizationId, request.collaboratorId, [...new Set(practiceKeys)], before)) priorOrientations.set(entry.practiceKey, dateLabelOf(entry.deliveredAt, timeZone))
  }
  // `ARGUMENT_PHRASING_V1` + `PRODUCT_IN_FEEDBACK_V1`: a fraseologia de cada chamada de exemplo, na versão que a análise dela usou.
  const examplePhrasings = await examplePhrasingsOf(deps, request.organizationId, request.collaboratorId, investigations)
  const briefs = investigations
    .map((investigation) => buildIndicatorBrief(investigation, { documentVersions: new Map(), delivered, factualWhenInconclusive: false, priorOrientations, ...(examplePhrasings ? { examplePhrasings } : {}) }))
    .filter((brief, index) => {
      const investigation = investigations[index]!
      if (brief.developments.length > 0 || brief.strengths.length > 0) return true
      // Sem padrão nem reconhecimento: comunicação LIMITADA só quando a investigação localizou algo e verificou as chamadas — e a
      // estratégia permite um retorno factual (NO_FEEDBACK e o antigo HOLD_FOR_QA = abstenção: o motor não tem fila de QA).
      const behavior = investigation.strategy.noDiagnosisBehavior ?? "FACTUAL_ONLY"
      return behavior === "FACTUAL_ONLY" && (investigation.conclusion === "CHANGE_LOCATED_NO_CAUSE" || investigation.conclusion === "MIX_EFFECT") && informativeHasContent(brief)
    })
  // Sem diagnóstico acionável porque o ORÇAMENTO interrompeu a investigação ≠ sem diagnóstico porque a evidência não sustenta.
  const interrupted = investigations.some((investigation) => investigation.completeness?.status === "INTERRUPTED_BY_BUDGET")
  if (briefs.length === 0) return { brief: null, runIds: refs.map((ref) => ref.runId), abstain: `${interrupted ? "INVESTIGATION_INTERRUPTED_BY_BUDGET" : "NO_ACTIONABLE_DIAGNOSIS"}:${investigations.map((investigation) => investigation.conclusion).join(",")}`, investigations }
  return { brief: mergeIndicatorBriefs(briefs), runIds: refs.map((ref) => ref.runId), abstain: null, investigations }
}

export async function generateFeedback(deps: GenerateFeedbackDeps, request: GenerateFeedbackRequest): Promise<GenerateFeedbackResult> {
  const now = deps.now()
  const claim = await deps.messages.claimMessage({ organizationId: request.organizationId, messageKey: messageKeyOf(request), enrollmentId: request.enrollmentId, workflowId: request.workflowId, workflowVersionId: request.workflowVersionId, nodeId: request.nodeId, sourceNodeId: request.sourceNodeId, personId: request.collaboratorId, domain: request.domain }, now, MESSAGE_LEASE_SECONDS)
  if (claim.kind === "COMPLETED") return resultOf(claim.record, true)
  if (claim.kind === "IN_PROGRESS") throw new FeedbackGenerationInProgressError()
  const messageId = claim.messageId
  const metrics: ModelCallMetric[] = []
  try {
    const prepared = request.domain === "MONITORING" ? await monitoringBrief(deps, request) : await indicatorBrief(deps, request)
    const base = { analysisRunIds: prepared.runIds, composition: null, message: null, materials: [] as MaterialRecommendation[] }
    if (!prepared.brief) {
      const record = await deps.messages.completeMessage(request.organizationId, messageId, { ...base, status: "ABSTAINED", abstainReason: prepared.abstain ?? "NO_BRIEF", findingKeys: [], brief: null, suppressed: [], metrics: { durationMs: deps.now().getTime() - now.getTime() } }, deps.now())
      return resultOf(record, false)
    }
    // Já houve retorno deste mesmo caso e não há AJUSTE novo: reconhecimentos que ficaram de fora da primeira mensagem não
    // justificam uma segunda (entrega duplicada do mesmo atendimento/período).
    const caseBrief = prepared.brief
    const alreadyAnswered = caseBrief.suppressed.length > 0 && caseBrief.developments.length === 0
    if (alreadyAnswered || (caseBrief.developments.length === 0 && caseBrief.strengths.length === 0 && caseBrief.tone !== "INFORMATIVE")) {
      const record = await deps.messages.completeMessage(request.organizationId, messageId, { ...base, status: "ABSTAINED", abstainReason: caseBrief.suppressed.length > 0 ? "ALREADY_DELIVERED" : "NOTHING_MATERIAL", findingKeys: [], brief: caseBrief, suppressed: caseBrief.suppressed, metrics: { durationMs: deps.now().getTime() - now.getTime() } }, deps.now())
      return resultOf(record, false)
    }
    // Boas práticas da base (opcionais, separadas do processo): escolhidas pelo sistema ANTES da redação (`BASE_PRACTICES_IN_TEXT_V1`) — o
    // texto pode ligar o ponto daquele assunto à prática (B-n) e o bloco continua mostrando todas. Falha aqui nunca derruba o feedback.
    const investigated = "investigations" in prepared ? prepared.investigations : []
    const bestPractices = deps.bestPractices
      ? await deps.bestPractices({ organizationId: request.organizationId, personId: request.collaboratorId, domain: request.domain, interactionId: request.interactionId, signalFlagName: request.triggerFlagName ?? null, indicators: investigated.map((investigation) => ({ indicatorId: investigation.official.indicatorId, periodStart: investigation.official.periodStart, periodEnd: investigation.official.periodEnd, subjectKeys: practiceSubjectKeysOf(investigation) })), products: establishedProductsOfBrief(caseBrief) }).catch((error: unknown) => {
          console.warn(JSON.stringify({ event: "feedback_best_practices_failed", message: error instanceof Error ? error.message : String(error) }))
          return null
        })
      : null
    const basePractices = basePracticesOf(bestPractices)
    const brief: FeedbackBrief = basePractices.length > 0 ? { ...caseBrief, basePractices } : caseBrief
    const { message: assembled, audit } = await composeFeedback(deps.model, brief, metrics)
    if (!assembled) {
      // Sem mensagem útil, coerente e sustentada: a análise fica na memória; nada é publicado "para não ficar sem feedback".
      const record = await deps.messages.completeMessage(request.organizationId, messageId, { ...base, status: "ABSTAINED", abstainReason: `NO_SAFE_MESSAGE:${audit.reason ?? "UNKNOWN"}`, findingKeys: [], brief, composition: audit as unknown as Record<string, unknown>, suppressed: brief.suppressed, metrics: { ...metricsSummaryOf(metrics), durationMs: deps.now().getTime() - now.getTime(), ...(deps.meter ? { budget: deps.meter.summary() } : {}) } }, deps.now())
      return resultOf(record, false)
    }
    // O bloco marca as práticas que o texto citou (a aplicação do feedback não as repete na conclusão).
    const view = bestPractices ? { ...assembled.view, bestPractices: withCitedInText(bestPractices, citedPracticeIdsOf(brief, assembled.communicatedRefs)) } : assembled.view
    // A mensagem persistida é o contrato da tela; o que a trava retirou dos detalhes vai na auditoria da composição.
    const message = { card: assembled.card, paragraphs: assembled.paragraphs, sentences: assembled.sentences, view, text: assembled.text, source: assembled.source, communicatedRefs: assembled.communicatedRefs, ...(assembled.trusted ? { trusted: assembled.trusted } : {}) }
    // Só o que a mensagem COMUNICOU conta como entregue (o resto continua disponível para outro retorno).
    const communicated = new Set(assembled.communicatedRefs)
    const findingKeys = [...brief.developments, ...brief.strengths].filter((finding) => communicated.has(finding.ref)).flatMap((finding) => [finding.findingKey, ...(finding.memberFindingKeys ?? [])])
    const record = await deps.messages.completeMessage(request.organizationId, messageId, {
      status: "PUBLISHABLE",
      analysisRunIds: prepared.runIds,
      abstainReason: null,
      findingKeys,
      brief,
      message,
      composition: audit as unknown as Record<string, unknown>,
      suppressed: brief.suppressed,
      metrics: { ...metricsSummaryOf(metrics), durationMs: deps.now().getTime() - now.getTime(), limited: brief.tone === "INFORMATIVE", ...(deps.meter ? { budget: deps.meter.summary() } : {}) },
      materials: brief.materials.filter((material) => message.view.materials.some((shown) => shown.documentId === material.documentId)).map((material) => ({ documentId: material.documentId, documentVersion: material.documentVersion, criterionKeys: material.criterionKeys, reason: material.reason })),
    }, deps.now())
    return resultOf(record, false)
  } catch (error) {
    await deps.messages.failMessage(request.organizationId, messageId, error instanceof Error ? `${error.name}: ${error.message}` : "erro desconhecido", deps.now()).catch(() => undefined)
    throw error
  }
}
