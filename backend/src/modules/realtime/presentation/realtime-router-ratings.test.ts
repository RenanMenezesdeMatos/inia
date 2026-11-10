import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"
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
/** Sugestões elegíveis registradas (Apoio com Anjo, Parte B): a rota chama a função injetada. */
let suggestions: { organizationId: string; personId: string; interactionId: string; origin: string }[] = []

function appWith(person = LARISSA, options: { failSuggestion?: boolean } = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = operator(person)
    next()
  })
  app.use("/api/v1/realtime", createRealtimeRouter(fakeDb, async () => { throw new Error("not needed") }, async (history, _instruction, onChunk) => onChunk(`resposta para: ${history.at(-1)!.text}`), {
    conversations: memory.store,
    now: () => clock,
    recordSuggestion: async (input) => {
      if (options.failSuggestion) throw new Error("registro indisponível")
      suggestions.push(input)
    },
  }))
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

const rate = (app: express.Express, conversationId: string, interactionId: string, value: unknown, details?: unknown) =>
  request(app).put(`/api/v1/realtime/conversations/${conversationId}/messages/${interactionId}/rating`).send(details === undefined ? { value } : { value, details })
const reopen = async (app: express.Express, conversationId: string, interactionId: string) =>
  ((await request(app).get(`/api/v1/realtime/conversations/${conversationId}/messages`)).body.data.messages as Record<string, unknown>[]).find((message) => message.id === interactionId)!

beforeEach(() => {
  clock = new Date("2026-10-22T12:00:00.000Z")
  memory = createMemoryConversationStore({ inactivityHours: 24 })
  suggestions = []
})

