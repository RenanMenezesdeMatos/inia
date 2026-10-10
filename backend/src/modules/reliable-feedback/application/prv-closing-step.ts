import { z } from "zod"
import { interactionAssessmentSchema } from "../../agents/domain/indicator-diagnosis-contract.js"
import { DIAGNOSIS_ASSESSMENT_COVERAGE_VERSION, summarizeDiagnosisCoverage, type DiagnosisAssessmentCoverage, type InteractionCoverageAudit } from "../../agents/domain/indicator-diagnosis-coverage.js"
import { projectDisplayEvidence, type DisplayProjectionContext } from "../../investigation/domain/feedback-display-evidence.js"
import { personMentionRolesOf } from "../../investigation/domain/person-mention-roles.js"
import type { IndicatorInvestigationPlan, PrepareDirectDiagnosisInput, PrvClosingPlan, PreparePrvClosingInput } from "../../indicator-diagnosis/application/prepare-prv-closing.js"
import { localWeekdayAndHour } from "../../indicator-diagnosis/application/prepare-prv-closing.js"
import { behaviorTitleOf } from "../../indicator-diagnosis/application/load-prv-closing-data.js"
import { checkpointReadinessOf } from "../../indicator-diagnosis/domain/observation-readiness.js"
import { summarizeOperationalPatterns, type InteractionMeta, type OperationalObservation } from "../../indicator-diagnosis/domain/operational-patterns.js"
import { mixShiftOf } from "../../indicator-diagnosis/domain/population-mix.js"
import { buildIndicatorInvestigation, buildPrvClosingDiagnosis, PRV_DIAGNOSIS_LOGIC_VERSION, teamPatternsOf, type IndicatorInvestigation, type PrvClosingDiagnosis, type SampleAccounting, type TeamObservationRow } from "../../indicator-diagnosis/domain/prv-investigation.js"
import { observationsFrom, practiceKeyOf, type ProcessObservation } from "../../indicator-diagnosis/domain/process-patterns.js"
import type { InvestigationStep } from "../../indicator-diagnosis/domain/investigation-steps.js"
import { presentedExcerptsOf } from "../domain/feedback-investigation-result.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { verifyProcessAssessments, type VerifiedCheckpoint, type VerifiedProcessAssessment } from "../domain/process-assessment.js"
import type { MonitoringContextLoader, PublishedKnowledgeLoader } from "./generate-reliable-feedback.js"

/**
 * INDICATOR DIAGNOSIS V1 — O DIAGNÓSTICO DO FECHAMENTO DENTRO DE "GERAR FEEDBACK" (nenhuma chamada de modelo aqui):
 *
 *   1. RECALCULA o plano com as versões de estratégia PRESAS na saída do nó de origem (a saída nunca é confiada): mesmo fechamento,
 *      mesma triagem, mesma população, mesmas chamadas a avaliar (handle → atendimento, senão descartada);
 *   2. VERIFICA cada avaliação pela MESMA regra da monitoria (fala do operador por turno + regra literal publicada, apresentada e
 *      ancorada) — sem segunda lógica de avaliação de chamada;
 *   3. REAPROVEITA as observações compatíveis das chamadas já avaliadas (nenhum modelo para descobrir o mesmo comportamento);
 *   4. AGREGA de forma determinística (uma contribuição por chamada × comportamento), compara com o agregado do Subgrupo e com o
 *      mix do mês anterior, e monta a VERDADE DIAGNÓSTICA (uma por fechamento);
 *   5. devolve as observações NOVAS (com contexto exibível) para gravar na MESMA transação do artefato.
 */
export const PRV_CLOSING_SOURCE_KIND = "PRV_CLOSING_DIAGNOSIS_SOURCE" as const
export const PRV_CLOSING_SOURCE_CONTRACT = "PRV_CLOSING_SOURCE_V1" as const
/** V2 — diagnóstico DIRETO de um indicador (sem PRV): mesma estrutura, outra origem (o indicador vem do Workflow). */
export const INDICATOR_DIAGNOSIS_SOURCE_KIND = "INDICATOR_DIAGNOSIS_SOURCE" as const
export const INDICATOR_DIAGNOSIS_SOURCE_CONTRACT = "INDICATOR_DIAGNOSIS_SOURCE_V2" as const

