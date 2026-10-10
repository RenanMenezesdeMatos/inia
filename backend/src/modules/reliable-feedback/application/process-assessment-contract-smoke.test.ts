import { describe, expect, it, vi } from "vitest"
import { parseStructuredFeedback } from "../../agents/application/run-agent.js"
import type { RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { verifyProcessAssessments } from "../domain/process-assessment.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { SMOKE_DOC_TITLE, SMOKE_INTERACTION, SMOKE_LABEL, SMOKE_LINES, SMOKE_OPERATOR, SMOKE_ORG, smokeAssessment, smokePresented, smokePublished, smokeTranscript } from "../testing/contestacao-smoke-fixture.js"
import { V171B_DOC_TITLE, V171B_PRESENTED, V171B_STEPS, V171B_TRANSCRIPT, v171bSpecialistResponse, withDeclaredConduct } from "../testing/contestacao-v171b-smoke-fixture.js"

/**
 * V1.7.1c (§25) — o caso do smoke V1.7.1b pela ESTRUTURA, pelo MESMO parser de produção (`parseStructuredFeedback`): o
 * especialista avalia a checklist inteira (mais de 12 etapas), cada status com o evidenceType da matriz. Sem modelo.
 */
describe("V1.7.1c — resposta do especialista no caso da contestação (§25)", () => {
  it("14 etapas (checklist de 20 apresentada) passam pelo parser de produção — completa, com os \"\" normalizados", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const parsed = parseStructuredFeedback(v171bSpecialistResponse(withDeclaredConduct(V171B_STEPS)), V171B_TRANSCRIPT, "PROCESS_ASSESSMENT", [], V171B_PRESENTED)
    const assessment = parsed.processAssessment!
    expect(assessment.processes[0]!.checkpoints).toHaveLength(14)
    expect(assessment.validation).toMatchObject({ completeness: "COMPLETE", invalidItems: [], checkpointCapacity: [{ documentTitle: V171B_DOC_TITLE, presentedSteps: 22, capacity: 22 }] })
    // 20 itens da checklist + os 2 itens de lista da seção de prazo apresentada: o teto é o que o documento MOSTROU.
    expect(assessment.processes[0]!.product).toBeNull()
    expect(assessment.validation!.normalizations.map((entry) => entry.path)).toEqual(expect.arrayContaining(["processAssessment.processes.0.product", "processAssessment.processes.0.checkpoints.4.uncertainty", "processAssessment.processes.0.checkpoints.13.guidance.text"]))
    const statuses = assessment.processes[0]!.checkpoints.map((checkpoint) => `${checkpoint.status}:${checkpoint.evidenceType ?? "null"}`)
    expect(new Set(statuses)).toEqual(new Set(["FOLLOWED:OBSERVED", "NOT_FOLLOWED:OBSERVED", "NOT_FOLLOWED:OMISSION", "NOT_OBSERVABLE:null", "NOT_APPLICABLE:null"]))
    // A camada de confiabilidade recebe as 14 etapas (nenhuma cortada pelo antigo teto de 12).
    const verified = verifyProcessAssessments({ sources: [{ sourceRef: "AGENT", assessment, presented: V171B_PRESENTED }], interactionId: "i-1", transcript: V171B_TRANSCRIPT, published: new Map() })
    expect(verified.checkpoints).toHaveLength(14)
    expect(verified.summary.contractInvalidItems).toBe(0)
  })

  it("a resposta que o prompt ANTIGO induzia (evidenceType null em etapa cumprida, 16 etapas) não derruba mais a análise: as etapas incoerentes saem com motivo, as outras seguem (PARTIAL)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const oldStyle = [
      ...V171B_STEPS.map((entry, index) => (index < 3 ? { ...entry, evidenceType: null } : entry)),
      { ...V171B_STEPS[0]!, requirement: "Ouvi a contestação completa", knowledgeQuote: "Ouvi a contestação completa?", evidenceType: "OBSERVED" },
      { ...V171B_STEPS[12]!, requirement: "Registrei todos os fatos", knowledgeQuote: "Registrei todos os fatos?", status: "NOT_OBSERVABLE", evidenceType: "OBSERVED" },
    ]
    const parsed = parseStructuredFeedback(v171bSpecialistResponse(withDeclaredConduct(oldStyle)), V171B_TRANSCRIPT, "PROCESS_ASSESSMENT", [], V171B_PRESENTED)
    const assessment = parsed.processAssessment!
    expect(assessment.validation!.completeness).toBe("PARTIAL")
    expect(assessment.validation!.invalidItems.map((item) => `${item.path.split(".").pop()}:${item.code}`)).toEqual(["0:EVIDENCE_TYPE_REQUIRED", "1:EVIDENCE_TYPE_REQUIRED", "2:EVIDENCE_TYPE_REQUIRED", "15:EVIDENCE_TYPE_NOT_ALLOWED"])
    expect(assessment.processes[0]!.checkpoints).toHaveLength(12)
  })
  it("Monitoring V2 — contrato V5: a mesma resposta histórica SEM conductEvidence perde as etapas cumpridas/não cumpridas (a semântica é declarada, nunca reconstruída)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const parsed = parseStructuredFeedback(v171bSpecialistResponse(), V171B_TRANSCRIPT, "PROCESS_ASSESSMENT", [], V171B_PRESENTED)
    const codes = new Set(parsed.processAssessment!.validation!.invalidItems.map((item) => item.code))
    expect([...codes]).toEqual(["CHECKPOINT_CONDUCT_REQUIRED"])
    expect(parsed.processAssessment!.validation).toMatchObject({ contractVersion: "PROCESS_ASSESSMENT_MODEL_CONTRACT_V2", completeness: "PARTIAL" })
    expect(parsed.processAssessment!.processes[0]!.checkpoints.every((checkpoint) => checkpoint.status === "NOT_OBSERVABLE" || checkpoint.status === "NOT_APPLICABLE")).toBe(true)
  })
})

