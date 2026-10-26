import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { beforeEach, describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import { createRealtimeRouter } from "./realtime-router.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const LARISSA = "aaaaaaaa-0000-4000-8000-000000000001"
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002"
const operator = (personId: string): AuthTokenPayload => ({ sub: `acc-${personId}`, personId, organizationId: ORG, role: "OPERATOR", name: "Operador", email: "operador@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null })

// Nenhum orquestrador cadastrado — caminho de compatibilidade (chat sem tools, streaming) sem rede real.
const fakeDb = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => { throw new Error("not needed") } } as unknown as Database
const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next
  if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
  if (error instanceof ZodError) return void res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dados inválidos." } })
  res.status(500).json({ error: { message: (error as Error).message } })
}

let clock = new Date("2026-10-22T12:00:00.000Z")
let memory = createMemoryConversationStore()

function appWith(person = LARISSA) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = operator(person)
    next()
  })
  app.use("/api/v1/realtime", createRealtimeRouter(fakeDb, async () => { throw new Error("not needed") }, async (history, _instruction, onChunk) => onChunk(`resposta para: ${history.at(-1)!.text}`), { conversations: memory.store, now: () => clock }))
  app.use(errorHandler)
  return app
}

let keySeed = 0
const key = () => `22222222-aaaa-4aaa-8aaa-${String(++keySeed).padStart(12, "0")}`

/** Uma pergunta e a resposta da INIA gravadas na conversa da Larissa. */
async function exchange(app: express.Express) {
  await request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Qual é o prazo da contestação?", clientMessageId: key(), systemInstruction: "persona" })
  const conversationId = memory.conversations[0]!.id
  const page = await request(app).get(`/api/v1/realtime/conversations/${conversationId}/messages`)
  const messages = page.body.data.messages as { id: string; role: string; rating?: unknown }[]
  return { conversationId, question: messages.find((message) => message.role === "user")!, answer: messages.find((message) => message.role === "assistant")! }
}

const rate = (app: express.Express, conversationId: string, interactionId: string, value: unknown) => request(app).put(`/api/v1/realtime/conversations/${conversationId}/messages/${interactionId}/rating`).send({ value })

beforeEach(() => {
  clock = new Date("2026-10-22T12:00:00.000Z")
  memory = createMemoryConversationStore({ inactivityHours: 24 })
})

describe("realtime — curtir/descurtir das respostas da INIA (migration 158)", () => {
  it("grava, a marcação volta ao reabrir a conversa e cada mudança fica no histórico (retirar = NONE)", async () => {
    const app = appWith()
    const { conversationId, question, answer } = await exchange(app)
    // Antes de qualquer clique: a resposta vem sem marcação; a pergunta da pessoa não tem o campo.
    expect(answer.rating).toBeNull()
    expect(question).not.toHaveProperty("rating")

    expect((await rate(app, conversationId, answer.id, "UP")).body.data).toEqual({ interactionId: answer.id, rating: "up" })
    const reopened = await request(app).get(`/api/v1/realtime/conversations/${conversationId}/messages`)
    expect(reopened.body.data.messages.find((message: { id: string }) => message.id === answer.id).rating).toBe("up")

    // Duplo clique / outra aba: o mesmo valor não grava de novo.
    await rate(app, conversationId, answer.id, "UP")
    expect(memory.ratings).toHaveLength(1)

    clock = new Date("2026-10-22T12:01:00.000Z")
    expect((await rate(app, conversationId, answer.id, "DOWN")).body.data.rating).toBe("down")
    clock = new Date("2026-10-22T12:02:00.000Z")
    expect((await rate(app, conversationId, answer.id, "NONE")).body.data.rating).toBeNull()
    expect(memory.ratings.map((row) => [row.value, row.supersededAt?.toISOString() ?? null])).toEqual([
      ["UP", "2026-10-22T12:01:00.000Z"],
      ["DOWN", "2026-10-22T12:02:00.000Z"],
      ["NONE", null],
    ])
    const afterRemoval = await request(app).get(`/api/v1/realtime/conversations/${conversationId}/messages`)
    expect(afterRemoval.body.data.messages.find((message: { id: string }) => message.id === answer.id).rating).toBeNull()
  })

  it("só a dona da conversa avalia, e só respostas da INIA daquela conversa — o resto é 404, valor inválido é 400", async () => {
    const app = appWith()
    const { conversationId, question, answer } = await exchange(app)
    expect((await rate(appWith(OTHER), conversationId, answer.id, "UP")).status).toBe(404)
    expect((await rate(app, conversationId, question.id, "UP")).status).toBe(404)
    expect((await rate(app, "99999999-0000-4000-8000-000000000009", answer.id, "UP")).status).toBe(404)
    expect((await rate(app, conversationId, answer.id, "LIKE")).status).toBe(400)
    expect((await rate(app, conversationId, "nao-e-uuid", "UP")).status).toBe(400)
    expect(memory.ratings).toHaveLength(0)
  })

  it("voz: o /voice-turn devolve o id da resposta falada gravada (sem resposta no turno = null)", async () => {
    const app = appWith()
    const spoken = await request(app).post("/api/v1/realtime/voice-turn").send({ conversationId: null, turnId: "voice-turn-r1", userText: "qual meu TMA?", assistantText: "Seu TMA está em 300 segundos." })
    const stored = memory.messages.find((message) => message.role === "assistant")!
    expect(spoken.body.data.assistantInteractionId).toBe(stored.id)
    const questionOnly = await request(app).post("/api/v1/realtime/voice-turn").send({ conversationId: spoken.body.data.conversationId, turnId: "voice-turn-r2", userText: "e o de ontem?" })
    expect(questionOnly.body.data.assistantInteractionId).toBeNull()
    expect((await rate(app, spoken.body.data.conversationId, stored.id, "DOWN")).body.data.rating).toBe("down")
  })
})