const stepChoicesSchema = z.record(z.string(), z.object({
  choice: z.array(z.object({ step: z.string().max(60), purpose: z.string().max(300) })).max(20).nullable(),
  planner: z.object({ status: z.enum(["NOT_APPLICABLE", "SKIPPED_NO_CHOICE", "SELECTED", "FALLBACK_DEFAULT"]), agentRunId: z.string().nullable(), attempts: z.number().int().min(0).max(5), error: z.string().nullable() }),
}))

const sourceSchema = z.object({
  kind: z.union([z.literal(PRV_CLOSING_SOURCE_KIND), z.literal(INDICATOR_DIAGNOSIS_SOURCE_KIND)]),
  contract: z.union([z.literal(PRV_CLOSING_SOURCE_CONTRACT), z.literal(INDICATOR_DIAGNOSIS_SOURCE_CONTRACT)]),
  indicatorCode: z.string().min(1).max(40).optional(),
  stepChoices: stepChoicesSchema.optional(),
  organizationId: z.string().uuid(),
  personId: z.string().uuid(),
  referencePeriod: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  idempotencyKey: z.string().min(10).nullable(),
  strategies: z.array(z.object({ indicatorId: z.string().uuid(), indicatorCode: z.string(), strategyVersionId: z.string().uuid().nullable() })),
  sample: z.array(z.object({ handle: z.string().regex(/^I\d{1,2}$/), interactionId: z.string().uuid() })).max(10),
  assessment: z.object({ agentRunId: z.string().nullable(), interactionAssessments: z.array(z.unknown()), knowledgeExcerpts: z.array(z.unknown()), checkpointGovernance: z.unknown().optional(), coverage: z.object({ version: z.literal(DIAGNOSIS_ASSESSMENT_COVERAGE_VERSION), interactions: z.array(z.object({ interactionRef: z.string() }).passthrough()) }).passthrough().optional() }).nullable(),
}).passthrough()

/** Origem do diagnóstico de indicador por fechamento oficial: o do PRV (V1) ou o DIRETO de um indicador (V2) — o mesmo passo trata os dois. */
export const isPrvClosingSource = (value: unknown): boolean => Boolean(value) && typeof value === "object" && ((value as { kind?: unknown }).kind === PRV_CLOSING_SOURCE_KIND || (value as { kind?: unknown }).kind === INDICATOR_DIAGNOSIS_SOURCE_KIND)
export const isDirectIndicatorSource = (value: unknown): boolean => Boolean(value) && typeof value === "object" && (value as { kind?: unknown }).kind === INDICATOR_DIAGNOSIS_SOURCE_KIND
/** Chave do diagnóstico declarada na origem (identidade do artefato; o plano recalculado confirma). */
export const prvClosingKeyOf = (value: unknown): string | null => (isPrvClosingSource(value) && typeof (value as { idempotencyKey?: unknown }).idempotencyKey === "string" ? (value as { idempotencyKey: string }).idempotencyKey : null)

export type PrvPlanLoader = (organizationId: string, input: PreparePrvClosingInput) => Promise<PrvClosingPlan>
export type DirectPlanLoader = (organizationId: string, input: PrepareDirectDiagnosisInput) => Promise<PrvClosingPlan>
/** O escopo da comparação é do BACKEND: `periodSubteamId` = Subgrupo oficial do colaborador no período (linha do fechamento). */
export type TeamObservationLoader = (organizationId: string, input: { personId: string; start: Date; end: Date; practiceKeys: readonly string[]; periodSubteamId?: string | null }) => Promise<TeamObservationRow[]>

export type PrvStepDeps = {
  loadMonitoringContext: MonitoringContextLoader
  loadPublishedKnowledge: PublishedKnowledgeLoader
  preparePrvClosingPlan: PrvPlanLoader
  /** V2 — plano do diagnóstico direto (ausente = só o fechamento do PRV é suportado). */
  prepareDirectIndicatorPlan?: DirectPlanLoader
  loadTeamObservations: TeamObservationLoader
  now: () => Date
}

export type PrvStepResult =
  | { ok: false; reason: "SOURCE_MALFORMED" | "ORGANIZATION_MISMATCH" | "COLLABORATOR_MISMATCH" | "PRV_CLOSING_NOT_FOUND" | "PRV_CLOSING_ALREADY_DIAGNOSED" | "PRV_NOTHING_TO_INVESTIGATE"; plan: PrvClosingPlan | null }
  | { ok: true; plan: PrvClosingPlan; diagnosis: PrvClosingDiagnosis; observations: (ProcessObservation & { displayContext: DisplayContext | null })[]; agentRunId: string | null; noDiagnosisBehaviors: Map<string, string> }

