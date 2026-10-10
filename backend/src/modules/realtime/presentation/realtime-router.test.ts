import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import type { ConversationStore } from "../../assistant/application/assistant-conversations.js"
import { createRealtimeRouter } from "./realtime-router.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const operator = (personId: string): AuthTokenPayload => ({ sub: `acc-${personId}`, personId, organizationId: ORG, role: "OPERATOR", name: "Operador", email: "operador@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null })
const LARISSA = "aaaaaaaa-0000-4000-8000-000000000001"
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002"

// Nenhum orquestrador cadastrado — caminho de compatibilidade (chat sem tools, streaming) sem rede real.
const fakeDb = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => { throw new Error("not needed") } } as unknown as Database

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next
  if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code, message: error.message, details: error.details } })
  if (error instanceof ZodError) return void res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dados inválidos." } })
  res.status(500).json({ error: { message: (error as Error).message } })
}

type Stream = Parameters<typeof createRealtimeRouter>[2]
let clock = new Date("2026-09-29T12:00:00.000Z")
let memory = createMemoryConversationStore()
let seen: { role: string; text: string }[][] = []
const echo: Stream = async (history, _instruction, onChunk) => {
  seen.push(history.map((turn) => ({ ...turn })))
  onChunk(`resposta para: ${history.at(-1)!.text}`)
}

function appWith(options: { person?: string; stream?: Stream; store?: ConversationStore; createSession?: Parameters<typeof createRealtimeRouter>[1] } = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = operator(options.person ?? LARISSA)
    next()
  })
  app.use("/api/v1/realtime", createRealtimeRouter(fakeDb, options.createSession ?? (async () => { throw new Error("not needed") }), options.stream ?? echo, { conversations: options.store ?? memory.store, now: () => clock }))
  app.use(errorHandler)
  return app
}

let keySeed = 0
const key = () => `11111111-aaaa-4aaa-8aaa-${String(++keySeed).padStart(12, "0")}`
const eventData = (text: string, name: string) => {
  const match = new RegExp(`event: ${name}\\ndata: (.*)\\n`).exec(text)
  return match ? (JSON.parse(match[1]!) as Record<string, unknown>) : null
}
async function send(app: express.Express, text: string, conversationId: string | null, clientMessageId = key()) {
  const response = await request(app).post("/api/v1/realtime/messages").send({ conversationId, text, clientMessageId, systemInstruction: "persona" })
  return { response, conversation: eventData(response.text, "conversation") as { conversationId: string; created: boolean; rotatedFrom: string | null } | null }
}

beforeEach(() => {
  clock = new Date("2026-09-29T12:00:00.000Z")
  memory = createMemoryConversationStore({ inactivityHours: 24 })
  seen = []
  vi.restoreAllMocks()
})

describe("realtime — sessão de voz", () => {
  it("devolve só o socket da sessão efêmera — sem a chave da API, sem instrução e sem ferramentas", async () => {
    const app = appWith({ createSession: async () => ({ wsUrl: "wss://x?access_token=auth_tokens%2Fabc", model: "m", expiresAt: "2026-09-09T13:37:02Z" }) })
    const response = await request(app).post("/api/v1/realtime/sessions")
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ wsUrl: "wss://x?access_token=auth_tokens%2Fabc", model: "m", expiresAt: "2026-09-09T13:37:02Z" })
    expect(JSON.stringify(response.body)).not.toMatch(/AIza|GEMINI_API_KEY/)
  })

  it("rejeita tool-call quando o operador não tem orquestrador", async () => {
    const response = await request(appWith()).post("/api/v1/realtime/tool-call").send({ toolName: "agent_xyz", query: "qual minha nota?", conversationId: null, turnId: "voice-turn-1", callId: "c1" })
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe("SPECIALIST_TOOL_NOT_FOUND")
  })
})

