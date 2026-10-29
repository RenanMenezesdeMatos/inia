import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { OutputNodeConfig } from "../domain/output-schema.js"
import { productionEffects } from "./effect-sink.js"
import { executeOutput, type OutputExecutionContext } from "./output-executor.js"
import { inMemoryHierarchyReader } from "../testing/in-memory-hierarchy-reader.js"
import type { ConversationalDeliveryInput } from "../../conversational-delivery/application/deliver-conversational-output.js"

vi.mock("../../feedbacks/application/create-monitoring-feedback.js", () => ({
  createMonitoringFeedback: vi.fn(async () => ({ caseId: "case-1", feedbackId: "feedback-1" })),
}))
vi.mock("../../feedbacks/application/create-indicator-feedback.js", () => ({
  createIndicatorFeedback: vi.fn(async () => ({ caseId: "case-2", feedbackId: "feedback-2" })),
}))
vi.mock("../../feedbacks/application/create-orchestrator-feedback.js", () => ({
  createOrchestratorFeedback: vi.fn(async () => ({ caseId: "case-3", feedbackId: "feedback-3" })),
}))

const { createMonitoringFeedback } = await import("../../feedbacks/application/create-monitoring-feedback.js")
const { createOrchestratorFeedback } = await import("../../feedbacks/application/create-orchestrator-feedback.js")

type Call = { sql: string; params: unknown[] }

function fakeDb(handlers: { match: (sql: string) => boolean; rows: unknown[] }[]): { db: Database; calls: Call[] } {
  const calls: Call[] = []
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      const handler = handlers.find((h) => h.match(sql))
      return { rows: handler?.rows ?? [], rowCount: handler?.rows.length ?? 0 }
    },
  } as unknown as Database
  return { db, calls }
}

function baseContext(db: Database, overrides: Partial<OutputExecutionContext> = {}): OutputExecutionContext {
  return {
    db,
    organizationId: "org-1",
    enrollmentId: "enrollment-1",
    nodeId: "output-1",
    nodeOutputs: {},
    enrollment: { interactionId: "interaction-1", indicatorMeasurementId: null, scheduledSubjectId: null },
    // Sink REAL de propósito: estes testes verificam as gravações de produção (alerts,
    // workflow_outputs, feedbacks) que agora vivem atrás de effect-sink.ts.
    effects: productionEffects,
    agentNodeIds: new Set(["agent"]),
    ...overrides,
  }
}

