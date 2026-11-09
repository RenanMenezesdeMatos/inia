import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { FlowGraph, FlowNode } from "../domain/graph-schema.js"
import type { ReliableFeedbackNodeOutput } from "../../reliable-feedback/domain/reliable-feedback-artifact.js"
import type { GenerateFeedbackRequest, GenerateFeedbackResult } from "../../feedback-engine/application/generate-feedback.js"
import type { EngineMessageNodeOutput } from "../../feedback-engine/domain/node-output.js"

const flags = vi.hoisted(() => ({ pipeline: "ON" as "ON" | "OFF" }))
vi.mock("../../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../config/env.js")>()
  return { env: new Proxy(original.env, { get: (target, key) => (key === "INIA_INTERACTION_FEEDBACK_PIPELINE" ? flags.pipeline : Reflect.get(target, key)) }) }
})

const { processNode } = await import("./node-handlers.js")
const { createFakeEffects } = await import("../testing/fake-effect-sink.js")
const { validateReliableFeedbackFlow } = await import("./validate-workflow-for-publish.js")

const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "00000000-0000-4000-8000-0000000000aa"
const INTERACTION = "00000000-0000-4000-8000-0000000000f1"
const MEASUREMENT = "00000000-0000-4000-8000-0000000000m1".replace("m", "0")
const AGENT_A = "00000000-0000-4000-8000-00000000a001"
const AGENT_B = "00000000-0000-4000-8000-00000000b001"
const pos = { x: 0, y: 0 }

