import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import type { OrchestrationConversationHooks, runOrchestratedReply } from "../../assistant/application/run-orchestrated-reply.js"
import { visibleCards } from "../../leadership-analytics/application/leadership-context.js"
import { loadSelfChatContext, SELF_RESPONSE_RULES, SELF_VOICE_RULES, type SelfChatContext } from "../../leadership-analytics/application/self-context.js"
import type { LeadershipCard, QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import { CLOSURE, leaderUser, leadershipOrg, operatorsOf } from "../../leadership-analytics/testing/leadership-fixture.js"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { indicatorRow, InMemoryAnalyticsRepository } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import type { VoiceSessionConfig } from "../domain/voice-session.js"
import { createRealtimeRouter } from "./realtime-router.js"

/**
 * VOZ DO OPERADOR (2026-10-16): o mesmo padrão da liderança — a sessão declara UMA ferramenta, `self_ask`, e o `/tool-call` roda
 * no backend a MESMA orquestração do chat de texto ("meus resultados" + especialistas). Antes o Live chamava `my_results` e o
 * especialista separados, e o texto do especialista não via os números ("não há definição de qual é o pior"). Sessões de
 * "Ouvir com a INIA" (aplicação de feedback) continuam com os especialistas e a moldura do registro.
 */
const ME = operatorsOf(4)[0]!
const operator = leaderUser(ME, "OPERATOR")
const emptyDb = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
const timezoneDb = { query: async () => ({ rows: [{ timezone: "America/Sao_Paulo" }], rowCount: 1 }) } as unknown as Database
const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next
  if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code } })
  res.status(500).json({ error: { message: (error as Error).message } })
}
const SPECIALIST_TOOL = { name: "agent_conhecimento", description: "Processos e procedimentos.", parameters: { type: "object", properties: { query: { type: "string" } } } }
const orchestrator = { organizationId: operator.organizationId, orchestratorId: "orch-1", orchestratorName: "INIA", orchestratorAgentId: "agent-orch", systemPrompt: "PROMPT DO ORQUESTRADOR", specialists: [], tools: [SPECIALIST_TOOL], outputInstructions: null, structuredOutput: null, recommendSupportMaterials: false }
const APPLICATION_ID = "cccccccc-0000-4000-8000-000000000001"

/** Operador da massa de teste: TMA de agosto com 60% de atingimento (fora da meta) e FCR com 106,7% (dentro). */
function repository() {
  const org = leadershipOrg()
  org.indicatorRows!.push(indicatorRow({ personId: ME, indicatorCode: "FCR", referencePeriod: "2026-08", value: 80, targetValue: 75, achievementPercent: 106.7, quartile: "Q1" }))
  return new InMemoryAnalyticsRepository(org)
}