describe("executeOutput", () => {
  it("FOLLOW_UP + CURRENT_OPERATOR publishes via createMonitoringFeedback using the agent's structured result", async () => {
    const monitoringInput = { organizationId: "org-1", operatorId: "operator-1" } as never
    const { db } = fakeDb([
      { match: (sql) => sql.includes("from interactions"), rows: [{ operator_id: "operator-1" }] },
      { match: (sql) => sql.includes("select team_id from people"), rows: [{ team_id: "team-1" }] },
    ])

    const config: OutputNodeConfig = {
      target: { type: "CURRENT_OPERATOR" },
      surfaces: ["FOLLOW_UP"],
      source: "nodeOutputs.agent",
    }
    const context = baseContext(db, { nodeOutputs: { agent: { kind: "monitoring", input: monitoringInput } } })

    const result = await executeOutput(config, context)

    expect(createMonitoringFeedback).toHaveBeenCalledWith(db, { organizationId: "org-1", operatorId: "operator-1", teamId: "team-1" })
    expect(result.nodeOutput).toEqual({ caseId: "case-1", feedbackId: "feedback-1" })
    expect(result.recipients.map((recipient) => recipient.id)).toEqual(["operator-1"])
  })

  it("materiais de apoio: o Output só repassa ao Feedback quando includeSupportMaterials = true; ausente/false (legado) publica sem materiais mesmo com recomendação do node de origem", async () => {
    const recommendation = { materialId: "11111111-1111-4111-8111-111111111111", title: "Técnicas de sondagem", reason: "Traz perguntas de sondagem para retenção por preço." }
    const agentResult = { kind: "monitoring", input: { organizationId: "org-1", operatorId: "operator-1" }, supportMaterials: [recommendation], supportMaterialsRejected: [{ materialId: "x", code: "MATERIAL_NOT_IN_CANDIDATES" }] }
    const { db } = fakeDb([
      { match: (sql) => sql.includes("from interactions"), rows: [{ operator_id: "operator-1" }] },
      { match: (sql) => sql.includes("select team_id from people"), rows: [{ team_id: "team-1" }] },
    ])
    const context = baseContext(db, { nodeOutputs: { agent: agentResult } })

    vi.mocked(createMonitoringFeedback).mockClear()
    await executeOutput({ target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.agent" }, context)
    expect(vi.mocked(createMonitoringFeedback).mock.calls[0]![1]).not.toHaveProperty("supportMaterials")

    vi.mocked(createMonitoringFeedback).mockClear()
    await executeOutput({ target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.agent", includeSupportMaterials: true }, context)
    expect(vi.mocked(createMonitoringFeedback).mock.calls[0]![1]).toMatchObject({ organizationId: "org-1", supportMaterials: [recommendation], supportMaterialsRejected: [{ materialId: "x", code: "MATERIAL_NOT_IN_CANDIDATES" }] })
  })

  it("Orquestrador → Revisão → Output include=true: a recomendação da síntese atravessa e chega ao Feedback; include=false não chega; upstream sem materiais funciona normalmente", async () => {
    const { db } = fakeDb([
      { match: (sql) => sql.includes("from interactions"), rows: [{ operator_id: "operator-1" }] },
      { match: (sql) => sql.includes("from people where id = $1"), rows: [{ team_id: "team-1" }] },
    ])
    const recommendation = { materialId: "22222222-2222-4222-8222-222222222222", title: "Checklist de Encerramento", reason: "Lista as confirmações do encerramento que faltaram." }
    const reply = { text: "síntese", agentId: null, calls: [], results: [], structuredResult: null, supportMaterialCandidates: [], supportMaterials: [recommendation], orchestratorId: "orch-1", orchestratorName: "Retenção" }
    const context = baseContext(db, { nodeOutputs: { orchestrator: reply, review: { decision: "APPROVED" } } })

    vi.mocked(createOrchestratorFeedback).mockClear()
    await executeOutput({ target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.orchestrator", includeSupportMaterials: true }, context)
    expect(vi.mocked(createOrchestratorFeedback).mock.calls[0]![1]).toMatchObject({ orchestratorName: "Retenção", supportMaterials: [recommendation] })

    vi.mocked(createOrchestratorFeedback).mockClear()
    await executeOutput({ target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.orchestrator", includeSupportMaterials: false }, context)
    expect(vi.mocked(createOrchestratorFeedback).mock.calls[0]![1]).not.toHaveProperty("supportMaterials")

    vi.mocked(createOrchestratorFeedback).mockClear()
    const emptyContext = baseContext(db, { nodeOutputs: { orchestrator: { ...reply, supportMaterials: undefined } } })
    const result = await executeOutput({ target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.orchestrator", includeSupportMaterials: true }, emptyContext)
    expect(result.nodeOutput.feedbackId).toBeTruthy()
    expect(vi.mocked(createOrchestratorFeedback).mock.calls[0]![1]).not.toHaveProperty("supportMaterials")
  })

  it("trace das ferramentas de investigação atravessa o Output até o Feedback (Agent direto no topo; Orquestrador pelos especialistas), independentemente de includeSupportMaterials", async () => {
    const trace = [{ sequence: 1, tool: "get_indicator_snapshot", label: "Consultar indicador", capability: "INDICATOR_ANALYSIS", argumentsSummary: {}, resultSummary: "TMA: 452 s", quality: null, provenance: null, status: "COMPLETED", startedAt: "", completedAt: "" }]
    const { db } = fakeDb([
      { match: (sql) => sql.includes("from interactions"), rows: [{ operator_id: "operator-1" }] },
      { match: (sql) => sql.includes("from people where id = $1"), rows: [{ team_id: "team-1" }] },
    ])
    const agentResult = { kind: "monitoring", input: { organizationId: "org-1", operatorId: "operator-1" }, toolTrace: trace, investigation: { toolCalls: 1, cachedCalls: 0, rejectedCalls: 0, budget: 10, outcome: "ANSWERED" } }
    vi.mocked(createMonitoringFeedback).mockClear()
    await executeOutput({ target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.agent" }, baseContext(db, { nodeOutputs: { agent: agentResult } }))
    expect(vi.mocked(createMonitoringFeedback).mock.calls[0]![1]).toMatchObject({ toolTrace: trace, investigation: { toolCalls: 1 } })

    const reply = { text: "síntese", agentId: null, calls: [], results: [{ agentId: "a", toolName: "t", text: "x", toolTrace: trace }], structuredResult: null, supportMaterialCandidates: [], orchestratorId: "orch-1", orchestratorName: "Retenção" }
    vi.mocked(createOrchestratorFeedback).mockClear()
    await executeOutput({ target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.orchestrator" }, baseContext(db, { nodeOutputs: { orchestrator: reply } }))
    expect(vi.mocked(createOrchestratorFeedback).mock.calls[0]![1]).toMatchObject({ toolTrace: trace })
  })

  it("resultado de Agent só vale na raiz de um nó \"Chamar agente\" e para a organização e o colaborador da matrícula", async () => {
    const { db } = fakeDb([
      { match: (sql) => sql.includes("from interactions"), rows: [{ operator_id: "operator-1" }] },
      { match: (sql) => sql.includes("select team_id from people"), rows: [{ team_id: "team-1" }] },
    ])
    const forged = { kind: "monitoring", input: { organizationId: "org-1", operatorId: "operator-1", structured: { evidenceFound: "trecho inventado" } } }
    const reply = { text: "síntese", orchestratorName: "Retenção", structuredResult: forged }
    vi.mocked(createMonitoringFeedback).mockClear()
    // Campo de um Orquestrador com o formato de resultado de Agent (nunca passou pela checagem literal).
    await expect(executeOutput({ target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.orchestrator.structuredResult" }, baseContext(db, { nodeOutputs: { orchestrator: reply } }))).rejects.toThrow(/não é o resultado de um nó "Chamar agente"/)
    // Nó que não é "Chamar agente", mesmo na raiz.
    await expect(executeOutput({ target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.review" }, baseContext(db, { nodeOutputs: { review: forged } }))).rejects.toThrow(/não é o resultado de um nó "Chamar agente"/)
    // Organização ou colaborador diferentes dos da matrícula.
    for (const input of [{ organizationId: "org-2", operatorId: "operator-1" }, { organizationId: "org-1", operatorId: "operator-2" }]) {
      await expect(executeOutput({ target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.agent" }, baseContext(db, { nodeOutputs: { agent: { kind: "monitoring", input } } }))).rejects.toThrow(/não pertence a esta execução/)
    }
    expect(createMonitoringFeedback).not.toHaveBeenCalled()
  })

  it("FOLLOW_UP + CURRENT_OPERATOR rejects content that isn't a publishable agent or orchestrator result", async () => {
    const { db } = fakeDb([{ match: (sql) => sql.includes("from interactions"), rows: [{ operator_id: "operator-1" }] }])
    const config: OutputNodeConfig = { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.agent" }
    const context = baseContext(db, { nodeOutputs: { agent: { text: "sem orchestratorName, não conta" } } })

    await expect(executeOutput(config, context)).rejects.toThrow(/não é um resultado de agente ou orquestrador publicável/)
  })

  it("FOLLOW_UP + CURRENT_OPERATOR publishes via createOrchestratorFeedback when the content comes from an Orchestrator node (regression: this used to always reject)", async () => {
    const { db } = fakeDb([
      { match: (sql) => sql.includes("from interactions"), rows: [{ operator_id: "operator-1" }] },
      { match: (sql) => sql.includes("from people where id = $1"), rows: [{ team_id: "team-1" }] },
    ])
    const config: OutputNodeConfig = { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.orchestrator" }
    const orchestratorReply = {
      text: "síntese do orquestrador",
      agentId: null,
      calls: [],
      results: [],
      structuredResult: { feedback: { text: "recomendação final" } },
      orchestratorId: "orch-1",
      orchestratorName: "TESTE - Orquestrador Monitoria Completa",
    }
    const context = baseContext(db, { nodeOutputs: { orchestrator: orchestratorReply } })

    const result = await executeOutput(config, context)

    expect(createOrchestratorFeedback).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        organizationId: "org-1",
        operatorId: "operator-1",
        teamId: "team-1",
        orchestratorName: "TESTE - Orquestrador Monitoria Completa",
        reply: orchestratorReply,
      }),
    )
    expect(result.nodeOutput).toEqual({ caseId: "case-3", feedbackId: "feedback-3" })
  })

  it("NOTIFICATION resolves the supervisor via reports_to_id and inserts an alert", async () => {
    const { db, calls } = fakeDb([
      { match: (sql) => sql.includes("from interactions"), rows: [{ operator_id: "operator-1" }] },
      // Cadeia real: operador-1 → supervisor-1 (a busca por cargo começa no gestor do operador).
      { match: (sql) => sql.includes("from people where id = $1") && calls.filter((call) => call.sql.includes("from people where id = $1")).length === 1, rows: [{ id: "operator-1", role: "OPERATOR", reports_to_id: "supervisor-1" }] },
      { match: (sql) => sql.includes("from people where id = $1"), rows: [{ id: "supervisor-1", role: "SUPERVISOR", reports_to_id: null }] },
      { match: (sql) => sql.includes("select name from people"), rows: [{ name: "Operador Um" }] },
      { match: (sql) => sql.includes("from workflow_enrollment_events"), rows: [] },
      { match: (sql) => sql.trim().startsWith("insert into alerts"), rows: [] },
    ])

    const config: OutputNodeConfig = { target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["NOTIFICATION"], source: "nodeOutputs.agent" }
    const context = baseContext(db, { nodeOutputs: { agent: { kind: "monitoring", input: {} } } })

    await executeOutput(config, context)

    const alertInsert = calls.find((call) => call.sql.trim().startsWith("insert into alerts"))
    expect(alertInsert).toBeDefined()
    expect(alertInsert!.params[2]).toBe("supervisor-1") // recipient_id
  })

  it("Workflow Outputs V1: AVATAR vira CONVITE (nenhuma fala) e CHAT uma conversa nova — a MESMA projeção do mesmo conteúdo", async () => {
    const { db, calls } = fakeDb([{ match: (sql) => sql.includes("from interactions"), rows: [{ operator_id: "operator-1" }] }])
    const conversational = {
      reliableProjectionSource: vi.fn(),
      deliverChat: vi.fn<(db: unknown, input: ConversationalDeliveryInput) => Promise<{ outputId: string; conversationId: string; reused: boolean }>>(async () => ({ outputId: "out-chat", conversationId: "conv-1", reused: false })),
      offerAvatar: vi.fn<(db: unknown, input: ConversationalDeliveryInput) => Promise<{ outputId: string; reused: boolean }>>(async () => ({ outputId: "out-avatar", reused: false })),
    }
    const config: OutputNodeConfig = { target: { type: "CURRENT_OPERATOR" }, surfaces: ["CHAT", "AVATAR"], interactionMode: "PROMPT", source: "nodeOutputs.orq" }
    const context = baseContext(db, {
      nodeLabel: "Resumo da semana",
      effects: { ...productionEffects, conversational },
      nodeOutputs: { orq: { text: "## Resumo\n\n- Você atendeu 42 chamadas.\n- **Destaque:** confirmação de entendimento.", orchestratorName: "Gerencial", agentId: null, calls: [], results: [], structuredResult: null } },
    })

    const result = await executeOutput(config, context)

    expect(conversational.deliverChat).toHaveBeenCalledTimes(1)
    expect(conversational.offerAvatar).toHaveBeenCalledTimes(1)
    const chat = conversational.deliverChat.mock.calls[0]![1]
    const avatar = conversational.offerAvatar.mock.calls[0]![1]
    expect(avatar.projection).toBe(chat.projection)
    expect(chat).toMatchObject({ recipientId: "operator-1", interactionMode: "PROMPT", artifactId: null })
    expect(chat.projection.title).toBe("Resumo da semana")
    expect(chat.projection.chatText).toContain("Você atendeu 42 chamadas.")
    // A fala nunca lê marcação.
    expect(chat.projection.speechText).not.toMatch(/[#*-]{1,2}\s|\*\*/)
    expect(chat.projection.speechText).toContain("Você atendeu 42 chamadas.")
    // Nenhum registro genérico sem consumidor para Chat/Avatar.
    expect(calls.some((call) => call.sql.trim().startsWith("insert into workflow_outputs"))).toBe(false)
    expect(result.nodeOutput).toMatchObject({ conversationIds: ["conv-1"], avatarDeliveryIds: ["out-avatar"] })
  })

  it("Workflow Outputs V1: conteúdo sem texto publicável falha o nó (nunca JSON cru no Chat/Avatar)", async () => {
    const { db } = fakeDb([{ match: (sql) => sql.includes("from interactions"), rows: [{ operator_id: "operator-1" }] }])
    const config: OutputNodeConfig = { target: { type: "CURRENT_OPERATOR" }, surfaces: ["AVATAR"], interactionMode: "PROMPT", source: "nodeOutputs.agent" }
    await expect(executeOutput(config, baseContext(db, { nodeOutputs: { agent: { kind: "monitoring", input: {} } } }))).rejects.toThrow(/não tem um texto publicável/)
  })

  it("INBOX continua gravando o registro genérico (idempotente pela chave de entrega)", async () => {
    const { db, calls } = fakeDb([{ match: (sql) => sql.includes("from interactions"), rows: [{ operator_id: "operator-1" }] }])
    const config: OutputNodeConfig = { target: { type: "CURRENT_OPERATOR" }, surfaces: ["INBOX"], interactionMode: "PROMPT", source: "nodeOutputs.agent" }
    await executeOutput(config, baseContext(db, { nodeOutputs: { agent: { kind: "monitoring", input: {} } } }))
    const insert = calls.find((call) => call.sql.trim().startsWith("insert into workflow_outputs"))
    expect(insert!.sql).toContain("on conflict (enrollment_id, node_id, surface, recipient_id) do nothing")
    expect(insert!.params).toEqual(["org-1", "enrollment-1", "output-1", "operator-1", "INBOX", "PROMPT", JSON.stringify({ kind: "monitoring", input: {} })])
  })
})

describe("executeOutput — entrega para gestão (FOLLOW_UP com destinatário que não é o operador)", () => {
  it("o alerta leva o rótulo do nó como título e a síntese do Orquestrador como descrição — nunca só 'um workflow gerou uma saída'", async () => {
    const { db, calls } = fakeDb([
      // Cadeia real: operador → supervisor-1 (a busca por cargo começa no gestor do operador).
      { match: (sql) => sql.includes("select id, role, reports_to_id from people") && calls.filter((call) => call.sql.includes("select id, role, reports_to_id from people")).length === 1, rows: [{ id: "operator-1", role: "OPERATOR", reports_to_id: "supervisor-1" }] },
      { match: (sql) => sql.includes("select id, role, reports_to_id from people"), rows: [{ id: "supervisor-1", role: "SUPERVISOR", reports_to_id: null }] },
      { match: (sql) => sql.includes("select name from people"), rows: [{ name: "Bruno" }] },
      { match: (sql) => sql.includes("from workflow_enrollment_events"), rows: [] },
    ])
    const config: OutputNodeConfig = { target: { type: "ROLE", role: "SUPERVISOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.orq" }
    const context = baseContext(db, {
      nodeLabel: "Resumo mensal ao Supervisor",
      enrollment: { interactionId: null, indicatorMeasurementId: null, scheduledSubjectId: "operator-1" },
      nodeOutputs: { orq: { text: "Três colaboradores abaixo da meta; priorizar Ana.", orchestratorName: "Gerencial", agentId: null, calls: [], results: [], structuredResult: null } },
    })

    await executeOutput(config, context)

    const insert = calls.find((call) => call.sql.includes("insert into alerts"))
    expect(insert).toBeDefined()
    expect(insert!.params[3]).toBe("Resumo mensal ao Supervisor")
    expect(insert!.params[4]).toBe("Três colaboradores abaixo da meta; priorizar Ana.")
    expect(insert!.params[2]).toBe("supervisor-1")
  })

  it("resultado consolidado cru (sem Orquestrador) vira uma contagem legível; conteúdo desconhecido cai na frase genérica", async () => {
    const { describeOutputContent } = await import("./output-executor.js")
    expect(describeOutputContent({ kind: "EMPLOYEE_FAN_IN", expectedCount: 4, completedCount: 3, failedCount: 1, children: [] })).toBe(
      "4 colaborador(es) analisado(s) — 3 concluído(s), 1 com falha.",
    )
    expect(describeOutputContent({ kind: "monitoring", input: { structured: { summary: "Resumo.", recommendation: "Recomende X." } } })).toBe("Resumo.\n\n**Recomendação:** Recomende X.")
    expect(describeOutputContent({ foo: "bar" })).toBeNull()
    expect(describeOutputContent(undefined)).toBeNull()
  })
})

describe("executeOutput — destinatário de gestão resolvido pela ESTRUTURA (matrícula raiz de Workflow Consolidado)", () => {
  const hierarchy = inMemoryHierarchyReader([
    { id: "manager-1", name: "Gerente Um", role: "MANAGER", reportsToId: null },
    { id: "manager-2", name: "Gerente Dois", role: "MANAGER", reportsToId: null },
    { id: "sup-1", name: "Sup Um", role: "SUPERVISOR", reportsToId: "manager-1" },
    { id: "sup-2", name: "Sup Dois", role: "SUPERVISOR", reportsToId: "manager-2" },
    { id: "zzz-op", name: "Op A", role: "OPERATOR", reportsToId: "sup-1", teamId: "team-1" },
    { id: "aaa-op", name: "Op B", role: "OPERATOR", reportsToId: "sup-2", teamId: "team-1" },
  ])

  it("Grupo com 2 Gerentes → falha do node com WORKFLOW_OUTPUT_RECIPIENT_AMBIGUOUS, sem gravar alerta pra ninguém", async () => {
    const { db, calls } = fakeDb([{ match: (sql) => sql.includes("from workflow_enrollment_events"), rows: [] }])
    const config: OutputNodeConfig = { target: { type: "ROLE", role: "MANAGER" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.orq" }
    // "aaa-op" seria o 'menor UUID' (sujeito técnico da matrícula) — a resolução nunca olha pra ele.
    const context = baseContext(db, {
      enrollment: { interactionId: null, indicatorMeasurementId: null, scheduledSubjectId: "aaa-op" },
      structure: { kind: "TEAM", teamId: "team-1" },
      hierarchy,
      nodeOutputs: { orq: { text: "síntese", orchestratorName: "Gerencial", agentId: null, calls: [], results: [], structuredResult: null } },
    })
    await expect(executeOutput(config, context)).rejects.toMatchObject({ code: "WORKFLOW_OUTPUT_RECIPIENT_AMBIGUOUS", details: { nodeId: "output-1" } })
    expect(calls.some((call) => call.sql.includes("insert into alerts"))).toBe(false)
  })

  it("Equipe de Supervisor + Output 'Gerente' → resolve pela cadeia da ÂNCORA e entrega, informando o destinatário resolvido", async () => {
    const { db, calls } = fakeDb([
      { match: (sql) => sql.includes("select id, name, role from people"), rows: [{ id: "manager-1", name: "Gerente Um", role: "MANAGER" }] },
      { match: (sql) => sql.includes("select name from people"), rows: [{ name: "Sup Um" }] },
      { match: (sql) => sql.includes("from workflow_enrollment_events"), rows: [] },
    ])
    const config: OutputNodeConfig = { target: { type: "ROLE", role: "MANAGER" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.orq" }
    const context = baseContext(db, {
      enrollment: { interactionId: null, indicatorMeasurementId: null, scheduledSubjectId: "sup-1" },
      structure: { kind: "SUPERVISOR_TEAM", supervisorId: "sup-1" },
      hierarchy,
      nodeOutputs: { orq: { text: "síntese", orchestratorName: "Gerencial", agentId: null, calls: [], results: [], structuredResult: null } },
    })
    const result = await executeOutput(config, context)
    expect(result.recipients).toEqual([{ id: "manager-1", name: "Gerente Um", role: "MANAGER" }])
    const insert = calls.find((call) => call.sql.includes("insert into alerts"))
    expect(insert!.params[2]).toBe("manager-1")
  })

  it("o operador que passou a ter o cargo pedido nunca é o destinatário: a busca começa no gestor dele (C16, 4ª auditoria)", async () => {
    const { db, calls } = fakeDb([
      { match: (sql) => sql.includes("from interactions"), rows: [{ operator_id: "operator-1" }] },
      // O próprio sujeito virou Supervisor depois de a execução começar; o gestor dele é o supervisor-9.
      { match: (sql) => sql.includes("select id, role, reports_to_id from people") && calls.filter((call) => call.sql.includes("select id, role, reports_to_id from people")).length === 1, rows: [{ id: "operator-1", role: "SUPERVISOR", reports_to_id: "supervisor-9" }] },
      { match: (sql) => sql.includes("select id, role, reports_to_id from people"), rows: [{ id: "supervisor-9", role: "SUPERVISOR", reports_to_id: null }] },
      { match: (sql) => sql.includes("from people where id = $1"), rows: [{ id: "supervisor-9", name: "Sara", role: "SUPERVISOR" }] },
    ])
    const result = await executeOutput({ target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["NOTIFICATION"], source: "nodeOutputs.agent" }, baseContext(db, { nodeOutputs: { agent: { kind: "monitoring", input: {} } } }))
    expect(result.recipients.map((recipient) => recipient.id)).toEqual(["supervisor-9"])
  })

  it("caminho individual: cargo ausente na cadeia do operador é ERRO (nunca alerta descartado em silêncio)", async () => {
    const { db, calls } = fakeDb([
      { match: (sql) => sql.includes("from interactions"), rows: [{ operator_id: "operator-1" }] },
      { match: (sql) => sql.includes("select id, role, reports_to_id from people"), rows: [{ id: "operator-1", role: "OPERATOR", reports_to_id: null }] },
    ])
    const config: OutputNodeConfig = { target: { type: "MANAGER_OF_OPERATOR" }, surfaces: ["NOTIFICATION"], source: "nodeOutputs.agent" }
    const context = baseContext(db, { nodeOutputs: { agent: { kind: "monitoring", input: {} } } })
    await expect(executeOutput(config, context)).rejects.toMatchObject({ code: "WORKFLOW_OUTPUT_RECIPIENT_NOT_FOUND" })
    await expect(executeOutput(config, context)).rejects.toThrow("Não foi possível determinar um Gerente na cadeia de gestão deste operador.")
    expect(calls.some((call) => call.sql.includes("insert into alerts"))).toBe(false)
  })
})