describe("realtime — conversas de texto", () => {
  it("a primeira mensagem cria a conversa; pergunta e resposta EXIBIDA ficam gravadas nela (caminho sem orquestrador)", async () => {
    const app = appWith()
    const { response, conversation } = await send(app, "oi", null)
    expect(response.status).toBe(200)
    expect(conversation?.created).toBe(true)
    expect(response.text).toContain('event: chunk\ndata: {"text":"resposta para: oi"}')
    expect(response.text).toContain("event: persisted")
    expect(response.text.indexOf("event: conversation")).toBeLessThan(response.text.indexOf("event: chunk"))
    const stored = memory.messages.filter((m) => m.conversationId === conversation!.conversationId)
    expect(stored.map((m) => [m.role, m.content])).toEqual([["user", "oi"], ["assistant", "resposta para: oi"]])
  })

  it("o contexto do modelo vem SÓ da conversa (do banco), nunca de outra conversa", async () => {
    const app = appWith()
    const first = await send(app, "pergunta A", null)
    await send(app, "pergunta B", first.conversation!.conversationId)
    expect(seen.at(-1)!.map((t) => t.text)).toEqual(["pergunta A", "resposta para: pergunta A", "pergunta B"])

    await request(app).post("/api/v1/realtime/conversations/new")
    const next = await send(app, "pergunta C", null)
    expect(next.conversation!.conversationId).not.toBe(first.conversation!.conversationId)
    expect(seen.at(-1)).toEqual([{ role: "user", text: "pergunta C" }])
  })

  it("Nova conversa preserva a anterior (encerrada, com as mensagens) e não cria conversa vazia", async () => {
    const app = appWith()
    const first = await send(app, "oi", null)
    const closed = await request(app).post("/api/v1/realtime/conversations/new")
    expect(closed.body.data.closedConversationId).toBe(first.conversation!.conversationId)
    // Clicar de novo sem mensagem nenhuma não cria nada.
    await request(app).post("/api/v1/realtime/conversations/new")
    expect(memory.conversations).toHaveLength(1)
    expect(memory.conversations[0]).toMatchObject({ status: "CLOSED", closeReason: "MANUAL" })
    const current = await request(app).get("/api/v1/realtime/conversations/current")
    expect(current.body.data.conversation).toBeNull()
    const list = await request(app).get("/api/v1/realtime/conversations")
    expect(list.body.data.items).toHaveLength(1)
    expect(list.body.data.items[0]).toMatchObject({ status: "CLOSED", messageCount: 2, firstUserMessage: "oi" })
  })

  it("após 24 h sem interação a próxima mensagem abre outra conversa (a antiga é encerrada por inatividade)", async () => {
    const app = appWith()
    const first = await send(app, "ontem", null)
    clock = new Date(clock.getTime() + 24 * 3_600_000 + 1)
    const next = await send(app, "hoje", first.conversation!.conversationId)
    expect(next.conversation).toMatchObject({ created: true, rotatedFrom: first.conversation!.conversationId })
    expect(memory.conversations.find((c) => c.id === first.conversation!.conversationId)).toMatchObject({ status: "CLOSED", closeReason: "INACTIVITY" })
    expect(seen.at(-1)).toEqual([{ role: "user", text: "hoje" }])
  })

  it("dentro da janela continua na mesma conversa", async () => {
    const app = appWith()
    const first = await send(app, "a", null)
    clock = new Date(clock.getTime() + 23 * 3_600_000)
    const next = await send(app, "b", first.conversation!.conversationId)
    expect(next.conversation).toMatchObject({ conversationId: first.conversation!.conversationId, created: false })
  })

  it("ao recarregar, a conversa ativa é recuperada; inativa além da janela volta como nenhuma (sem criar conversa)", async () => {
    const app = appWith()
    const first = await send(app, "oi", null)
    const current = await request(app).get("/api/v1/realtime/conversations/current")
    expect(current.body.data.conversation.id).toBe(first.conversation!.conversationId)
    expect(current.body.data.inactivityHours).toBeGreaterThan(0)
    clock = new Date(clock.getTime() + 25 * 3_600_000)
    const stale = await request(app).get("/api/v1/realtime/conversations/current")
    expect(stale.body.data.conversation).toBeNull()
    expect(memory.conversations).toHaveLength(1)
  })

  it("mensagem para uma conversa já encerrada (outra aba iniciou outra) é recusada com a conversa atual — nunca misturada", async () => {
    const app = appWith()
    const tabA = await send(app, "aba A", null)
    await request(app).post("/api/v1/realtime/conversations/new")
    const tabB = await send(app, "aba B", null)
    const late = await send(app, "aba A de novo", tabA.conversation!.conversationId)
    expect(late.response.status).toBe(409)
    expect(late.response.body.error).toMatchObject({ code: "ASSISTANT_CONVERSATION_CLOSED", details: { activeConversationId: tabB.conversation!.conversationId } })
    expect(memory.messages.some((m) => m.content === "aba A de novo")).toBe(false)
  })

  it("conversa de outra pessoa: 404 para enviar e para ler", async () => {
    const mine = await send(appWith(), "minha", null)
    const intruder = appWith({ person: OTHER })
    expect((await send(intruder, "entrando", mine.conversation!.conversationId)).response.status).toBe(404)
    expect((await request(intruder).get(`/api/v1/realtime/conversations/${mine.conversation!.conversationId}/messages`)).status).toBe(404)
  })

  it("retentativa com a mesma chave não duplica a pergunta nem gera outra resposta", async () => {
    const app = appWith()
    const clientKey = key()
    const first = await send(app, "oi", null, clientKey)
    const retry = await send(app, "oi", first.conversation!.conversationId, clientKey)
    expect(retry.response.text).toContain('"text":"resposta para: oi"')
    expect(memory.messages).toHaveLength(2)
    expect(seen).toHaveLength(1)
  })

  it("falha do modelo: a pergunta fica gravada, nenhuma resposta é inventada, o cliente recebe erro", async () => {
    const app = appWith({ stream: async () => { throw new Error("boom") } })
    const { response } = await send(app, "oi", null)
    expect(response.text).toContain("event: error")
    expect(memory.messages.map((m) => m.role)).toEqual(["user"])
  })

  it("falha ao SALVAR a resposta já exibida vira evento próprio (nunca sucesso aparente)", async () => {
    const failing: ConversationStore = { ...memory.store, append: async (input) => { if (input.role === "assistant") throw new Error("db down"); return memory.store.append(input) } }
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { response } = await send(appWith({ store: failing }), "oi", null)
    expect(response.text).toContain("event: chunk")
    expect(response.text).toContain("event: persist_error")
    expect(response.text).not.toContain("event: persisted")
  })
})

