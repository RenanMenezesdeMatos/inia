import { describe, expect, it } from "vitest"
import type { ReliableFeedbackArtifactV1 } from "../../reliable-feedback/domain/reliable-feedback-artifact.js"
import type { FlowGraph } from "./graph-schema.js"
import {
  assemblePersonResult,
  dispatchStatusOf,
  EMPTY_USAGE,
  outputAlertDedupeKey,
  sumUsage,
  type ArtifactRow,
  type EngineMessageRow,
  type PersonEnrollmentRow,
  type PersonInputs,
  type UsageGroupRow,
  type UsageTotals,
} from "./workflow-results.js"

/**
 * V1.5.13 — montagem do resultado por pessoa (read model puro): texto FINAL emitido, Outputs só com efeito persistido,
 * soma de uso sem duplicar. Zero banco, zero modelo.
 */
const AGENT_ID = "aaaaaaaa-0000-4000-8000-000000000001"
const ORCH_ID = "aaaaaaaa-0000-4000-8000-000000000002"
const graph = {
  nodes: [
    { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
    { id: "agent", type: "action", label: "Analisar chamada", position: { x: 0, y: 0 }, config: { actionType: "CALL_AGENT", agentId: AGENT_ID } },
    { id: "orch", type: "orchestrator", label: "Orquestrar", position: { x: 0, y: 0 }, config: { orchestratorId: ORCH_ID } },
    { id: "gen", type: "action", label: "Gerar feedback", position: { x: 0, y: 0 }, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO" } },
    { id: "out", type: "output", label: "Enviar ao colaborador", position: { x: 0, y: 0 }, config: {} },
  ],
  edges: [],
} as unknown as FlowGraph

const person = (overrides: Partial<PersonEnrollmentRow> = {}): PersonEnrollmentRow => ({
  enrollmentId: "enr-1",
  versionId: "v1",
  status: "completed",
  currentNodeId: "out",
  createdAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-20T10:00:05.000Z",
  subjectId: "op-1",
  subjectName: "Franciele Cardoso",
  teamName: "B2C",
  subteamName: null,
  ...overrides,
})

const wording = (text: string) => ({ observed: `${text} observado`, whyItMatters: `${text} importa`, whatYouCanDo: `${text} fazer` })
function artifactOf(items: { disposition: "READY" | "HOLD_FOR_QA" | "BLOCKED"; section?: "STRENGTH" | "OPPORTUNITY" }[], blockedReason: string | null = null): ReliableFeedbackArtifactV1 {
  return {
    contract: "RELIABLE_FEEDBACK_ARTIFACT_V1",
    domain: "MONITORING",
    sourceNodeId: "agent",
    sourceType: "AGENT",
    subject: { collaboratorId: "op-1", interactionId: "int-1", indicatorMeasurementId: null },
    label: "20/09 · Segunda via",
    items: items.map((item, index) => ({
      index,
      claimRef: `c${index}`,
      domain: "MONITORING",
      section: item.section ?? "OPPORTUNITY",
      kind: "MONITORING_DEVELOPMENT_POINT",
      polarity: "NEGATIVE",
      ownership: "AGENT",
      safeMeaning: "ponto",
      guidanceSource: "COACHING_SUGGESTION",
      facts: [{ role: "OPERADOR", text: "Aguarde um momento.", truncated: false, masked: false }],
      withheldFacts: 0,
      analysisConflicts: [],
      structuralBlock: null,
      grounding: "NO_GROUNDED_GUIDANCE",
      knowledge: null,
      process: null,
      audit: { evidence: [], rejectedUnits: [] },
      analysisUsed: false,
      slot: `ITEM_${index + 1}`,
      proposedWording: item.disposition === "BLOCKED" ? null : wording(`proposto ${index}`),
      wordingSource: item.disposition === "BLOCKED" ? null : "WRITER",
      writerViolations: [],
      decision: {
        disposition: item.disposition,
        structural: item.disposition === "BLOCKED" ? "BLOCKED" : "STRUCTURALLY_EMITTABLE",
        reasons: item.disposition === "BLOCKED" ? ["EVIDENCE_NOT_VERIFIED"] : item.disposition === "HOLD_FOR_QA" ? ["PILOT_HOLD_ALL_FOR_QA"] : ["AUTONOMY_CRITERIA_MET"],
        policyVersion: "P",
        autonomyEligible: item.disposition === "BLOCKED" ? null : true,
        autonomyBlockers: [],
      },
    })) as ReliableFeedbackArtifactV1["items"],
    uncertainties: [],
    blockedReason,
    policyVersion: "P",
    writer: { invoked: true, skippedReason: null, error: null, promptVersion: "V1" },
  }
}
const artifactRow = (artifact: ReliableFeedbackArtifactV1, disposition: ArtifactRow["disposition"], overrides: Partial<ArtifactRow> = {}): ArtifactRow => ({
  id: "art-1",
  enrollmentId: "enr-1",
  nodeId: "gen",
  domain: "MONITORING",
  status: "COMPLETED",
  disposition,
  artifact,
  lastError: null,
  completedAt: "2026-09-20T10:00:03.000Z",
  ...overrides,
})

const usage = (total: number | null, input: number | null = null, output: number | null = null, cost: string | null = null): UsageTotals => ({
  calls: 1,
  inputTokens: input,
  outputTokens: output,
  totalTokens: total,
  incomplete: total === null,
  costs: cost ? [{ currency: "USD", amount: cost }] : [],
  costUnknownCalls: cost ? 0 : 1,
})
const usageRow = (nodeId: string, useCase: string, value: UsageTotals, enrollmentId = "enr-1"): UsageGroupRow => ({ enrollmentId, nodeId, useCase, useCaseLabel: useCase, providerKey: "GOOGLE_GENAI", modelName: "gemini-3.1-flash-lite", usage: value })

const outputEvent = (surfaces: string[], recipients = [{ id: "op-1", name: "Franciele Cardoso" }], nodeId = "out") => ({ enrollmentId: "enr-1", nodeId, eventType: "output_dispatched", actionType: null, surfaces, recipients, message: null, createdAt: "2026-09-20T10:00:04.000Z" })

const inputs = (overrides: Partial<PersonInputs> = {}): PersonInputs => ({
  graphs: new Map([["v1", graph]]),
  names: { agents: new Map([[AGENT_ID, "Especialista de Eficiência Operacional"]]), orchestrators: new Map([[ORCH_ID, "Orquestrador de Qualidade"]]) },
  events: [],
  artifacts: [],
  reviews: [],
  emissions: [],
  alerts: [],
  surfaceRows: [],
  legacyFeedbacks: [],
  usage: [],
  ...overrides,
})
const emission = { enrollmentId: "enr-1", nodeId: "out", surface: "FOLLOW_UP", recipientId: "op-1", artifactId: "art-1", feedbackId: "fb-1", createdAt: "2026-09-20T10:00:04.500Z" }

describe("V1.5.13 — status do disparo (raiz + filhos)", () => {
  it("em andamento enquanto qualquer matrícula está ativa/esperando; concluído só com todas concluídas; parcial com mistura", () => {
    expect(dispatchStatusOf(["completed", "waiting", "completed"])).toBe("RUNNING")
    expect(dispatchStatusOf(["completed", "completed"])).toBe("COMPLETED")
    expect(dispatchStatusOf(["completed", "dead"])).toBe("PARTIAL")
    expect(dispatchStatusOf(["dead", "failed"])).toBe("FAILED")
  })
})

describe("V1.5.13 — feedback final e estados sem entrega", () => {
  it("READY emitido: mostra o texto proposto, marcado como enviado, com a hora REAL da emissão", () => {
    const result = assemblePersonResult(person(), inputs({ artifacts: [artifactRow(artifactOf([{ disposition: "READY" }]), "READY")], emissions: [emission], events: [outputEvent(["FOLLOW_UP"])] }))
    expect(result.feedbacks).toHaveLength(1)
    expect(result.feedbacks[0]).toMatchObject({ kind: "RELIABLE", disposition: "READY", sent: true, emittedAt: emission.createdAt, label: "20/09 · Segunda via" })
    expect(result.feedbacks[0]!.items[0]).toMatchObject({ wording: wording("proposto 0"), wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA", facts: [{ role: "OPERADOR", text: "Aguarde um momento." }] })
    expect(result.outputs).toEqual([{ nodeId: "out", nodeLabel: "Enviar ao colaborador", surface: "FOLLOW_UP", recipientName: "Franciele Cardoso", status: "SENT", emittedAt: emission.createdAt }])
  })

  it("E) QA editou: o texto mostrado é o FINAL emitido (editado), nunca a primeira versão do redator", () => {
    const edited = { observed: "texto final do QA", whyItMatters: "porque sim", whatYouCanDo: "faça assim" }
    const result = assemblePersonResult(person(), inputs({
      artifacts: [artifactRow(artifactOf([{ disposition: "HOLD_FOR_QA" }]), "READY")],
      reviews: [{ artifactId: "art-1", itemIndex: 0, status: "APPROVED_EDITED", finalWording: edited }],
      emissions: [emission],
      events: [outputEvent(["FOLLOW_UP"])],
    }))
    expect(result.feedbacks[0]).toMatchObject({ disposition: "READY", sent: true })
    expect(result.feedbacks[0]!.items[0]).toMatchObject({ wording: edited, wordingSource: "HUMAN_EDITED", qaStatus: "APPROVED_EDITED" })
    expect(JSON.stringify(result)).not.toContain("proposto 0")
  })

  it("C) HOLD_FOR_QA: produzido, 'Aguardando QA' com motivos, sem Output e nunca como enviado", () => {
    const result = assemblePersonResult(person({ status: "waiting", currentNodeId: "gen" }), inputs({ artifacts: [artifactRow(artifactOf([{ disposition: "HOLD_FOR_QA" }]), "HOLD_FOR_QA")] }))
    expect(result.waitingForQa).toBe(true)
    expect(result.feedbacks[0]).toMatchObject({ disposition: "HOLD_FOR_QA", sent: false, emittedAt: null, reasons: ["PILOT_HOLD_ALL_FOR_QA"] })
    expect(result.feedbacks[0]!.items[0]).toMatchObject({ qaStatus: "NOT_SELECTED_FOR_QA", wording: wording("proposto 0") })
    expect(result.outputs).toEqual([])
  })

  it("D) BLOCKED: status + motivos, nenhum texto, zero Output", () => {
    const result = assemblePersonResult(person(), inputs({ artifacts: [artifactRow(artifactOf([{ disposition: "BLOCKED" }]), "BLOCKED")] }))
    expect(result.feedbacks[0]).toMatchObject({ disposition: "BLOCKED", sent: false, items: [], reasons: ["EVIDENCE_NOT_VERIFIED"] })
    expect(result.outputs).toEqual([])
  })

  it("READY sem emissão persistida: produzido, NÃO enviado (o nó Output ter rodado não basta)", () => {
    const result = assemblePersonResult(person(), inputs({ artifacts: [artifactRow(artifactOf([{ disposition: "READY" }]), "READY")], events: [outputEvent(["FOLLOW_UP"])] }))
    expect(result.feedbacks[0]).toMatchObject({ disposition: "READY", sent: false, emittedAt: null })
    expect(result.outputs[0]).toMatchObject({ surface: "FOLLOW_UP", status: "NOT_EMITTED", emittedAt: null })
  })

  it("FAILED/DEAD: mostra o erro REAL da trilha (último evento de falha) e nada como enviado", () => {
    const result = assemblePersonResult(person({ status: "dead" }), inputs({
      artifacts: [artifactRow(artifactOf([]), null, { status: "FAILED", artifact: null, lastError: "WRITER_TIMEOUT", completedAt: null })],
      events: [
        { enrollmentId: "enr-1", nodeId: "gen", eventType: "node_failed", actionType: null, surfaces: null, recipients: null, message: "tentativa 1", createdAt: "2026-09-20T10:00:01.000Z" },
        { enrollmentId: "enr-1", nodeId: "gen", eventType: "flow_dead", actionType: null, surfaces: null, recipients: null, message: "Redator indisponível", createdAt: "2026-09-20T10:00:02.000Z" },
      ],
    }))
    expect(result.error).toBe("Redator indisponível")
    expect(result.feedbacks[0]).toMatchObject({ disposition: "FAILED", sent: false, error: "WRITER_TIMEOUT" })
  })

  it("falha antiga já superada por um nó posterior não aparece como erro atual", () => {
    const result = assemblePersonResult(person(), inputs({
      events: [
        { enrollmentId: "enr-1", nodeId: "agent", eventType: "node_failed", actionType: null, surfaces: null, recipients: null, message: "timeout", createdAt: "2026-09-20T10:00:01.000Z" },
        { enrollmentId: "enr-1", nodeId: "agent", eventType: "action_executed", actionType: "CALL_AGENT", surfaces: null, recipients: null, message: null, createdAt: "2026-09-20T10:00:02.000Z" },
      ],
    }))
    expect(result.error).toBeNull()
  })
})

describe("V1.5.13 — Outputs (efeito persistido por superfície)", () => {
  it("F) multi-output: Acompanhamento (emissão), Notificação (alerta) e Chat (sem linha) aparecem UMA vez cada", () => {
    const result = assemblePersonResult(person(), inputs({
      artifacts: [artifactRow(artifactOf([{ disposition: "READY" }]), "READY")],
      emissions: [emission],
      alerts: [{ dedupeKey: outputAlertDedupeKey("enr-1", "out", "op-1"), createdAt: "2026-09-20T10:00:04.700Z" }],
      // o MESMO nó registrado duas vezes (retry) nunca duplica a lista
      events: [outputEvent(["FOLLOW_UP", "NOTIFICATION", "CHAT"]), outputEvent(["FOLLOW_UP", "NOTIFICATION", "CHAT"])],
    }))
    expect(result.outputs.map((output) => [output.surface, output.status])).toEqual([["FOLLOW_UP", "SENT"], ["NOTIFICATION", "SENT"], ["CHAT", "NOT_EMITTED"]])
  })

  it("G) retry idempotente: a emissão reaproveitada vira UMA mensagem enviada; o uso é o registrado (sem multiplicar)", () => {
    const result = assemblePersonResult(person(), inputs({
      artifacts: [artifactRow(artifactOf([{ disposition: "READY" }]), "READY")],
      emissions: [emission],
      events: [outputEvent(["FOLLOW_UP"]), outputEvent(["FOLLOW_UP"])],
      usage: [usageRow("gen", "FEEDBACK_WRITER", usage(420, 300, 120, "0.0004"))],
    }))
    expect(result.feedbacks.filter((feedback) => feedback.sent)).toHaveLength(1)
    expect(result.outputs).toHaveLength(1)
    expect(result.usage).toMatchObject({ calls: 1, totalTokens: 420, costs: [{ currency: "USD", amount: "0.0004" }] })
  })

  it("Output legado (Agent → Output direto): feedback publicado conferido em 'feedbacks' conta como enviado", () => {
    const result = assemblePersonResult(person(), inputs({
      events: [outputEvent(["FOLLOW_UP"])],
      legacyFeedbacks: [{ enrollmentId: "enr-1", nodeId: "out", feedbackId: "fb-legacy", status: "PUBLISHED", impactedIndicator: "TMA", observedBehavior: "obs", recommendation: "rec", evidenceFound: "ev", publishedAt: "2026-09-20T10:00:04.000Z" }],
    }))
    expect(result.feedbacks).toEqual([expect.objectContaining({ kind: "LEGACY", sent: true, legacy: expect.objectContaining({ observedBehavior: "obs", recommendation: "rec" }) })])
    expect(result.outputs[0]).toMatchObject({ status: "SENT" })
  })
})

describe("V1.5.13 — uso de IA por pessoa", () => {
  it("H) Agent + Writer: soma correta, nomes humanos do Agent", () => {
    const result = assemblePersonResult(person(), inputs({
      events: [{ enrollmentId: "enr-1", nodeId: "agent", eventType: "action_executed", actionType: "CALL_AGENT", surfaces: null, recipients: null, message: null, createdAt: "2026-09-20T10:00:01.000Z" }],
      usage: [usageRow("agent", "AGENT_RESPONSE", usage(1120, 1000, 120, "0.0010")), usageRow("gen", "FEEDBACK_WRITER", usage(420, 300, 120, "0.0004"))],
    }))
    expect(result.agents).toEqual([{ nodeId: "agent", name: "Especialista de Eficiência Operacional" }])
    expect(result.usage).toEqual({ calls: 2, inputTokens: 1300, outputTokens: 240, totalTokens: 1540, incomplete: false, costs: [{ currency: "USD", amount: "0.0014" }], costUnknownCalls: 0 })
    expect(result.aiCalls.map((call) => [call.nodeLabel, call.actor, call.useCase, call.usage.totalTokens])).toEqual([
      ["Analisar chamada", "Especialista de Eficiência Operacional", "AGENT_RESPONSE", 1120],
      ["Gerar feedback", null, "FEEDBACK_WRITER", 420],
    ])
  })

  it("I) Orquestrador (roteamento + especialistas + síntese) + Writer: soma correta; provider sem tokens = N/D, nunca estimado", () => {
    const result = assemblePersonResult(person(), inputs({
      events: [{ enrollmentId: "enr-1", nodeId: "orch", eventType: "orchestrator_executed", actionType: null, surfaces: null, recipients: null, message: null, createdAt: "2026-09-20T10:00:01.000Z" }],
      usage: [
        usageRow("orch", "ORCHESTRATOR_ROUTING", usage(230, 200, 30, "0.0002")),
        usageRow("orch", "SPECIALIST_RESPONSE", { ...usage(900, 800, 100, "0.0009"), calls: 2 }),
        usageRow("orch", "ORCHESTRATOR_SYNTHESIS", usage(null)),
        usageRow("gen", "FEEDBACK_WRITER", usage(420, 300, 120, "0.0004")),
      ],
    }))
    expect(result.orchestrators).toEqual([{ nodeId: "orch", name: "Orquestrador de Qualidade", routing: null, synthesis: null }])
    expect(result.usage).toEqual({ calls: 5, inputTokens: 1300, outputTokens: 250, totalTokens: 1550, incomplete: true, costs: [{ currency: "USD", amount: "0.0015" }], costUnknownCalls: 1 })
  })

  it("somas decimais exatas por moeda, nunca convertidas; nada informado = N/D", () => {
    expect(sumUsage([])).toEqual(EMPTY_USAGE)
    const summed = sumUsage([
      { ...EMPTY_USAGE, calls: 1, costs: [{ currency: "USD", amount: "0.1" }] },
      { ...EMPTY_USAGE, calls: 1, costs: [{ currency: "USD", amount: "0.2" }, { currency: "BRL", amount: "1.000000000001" }] },
    ])
    expect(summed.costs).toEqual([{ currency: "BRL", amount: "1.000000000001" }, { currency: "USD", amount: "0.3" }])
    expect(summed.totalTokens).toBeNull()
  })
})

describe("V1.7.1c — falha técnica nos Resultados", () => {
  it("evento classificado → rótulo, código, tentativa, campos e decisão; evento antigo → nada inventado", async () => {
    const { resultFailureOf } = await import("./workflow-results.js")
    expect(resultFailureOf({ attempts: 3, errorCategory: "MODEL_OUTPUT_CONTRACT_INVALID", errorCategoryLabel: "Resposta do Agent incompatível com o contrato", errorCode: "AGENT_PROCESS_ASSESSMENT_INCOMPLETE", willRetry: false, retryReason: "MODEL_OUTPUT_CONTRACT_INVALID_NO_SAFE_REPAIR", nextRetryAt: null, repairAttempt: false, contract: { name: "PROCESS_ASSESSMENT_V1", version: "V2", violationCount: 1, violations: [{ path: "processAssessment.processes.0.checkpoints.3.evidenceType", code: "EVIDENCE_TYPE_REQUIRED" }], rawResponseStored: true }, model: "gemini-3.8-flash", agentRunId: "run-1" })).toEqual({
      label: "Resposta do Agent incompatível com o contrato",
      category: "MODEL_OUTPUT_CONTRACT_INVALID",
      code: "AGENT_PROCESS_ASSESSMENT_INCOMPLETE",
      attempt: 3,
      willRetry: false,
      retryReason: "MODEL_OUTPUT_CONTRACT_INVALID_NO_SAFE_REPAIR",
      nextRetryAt: null,
      repairAttempt: false,
      contract: { name: "PROCESS_ASSESSMENT_V1", version: "V2", violationCount: 1, fields: ["processAssessment.processes.0.checkpoints.3.evidenceType (EVIDENCE_TYPE_REQUIRED)"], rawResponseStored: true },
      model: "gemini-3.8-flash",
      agentRunId: "run-1",
    })
    expect(resultFailureOf({ attempts: 1 })).toBeNull()
    expect(resultFailureOf(null)).toBeNull()
  })
})

describe("Motor de feedback — mensagem publicada ou abstenção nos Resultados", () => {
  const message = (overrides: Partial<EngineMessageRow> = {}): EngineMessageRow => ({
    id: "msg-1", enrollmentId: "enr-1", nodeId: "gen", domain: "MONITORING", status: "PUBLISHABLE", abstainReason: null, label: "20/09 · Segunda via",
    card: "Você explicou bem a segunda via; faltou informar o prazo.", paragraphs: ["Na chamada, você…", "Na próxima…"], tone: "MIXED", developments: 1, strengths: 2, error: null, ...overrides,
  })
  it("publicável e emitido: enviado com a hora real, card e narrativa; nunca espera de QA", () => {
    const engineEmission = { ...emission, artifactId: null, engineMessageId: "msg-1" }
    const result = assemblePersonResult(person(), inputs({ engineMessages: [message()], emissions: [engineEmission], events: [outputEvent(["FOLLOW_UP"])] }))
    expect(result.feedbacks[0]).toMatchObject({ kind: "ENGINE", disposition: "READY", sent: true, emittedAt: engineEmission.createdAt, engine: { card: message().card, narrative: message().paragraphs, developments: 1, strengths: 2 } })
    expect(result.waitingForQa).toBe(false)
    expect(result.outputs[0]).toMatchObject({ surface: "FOLLOW_UP", status: "SENT" })
  })
  it("abstenção: motivo e detalhe separados, sem envio", () => {
    const result = assemblePersonResult(person(), inputs({ engineMessages: [message({ status: "ABSTAINED", abstainReason: "INSUFFICIENT_EVIDENCE:TRANSCRIPT_INCOMPLETE", card: null, paragraphs: null })] }))
    expect(result.feedbacks[0]).toMatchObject({ kind: "ENGINE", disposition: "ABSTAINED", reasons: ["INSUFFICIENT_EVIDENCE"], sent: false, engine: { abstainDetail: "TRANSCRIPT_INCOMPLETE", narrative: [] } })
  })
})
