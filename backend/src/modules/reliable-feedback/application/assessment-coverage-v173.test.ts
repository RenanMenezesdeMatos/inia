import { describe, expect, it, vi } from "vitest"
import { buildProcessCheckpointCatalog, type ProcessCheckpointCatalog } from "../domain/checkpoint-catalog.js"
import { coverageRepairTargets, mergeCoverageRepair, validateProcessAssessmentOutput, type RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"
import { completeAssessmentCoverage, type CoverageRepairCall } from "../../agents/application/assessment-coverage-repair.js"
import { verifyProcessAssessments } from "../domain/process-assessment.js"
import { buildProcessItems } from "../domain/process-items.js"
import { isSystemRenderedProcessItem, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { verifiedAbsenceDisplayOf } from "../domain/verified-absence-display.js"
import { nodeOutputOf } from "../domain/reliable-feedback-artifact.js"
import { projectDisplayEvidence } from "../../investigation/domain/feedback-display-evidence.js"
import { personMentionRolesOf } from "../../investigation/domain/person-mention-roles.js"
import { isObservationEligibleForAnalytics } from "../../indicator-diagnosis/domain/observation-readiness.js"
import { useCaseForPurpose } from "../../../shared/application/model-routing/ai-use-cases.js"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { V172_ASSESSMENT, V172_COLLABORATOR_NAME, V172_PRESENTED, V172_PUBLISHED, V172_SUBJECT, V172_TRANSCRIPT, V172_WRITER_RAW } from "../testing/contestacao-v172-smoke-fixture.js"

/**
 * V1.7.3 — FINAL RELIABILITY HARDENING da Monitoria por Flag, sobre o smoke REAL da V1.7.2 (SMOKE-V172-CONTESTACAO-001; sem modelo):
 *   (1) o especialista recebeu 73 etapas, devolveu 13 e omitiu etapas que aconteceram (identificação da cobrança, verificação do
 *       pagamento); só a recapitulação era obrigatória e a análise saiu COMPLETE — ausência de resposta tratada como "nada a dizer";
 *   (2) a omissão VERIFICADA do protocolo foi BLOQUEADA porque a única fala do momento ("Obrigada por ligar, Marcos…") foi retida
 *       pela privacidade (o nome do cliente coincide com colaboradores ativos).
 */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const CATALOG = buildProcessCheckpointCatalog({ excerpts: V172_PRESENTED, contentOf: (id) => V172_PUBLISHED.get(id)?.content, subject: V172_SUBJECT, coveragePlan: true })
const refOf = (pattern: RegExp, catalog: ProcessCheckpointCatalog = CATALOG) => { const entry = catalog.entries.find((candidate) => pattern.test(candidate.sourceText)); if (!entry) throw new Error(`sem etapa ${pattern}`); return entry.ref }
const REF = {
  holder: refOf(/Validei o titular/),
  identify: refOf(/Identifiquei lançamento/),
  payment: refOf(/Verifiquei se a conta foi paga/),
  openAnalysis: refOf(/Abri análise quando/),
  recap: refOf(/^Antes de encerrar, informar:/),
  recapSupport: refOf(/Recapitulei as ações/),
  compareBills: refOf(/Comparei contas anteriores/),
  understandingPrimary: refOf(/Confirmei se restaram dúvidas/),
  understandingChecklist: refOf(/^\(4\) confirme se o cliente/),
  cancel: refOf(/Cancelar a recorr/),
  protocol: refOf(/Forneci protocolo/),
}
const MISSING_IN_SMOKE = [REF.holder, REF.identify, REF.payment, REF.openAnalysis]

/** A primeira resposta REAL do especialista, validada pelo contrato atual (com o plano de cobertura). */
function firstResponse(mutate: (assessment: RawProcessAssessment) => void = () => {}): RawProcessAssessment {
  const raw = clone(V172_ASSESSMENT)
  delete raw.validation
  mutate(raw)
  const validated = validateProcessAssessmentOutput(raw, { presented: V172_PRESENTED, catalog: CATALOG })
  if (!validated.ok) throw new Error(JSON.stringify(validated.issues))
  return validated.assessment
}
type RawCheckpointInput = RawProcessAssessment["processes"][number]["checkpoints"][number]
const disposition = (checkpointRef: string, status: RawCheckpointInput["status"], transcriptEvidence: string[] = [], evidenceType: RawCheckpointInput["evidenceType"] = status === "FOLLOWED" || status === "NOT_FOLLOWED" ? "OBSERVED" : null): RawCheckpointInput =>
  ({ checkpointRef, requirement: "", status, evidenceType, transcriptEvidence, knowledgeQuote: null, knowledgeDetailQuote: null, guidance: { source: "NO_GROUNDED_GUIDANCE", text: null }, uncertainty: null })
/** Resposta SIMULADA do reparo (as quatro etapas faltantes, com as falas literais da chamada). */
const REPAIR_RESPONSE = {
  assessments: [
    disposition(REF.holder, "FOLLOWED", ["Operador: Entendi. Antes de eu verificar, me confirma o nome do titular e os dois últimos dígitos do CPF, por favor?"]),
    disposition(REF.identify, "FOLLOWED", ["Operador: Obrigada, Marcos, cadastro localizado. Essa Banca Digital é de quanto, e em qual fatura apareceu?", "Operador: Deixa eu olhar aqui... Achei. É uma assinatura de revistas digitais, ativada no dia 3 de setembro pelo próprio celular da linha. Essa é a primeira cobrança dela."]),
    disposition(REF.payment, "FOLLOWED", ["Operador: Tudo bem. E essa fatura você já pagou?"]),
    disposition(REF.openAnalysis, "FOLLOWED", ["Operador: Agora vou abrir a contestação dos R$ 12,90 pra área de faturamento analisar."]),
  ],
}
const repairWith = (value: unknown): { call: CoverageRepairCall & ReturnType<typeof vi.fn>; prompts: { system: string; user: string }[] } => {
  const prompts: { system: string; user: string }[] = []
  const call = vi.fn(async (prompt: { system: string; user: string }) => { prompts.push(prompt); if (value instanceof Error) throw value; return typeof value === "string" ? value : JSON.stringify(value) })
  return { call: call as CoverageRepairCall & ReturnType<typeof vi.fn>, prompts }
}
const repaired = async (value: unknown = REPAIR_RESPONSE) => { const { call, prompts } = repairWith(value); const assessment = await completeAssessmentCoverage({ assessment: firstResponse(), catalog: CATALOG, presented: V172_PRESENTED, conversation: V172_TRANSCRIPT, call }); return { assessment, call, prompts } }

const OTHER_OPERATORS = ["Marcos Guimarães", "Marcos Cunha Nogueira", "Marcos Vieira"]
const verify = (assessment: RawProcessAssessment, transcript = V172_TRANSCRIPT) => verifyProcessAssessments({ sources: [{ sourceRef: "S", assessment: clone(assessment), presented: V172_PRESENTED }], interactionId: "int-173", transcript, published: V172_PUBLISHED, subject: V172_SUBJECT, coveragePlan: true })
const displayContext = (transcript = V172_TRANSCRIPT) => ({ otherOperatorNames: OTHER_OPERATORS, mentionRoles: personMentionRolesOf(transcript, V172_COLLABORATOR_NAME) })

/** Redator: a resposta REAL do smoke para os 5 pontos que ele recebeu + texto SIMULADO para os 4 pontos novos do reparo. */
const WRITER_BY_BEHAVIOR: Record<string, { observed: string; whyItMatters: string; whatYouCanDo: string; suggestedResponse: string }> = {
  CANCEL_RECURRING_SERVICE: V172_WRITER_RAW.items[0]!,
  REGISTER_DISPUTE: V172_WRITER_RAW.items[1]!,
  INFORM_DEADLINE: V172_WRITER_RAW.items[2]!,
  CONFIRM_SOLUTION: V172_WRITER_RAW.items[3]!,
  CONFIRM_UNDERSTANDING: V172_WRITER_RAW.items[4]!,
  VALIDATE_HOLDER: { observed: "Você confirmou o nome do titular e os dígitos finais do CPF antes de consultar a cobrança.", whyItMatters: "", whatYouCanDo: "", suggestedResponse: "" },
  IDENTIFY_CHARGE: { observed: "Você perguntou o valor e a fatura da cobrança e localizou o lançamento com a data de ativação.", whyItMatters: "", whatYouCanDo: "", suggestedResponse: "" },
  CHECK_PAYMENT: { observed: "Você perguntou ao cliente se a fatura já tinha sido paga.", whyItMatters: "", whatYouCanDo: "", suggestedResponse: "" },
  OPEN_ANALYSIS: { observed: "Você informou que abriria a contestação para análise da área de faturamento.", whyItMatters: "", whatYouCanDo: "", suggestedResponse: "" },
}
function writer(): ReliableFeedbackWriterPort & { behaviors: string[] } {
  const behaviors: string[] = []
  return {
    behaviors,
    writeMonitoring: async (input) => {
      behaviors.push(...input.items.map((item) => item.checkpoint?.behavior ?? item.checkpoint?.stepTitle ?? "?"))
      return { rawOutput: { items: input.items.flatMap((item) => { const text = WRITER_BY_BEHAVIOR[item.checkpoint?.behavior ?? ""]; return text ? [{ ...text, slot: item.slot }] : [] }), presentation: V172_WRITER_RAW.presentation } }
    },
    writeIndicator: async () => { throw new Error("não usado") },
  }
}
async function replay(assessment: RawProcessAssessment, transcript = V172_TRANSCRIPT) {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const port = writer()
  const deps: ReliableGenerationDeps = {
    enabled: true, store, writer: port, policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript, label: `Atendimento de 28/09/2026 · ${V172_SUBJECT}`, otherOperatorNames: OTHER_OPERATORS, subjectOperatorName: V172_COLLABORATOR_NAME }),
    loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => V172_PUBLISHED, loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-28T17:10:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: V172_PRESENTED, input: { organizationId: "org-173", operatorId: "op-173", interactionId: "int-173", structured: { evidenceFound: "x", observedBehavior: "o", relatedProcedure: "Procedimento", recommendation: "r", processAssessment: clone(assessment) } } }
  const request: ReliableGenerationRequest = { organizationId: "org-173", enrollmentId: "enr-173", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: "op-173", interactionId: "int-173", indicatorMeasurementId: null, configuredAgentId: null }
  const result = await generateReliableFeedback(deps, request)
  const artifact = result.record.artifact!
  const reviews = artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null }))
  // Texto final sem o item em QA (o que sairia se o QA rejeitasse) e com ele (prévia do QA).
  const pendingRejected = artifact.items.map((item) => ({ itemIndex: item.index, status: item.decision?.disposition === "HOLD_FOR_QA" ? "REJECTED" as const : "APPROVED_UNCHANGED" as const, finalWording: null }))
  return { store, artifact, writer: port, preview: nodeOutputOf(result.record.id, artifact, reviews).text, published: nodeOutputOf(result.record.id, artifact, pendingRejected) }
}
const itemOf = (artifact: Awaited<ReturnType<typeof replay>>["artifact"], code: string) => artifact.items.find((item) => item.process?.behavior?.code === code)
const observation = (store: Awaited<ReturnType<typeof replay>>["store"], behavior: string) => store.observations.find((entry) => entry.canonicalBehavior === behavior)