async function setup(options: { withOrchestrator?: boolean; self?: "real" | null } = {}) {
  const repo = repository()
  const memory = createMemoryConversationStore()
  const sessions: VoiceSessionConfig[] = []
  const context: SelfChatContext | null = options.self === null ? null : await loadSelfChatContext(timezoneDb, operator, { repository: repo, now: CLOSURE.now })
  const calls: { orchestratorId: string; systemPrompt: string; extraContext: string; hooks: OrchestrationConversationHooks; history: { role: string; text: string }[] }[] = []
  // A orquestração de verdade escolhe a ferramenta e escreve a análise; aqui ela aciona `my_results` e compõe a resposta com o
  // resultado — a mesma rodada em que o texto do especialista também entraria, agora vendo os números.
  const reply: typeof runOrchestratedReply = async (_db, resolved, history, extraContext, _operatorId, _options, _fastPath, hooks = {}) => {
    calls.push({ orchestratorId: resolved.orchestratorId, systemPrompt: resolved.systemPrompt, extraContext, hooks, history })
    const result = await hooks.directTools!.execute("my_results", {})
    const card = result.card as QueryTableCard
    const worst = card.rows.find((row) => !String(row.cells.indicator).startsWith("PRV"))!
    return {
      text: `Seu pior indicador é **${String(worst.cells.indicator)}**, com **${String(worst.cells.achievement)}** de atingimento.\n\n${result.text}`,
      agentId: null,
      calls: [{ toolName: "my_results", query: "{}" }],
      results: [],
      structuredResult: null,
      supportMaterialCandidates: [],
      directResults: [{ toolName: "my_results", args: {}, card }],
    }
  }
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = operator; next() })
  app.use(
    "/api/v1/realtime",
    createRealtimeRouter(emptyDb, async (config) => { sessions.push(config); return { wsUrl: "wss://x", model: "m", expiresAt: "" } }, async (_history, _instruction, onChunk) => onChunk("genérico"), {
      conversations: memory.store,
      now: () => new Date("2026-10-16T12:00:00.000Z"),
      resolveOrchestrator: async () => (options.withOrchestrator === false ? null : (orchestrator as never)),
      orchestratedReply: reply,
      conversationGuardrails: async () => "\n\nLIMITES",
      leadershipContext: async () => null,
      selfContext: async () => context,
      workflowContext: async () => "\n\n[CONTEXTO DE ORIGEM: recado do fechamento de agosto]",
      feedbackApplicationVoice: async () => "REGISTRO CONGELADO DA APLICAÇÃO",
      // Revalidação real ao reabrir: o cartão do operador (sujeito = a própria pessoa) continua visível para ela.
      visibleLeadershipCards: async (user, cards) => visibleCards(await loadViewerScope(repo, user, "indicators.view"), cards as LeadershipCard[]),
    }),
  )
  app.use(errorHandler)
  const ask = (body: Record<string, unknown> = {}) =>
    request(app)
      .post("/api/v1/realtime/tool-call")
      .send({ toolName: "self_ask", query: "Qual é o meu pior indicador e como melhorar?", conversationId: null, turnId: "voice-1-1", callId: "call-1", ...body })
  return { app, memory, sessions, calls, ask, context }
}