const node = (id: string, type: string, config: Record<string, unknown> = {}, label = id) => ({ id, type, label, position: pos, config }) as unknown as FlowNode
const edge = (source: string, target: string, sourceHandle = "always") => ({ id: `${source}-${sourceHandle}-${target}`, source, target, sourceHandle })
const agentNode = (agentId = AGENT_A) => node("agent", "action", { actionType: "CALL_AGENT", agentId }, "Especialista")
const feedbackNode = (config: Record<string, unknown> = { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO" }) => node("feedback", "action", config, "Gerar feedback")
const outputNode = (config: Record<string, unknown> = {}) => node("output", "output", { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.feedback", ...config }, "Feedback ao operador")
/** Flag → Chamar agente → Gerar feedback → [Revisão humana] → Output → Fim */
function graph(options: { withReview?: boolean; agentId?: string; feedback?: FlowNode; output?: FlowNode } = {}): FlowGraph {
  const nodes = [node("trigger", "trigger"), agentNode(options.agentId), options.feedback ?? feedbackNode(), ...(options.withReview ? [node("review", "human_review", { reviewTarget: { type: "SPECIFIC_USER", userId: "00000000-0000-4000-8000-0000000000cc" }, contentSource: "nodeOutputs.feedback" }, "Revisão")] : []), options.output ?? outputNode(), node("end", "end")]
  const edges = [edge("trigger", "agent"), edge("agent", "feedback"), ...(options.withReview ? [edge("feedback", "review"), edge("review", "output", "approved"), edge("review", "end", "rejected"), edge("review", "end", "escalated")] : [edge("feedback", "output")]), edge("output", "end")]
  return { nodes, edges } as FlowGraph
}

const artifact = (disposition: ReliableFeedbackNodeOutput["disposition"], overrides: Partial<ReliableFeedbackNodeOutput> = {}): ReliableFeedbackNodeOutput => ({
  kind: "RELIABLE_FEEDBACK_ARTIFACT", contract: "RELIABLE_FEEDBACK_ARTIFACT_V1", artifactId: "artifact-1", domain: "MONITORING", sourceNodeId: "agent", sourceType: "AGENT", disposition, label: "Atendimento de 14/09/2026",
  items: disposition === "READY" ? [{ index: 0, section: "OPPORTUNITY", sectionLabel: "Ponto de desenvolvimento", wording: { observed: "Você pediu para aguardar.", whyItMatters: "Pode ajudar.", whatYouCanDo: "Explique o motivo." }, wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA", facts: [{ role: "OPERADOR", text: "Vou verificar aqui.", truncated: false, masked: false }], knowledge: null, grounding: "NO_GROUNDED_GUIDANCE", process: null }] : [],
  text: disposition === "READY" ? "**Atendimento de 14/09/2026**\n\n**Ponto de desenvolvimento**\n\nVocê pediu para aguardar." : "", policyVersion: "P", limitations: [], reasons: disposition === "READY" ? ["AUTONOMY_CRITERIA_MET"] : ["FEEDBACK_KIND_NOT_RELEASED_FOR_AUTONOMY"], ...overrides,
})
const AGENT_RESULT = { kind: "monitoring", input: { organizationId: ORG, operatorId: OPERATOR, interactionId: INTERACTION, structured: { evidenceFound: "Vou verificar aqui." } } }

function fakeDb() {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("from people where id = any($1::uuid[]) and active")) return { rows: (params?.[0] as string[]).map((id) => ({ id })), rowCount: 1 }
    if (sql.includes("select operator_id from interactions")) return { rows: [{ operator_id: OPERATOR }], rowCount: 1 }
    if (sql.includes("select subject_id from indicator_measurements")) return { rows: [{ subject_id: OPERATOR }], rowCount: 1 }
    if (sql.includes("select id, name, role from people")) return { rows: [{ id: OPERATOR, name: "Operadora", role: "OPERATOR" }], rowCount: 1 }
    if (sql.includes("select name from people")) return { rows: [{ name: "Operadora" }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  })
  return { query } as unknown as Database
}

function run(g: FlowGraph, nodeId: string, options: { nodeOutputs?: Record<string, unknown>; effects?: ReturnType<typeof createFakeEffects>; interactionId?: string | null; measurementId?: string | null; status?: string } = {}) {
  const effects = options.effects ?? createFakeEffects()
  return processNode(
    {
      db: fakeDb(), graph: g, inputContext: "", now: new Date("2026-09-24T12:00:00Z"), effects,
      workflow: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null },
      enrollment: { id: "enr-1", organization_id: ORG, workflow_id: "wf-1", version_id: "v-1", interaction_id: options.interactionId === undefined ? INTERACTION : options.interactionId, indicator_measurement_id: options.measurementId ?? null, scheduled_subject_id: null, scheduled_for: null, current_node_id: nodeId, matched_flag_name: "rechamada", matched_value_boolean: true, matched_value_numeric: null, status: options.status ?? "active", attempts: 0, revision: 3, node_outputs: options.nodeOutputs ?? { agent: AGENT_RESULT }, variables: {} },
    },
    g.nodes.find((candidate) => candidate.id === nodeId)!,
  )
}

beforeEach(() => { flags.pipeline = "ON" })

const engineMessage = (overrides: Partial<EngineMessageNodeOutput> = {}): EngineMessageNodeOutput => ({
  kind: "FEEDBACK_ENGINE_MESSAGE", messageId: "message-1", domain: "MONITORING", disposition: "READY", label: "Contestação de conta", card: "Ponto principal: informar o prazo da análise.", text: "Quando o cliente perguntou sobre o prazo, você respondeu “é só aguardar”. Na próxima vez, informe o prazo exibido na ferramenta.",
  analysisRunIds: ["run-1"], findings: { developments: 1, strengths: 0, suppressed: 0 }, limitations: [], reused: false, ...overrides,
})
const publishable = (output = engineMessage()): GenerateFeedbackResult => ({ kind: "PUBLISHABLE", messageId: output.messageId, reused: false, nodeOutput: output })

describe("MOTOR DE FEEDBACK — \"Gerar feedback\" no motor real (efeitos falsos, zero modelo)", () => {
  it("PUBLICÁVEL: lê EXPLICITAMENTE a saída do Agent A, domínio AUTO → MONITORIA, e segue para o Output com a mensagem", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.generate.mockImplementation(async () => publishable())
    const outcome = await run(graph(), "feedback", { effects })
    const request = effects.feedbackEngine.generate.mock.calls[0]![1] as GenerateFeedbackRequest
    expect(request).toMatchObject({ organizationId: ORG, enrollmentId: "enr-1", nodeId: "feedback", sourceNodeId: "agent", domain: "MONITORING", collaboratorId: OPERATOR, interactionId: INTERACTION, configuredAgentId: AGENT_A })
    expect(request.sourceNodeOutput).toBe(AGENT_RESULT)
    // O motivo de seleção vem do gatilho (sinal da chamada) — vira memória, nunca texto do modelo.
    expect(request.selectionReason).toContain("rechamada")
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "output", eventType: "action_executed", nodeOutput: { kind: "FEEDBACK_ENGINE_MESSAGE", disposition: "READY" } })
    expect(effects.reliableFeedback.generate).not.toHaveBeenCalled()
    expect(effects.interactionFeedback.generate).not.toHaveBeenCalled()
  })
  it("Agent configurável: o MESMO Workflow com o Agent B leva o Agent B como origem (nada preso a um Agent)", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.generate.mockImplementation(async () => publishable())
    await run(graph({ agentId: AGENT_B }), "feedback", { effects })
    expect((effects.feedbackEngine.generate.mock.calls[0]![1] as GenerateFeedbackRequest).configuredAgentId).toBe(AGENT_B)
  })
  it("ABSTENÇÃO encerra a execução sem Output, com o motivo no evento — NUNCA espera decisão humana", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.generate.mockImplementation(async () => ({ kind: "ABSTAINED", messageId: "message-2", reused: false, reason: "NOTHING_MATERIAL", analysisRunIds: ["run-1"] }))
    const outcome = await run(graph(), "feedback", { effects })
    expect(outcome.kind).toBe("complete")
    expect(outcome).toMatchObject({ eventPayload: { outcome: "ABSTAINED", reason: "NOTHING_MATERIAL", analysisRunIds: ["run-1"] } })
    expect(outcome.kind).not.toBe("wait")
    expect(effects.feedbackEngine.publishFollowUp).not.toHaveBeenCalled()
  })
  it("falha técnica do motor propaga o erro (o motor do Workflow decide a nova tentativa) — sem estado de espera", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.generate.mockRejectedValue(Object.assign(new Error("timeout do provedor"), { code: "AI_TIMEOUT" }))
    await expect(run(graph(), "feedback", { effects })).rejects.toThrow(/timeout do provedor/)
  })
  it("indicador: gatilho por Indicador + Agent → domínio AUTO = INDICADOR com a medição da matrícula", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.generate.mockImplementation(async () => publishable(engineMessage({ domain: "INDICATOR" })))
    await run(graph(), "feedback", { effects, interactionId: null, measurementId: MEASUREMENT })
    expect(effects.feedbackEngine.generate.mock.calls[0]![1]).toMatchObject({ domain: "INDICATOR", indicatorMeasurementId: MEASUREMENT, interactionId: null })
  })
  it("defesa em runtime: origem que não é Agent/Orquestrador ou que não vem antes = falha técnica (nunca adivinha)", async () => {
    await expect(run(graph({ feedback: feedbackNode({ actionType: "GENERATE_FEEDBACK", sourceNodeId: "trigger", feedbackDomain: "AUTO" }) }), "feedback")).rejects.toThrow(/não é um nó "Chamar agente" ou "Orquestrador"/)
    const g = graph()
    const swapped = { ...g, edges: [edge("trigger", "feedback"), edge("feedback", "agent"), edge("agent", "output"), edge("output", "end")] } as FlowGraph
    await expect(run(swapped, "feedback")).rejects.toThrow(/não vem antes/)
  })
})

