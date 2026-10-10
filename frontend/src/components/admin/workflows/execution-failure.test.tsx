/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { failureFromEventPayload } from "@/schemas/admin/execution-failure.schema"
import { describeRetryDecision, ExecutionFailureDetail } from "./execution-failure"
import { describeFindings } from "./workflow-results-tab"

/** V1.7.1c — a falha técnica aparece classificada (Execuções e Resultados), com a decisão de retry e sem conteúdo da resposta. */
const CONTRACT_EVENT = {
  message: "O agente não retornou a avaliação de processo (processAssessment) no formato esperado.",
  attempts: 3,
  errorCategory: "MODEL_OUTPUT_CONTRACT_INVALID",
  errorCategoryLabel: "Resposta do Agent incompatível com o contrato",
  errorCode: "AGENT_PROCESS_ASSESSMENT_INCOMPLETE",
  willRetry: false,
  retryReason: "MODEL_OUTPUT_CONTRACT_INVALID_NO_SAFE_REPAIR",
  nextRetryAt: null,
  repairAttempt: false,
  contract: { name: "PROCESS_ASSESSMENT_V1", version: "PROCESS_ASSESSMENT_MODEL_CONTRACT_V2", violationCount: 2, violations: [{ path: "processAssessment.processes.0.checkpoints.3.evidenceType", code: "EVIDENCE_TYPE_REQUIRED" }, { path: "processAssessment.processes.0.checkpoints.14", code: "CHECKPOINT_CAPACITY_EXCEEDED" }], rawResponseStored: true },
  model: "gemini-3.8-flash",
  agentRunId: "run-1",
}

describe("V1.7.1c — falha técnica classificada", () => {
  it("evento de falha → 'Resposta do Agent incompatível com o contrato', tentativa, código, campos e decisão", () => {
    const failure = failureFromEventPayload(CONTRACT_EVENT)!
    render(<ExecutionFailureDetail failure={failure} />)
    const box = screen.getByTestId("execution-failure")
    expect(box).toHaveTextContent("Resposta do Agent incompatível com o contrato")
    expect(box).toHaveTextContent("Tentativa 3 · código AGENT_PROCESS_ASSESSMENT_INCOMPLETE · modelo gemini-3.8-flash")
    expect(box).toHaveTextContent("processAssessment.processes.0.checkpoints.3.evidenceType (EVIDENCE_TYPE_REQUIRED)")
    expect(box).toHaveTextContent("Não será repetida — resposta fora do contrato — repetir a mesma chamada não corrige. Sem tentativa de reparo. Resposta rejeitada guardada na execução do agente.")
  })

  it("evento antigo (sem categoria) não ganha detalhe inventado; retry transitório mostra a próxima tentativa", () => {
    expect(failureFromEventPayload({ message: "falhou", attempts: 1 })).toBeNull()
    const transient = failureFromEventPayload({ errorCategory: "TRANSIENT_PROVIDER_ERROR", willRetry: true, retryReason: "TRANSIENT_PROVIDER_ERROR", nextRetryAt: "2026-09-25T18:05:00Z", attempts: 1 })!
    expect(describeRetryDecision(transient)).toMatch(/^Nova tentativa em .+ \(falha temporária do provedor\)\.$/)
  })

  it("achados de uma análise parcial dizem que ela é parcial", () => {
    expect(describeFindings({ detected: 12, reliable: 12, inFeedback: 12, blocked: 0, heldForQa: 0, rejected: 0, collapsedDuplicates: 0, notObservable: 1, notApplicable: 1, outsideContract: 2 })).toBe("Achados: 12 detectados · 12 confiáveis · 12 no feedback · 1 não observável · 1 não aplicável · 2 etapas fora do contrato (análise parcial)")
    // V1.7.1l — citações de seção não executável aparecem à parte (nunca como "não aplicável" nem como detectadas).
    expect(describeFindings({ detected: 2, reliable: 2, inFeedback: 2, blocked: 0, heldForQa: 0, rejected: 0, collapsedDuplicates: 0, notObservable: 0, notApplicable: 0, notCheckpoint: 4 })).toBe("Achados: 2 detectados · 2 confiáveis · 2 no feedback · 4 citações de contexto (não são etapas)")
  })
})
