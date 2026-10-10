import { CHECKPOINT_GOVERNANCE_VERSION, type CheckpointGovernanceSnapshot } from "./checkpoint-catalog.js"
import { rawProcessAssessmentSchema, type RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"
import type { PresentedKnowledgeExcerpt, ProcessAssessmentSource } from "./process-assessment.js"
import { interactionAssessmentSchema } from "../../agents/domain/indicator-diagnosis-contract.js"
import { z } from "zod"

/**
 * V1.5.12 — FEEDBACK INVESTIGATION RESULT V1: a normalização entre a ORIGEM INVESTIGATIVA (um nó "Chamar agente" ou
 * "Orquestrador" do Workflow) e a camada de confiabilidade do feedback.
 *
 * Tudo o que a origem diz aqui é INTERPRETAÇÃO NÃO VERIFICADA: a citação que o modelo diz ser literal, o comportamento
 * observado, a recomendação e o título de procedimento. Nada disso vira evidência nem número oficial — os adaptadores
 * (monitoria: transcrição real; indicador: contexto canônico do sistema) decidem o que é sustentado. A normalização só
 * confere IDENTIDADE (organização, colaborador, interação/medição) contra a matrícula e recusa o resto (fail-closed).
 * Função pura: não lê banco, não chama modelo.
 */
export const FEEDBACK_INVESTIGATION_RESULT_CONTRACT = "FEEDBACK_INVESTIGATION_RESULT_V1" as const

export const FEEDBACK_DOMAINS = ["MONITORING", "INDICATOR"] as const
export type FeedbackDomain = (typeof FEEDBACK_DOMAINS)[number]
export type InvestigationSourceType = "AGENT" | "ORCHESTRATOR"

/** Uma conclusão da origem, como ela a escreveu (nunca confiável por si). */
export type InvestigationClaim = {
  /** Posição da conclusão na origem (C1, C2…) — só auditoria interna; nunca vai ao redator nem à UI. */
  ref: string
  origin: { specialistAgentId: string | null; toolName: string | null }
  /** Trecho que a origem DIZ ser literal da transcrição (monitoria). Verificado pelo adaptador — nunca aceito como está. */
  claimedEvidence: string | null
  /** O que a origem diz que o operador fez ou deixou de fazer (interpretação). */
  observation: string | null
  /** Resumo/leitura da origem (interpretação). */
  summary: string | null
  /** Recomendação da origem (interpretação; pode citar procedimento não verificado). */
  recommendation: string | null
  /** Título de procedimento que a origem DIZ ter usado — não verificado; só proveniência. */
  claimedProcedureTitle: string | null
}

export type FeedbackInvestigationResultV1 = {
  contract: typeof FEEDBACK_INVESTIGATION_RESULT_CONTRACT
  organizationId: string
  collaboratorId: string
  sourceNodeId: string
  sourceType: InvestigationSourceType
  domain: FeedbackDomain
  claims: InvestigationClaim[]
  /**
   * V1.6.0 — avaliações de processo PROPOSTAS (contrato PROCESS_ASSESSMENT), cada uma com os trechos de KB que a execução
   * que a produziu efetivamente viu. Não verificadas aqui (a verificação é de process-assessment.ts, com a transcrição e as
   * versões publicadas). Vazio = origem sem avaliação de processo (caminho legado por conclusão).
   */
  processAssessments: ProcessAssessmentSource[]
  /**
   * V1.6.1 — diagnóstico do indicador PROPOSTO pela origem: a amostra que ela recebeu (handle → atendimento) e a avaliação de
   * processo por atendimento, com os trechos de KB daquela execução. Nada confiável por si: "Gerar feedback" recalcula o plano
   * e só aceita avaliações de atendimentos que o SISTEMA teria escolhido. null = origem sem diagnóstico (caminho do fato).
   */
  indicatorDiagnosis: { measurementId: string; strategyVersionId: string | null; sample: { handle: string; interactionId: string }[]; assessments: { interactionRef: string; assessment: RawProcessAssessment }[]; presented: PresentedKnowledgeExcerpt[] } | null
  /** Por que partes da origem foram ignoradas (sem virar evidência). */
  uncertainties: string[]
  provenance: {
    sourceResultKind: string
    agentId: string | null
    orchestratorId: string | null
    orchestratorName: string | null
    specialistCalls: number
    investigated: boolean
    investigationStopReason: string | null
    processAuditPresent: boolean
  }
  canonicalRefs: { interactionId: string | null; indicatorMeasurementId: string | null }
}

export type NormalizationInput = {
  sourceNodeOutput: unknown
  sourceType: InvestigationSourceType
  sourceNodeId: string
  domain: FeedbackDomain
  organizationId: string
  collaboratorId: string
  enrollment: { interactionId: string | null; indicatorMeasurementId: string | null }
  /** Agent configurado no nó de origem (auditoria). */
  configuredAgentId?: string | null
}

export type NormalizationFailure =
  | "SOURCE_NOT_EXECUTED"
  | "SOURCE_KIND_INCOMPATIBLE"
  | "ORGANIZATION_MISMATCH"
  | "COLLABORATOR_MISMATCH"
  | "INTERACTION_MISMATCH"
  | "MEASUREMENT_MISMATCH"
  | "INDICATOR_ORCHESTRATOR_UNSUPPORTED"
  | "NO_CANONICAL_REFERENCE"

export type NormalizationResult = { ok: true; result: FeedbackInvestigationResultV1 } | { ok: false; reason: NormalizationFailure }

const text = (value: unknown): string | null => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null)
const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null)