describe("MOTOR DE FEEDBACK — Output da mensagem", () => {
  it("FOLLOW_UP + O próprio operador: publicação idempotente da MENSAGEM pelo nó Output", async () => {
    const effects = createFakeEffects()
    const outcome = await run(graph(), "output", { effects, nodeOutputs: { agent: AGENT_RESULT, feedback: engineMessage() } })
    expect(effects.feedbackEngine.publishFollowUp).toHaveBeenCalledTimes(1)
    expect(effects.feedbackEngine.publishFollowUp.mock.calls[0]![1]).toEqual({ organizationId: ORG, enrollmentId: "enr-1", nodeId: "output", recipientId: OPERATOR, messageId: "message-1" })
    expect(effects.publishFeedback).not.toHaveBeenCalled()
    expect(effects.reliableFeedback.publishFollowUp).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "end", nodeOutput: { caseId: "case-fake", feedbackId: "feedback-fake" } })
  })
  it("Acompanhamento + Chat + Avatar da MESMA mensagem: uma projeção, entrega marcada para a supressão de repetição", async () => {
    const effects = createFakeEffects()
    await run(graph({ output: outputNode({ surfaces: ["FOLLOW_UP", "CHAT", "AVATAR"] }) }), "output", { effects, nodeOutputs: { agent: AGENT_RESULT, feedback: engineMessage() } })
    expect(effects.feedbackEngine.publishFollowUp).toHaveBeenCalledTimes(1)
    expect(effects.feedbackEngine.projectionSource).toHaveBeenCalledTimes(1)
    expect(effects.feedbackEngine.projectionSource.mock.calls[0]![1]).toEqual({ organizationId: ORG, recipientId: OPERATOR, messageId: "message-1" })
    expect(effects.conversational.offerAvatar.mock.calls[0]![1].projection).toBe(effects.conversational.deliverChat.mock.calls[0]![1].projection)
    expect(effects.feedbackEngine.markDelivered).toHaveBeenCalled()
  })
  it("Notificação à gestão leva o TEXTO da mensagem (nunca JSON); superfície sem consumidor falha fechado", async () => {
    const effects = createFakeEffects()
    await run(graph({ output: outputNode({ target: { type: "USER", userId: "00000000-0000-4000-8000-0000000000cc" }, surfaces: ["NOTIFICATION"] }) }), "output", { effects, nodeOutputs: { feedback: engineMessage() } })
    expect(effects.dispatchAlert.mock.calls[0]![1].description).toContain("informe o prazo exibido na ferramenta")
    expect(effects.dispatchAlert.mock.calls[0]![1].description).not.toContain("FEEDBACK_ENGINE_MESSAGE")
    await expect(run(graph({ output: outputNode({ surfaces: ["FOLLOW_UP", "INBOX"] }) }), "output", { effects, nodeOutputs: { feedback: engineMessage() } })).rejects.toThrow(/consumidor/)
  })
})

