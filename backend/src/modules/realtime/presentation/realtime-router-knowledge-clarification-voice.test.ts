import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { ResolvedOrchestrator } from "../../assistant/application/resolve-orchestrator.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { CLARIFICATION_TOOL_NAME } from "../../knowledge-clarification/domain/clarification-state.js"
import { refOf, TEST_ORCHESTRATOR_AGENT, TEST_ORG, TEST_PERSON, TEST_SPECIALIST_AGENT, type ScriptedCall } from "../../knowledge-clarification/testing/clarification-fixtures.js"
import { fixtureClarificationService } from "../../knowledge-clarification/testing/clarification-service-fixture.js"
import type { SelfChatContext } from "../../leadership-analytics/application/self-context.js"
import { createRealtimeRouter } from "./realtime-router.js"

/**
 * VOZ DE QUEM ATENDE × ESCLARECIMENTO PELAS BASES: a pergunta encaminhada pela voz (`self_ask`) passa pelo MESMO serviço do chat de
 * texto, antes da orquestração. O estado vai para a tela (formulário, cenário, fontes) e o modelo de voz recebe a instrução de FALAR
 * a pergunta com as opções lidas de forma curta; a resposta falada volta por `self_ask` e o planejador a interpreta como texto livre;
 * a escolha no formulário (com a voz aberta, junto da consulta da voz; sem voz, pelo caminho de texto) vale exatamente e continua o
 * mesmo fluxo. O esclarecimento parte das palavras da pessoa (`utterance`), nunca da `query` do modelo de voz. Catálogo, navegação e contrato REAIS sobre as bases fictícias de
 * `testing/`; só a IA é roteirizada.
 */
const NOW = new Date("2026-10-20T12:00:00.000Z")
const operator: AuthTokenPayload = { sub: "acc-op", personId: TEST_PERSON, organizationId: TEST_ORG, role: "OPERATOR", name: "Pessoa que atende", email: "o@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
const emptyDb = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next
  if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code } })
  res.status(500).json({ error: { message: (error as Error).message } })
}
const orchestrator: ResolvedOrchestrator = { organizationId: TEST_ORG, orchestratorId: "orch-1", orchestratorName: "INIA", orchestratorAgentId: TEST_ORCHESTRATOR_AGENT, systemPrompt: "PROMPT", specialists: [{ agentId: TEST_SPECIALIST_AGENT, toolName: "agent_kb" }], tools: [], outputInstructions: null, structuredOutput: null, recommendSupportMaterials: false }
const SELF: SelfChatContext = { instructions: "[MEUS RESULTADOS]", voiceInstructions: "[VOZ]", toolset: { declarations: [], handles: () => false, execute: async () => ({ text: "", card: null }) } }

const clarify = (call: ScriptedCall) => ({ decision: "CLARIFY", questionFacts: [], clarification: { dimension: "Tipo de cliente", question: "Para qual tipo de cliente é a troca de titularidade?", selectionMode: "SINGLE", options: [{ label: "Empresa", evidence: [refOf(call.prompt, "titularidade — Empresa")] }, { label: "Residencial", evidence: [refOf(call.prompt, "— Residencial")] }] } })
const answerFor = (call: ScriptedCall) =>
  call.stage === "PLANNER"
    ? { decision: "ANSWER", answerEvidence: [refOf(call.prompt, "titularidade — Empresa", "troca comum")] }
    : { answer: `Contrato social das duas empresas e identificação dos representantes. [${refOf(call.prompt, "titularidade — Empresa", "troca comum")}]`, sources: [refOf(call.prompt, "titularidade — Empresa", "troca comum")], limitations: null }

function setup(script: (call: ScriptedCall, index: number) => unknown) {
  const memory = createMemoryConversationStore()
  const clarification = fixtureClarificationService(script, { now: () => NOW })
  const orchestratedReply = vi.fn(async () => ({ text: "Resposta do caminho de sempre.", agentId: null, calls: [], results: [], structuredResult: null, supportMaterialCandidates: [] }))
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = operator
    next()
  })
  app.use(
    "/api/v1/realtime",
    createRealtimeRouter(emptyDb, async () => ({ wsUrl: "wss://x", model: "m", expiresAt: "" }), async () => undefined, {
      conversations: memory.store,
      now: () => NOW,
      resolveOrchestrator: async () => orchestrator,
      orchestratedReply: orchestratedReply as never,
      conversationGuardrails: async () => "",
      leadershipContext: async () => null,
      selfContext: async () => SELF,
      knowledgeClarification: clarification.service,
      accessibleKnowledgeDocuments: async (_org, _person, ids) => new Set(ids),
    }),
  )
  app.use(errorHandler)
  let turn = 0
  /** Um turno de voz: a pergunta falada encaminhada por `self_ask` e, como o navegador faz no fim do turno, a fala gravada. */
  const speak = async (spoken: string, query: string, conversationId: string | null) => {
    turn += 1
    const response = await request(app).post("/api/v1/realtime/tool-call").send({ toolName: "self_ask", query, conversationId, turnId: `voice-1-${turn}`, callId: "call-1" })
    await request(app).post("/api/v1/realtime/voice-turn").send({ conversationId: response.body.data?.conversationId ?? conversationId, turnId: `voice-1-${turn}`, userText: spoken })
    return response
  }
  return { app, memory, clarification, orchestratedReply, speak }
}