describe("realtime — voz na conversa", () => {
  it("a pergunta falada fica ANTES da resposta do especialista, mesmo gravada depois; transcrição e especialista não duplicam", async () => {
    const app = appWith()
    const text = await send(app, "oi", null)
    const conversationId = text.conversation!.conversationId
    // Resposta do especialista gravada primeiro (tool-call), pergunta falada chega no fim do turno com o instante real.
    clock = new Date("2026-09-29T12:05:10.000Z")
    await memory.store.append({ conversationId, organizationId: ORG, ownerPersonId: LARISSA, channel: "voice", role: "assistant", content: "resposta do especialista", occurredAt: clock, clientMessageId: "voice-turn-9:specialist:c1" })
    clock = new Date("2026-09-29T12:05:20.000Z")
    const turn = { conversationId, turnId: "voice-turn-9", userText: "qual meu TMA?", userSpokenAt: "2026-09-29T12:05:05.000Z" }
    expect((await request(app).post("/api/v1/realtime/voice-turn").send(turn)).status).toBe(200)
    expect((await request(app).post("/api/v1/realtime/voice-turn").send(turn)).status).toBe(200) // retentativa
    const page = await request(app).get(`/api/v1/realtime/conversations/${conversationId}/messages`)
    expect(page.body.data.messages.map((m: { role: string; content: string }) => m.content)).toEqual(["oi", "resposta para: oi", "qual meu TMA?", "resposta do especialista"])
  })

  it("pergunta DIGITADA respondida por voz: a pergunta fica como digitada e a resposta como voz", async () => {
    const app = appWith()
    const turn = { conversationId: null, turnId: "voice-turn-typed1", userText: "qual meu TMA?", userChannel: "chat", userSpokenAt: "2026-09-29T12:05:05.000Z", assistantText: "Seu TMA está em 300 segundos." }
    expect((await request(app).post("/api/v1/realtime/voice-turn").send(turn)).status).toBe(200)
    expect(memory.messages.map((m) => [m.role, m.channel])).toEqual([["user", "chat"], ["assistant", "voice"]])
    // Sem a origem, continua sendo uma pergunta falada (clientes antigos).
    expect((await request(app).post("/api/v1/realtime/voice-turn").send({ ...turn, turnId: "voice-turn-spoken1", userChannel: undefined })).status).toBe(200)
    expect(memory.messages.at(-2)?.channel).toBe("voice")
    expect((await request(app).post("/api/v1/realtime/voice-turn").send({ ...turn, turnId: "voice-turn-bad1", userChannel: "fax" })).status).toBe(400)
  })

  it("turno de voz de uma conversa encerrada no meio do caminho fica nela e avisa o cliente (não migra)", async () => {
    const app = appWith()
    const first = await send(app, "oi", null)
    await request(app).post("/api/v1/realtime/conversations/new")
    const response = await request(app).post("/api/v1/realtime/voice-turn").send({ conversationId: first.conversation!.conversationId, turnId: "voice-turn-2", assistantText: "resposta atrasada" })
    expect(response.body.data).toMatchObject({ conversationId: first.conversation!.conversationId, closed: true, activeConversationId: null })
    expect(memory.messages.find((m) => m.content === "resposta atrasada")!.conversationId).toBe(first.conversation!.conversationId)
  })

  it("instante informado pelo cliente fora da janela aceitável é limitado", async () => {
    const app = appWith()
    const response = await request(app).post("/api/v1/realtime/voice-turn").send({ conversationId: null, turnId: "voice-turn-3", userText: "oi", userSpokenAt: "2020-01-01T00:00:00.000Z" })
    expect(response.body.data.created).toBe(true)
    expect(memory.messages[0]!.occurredAt.getTime()).toBe(clock.getTime() - 10 * 60 * 1000)
  })
})