describe("Histórico — Output de um ReliableFeedbackArtifact já gerado (compatibilidade)", () => {
  it("FOLLOW_UP + O próprio operador: publicação idempotente pelo nó Output (nunca o publishFeedback legado)", async () => {
    const effects = createFakeEffects()
    const outcome = await run(graph(), "output", { effects, nodeOutputs: { agent: AGENT_RESULT, feedback: artifact("READY") } })
    expect(effects.reliableFeedback.publishFollowUp).toHaveBeenCalledTimes(1)
    expect(effects.reliableFeedback.publishFollowUp.mock.calls[0]![1]).toEqual({ organizationId: ORG, enrollmentId: "enr-1", nodeId: "output", recipientId: OPERATOR, artifactId: "artifact-1" })
    expect(effects.publishFeedback).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "end", nodeOutput: { caseId: "case-fake", feedbackId: "feedback-fake" } })
  })
  it("Notificação ao Supervisor: alerta com o TEXTO emitível (nunca JSON do artefato)", async () => {
    const effects = createFakeEffects()
    const g = graph({ output: outputNode({ target: { type: "USER", userId: "00000000-0000-4000-8000-0000000000cc" }, surfaces: ["NOTIFICATION"] }) })
    await run(g, "output", { effects, nodeOutputs: { agent: AGENT_RESULT, feedback: artifact("READY") } })
    expect(effects.dispatchAlert.mock.calls[0]![1]).toMatchObject({ alertType: "WORKFLOW_OUTPUT", description: expect.stringContaining("Você pediu para aguardar.") })
    expect(effects.dispatchAlert.mock.calls[0]![1].description).not.toContain("RELIABLE_FEEDBACK_ARTIFACT")
  })
  it("Workflow Outputs V1: Acompanhamento + Chat + Avatar do MESMO artefato — entregas independentes, uma projeção só", async () => {
    const effects = createFakeEffects()
    const outcome = await run(graph({ output: outputNode({ surfaces: ["FOLLOW_UP", "CHAT", "AVATAR"] }) }), "output", { effects, nodeOutputs: { agent: AGENT_RESULT, feedback: artifact("READY") } })
    expect(effects.reliableFeedback.publishFollowUp).toHaveBeenCalledTimes(1)
    // A projeção vem do artefato (store), uma vez por destinatário, e é a mesma para Chat e Avatar.
    expect(effects.conversational.reliableProjectionSource).toHaveBeenCalledTimes(1)
    expect(effects.conversational.reliableProjectionSource.mock.calls[0]![1]).toMatchObject({ organizationId: ORG, recipientId: OPERATOR, artifactId: "artifact-1" })
    const chat = effects.conversational.deliverChat.mock.calls[0]![1]
    const avatar = effects.conversational.offerAvatar.mock.calls[0]![1]
    expect(chat.artifactId).toBe("artifact-1")
    expect(avatar.artifactId).toBe("artifact-1")
    expect(avatar.projection).toBe(chat.projection)
    expect(outcome).toMatchObject({ kind: "advance", nodeOutput: { caseId: "case-fake", feedbackId: "feedback-fake", conversationIds: ["conversation-fake"], avatarDeliveryIds: ["avatar-output-fake"] } })
  })
  it("Workflow Outputs V1: falha no Avatar não desfaz o Acompanhamento já publicado; o retry do nó reaproveita as entregas", async () => {
    const effects = createFakeEffects()
    effects.conversational.offerAvatar.mockRejectedValueOnce(new Error("falha transitória"))
    const g = graph({ output: outputNode({ surfaces: ["FOLLOW_UP", "AVATAR"] }) })
    await expect(run(g, "output", { effects, nodeOutputs: { agent: AGENT_RESULT, feedback: artifact("READY") } })).rejects.toThrow(/falha transitória/)
    expect(effects.reliableFeedback.publishFollowUp).toHaveBeenCalledTimes(1)
    await run(g, "output", { effects, nodeOutputs: { agent: AGENT_RESULT, feedback: artifact("READY") } })
    // O Acompanhamento é idempotente por nó (a mesma chamada, a mesma publicação); o convite sai na segunda tentativa.
    expect(effects.reliableFeedback.publishFollowUp.mock.calls.map((call) => call[1])).toEqual([effects.reliableFeedback.publishFollowUp.mock.calls[0]![1], effects.reliableFeedback.publishFollowUp.mock.calls[0]![1]])
    expect(effects.conversational.offerAvatar).toHaveBeenCalledTimes(2)
  })
  it("superfície sem consumidor real (Pendências) ou artefato não liberado: o Output falha fechado, nada é emitido", async () => {
    const effects = createFakeEffects()
    await expect(run(graph({ output: outputNode({ surfaces: ["FOLLOW_UP", "INBOX"] }) }), "output", { effects, nodeOutputs: { feedback: artifact("READY") } })).rejects.toThrow(/sem consumidor|ainda não têm consumidor/)
    await expect(run(graph(), "output", { effects, nodeOutputs: { feedback: artifact("HOLD_FOR_QA") } })).rejects.toThrow(/não está liberado/)
    expect(effects.reliableFeedback.publishFollowUp).not.toHaveBeenCalled()
    expect(effects.dispatchWorkflowOutputRows).not.toHaveBeenCalled()
  })
})

