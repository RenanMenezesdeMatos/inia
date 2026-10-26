import express from "express"
import request from "supertest"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { FEEDBACK_PRESENTATION_CUE } from "../../feedback-application/domain/application-presentation.js"
import type { ClarificationOutcome, ClarificationRequest } from "../../knowledge-clarification/application/knowledge-clarification-service.js"
import { CLARIFICATION_TOOL_NAME, KNOWLEDGE_CLARIFICATION_VERSION, optionIdFor, stepIdFor, type ClarificationState } from "../../knowledge-clarification/domain/clarification-state.js"
import { createRealtimeRouter } from "./realtime-router.js"

/**
 * `PRODUCT_APPLICABILITY_V1` — confirmação do produto na CONVERSA sobre um feedback. Quando a análise da gravação não estabeleceu o
 * produto, a sessão usa o mesmo esclarecimento pelas bases do chat: a IA pergunta (curto) só quando a orientação depende do produto; a
 * escolha fica gravada com procedência `CHAT_CONFIRMATION` (nunca evidência da gravação). Sem produto pendente, a sessão é a de sempre.
 * Serviço de esclarecimento falso aqui (testado à parte); produtos são EXEMPLOS FICTÍCIOS de teste.
 */
const ORG = "00000000-0000-4000-8000-0000000000b2"
const JOANA = "aaaaaaaa-0000-4000-8000-000000000002"
const user: AuthTokenPayload = { sub: "acc-2", personId: JOANA, organizationId: ORG, role: "OPERATOR", name: "Joana", email: "j@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
const emptyDb = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
const orchestrator = { organizationId: ORG, orchestratorId: "orch-1", orchestratorName: "INIA", orchestratorAgentId: "agent-orch", systemPrompt: "PROMPT", specialists: [{ agentId: "agent-esp-1", toolName: "agent_esp_1" }], tools: [], outputInstructions: null, structuredOutput: null, recommendSupportMaterials: false }
const NOW = new Date("2026-10-21T12:00:00.000Z")
const PRODUCT_CONTEXT = "Feedback sobre: Segunda via.\nProduto do atendimento (o que a análise da gravação estabeleceu):\n- O produto do pedido NÃO ficou estabelecido pela gravação."

function productQuestion(): ClarificationState {
  const dimension = "Produto"
  const source = (documentId: string) => ({ documentId, documentTitle: `Base ${documentId} (fictícia)`, versionId: `${documentId}-v1`, heading: "1. Procedimento", chunkIndex: 0 })
  return {
    version: KNOWLEDGE_CLARIFICATION_VERSION,
    id: "22222222-2222-4222-8222-222222222222",
    originalQuestion: "Como eu devia ter feito a segunda via?",
    status: "OPEN",
    steps: [{ id: stepIdFor(1, dimension), dimension, question: "Era de qual produto?", selectionMode: "SINGLE", options: ["Tronco de voz", "Ramal direto"].map((label, index) => ({ id: optionIdFor(dimension, label), label, description: null, group: null, evidence: [source(`kb-${index}`)] })), answer: null }],
    questionFacts: [],
    coverage: { consideredDocuments: 2, matchedDocuments: 2, presentedDocuments: 2, omittedDocuments: 0, complete: true },
    sources: [],
    conflicts: [],
    notice: null,
    updatedAt: NOW.toISOString(),
  }
}
const TRACE = { version: KNOWLEDGE_CLARIFICATION_VERSION, mode: "NEW" as const, decision: "CLARIFY" as const, navigation: null, rejectedOptions: [], plannerAttempts: 1, answerAttempts: 0, issues: [] }

function setup(outcomes: ClarificationOutcome[], options: { productContext?: string | null } = {}) {
  const memory = createMemoryConversationStore()
  const requests: ClarificationRequest[] = []
  const streamed = vi.fn(async (_history: unknown, _instruction: string, onChunk: (text: string) => void) => onChunk("resposta da sessão"))
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = user
    next()
  })
  app.use(
    "/api/v1/realtime",
    createRealtimeRouter(emptyDb, async () => ({ wsUrl: "wss://x", model: "m", expiresAt: "" }), streamed as never, {
      conversations: memory.store,
      now: () => NOW,
      resolveOrchestrator: async () => orchestrator as never,
      conversationGuardrails: async () => "",
      feedbackApplicationContext: async () => ({ applicationId: "app-1", instruction: "REGISTRO", productContext: options.productContext === undefined ? PRODUCT_CONTEXT : options.productContext }),
      knowledgeClarification: {
        handle: async (input) => {
          requests.push(input)
          const next = outcomes.shift()
          if (!next) throw new Error("sem roteiro")
          return next
        },
      },
      accessibleKnowledgeDocuments: async (_organizationId, _personId, ids) => new Set(ids),
    }),
  )
  const conversation = memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: JOANA }, { title: "Segunda via", text: "Olá, Joana! …", at: new Date("2026-10-21T11:00:00.000Z") })
  return { app, memory, requests, streamed, conversation }
}
function events(text: string) {
  return text.split("\n\n").filter(Boolean).flatMap((block) => {
    const event = /^event: (.+)$/m.exec(block)?.[1]
    const data = /^data: (.+)$/m.exec(block)?.[1]
    return event && data ? [{ event, data: JSON.parse(data) as Record<string, unknown> }] : []
  })
}
afterEach(() => {
  delete process.env.INIA_KNOWLEDGE_CLARIFICATION
})