describe("V1.7.3 — requisito de AVALIAÇÃO × requisito do PROCESSO e o planejador de cobertura", () => {
  it("duas perguntas diferentes: obrigatória no processo = só a recapitulação composta; MUST_ASSESS = recapitulação + uma representante por comportamento do processo primário", () => {
    expect(CATALOG.entries.filter((entry) => entry.processRequirement === "REQUIRED").map((entry) => entry.ref)).toEqual([REF.recap])
    const must = CATALOG.entries.filter((entry) => entry.assessmentRequirement === "MUST_ASSESS")
    // Pequeno e explícito (nunca as 73): uma por comportamento, sempre do documento PRIMÁRIO; o checklist do processo é a representante.
    expect({ presented: CATALOG.entries.length, mustAssess: must.length }).toEqual({ presented: 73, mustAssess: 10 })
    expect(must.every((entry) => entry.primaryProcess && entry.segmentRole === "RULE")).toBe(true)
    expect(new Set(must.map((entry) => entry.canonicalBehavior)).size).toBe(must.length)
    expect(must.map((entry) => entry.canonicalBehavior).sort()).toEqual(["CANCEL_RECURRING_SERVICE", "CHECK_PAYMENT", "CONFIRM_UNDERSTANDING", "IDENTIFY_CHARGE", "INFORM_DEADLINE", "OPEN_ANALYSIS", "PROVIDE_PROTOCOL", "RECAPITULATE_INTERACTION", "REGISTER_DISPUTE", "VALIDATE_HOLDER"])
    expect(must.find((entry) => entry.ref === REF.recap)?.assessmentBasis).toBe("PROCESS_REQUIRED")
    expect(must.filter((entry) => entry.ref !== REF.recap).every((entry) => entry.assessmentBasis === "PRIMARY_PROCESS_BEHAVIOR")).toBe(true)
    // Documento transversal (Checklist de Encerramento, Jeito Vivo) nunca vira MUST_ASSESS sozinho; etapa sem comportamento é MAY_ASSESS.
    expect(CATALOG.entries.filter((entry) => !entry.primaryProcess).every((entry) => entry.assessmentRequirement !== "MUST_ASSESS")).toBe(true)
    expect(CATALOG.entries.find((entry) => entry.ref === REF.compareBills)?.assessmentRequirement).toBe("MAY_ASSESS")
    // Sem plano (chamada que não chegou ao fim / diagnóstico de indicador): nada é MUST_ASSESS.
    const noPlan = buildProcessCheckpointCatalog({ excerpts: V172_PRESENTED, contentOf: (id) => V172_PUBLISHED.get(id)?.content, subject: V172_SUBJECT, coveragePlan: false })
    expect(noPlan.entries.some((entry) => entry.assessmentRequirement === "MUST_ASSESS" || entry.processRequirement === "REQUIRED")).toBe(false)
  })
})