function claimFromStructured(ref: string, structured: Record<string, unknown>, origin: InvestigationClaim["origin"]): InvestigationClaim {
  return {
    ref,
    origin,
    claimedEvidence: text(structured.evidenceFound),
    observation: text(structured.observedBehavior),
    summary: text(structured.summary),
    recommendation: text(structured.recommendation),
    claimedProcedureTitle: text(structured.relatedProcedure),
  }
}

function investigationOf(value: Record<string, unknown>): { investigated: boolean; stopReason: string | null } {
  const investigation = record(value.investigation)
  const trace = Array.isArray(value.toolTrace) ? value.toolTrace : []
  return { investigated: trace.length > 0 || investigation !== null, stopReason: text(investigation?.stopReason) }
}

function normalizeAgent(input: NormalizationInput, output: Record<string, unknown>): NormalizationResult {
  const kind = output.kind
  const expected = input.domain === "MONITORING" ? "monitoring" : "indicator"
  if (kind !== "monitoring" && kind !== "indicator") return { ok: false, reason: "SOURCE_KIND_INCOMPATIBLE" }
  if (kind !== expected) return { ok: false, reason: "SOURCE_KIND_INCOMPATIBLE" }
  const agentInput = record(output.input)
  if (!agentInput) return { ok: false, reason: "SOURCE_KIND_INCOMPATIBLE" }
  // Identidade SEMPRE contra a matrícula (fail-closed): o resultado do Agent carrega a organização/colaborador que ele usou.
  if (agentInput.organizationId !== input.organizationId) return { ok: false, reason: "ORGANIZATION_MISMATCH" }
  if (agentInput.operatorId !== input.collaboratorId) return { ok: false, reason: "COLLABORATOR_MISMATCH" }
  if (input.domain === "MONITORING") {
    if (!input.enrollment.interactionId) return { ok: false, reason: "NO_CANONICAL_REFERENCE" }
    if (agentInput.interactionId !== input.enrollment.interactionId) return { ok: false, reason: "INTERACTION_MISMATCH" }
  } else {
    if (!input.enrollment.indicatorMeasurementId) return { ok: false, reason: "NO_CANONICAL_REFERENCE" }
    const snapshot = record(agentInput.contextSnapshot)
    const measurementId = snapshot?.indicatorMeasurementId ?? (agentInput.evidenceSourceType === "indicator_measurement" ? agentInput.evidenceSourceId : null)
    if (measurementId !== input.enrollment.indicatorMeasurementId) return { ok: false, reason: "MEASUREMENT_MISMATCH" }
  }
  const structured = record(agentInput.structured) ?? {}
  const investigation = investigationOf(output)
  const uncertainties: string[] = []
  if (record(structured.processAudit)) uncertainties.push("PROCESS_AUDIT_NOT_EMITTED")
  const assessment = input.domain === "MONITORING" ? rawAssessmentOf(structured) : null
  const processAssessments: ProcessAssessmentSource[] = assessment ? [{ sourceRef: "AGENT", assessment, presented: presentedExcerptsOf(output.knowledgeExcerpts), ...withGovernance(output.checkpointGovernance) }] : []
  return {
    ok: true,
    result: {
      contract: FEEDBACK_INVESTIGATION_RESULT_CONTRACT,
      organizationId: input.organizationId,
      collaboratorId: input.collaboratorId,
      sourceNodeId: input.sourceNodeId,
      sourceType: "AGENT",
      domain: input.domain,
      claims: [claimFromStructured("C1", structured, { specialistAgentId: input.configuredAgentId ?? null, toolName: null })],
      processAssessments,
      indicatorDiagnosis: input.domain === "INDICATOR" ? indicatorDiagnosisOf(output.diagnosis, output.knowledgeExcerpts, uncertainties) : null,
      uncertainties,
      provenance: { sourceResultKind: String(kind), agentId: input.configuredAgentId ?? null, orchestratorId: null, orchestratorName: null, specialistCalls: 0, investigated: investigation.investigated, investigationStopReason: investigation.stopReason, processAuditPresent: record(structured.processAudit) !== null },
      canonicalRefs: { interactionId: input.enrollment.interactionId, indicatorMeasurementId: input.enrollment.indicatorMeasurementId },
    },
  }
}

