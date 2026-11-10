import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createChatTurnMetrics, setChatTurnMetrics } from "../../../shared/application/observability/chat-turn-trace.js"
import type { OrchestratedReply } from "../../assistant/application/run-orchestrated-reply.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import { answerAgentVersionQuery } from "../../agents/testing/agent-version-fakes.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import type { ClarificationOutcome } from "../../knowledge-clarification/application/knowledge-clarification-service.js"
import { KNOWLEDGE_CLARIFICATION_VERSION } from "../../knowledge-clarification/domain/clarification-state.js"
import type { SelfChatContext } from "../../leadership-analytics/application/self-context.js"
import { createRealtimeRouter } from "./realtime-router.js"

/**
 * SINAIS DA RESPOSTA (`SUPPORT_SIGNALS_V1`, migration 181 — Apoio com Anjo, Parte A): cada ramo do chat e da voz grava, junto da
 * mensagem da INIA, os sinais calculados por CÓDIGO a partir dos resultados estruturados do turno (nunca do texto); `NO_REPLY` vai na
 * pergunta quando o turno termina em erro sem resposta; só no chat livre. A sugestão elegível (`recordSuggestion`, injetada) só é
 * chamada com sinal, no chat livre. Orquestração, esclarecimento e especialista falsos; a gravação é a do store em memória.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const PERSON = "aaaaaaaa-0000-4000-8000-000000000001"
const user: AuthTokenPayload = { sub: "acc-1", personId: PERSON, organizationId: ORG, role: "OPERATOR", name: "Pessoa", email: "p@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
// Banco vazio, exceto a conferência de especialista ativo na hora da chamada (voz): todo agente existe e está ativo.
const activeAgentsDb = { query: async (text: string, params: unknown[] = []) => answerAgentVersionQuery(text, params, () => ({ active: true })) ?? { rows: [], rowCount: 0 } } as unknown as Database
const emptyDb = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
const orchestrator = { organizationId: ORG, orchestratorId: "orch-1", orchestratorName: "INIA", orchestratorAgentId: "agent-orch", systemPrompt: "PROMPT", specialists: [{ agentId: "agent-esp", toolName: "agent_esp" }], tools: [], outputInstructions: null, structuredOutput: null, recommendSupportMaterials: false }
const self = { instructions: "REGRAS", voiceInstructions: "", toolset: { declarations: [], handles: (name: string) => name === "my_results", execute: async () => ({ text: "", card: null }) } } as unknown as SelfChatContext
const TRACE = { version: KNOWLEDGE_CLARIFICATION_VERSION, mode: "NEW" as const, decision: null, navigation: null, rejectedOptions: [], plannerAttempts: 1, answerAttempts: 0, issues: [] }
const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next
  if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
  if (error instanceof ZodError) return void res.status(400).json({ error: { code: "VALIDATION_ERROR" } })
  res.status(500).json({ error: { message: (error as Error).message } })
}

type Result = OrchestratedReply["results"][number]
const specialist = (overrides: Partial<Result> = {}): Result => ({ agentId: "agent-esp", toolName: "agent_esp", text: "resposta do especialista", ...overrides })
const baseReply = { agentId: null, calls: [], results: [], structuredResult: null, supportMaterialCandidates: [] }

type Options = {
  reply?: () => Promise<Partial<OrchestratedReply>>
  orchestrator?: boolean
  clarification?: () => Promise<ClarificationOutcome>
  specialistTool?: () => Promise<Record<string, unknown>>
  db?: Database
  self?: boolean
}

let suggestions: { interactionId: string; origin: string }[] = []
let logs: string[] = []

function setup(options: Options = {}) {
  const memory = createMemoryConversationStore()
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = user
    next()
  })
  if (options.clarification) process.env.INIA_KNOWLEDGE_CLARIFICATION = "ON"
  app.use(
    "/api/v1/realtime",
    createRealtimeRouter(options.db ?? emptyDb, async () => ({ wsUrl: "wss://x", model: "m", expiresAt: "" }), async (_history, _instruction, onChunk) => onChunk("genérico"), {
      conversations: memory.store,
      now: () => new Date("2026-11-09T12:00:00.000Z"),
      resolveOrchestrator: async () => (options.orchestrator === false ? null : (orchestrator as never)),
      orchestratedReply: (async () => ({ ...baseReply, text: "Resposta da INIA.", ...(await (options.reply ?? (async () => ({})))()) })) as never,
      ...(options.specialistTool ? { specialistTool: options.specialistTool as never } : {}),
      conversationGuardrails: async () => "",
      leadershipContext: async () => null,
      selfContext: async () => (options.self === false ? null : self),
      knowledgeClarification: options.clarification ? { handle: options.clarification } : null,
      recordSuggestion: async (input) => {
        suggestions.push({ interactionId: input.interactionId, origin: input.origin })
      },
    }),
  )
  app.use(errorHandler)
  return { app, memory }
}

function events(text: string) {
  return text.split("\n\n").filter(Boolean).flatMap((block) => {
    const event = /^event: (.+)$/m.exec(block)?.[1]
    const data = /^data: (.+)$/m.exec(block)?.[1]
    return event && data ? [{ event, data: JSON.parse(data) as Record<string, unknown> }] : []
  })
}

let keySeed = 0
const post = (app: express.Express, conversationId: string | null = null) => request(app).post("/api/v1/realtime/messages").send({ conversationId, text: "Como contesto uma fatura?", clientMessageId: `aaaaaaaa-0000-4000-8000-${String(++keySeed).padStart(12, "0")}` })
const lastAnswer = (memory: ReturnType<typeof createMemoryConversationStore>) => memory.messages.filter((message) => message.role === "assistant").at(-1)!
const timing = () => JSON.parse(logs.find((line) => line.includes('"chat_turn_timing"'))!) as { notes: Record<string, unknown> }

beforeEach(() => {
  logs = []
  suggestions = []
  setChatTurnMetrics(createChatTurnMetrics())
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    logs.push(String(line))
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.INIA_KNOWLEDGE_CLARIFICATION
})

describe("sinais da resposta — chat de texto (/messages)", () => {
  it("ORCHESTRATED: especialista consultado sem trecho nas bases = KNOWLEDGE_NOT_FOUND na resposta, no evento, no histórico e no rastreamento; sugestão registrada", async () => {
    const { app, memory } = setup({ reply: async () => ({ results: [specialist({ knowledge: { mode: "NO_MATCH" } as never })] }) })
    const sse = events((await post(app)).text)
    const answer = lastAnswer(memory)
    expect(memory.signals.get(answer.id)).toEqual(["KNOWLEDGE_NOT_FOUND"])
    expect(sse.find((item) => item.event === "persisted")!.data).toEqual({ interactionId: answer.id, signals: ["KNOWLEDGE_NOT_FOUND"] })
    const page = await request(app).get(`/api/v1/realtime/conversations/${answer.conversationId}/messages`)
    const messages = page.body.data.messages as { id: string; role: string; signals: unknown }[]
    expect(messages.find((message) => message.id === answer.id)!.signals).toEqual(["KNOWLEDGE_NOT_FOUND"])
    // A pergunta não tem linha de sinais: null = não calculado.
    expect(messages.find((message) => message.role === "user")!.signals).toBeNull()
    expect(timing().notes).toMatchObject({ replyInteractionId: answer.id, supportSignals: "KNOWLEDGE_NOT_FOUND" })
    expect(suggestions).toEqual([{ interactionId: answer.id, origin: "SIGNAL" }])
  })

  it("ORCHESTRATED: resposta com trecho das bases ou investigação concluída grava lista vazia e não sugere nada", async () => {
    for (const result of [specialist({ knowledge: { mode: "RETRIEVAL" } as never }), specialist({ knowledge: { mode: "NONE" } as never, toolTrace: [{ status: "COMPLETED" }] as never })]) {
      suggestions = []
      const { app, memory } = setup({ reply: async () => ({ results: [result] }) })
      await post(app)
      expect(memory.signals.get(lastAnswer(memory).id)).toEqual([])
      expect(suggestions).toEqual([])
    }
  })

  it("ORCHESTRATED: chamada que falhou = CONSULTATION_FAILED (sem KNOWLEDGE_NOT_FOUND); especialista impedido = SPECIALIST_BLOCKED", async () => {
    const failed = setup({ reply: async () => ({ results: [specialist({ knowledge: { mode: "NO_MATCH" } as never }), specialist({ agentId: null, failed: true })] }) })
    await post(failed.app)
    expect(failed.memory.signals.get(lastAnswer(failed.memory).id)).toEqual(["CONSULTATION_FAILED"])
    const blocked = setup({ reply: async () => ({ results: [specialist({ blocked: true })] }) })
    await post(blocked.app)
    expect(blocked.memory.signals.get(lastAnswer(blocked.memory).id)).toEqual(["SPECIALIST_BLOCKED"])
  })

  it("CLARIFICATION: esclarecimento que terminou insuficiente = KNOWLEDGE_INSUFFICIENT; etapa aguardando escolha = lista vazia", async () => {
    const outcome = (status: string) => async () => ({ kind: "REPLY", content: "As bases não cobrem esse caso.", state: { version: KNOWLEDGE_CLARIFICATION_VERSION, id: "11111111-1111-4111-8111-111111111111", originalQuestion: "q", status, steps: [], questionFacts: [], coverage: { consideredDocuments: 1, matchedDocuments: 0, presentedDocuments: 0, omittedDocuments: 0, complete: true }, sources: [], conflicts: [], notice: null, updatedAt: "2026-11-09T12:00:00.000Z" }, trace: TRACE }) as never
    const insufficient = setup({ clarification: outcome("INSUFFICIENT") })
    await post(insufficient.app)
    expect(insufficient.memory.signals.get(lastAnswer(insufficient.memory).id)).toEqual(["KNOWLEDGE_INSUFFICIENT"])
    const open = setup({ clarification: outcome("OPEN") })
    await post(open.app)
    expect(open.memory.signals.get(lastAnswer(open.memory).id)).toEqual([])
  })

  it("DATA_ONLY e PERSONA_STREAM gravam lista vazia (mesmo com falha de uma ferramenta de dados)", async () => {
    const dataOnly = setup({ orchestrator: false, reply: async () => ({ results: [specialist({ agentId: null, failed: true })] }) })
    await post(dataOnly.app)
    expect(dataOnly.memory.signals.get(lastAnswer(dataOnly.memory).id)).toEqual([])
    expect(timing().notes).toMatchObject({ supportSignals: "" })
    // Sem Orquestrador e sem "meus resultados": persona genérica em fluxo.
    const { app, memory } = setup({ orchestrator: false, self: false })
    await post(app)
    expect(memory.signals.get(lastAnswer(memory).id)).toEqual([])
    expect(suggestions).toEqual([])
  })

  it("conversa de Workflow (fora do chat livre): nada é gravado, a tela não recebe sinais e nada é sugerido", async () => {
    const { app, memory } = setup({ reply: async () => ({ results: [specialist({ knowledge: { mode: "NO_MATCH" } as never })] }) })
    const conversationId = memory.seedWorkflowConversation({ organizationId: ORG, ownerPersonId: PERSON }, { title: "Recado", text: "Recado do Workflow", at: new Date("2026-11-09T11:00:00.000Z") })
    const sse = events((await post(app, conversationId)).text)
    const answer = lastAnswer(memory)
    expect(answer.conversationId).toBe(conversationId)
    expect(memory.signals.has(answer.id)).toBe(false)
    expect(sse.find((item) => item.event === "persisted")!.data).toEqual({ interactionId: answer.id })
    expect(suggestions).toEqual([])
  })

  it("erro sem resposta gravada: NO_REPLY na PERGUNTA do operador e sugestão para ela; nenhuma mensagem da INIA", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { app, memory } = setup({ reply: async () => { throw new Error("modelo indisponível") } })
    const sse = events((await post(app)).text)
    expect(sse.map((item) => item.event)).toContain("error")
    const question = memory.messages.find((message) => message.role === "user")!
    expect(memory.messages.filter((message) => message.role === "assistant")).toHaveLength(0)
    expect(memory.signals.get(question.id)).toEqual(["NO_REPLY"])
    expect(timing().notes).toMatchObject({ supportSignals: "NO_REPLY" })
    expect(suggestions).toEqual([{ interactionId: question.id, origin: "SIGNAL" }])
  })
})

describe("sinais da resposta — voz (/tool-call)", () => {
  const TOOL = (query: string) => ({ toolName: "agent_esp", query, conversationId: null, turnId: "voice-turn-0001", callId: "call-1" })

  it("especialista acionado pela voz: sinais sobre o resultado dele (sem trecho = KNOWLEDGE_NOT_FOUND; com trecho = vazia)", async () => {
    const notFound = setup({ db: activeAgentsDb, specialistTool: async () => ({ contract: "TEXT", text: "Não encontrei nas bases.", knowledge: { mode: "NO_MATCH" } }) })
    const response = await request(notFound.app).post("/api/v1/realtime/tool-call").send(TOOL("como contestar?"))
    expect(response.status).toBe(200)
    expect(notFound.memory.signals.get(response.body.data.interactionId)).toEqual(["KNOWLEDGE_NOT_FOUND"])
    expect(suggestions).toEqual([{ interactionId: response.body.data.interactionId, origin: "SIGNAL" }])
    suggestions = []
    const found = setup({ db: activeAgentsDb, specialistTool: async () => ({ contract: "TEXT", text: "Abra a contestação.", knowledge: { mode: "RETRIEVAL" } }) })
    const answered = await request(found.app).post("/api/v1/realtime/tool-call").send(TOOL("como contestar?"))
    expect(found.memory.signals.get(answered.body.data.interactionId)).toEqual([])
    expect(suggestions).toEqual([])
  })

  it("especialista impedido na hora da chamada (sem versão autorizada): SPECIALIST_BLOCKED", async () => {
    const { app, memory } = setup({ db: emptyDb, specialistTool: async () => { throw new Error("não deveria rodar") } })
    const response = await request(app).post("/api/v1/realtime/tool-call").send(TOOL("como contestar?"))
    expect(response.status).toBe(200)
    expect(memory.signals.get(response.body.data.interactionId)).toEqual(["SPECIALIST_BLOCKED"])
  })

  it("/voice-turn (fala sem especialista) grava lista vazia", async () => {
    const { app, memory } = setup()
    const spoken = await request(app).post("/api/v1/realtime/voice-turn").send({ conversationId: null, turnId: "voice-turn-s1", userText: "oi", assistantText: "Olá!" })
    expect(memory.signals.get(spoken.body.data.assistantInteractionId)).toEqual([])
  })
})
