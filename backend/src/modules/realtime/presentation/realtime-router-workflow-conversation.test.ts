import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import { createRealtimeRouter } from "./realtime-router.js"

/**
 * Workflow Outputs V1 — conversa criada por um Workflow (Output → Chat) convive com a conversa ATUAL do usuário: nunca a
 * substitui, nunca recebe mensagem dela, aceita resposta dias depois e entrega à IA o contexto de ORIGEM (dados do artefato).
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const LARISSA = "aaaaaaaa-0000-4000-8000-000000000001"
const user: AuthTokenPayload = { sub: "acc-1", personId: LARISSA, organizationId: ORG, role: "OPERATOR", name: "Larissa", email: "l@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
const fakeDb = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next
  if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code } })
  res.status(500).json({ error: { message: (error as Error).message } })
}

describe("conversa de Workflow × conversa atual", () => {
  it("não invade a conversa atual, recebe a resposta, leva o contexto de origem e não expira por inatividade", async () => {
    let clock = new Date("2026-09-29T12:00:00.000Z")
    const memory = createMemoryConversationStore()
    const instructions: string[] = []
    const contexts: string[] = []
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => { req.user = user; next() })
    app.use(
      "/api/v1/realtime",
      createRealtimeRouter(fakeDb, async () => { throw new Error("not needed") }, async (_history, instruction, onChunk) => { instructions.push(instruction); onChunk("ok") }, {
        conversations: memory.store,
        now: () => clock,
        workflowContext: async (input) => { contexts.push(input.conversationId); return "\n\n[CONTEXTO DE ORIGEM: prazo da análise]" },
      }),
    )
    app.use(errorHandler)

    // Conversa A: iniciada pela Larissa (troca de titularidade).
    const first = await request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: "Como faço troca de titularidade?", clientMessageId: "11111111-aaaa-4aaa-8aaa-000000000001", systemInstruction: "persona" })
    const conversationA = /"conversationId":"([^"]+)"/.exec(first.text)![1]!
    // O Workflow entrega o recado numa conversa B.
    const conversationB = memory.seedWorkflowConversation({ organizationId: ORG, ownerPersonId: LARISSA }, { title: "Feedback do seu fechamento de agosto de 2026", text: "Olá, Larissa! Tenho um retorno novo…", at: clock })

    const current = await request(app).get("/api/v1/realtime/conversations/current")
    expect(current.body.data.conversation.id).toBe(conversationA)
    expect(memory.messages.filter((message) => message.conversationId === conversationA)).toHaveLength(2)

    const list = await request(app).get("/api/v1/realtime/conversations")
    expect(list.body.data.items.find((item: { id: string }) => item.id === conversationB)).toMatchObject({ origin: "WORKFLOW", title: "Feedback do seu fechamento de agosto de 2026", unread: true })
    const messagesB = await request(app).get(`/api/v1/realtime/conversations/${conversationB}/messages`)
    expect(messagesB.body.data.messages[0]).toMatchObject({ role: "assistant", origin: "WORKFLOW" })

    // Dois dias depois, a Larissa responde na conversa B: continua em B (sem rotação) e a IA recebe o contexto de origem.
    clock = new Date("2026-10-01T12:00:00.000Z")
    const reply = await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversationB, text: "Por que você identificou isso?", clientMessageId: "11111111-aaaa-4aaa-8aaa-000000000002", systemInstruction: "persona" })
    expect(/"conversationId":"([^"]+)"/.exec(reply.text)![1]).toBe(conversationB)
    expect(contexts).toEqual([conversationB])
    expect(instructions.at(-1)).toContain("[CONTEXTO DE ORIGEM: prazo da análise]")
    // A conversa A não recebeu nada e a conversa atual continua sendo ela (não foi fechada por causa de B).
    expect(memory.messages.filter((message) => message.conversationId === conversationA)).toHaveLength(2)
    expect(memory.conversations.find((conversation) => conversation.id === conversationA)!.status).toBe("ACTIVE")
    // Mensagem na conversa atual não leva o contexto de outra conversa.
    await request(app).post("/api/v1/realtime/messages").send({ conversationId: conversationA, text: "E sobre titularidade?", clientMessageId: "11111111-aaaa-4aaa-8aaa-000000000003", systemInstruction: "persona" })
    expect(instructions.at(-1)).not.toContain("CONTEXTO DE ORIGEM")
  })
})