describe("realtime — paginação de mensagens", () => {
  it("carrega as mais recentes, depois as anteriores (before) e as novas (after), em ordem estável", async () => {
    const app = appWith()
    let conversationId: string | null = null
    for (let index = 1; index <= 5; index += 1) {
      clock = new Date(clock.getTime() + 1000)
      const result = await send(app, `m${index}`, conversationId)
      conversationId = result.conversation!.conversationId
    }
    const latest = await request(app).get(`/api/v1/realtime/conversations/${conversationId}/messages?limit=4`)
    expect(latest.body.data.hasMore).toBe(true)
    const contents = (body: { data: { messages: { content: string }[] } }) => body.data.messages.map((m) => m.content)
    expect(contents(latest.body)).toEqual(["m4", "resposta para: m4", "m5", "resposta para: m5"])
    const before = await request(app).get(`/api/v1/realtime/conversations/${conversationId}/messages?limit=4&before=${latest.body.data.messages[0].cursor}`)
    expect(contents(before.body)).toEqual(["m2", "resposta para: m2", "m3", "resposta para: m3"])
    const after = await request(app).get(`/api/v1/realtime/conversations/${conversationId}/messages?limit=10&after=${before.body.data.messages[3].cursor}`)
    expect(contents(after.body)).toEqual(["m4", "resposta para: m4", "m5", "resposta para: m5"])
  })
})
