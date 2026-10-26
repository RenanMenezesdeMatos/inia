import express from "express"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { OrchestrationConversationHooks, OrchestratedReply } from "../../assistant/application/run-orchestrated-reply.js"
import { OrchestrationSuperseded } from "../../assistant/application/run-orchestrated-reply.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import type { ClarificationOutcome, ClarificationRequest } from "../../knowledge-clarification/application/knowledge-clarification-service.js"
import { KNOWLEDGE_CLARIFICATION_VERSION } from "../../knowledge-clarification/domain/clarification-state.js"
import type { SelfChatContext } from "../../leadership-analytics/application/self-context.js"
import { createChatTurnMetrics, setChatTurnMetrics } from "../../../shared/application/observability/chat-turn-trace.js"
import { createRealtimeRouter, createSpeculation, progressLabel } from "./realtime-router.js"

/**
 * SSE do chat em fluxo: a resposta aparece enquanto é escrita (pedaços ANTES de `persisted`/`done`), o progresso é um evento
 * próprio (`status`, nunca texto da resposta), o que deixa de ser a resposta sai com `retract`, e o esclarecimento pelas bases corre
 * junto do roteamento (o que o roteamento mostraria fica guardado até ele decidir). Orquestração e esclarecimento falsos aqui.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const PERSON = "aaaaaaaa-0000-4000-8000-000000000001"
const user: AuthTokenPayload = { sub: "acc-1", personId: PERSON, organizationId: ORG, role: "OPERATOR", name: "Pessoa", email: "p@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
const emptyDb = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
const orchestrator = { organizationId: ORG, orchestratorId: "orch-1", orchestratorName: "INIA", orchestratorAgentId: "agent-orch", systemPrompt: "PROMPT", specialists: [{ agentId: "agent-esp", toolName: "agent_esp" }], tools: [], outputInstructions: null, structuredOutput: null, recommendSupportMaterials: false }
const self = { instructions: "REGRAS", voiceInstructions: "", toolset: { declarations: [], handles: (name: string) => name === "my_results", execute: async () => ({ text: "", card: null }) } } as unknown as SelfChatContext
const TRACE = { version: KNOWLEDGE_CLARIFICATION_VERSION, mode: "NEW" as const, decision: null, navigation: null, rejectedOptions: [], plannerAttempts: 1, answerAttempts: 0, issues: [] }

type Fake = (hooks: OrchestrationConversationHooks) => Promise<Partial<OrchestratedReply>>
const baseReply = { agentId: null, calls: [], results: [], structuredResult: null, supportMaterialCandidates: [] }

function setup(fake: Fake, options: { clarification?: (request: ClarificationRequest) => Promise<ClarificationOutcome> } = {}) {
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
    createRealtimeRouter(emptyDb, async () => ({ wsUrl: "wss://x", model: "m", expiresAt: "" }), async (_history, _instruction, onChunk) => onChunk("genérico"), {
      conversations: memory.store,
      now: () => new Date("2026-10-21T12:00:00.000Z"),
      resolveOrchestrator: async () => orchestrator as never,
      orchestratedReply: (async (...args: unknown[]) => ({ ...baseReply, text: "", ...(await fake((args[7] ?? {}) as OrchestrationConversationHooks)) })) as never,
      conversationGuardrails: async () => "",
      leadershipContext: async () => null,
      selfContext: async () => self,
      knowledgeClarification: options.clarification ? { handle: options.clarification } : null,
    }),
  )
  return { app, memory }
}

function events(text: string) {
  return text.split("\n\n").filter(Boolean).flatMap((block) => {
    const event = /^event: (.+)$/m.exec(block)?.[1]
    const data = /^data: (.+)$/m.exec(block)?.[1]
    return event && data ? [{ event, data: JSON.parse(data) as Record<string, unknown> }] : []
  })
}
/** O que a tela mostra: os pedaços, com cada `retract` apagando o que veio antes. */
const screen = (sse: { event: string; data: Record<string, unknown> }[]) => sse.reduce((shown, item) => (item.event === "retract" ? "" : item.event === "chunk" ? shown + String(item.data.text) : shown), "")

const post = (app: express.Express, key: string) => request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Como contesto uma fatura?", clientMessageId: `aaaaaaaa-0000-4000-8000-0000000000${key}` })

let logs: string[] = []
beforeEach(() => {
  logs = []
  setChatTurnMetrics(createChatTurnMetrics())
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    logs.push(String(line))
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.INIA_KNOWLEDGE_CLARIFICATION
})