/**
 * Orquestrador: só os especialistas com contrato FEEDBACK (evidência estruturada, verificada na chamada) viram conclusões.
 * A síntese em texto livre do Orquestrador e respostas TEXT de especialistas NÃO são evidência — ficam como incerteza.
 * Indicador + Orquestrador não é suportado na V1 (o nó não recebe o contexto canônico do indicador — auditoria da V1.5.12).
 */
/** Checkpoint Registry — o recorte gravado no rastro da fonte (só o formato; nada inventado quando ausente). */
function governanceOf(value: unknown): CheckpointGovernanceSnapshot | null {
  const snapshot = record(value)
  return snapshot && snapshot.version === CHECKPOINT_GOVERNANCE_VERSION && Array.isArray(snapshot.governed) && Array.isArray(snapshot.active) ? (snapshot as unknown as CheckpointGovernanceSnapshot) : null
}

const withGovernance = (value: unknown) => { const governance = governanceOf(value); return governance ? { governance } : {} }

function normalizeOrchestrator(input: NormalizationInput, output: Record<string, unknown>): NormalizationResult {
  if (input.domain === "INDICATOR") return { ok: false, reason: "INDICATOR_ORCHESTRATOR_UNSUPPORTED" }
  if (typeof output.text !== "string" || typeof output.orchestratorName !== "string" || "kind" in output) return { ok: false, reason: "SOURCE_KIND_INCOMPATIBLE" }
  if (!input.enrollment.interactionId) return { ok: false, reason: "NO_CANONICAL_REFERENCE" }
  const results = Array.isArray(output.results) ? (output.results as unknown[]).map(record).filter((item): item is Record<string, unknown> => item !== null) : []
  const claims: InvestigationClaim[] = []
  const processAssessments: ProcessAssessmentSource[] = []
  const uncertainties: string[] = []
  let textOnly = 0
  results.forEach((result) => {
    const structured = result.contract === "FEEDBACK" ? record(result.structured) : null
    if (!structured) {
      textOnly += 1
      return
    }
    claims.push(claimFromStructured(`C${claims.length + 1}`, structured, { specialistAgentId: text(result.agentId), toolName: text(result.toolName) }))
    // Cada especialista avalia contra os trechos que ELE viu (o rastro de KB dele), nunca contra o de outro.
    const assessment = rawAssessmentOf(structured)
    if (assessment) processAssessments.push({ sourceRef: text(result.toolName) ?? `S${processAssessments.length + 1}`, assessment, presented: presentedExcerptsOf(record(result.knowledge)?.retrieved), ...withGovernance(record(result.knowledge)?.checkpointGovernance) })
  })
  if (textOnly > 0) uncertainties.push("SPECIALIST_TEXT_WITHOUT_EVIDENCE_CONTRACT_IGNORED")
  if (claims.length === 0) uncertainties.push("ORCHESTRATOR_SYNTHESIS_IS_NOT_EVIDENCE")
  const investigated = results.some((result) => Array.isArray(result.toolTrace) && result.toolTrace.length > 0)
  return {
    ok: true,
    result: {
      contract: FEEDBACK_INVESTIGATION_RESULT_CONTRACT,
      organizationId: input.organizationId,
      collaboratorId: input.collaboratorId,
      sourceNodeId: input.sourceNodeId,
      sourceType: "ORCHESTRATOR",
      domain: "MONITORING",
      claims,
      processAssessments,
      indicatorDiagnosis: null,
      uncertainties,
      provenance: { sourceResultKind: "orchestrator", agentId: null, orchestratorId: text(output.orchestratorId), orchestratorName: text(output.orchestratorName), specialistCalls: results.length, investigated, investigationStopReason: null, processAuditPresent: false },
      canonicalRefs: { interactionId: input.enrollment.interactionId, indicatorMeasurementId: null },
    },
  }
}

