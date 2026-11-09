import express from "express"
import request from "supertest"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import type { ClarificationOutcome, ClarificationRequest } from "../../knowledge-clarification/application/knowledge-clarification-service.js"
import { CLARIFICATION_ANSWER_TOOL_NAME, CLARIFICATION_TOOL_NAME, KNOWLEDGE_CLARIFICATION_VERSION, optionIdFor, stepIdFor, type ClarificationState } from "../../knowledge-clarification/domain/clarification-state.js"
import type { LeadershipChatContext } from "../../leadership-analytics/application/leadership-context.js"
import { OrchestrationSuperseded } from "../../assistant/application/run-orchestrated-reply.js"
import { createRealtimeRouter } from "./realtime-router.js"

/**
 * Chat de texto × esclarecimento pelas bases: o roteador roda o esclarecimento ANTES da orquestração para quem atende (conversa
 * própria, com Orquestrador), grava a pergunta com as opções (estado em `tool_calls`), envia o estado num evento SSE próprio,
 * grava a escolha do formulário com o payload estruturado, relê o estado do BANCO (nunca do navegador) e, ao reabrir a conversa,
 * revalida o acesso às bases citadas. PASS = o caminho de sempre. O serviço é falso aqui (testado à parte).
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const PERSON = "aaaaaaaa-0000-4000-8000-000000000001"
const user: AuthTokenPayload = { sub: "acc-1", personId: PERSON, organizationId: ORG, role: "OPERATOR", name: "Pessoa", email: "p@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
const emptyDb = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
const orchestrator = { organizationId: ORG, orchestratorId: "orch-1", orchestratorName: "INIA", orchestratorAgentId: "agent-orch", systemPrompt: "PROMPT", specialists: [{ agentId: "agent-esp-1", toolName: "agent_esp_1" }, { agentId: "agent-esp-2", toolName: "agent_esp_2" }], tools: [], outputInstructions: null, structuredOutput: null, recommendSupportMaterials: false }
const NOW = new Date("2026-10-20T12:00:00.000Z")

/** Estado fictício de um esclarecimento aberto (bases de teste). */
function openState(): ClarificationState {
  const dimension = "Dimensão de teste"
  const source = (documentId: string) => ({ documentId, documentTitle: `Base ${documentId} (fictícia)`, versionId: `${documentId}-v1`, heading: "1. Seção", chunkIndex: 0 })
  return {
    version: KNOWLEDGE_CLARIFICATION_VERSION,
    id: "11111111-1111-4111-8111-111111111111",
    originalQuestion: "Pergunta genérica de teste?",
    status: "OPEN",
    steps: [{ id: stepIdFor(1, dimension), dimension, question: "Qual cenário de teste?", selectionMode: "SINGLE", options: ["Cenário A", "Cenário B"].map((label, index) => ({ id: optionIdFor(dimension, label), label, description: null, group: null, evidence: [source(`kb-${index}`)] })), answer: null }],
    questionFacts: [],
    coverage: { consideredDocuments: 3, matchedDocuments: 2, presentedDocuments: 2, omittedDocuments: 0, complete: true },
    sources: [],
    conflicts: [],
    notice: null,
    updatedAt: NOW.toISOString(),
  }
}
const TRACE = { version: KNOWLEDGE_CLARIFICATION_VERSION, mode: "NEW" as const, decision: "CLARIFY" as const, navigation: null, rejectedOptions: [], plannerAttempts: 1, answerAttempts: 0, issues: [] }