describe("V1.7.3 — auditoria de cobertura (A–D)", () => {
  it("A) MUST_ASSESS devolvido → COMPLETE (disposição NOT_OBSERVABLE/NOT_APPLICABLE também cobre)", () => {
    const complete = firstResponse((raw) => { raw.processes[0]!.checkpoints.push(disposition(REF.holder, "NOT_OBSERVABLE"), disposition(REF.identify, "NOT_OBSERVABLE"), disposition(REF.payment, "NOT_OBSERVABLE"), disposition(REF.openAnalysis, "NOT_APPLICABLE")) })
    expect(complete.validation).toMatchObject({ completeness: "COMPLETE", missingMustAssess: [], assessmentCoverage: { mustAssessCount: 10, missingAfterInitial: [], status: "COMPLETE", repairTriggered: false } })
    expect(coverageRepairTargets(complete, CATALOG)).toEqual([])
  })

  it("B) MUST_ASSESS omitido → detectado e a análise NÃO é declarada COMPLETE", () => {
    const first = firstResponse()
    expect(first.validation).toMatchObject({ completeness: "PARTIAL", invalidItems: [], assessmentCoverage: { mustAssessCount: 10, initialAssessmentCount: 13, missingAfterInitial: MISSING_IN_SMOKE, status: "PARTIAL" } })
    expect(first.validation!.missingMustAssess!.map((entry) => entry.behavior)).toEqual(["VALIDATE_HOLDER", "IDENTIFY_CHARGE", "CHECK_PAYMENT", "OPEN_ANALYSIS"])
  })

  it("C) MAY_ASSESS omitido não quebra a cobertura; outra etapa do MESMO comportamento cobre a representante", () => {
    const missing = firstResponse().validation!.assessmentCoverage!.missingAfterInitial
    expect(missing).not.toContain(REF.compareBills)
    // "Confirmei se restaram dúvidas?" (representante) está coberta pelo item (4) do Checklist de Encerramento que o especialista avaliou.
    expect(missing).not.toContain(REF.understandingPrimary)
    expect(clone(V172_ASSESSMENT).processes.flatMap((process) => process.checkpoints).some((checkpoint) => checkpoint.checkpointRef === REF.understandingChecklist)).toBe(true)
  })

  it("D) SUPPORT_ONLY omitido não quebra a cobertura", () => {
    expect(CATALOG.entries.find((entry) => entry.ref === REF.recapSupport)?.assessmentRequirement).toBe("SUPPORT_ONLY")
    expect(firstResponse().validation!.assessmentCoverage!.missingAfterInitial).not.toContain(REF.recapSupport)
  })
})