describe("voz do operador — uma ferramenta, a orquestração do chat no backend", () => {
  it("a sessão declara só self_ask, com a regra de acionar já e sem o prompt do Orquestrador nem as ferramentas soltas", async () => {
    const { app, sessions } = await setup()
    await request(app).post("/api/v1/realtime/sessions").send({})
    expect((sessions[0]!.tools as { name: string }[]).map((tool) => tool.name)).toEqual(["self_ask"])
    expect(sessions[0]!.systemInstruction).toContain(SELF_VOICE_RULES)
    expect(sessions[0]!.systemInstruction).toContain("LIMITES")
    expect(sessions[0]!.systemInstruction).not.toContain("PROMPT DO ORQUESTRADOR")
    expect(sessions[0]!.systemInstruction).not.toContain("my_results")
  })

  it("self_ask roda a orquestração com 'meus resultados' + especialistas e devolve a resposta com os números e o cartão", async () => {
    const { app, calls, ask, context, memory } = await setup()
    const response = await ask()
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.orchestratorId).toBe("orch-1")
    expect(calls[0]!.hooks.directTools).toBe(context!.toolset)
    // As regras vão no prompt do Orquestrador; o contexto extra (material de análise dos especialistas) fica vazio.
    expect(calls[0]!.systemPrompt.startsWith("PROMPT DO ORQUESTRADOR\n\n")).toBe(true)
    expect(calls[0]!.systemPrompt).toContain(SELF_RESPONSE_RULES)
    expect(calls[0]!.extraContext).toBe("")
    expect(calls[0]!.history.at(-1)).toEqual({ role: "user", text: "Qual é o meu pior indicador e como melhorar?" })

    const data = response.body.data as { text: string; modelText: string; analytics: QueryTableCard[]; conversationId: string }
    expect(data.text).toContain("Seu pior indicador é **Tempo Médio de Atendimento**, com **60%** de atingimento.")
    expect(data.text).toContain("Meus resultados — Agosto 2026")
    expect(data.text).toContain("| Tempo Médio de Atendimento | 500 s | 300 s | 60% | Q4 | fora da meta |")
    expect(data.text).toContain("| First Call Resolution | 80% | 75% | 106,7% | Q1 | dentro da meta |")
    expect(data.modelText.startsWith(data.text)).toBe(true)
    expect(data.modelText).toContain("Fale um resumo curto e fiel")
    expect(data.analytics).toHaveLength(1)
    expect(data.analytics[0]).toMatchObject({ type: "QUERY_TABLE", structure: { subject: { kind: "EMPLOYEE", employeeId: ME } } })

    // Gravada como resposta da voz, com a chamada da ferramenta e o cartão — e o cartão volta ao reabrir a conversa.
    const saved = memory.messages.find((message) => message.role === "assistant")!
    expect(saved).toMatchObject({ channel: "voice", content: data.text })
    expect(saved.toolCalls).toEqual([{ toolName: "my_results", query: "{}", args: {}, analytics: data.analytics[0] }])
    const messages = await request(app).get(`/api/v1/realtime/conversations/${data.conversationId}/messages`)
    expect(messages.body.data.messages[0]).toMatchObject({ role: "assistant", channel: "voice", content: data.text, analytics: [data.analytics[0]] })
  })

  it("retentativa da mesma chamada devolve a resposta gravada sem orquestrar de novo", async () => {
    const { calls, ask, memory } = await setup()
    const first = await ask()
    const second = await ask()
    expect(calls).toHaveLength(1)
    expect(second.body.data.interactionId).toBe(first.body.data.interactionId)
    expect(second.body.data.text).toBe(first.body.data.text)
    expect(memory.messages.filter((message) => message.role === "assistant")).toHaveLength(1)
  })

  it("sem Orquestrador configurado, o operador ainda consulta os próprios números (só a ferramenta + assuntos proibidos)", async () => {
    const { app, sessions, calls, ask } = await setup({ withOrchestrator: false })
    await request(app).post("/api/v1/realtime/sessions").send({})
    expect((sessions[0]!.tools as { name: string }[]).map((tool) => tool.name)).toEqual(["self_ask"])
    const response = await ask()
    expect(response.status).toBe(200)
    expect(calls[0]!.orchestratorId).toBe("")
    expect(calls[0]!.systemPrompt).toContain(SELF_RESPONSE_RULES)
    expect(calls[0]!.systemPrompt.endsWith("LIMITES")).toBe(true)
    expect(response.body.data.text).toContain("**60%**")
  })

  it("numa conversa de Workflow (recado), a pergunta pela voz leva o contexto de origem, como no chat de texto", async () => {
    const { memory, calls, ask } = await setup()
    const workflowConversation = memory.seedWorkflowConversation({ organizationId: operator.organizationId, ownerPersonId: ME }, { title: "Retorno do fechamento de agosto", text: "Olá! Tenho um retorno novo…", at: new Date("2026-10-15T12:00:00.000Z") })
    const response = await ask({ conversationId: workflowConversation })
    expect(response.status).toBe(200)
    expect(response.body.data.conversationId).toBe(workflowConversation)
    expect(calls[0]!.systemPrompt).toContain("[CONTEXTO DE ORIGEM: recado do fechamento de agosto]")
    expect(calls[0]!.extraContext).toBe("")
  })

  it("sessão de feedback (Ouvir com a INIA) não muda: registro da aplicação + especialistas, e self_ask é recusada lá", async () => {
    const { app, sessions, calls, ask } = await setup()
    await request(app).post("/api/v1/realtime/sessions").send({ feedbackApplicationId: APPLICATION_ID })
    expect((sessions[0]!.tools as { name: string }[]).map((tool) => tool.name)).toEqual(["agent_conhecimento"])
    expect(sessions[0]!.systemInstruction.startsWith("REGISTRO CONGELADO DA APLICAÇÃO")).toBe(true)
    expect(sessions[0]!.systemInstruction).not.toContain(SELF_VOICE_RULES)
    expect(sessions[0]!.thinkingBudget).toBe(0)
    const response = await ask({ feedbackApplicationId: APPLICATION_ID })
    expect(response.status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it("sem 'meus resultados' para a pessoa, a voz segue com o Orquestrador e os especialistas, e self_ask não existe", async () => {
    const { app, sessions, ask } = await setup({ self: null })
    await request(app).post("/api/v1/realtime/sessions").send({})
    expect((sessions[0]!.tools as { name: string }[]).map((tool) => tool.name)).toEqual(["agent_conhecimento"])
    expect(sessions[0]!.systemInstruction.startsWith("PROMPT DO ORQUESTRADOR")).toBe(true)
    expect((await ask()).status).toBe(404)
  })
})
