import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import type { runOrchestratedReply } from "../../assistant/application/run-orchestrated-reply.js"
import { INIA_VOICE_PERSONA, type VoiceSessionConfig } from "../domain/voice-session.js"
import { INIA_CHAT_PERSONA, createRealtimeRouter } from "./realtime-router.js"

/**
 * LIMITES EM TODA CONVERSA (2026-10-13): o prompt do Orquestrador já traz os limites de atuação do Agente dele e os assuntos
 * proibidos; a instrução de uma aplicação de feedback e a persona da INIA sem Orquestrador não — recebem aqui os limites do
 * Agente do Orquestrador (quando há) e os assuntos proibidos. Sem duplicar no caminho do Orquestrador.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const LARISSA = "aaaaaaaa-0000-4000-8000-000000000001"
const user: AuthTokenPayload = { sub: "acc-1", personId: LARISSA, organizationId: ORG, role: "OPERATOR", name: "Larissa", email: "l@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
const emptyDb = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next
  if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code } })
  res.status(500).json({ error: { message: (error as Error).message } })
}
const HISTORICAL = "[REGISTRO DO FEEDBACK]"
const TOOLS = [{ name: "consultar_faturamento", description: "Faturamento", parameters: { type: "object", properties: {} } }]
const orchestrator = { organizationId: ORG, orchestratorId: "orch-1", orchestratorName: "INIA", orchestratorAgentId: "agent-orch", systemPrompt: "PROMPT DO ORQUESTRADOR (com as restrições dele)", specialists: [{ agentId: "agent-fat", toolName: "consultar_faturamento" }], tools: TOOLS, outputInstructions: null, structuredOutput: null, recommendSupportMaterials: false }
const CONSULTATION = { applicationId: "app-1", subject: "Rechamada", periodLabel: "agosto de 2026", publishedAt: "2026-09-01T12:00:00.000Z", domain: "INDICATOR", indicatorNames: ["Rechamada"], materials: [], timeZone: "America/Sao_Paulo" } as never
const guardrailsOf = (agentId: string | null) => `\n\nLIMITES(${agentId ?? "sem agente"})`

function setup(options: { withOrchestrator?: boolean; db?: Database; injectGuardrails?: boolean } = {}) {
  const memory = createMemoryConversationStore()
  const streamed: string[] = []
  const sessions: VoiceSessionConfig[] = []
  const orchestrated: { systemPrompt: string; extraContext: string }[] = []
  const reply: typeof runOrchestratedReply = async (_db, resolved, _history, extraContext) => {
    orchestrated.push({ systemPrompt: resolved.systemPrompt, extraContext })
    return { text: "resposta", agentId: null, calls: [], results: [], structuredResult: null, supportMaterialCandidates: [] }
  }
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use(
    "/api/v1/realtime",
    createRealtimeRouter(options.db ?? emptyDb, async (config) => { sessions.push(config); return { wsUrl: "wss://x", model: "m", expiresAt: "" } }, async (_history, instruction, onChunk) => { streamed.push(instruction); onChunk("resposta") }, {
      conversations: memory.store,
      now: () => new Date("2026-10-13T12:00:00.000Z"),
      resolveOrchestrator: async () => (options.withOrchestrator ? (orchestrator as never) : null),
      orchestratedReply: reply,
      feedbackApplicationContext: async () => ({ applicationId: "app-1", instruction: HISTORICAL, consultation: CONSULTATION }),
      feedbackApplicationVoice: async () => `${HISTORICAL} voz`,
      ...(options.injectGuardrails === false ? {} : { conversationGuardrails: async (_organizationId: string, agentId: string | null) => guardrailsOf(agentId) }),
      // A conferência da resposta tem prova própria (realtime-router-response-check.test.ts).
      responseCheck: async () => ({ outcome: "NOT_APPLICABLE" }),
    }),
  )
  app.use(errorHandler)
  const send = (body: Record<string, unknown>) => request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Quem é o Son Goku?", clientMessageId: "11111111-aaaa-4aaa-8aaa-000000000001", ...body })
  return { app, memory, streamed, sessions, orchestrated, send }
}

describe("limites de atuação e assuntos proibidos em toda conversa com a INIA", () => {
  it("chat sem Orquestrador: a persona recebe os assuntos proibidos (não há Agent com limites)", async () => {
    const { send, streamed } = setup()
    await send({})
    expect(streamed).toHaveLength(1)
    expect(streamed[0]!.startsWith(INIA_CHAT_PERSONA)).toBe(true)
    expect(streamed[0]!.endsWith(guardrailsOf(null))).toBe(true)
  })

  it("voz sem Orquestrador: a persona da voz recebe os assuntos proibidos", async () => {
    const { app, sessions } = setup()
    await request(app).post("/api/v1/realtime/sessions").send({})
    expect(sessions[0]!.systemInstruction).toBe(`${INIA_VOICE_PERSONA}${guardrailsOf(null)}`)
  })

  it("com Orquestrador (chat e voz): o prompt dele já traz limites e restrições — nada é anexado de novo", async () => {
    const { app, send, sessions, orchestrated } = setup({ withOrchestrator: true })
    await send({})
    // A instrução da conversa vem depois do prompt dele (nunca como contexto extra, que chega aos especialistas como transcrição).
    expect(orchestrated[0]!.systemPrompt.startsWith(`${orchestrator.systemPrompt}\n\n${INIA_CHAT_PERSONA}`)).toBe(true)
    expect(orchestrated[0]!.systemPrompt).not.toContain("LIMITES")
    expect(orchestrated[0]!.extraContext).toBe("")
    await request(app).post("/api/v1/realtime/sessions").send({})
    expect(sessions[0]!.systemInstruction).not.toContain("LIMITES")
  })

  it("aplicação de feedback com Orquestrador: a instrução da sessão substitui o prompt dele e recebe os limites do Agente dele", async () => {
    const { app, memory, orchestrated, sessions } = setup({ withOrchestrator: true })
    const conversation = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: LARISSA }, { title: "Rechamada", text: "Apresentação", at: new Date("2026-10-13T11:00:00.000Z") })
    await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversation, text: "Quem é o Son Goku?", clientMessageId: "22222222-aaaa-4aaa-8aaa-000000000001" })
    expect(orchestrated[0]!.systemPrompt.startsWith(HISTORICAL)).toBe(true)
    expect(orchestrated[0]!.systemPrompt.endsWith(guardrailsOf("agent-orch"))).toBe(true)
    await request(app).post("/api/v1/realtime/sessions").send({ feedbackApplicationId: "00000000-0000-4000-8000-0000000000aa" })
    expect(sessions[0]!.systemInstruction).toBe(`${HISTORICAL} voz${guardrailsOf("agent-orch")}`)
  })

  it("aplicação de feedback sem Orquestrador: só os assuntos proibidos", async () => {
    const { app, memory, streamed, sessions } = setup()
    const conversation = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: LARISSA }, { title: "Rechamada", text: "Apresentação", at: new Date("2026-10-13T11:00:00.000Z") })
    await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversation, text: "Quem é o Son Goku?", clientMessageId: "33333333-aaaa-4aaa-8aaa-000000000001" })
    expect(streamed[0]!.startsWith(HISTORICAL)).toBe(true)
    expect(streamed[0]!.endsWith(guardrailsOf(null))).toBe(true)
    await request(app).post("/api/v1/realtime/sessions").send({ feedbackApplicationId: "00000000-0000-4000-8000-0000000000aa" })
    expect(sessions[0]!.systemInstruction).toBe(`${HISTORICAL} voz${guardrailsOf(null)}`)
  })

  it("leitura real (sem injeção): sem Agent só os assuntos proibidos; aplicação de feedback com os limites do Agente do Orquestrador", async () => {
    const queries: { sql: string; params: unknown[] }[] = []
    const db = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.includes("from prohibited_topics")) {
          queries.push({ sql, params })
          return { rows: [{ name: "Política", required_behavior: "Não opine sobre política." }], rowCount: 1 }
        }
        if (sql.includes("select action_limits_enabled, action_limits from agents")) {
          queries.push({ sql, params })
          return { rows: [{ action_limits_enabled: true, action_limits: "Assuntos de trabalho: indicadores, feedbacks e processos da operação." }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      },
    } as unknown as Database
    const persona = setup({ db, injectGuardrails: false })
    await persona.send({})
    expect(queries.every((query) => query.params.length === 1 && query.params[0] === ORG)).toBe(true)
    expect(persona.streamed[0]).toContain("- Política: Não opine sobre política.")
    expect(persona.streamed[0]).not.toContain("Limites de atuação")

    queries.length = 0
    const session = setup({ db, injectGuardrails: false, withOrchestrator: true })
    const conversation = session.memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: LARISSA }, { title: "Rechamada", text: "Apresentação", at: new Date("2026-10-13T11:00:00.000Z") })
    await request(session.app).post("/api/v1/realtime/messages").send({ conversationId: conversation, text: "Quem é o Son Goku?", clientMessageId: "44444444-aaaa-4aaa-8aaa-000000000001" })
    expect(queries.find((query) => query.sql.includes("from agents"))!.params).toEqual(["agent-orch", ORG])
    const instruction = session.orchestrated[0]!.systemPrompt
    expect(instruction).toContain("Limites de atuação deste agente")
    expect(instruction).toContain("Assuntos de trabalho: indicadores, feedbacks e processos da operação.")
    expect(instruction.indexOf("Limites de atuação")).toBeLessThan(instruction.indexOf("- Política"))
  })
})