describe("V1.7.3 — reparo único (E–H)", () => {
  it("E) UMA chamada, só com as faltantes (código, documento, seção, texto literal) e a conversa; corrige a cobertura", async () => {
    const { assessment, call, prompts } = await repaired()
    expect(call).toHaveBeenCalledTimes(1)
    const refsInPrompt = [...new Set(prompts[0]!.user.match(/CP-[0-9a-f]{10}/g))]
    expect(refsInPrompt).toEqual(MISSING_IN_SMOKE)
    expect(prompts[0]!.user).toContain("Etapa (texto literal da base): - [ ] Verifiquei se a conta foi paga?")
    expect(prompts[0]!.user).toContain("Operador: Tudo bem. E essa fatura você já pagou?")
    // Nunca o catálogo inteiro nem os trechos completos da base.
    expect(prompts[0]!.user).not.toContain("Serviços digitais não reconhecidos")
    expect(prompts[0]!.system).toContain("Avalie SOMENTE as etapas listadas")
    expect(assessment.validation).toMatchObject({ completeness: "COMPLETE", missingMustAssess: [], assessmentCoverage: { initialAssessmentCount: 13, missingAfterInitial: MISSING_IN_SMOKE, repairTriggered: true, repairCalls: 1, repairAssessmentCount: 4, repairRejected: [], repairError: null, missingAfterRepair: [], status: "COMPLETE" } })
    expect(assessment.processes.flatMap((process) => process.checkpoints)).toHaveLength(17)
  })

  it("F) o reparo não sobrescreve a primeira resposta; código não pedido e duplicata são recusados", async () => {
    const cancelBefore = clone(firstResponse().processes.flatMap((process) => process.checkpoints).find((checkpoint) => checkpoint.checkpointRef === REF.cancel))
    const hostile = { assessments: [...REPAIR_RESPONSE.assessments, disposition(REF.cancel, "NOT_FOLLOWED", ["Operador: Certo. Então primeiro eu vou tirar essa assinatura pra ela não renovar mais... Pronto, desativei a Banca Digital na sua linha."]), REPAIR_RESPONSE.assessments[2]!] }
    const { assessment } = await repaired(hostile)
    const checkpoints = assessment.processes.flatMap((process) => process.checkpoints)
    // A etapa já avaliada na primeira resposta nunca é tocada pelo reparo.
    expect(checkpoints.find((checkpoint) => checkpoint.checkpointRef === REF.cancel)).toEqual(cancelBefore)
    expect(checkpoints.filter((checkpoint) => checkpoint.checkpointRef === REF.payment)).toHaveLength(1)
    expect(assessment.validation!.assessmentCoverage!.repairRejected).toEqual(expect.arrayContaining([{ checkpointRef: REF.cancel, code: "REPAIR_REF_NOT_REQUESTED" }, { checkpointRef: null, code: "CHECKPOINT_DUPLICATE" }]))
    expect(assessment.validation!.assessmentCoverage!.missingAfterRepair).toEqual([])
    // Duas disposições CONTRADITÓRIAS para a mesma etapa no reparo: nenhuma vale — a etapa continua faltando (nunca escolhida em silêncio).
    const contradictory = await repaired({ assessments: [...REPAIR_RESPONSE.assessments, disposition(REF.payment, "NOT_OBSERVABLE")] })
    expect(contradictory.assessment.processes.flatMap((process) => process.checkpoints).some((checkpoint) => checkpoint.checkpointRef === REF.payment)).toBe(false)
    expect(contradictory.assessment.validation!.assessmentCoverage).toMatchObject({ missingAfterRepair: [REF.payment], status: "PARTIAL" })
  })

  it("G) reparo incompleto → PARCIAL: a falta fica registrada, vira QA e NUNCA uma conclusão sobre a chamada", async () => {
    const { assessment } = await repaired({ assessments: REPAIR_RESPONSE.assessments.slice(1, 3) })
    expect(assessment.validation).toMatchObject({ completeness: "PARTIAL", assessmentCoverage: { repairAssessmentCount: 2, missingAfterRepair: [REF.holder, REF.openAnalysis], status: "PARTIAL" } })
    const verified = verify(assessment)
    expect(verified.coverage!.missingUnresolved).toEqual([
      { ref: REF.holder, heading: "55. Checklist do operador", behavior: "VALIDATE_HOLDER", reason: "MUST_ASSESS_NOT_RETURNED" },
      { ref: REF.openAnalysis, heading: "55. Checklist do operador", behavior: "OPEN_ANALYSIS", reason: "MUST_ASSESS_NOT_RETURNED" },
    ])
    // Nenhuma etapa faltante ganhou status inventado (nem NOT_FOLLOWED, nem NOT_OBSERVABLE, nem NOT_APPLICABLE).
    expect(verified.checkpoints.some((checkpoint) => checkpoint.source?.ref === REF.holder || checkpoint.source?.ref === REF.openAnalysis)).toBe(false)
    const { artifact, store } = await replay(assessment)
    const processItems = artifact.items.filter((item) => item.process)
    expect(processItems.every((item) => item.decision?.disposition !== "READY")).toBe(true)
    expect(processItems.filter((item) => item.decision?.disposition === "HOLD_FOR_QA").every((item) => item.decision?.reasons.includes("MISSING_REQUIRED_ASSESSMENT"))).toBe(true)
    expect(store.observations.some((entry) => entry.canonicalBehavior === "VALIDATE_HOLDER" || entry.canonicalBehavior === "OPEN_ANALYSIS")).toBe(false)
  })

  it("H) nunca uma segunda chamada: falha, JSON inválido ou reparo já feito não chamam o modelo de novo", async () => {
    const failed = await repaired(Object.assign(new Error("timeout"), { name: "TimeoutError" }))
    expect(failed.call).toHaveBeenCalledTimes(1)
    expect(failed.assessment.validation).toMatchObject({ completeness: "PARTIAL", assessmentCoverage: { repairTriggered: true, repairCalls: 1, repairAssessmentCount: 0, missingAfterRepair: MISSING_IN_SMOKE, status: "PARTIAL" } })
    expect(failed.assessment.validation!.assessmentCoverage!.repairError).toMatch(/^REPAIR_CALL_FAILED:/)
    const garbage = await repaired("isto não é JSON")
    expect(garbage.assessment.validation!.assessmentCoverage).toMatchObject({ repairError: "REPAIR_JSON_INVALID", repairCalls: 1 })
    const again = repairWith(REPAIR_RESPONSE)
    const second = await completeAssessmentCoverage({ assessment: failed.assessment, catalog: CATALOG, presented: V172_PRESENTED, conversation: V172_TRANSCRIPT, call: again.call })
    expect(again.call).not.toHaveBeenCalled()
    expect(second).toEqual(failed.assessment)
    // A mesclagem pura também não reabre um reparo concluído.
    expect(coverageRepairTargets(failed.assessment, CATALOG)).toEqual([])
    expect(mergeCoverageRepair(firstResponse(), CATALOG, [], { kind: "FAILED", code: "X" }, V172_PRESENTED)).toEqual(firstResponse())
  })

  it("o reparo aparece à parte no uso de IA: mesmo Use Case do especialista/Agent, propósito próprio", () => {
    expect(useCaseForPurpose("SPECIALIST_SYNTHESIS", { phase: "SYNTHESIS", purpose: "ASSESSMENT_COVERAGE_REPAIR", source: "SPECIALIST", semanticType: "FEEDBACK" })).toBe("SPECIALIST_RESPONSE")
    expect(useCaseForPurpose("AGENT_SYNTHESIS", { phase: "SYNTHESIS", purpose: "ASSESSMENT_COVERAGE_REPAIR", source: "AGENT", semanticType: "PROCESS_AUDIT" })).toBe("AGENT_RESPONSE")
  })
})