function setup(outcomes: ClarificationOutcome[], options: { leadership?: boolean; orchestrator?: boolean; accessible?: (id: string) => boolean } = {}) {
  const memory = createMemoryConversationStore()
  const responseChecks: { text: string; sources?: unknown }[] = []
  const requests: ClarificationRequest[] = []
  // Orquestração falsa que respeita o portão `proceed` como a real: superada = nenhuma ferramenta roda e nada é respondido.
  const proceeded: boolean[] = []
  const orchestratedReply = vi.fn(async (...args: unknown[]) => {
    const hooks = args[7] as { proceed?: () => Promise<boolean> } | undefined
    if (hooks?.proceed) {
      const go = await hooks.proceed()
      proceeded.push(go)
      if (!go) throw new OrchestrationSuperseded()
    }
    return { text: "Resposta do caminho de sempre.", agentId: null, calls: [], results: [], structuredResult: null, supportMaterialCandidates: [] }
  })
  const leadership = options.leadership ? ({ instructions: "LIDERANÇA", voiceInstructions: "", toolset: { declarations: [], handles: () => false, execute: async () => ({ text: "", card: null }) }, processScope: null } as unknown as LeadershipChatContext) : null
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = user
    next()
  })
  app.use(
    "/api/v1/realtime",
    createRealtimeRouter(emptyDb, async () => ({ wsUrl: "wss://x", model: "m", expiresAt: "" }), async (_history, _instruction, onChunk) => onChunk("genérico"), {
      conversations: memory.store,
      now: () => NOW,
      resolveOrchestrator: async () => (options.orchestrator === false ? null : (orchestrator as never)),
      orchestratedReply: orchestratedReply as never,
      conversationGuardrails: async () => "",
      leadershipContext: async () => leadership,
      selfContext: async () => null,
      knowledgeClarification: {
        handle: async (input) => {
          requests.push(input)
          const next = outcomes.shift()
          if (!next) throw new Error("sem roteiro")
          return next
        },
      },
      accessibleKnowledgeDocuments: async (_organizationId, _personId, ids) => new Set(ids.filter((id) => options.accessible?.(id) ?? true)),
      responseCheck: async (_db, input) => {
        responseChecks.push(input)
        return { outcome: "NOT_APPLICABLE" }
      },
    }),
  )
  return { app, memory, requests, orchestratedReply, proceeded, responseChecks }
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