const diagnosisSchema = z.object({
  measurementId: z.string(),
  strategyVersionId: z.string().nullable().default(null),
  sample: z.array(z.object({ handle: z.string(), interactionId: z.string() })).max(10),
  interactionAssessments: z.array(z.unknown()).max(10),
})
/** Diagnóstico da origem (formato conferido; avaliação malformada de um atendimento é descartada, nunca "consertada"). */
function indicatorDiagnosisOf(value: unknown, excerpts: unknown, uncertainties: string[]): FeedbackInvestigationResultV1["indicatorDiagnosis"] {
  if (value === undefined || value === null) return null
  const parsed = diagnosisSchema.safeParse(value)
  if (!parsed.success) {
    uncertainties.push("INDICATOR_DIAGNOSIS_MALFORMED")
    return null
  }
  const assessments = parsed.data.interactionAssessments.flatMap((entry) => {
    const one = interactionAssessmentSchema.safeParse(entry)
    if (!one.success) uncertainties.push("INDICATOR_DIAGNOSIS_ASSESSMENT_MALFORMED")
    return one.success ? [{ interactionRef: one.data.interactionRef, assessment: one.data.processAssessment }] : []
  })
  return { measurementId: parsed.data.measurementId, strategyVersionId: parsed.data.strategyVersionId, sample: parsed.data.sample, assessments, presented: presentedExcerptsOf(excerpts) }
}

/** Trechos de KB que ENTRARAM no prompt (rastro da execução) — nunca o que o modelo diz ter lido. */
export function presentedExcerptsOf(value: unknown): PresentedKnowledgeExcerpt[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): PresentedKnowledgeExcerpt[] => {
    const item = record(entry)
    const documentId = text(item?.documentId)
    const documentTitle = text(item?.documentTitle)
    const excerpt = text(item?.excerpt)
    const chunkIndex = typeof item?.chunkIndex === "number" ? item.chunkIndex : null
    return documentId && documentTitle && excerpt ? [{ documentId, documentTitle, heading: text(item?.heading) ?? "", excerpt, ...(chunkIndex !== null ? { chunkIndex } : {}) }] : []
  })
}
/** Avaliação proposta (formato conferido; conteúdo NÃO verificado). */
function rawAssessmentOf(structured: Record<string, unknown> | null): RawProcessAssessment | null {
  const parsed = rawProcessAssessmentSchema.safeParse(structured?.processAssessment)
  return parsed.success ? parsed.data : null
}

export function normalizeInvestigationResult(input: NormalizationInput): NormalizationResult {
  const output = record(input.sourceNodeOutput)
  if (!output) return { ok: false, reason: "SOURCE_NOT_EXECUTED" }
  return input.sourceType === "AGENT" ? normalizeAgent(input, output) : normalizeOrchestrator(input, output)
}
