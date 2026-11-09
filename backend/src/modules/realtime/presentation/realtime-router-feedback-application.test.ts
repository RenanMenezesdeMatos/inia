import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import type { VoiceSessionConfig } from "../domain/voice-session.js"
import { createRealtimeRouter } from "./realtime-router.js"
import { answerAgentVersionQuery } from "../../agents/testing/agent-version-fakes.js"

/**
 * Conversa de uma APLICAÇÃO de feedback: o contexto vem do registro congelado (nunca do navegador, que manda o indicador ATUAL
 * no systemInstruction), sem Orquestrador/ferramentas, várias perguntas na mesma conversa, retomada dias depois, conclusão
 * bloqueia pergunta nova (só a resposta já em processamento entra) e a voz recebe a mesma instrução, sem tools.
 */
// Organização da sessão — diferente da organização da instalação: o especialista recebe a da sessão.
const ORG = "00000000-0000-4000-8000-0000000000b2"
const JOANA = "aaaaaaaa-0000-4000-8000-000000000002"
const user: AuthTokenPayload = { sub: "acc-2", personId: JOANA, organizationId: ORG, role: "OPERATOR", name: "Joana", email: "j@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
// Banco vazio, exceto a versão vigente e a autorização do especialista na hora da chamada (revisão da PEN-002/PEN-076): ativo e publicado.
const fakeDb = { query: async (text: string, params: unknown[] = []) => answerAgentVersionQuery(text, params, () => ({ active: true })) ?? { rows: [], rowCount: 0 } } as unknown as Database
const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next
  if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code } })
  res.status(500).json({ error: { message: (error as Error).message } })
}
const HISTORICAL = "[REGISTRO: Rechamada 14,6% × meta 10% em agosto de 2026]"

const COMPLETED_APP = "00000000-0000-4000-8000-0000000000cc"
const NOT_STARTED_APP = "00000000-0000-4000-8000-0000000000dd"

function setup(options: { contextAvailable?: boolean } = {}) {
  let clock = new Date("2026-10-01T12:00:00.000Z")
  const memory = createMemoryConversationStore()
  const instructions: string[] = []
  const sessions: VoiceSessionConfig[] = []
  // Aplicação concluída: a conversa original (encerrada) e a complementar, criada só na primeira dúvida (uma só, reaproveitada).
  const original = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: JOANA }, { title: "Rechamada", text: "Apresentação", at: new Date("2026-09-30T11:00:00.000Z") })
  memory.completeConversation(original, new Date("2026-09-30T12:00:00.000Z"))
  let followUp: string | null = null
  const resolutions: string[] = []
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use(
    "/api/v1/realtime",
    createRealtimeRouter(fakeDb, async (config) => { sessions.push(config); return { wsUrl: "wss://x", model: "m", expiresAt: "" } }, async (_history, instruction, onChunk) => { instructions.push(instruction); onChunk("resposta") }, {
      conversations: memory.store,
      now: () => clock,
      feedbackApplicationContext: async (input) => (options.contextAvailable === false ? null : { applicationId: "app-1", instruction: `${HISTORICAL} conversa=${input.conversationId}` }),
      feedbackApplicationVoice: async (input) => {
        if (input.applicationId === NOT_STARTED_APP) throw new DomainError("não iniciada", "FEEDBACK_APPLICATION_NOT_STARTED", 409)
        return `${HISTORICAL} voz${input.applicationId === COMPLETED_APP ? " (dúvidas)" : ""}`
      },
      // Mesma regra do serviço: conversa pedida tem de ser desta aplicação; sem conversa, a complementar (criada uma vez).
      feedbackApplicationConversation: async (input) => {
        resolutions.push(input.requestedConversationId ?? "null")
        if (input.requestedConversationId) {
          if (input.requestedConversationId === original || input.requestedConversationId === followUp) return { conversationId: input.requestedConversationId, created: false }
          throw new DomainError("outra conversa", "FEEDBACK_APPLICATION_CONVERSATION_MISMATCH", 409)
        }
        if (followUp) return { conversationId: followUp, created: false }
        const at = clock
        followUp = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: JOANA }, { title: "Dúvidas · Rechamada", text: "-", at })
        // A complementar nasce sem mensagens (a primeira é a dúvida): tira a mensagem de semente.
        memory.messages.splice(memory.messages.findIndex((message) => message.conversationId === followUp), 1)
        return { conversationId: followUp, created: true }
      },
    }),
  )
  app.use(errorHandler)
  return { app, memory, instructions, sessions, original, followUpId: () => followUp, resolutions, setClock: (value: Date) => { clock = value } }
}