describe("chat em fluxo — SSE", () => {
  it("pedaços chegam ANTES de gravar; progresso é evento próprio; o texto gravado é exatamente o da tela; rastreamento no log", async () => {
    const { app, memory } = setup(async (hooks) => {
      hooks.stream!.progress({ stage: "TOOLS", tools: ["agent_esp"] })
      hooks.stream!.progress({ stage: "WRITING" })
      hooks.stream!.text("Para contestar, ")
      hooks.stream!.text("abra a contestação.")
      return { text: "Para contestar, abra a contestação.", streamedText: "Para contestar, abra a contestação." }
    })
    const response = await post(app, "01")
    expect(response.headers["x-inia-trace-id"]).toMatch(/^[0-9a-f-]{36}$/)
    expect(response.headers["x-accel-buffering"]).toBe("no")
    const sse = events(response.text)
    expect(sse.map((item) => item.event)).toEqual(["conversation", "status", "status", "chunk", "chunk", "persisted", "done"])
    expect(sse.filter((item) => item.event === "status").map((item) => item.data.label)).toEqual(["Consultando as bases de conhecimento…", "Escrevendo a resposta…"])
    expect(screen(sse)).toBe("Para contestar, abra a contestação.")
    expect(memory.messages.at(-1)!.content).toBe("Para contestar, abra a contestação.")
    const timing = JSON.parse(logs.find((line) => line.includes('"chat_turn_timing"'))!) as Record<string, unknown>
    expect(timing).toMatchObject({ path: "ORCHESTRATED", outcome: "OK", channel: "chat" })
    expect(typeof timing.firstContentMs).toBe("number")
    expect(JSON.stringify(timing)).not.toContain("contesta")
  })

  it("texto final diferente do mostrado: `retract` e o texto inteiro — a tela nunca duplica", async () => {
    const { app } = setup(async (hooks) => {
      hooks.stream!.text("Rascunho")
      return { text: "Resposta final.", streamedText: "Rascunho" }
    })
    const sse = events((await post(app, "02")).text)
    expect(sse.map((item) => item.event)).toEqual(["conversation", "chunk", "retract", "chunk", "persisted", "done"])
    expect(screen(sse)).toBe("Resposta final.")
  })

  it("sem fluxo (o texto não foi mostrado): sai inteiro num pedaço, como antes", async () => {
    const { app } = setup(async () => ({ text: "Inteiro." }))
    const sse = events((await post(app, "03")).text)
    expect(sse.map((item) => item.event)).toEqual(["conversation", "chunk", "persisted", "done"])
    expect(screen(sse)).toBe("Inteiro.")
  })

  it("esclarecimento PASS: o que o roteamento mostrou enquanto ele decidia sai depois, na ordem, e as ferramentas só rodam depois", async () => {
    let release: () => void = () => {}
    const decided = new Promise<void>((resolve) => {
      release = resolve
    })
    const order: string[] = []
    const { app } = setup(
      async (hooks) => {
        hooks.stream!.text("Olá! ")
        order.push("roteamento")
        const go = await hooks.proceed!()
        order.push(`ferramentas:${go}`)
        hooks.stream!.text("Tudo certo.")
        return { text: "Olá! Tudo certo.", streamedText: "Olá! Tudo certo." }
      },
      {
        clarification: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          order.push("esclarecimento")
          release()
          return { kind: "PASS", reason: "NOT_APPLICABLE", trace: TRACE }
        },
      },
    )
    const sse = events((await post(app, "04")).text)
    await decided
    expect(order).toEqual(["roteamento", "esclarecimento", "ferramentas:true"])
    expect(screen(sse)).toBe("Olá! Tudo certo.")
    expect(sse.map((item) => item.event)).toEqual(["conversation", "status", "chunk", "chunk", "persisted", "done"])
  })

  it("esclarecimento REPLY: o que o roteamento guardou nunca aparece e nenhuma ferramenta roda", async () => {
    let toolsRan = false
    const { app } = setup(
      async (hooks) => {
        hooks.stream!.text("Texto do roteamento")
        if (!(await hooks.proceed!())) throw new OrchestrationSuperseded()
        toolsRan = true
        return { text: "não deveria" }
      },
      { clarification: async () => ({ kind: "REPLY", content: "Qual cenário?", state: { version: KNOWLEDGE_CLARIFICATION_VERSION, id: "11111111-1111-4111-8111-111111111111", originalQuestion: "q", status: "OPEN", steps: [], questionFacts: [], coverage: { consideredDocuments: 1, matchedDocuments: 1, presentedDocuments: 1, omittedDocuments: 0, complete: true }, sources: [], conflicts: [], notice: null, updatedAt: "2026-10-21T12:00:00.000Z" }, trace: TRACE } as never) },
    )
    const sse = events((await post(app, "05")).text)
    expect(screen(sse)).toBe("Qual cenário?")
    expect(toolsRan).toBe(false)
    expect(sse.some((item) => item.event === "error")).toBe(false)
  })

  const answered = (content: string) => ({ kind: "REPLY", content, state: { version: KNOWLEDGE_CLARIFICATION_VERSION, id: "11111111-1111-4111-8111-111111111112", originalQuestion: "q", status: "ANSWERED", steps: [], questionFacts: [], coverage: { consideredDocuments: 1, matchedDocuments: 1, presentedDocuments: 1, omittedDocuments: 0, complete: true }, sources: [], conflicts: [], notice: null, updatedAt: "2026-10-21T12:00:00.000Z" }, trace: TRACE }) as never

  it("resposta pelas bases em fluxo: pedaços marcados (`citations`) antes de gravar, completados pela validada; o roteamento guardado nunca aparece", async () => {
    const { app, memory } = setup(
      async (hooks) => {
        hooks.stream!.text("Texto do roteamento")
        if (!(await hooks.proceed!())) throw new OrchestrationSuperseded()
        return { text: "não deveria" }
      },
      {
        clarification: async (input) => {
          input.stream!.status!("Escrevendo a resposta com as fontes…")
          input.stream!.text("Abra a contestação ")
          input.stream!.text("pelo protocolo [1]")
          return answered("Abra a contestação pelo protocolo [1].")
        },
      },
    )
    const sse = events((await post(app, "06")).text)
    expect(sse.map((item) => item.event)).toEqual(["conversation", "status", "status", "chunk", "chunk", "chunk", "persisted", "knowledge_clarification", "done"])
    expect(sse.filter((item) => item.event === "chunk").every((item) => item.data.citations === true)).toBe(true)
    expect(screen(sse)).toBe("Abra a contestação pelo protocolo [1].")
    expect(memory.messages.at(-1)!.content).toBe("Abra a contestação pelo protocolo [1].")
    expect(JSON.parse(logs.find((line) => line.includes('"chat_turn_timing"'))!)).toMatchObject({ path: "CLARIFICATION" })
  })

  it("esclarecimento desiste depois de mostrar algo (PASS): o que apareceu sai antes, e só então o caminho de sempre aparece", async () => {
    const { app } = setup(
      async (hooks) => {
        hooks.stream!.text("Resposta ")
        await hooks.proceed!()
        hooks.stream!.text("de sempre.")
        return { text: "Resposta de sempre.", streamedText: "Resposta de sempre." }
      },
      {
        clarification: async (input) => {
          // O serviço retira ao desistir; a garantia do router cobre um serviço que esqueça.
          input.stream!.text("Rascunho pelas bases [1]")
          return { kind: "PASS", reason: "ANSWER_FAILED", trace: TRACE }
        },
      },
    )
    const sse = events((await post(app, "07")).text)
    expect(sse.map((item) => item.event)).toEqual(["conversation", "status", "chunk", "retract", "chunk", "chunk", "persisted", "done"])
    expect(screen(sse)).toBe("Resposta de sempre.")
  })
})