afterEach(() => {
  delete process.env.INIA_KNOWLEDGE_CLARIFICATION
})

describe("voz de quem atende — esclarecimento pelas bases", () => {
  it("pergunta ambígua pela voz: estado na tela, fala com a pergunta e as opções curtas, nenhuma orquestração; gravado no canal de voz", async () => {
    const { speak, memory, clarification, orchestratedReply } = setup((call) => clarify(call))
    const response = await speak("quais documentos para troca de titularidade?", "Quais documentos preciso para troca de titularidade?", null)
    expect(response.status).toBe(200)
    const data = response.body.data as { text: string; modelText: string; clarification: { status: string; steps: { options: { label: string; evidence: { available: boolean }[] }[] }[] }; conversationId: string }
    expect(clarification.knowledge.requests[0]).toMatchObject({ viewerPersonId: TEST_PERSON, agentIds: [TEST_ORCHESTRATOR_AGENT, TEST_SPECIALIST_AGENT] })
    expect(data.clarification.status).toBe("OPEN")
    expect(data.clarification.steps[0]!.options[0]!.evidence[0]!.available).toBe(true)
    expect(data.text).toBe("Para qual tipo de cliente é a troca de titularidade?\n\nOpções encontradas nas bases consultadas: Empresa · Residencial.")
    // A fala: a pergunta, os rótulos de forma curta e a volta pela mesma ferramenta — nunca a leitura das fontes nem um resumo.
    expect(data.modelText).toContain("Empresa ou Residencial")
    expect(data.modelText).toContain('acione self_ask de novo com a pergunta original ("Quais documentos preciso para troca de titularidade?")')
    expect(data.modelText).toContain("Não leia fontes")
    expect(orchestratedReply).not.toHaveBeenCalled()
    const saved = memory.messages.find((message) => message.role === "assistant")!
    expect(saved.channel).toBe("voice")
    expect((saved.toolCalls as { toolName: string }[])[0]!.toolName).toBe(CLARIFICATION_TOOL_NAME)
  })

  it("resposta FALADA à etapa aberta: volta por self_ask e o planejador a interpreta (texto livre) — o mesmo fluxo segue até a resposta com fontes", async () => {
    const { speak, clarification } = setup((call, index) => {
      if (index === 0) return clarify(call)
      if (call.stage === "PLANNER") return { decision: "ANSWER", pendingReply: { kind: "OPTIONS", optionRefs: ["O1"] }, questionFacts: [], answerEvidence: [refOf(call.prompt, "titularidade — Empresa", "troca comum")] }
      return answerFor(call)
    })
    const first = await speak("quais documentos para troca de titularidade?", "Quais documentos preciso para troca de titularidade?", null)
    const second = await speak("é empresa", "Quais documentos preciso para troca de titularidade? — é empresa", first.body.data.conversationId)
    expect(clarification.calls[1]!.prompt).toContain("Pergunta de esclarecimento EM ABERTO")
    expect(clarification.calls[1]!.prompt).toContain('Mensagem do colaborador agora: "Quais documentos preciso para troca de titularidade? — é empresa"')
    const data = second.body.data as { text: string; modelText: string; clarification: { id: string; status: string; steps: { answer: { via: string } | null }[]; sources: unknown[] } }
    expect(data.clarification).toMatchObject({ id: first.body.data.clarification.id, status: "ANSWERED" })
    expect(data.clarification.steps[0]!.answer).toMatchObject({ via: "TEXT" })
    expect(data.text).toBe("Contrato social das duas empresas e identificação dos representantes. [1]")
    // Resposta das bases na voz: o conteúdo fiel, sem ler os marcadores de fonte.
    expect(data.modelText).toContain("Não leia os marcadores de fonte")
  })

  it("escolha no formulário depois da voz: vai pelo caminho de texto e continua o MESMO fluxo", async () => {
    const { app, speak } = setup((call, index) => (index === 0 ? clarify(call) : answerFor(call)))
    const first = await speak("quais documentos para troca de titularidade?", "Quais documentos preciso para troca de titularidade?", null)
    const view = first.body.data.clarification as { id: string; steps: { id: string; options: { id: string }[] }[] }
    const response = await request(app).post("/api/v1/realtime/messages").send({ conversationId: first.body.data.conversationId, text: "Empresa", clientMessageId: "aaaaaaaa-0000-4000-8000-0000000000f1", clarification: { clarificationId: view.id, stepId: view.steps[0]!.id, optionIds: [view.steps[0]!.options[0]!.id] } })
    expect(response.text).toContain("event: knowledge_clarification")
    expect(response.text).toContain('"status":"ANSWERED"')
  })

  it("o esclarecimento parte das palavras da PESSOA (`utterance`), nunca da `query` que o modelo de voz monta com contexto do perfil", async () => {
    const { app, clarification, orchestratedReply } = setup((call) => clarify(call))
    // Visto no QA de 20/10: a pessoa disse "Troca de titularidade." e o modelo de voz mandou o perfil junto ("atendimento B2C"); o
    // esclarecimento tomou "B2C" como dito por ela, concluiu "residencial" e pulou a etapa Empresa × Residencial.
    const rewritten = "Pessoa que atende, operadora de atendimento B2C, perguntou sobre o procedimento de troca de titularidade. Qual o processo no atendimento B2C?"
    const response = await request(app).post("/api/v1/realtime/tool-call").send({ toolName: "self_ask", query: rewritten, utterance: "Troca de titularidade.", conversationId: null, turnId: "voice-2-1", callId: "call-1" })
    expect(clarification.calls[0]!.prompt).toContain("Troca de titularidade.")
    expect(clarification.calls[0]!.prompt).not.toContain("B2C")
    expect(response.body.data.clarification).toMatchObject({ status: "OPEN", originalQuestion: "Troca de titularidade." })
    expect(orchestratedReply).not.toHaveBeenCalled()
  })

  it("escolha no formulário com a voz aberta: vai na consulta da voz (`clarification`) e vale EXATAMENTE — \"nenhuma corresponde\" + complemento, como no texto", async () => {
    const { app, speak, clarification } = setup((call, index) => (index === 0 ? clarify(call) : answerFor(call)))
    const first = await speak("quais documentos para troca de titularidade?", "Quais documentos preciso para troca de titularidade?", null)
    const view = first.body.data.clarification as { id: string; steps: { id: string }[] }
    const response = await request(app).post("/api/v1/realtime/tool-call").send({
      toolName: "self_ask",
      query: "Pessoa que atende, operadora de atendimento B2C, perguntou sobre troca de titularidade de PJ x PJ no atendimento B2C.",
      utterance: "Nenhuma das opções corresponde ao meu caso — Troca de titularidade de PJ x PJ",
      clarification: { clarificationId: view.id, stepId: view.steps[0]!.id, optionIds: [], noneMatched: true, freeText: "Troca de titularidade de PJ x PJ", revise: false },
      conversationId: first.body.data.conversationId,
      turnId: "voice-1-2",
      callId: "call-1",
    })
    expect(response.status).toBe(200)
    const data = response.body.data as { modelText: string; clarification: { id: string; status: string; steps: { answer: unknown }[] } }
    expect(data.clarification).toMatchObject({ id: view.id, status: "ANSWERED" })
    expect(data.clarification.steps[0]!.answer).toMatchObject({ via: "FORM", noneMatched: true, freeText: "Troca de titularidade de PJ x PJ", optionIds: [] })
    // A reescrita do modelo de voz não chega à IA do esclarecimento; a fala recebe a resposta das bases.
    expect(clarification.calls.slice(1).every((call) => !call.prompt.includes("B2C"))).toBe(true)
    expect(data.modelText).toContain("Não leia os marcadores de fonte")
  })

  it("pergunta que não é das bases (resultados): PASS — a orquestração de sempre responde, sem estado de esclarecimento", async () => {
    const { speak, orchestratedReply } = setup(() => ({ decision: "NOT_APPLICABLE" }))
    const response = await speak("qual meu resultado de mudança de endereço?", "Qual foi o meu resultado na mudança de endereço este mês?", null)
    expect(orchestratedReply).toHaveBeenCalledTimes(1)
    expect(response.body.data.text).toBe("Resposta do caminho de sempre.")
    expect(response.body.data.clarification).toBeUndefined()
  })

  it("retentativa da mesma chamada: a resposta gravada volta com o estado (o formulário volta à tela), sem rodar o fluxo de novo", async () => {
    const { app, clarification } = setup((call) => clarify(call))
    const body = { toolName: "self_ask", query: "Quais documentos preciso para troca de titularidade?", conversationId: null, turnId: "voice-9-1", callId: "call-1" }
    const first = await request(app).post("/api/v1/realtime/tool-call").send(body)
    const retry = await request(app).post("/api/v1/realtime/tool-call").send({ ...body, conversationId: first.body.data.conversationId })
    expect(clarification.calls).toHaveLength(1)
    expect(retry.body.data.clarification).toMatchObject({ id: first.body.data.clarification.id, status: "OPEN" })
    expect(retry.body.data.modelText).toContain("Empresa ou Residencial")
  })

  it("interruptor INIA_KNOWLEDGE_CLARIFICATION=off: a voz segue o caminho de sempre", async () => {
    process.env.INIA_KNOWLEDGE_CLARIFICATION = "off"
    const { speak, clarification, orchestratedReply } = setup((call) => clarify(call))
    await speak("quais documentos para troca de titularidade?", "Quais documentos preciso para troca de titularidade?", null)
    expect(clarification.calls).toHaveLength(0)
    expect(orchestratedReply).toHaveBeenCalledTimes(1)
  })
})