describe("realtime — curtir/descurtir das respostas da INIA (migration 158)", () => {
  it("grava, a marcação volta ao reabrir a conversa e cada mudança fica no histórico (retirar = NONE)", async () => {
    const app = appWith()
    const { conversationId, question, answer } = await exchange(app)
    // Antes de qualquer clique: a resposta vem sem marcação; a pergunta da pessoa não tem o campo.
    expect(answer.rating).toBeNull()
    expect(question).not.toHaveProperty("rating")

    const liked = (await rate(app, conversationId, answer.id, "UP")).body.data
    expect(liked).toEqual({ interactionId: answer.id, rating: "up", ratingId: memory.ratings[0]!.id, details: null })
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

describe("realtime — motivo da descurtida no chat livre (migration 181, Apoio com Anjo)", () => {
  const wrong = { reason: "WRONG_INFORMATION", stillNeedsHelp: true }

  it("grava o motivo com a descurtida, devolve a versão e o motivo, e eles voltam ao reabrir a conversa", async () => {
    const app = appWith()
    const { conversationId, answer } = await exchange(app)
    const response = await rate(app, conversationId, answer.id, "DOWN", { reason: "OTHER", comment: "  O prazo é outro.  ", stillNeedsHelp: false })
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ interactionId: answer.id, rating: "down", ratingId: memory.ratings[0]!.id, details: { reason: "OTHER", comment: "O prazo é outro.", stillNeedsHelp: false } })
    expect(await reopen(app, conversationId, answer.id)).toMatchObject({ rating: "down", ratingId: memory.ratings[0]!.id, ratingDetails: { reason: "OTHER", comment: "O prazo é outro.", stillNeedsHelp: false } })
    // Sem necessidade de ajuda: nenhuma sugestão.
    expect(suggestions).toEqual([])
  })

  it("regras de gravação: sem motivo sobre a vigente com motivo não grava; sem motivo nos outros casos grava como antes; motivo diferente = versão nova", async () => {
    const app = appWith()
    const { conversationId, answer } = await exchange(app)
    // Regra 2: descurtida sem motivo (aba antiga) continua aceita.
    expect((await rate(app, conversationId, answer.id, "DOWN")).body.data).toMatchObject({ rating: "down", details: null })
    expect(memory.ratings).toHaveLength(1)
    // Regra 3: motivo novo sobre a descurtida sem motivo = versão nova.
    clock = new Date("2026-10-22T12:01:00.000Z")
    await rate(app, conversationId, answer.id, "DOWN", wrong)
    expect(memory.ratings.map((row) => [row.value, row.details?.reason ?? null, row.supersededAt?.toISOString() ?? null])).toEqual([
      ["DOWN", null, "2026-10-22T12:01:00.000Z"],
      ["DOWN", "WRONG_INFORMATION", null],
    ])
    // Regra 1: descurtida sem motivo (outra aba antiga) sobre a vigente com motivo não grava e devolve a vigente.
    clock = new Date("2026-10-22T12:02:00.000Z")
    expect((await rate(app, conversationId, answer.id, "DOWN")).body.data).toMatchObject({ rating: "down", details: { reason: "WRONG_INFORMATION", comment: null, stillNeedsHelp: true } })
    // Mesmo motivo de novo (duplo clique): também não grava.
    await rate(app, conversationId, answer.id, "DOWN", wrong)
    expect(memory.ratings).toHaveLength(2)
    // Motivo diferente: versão nova.
    await rate(app, conversationId, answer.id, "DOWN", { reason: "INCOMPLETE", stillNeedsHelp: true })
    expect(memory.ratings).toHaveLength(3)
    expect(memory.ratings.at(-1)!.details).toEqual({ reason: "INCOMPLETE", comment: null, stillNeedsHelp: true })
  })

  it("motivo inválido é 400: fora da lista, \"Outro\" sem comentário, comentário curto ou longo demais, motivo com curtida", async () => {
    const app = appWith()
    const { conversationId, answer } = await exchange(app)
    for (const details of [
      { reason: "RUDE", stillNeedsHelp: false },
      { reason: "OTHER", stillNeedsHelp: false },
      { reason: "OTHER", comment: "  ok ", stillNeedsHelp: false },
      { reason: "INCOMPLETE", comment: "x".repeat(1001), stillNeedsHelp: false },
      { reason: "INCOMPLETE" },
      { reason: "INCOMPLETE", stillNeedsHelp: false, extra: true },
    ]) {
      expect((await rate(app, conversationId, answer.id, "DOWN", details)).status).toBe(400)
    }
    expect((await rate(app, conversationId, answer.id, "UP", wrong)).status).toBe(400)
    expect(memory.ratings).toHaveLength(0)
  })

  it("o motivo só vale no chat livre: na conversa de feedback e no recado de Workflow é 422; a descurtida simples continua aceita", async () => {
    const app = appWith()
    const at = new Date("2026-10-22T11:00:00.000Z")
    for (const seeded of [
      memory.seedFeedbackConversation({ organizationId: ORG, ownerPersonId: LARISSA }, { title: "Rechamada", text: "Apresentação", at }),
      memory.seedWorkflowConversation({ organizationId: ORG, ownerPersonId: LARISSA }, { title: "Recado", text: "Recado do Workflow", at }),
    ]) {
      const conversationId = seeded
      const answerId = memory.messages.find((message) => message.conversationId === conversationId && message.role === "assistant")!.id
      const refused = await rate(app, conversationId, answerId, "DOWN", wrong)
      expect(refused.status).toBe(422)
      expect(refused.body.error.code).toBe("RATING_DETAILS_NOT_ALLOWED")
      expect((await rate(app, conversationId, answerId, "DOWN")).body.data.rating).toBe("down")
    }
    expect(suggestions).toEqual([])
  })

  it("\"ainda preciso de ajuda\" numa versão nova registra a sugestão elegível (DISLIKE) uma vez; falha do registro nunca muda a resposta", async () => {
    const app = appWith()
    const { conversationId, answer } = await exchange(app)
    await rate(app, conversationId, answer.id, "DOWN", wrong)
    await rate(app, conversationId, answer.id, "DOWN", wrong)
    expect(suggestions).toEqual([{ organizationId: ORG, personId: LARISSA, interactionId: answer.id, origin: "DISLIKE" }])
    vi.spyOn(console, "error").mockImplementation(() => {})
    const failing = appWith(LARISSA, { failSuggestion: true })
    const response = await rate(failing, conversationId, answer.id, "DOWN", { reason: "NOT_FOUND", stillNeedsHelp: true })
    expect(response.status).toBe(200)
    expect(response.body.data.details).toEqual({ reason: "NOT_FOUND", comment: null, stillNeedsHelp: true })
    vi.restoreAllMocks()
  })
})