describe("peças do fluxo", () => {
  it("especulação: guarda, solta na ordem, ou descarta", async () => {
    const seen: string[] = []
    const target = { text: (chunk: string) => seen.push(chunk), retract: () => seen.push("<retract>"), progress: () => seen.push("<progress>") }
    const kept = createSpeculation(target)
    kept.stream.text("a")
    kept.stream.progress({ stage: "WRITING" })
    expect(seen).toEqual([])
    kept.release()
    kept.stream.text("b")
    expect(seen).toEqual(["a", "<progress>", "b"])
    await expect(kept.decided()).resolves.toBe(true)

    const dropped = createSpeculation(target)
    dropped.stream.text("x")
    dropped.discard()
    dropped.stream.text("y")
    expect(seen).toEqual(["a", "<progress>", "b"])
    expect(dropped.stream.allow!()).toBe(false)
    await expect(dropped.decided()).resolves.toBe(false)
  })

  it("rótulo do progresso: palavras de quem usa, nunca nomes internos", () => {
    const isData = (name: string) => name === "my_results"
    expect(progressLabel({ stage: "TOOLS", tools: ["agent_faturamento"] }, isData)).toBe("Consultando as bases de conhecimento…")
    expect(progressLabel({ stage: "TOOLS", tools: ["my_results"] }, isData)).toBe("Consultando os dados…")
    expect(progressLabel({ stage: "TOOLS", tools: ["my_results", "agent_x"] }, isData)).toBe("Consultando os dados e as bases de conhecimento…")
    expect(progressLabel({ stage: "TOOLS", tools: ["leadership_process"] }, () => true)).toBe("Consultando o processo nas bases de conhecimento…")
    expect(progressLabel({ stage: "WRITING" }, isData)).toBe("Escrevendo a resposta…")
  })
})