/** Mesma montagem do smoke da V1.7.1 (contestacao-smoke.test.ts), com a avaliação do especialista marcada como PARCIAL. */
function setup(assessment: RawProcessAssessment) {
  const writer: ReliableFeedbackWriterPort = {
    writeMonitoring: async (input) => ({ rawOutput: { items: input.items.map((item) => ({ slot: item.slot, observed: `Na etapa “${item.checkpoint!.stepTitle}”, veja o que aconteceu na chamada.`, whyItMatters: null, whatYouCanDo: `Aplique a etapa “${item.checkpoint!.stepTitle}” como o documento orienta.` })) } }),
    writeIndicator: async () => { throw new Error("não usado") },
  }
  const deps: ReliableGenerationDeps = {
    enabled: true,
    store: createInMemoryReliableFeedbackStore({ onReactivate: () => true }),
    writer,
    policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: smokeTranscript(), label: SMOKE_LABEL, otherOperatorNames: [] }),
    loadIndicatorContext: async () => null,
    loadPublishedKnowledge: async () => smokePublished,
    loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }),
    resolveDiagnosticStrategy: async () => null,
    now: () => new Date("2026-09-25T13:00:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: smokePresented, input: { organizationId: SMOKE_ORG, operatorId: SMOKE_OPERATOR, interactionId: SMOKE_INTERACTION, structured: { evidenceFound: SMOKE_LINES.identify, observedBehavior: "o", relatedProcedure: SMOKE_DOC_TITLE, recommendation: "r", processAssessment: assessment } } }
  const request: ReliableGenerationRequest = { organizationId: SMOKE_ORG, enrollmentId: "enr-partial", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "agente", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: SMOKE_OPERATOR, interactionId: SMOKE_INTERACTION, indicatorMeasurementId: null, configuredAgentId: null }
  return { deps, request }
}

describe("V1.7.1c — avaliação PARCIAL não se passa por completa (§10)", () => {
  const partial = (): RawProcessAssessment => ({
    ...smokeAssessment(),
    validation: { contractVersion: "PROCESS_ASSESSMENT_MODEL_CONTRACT_V2", completeness: "PARTIAL", invalidItems: [{ path: "processAssessment.processes.0.checkpoints.5", code: "EVIDENCE_TYPE_REQUIRED", requirement: "Analisar valores atuais e anteriores elegíveis", status: "FOLLOWED", issues: [] }], normalizations: [], checkpointCapacity: [] },
  })

  it("com a análise completa a omissão é verificada e autônoma; PARCIAL, a mesma omissão vai ao QA (uma etapa descartada poderia ser a contraprova)", async () => {
    const complete = setup(smokeAssessment())
    const completeResult = await generateReliableFeedback(complete.deps, complete.request)
    const completeItem = completeResult.record.artifact!.items.find((item) => item.process?.stepTitle === "Explicar prazo")!
    expect(completeItem).toMatchObject({ process: { evidenceType: "VERIFIED_OMISSION" }, decision: { disposition: "READY" } })

    const { deps, request } = setup(partial())
    const result = await generateReliableFeedback(deps, request)
    const artifact = result.record.artifact!
    const item = artifact.items.find((entry) => entry.process?.stepTitle === "Explicar prazo")!
    expect(item.process!.evidenceType).toBe("UNVERIFIED_OMISSION")
    expect(item.decision.disposition).toBe("HOLD_FOR_QA")
    expect(artifact.processAssessment!.checkpoints.find((checkpoint) => checkpoint.requirement === "Explicar prazo")!.omission).toMatchObject({ verified: false, failure: "ASSESSMENT_PARTIAL" })
    // O resto não muda por causa da parcialidade: as demais etapas têm a mesma decisão da análise completa.
    const others = (items: typeof artifact.items) => items.filter((entry) => entry.process?.stepTitle !== "Explicar prazo").map((entry) => `${entry.process?.stepTitle}:${entry.decision.disposition}`)
    expect(others(artifact.items)).toEqual(others(completeResult.record.artifact!.items))
    expect(result.nodeOutput.findings).toMatchObject({ outsideContract: 1 })
  })
})