describe("sessão de feedback — produto não estabelecido pela gravação", () => {
  it("pergunta curta pelo esclarecimento, com o registro como contexto; a pergunta fica gravada com procedência CHAT_CONFIRMATION", async () => {
    const state = productQuestion()
    const { app, memory, requests, streamed, conversation } = setup([{ kind: "REPLY", content: "Era de qual produto? Opções: Tronco de voz · Ramal direto.", state, trace: TRACE }])
    const sse = events((await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversation, text: "Como eu devia ter feito a segunda via?", clientMessageId: "bbbbbbbb-0000-4000-8000-00000000d001" })).text)
    expect(sse.map((item) => item.event)).toEqual(["conversation", "chunk", "persisted", "knowledge_clarification", "done"])
    expect(streamed).not.toHaveBeenCalled()
    expect(requests[0]).toMatchObject({ orchestratorAgentId: "agent-orch", specialistAgentIds: ["agent-esp-1"], sessionContext: PRODUCT_CONTEXT, previous: null })
    const saved = memory.messages.filter((message) => message.role === "assistant").at(-1)!
    expect(saved.toolCalls).toEqual([expect.objectContaining({ toolName: CLARIFICATION_TOOL_NAME, scope: { kind: "FEEDBACK_SESSION", applicationId: "app-1", provenance: "CHAT_CONFIRMATION" } })])
  })

  it("a escolha continua o MESMO esclarecimento (estado lido do banco, só o desta sessão)", async () => {
    const state = productQuestion()
    const answered: ClarificationState = { ...state, status: "ANSWERED", steps: [{ ...state.steps[0]!, answer: { optionIds: [state.steps[0]!.options[0]!.id], freeText: null, noneMatched: false, via: "FORM", answeredAt: NOW.toISOString() } }] }
    const { app, requests, conversation } = setup([
      { kind: "REPLY", content: "Era de qual produto?", state, trace: TRACE },
      { kind: "REPLY", content: "Como você me disse que era o tronco de voz: …", state: answered, trace: { ...TRACE, mode: "ANSWER", decision: "ANSWER" } },
    ])
    await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversation, text: "Como eu devia ter feito a segunda via?", clientMessageId: "bbbbbbbb-0000-4000-8000-00000000d101" })
    const choice = { clarificationId: state.id, stepId: state.steps[0]!.id, optionIds: [state.steps[0]!.options[0]!.id] }
    await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversation, text: "Tronco de voz", clientMessageId: "bbbbbbbb-0000-4000-8000-00000000d102", clarification: choice })
    expect(requests[1]).toMatchObject({ answer: { ...choice, noneMatched: false, revise: false }, previous: { state, isLatestAssistantMessage: true }, sessionContext: PRODUCT_CONTEXT })
  })

  it("PASS (pergunta sobre o próprio feedback): a sessão responde como sempre", async () => {
    const { app, streamed, conversation } = setup([{ kind: "PASS", reason: "NOT_APPLICABLE", trace: TRACE }])
    const sse = events((await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversation, text: "Por que recebi este feedback?", clientMessageId: "bbbbbbbb-0000-4000-8000-00000000d201" })).text)
    expect(streamed).toHaveBeenCalledTimes(1)
    expect(sse.some((item) => item.event === "knowledge_clarification")).toBe(false)
  })

  it("sem produto pendente no registro, ou no sinal de abertura da tela, o esclarecimento nem é chamado (comportamento de sempre)", async () => {
    const noProduct = setup([], { productContext: null })
    await request(noProduct.app).post("/api/v1/realtime/messages").send({ conversationId: noProduct.conversation, text: "Como eu devia ter feito?", clientMessageId: "bbbbbbbb-0000-4000-8000-00000000d301" })
    expect(noProduct.requests).toEqual([])
    expect(noProduct.streamed).toHaveBeenCalledTimes(1)
    const cue = setup([])
    await request(cue.app).post("/api/v1/realtime/messages").send({ conversationId: cue.conversation, text: FEEDBACK_PRESENTATION_CUE, clientMessageId: "bbbbbbbb-0000-4000-8000-00000000d302" })
    expect(cue.requests).toEqual([])
  })

  it("interruptor do esclarecimento desligado: a sessão é a de sempre", async () => {
    process.env.INIA_KNOWLEDGE_CLARIFICATION = "off"
    const { app, requests, streamed, conversation } = setup([])
    await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversation, text: "Como eu devia ter feito?", clientMessageId: "bbbbbbbb-0000-4000-8000-00000000d401" })
    expect(requests).toEqual([])
    expect(streamed).toHaveBeenCalledTimes(1)
  })
})