type DisplayContext = { quotes: { text: string; truncated: boolean }[]; rule: { documentTitle: string; heading: string | null; quote: string } | null; guidance: string | null; /** V1.0.2 — lógica que gravou (versiona o reaproveitamento de pendências). */ assessmentLogic: string }

/** A regra que o colaborador lê: a regra operacional da seção quando a citação era só abertura/"evitar", senão a citação verificada. */
function ruleOf(checkpoint: VerifiedCheckpoint): { documentId: string; documentTitle: string; heading: string | null; quote: string } | null {
  const knowledge = checkpoint.knowledge
  if (!knowledge?.documentId || !knowledge.quote || knowledge.applicability === "NOT_VERIFIED") return null
  const operative = checkpoint.operativeRule ?? null
  return { documentId: knowledge.documentId, documentTitle: knowledge.documentTitle, heading: operative?.heading ?? knowledge.heading, quote: (operative?.quote ?? knowledge.quote).trim() }
}

function operationalOf(interactionId: string, assessment: VerifiedProcessAssessment, display: DisplayProjectionContext): OperationalObservation[] {
  return assessment.checkpoints.flatMap((checkpoint): OperationalObservation[] => {
    // Uma contribuição por comportamento: a fonte que só reforça outra não é outra observação.
    if (checkpoint.canonical && checkpoint.canonical.role !== "PRIMARY") return []
    // Citação que não é etapa executável nunca vira observação (nem "não observável").
    if (checkpoint.checkpointEligibility?.eligible === false) return []
    const rule = ruleOf(checkpoint)
    const readiness = checkpointReadinessOf(checkpoint)
    const quotes = checkpoint.transcriptEvidence
      .filter((unit) => unit.speaker === "OPERADOR")
      .map((unit, factIndex) => projectDisplayEvidence({ turnRef: unit.turnRef, speaker: unit.speaker, quote: unit.quote }, { factIndex, evidenceType: "FINDING_EVIDENCE" }, display))
      .flatMap((projected) => (projected.status === "DISPLAYED" ? [{ text: projected.text, truncated: projected.truncated }] : []))
      .slice(0, 2)
    return [{
      interactionId,
      practiceKey: practiceKeyOf(checkpoint),
      behavior: checkpoint.canonical?.behavior ?? null,
      title: behaviorTitleOf(checkpoint.canonical?.behavior ?? null, checkpoint.requirement),
      requirement: checkpoint.requirement,
      documentId: checkpoint.knowledge?.documentId ?? null,
      documentTitle: checkpoint.knowledge?.documentTitle ?? checkpoint.processTitle,
      status: checkpoint.status,
      completeness: checkpoint.completeness?.status ?? null,
      analyticsStatus: readiness.status,
      origin: "ASSESSED",
      evidence: quotes,
      rule,
      guidance: rule && checkpoint.guidance.grounding !== "NO_GROUNDED_GUIDANCE" ? checkpoint.guidance.text : null,
    }]
  })
}

function reusedOf(plan: IndicatorInvestigationPlan): OperationalObservation[] {
  const reusable = new Set(plan.reuse.filter((entry) => entry.status === "REUSABLE").map((entry) => entry.interactionId))
  return plan.storedObservations.filter((observation) => reusable.has(observation.interactionId)).map((observation) => ({
    interactionId: observation.interactionId,
    practiceKey: observation.practiceKey,
    behavior: observation.canonicalBehavior,
    title: behaviorTitleOf(observation.canonicalBehavior, observation.requirement),
    requirement: observation.requirement,
    documentId: observation.documentId,
    documentTitle: observation.documentTitle,
    status: observation.status,
    completeness: observation.completeness,
    analyticsStatus: observation.analyticsStatus,
    origin: "REUSED",
    evidence: observation.displayContext?.quotes ?? [],
    rule: observation.displayContext?.rule ? { documentId: observation.documentId, ...observation.displayContext.rule } : null,
    guidance: observation.displayContext?.guidance ?? null,
  }))
}