describe("chat de texto — esclarecimento pelas bases", () => {
  it("resposta pelas bases: a conferência recebe o texto das seções usadas; pergunta e opções vão sem seção", async () => {
    const state = openState()
    const groundedOn = [{ documentTitle: "Reparo — Linha Móvel", heading: "Prazo", excerpt: "Abra a análise de rede, com prazo de até 72 horas." }]
    const { app, responseChecks } = setup([{ kind: "REPLY", content: "O prazo é de até 72 horas. [1]", state, trace: TRACE, groundedOn }])
    await request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Qual o prazo do reparo?", clientMessageId: "aaaaaaaa-0000-4000-8000-00000000c0f1" })
    expect(responseChecks[0]!.sources).toEqual([{ origin: "KNOWLEDGE", title: "Reparo — Linha Móvel › Prazo", text: groundedOn[0]!.excerpt }])

    const asking = setup([{ kind: "REPLY", content: "Qual cenário de teste?", state, trace: TRACE }])
    await request(asking.app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Pergunta genérica de teste?", clientMessageId: "aaaaaaaa-0000-4000-8000-00000000c0f2" })
    expect(asking.responseChecks[0]!.sources).toEqual([])
  })

  it("pergunta ambígua: grava a pergunta com as opções, envia o estado validado num evento próprio e a orquestração (que corria junto) é descartada sem rodar ferramentas", async () => {
    const state = openState()
    const { app, memory, requests, orchestratedReply, proceeded } = setup([{ kind: "REPLY", content: "Qual cenário de teste?\n\nOpções encontradas nas bases consultadas: Cenário A · Cenário B.", state, trace: TRACE }])
    const response = await request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Pergunta genérica de teste?", clientMessageId: "aaaaaaaa-0000-4000-8000-00000000c001" })
    const sse = events(response.text)
    expect(sse.map((item) => item.event)).toEqual(["conversation", "status", "chunk", "persisted", "knowledge_clarification", "done"])
    const clarification = sse.find((item) => item.event === "knowledge_clarification")!.data as { interactionId: string; clarification: { id: string; steps: { options: { evidence: { available: boolean }[] }[] }[]; scenario: unknown[] } }
    expect(clarification.clarification.id).toBe(state.id)
    expect(clarification.clarification.steps[0]!.options[0]!.evidence[0]!.available).toBe(true)
    expect(clarification.clarification.scenario).toEqual([])
    // Pergunta nova: o roteamento correu junto do esclarecimento, mas foi superado antes de qualquer ferramenta.
    expect(orchestratedReply).toHaveBeenCalledTimes(1)
    expect(proceeded).toEqual([false])
    // O serviço recebe a pessoa, os agentes do Orquestrador dela e nenhum estado anterior.
    expect(requests[0]).toMatchObject({ organizationId: ORG, personId: PERSON, orchestratorAgentId: "agent-orch", specialistAgentIds: ["agent-esp-1", "agent-esp-2"], answer: null, previous: null, recentTurns: [] })
    // Gravado: o estado (e o rastro) em tool_calls da resposta da INIA.
    const conversationId = (sse[0]!.data as { conversationId: string }).conversationId
    const page = await memory.store.loadMessages({ organizationId: ORG, conversationId, limit: 10 })
    expect(page.messages.at(-1)!.clarification).toEqual(state)
    expect(page.messages.at(-1)!.content).toContain("Opções encontradas nas bases consultadas")
  })

  it("escolha no formulário: a mensagem legível é gravada com o payload estruturado e o estado vem do BANCO", async () => {
    const state = openState()
    const answered: ClarificationState = { ...state, status: "ANSWERED", steps: [{ ...state.steps[0]!, answer: { optionIds: [state.steps[0]!.options[0]!.id], freeText: null, noneMatched: false, via: "FORM", answeredAt: NOW.toISOString() } }], sources: [{ documentId: "kb-0", documentTitle: "Base kb-0 (fictícia)", versionId: "kb-0-v1", heading: "1. Seção", chunkIndex: 0 }] }
    const { app, memory, requests } = setup([
      { kind: "REPLY", content: "Qual cenário de teste?", state, trace: TRACE },
      { kind: "REPLY", content: "Resposta com fonte [1].", state: answered, trace: { ...TRACE, mode: "ANSWER", decision: "ANSWER" } },
    ])
    const first = events((await request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Pergunta genérica de teste?", clientMessageId: "aaaaaaaa-0000-4000-8000-00000000c101" })).text)
    const conversationId = (first[0]!.data as { conversationId: string }).conversationId
    const choice = { clarificationId: state.id, stepId: state.steps[0]!.id, optionIds: [state.steps[0]!.options[0]!.id] }
    const second = events((await request(app).post("/api/v1/realtime/messages").send({ conversationId, text: "Cenário A", clientMessageId: "aaaaaaaa-0000-4000-8000-00000000c102", clarification: choice })).text)
    expect(second.find((item) => item.event === "knowledge_clarification")!.data).toMatchObject({ clarification: { status: "ANSWERED", sources: [{ documentId: "kb-0", available: true }] } })
    expect(requests[1]).toMatchObject({ text: "Cenário A", answer: { ...choice, noneMatched: false, revise: false }, previous: { state, isLatestAssistantMessage: true } })
    // Só os turnos ANTERIORES vão como contexto (a mensagem nova é a escolha em si).
    expect(requests[1]!.recentTurns.map((turn) => turn.role)).toEqual(["user", "model"])
    const userMessage = memory.messages.find((message) => message.clientMessageId === "aaaaaaaa-0000-4000-8000-00000000c102")!
    expect(userMessage.toolCalls).toEqual([{ toolName: CLARIFICATION_ANSWER_TOOL_NAME, ...choice, noneMatched: false, revise: false }])
  })

  it("PASS (não é pergunta das bases ou falhou numa pergunta nova): o caminho de sempre responde, sem evento de esclarecimento", async () => {
    const { app, orchestratedReply } = setup([{ kind: "PASS", reason: "NOT_APPLICABLE", trace: TRACE }])
    const sse = events((await request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Como estão meus resultados?", clientMessageId: "aaaaaaaa-0000-4000-8000-00000000c201" })).text)
    expect(orchestratedReply).toHaveBeenCalledTimes(1)
    expect(sse.find((item) => item.event === "chunk")!.data.text).toBe("Resposta do caminho de sempre.")
    expect(sse.some((item) => item.event === "knowledge_clarification")).toBe(false)
  })

  it("reabrir a conversa: o estado volta revalidado — base que a pessoa não pode mais ler aparece sem título", async () => {
    const { app } = setup([{ kind: "REPLY", content: "Qual cenário de teste?", state: openState(), trace: TRACE }], { accessible: (id) => id !== "kb-1" })
    const first = events((await request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Pergunta genérica de teste?", clientMessageId: "aaaaaaaa-0000-4000-8000-00000000c301" })).text)
    const conversationId = (first[0]!.data as { conversationId: string }).conversationId
    const page = await request(app).get(`/api/v1/realtime/conversations/${conversationId}/messages`)
    const assistant = (page.body.data.messages as { role: string; clarification: { steps: { options: { evidence: { available: boolean; documentTitle: string }[] }[] }[] } | null }[]).find((message) => message.role === "assistant")!
    expect(assistant.clarification!.steps[0]!.options[0]!.evidence[0]).toMatchObject({ available: true, documentTitle: "Base kb-0 (fictícia)" })
    expect(assistant.clarification!.steps[0]!.options[1]!.evidence[0]).toMatchObject({ available: false, documentTitle: "" })
    const userMessage = (page.body.data.messages as { role: string; clarification: unknown }[]).find((message) => message.role === "user")!
    expect(userMessage.clarification).toBeNull()
  })

  it("retentativa da mesma mensagem: devolve a resposta gravada E o estado do esclarecimento, sem rodar o fluxo de novo", async () => {
    const { app, requests } = setup([{ kind: "REPLY", content: "Qual cenário de teste?", state: openState(), trace: TRACE }])
    const body = { conversationId: null, text: "Pergunta genérica de teste?", clientMessageId: "aaaaaaaa-0000-4000-8000-00000000c401" }
    const first = events((await request(app).post("/api/v1/realtime/messages").send(body)).text)
    const conversationId = (first[0]!.data as { conversationId: string }).conversationId
    const retry = events((await request(app).post("/api/v1/realtime/messages").send({ ...body, conversationId })).text)
    expect(retry.map((item) => item.event)).toEqual(["conversation", "chunk", "persisted", "knowledge_clarification", "done"])
    expect(requests).toHaveLength(1)
  })

  it("quem lidera não passa pelo esclarecimento (a consulta de processo segue o caminho da liderança); escolha enviada nesse caso = erro", async () => {
    const { app, requests } = setup([], { leadership: true })
    const sse = events((await request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Pergunta genérica de teste?", clientMessageId: "aaaaaaaa-0000-4000-8000-00000000c501" })).text)
    expect(requests).toHaveLength(0)
    expect(sse.some((item) => item.event === "error")).toBe(false)
    const state = openState()
    const withChoice = events((await request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Cenário A", clientMessageId: "aaaaaaaa-0000-4000-8000-00000000c502", clarification: { clarificationId: state.id, stepId: state.steps[0]!.id, optionIds: [state.steps[0]!.options[0]!.id] } })).text)
    expect(withChoice.find((item) => item.event === "error")!.data.message).toContain("Este esclarecimento não está mais disponível")
  })

  it("sem Orquestrador: chat genérico de sempre; interruptor INIA_KNOWLEDGE_CLARIFICATION=off desliga o fluxo", async () => {
    const without = setup([], { orchestrator: false })
    events((await request(without.app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Pergunta?", clientMessageId: "aaaaaaaa-0000-4000-8000-00000000c601" })).text)
    expect(without.requests).toHaveLength(0)
    process.env.INIA_KNOWLEDGE_CLARIFICATION = "off"
    const off = setup([])
    events((await request(off.app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Pergunta?", clientMessageId: "aaaaaaaa-0000-4000-8000-00000000c602" })).text)
    expect(off.requests).toHaveLength(0)
    expect(off.orchestratedReply).toHaveBeenCalledTimes(1)
  })

  it("estado gravado em tool_calls usa o nome reservado do fluxo", () => {
    expect(CLARIFICATION_TOOL_NAME).toBe("knowledge_clarification")
  })
})
