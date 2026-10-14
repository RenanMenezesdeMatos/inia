import type { AddressInfo } from "node:net"
import express from "express"
import { afterEach, describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import { aiCallLimiter, createAiCallLimiter, DEFAULT_AI_CALL_LIMITER_CONFIG, setAiCallLimiter } from "../../../shared/application/model-routing/ai-call-limiter.js"
import { runWithAiOrganization } from "../../../shared/application/model-routing/ai-runtime.js"
import { createChatStreamer } from "../../../shared/application/model-routing/llm-gateway.js"
import { createRealtimeRouter } from "./realtime-router.js"

/**
 * SSE do chat da INIA: batimento enquanto a resposta não começa (o IIS/ARR não derruba a conexão parada) e CANCELAMENTO até o
 * gateway quando a pessoa vai embora — a chamada de IA para e a vaga do limitador volta, sem gravar resposta interrompida.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const PERSON = "aaaaaaaa-0000-4000-8000-000000000001"
const operator: AuthTokenPayload = { sub: `acc-${PERSON}`, personId: PERSON, organizationId: ORG, role: "OPERATOR", name: "Operador", email: "operador@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
const fakeDb = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => { throw new Error("not needed") } } as unknown as Database
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Stream = Parameters<typeof createRealtimeRouter>[2]

async function serve(stream: Stream, sseHeartbeatMs: number) {
  const memory = createMemoryConversationStore({ inactivityHours: 24 })
  const app = express()
  app.use(express.json())
  // Como o requireAuth do servidor: a request da pessoa abre o contexto de IA (interativa).
  app.use((req, _res, next) => {
    req.user = operator
    runWithAiOrganization(ORG, next, { origin: "USER_REQUEST" })
  })
  app.use("/api/v1/realtime", createRealtimeRouter(fakeDb, async () => { throw new Error("not needed") }, stream, { conversations: memory.store, sseHeartbeatMs }))
  const server = app.listen(0, "127.0.0.1")
  await new Promise((resolve) => server.once("listening", resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/realtime/messages`
  return { url, memory, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

const body = (text: string) => JSON.stringify({ conversationId: null, text, clientMessageId: "11111111-aaaa-4aaa-8aaa-000000000001", systemInstruction: "persona" })

afterEach(() => {
  setAiCallLimiter(null)
})

describe("SSE do chat — batimento e cancelamento", () => {
  it("batimento `: ping` enquanto a resposta não começa; o cliente continua lendo só os eventos", async () => {
    const { url, close } = await serve(async (_history, _instruction, onChunk) => {
      await sleep(160)
      onChunk("resposta")
    }, 40)
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body("oi") })
      const text = await response.text()
      expect(text.match(/: ping\n\n/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
      expect(text).toContain('event: chunk\ndata: {"text":"resposta"}')
      expect(text).toContain("event: done")
    } finally {
      await close()
    }
  })

  it("a pessoa fecha a página: o cancelamento chega ao gateway, a vaga do limitador volta e nenhuma resposta é gravada", async () => {
    setAiCallLimiter(createAiCallLimiter({ ...DEFAULT_AI_CALL_LIMITER_CONFIG, maxConcurrent: 2, reservedInteractive: 1 }, { log: () => {} }))
    let observed: AbortSignal | null = null
    let started!: () => void
    const providerStarted = new Promise<void>((resolve) => (started = resolve))
    // O streamer do gateway de verdade (limitador + registro), com um "provedor" que só termina se for cancelado.
    const stream = createChatStreamer(async (_history, _system, onChunk, cancel) => {
      observed = cancel ?? null
      started()
      onChunk("começo")
      await new Promise<void>((_resolve, reject) => cancel?.addEventListener("abort", () => reject(new Error("cancelado")), { once: true }))
      return null
    })
    const { url, memory, close } = await serve(stream, 10_000)
    try {
      const client = new AbortController()
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body("pergunta longa"), signal: client.signal })
      const reader = response.body!.getReader()
      await reader.read()
      await providerStarted
      expect(aiCallLimiter().stats().running.INTERACTIVE).toBe(1)
      client.abort()
      for (let index = 0; index < 50 && aiCallLimiter().stats().running.INTERACTIVE > 0; index += 1) await sleep(20)
      expect(observed!.aborted).toBe(true)
      expect(aiCallLimiter().stats().running).toEqual({ INTERACTIVE: 0, BATCH: 0 })
      // A pergunta ficou gravada (é uma dúvida real); a resposta interrompida não.
      expect(memory.messages.map((message) => [message.role, message.content])).toEqual([["user", "pergunta longa"]])
    } finally {
      await close()
    }
  })
})