/** Cobertura da avaliação só das chamadas DESTA investigação (auditoria; nenhuma decisão é tomada com ela). */
function coverageFor(coverage: unknown, plan: IndicatorInvestigationPlan): DiagnosisAssessmentCoverage | null {
  if (!coverage || typeof coverage !== "object") return null
  const all = coverage as DiagnosisAssessmentCoverage
  const handles = new Set(plan.toAssess.map((request) => request.handle))
  const own = (all.interactions as InteractionCoverageAudit[]).filter((entry) => handles.has(entry.interactionRef))
  return own.length > 0 ? summarizeDiagnosisCoverage(own, all.repairBudget?.maxInteractions ?? 0) : null
}

export async function runPrvClosingStep(deps: PrvStepDeps, input: { organizationId: string; collaboratorId: string; agentId: string | null; sourceNodeOutput: unknown }): Promise<PrvStepResult> {
  const parsed = sourceSchema.safeParse(input.sourceNodeOutput)
  if (!parsed.success) return { ok: false, reason: "SOURCE_MALFORMED", plan: null }
  const source = parsed.data
  // Identidade SEMPRE contra a execução (fail-closed): a saída do nó carrega a organização e o colaborador que ela usou.
  if (source.organizationId !== input.organizationId) return { ok: false, reason: "ORGANIZATION_MISMATCH", plan: null }
  if (source.personId !== input.collaboratorId) return { ok: false, reason: "COLLABORATOR_MISMATCH", plan: null }
  const now = deps.now()
  // V2 — a escolha de passos da IA é presa na saída do nó; o plano a VALIDA de novo (fora da estratégia/indisponível = recusado).
  const stepChoices = source.stepChoices ?? null
  const direct = source.kind === INDICATOR_DIAGNOSIS_SOURCE_KIND
  if (direct && (!deps.prepareDirectIndicatorPlan || !source.indicatorCode)) return { ok: false, reason: "SOURCE_MALFORMED", plan: null }
  const plan = direct
    ? await deps.prepareDirectIndicatorPlan!(input.organizationId, { personId: input.collaboratorId, now, agentId: input.agentId, indicatorCode: source.indicatorCode!, pinnedStrategyVersionId: source.strategies[0]?.strategyVersionId ?? null, referencePeriod: source.referencePeriod ?? null, stepChoices })
    : await deps.preparePrvClosingPlan(input.organizationId, { personId: input.collaboratorId, now, agentId: input.agentId, pinnedStrategies: source.strategies, referencePeriod: source.referencePeriod ?? null, stepChoices })
  if (plan.status === "NO_CLOSING") return { ok: false, reason: "PRV_CLOSING_NOT_FOUND", plan }
  if (plan.status === "ALREADY_DIAGNOSED") return { ok: false, reason: "PRV_CLOSING_ALREADY_DIAGNOSED", plan }
  if (plan.status === "NOTHING_TO_INVESTIGATE") return { ok: false, reason: "PRV_NOTHING_TO_INVESTIGATE", plan }

  // 2. VERIFICAÇÃO das avaliações (só as que o sistema pediu, na mesma ordem de handles).
  const presented = presentedExcerptsOf(source.assessment?.knowledgeExcerpts ?? [])
  const governance = (source.assessment?.checkpointGovernance ?? null) as Parameters<typeof verifyProcessAssessments>[0]["sources"][number]["governance"]
  const documentIds = [...new Set(presented.map((excerpt) => excerpt.documentId))]
  const published = documentIds.length > 0 ? await deps.loadPublishedKnowledge(input.organizationId, documentIds) : new Map()
  const assessed = new Map<string, { assessment: VerifiedProcessAssessment; display: DisplayProjectionContext }>()
  const discarded: { handle: string; reason: string }[] = []
  const seen = new Set<string>()
  for (const raw of source.assessment?.interactionAssessments ?? []) {
    const entry = interactionAssessmentSchema.safeParse(raw)
    if (!entry.success) continue
    const handle = entry.data.interactionRef
    if (seen.has(handle)) { discarded.push({ handle, reason: "DUPLICATE" }); continue }
    seen.add(handle)
    const planned = plan.toAssess.find((request) => request.handle === handle)
    const claimed = source.sample.find((sample) => sample.handle === handle)
    if (!planned || !claimed) { discarded.push({ handle, reason: "NOT_IN_PLAN" }); continue }
    if (planned.interactionId !== claimed.interactionId) { discarded.push({ handle, reason: "PLAN_CHANGED" }); continue }
    const context = await deps.loadMonitoringContext(input.organizationId, planned.interactionId, input.collaboratorId)
    if (!context || context.transcript.trim().length === 0) { discarded.push({ handle, reason: "NOT_ANALYZABLE" }); continue }
    // Assunto estruturado da chamada: o canônico do rótulo; sem ele, o MOTIVO que o próprio sistema escolheu para a investigação
    // (a chamada entrou na amostra por esse campo — nunca um texto do modelo).
    const segmentLabel = plan.investigations.find((investigation) => investigation.toAssess.some((request) => request.handle === handle))?.selectedSegment?.label ?? null
    const subject = context.label.includes(" · ") ? context.label.split(" · ").slice(1).join(" · ") : segmentLabel
    const verified = verifyProcessAssessments({ sources: [{ sourceRef: handle, assessment: entry.data.processAssessment, presented, ...(governance ? { governance } : {}) }], interactionId: planned.interactionId, transcript: context.transcript, published, subject })
    assessed.set(planned.interactionId, { assessment: verified, display: { otherOperatorNames: context.otherOperatorNames, mentionRoles: personMentionRolesOf(context.transcript, context.subjectOperatorName ?? null) } })
  }

  // 3–4. REUSO + AGREGAÇÃO por indicador investigado.
  const investigations: IndicatorInvestigation[] = []
  const newObservations: (ProcessObservation & { displayContext: DisplayContext | null })[] = []
  const noDiagnosisBehaviors = new Map<string, string>()
  for (const investigationPlan of plan.investigations) {
    noDiagnosisBehaviors.set(investigationPlan.indicatorCode, investigationPlan.parameters.noDiagnosisBehavior)
    const reused = reusedOf(investigationPlan)
    const assessedHere = investigationPlan.toAssess.filter((request) => assessed.has(request.interactionId))
    const fresh = assessedHere.flatMap((request) => operationalOf(request.interactionId, assessed.get(request.interactionId)!.assessment, assessed.get(request.interactionId)!.display))
    const analyzedIds = new Set([...investigationPlan.reuse.filter((entry) => entry.status === "REUSABLE").map((entry) => entry.interactionId), ...assessedHere.map((request) => request.interactionId)])
    const startedAt = new Map(investigationPlan.eligibleInteractions.map((entry) => [entry.id, entry.startedAt]))
    const interactions: InteractionMeta[] = [...analyzedIds].map((interactionId) => {
      const date = startedAt.get(interactionId)!
      const { weekday, hour } = localWeekdayAndHour(date, plan.timeZone)
      return { interactionId, localDate: localDateOf(date, plan.timeZone), weekday, hour, segmentKey: investigationPlan.selectedSegment?.key ?? null, segmentLabel: investigationPlan.selectedSegment?.label ?? null, origin: assessed.has(interactionId) ? "ASSESSED" : "REUSED" }
    })
    const ready = investigationPlan.status === "READY" || investigationPlan.status === "INSUFFICIENT_SAMPLE"
    const patterns = ready && interactions.length > 0 ? summarizeOperationalPatterns({ interactions, observations: [...reused, ...fresh], eligiblePopulation: investigationPlan.eligibleInteractions.length, minimumEligible: investigationPlan.parameters.sample.minimumAnalyzed }) : null
    const practiceKeys = patterns?.behaviors.map((behavior) => behavior.practiceKey) ?? []
    // Passos: FIXED = exatamente como sempre (mix e agregado do grupo sempre calculados); AGENT_SELECTED = só o que a IA escolheu.
    const steps = investigationPlan.steps
    const selected = (step: InvestigationStep) => steps.mode === "FIXED" || steps.selected.includes(step)
    // Grupo da comparação resolvido pelo SISTEMA: o Subgrupo oficial do colaborador no período (linha do fechamento), nunca um id da IA.
    const team = teamPatternsOf(practiceKeys.length > 0 && selected("TEAM_COMPARISON") ? await deps.loadTeamObservations(input.organizationId, { personId: input.collaboratorId, start: investigationPlan.window.start, end: investigationPlan.window.end, practiceKeys, periodSubteamId: investigationPlan.snapshot.subteamId }) : [], investigationPlan.parameters.sample.minimumAnalyzed)
    // Observações NOVAS (as avaliadas agora) com o contexto exibível — a memória que o próximo diagnóstico reaproveita.
    const verifiedHere = assessedHere.map((request) => ({ interactionId: request.interactionId, assessment: assessed.get(request.interactionId)!.assessment }))
    const created = observationsFrom(input.collaboratorId, verifiedHere).map((observation) => {
      const source = fresh.find((entry) => entry.interactionId === observation.interactionId && entry.practiceKey === observation.practiceKey)
      return { ...observation, displayContext: source ? { quotes: source.evidence, rule: source.rule ? { documentTitle: source.rule.documentTitle, heading: source.rule.heading, quote: source.rule.quote } : null, guidance: source.guidance, assessmentLogic: PRV_DIAGNOSIS_LOGIC_VERSION } : null }
    })
    for (const observation of created) if (!newObservations.some((entry) => entry.interactionId === observation.interactionId && entry.practiceKey === observation.practiceKey)) newObservations.push(observation)
    const reusableCount = investigationPlan.reuse.filter((entry) => entry.status === "REUSABLE").length
    const sample: SampleAccounting = {
      eligibleCount: investigationPlan.eligibleInteractions.length,
      reusableCount,
      incompatibleCount: investigationPlan.reuse.filter((entry) => entry.status === "INCOMPATIBLE").length,
      unobservedCount: investigationPlan.reuse.filter((entry) => entry.status === "NONE").length,
      selectedForAssessment: investigationPlan.toAssess.length,
      analyzedCount: analyzedIds.size,
      reusedObservationCount: reused.length,
      reanalyzedInteractionCount: assessedHere.length,
      newObservationCount: created.length,
      selectionReason: investigationPlan.selectionReason,
      sampling: investigationPlan.sampling,
      discarded: discarded.filter((entry) => investigationPlan.toAssess.some((request) => request.handle === entry.handle)),
    }
    investigations.push(buildIndicatorInvestigation({
      closing: plan.closing!,
      triage: investigationPlan.decision,
      strategy: { versionId: investigationPlan.strategy?.id ?? null, version: investigationPlan.strategy?.version ?? null },
      snapshot: { indicatorId: investigationPlan.indicatorId, indicatorCode: investigationPlan.indicatorCode, indicatorName: investigationPlan.snapshot.indicatorName, unit: investigationPlan.snapshot.unit, direction: investigationPlan.snapshot.direction, snapshotId: investigationPlan.snapshot.snapshotId },
      window: { startDate: investigationPlan.window.startDate, endDate: investigationPlan.window.endDate, timeZone: investigationPlan.window.timeZone },
      metric: investigationPlan.metric,
      interactionsInPeriod: investigationPlan.interactionsInPeriod,
      segments: investigationPlan.segments,
      selectedSegment: investigationPlan.selectedSegment,
      overallAverageDurationSeconds: investigationPlan.overallAverageDurationSeconds,
      sample,
      minimumAnalyzed: investigationPlan.parameters.sample.minimumAnalyzed,
      mix: investigationPlan.decision.decision === "INVESTIGATE" && investigationPlan.metric !== null && selected("REASON_MIX_SHIFT") ? mixShiftOf(investigationPlan.mixRows.current, investigationPlan.mixRows.previous) : null,
      patterns,
      team,
      planStatus: investigationPlan.status,
      assessmentCoverage: coverageFor(source.assessment?.coverage, investigationPlan),
      // V2 — só quando há algo novo (sinal declarado ou escolha da IA): o diagnóstico FIXED sem sinal continua byte a byte o de antes.
      ...(investigationPlan.signal || steps.mode === "AGENT_SELECTED" || direct ? { steps } : {}),
      ...(investigationPlan.signal ? { signal: { flagName: investigationPlan.signal.flagName, distribution: investigationPlan.signal.distribution, evolution: investigationPlan.signal.evolution } } : {}),
      ...(investigationPlan.parameters.investigation.prohibitedClaims.length > 0 ? { prohibitedClaims: investigationPlan.parameters.investigation.prohibitedClaims } : {}),
    }))
  }
  const diagnosis = buildPrvClosingDiagnosis({ closing: plan.closing!, triage: plan.triage!, investigations, idempotencyKey: plan.idempotencyKey!, generatedAt: now.toISOString(), ...(direct ? { source: { kind: "DIRECT_INDICATOR" as const, indicatorCode: source.indicatorCode ?? null } } : {}) })
  return { ok: true, plan, diagnosis, observations: newObservations, agentRunId: source.assessment?.agentRunId ?? null, noDiagnosisBehaviors }
}