describe("V1.7.3 — replay do smoke REAL da V1.7.2 (I, J, O e o quality gate)", () => {
  it("I) a primeira resposta real continua sem identificação e pagamento; a auditoria aponta as etapas MUST_ASSESS faltantes", () => {
    const behaviors = clone(V172_ASSESSMENT).processes.flatMap((process) => process.checkpoints).map((checkpoint) => CATALOG.entries.find((entry) => entry.ref === checkpoint.checkpointRef)?.canonicalBehavior)
    expect(behaviors).not.toContain("IDENTIFY_CHARGE")
    expect(behaviors).not.toContain("CHECK_PAYMENT")
    expect(firstResponse().validation!.assessmentCoverage!.missingAfterInitial).toEqual(expect.arrayContaining([REF.identify, REF.payment]))
  })

  it("J) replay + reparo: observações 7 → 11 (uma por comportamento), identificação e pagamento FOLLOWED VERIFIED, nada do resto mudou", async () => {
    const before = await replay(clone(V172_ASSESSMENT))
    const { assessment } = await repaired()
    const after = await replay(assessment)
    const summary = (store: typeof before.store) => store.observations.map((entry) => [entry.canonicalBehavior, entry.status, entry.completeness ?? null, entry.analyticsStatus, entry.checkpointRef]).sort()
    expect(before.store.observations).toHaveLength(7)
    expect(after.store.observations).toHaveLength(11)
    // As 7 observações anteriores são as mesmas, byte a byte no que importa.
    expect(summary(after.store).filter((row) => summary(before.store).some((other) => JSON.stringify(other) === JSON.stringify(row)))).toHaveLength(7)
    for (const behavior of ["IDENTIFY_CHARGE", "CHECK_PAYMENT", "VALIDATE_HOLDER", "OPEN_ANALYSIS"]) {
      expect(observation(after.store, behavior)).toMatchObject({ status: "FOLLOWED", analyticsStatus: "VERIFIED" })
      expect(isObservationEligibleForAnalytics(observation(after.store, behavior)!)).toBe(true)
    }
    expect(new Set(after.store.observations.map((entry) => entry.canonicalBehavior)).size).toBe(11)
  })

  it("L/N/O) protocolo: ausência VERIFICADA com a fala retida pela privacidade → frase do sistema, READY, gap próprio", async () => {
    // N) a privacidade continua retendo a fala com o nome (nome de cliente que coincide com colaboradores ativos).
    const closing = "Obrigada por ligar, Marcos. Tenha uma boa tarde!"
    expect(projectDisplayEvidence({ turnRef: "T23", speaker: "OPERADOR", quote: closing }, { factIndex: 0, evidenceType: "FINDING_EVIDENCE" }, displayContext()).status).toBe("WITHHELD")
    const before = await replay(clone(V172_ASSESSMENT))
    const protocol = itemOf(before.artifact, "PROVIDE_PROTOCOL")!
    expect(protocol).toMatchObject({ section: "OPPORTUNITY", facts: [], withheldFacts: 1, wordingSource: "SYSTEM", decision: { disposition: "READY" }, process: { status: "NOT_FOLLOWED", evidenceType: "VERIFIED_OMISSION", analyticReadiness: { status: "VERIFIED" }, absenceDisplay: { statement: "Não foi identificado o número do protocolo sendo informado ao cliente durante esta chamada.", basis: "VERIFIED_OMISSION", withheldEvidence: 1 } }, knowledge: { applicability: "VERIFIED", applicabilityBasis: "VERIFIED_OMISSION" } })
    // A evidência bruta continua na auditoria (turno + hash), nunca exibida.
    expect(protocol.audit.evidence).toEqual([expect.objectContaining({ turnRef: "T23", speaker: "OPERADOR", rawSha256: expect.stringMatching(/^[0-9a-f]{64}$/) })])
    expect(observation(before.store, "PROVIDE_PROTOCOL")).toMatchObject({ status: "NOT_FOLLOWED", analyticsStatus: "VERIFIED" })
    // O) gap próprio, com a frase do sistema no lugar da citação (nunca "Você disse").
    const block = before.preview.split("### Encerramento da chamada")[1]!.split("\n### ")[0]!.split("\n## ")[0]!
    expect(block).toContain("**Na chamada**\n\n_Não foi identificado o número do protocolo sendo informado ao cliente durante esta chamada._")
    // Consolidado com a recapitulação: o único "Você disse" é a RECAPITULAÇÃO (o momento em que o protocolo caberia) — a fala
    // da despedida, retida pela privacidade, nunca aparece.
    expect(block.match(/Você disse/g) ?? []).toHaveLength(1)
    expect(block).toMatch(/_Momento em que caberia:_\n\n> Você disse: “[^”]*recapitulando/i)
    expect(block).not.toContain("Marcos")
    expect(block).not.toContain("no momento mostrado abaixo")
    expect(block).toContain("**O processo orienta**")
    expect(block).toContain("Forneci protocolo?")
    expect(block).toContain("**Como melhorar:**")
    // O texto do sistema nunca foi ao redator.
    expect(before.writer.behaviors).not.toContain("PROVIDE_PROTOCOL")
  })

  it("§21 quality gate: identificação/pagamento FOLLOWED VERIFIED; protocolo NOT_FOLLOWED VERIFIED READY; recapitulação PARCIAL VERIFIED; confirmação de entendimento continua QA legítimo", async () => {
    const { assessment } = await repaired()
    const { artifact, store, published } = await replay(assessment)
    const row = (code: string) => { const item = itemOf(artifact, code)!; return [item.process?.status, item.process?.analyticReadiness?.status, item.decision?.disposition] }
    expect(row("IDENTIFY_CHARGE")).toEqual(["FOLLOWED", "VERIFIED", "READY"])
    expect(row("CHECK_PAYMENT")).toEqual(["FOLLOWED", "VERIFIED", "READY"])
    expect(row("PROVIDE_PROTOCOL")).toEqual(["NOT_FOLLOWED", "VERIFIED", "READY"])
    expect(itemOf(artifact, "RECAPITULATE_INTERACTION")).toMatchObject({ process: { status: "NOT_FOLLOWED", completeness: { status: "PARTIAL" }, analyticReadiness: { status: "VERIFIED" } }, decision: { disposition: "READY" } })
    // QA legítimo preservado (sem sinônimo novo): "Mais alguma coisa em que eu possa te ajudar?" × "confirme se o cliente tem mais alguma dúvida".
    expect(itemOf(artifact, "CONFIRM_UNDERSTANDING")).toMatchObject({ knowledge: { applicability: "LITERAL_ONLY" }, decision: { disposition: "HOLD_FOR_QA" } })
    expect(itemOf(artifact, "CONFIRM_UNDERSTANDING")!.decision!.reasons).toContain("KNOWLEDGE_APPLICABILITY_UNVERIFIED")
    expect(observation(store, "CONFIRM_UNDERSTANDING")).toMatchObject({ analyticsStatus: "NEEDS_REVIEW" })
    expect(artifact.items.filter((item) => item.decision?.disposition === "HOLD_FOR_QA").map((item) => item.process?.behavior?.code)).toEqual(["CONFIRM_UNDERSTANDING"])
    expect(artifact.items.filter((item) => item.decision?.disposition === "BLOCKED")).toEqual([])
    expect(artifact.findings).toMatchObject({ detected: 12, reliable: 12, heldForQa: 1, blocked: 0 })
    // Feedback por Flag V2: os pontos novos entram nos detalhes (sem placar; "O que manter" em parágrafo).
    expect(published.text).toContain("## O que precisa ser ajustado")
    // Consolidação de apresentação: a recapitulação só ficou incompleta pelo protocolo → um bloco "Encerramento da chamada".
    expect(published.text).toContain("### Encerramento da chamada")
    // Feedback Experience V2 — "O que manter" nos detalhes são as evidências de cada ponto (sem resumo repetindo a narrativa).
    expect(published.text).toMatch(/## O que manter\n\n[^#]*Validação do titular[^#]*Identificação da cobrança[^#]*Verificação do pagamento/)
    expect(published.text).not.toMatch(/\d+ pontos? fortes?/)
  })
})

describe("V1.7.3 — exibição de ausência verificada (K, M)", () => {
  it("K) ausência VERIFICADA com fala segura → funciona como antes (fala exibida, sem frase do sistema, redator de sempre)", () => {
    const transcript = V172_TRANSCRIPT.replace("Obrigada por ligar, Marcos. Tenha uma boa tarde!", "Obrigada por ligar. Tenha uma boa tarde!")
    // Análise COMPLETA (a omissão só é verificada com a cobertura completa) e a fala de encerramento sem o nome do cliente.
    const assessment = firstResponse((raw) => {
      for (const checkpoint of raw.processes.flatMap((process) => process.checkpoints)) checkpoint.transcriptEvidence = checkpoint.transcriptEvidence.map((quote) => quote.replace("Obrigada por ligar, Marcos. Tenha uma boa tarde!", "Obrigada por ligar. Tenha uma boa tarde!"))
      raw.processes[0]!.checkpoints.push(disposition(REF.holder, "NOT_OBSERVABLE"), disposition(REF.identify, "NOT_OBSERVABLE"), disposition(REF.payment, "NOT_OBSERVABLE"), disposition(REF.openAnalysis, "NOT_APPLICABLE"))
    })
    const items = buildProcessItems(verify(assessment, transcript), displayContext(transcript)).items
    const protocol = items.find((item) => item.process?.behavior?.code === "PROVIDE_PROTOCOL")!
    expect(protocol.process?.evidenceType).toBe("VERIFIED_OMISSION")
    expect(protocol.facts).toEqual([expect.objectContaining({ role: "OPERADOR", text: "Obrigada por ligar. Tenha uma boa tarde!" })])
    expect(protocol.process?.absenceDisplay).toBeUndefined()
    expect(protocol.structuralBlock).toBeNull()
    expect(isSystemRenderedProcessItem(protocol)).toBe(false)
  })

  it("M) ausência NÃO verificada nunca ganha frase afirmativa do sistema", () => {
    const base = { applicability: "VERIFIED", applicabilityBasis: "VERIFIED_OMISSION", operatorFactShown: false, behavior: "PROVIDE_PROTOCOL" as const, label: "Protocolo", evidenceCount: 1 }
    expect(verifiedAbsenceDisplayOf({ ...base, evidenceType: "VERIFIED_OMISSION" })?.statement).toContain("protocolo")
    expect(verifiedAbsenceDisplayOf({ ...base, evidenceType: "UNVERIFIED_OMISSION" })).toBeNull()
    expect(verifiedAbsenceDisplayOf({ ...base, evidenceType: "OBSERVED_DECLARATION" })).toBeNull()
    expect(verifiedAbsenceDisplayOf({ ...base, evidenceType: "VERIFIED_OMISSION", applicability: "LITERAL_ONLY" })).toBeNull()
    expect(verifiedAbsenceDisplayOf({ ...base, evidenceType: "VERIFIED_OMISSION", applicabilityBasis: "STRUCTURED_ANCHOR" })).toBeNull()
    expect(verifiedAbsenceDisplayOf({ ...base, evidenceType: "VERIFIED_OMISSION", operatorFactShown: true })).toBeNull()
  })

  it("M) análise PARCIAL (reparo incompleto): a omissão do protocolo não é verificada → sem frase do sistema, fica bloqueada pela falta de fala exibível", async () => {
    const { assessment } = await repaired({ assessments: [] })
    const protocol = buildProcessItems(verify(assessment), displayContext()).items.find((item) => item.process?.behavior?.code === "PROVIDE_PROTOCOL")!
    expect(protocol.process?.evidenceType).toBe("UNVERIFIED_OMISSION")
    expect(protocol.process?.absenceDisplay).toBeUndefined()
    expect(protocol.structuralBlock).toBe("INSUFFICIENT_DISPLAY_EVIDENCE")
  })

  it("N) a privacidade não foi relaxada: nome de colaborador e número longo continuam retidos em qualquer fala", () => {
    const context = displayContext()
    expect(projectDisplayEvidence({ turnRef: "T5", speaker: "OPERADOR", quote: "Obrigada, Marcos, cadastro localizado. Essa Banca Digital é de quanto, e em qual fatura apareceu?" }, { factIndex: 0, evidenceType: "FINDING_EVIDENCE" }, context).status).toBe("WITHHELD")
    expect(projectDisplayEvidence({ turnRef: "T9", speaker: "OPERADOR", quote: "Seu número de conta é 123456789012." }, { factIndex: 0, evidenceType: "FINDING_EVIDENCE" }, context).status).toBe("WITHHELD")
    expect(projectDisplayEvidence({ turnRef: "T9", speaker: "OPERADOR", quote: "Tudo bem. E essa fatura você já pagou?" }, { factIndex: 0, evidenceType: "FINDING_EVIDENCE" }, context).status).toBe("DISPLAYED")
  })
})
