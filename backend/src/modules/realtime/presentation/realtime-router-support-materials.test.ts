import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { answerAgentVersionQuery } from "../../agents/testing/agent-version-fakes.js"

/**
 * Chat e voz SEM Workflow: o Orquestrador (INTERACTIVE) responde ao operador e os materiais que ele
 * recomendou chegam à superfície e ficam persistidos junto da resposta — resolvidos pelo acesso do
 * DESTINATÁRIO (o operador da conversa), nunca pelo executor. Reabrir a conversa
 * (`/conversations/:id/messages`) devolve os mesmos materiais, revalidados na leitura.
 */
const resolveOrchestratorForSubject = vi.fn()
const runOrchestratedReply = vi.fn()
const runSpecialistTool = vi.fn()
vi.mock("../../assistant/application/resolve-orchestrator.js", () => ({
  resolveOrchestratorForSubject: (...args: unknown[]) => resolveOrchestratorForSubject(...args),
  findSpecialistByToolName: (orchestrator: { specialists: { toolName: string; agentId: string }[] }, toolName: string) => orchestrator.specialists.find((s) => s.toolName === toolName)?.agentId ?? null,
}))
vi.mock("../../assistant/application/run-orchestrated-reply.js", () => ({ runOrchestratedReply: (...args: unknown[]) => runOrchestratedReply(...args) }))
vi.mock("../../assistant/application/run-specialist-tool.js", () => ({ runSpecialistTool: (...args: unknown[]) => runSpecialistTool(...args) }))

const { createRealtimeRouter } = await import("./realtime-router.js")
const { createMemoryConversationStore } = await import("../../assistant/testing/memory-conversation-store.js")

// Organização da sessão — diferente da organização da instalação: Orquestrador e especialista recebem a da sessão.
const ORG = "00000000-0000-4000-8000-0000000000b2"
const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const INACTIVE_AGENT = "33333333-3333-4333-8333-333333333333"
const REASON = "Este material traz perguntas de sondagem para situações de retenção por preço."