describe("conversa da aplicação de feedback", () => {
  it("usa o registro congelado, ignora o contexto do navegador e aceita várias perguntas na mesma conversa", async () => {
    const { app, memory, instructions } = setup()
    const conversation = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: JOANA }, { title: "Rechamada", text: "Olá, Joana! Este feedback se refere aos seus resultados de agosto de 2026…", at: new Date("2026-10-01T11:00:00.000Z") })
    const browserInstruction = "persona Contexto atual: o indicador prioritário do momento é \"TMA\" (dado de HOJE)."
    for (const [index, text] of ["Pode explicar esse ponto?", "Como aplico essa orientação?", "Como estou agora?"].entries()) {
      const reply = await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversation, text, clientMessageId: `11111111-aaaa-4aaa-8aaa-00000000000${index}`, systemInstruction: browserInstruction })
      expect(/"conversationId":"([^"]+)"/.exec(reply.text)![1]).toBe(conversation)
    }
    expect(instructions).toHaveLength(3)
    for (const instruction of instructions) {
      expect(instruction).toContain(HISTORICAL)
      expect(instruction).not.toContain("indicador prioritário")
    }
    const messages = await request(app).get(`/api/v1/realtime/conversations/${conversation}/messages`)
    expect(messages.body.data.messages[0]).toMatchObject({ role: "assistant", origin: "FEEDBACK" })
    expect(messages.body.data.messages).toHaveLength(7)
    // A conversa atual do usuário continua outra (a da aplicação nunca vira a "atual").
    expect((await request(app).get("/api/v1/realtime/conversations/current")).body.data.conversation).toBeNull()
  })

  it("retomada dias depois continua na mesma conversa (sem rotação por inatividade)", async () => {
    const { app, memory, setClock } = setup()
    const conversation = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: JOANA }, { title: "Rechamada", text: "Apresentação", at: new Date("2026-09-20T11:00:00.000Z") })
    setClock(new Date("2026-10-01T12:00:00.000Z"))
    const reply = await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversation, text: "Voltei, pode continuar?", clientMessageId: "22222222-aaaa-4aaa-8aaa-000000000001", systemInstruction: "persona" })
    expect(/"conversationId":"([^"]+)"/.exec(reply.text)![1]).toBe(conversation)
  })

  it("concluída: pergunta nova é recusada (409); só o turno de voz já em processamento entra, dentro da janela curta", async () => {
    const { app, memory, setClock } = setup()
    const conversation = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: JOANA }, { title: "Rechamada", text: "Apresentação", at: new Date("2026-10-01T11:00:00.000Z") })
    memory.completeConversation(conversation, new Date("2026-10-01T12:00:00.000Z"))
    setClock(new Date("2026-10-01T12:00:30.000Z"))
    const text = await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversation, text: "Mais uma pergunta", clientMessageId: "33333333-aaaa-4aaa-8aaa-000000000001", systemInstruction: "persona" })
    expect(text.status).toBe(409)
    const late = await request(app).post("/api/v1/realtime/voice-turn").send({ conversationId: conversation, turnId: "voice-late-0001", assistantText: "Resposta que já estava saindo." })
    expect(late.status).toBe(200)
    expect(late.body.data).toMatchObject({ conversationId: conversation, closed: true })
    setClock(new Date("2026-10-01T12:10:00.000Z"))
    const tooLate = await request(app).post("/api/v1/realtime/voice-turn").send({ conversationId: conversation, turnId: "voice-late-0002", userText: "Pergunta nova depois de concluir" })
    expect(tooLate.status).toBe(409)
    expect(memory.conversations.find((item) => item.id === conversation)!.status).toBe("CLOSED")
  })

  it("chaves que só o servidor grava (recado de Workflow, apresentação) são recusadas vindas do navegador (C11, 4ª auditoria)", async () => {
    const { app, memory } = setup()
    const conversation = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: JOANA }, { title: "Rechamada", text: "Apresentação", at: new Date("2026-10-01T11:00:00.000Z") })
    // A validação do corpo recusa (no app real, 400 VALIDATION_ERROR; este app de teste não tem o tratador de erros) e nada é gravado.
    const before = memory.messages.length
    for (const turnId of ["workflow-output:11111111-2222-4333-8444-555555555555", "WORKFLOW-OUTPUT:abc12345", "feedback-application:presentation"]) {
      const forged = await request(app).post("/api/v1/realtime/voice-turn").send({ conversationId: conversation, turnId, assistantText: "Recado forjado" })
      expect(forged.status, turnId).not.toBe(200)
    }
    const message = await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversation, text: "Oi", clientMessageId: "workflow-output:abc12345", systemInstruction: "persona" })
    expect(message.status).not.toBe(200)
    expect(memory.messages.length).toBe(before)
    // Um turno comum continua aceito.
    expect((await request(app).post("/api/v1/realtime/voice-turn").send({ conversationId: conversation, turnId: "voice-ok-00001", userText: "Pergunta comum" })).status).toBe(200)
  })

  it("sem o registro do feedback, a INIA não finge conhecê-lo: erro explícito no stream", async () => {
    const { app, memory, instructions } = setup({ contextAvailable: false })
    const conversation = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: JOANA }, { title: "Rechamada", text: "Apresentação", at: new Date("2026-10-01T11:00:00.000Z") })
    const reply = await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversation, text: "Pode explicar?", clientMessageId: "44444444-aaaa-4aaa-8aaa-000000000001", systemInstruction: "persona" })
    expect(reply.text).toContain("event: error")
    expect(reply.text).toContain("Não foi possível carregar o contexto deste feedback")
    expect(instructions).toHaveLength(0)
  })

  it("voz da aplicação: instrução do registro e NENHUMA ferramenta, travadas na sessão; concluída = dúvidas com o mesmo registro; não iniciada = 409", async () => {
    const { app, sessions } = setup()
    const session = await request(app).post("/api/v1/realtime/sessions").send({ feedbackApplicationId: "00000000-0000-4000-8000-0000000000aa", systemInstruction: "persona com indicador de HOJE" })
    expect(session.status).toBe(200)
    expect(session.body.data).toEqual({ wsUrl: "wss://x", model: "m", expiresAt: "", feedbackApplicationId: "00000000-0000-4000-8000-0000000000aa" })
    expect(sessions[0]).toMatchObject({ tools: [], systemInstruction: `${HISTORICAL} voz`, thinkingBudget: 0 })
    const completed = await request(app).post("/api/v1/realtime/sessions").send({ feedbackApplicationId: COMPLETED_APP })
    expect(completed.status).toBe(200)
    expect(sessions[1]).toMatchObject({ tools: [], systemInstruction: `${HISTORICAL} voz (dúvidas)` })
    const notStarted = await request(app).post("/api/v1/realtime/sessions").send({ feedbackApplicationId: NOT_STARTED_APP })
    expect(notStarted.status).toBe(409)
    expect(sessions).toHaveLength(2)
  })

  it("voz da aplicação retomada: a recapitulação vem da conversa GRAVADA da aplicação", async () => {
    const { app, memory, sessions } = setup()
    const conversation = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: JOANA }, { title: "Rechamada", text: "Olá, Joana! Este feedback se refere a agosto.", at: new Date("2026-10-01T11:00:00.000Z") })
    const response = await request(app).post("/api/v1/realtime/sessions").send({ feedbackApplicationId: "00000000-0000-4000-8000-0000000000aa", conversationId: conversation })
    expect(response.status).toBe(200)
    expect(sessions[0]!.systemInstruction.startsWith(`${HISTORICAL} voz`)).toBe(true)
    expect(sessions[0]!.systemInstruction).toContain("INIA: Olá, Joana! Este feedback se refere a agosto.")
  })

  it("dúvida depois da conclusão: a conversa complementar nasce na primeira mensagem, é reaproveitada e usa o registro; a original continua encerrada", async () => {
    const { app, memory, instructions, original, followUpId, resolutions } = setup()
    const first = await request(app).post("/api/v1/realtime/messages").send({ conversationId: null, feedbackApplicationId: COMPLETED_APP, text: "Ainda não entendi a meta.", clientMessageId: "55555555-aaaa-4aaa-8aaa-000000000001", systemInstruction: "persona com indicador de HOJE" })
    const followUp = followUpId()!
    expect(first.text).toContain(`"conversationId":"${followUp}","created":true`)
    expect(followUp).not.toBe(original)
    expect(instructions.at(-1)).toContain(`${HISTORICAL} conversa=${followUp}`)
    expect(instructions.at(-1)).not.toContain("HOJE")
    const second = await request(app).post("/api/v1/realtime/messages").send({ conversationId: followUp, feedbackApplicationId: COMPLETED_APP, text: "E a observação?", clientMessageId: "55555555-aaaa-4aaa-8aaa-000000000002", systemInstruction: "persona" })
    expect(second.text).toContain(`"conversationId":"${followUp}","created":false`)
    // Voz da dúvida: o turno vai para a MESMA complementar.
    const voice = await request(app).post("/api/v1/realtime/voice-turn").send({ conversationId: null, feedbackApplicationId: COMPLETED_APP, turnId: "voice-follow-0001", userText: "E por voz?" })
    expect(voice.body.data).toMatchObject({ conversationId: followUp, created: false, closed: false })
    expect(resolutions).toEqual(["null", followUp, "null"])
    expect(memory.messages.filter((message) => message.conversationId === followUp).map((message) => message.content)).toEqual(["Ainda não entendi a meta.", "resposta", "E a observação?", "resposta", "E por voz?"])
    expect(memory.conversations.find((item) => item.id === original)).toMatchObject({ status: "CLOSED", closeReason: "COMPLETED" })
    expect(memory.messages.filter((message) => message.conversationId === original)).toHaveLength(1)
  })

  it("conversa que não é desta aplicação é recusada ANTES de gravar (nunca mistura contextos)", async () => {
    const { app, memory } = setup()
    const other = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: JOANA }, { title: "Outro feedback", text: "Apresentação", at: new Date("2026-09-29T11:00:00.000Z") })
    const before = memory.messages.length
    const reply = await request(app).post("/api/v1/realtime/messages").send({ conversationId: other, feedbackApplicationId: COMPLETED_APP, text: "Pergunta", clientMessageId: "66666666-aaaa-4aaa-8aaa-000000000001", systemInstruction: "persona" })
    expect(reply.status).toBe(409)
    expect(reply.body.error.code).toBe("FEEDBACK_APPLICATION_CONVERSATION_MISMATCH")
    expect(memory.messages.length).toBe(before)
  })
})