describe("Revisão humana é escolha do Workflow, não condição do motor de feedback", () => {
  it("mensagem → Revisão humana: o revisor recebe o texto; aprovado → segue para o Output", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.generate.mockImplementation(async () => publishable())
    const g = graph({ withReview: true })
    expect(await run(g, "feedback", { effects })).toMatchObject({ kind: "advance", nextNodeId: "review" })
    await run(g, "review", { effects, nodeOutputs: { feedback: engineMessage() } })
    expect(effects.dispatchAlert.mock.calls[0]![1].description).toContain("informe o prazo exibido na ferramenta")
    expect(await run(g, "review", { effects, status: "active", nodeOutputs: { feedback: engineMessage(), review: { decision: "approved" } } })).toMatchObject({ kind: "advance", nextNodeId: "output" })
  })
  it("sem Revisão humana → direto ao Output (o motor não exige revisão)", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.generate.mockImplementation(async () => publishable())
    expect(await run(graph(), "feedback", { effects })).toMatchObject({ kind: "advance", nextNodeId: "output" })
  })
})

describe("V1.5.12 — validação de PUBLICAÇÃO do feedback oficial (nunca deixada para o runtime)", () => {
  const FLAG = { kind: "channel_flag", channelFlagId: "flag-1" } as const
  const INDICATOR = { kind: "indicator", indicatorCode: "TMA" } as const
  const SCHEDULE = { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, anchorDate: "2026-09-01" } as never
  const code = (g: FlowGraph, trigger: Parameters<typeof validateReliableFeedbackFlow>[1] = FLAG, consolidated = false) => {
    try {
      validateReliableFeedbackFlow(g, trigger, consolidated)
      return null
    } catch (error) {
      return (error as { code: string }).code
    }
  }
  it("fluxo oficial válido (com e sem Revisão humana)", () => {
    expect(code(graph())).toBeNull()
    expect(code(graph({ withReview: true }))).toBeNull()
    expect(code(graph(), INDICATOR)).toBeNull()
  })
  it("Agent direto para o Acompanhamento do operador com gatilho por Flag/Indicador → exige a camada de confiabilidade", () => {
    const direct = { nodes: [node("trigger", "trigger"), agentNode(), outputNode({ source: "nodeOutputs.agent" }), node("end", "end")], edges: [edge("trigger", "agent"), edge("agent", "output"), edge("output", "end")] } as FlowGraph
    expect(code(direct)).toBe("WORKFLOW_FEEDBACK_REQUIRES_RELIABILITY")
    expect(code(direct, INDICATOR)).toBe("WORKFLOW_FEEDBACK_REQUIRES_RELIABILITY")
    // Agenda (fontes que a V1 ainda não cobre) e destinatário de gestão continuam no caminho de sempre.
    expect(code(direct, SCHEDULE)).toBeNull()
    expect(code({ ...direct, nodes: direct.nodes.map((n) => (n.id === "output" ? outputNode({ source: "nodeOutputs.agent", target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["NOTIFICATION"] }) : n)) } as FlowGraph)).toBeNull()
  })
  it("\"Gerar feedback\" sem origem, com origem incompatível, não ancestral, ou sem Output que o consuma", () => {
    expect(code(graph({ feedback: feedbackNode({ actionType: "GENERATE_FEEDBACK", sourceNodeId: "", feedbackDomain: "AUTO" }) }))).toBe("WORKFLOW_FEEDBACK_SOURCE_NOT_FOUND")
    expect(code(graph({ feedback: feedbackNode({ actionType: "GENERATE_FEEDBACK", sourceNodeId: "trigger", feedbackDomain: "AUTO" }) }))).toBe("WORKFLOW_FEEDBACK_SOURCE_INCOMPATIBLE")
    const swapped = { nodes: graph().nodes, edges: [edge("trigger", "feedback"), edge("feedback", "agent"), edge("agent", "output"), edge("output", "end")] } as FlowGraph
    expect(code(swapped)).toBe("WORKFLOW_FEEDBACK_SOURCE_NOT_ANCESTOR")
    const noOutput = { nodes: graph().nodes.filter((n) => n.id !== "output"), edges: [edge("trigger", "agent"), edge("agent", "feedback"), edge("feedback", "end")] } as FlowGraph
    expect(code(noOutput)).toBe("WORKFLOW_FEEDBACK_WITHOUT_OUTPUT")
    const disconnected = { nodes: graph().nodes, edges: graph().edges.filter((e) => e.source !== "feedback") } as FlowGraph
    expect(code(disconnected)).toBe("WORKFLOW_MISSING_BRANCH_EDGE")
  })
  it("domínio: monitoria exige Flag; indicador exige gatilho por Indicador e Agent (Indicador + Orquestrador bloqueado); AUTO ambíguo pede escolha", () => {
    expect(code(graph({ feedback: feedbackNode({ actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "MONITORING" }) }), INDICATOR)).toBe("WORKFLOW_FEEDBACK_MONITORING_REQUIRES_INTERACTION")
    expect(code(graph({ feedback: feedbackNode({ actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "INDICATOR" }) }), FLAG)).toBe("WORKFLOW_FEEDBACK_INDICATOR_REQUIRES_CANONICAL_CONTEXT")
    expect(code(graph(), SCHEDULE)).toBe("WORKFLOW_FEEDBACK_DOMAIN_AMBIGUOUS")
    const orchestrator = { nodes: [node("trigger", "trigger"), node("agent", "orchestrator", { orchestratorId: "00000000-0000-4000-8000-00000000c001", instruction: "x" }), feedbackNode({ actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "INDICATOR" }), outputNode(), node("end", "end")], edges: graph().edges } as FlowGraph
    expect(code(orchestrator, INDICATOR)).toBe("WORKFLOW_FEEDBACK_INDICATOR_ORCHESTRATOR_UNSUPPORTED")
    // Orquestrador + monitoria é suportado.
    expect(code({ ...orchestrator, nodes: orchestrator.nodes.map((n) => (n.id === "feedback" ? feedbackNode() : n)) } as FlowGraph, FLAG)).toBeNull()
  })
  it("Output do artefato: só a raiz, só superfícies com consumidor (Acompanhamento/Notificação/Chat/Avatar); o feedback direto (legado) não é fonte de Output; módulo desligado não publica", () => {
    expect(code(graph({ output: outputNode({ source: "nodeOutputs.feedback.items" }) }))).toBe("WORKFLOW_OUTPUT_FEEDBACK_SOURCE_INVALID")
    expect(code(graph({ output: outputNode({ surfaces: ["FOLLOW_UP", "INBOX"] }) }))).toBe("WORKFLOW_OUTPUT_SURFACE_UNSUPPORTED")
    // Workflow Outputs V1 — Chat/Avatar têm consumidor real, mas o feedback é do colaborador: só "O próprio operador".
    expect(code(graph({ output: outputNode({ surfaces: ["FOLLOW_UP", "CHAT", "AVATAR"] }) }))).toBeNull()
    expect(code(graph({ output: outputNode({ surfaces: ["CHAT"], target: { type: "SUPERVISOR_OF_OPERATOR" } }) }))).toBe("WORKFLOW_OUTPUT_CONVERSATIONAL_TARGET_INVALID")
    // O motor não depende do módulo de QA de feedback: com ele desligado, o fluxo continua publicável.
    flags.pipeline = "OFF"
    expect(code(graph())).toBeNull()
  })
})