const OPERATOR: AuthTokenPayload = { sub: "acc-1", personId: "person-1", organizationId: ORG, role: "OPERATOR", name: "Operador", email: "op@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }

type Call = { sql: string; params: unknown[] }

/** Banco falso: registra inserts de interação (com id sequencial), a relação persistida e
 * responde a consulta de acesso só com os ids em `accessible`. */
function fakeDb(accessible: Record<string, string>, agentOf: (agentId: string) => Record<string, unknown> | undefined = () => ({ active: true })) {
  const calls: Call[] = []
  const interactions: { id: string; role: string; content: string; agent_id: string | null }[] = []
  const stored: { interaction_id: string; knowledge_document_id: string; reason: string; position: number }[] = []
  let sequence = 0
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      // Versão vigente e autorização do especialista na hora da chamada (revisão da PEN-002/PEN-076): ativo e publicado.
      const versioned = answerAgentVersionQuery(sql, params, agentOf)
      if (versioned) return versioned
      calls.push({ sql, params })
      // Especialista configurado no Orquestrador (voz): a ferramenta agent_<id> é dele.
      if (sql.includes("from assistant_orchestrator_specialists s join agents a")) return { rows: [{ agent_id: INACTIVE_AGENT }], rowCount: 1 }
      if (sql.includes("insert into assistant_interactions")) {
        const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12, "0")}`
        interactions.push({ id, role: params[3] as string, content: params[4] as string, agent_id: (params[5] as string | null) ?? null })
        return { rows: [{ id }], rowCount: 1 }
      }
      if (sql.includes("insert into assistant_interaction_support_materials")) {
        stored.push({ interaction_id: params[1] as string, knowledge_document_id: params[2] as string, reason: params[4] as string, position: params[5] as number })
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes("from knowledge_documents d")) {
        const requested = params[3] as string[]
        return { rows: requested.filter((id) => accessible[id]).map((id) => ({ id, title: accessible[id], documentType: "PROCEDURE", sourceType: "TEXT" })), rowCount: 0 }
      }
      if (sql.includes("from assistant_interaction_support_materials")) return { rows: stored, rowCount: stored.length }
      if (sql.includes("from assistant_interactions")) return { rows: interactions.map((row) => ({ ...row, channel: "chat", created_at: "2026-09-17T12:00:00.000Z" })), rowCount: interactions.length }
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Database
  return { db, calls, interactions, stored }
}

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next
  if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
  res.status(500).json({ error: { message: (error as Error).message } })
}

let memory = createMemoryConversationStore()
const MSG = (text: string, key = "11111111-aaaa-4aaa-8aaa-000000000001") => ({ conversationId: null, text, clientMessageId: key, systemInstruction: "persona" })
const TOOL = (query: string) => ({ toolName: "consultar_retencao", query, conversationId: null, turnId: "voice-turn-0001", callId: "call-1" })
const assistantMessage = () => memory.messages.find((m) => m.role === "assistant")!

function appWith(db: Database) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = OPERATOR
    next()
  })
  app.use("/api/v1/realtime", createRealtimeRouter(db, async () => ({ token: "t", model: "m" }) as never, async () => {}, { conversations: memory.store }))
  app.use(errorHandler)
  return app
}

const orchestrator = (recommend: boolean) => ({ orchestratorId: "orch-1", orchestratorName: "INIA", orchestratorAgentId: "agent-orch", systemPrompt: "x", specialists: [{ agentId: "agent-a", toolName: "consultar_retencao" }], tools: [], outputInstructions: null, structuredOutput: null, recommendSupportMaterials: recommend })

beforeEach(() => {
  memory = createMemoryConversationStore()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  resolveOrchestratorForSubject.mockReset()
  runOrchestratedReply.mockReset()
  runSpecialistTool.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe("chat de texto — materiais recomendados pelo Orquestrador, sem Workflow", () => {
  it("ON: a resposta chega com o evento support_materials (título real, motivo), é persistida na interação e reaparece ao reabrir (/history)", async () => {
    const { db, stored } = fakeDb({ [A]: "Técnicas de sondagem em retenção" })
    resolveOrchestratorForSubject.mockResolvedValue(orchestrator(true))
    runOrchestratedReply.mockResolvedValue({
      text: "Aprofunde a sondagem antes da oferta.",
      agentId: "agent-a",
      calls: [{ toolName: "consultar_retencao", query: "q" }],
      results: [],
      structuredResult: null,
      supportMaterialCandidates: [{ materialId: A, title: "Técnicas de sondagem em retenção" }, { materialId: B, title: "Outro" }],
      supportMaterials: [
        { materialId: A, title: "Técnicas de sondagem em retenção", reason: REASON },
        { materialId: B, title: "Outro", reason: REASON }, // fora do alcance do operador → cai na persistência
      ],
    })

    const response = await request(appWith(db)).post("/api/v1/realtime/messages").send(MSG("como reter?"))
    expect(response.status).toBe(200)
    expect(response.text).toContain('event: chunk\ndata: {"text":"Aprofunde a sondagem antes da oferta."}')
    const materialsEvent = /event: support_materials\ndata: (.*)\n/.exec(response.text)
    expect(materialsEvent).not.toBeNull()
    const payload = JSON.parse(materialsEvent![1]!) as { interactionId: string; supportMaterials: unknown[] }
    expect(payload.supportMaterials).toEqual([{ materialId: A, available: true, title: "Técnicas de sondagem em retenção", reason: REASON }])
    expect(response.text.indexOf("event: support_materials")).toBeLessThan(response.text.indexOf("event: done"))
    expect(response.text).not.toContain("/materiais/")
    expect(response.text).not.toContain(B)

    // Persistido ligado à resposta do assistente (proveniência: interação + orquestrador).
    const assistantInteraction = assistantMessage()
    expect(stored).toEqual([{ interaction_id: assistantInteraction.id, knowledge_document_id: A, reason: REASON, position: 0 }])
    expect(payload.interactionId).toBe(assistantInteraction.id)

    // Reabrir: mesmos materiais, revalidados pelo acesso atual.
    const history = await request(appWith(db)).get(`/api/v1/realtime/conversations/${assistantInteraction.conversationId}/messages`)
    expect(history.status).toBe(200)
    const turns = history.body.data.messages as { role: string; content: string; supportMaterials: unknown[] }[]
    expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant"])
    expect(turns[1]?.supportMaterials).toEqual([{ materialId: A, available: true, title: "Técnicas de sondagem em retenção", reason: REASON }])
    expect(turns[0]?.supportMaterials).toEqual([])
  })

  it("OFF: o Orquestrador responde normalmente e nenhum material é mostrado nem persistido", async () => {
    const { db, stored } = fakeDb({ [A]: "Técnicas de sondagem em retenção" })
    resolveOrchestratorForSubject.mockResolvedValue(orchestrator(false))
    runOrchestratedReply.mockResolvedValue({ text: "Resposta normal.", agentId: null, calls: [], results: [], structuredResult: null, supportMaterialCandidates: [{ materialId: A, title: "x" }] })

    const response = await request(appWith(db)).post("/api/v1/realtime/messages").send(MSG("oi"))
    expect(response.text).toContain("event: chunk")
    expect(response.text).not.toContain("support_materials")
    expect(stored).toEqual([])
  })

  it("material despublicado/fora do alcance depois: reabrir mostra o marcador neutro, sem título", async () => {
    const accessible: Record<string, string> = { [A]: "Técnicas de sondagem em retenção" }
    const { db } = fakeDb(accessible)
    resolveOrchestratorForSubject.mockResolvedValue(orchestrator(true))
    runOrchestratedReply.mockResolvedValue({ text: "R.", agentId: null, calls: [], results: [], structuredResult: null, supportMaterialCandidates: [], supportMaterials: [{ materialId: A, title: "Técnicas de sondagem em retenção", reason: REASON }] })
    await request(appWith(db)).post("/api/v1/realtime/messages").send(MSG("?"))
    delete accessible[A]
    const history = await request(appWith(db)).get(`/api/v1/realtime/conversations/${assistantMessage().conversationId}/messages`)
    const assistant = (history.body.data.messages as { role: string; supportMaterials: unknown[] }[]).find((turn) => turn.role === "assistant")!
    expect(assistant.supportMaterials).toEqual([{ materialId: A, available: false }])
    expect(JSON.stringify(assistant.supportMaterials)).not.toContain("Técnicas de sondagem")
  })
})

describe("voz — tool-call do especialista", () => {
  it("ON: o especialista roda com seleção (selectSupportMaterials), o card volta ao cliente e o texto para o modelo ganha a instrução de mencionar o apoio na tela — nunca URL", async () => {
    const { db, stored } = fakeDb({ [A]: "Técnicas de sondagem em retenção" })
    resolveOrchestratorForSubject.mockResolvedValue(orchestrator(true))
    runSpecialistTool.mockResolvedValue({ contract: "TEXT", text: "Resposta do especialista.", knowledge: {}, supportMaterialCandidates: [{ materialId: A, title: "x" }], supportMaterials: [{ materialId: A, title: "Técnicas de sondagem em retenção", reason: REASON }] })

    const response = await request(appWith(db)).post("/api/v1/realtime/tool-call").send(TOOL("como reter?"))
    expect(response.status).toBe(200)
    expect(runSpecialistTool.mock.calls[0]![1]).toBe(ORG)
    expect(resolveOrchestratorForSubject.mock.calls[0]![1]).toBe(ORG)
    expect(runSpecialistTool.mock.calls[0]![7]).toEqual({ selectSupportMaterials: true, collaboratorConversation: true })
    expect(response.body.data.text).toBe("Resposta do especialista.")
    expect(response.body.data.supportMaterials).toEqual([{ materialId: A, available: true, title: "Técnicas de sondagem em retenção", reason: REASON }])
    expect(response.body.data.modelText).toContain("Resposta do especialista.")
    expect(response.body.data.modelText).toContain('"Técnicas de sondagem em retenção"')
    expect(response.body.data.modelText).toMatch(/Nunca leia, invente ou soletre links ou URLs/)
    expect(response.body.data.modelText).not.toMatch(/https?:\/\//)
    expect(stored).toHaveLength(1)
    // A resposta do especialista fica na conversa (criada pela voz) e o cliente recebe o id para adotar.
    expect(response.body.data.conversationId).toBe(assistantMessage().conversationId)
    expect(assistantMessage()).toMatchObject({ channel: "voice", role: "assistant", content: "Resposta do especialista." })
  })

  it("PEN-070 na voz: especialista desativado depois de a sessão começar não roda; a pessoa ouve que a parte está indisponível e o registro guarda 'Agente inativo'", async () => {
    const { db } = fakeDb({}, (agentId) => (agentId === INACTIVE_AGENT ? { active: false } : { active: true }))
    // A resolução de agora já não traz o especialista (inativo); a sessão do Gemini Live ainda tem a ferramenta dele.
    resolveOrchestratorForSubject.mockResolvedValue({ ...orchestrator(false), specialists: [] })
    const toolName = `agent_${INACTIVE_AGENT.replace(/-/g, "")}`
    const response = await request(appWith(db)).post("/api/v1/realtime/tool-call").send({ ...TOOL("quanto custa?"), toolName })
    expect(response.status).toBe(200)
    expect(runSpecialistTool).not.toHaveBeenCalled()
    expect(response.body.data.text).toBe("Esta parte do pedido está indisponível no momento. Posso ajudar com outra coisa?")
    expect(response.body.data.text).not.toMatch(/inativo|agente|especialista/i)
    const saved = memory.messages.find((message) => message.role === "assistant")!
    expect(saved.toolCalls).toEqual([expect.objectContaining({ toolName, agentId: INACTIVE_AGENT, outcome: "BLOCKED_INACTIVE", orchestratorId: "orch-1" })])
  })

  it("revisão de 03/11/2026 na voz: versão vigente do especialista não autorizada para o alcance do Orquestrador → não roda, registro 'acesso não autorizado'", async () => {
    const { db } = fakeDb({}, () => ({ active: true, scope_type: "TEAM", team_id: "44444444-4444-4444-8444-444444444444" }))
    resolveOrchestratorForSubject.mockResolvedValue({ ...orchestrator(false), consumerScope: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null } })
    const response = await request(appWith(db)).post("/api/v1/realtime/tool-call").send(TOOL("como reter?"))
    expect(response.status).toBe(200)
    expect(runSpecialistTool).not.toHaveBeenCalled()
    expect(response.body.data.text).toBe("Esta parte do pedido está indisponível no momento. Posso ajudar com outra coisa?")
    expect(memory.messages.find((message) => message.role === "assistant")!.toolCalls).toEqual([expect.objectContaining({ agentId: "agent-a", outcome: "BLOCKED_UNAUTHORIZED" })])
  })

  it("OFF: o especialista roda sem seleção e a resposta não carrega materiais", async () => {
    const { db, stored } = fakeDb({ [A]: "x" })
    resolveOrchestratorForSubject.mockResolvedValue(orchestrator(false))
    runSpecialistTool.mockResolvedValue({ contract: "TEXT", text: "Resposta.", knowledge: {}, supportMaterialCandidates: [{ materialId: A, title: "x" }] })
    const response = await request(appWith(db)).post("/api/v1/realtime/tool-call").send(TOOL("?"))
    expect(runSpecialistTool.mock.calls[0]![7]).toEqual({ selectSupportMaterials: false, collaboratorConversation: true })
    expect(response.body.data.supportMaterials).toEqual([])
    expect(response.body.data.text).toBe("Resposta.")
    // Sem materiais: só a instrução de fala fiel (mesmo conteúdo da tela, sem ler estrutura), nada sobre apoio.
    expect(response.body.data.modelText).toMatch(/^Resposta\.\n\n\[Instrução para a resposta falada:/)
    expect(response.body.data.modelText).toMatch(/MESMO conteúdo/)
    expect(response.body.data.modelText).toMatch(/Não leia títulos/)
    expect(response.body.data.modelText).not.toMatch(/material de apoio/)
    expect(stored).toEqual([])
  })
})