/**
 * CONSULTAS DENTRO DA SESSÃO (session-consultation.ts): com Orquestrador do chat/voz, o que o registro não responde é consultado
 * nos especialistas dele — prompt da SESSÃO (nunca o do chat geral), especialista sem o registro como contexto de análise, sem
 * nova análise de chamada e com a relação com o feedback calculada pelo sistema. Na voz, a consulta grava na conversa da
 * aplicação (ou na complementar, se concluída) e a fala ganha a relação + uma frase de volta ao feedback.
 */
describe("sessão de feedback com consultas aos especialistas", () => {
  const TOOLS = [{ name: "consultar_faturamento", description: "Faturamento", parameters: { type: "object", properties: {} } }]
  const orchestrator = { orchestratorId: "orch-1", orchestratorName: "Atendimento", orchestratorAgentId: "agent-orch", systemPrompt: "PROMPT DO CHAT GERAL", specialists: [{ agentId: "agent-fat", toolName: "consultar_faturamento" }], tools: TOOLS, outputInstructions: null, structuredOutput: null, recommendSupportMaterials: false }
  const consultation = { applicationId: COMPLETED_APP, subject: "Rechamada", periodLabel: "Agosto de 2026", publishedAt: "2026-09-12T13:00:00.000Z", domain: "INDICATOR" as const, indicatorNames: ["Rechamada"], materials: [], timeZone: "America/Sao_Paulo" }

  function setupConsultation() {
    const memory = createMemoryConversationStore()
    const flags: { voice: boolean[]; text: boolean[] } = { voice: [], text: [] }
    const streamed: string[] = []
    const replies: unknown[][] = []
    const specialistCalls: unknown[][] = []
    const relations: unknown[] = []
    const sessions: VoiceSessionConfig[] = []
    const original = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: JOANA }, { title: "Rechamada", text: "Apresentação", at: new Date("2026-09-30T11:00:00.000Z") })
    memory.completeConversation(original, new Date("2026-09-30T12:00:00.000Z"))
    let followUp: string | null = null
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => { req.user = user; next() })
    app.use(
      "/api/v1/realtime",
      createRealtimeRouter(fakeDb, async (config) => { sessions.push(config); return { wsUrl: "wss://x", model: "m", expiresAt: "" } }, async (_history, instruction, onChunk) => { streamed.push(instruction); onChunk("resposta em fluxo") }, {
        conversations: memory.store,
        now: () => new Date("2026-10-06T12:00:00.000Z"),
        resolveOrchestrator: async () => orchestrator as never,
        feedbackApplicationContext: async (input) => { flags.text.push(input.consultation); return { applicationId: COMPLETED_APP, instruction: `${HISTORICAL} consultas=${input.consultation}`, consultation } },
        feedbackApplicationVoice: async (input) => { flags.voice.push(input.consultation); return `${HISTORICAL} voz consultas=${input.consultation}` },
        feedbackConsultation: async () => consultation,
        consultationRelation: async (input) => { relations.push(input); return "RELAÇÃO COM O FEEDBACK EM TELA: sem relação" },
        feedbackApplicationConversation: async (input) => {
          if (input.requestedConversationId) return { conversationId: input.requestedConversationId, created: false }
          if (followUp) return { conversationId: followUp, created: false }
          followUp = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: JOANA }, { title: "Dúvidas · Rechamada", text: "-", at: new Date("2026-10-06T12:00:00.000Z") })
          memory.messages.splice(memory.messages.findIndex((message) => message.conversationId === followUp), 1)
          return { conversationId: followUp, created: true }
        },
        orchestratedReply: (async (...args: unknown[]) => {
          replies.push(args)
          const hooks = args[7] as { annotateSpecialistResult: (result: unknown) => Promise<string | null> }
          await hooks.annotateSpecialistResult({ agentId: "agent-fat", toolName: "consultar_faturamento", query: "prazo", periodDays: 30, knowledge: undefined })
          return { text: "Pelo procedimento atual, o prazo é de 5 dias úteis.", agentId: "agent-fat", calls: [{ toolName: "consultar_faturamento", query: "prazo" }], results: [], structuredResult: null, supportMaterialCandidates: [] }
        }) as never,
        specialistTool: (async (...args: unknown[]) => {
          specialistCalls.push(args)
          return { contract: "TEXT", text: "Nos últimos 7 dias, pela medição diária, sua Rechamada está em 11%.", knowledge: { retrieved: [] }, supportMaterialCandidates: [] }
        }) as never,
      }),
    )
    app.use(errorHandler)
    return { app, memory, flags, streamed, replies, specialistCalls, relations, sessions, followUpId: () => followUp }
  }

  it("voz: a sessão recebe os especialistas do Orquestrador como ferramentas e a instrução com consultas", async () => {
    const { app, flags, sessions } = setupConsultation()
    const session = await request(app).post("/api/v1/realtime/sessions").send({ feedbackApplicationId: COMPLETED_APP })
    expect(session.status).toBe(200)
    expect(sessions[0]).toMatchObject({ tools: TOOLS, systemInstruction: `${HISTORICAL} voz consultas=true`, thinkingBudget: 0 })
    expect(sessions[0]!.systemInstruction).not.toContain("PROMPT DO CHAT GERAL")
    // O navegador não recebe a instrução nem as ferramentas: elas ficam travadas no token.
    expect(session.body.data).not.toHaveProperty("systemPrompt")
    expect(session.body.data).not.toHaveProperty("tools")
    expect(flags.voice).toEqual([true])
  })

  it("texto: responde pelo Orquestrador com o prompt da SESSÃO, sem contexto compartilhado, sem nova análise de chamada e com a relação do sistema", async () => {
    const { app, memory, flags, streamed, replies, relations } = setupConsultation()
    const conversation = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: JOANA }, { title: "Rechamada", text: "Apresentação", at: new Date("2026-10-06T11:00:00.000Z") })
    const reply = await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversation, text: "Qual o prazo da contestação hoje?", clientMessageId: "77777777-aaaa-4aaa-8aaa-000000000001", systemInstruction: "persona com indicador de HOJE" })
    expect(reply.text).toContain("Pelo procedimento atual, o prazo é de 5 dias úteis.")
    expect(streamed).toHaveLength(0)
    expect(flags.text).toEqual([true])
    const [, session, , extraContext, operatorId, options] = replies[0] as [unknown, { systemPrompt: string; tools: unknown[]; outputInstructions: unknown }, unknown, string, string, { conversationFrame: string; excludedCapabilities: string[]; collaboratorConversation: boolean }]
    expect(session.systemPrompt).toContain(`${HISTORICAL} consultas=true`)
    expect(session.systemPrompt).not.toContain("PROMPT DO CHAT GERAL")
    expect(session.systemPrompt).not.toContain("HOJE")
    expect(session.tools).toEqual(TOOLS)
    expect(session.outputInstructions).toBeNull()
    expect(extraContext).toBe("")
    expect(operatorId).toBe(JOANA)
    expect(options).toMatchObject({ collaboratorConversation: true, excludedCapabilities: ["INTERACTION_ANALYSIS"] })
    expect(options.conversationFrame).toContain("sessão de feedback sobre “Rechamada”")
    expect(relations).toEqual([expect.objectContaining({ organizationId: ORG, consultation, periodDays: 30 })])
    // Resposta gravada na conversa da aplicação, com o especialista acionado.
    expect(memory.messages.filter((message) => message.conversationId === conversation).at(-1)).toMatchObject({ role: "assistant", content: "Pelo procedimento atual, o prazo é de 5 dias úteis.", agentId: "agent-fat" })
  })

  it("voz: consulta numa aplicação concluída grava na conversa complementar e a fala ganha a relação + uma frase de volta ao feedback", async () => {
    const { app, memory, specialistCalls, followUpId, relations } = setupConsultation()
    const response = await request(app).post("/api/v1/realtime/tool-call").send({ toolName: "consultar_faturamento", query: "Como está minha rechamada agora?", periodDays: 7, conversationId: null, feedbackApplicationId: COMPLETED_APP, turnId: "voice-consult-0001", callId: "call-1" })
    expect(response.status).toBe(200)
    const followUp = followUpId()!
    expect(response.body.data).toMatchObject({ conversationId: followUp, created: true, closed: false })
    expect(response.body.data.text).toBe("Nos últimos 7 dias, pela medição diária, sua Rechamada está em 11%.")
    expect(response.body.data.modelText).toContain("RELAÇÃO COM O FEEDBACK EM TELA: sem relação")
    expect(response.body.data.modelText).toContain("acrescente UMA frase curta")
    const [, organizationId, agentId, query, operatorId, periodDays, shared, options] = specialistCalls[0] as [unknown, string, string, string, string, number, unknown, { excludedCapabilities: string[]; conversationFrame: string; collaboratorConversation: boolean }]
    expect([organizationId, agentId, query, operatorId, periodDays, shared]).toEqual([ORG, "agent-fat", "Como está minha rechamada agora?", JOANA, 7, undefined])
    expect(options).toMatchObject({ collaboratorConversation: true, excludedCapabilities: ["INTERACTION_ANALYSIS"] })
    expect(options.conversationFrame).toContain("sessão de feedback sobre “Rechamada”")
    expect(relations).toEqual([expect.objectContaining({ consultation, periodDays: 7 })])
    expect(memory.messages.filter((message) => message.conversationId === followUp).map((message) => message.content)).toEqual(["Nos últimos 7 dias, pela medição diária, sua Rechamada está em 11%."])
  })

  it("voz fora de uma sessão de feedback: especialista sem moldura nem exclusão e fala sem a relação (comportamento de sempre)", async () => {
    const { app, specialistCalls, relations } = setupConsultation()
    const response = await request(app).post("/api/v1/realtime/tool-call").send({ toolName: "consultar_faturamento", query: "Qual meu TMA?", conversationId: null, turnId: "voice-general-0001", callId: "call-1" })
    expect(response.status).toBe(200)
    expect(response.body.data.modelText).not.toContain("RELAÇÃO COM O FEEDBACK")
    expect(specialistCalls[0]![7]).toEqual({ selectSupportMaterials: false, collaboratorConversation: true })
    expect(relations).toHaveLength(0)
  })

  it("voz: as palavras da pessoa (`utterance`) vão para a busca do especialista; a pergunta dele continua a `query` do modelo de voz", async () => {
    const { app, specialistCalls } = setupConsultation()
    const response = await request(app).post("/api/v1/realtime/tool-call").send({ toolName: "consultar_faturamento", query: "Procedimento de registro de contestação de fatura no atendimento B2C, passo a passo", utterance: "Como faço para registrar a contestação da fatura?", conversationId: null, turnId: "voice-general-0002", callId: "call-1" })
    expect(response.status).toBe(200)
    expect(specialistCalls[0]![3]).toBe("Procedimento de registro de contestação de fatura no atendimento B2C, passo a passo")
    expect(specialistCalls[0]![7]).toEqual({ selectSupportMaterials: false, collaboratorConversation: true, askerQuestion: "Como faço para registrar a contestação da fatura?" })
  })
})
