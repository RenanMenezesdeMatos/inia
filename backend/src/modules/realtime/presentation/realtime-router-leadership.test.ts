import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import type { OrchestrationConversationHooks, runOrchestratedReply } from "../../assistant/application/run-orchestrated-reply.js"
import type { LeadershipChatContext } from "../../leadership-analytics/application/leadership-context.js"
import type { VoiceSessionConfig } from "../domain/voice-session.js"
import { INIA_CHAT_PERSONA, createRealtimeRouter, orchestratedToolCalls } from "./realtime-router.js"

/**
 * INIA PARA LIDERANÇAS (2026-10-15): quem tem escopo de liderança recebe, no chat de texto, as ferramentas determinísticas do
 * backend junto dos especialistas; o cartão de dados chega por evento próprio, fica gravado com a resposta e é revalidado contra o
 * escopo atual ao reabrir a conversa. Quem não tem escopo (operador) segue exatamente como antes.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const LEADER = "bbbbbbbb-0000-4000-8000-000000000001"
const leader: AuthTokenPayload = { sub: "acc-l", personId: LEADER, organizationId: ORG, role: "COORDINATOR", name: "Carla", email: "c@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
const emptyDb = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next
  if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code } })
  res.status(500).json({ error: { message: (error as Error).message } })
}
const orchestrator = { organizationId: ORG, orchestratorId: "orch-1", orchestratorName: "INIA", orchestratorAgentId: "agent-orch", systemPrompt: "PROMPT DO ORQUESTRADOR", specialists: [], tools: [], outputInstructions: null, structuredOutput: null, recommendSupportMaterials: false }
const CARD = { type: "PEOPLE", structure: { subject: { kind: "COORDINATOR_STRUCTURE", coordinatorId: LEADER }, label: "Carla", description: null }, periodLabel: "Agosto 2026", filter: { label: "Fora da referência em TMA" }, total: 9 }
const LEADERSHIP: LeadershipChatContext = {
  instructions: "[CONTEXTO DE LIDERANÇA]",
  voiceInstructions: "[VOZ DA LIDERANÇA]",
  toolset: { declarations: [{ name: "leadership_indicator_analysis", description: "x", parameters: { type: "object", properties: {} } }], handles: () => true, execute: async () => ({ text: "fatos", card: CARD as never }) },
}

function parseSse(text: string): { event: string; data: unknown }[] {
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("event:"))
    .map((block) => {
      const [eventLine, dataLine] = block.split("\n")
      return { event: eventLine!.slice("event: ".length), data: JSON.parse(dataLine!.slice("data: ".length)) }
    })
}

function setup(options: { withOrchestrator?: boolean; leadership?: LeadershipChatContext | null; visible?: boolean } = {}) {
  const memory = createMemoryConversationStore()
  const sessions: VoiceSessionConfig[] = []
  const calls: { orchestratorId: string; systemPrompt: string; extraContext: string; hooks: OrchestrationConversationHooks; history: { role: string; text: string }[] }[] = []
  const reply: typeof runOrchestratedReply = async (_db, resolved, history, extraContext, _operatorId, _options, _fastPath, hooks = {}) => {
    calls.push({ orchestratorId: resolved.orchestratorId, systemPrompt: resolved.systemPrompt, extraContext, hooks, history })
    const direct = hooks.directTools ? [{ toolName: "leadership_indicator_analysis", args: { indicador: "TMA" }, card: CARD }] : undefined
    return { text: "9 de 23 fora em TMA.", agentId: null, calls: direct ? [{ toolName: "leadership_indicator_analysis", query: "{}" }] : [], results: [], structuredResult: null, supportMaterialCandidates: [], ...(direct ? { directResults: direct } : {}) }
  }
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = leader; next() })
  app.use(
    "/api/v1/realtime",
    createRealtimeRouter(emptyDb, async (config) => { sessions.push(config); return { wsUrl: "wss://x", model: "m", expiresAt: "" } }, async (_history, _instruction, onChunk) => onChunk("genérico"), {
      conversations: memory.store,
      now: () => new Date("2026-10-15T12:00:00.000Z"),
      resolveOrchestrator: async () => (options.withOrchestrator === false ? null : (orchestrator as never)),
      orchestratedReply: reply,
      conversationGuardrails: async () => "\n\nLIMITES",
      leadershipContext: async () => (options.leadership === undefined ? LEADERSHIP : options.leadership),
      visibleLeadershipCards: async (_user, cards) => (options.visible === false ? [] : cards),
    }),
  )
  app.use(errorHandler)
  const send = () => request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Qual % do meu time está fora em TMA?", clientMessageId: "33333333-aaaa-4aaa-8aaa-000000000001" })
  return { app, memory, calls, send, sessions }
}

describe("chat da INIA para lideranças", () => {
  it("quem lidera: camada da liderança (não o Orquestrador do Grupo do cadastro) com as ferramentas; cartão por evento e gravado", async () => {
    const { app, calls, send } = setup()
    const response = await send()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.orchestratorId).toBe("")
    expect(calls[0]!.hooks.directTools).toBe(LEADERSHIP.toolset)
    expect(calls[0]!.systemPrompt).toContain("[CONTEXTO DE LIDERANÇA]")
    expect(calls[0]!.systemPrompt.endsWith("LIMITES")).toBe(true)
    const events = parseSse(response.text)
    const analytics = events.find((entry) => entry.event === "analytics")
    expect(analytics?.data).toMatchObject({ cards: [CARD] })
    expect(events.map((entry) => entry.event)).toEqual(["conversation", "chunk", "persisted", "analytics", "done"])

    const conversationId = (events[0]!.data as { conversationId: string }).conversationId
    const messages = await request(app).get(`/api/v1/realtime/conversations/${conversationId}/messages`)
    const assistant = messages.body.data.messages.find((message: { role: string }) => message.role === "assistant")
    expect(assistant.analytics).toEqual([CARD])
  })

  it("ao reabrir, cartão que o escopo atual não alcança não volta (o texto continua)", async () => {
    const { app, send } = setup({ visible: false })
    const events = parseSse((await send()).text)
    const conversationId = (events[0]!.data as { conversationId: string }).conversationId
    const messages = await request(app).get(`/api/v1/realtime/conversations/${conversationId}/messages`)
    const assistant = messages.body.data.messages.find((message: { role: string }) => message.role === "assistant")
    expect(assistant.content).toBe("9 de 23 fora em TMA.")
    expect(assistant.analytics).toEqual([])
  })

  it("sem Orquestrador configurado, quem lidera ainda consulta a estrutura (só as ferramentas do backend + assuntos proibidos)", async () => {
    const { calls, send } = setup({ withOrchestrator: false })
    const events = parseSse((await send()).text)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.orchestratorId).toBe("")
    expect(calls[0]!.systemPrompt.startsWith(INIA_CHAT_PERSONA)).toBe(true)
    expect(calls[0]!.systemPrompt).toContain("[CONTEXTO DE LIDERANÇA]")
    expect(calls[0]!.systemPrompt.endsWith("LIMITES")).toBe(true)
    expect(events.some((entry) => entry.event === "analytics")).toBe(true)
  })

  it("sem escopo de liderança, nada muda: nenhuma ferramenta direta, nenhum contexto de liderança", async () => {
    const { calls, send } = setup({ leadership: null })
    const events = parseSse((await send()).text)
    expect(calls[0]!.hooks.directTools).toBeUndefined()
    expect(calls[0]!.extraContext).not.toContain("LIDERANÇA")
    expect(events.some((entry) => entry.event === "analytics")).toBe(false)
  })

  it("voz (resposta padrão também ao que é digitado): a sessão só encaminha — uma ferramenta, leadership_ask, e o contexto da voz", async () => {
    const { app, sessions } = setup()
    await request(app).post("/api/v1/realtime/sessions").send({})
    expect((sessions[0]!.tools as { name: string }[]).map((tool) => tool.name)).toEqual(["leadership_ask"])
    expect(sessions[0]!.systemInstruction).toContain("[VOZ DA LIDERANÇA]")
  })

  it("voz: leadership_ask roda a MESMA orquestração do chat (camada da liderança) e devolve a resposta completa e o cartão", async () => {
    const { app, calls } = setup()
    const response = await request(app)
      .post("/api/v1/realtime/tool-call")
      .send({ toolName: "leadership_ask", query: "Como melhorar a reincidência da minha estrutura?", conversationId: null, turnId: "voice-1-2", callId: "call-9" })
    expect(response.status).toBe(200)
    expect(calls[0]!.orchestratorId).toBe("")
    expect(calls[0]!.hooks.directTools).toBe(LEADERSHIP.toolset)
    expect(calls[0]!.systemPrompt).toContain("[CONTEXTO DE LIDERANÇA]")
    expect(calls[0]!.history.at(-1)).toEqual({ role: "user", text: "Como melhorar a reincidência da minha estrutura?" })
    expect(response.body.data).toMatchObject({ text: "9 de 23 fora em TMA.", analytics: [CARD] })
    expect(response.body.data.modelText).toContain("fale um resumo".replace("fale", "Fale"))
    const messages = await request(app).get(`/api/v1/realtime/conversations/${response.body.data.conversationId as string}/messages`)
    expect(messages.body.data.messages[0]).toMatchObject({ role: "assistant", channel: "voice", content: "9 de 23 fora em TMA.", analytics: [CARD] })
  })

  it("voz: a ferramenta roda no backend, grava um resumo com o cartão e devolve o cartão à tela e os fatos ao modelo", async () => {
    const { app } = setup()
    const response = await request(app)
      .post("/api/v1/realtime/tool-call")
      .send({ toolName: "leadership_indicator_analysis", query: JSON.stringify({ indicador: "TMA" }), conversationId: null, turnId: "voice-1-1", callId: "call-1" })
    expect(response.status).toBe(200)
    expect(response.body.data.analytics).toEqual([CARD])
    expect(response.body.data.modelText).toContain("fatos")
    const conversationId = response.body.data.conversationId as string
    const messages = await request(app).get(`/api/v1/realtime/conversations/${conversationId}/messages`)
    expect(messages.body.data.messages[0]).toMatchObject({ role: "assistant", channel: "voice", content: "Fora da referência em TMA — Carla · Agosto 2026: 9 pessoas.", analytics: [CARD] })
  })

  it("voz sem escopo de liderança: a ferramenta não existe para a pessoa", async () => {
    const { app, sessions } = setup({ leadership: null })
    await request(app).post("/api/v1/realtime/sessions").send({})
    expect((sessions[0]!.tools as { name: string }[]).map((tool) => tool.name)).not.toContain("leadership_ask")
    const response = await request(app).post("/api/v1/realtime/tool-call").send({ toolName: "leadership_people", query: "{}", conversationId: null, turnId: "voice-1-1", callId: "call-1" })
    expect(response.status).toBe(404)
  })

  it("a mesma ferramenta acionada duas vezes no turno grava cada chamada com os SEUS argumentos e o SEU cartão", () => {
    const reincidencia = { ...CARD, filter: { label: "Reincidência" } }
    const tma = { ...CARD, filter: { label: "TMA" } }
    const calls = orchestratedToolCalls({
      text: "x", agentId: null, results: [], structuredResult: null, supportMaterialCandidates: [],
      calls: [{ toolName: "leadership_indicator_analysis", query: "a" }, { toolName: "agent_kb", query: "b" }, { toolName: "leadership_indicator_analysis", query: "c" }],
      directResults: [{ toolName: "leadership_indicator_analysis", args: { indicador: "Reincidência" }, card: reincidencia }, { toolName: "leadership_indicator_analysis", args: { indicador: "TMA" }, card: tma }],
    }) as { args?: unknown; analytics?: unknown; toolTrace?: unknown }[]
    expect(calls.map((call) => call.args)).toEqual([{ indicador: "Reincidência" }, undefined, { indicador: "TMA" }])
    expect(calls.map((call) => call.analytics)).toEqual([reincidencia, undefined, tma])
    expect(calls[1]!.toolTrace).toEqual([])
  })

  describe("consulta de processo pelo Orquestrador do Grupo da dúvida", () => {
    const PROCESS_SCOPE = {
      groups: [{ teamId: "team-atd", name: "B2C · Atendimento Geral" }, { teamId: "team-fat", name: "B2C · Faturamento" }],
      groupsOfStructure: () => ({ kind: "NOT_FOUND" as const, message: "x" }),
    }
    const ORCHESTRATORS = [
      { id: "orch-fat", name: "INIA Faturamento", scopeType: "TEAM" as const, teamId: "team-fat" },
      { id: "orch-all", name: "INIA Geral", scopeType: "ALL_TEAMS" as const, teamId: null },
    ]

    function processSetup(processArgs: Record<string, unknown>) {
      const memory = createMemoryConversationStore()
      const calls: { orchestratorId: string; systemPrompt: string; extraContext: string; options: Record<string, unknown>; history: { role: string; text: string }[]; hooks: OrchestrationConversationHooks }[] = []
      const resolvedById: string[] = []
      const reply: typeof runOrchestratedReply = async (_db, resolved, history, extraContext, _operatorId, options = {}, _fastPath, hooks = {}) => {
        calls.push({ orchestratorId: resolved.orchestratorId, systemPrompt: resolved.systemPrompt, extraContext, options: options as Record<string, unknown>, history, hooks })
        if (resolved.orchestratorId !== "") {
          // O Orquestrador do Grupo: responde com o especialista dele.
          return { text: `Procedimento do ${resolved.orchestratorName}.`, agentId: "agent-kb", calls: [{ toolName: "agent_kb", query: "q" }], results: [], structuredResult: null, supportMaterialCandidates: [] }
        }
        // Camada da liderança: o modelo aciona a consulta de processo (como faria o runOrchestratedReply real).
        const outcome = await hooks.directTools!.execute("leadership_process", processArgs)
        return { text: "Resposta final da liderança.", agentId: null, calls: [{ toolName: "leadership_process", query: JSON.stringify(processArgs) }], results: [], structuredResult: null, supportMaterialCandidates: [], directResults: [{ toolName: "leadership_process", args: processArgs, card: outcome.card, ...(outcome.trace ? { trace: outcome.trace } : {}) }] }
      }
      const app = express()
      app.use(express.json())
      app.use((req, _res, next) => { req.user = leader; next() })
      app.use(
        "/api/v1/realtime",
        createRealtimeRouter(emptyDb, async () => ({ wsUrl: "wss://x", model: "m", expiresAt: "" }), async () => undefined, {
          conversations: memory.store,
          now: () => new Date("2026-10-16T12:00:00.000Z"),
          resolveOrchestrator: async () => (orchestrator as never),
          orchestratedReply: reply,
          conversationGuardrails: async () => "\n\nLIMITES",
          leadershipContext: async () => ({ ...LEADERSHIP, processScope: PROCESS_SCOPE }),
          visibleLeadershipCards: async (_user, cards) => cards,
          processOrchestrators: async () => ORCHESTRATORS,
          orchestratorById: async (_org, id) => {
            resolvedById.push(id)
            return { ...(orchestrator as never as Record<string, unknown>), orchestratorId: id, orchestratorName: ORCHESTRATORS.find((item) => item.id === id)!.name } as never
          },
        }),
      )
      app.use(errorHandler)
      return { app, memory, calls, resolvedById }
    }

    it("texto: o Grupo citado decide o Orquestrador; a pergunta chega com a moldura de liderança e o registro grava quem respondeu", async () => {
      const { app, memory, calls, resolvedById } = processSetup({ pergunta: "Como orientar a equipe na contestação?", grupo: "B2C · Faturamento" })
      const response = await request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Como orientar o Faturamento na contestação?", clientMessageId: "33333333-aaaa-4aaa-8aaa-000000000009" })
      expect(resolvedById).toEqual(["orch-fat"])
      // Camada da liderança primeiro (sem Orquestrador de Grupo), depois o do Grupo citado.
      expect(calls.map((call) => call.orchestratorId)).toEqual(["", "orch-fat"])
      expect(calls[0]!.hooks.directTools!.declarations.map((declaration) => declaration.name)).toEqual(["leadership_process", "leadership_indicator_analysis"])
      expect(calls[1]!.history).toEqual([{ role: "user", text: "Como orientar a equipe na contestação?" }])
      // Contexto no prompt do Orquestrador do Grupo, nunca como contexto extra (que os especialistas tratariam como transcrição).
      expect(calls[1]!.extraContext).toBe("")
      expect(calls[1]!.systemPrompt).toContain("Consulta de processo da liderança")
      expect(calls[1]!.options).toMatchObject({ collaboratorConversation: true, conversationFrame: expect.stringContaining("do Grupo B2C · Faturamento") })
      const events = parseSse(response.text)
      const conversationId = (events[0]!.data as { conversationId: string }).conversationId
      const turns = await request(app).get(`/api/v1/realtime/conversations/${conversationId}/messages`)
      const assistant = turns.body.data.messages.find((message: { role: string }) => message.role === "assistant")
      expect(assistant.content).toBe("Resposta final da liderança.")
      // Auditável no histórico: qual Orquestrador de Grupo respondeu e com quais especialistas.
      const saved = memory.messages.find((message) => message.role === "assistant")!
      expect(saved.toolCalls).toEqual([expect.objectContaining({ toolName: "leadership_process", trace: { groups: ["B2C · Faturamento"], orchestratorId: "orch-fat", orchestratorName: "INIA Faturamento", specialists: ["agent_kb"], agentId: "agent-kb" } })])
    })

    it("Grupos com bases diferentes e nenhuma pista: nenhum Orquestrador de Grupo é chamado (a ferramenta devolve a pergunta de volta)", async () => {
      const { app, calls, resolvedById } = processSetup({ pergunta: "Como funciona a contestação?" })
      await request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Como funciona a contestação?", clientMessageId: "33333333-aaaa-4aaa-8aaa-000000000010" })
      expect(resolvedById).toEqual([])
      expect(calls.map((call) => call.orchestratorId)).toEqual([""])
    })

    it("voz: leadership_ask usa o mesmo caminho (Orquestrador do Grupo da equipe citada)", async () => {
      const { app, calls, resolvedById } = processSetup({ pergunta: "Qual o procedimento de segunda via?", grupo: "atendimento geral" })
      const response = await request(app).post("/api/v1/realtime/tool-call").send({ toolName: "leadership_ask", query: "Qual o procedimento de segunda via no Atendimento Geral?", conversationId: null, turnId: "voice-9-1", callId: "call-1" })
      expect(response.status).toBe(200)
      expect(resolvedById).toEqual(["orch-all"])
      expect(calls.map((call) => call.orchestratorId)).toEqual(["", "orch-all"])
      expect(response.body.data.text).toBe("Resposta final da liderança.")
    })
  })

  it("o registro da chamada grava o trace da ferramenta direta (qual Orquestrador de Grupo respondeu)", () => {
    const recorded = orchestratedToolCalls({
      text: "x", agentId: null, results: [], structuredResult: null, supportMaterialCandidates: [],
      calls: [{ toolName: "leadership_process", query: "{}" }],
      directResults: [{ toolName: "leadership_process", args: { pergunta: "p" }, card: null, trace: { orchestratorId: "orch-fat", orchestratorName: "INIA Faturamento", groups: ["B2C · Faturamento"] } }],
    }) as { trace?: unknown }[]
    expect(recorded[0]!.trace).toEqual({ orchestratorId: "orch-fat", orchestratorName: "INIA Faturamento", groups: ["B2C · Faturamento"] })
  })
})
