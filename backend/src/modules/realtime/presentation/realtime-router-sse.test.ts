import type { AddressInfo } from "node:net"
import express from "express"
import { afterEach, describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import { createMemoryReplyRunRegistry } from "../../assistant/testing/memory-reply-runs.js"
import { aiCallLimiter, createAiCallLimiter, DEFAULT_AI_CALL_LIMITER_CONFIG, setAiCallLimiter } from "../../../shared/application/model-routing/ai-call-limiter.js"
import { runWithAiOrganization } from "../../../shared/application/model-routing/ai-runtime.js"
import { createChatStreamer } from "../../../shared/application/model-routing/llm-gateway.js"
import { createRealtimeRouter } from "./realtime-router.js"

/**
 * SSE do chat da INIA: batimento enquanto a resposta não começa (o IIS/ARR não derruba a conexão parada) e a regra de 19/11/2026
 * (`assistant-reply-runs.ts`): SAIR DA TELA NÃO CANCELA — a conexão cai, a resposta continua e é GRAVADA, e quem volta vê que ainda
 * está respondendo (`pendingReply`); SÓ O "PARAR" CANCELA — o cancelamento chega ao gateway, a vaga do limitador volta e nada da
 * resposta é gravado.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const PERSON = "aaaaaaaa-0000-4000-8000-000000000001"
const operator: AuthTokenPayload = { sub: `acc-${PERSON}`, personId: PERSON, organizationId: ORG, role: "OPERATOR", name: "Operador", email: "operador@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
const fakeDb = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => { throw new Error("not needed") } } as unknown as Database
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Stream = Parameters<typeof createRealtimeRouter>[2]

async function serve(stream: Stream, sseHeartbeatMs: number) {
  const memory = createMemoryConversationStore({ inactivityHours: 24 })
  const replyRuns = createMemoryReplyRunRegistry()
  const app = express()
  app.use(express.json())
  // Como o requireAuth do servidor: a request da pessoa abre o contexto de IA (interativa).
  app.use((req, _res, next) => {
    req.user = operator
    runWithAiOrganization(ORG, next, { origin: "USER_REQUEST" })
  })
  app.use("/api/v1/realtime", createRealtimeRouter(fakeDb, async () => { throw new Error("not needed") }, stream, { conversations: memory.store, replyRuns, sseHeartbeatMs }))
  // Como o tratador de erros do servidor: DomainError vira o status e o código dele em JSON.
  app.use((error: { statusCode?: number; code?: string; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next
    res.status(error.statusCode ?? 500).json({ error: { code: error.code ?? "INTERNAL", message: error.message } })
  })
  const server = app.listen(0, "127.0.0.1")
  await new Promise((resolve) => server.once("listening", resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/realtime`
  const url = `${base}/messages`
  return { url, base, memory, replyRuns, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

const CLIENT_KEY = "11111111-aaaa-4aaa-8aaa-000000000001"
const body = (text: string) => JSON.stringify({ conversationId: null, text, clientMessageId: CLIENT_KEY, systemInstruction: "persona" })
/** Lê o SSE até o evento pedido; devolve o `data` dele. */
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, event: string): Promise<unknown> {
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) throw new Error(`fim do stream sem o evento ${event}`)
    buffer += decoder.decode(value, { stream: true })
    const match = buffer.match(new RegExp(`event: ${event}\ndata: (.*)\n\n`))
    if (match) return JSON.parse(match[1]!)
  }
}

afterEach(() => {
  setAiCallLimiter(null)
})

describe("SSE do chat — batimento, sair da tela e Parar", () => {
  it("limites (run-8): a mesma pergunta em andamento recebe 409; a 4ª resposta simultânea da pessoa recebe 429 antes de gravar a pergunta", async () => {
    // Provedor que só termina quando cancelado: as respostas ficam em andamento.
    const stream = createChatStreamer(async (_history, _system, onChunk, cancel) => {
      onChunk("começo")
      await new Promise<void>((_resolve, reject) => cancel?.addEventListener("abort", () => reject(new Error("cancelado")), { once: true }))
      return null
    })
    const { url, base, memory, close } = await serve(stream, 10_000)
    const keys = [1, 2, 3].map((index) => `22222222-aaaa-4aaa-8aaa-00000000000${index}`)
    const post = (key: string, text: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: null, text, clientMessageId: key, systemInstruction: "persona" }) })
    try {
      const readers = []
      for (const key of keys) {
        const response = await post(key, `pergunta ${key}`)
        const reader = response.body!.getReader()
        await readUntil(reader, "conversation")
        readers.push(reader)
      }
      const duplicate = await post(keys[0]!, `pergunta ${keys[0]}`)
      expect(duplicate.status).toBe(429)
      // Abaixo do teto, a duplicata é 409 (a mesma pergunta não roda duas vezes).
      await fetch(`${base}/messages/${keys[2]}/cancel`, { method: "POST" })
      for (let index = 0; index < 50; index += 1) {
        const retry = await post(keys[0]!, `pergunta ${keys[0]}`)
        if (retry.status !== 429) {
          expect(retry.status).toBe(409)
          expect(((await retry.json()) as { error: { code: string } }).error.code).toBe("ASSISTANT_REPLY_IN_PROGRESS")
          break
        }
        await sleep(20)
      }
      const before = memory.messages.length
      const fourth = await post("33333333-aaaa-4aaa-8aaa-000000000001", "outra")
      expect(fourth.status).toBe(200)
      await readUntil(fourth.body!.getReader(), "conversation")
      const fifth = await post("33333333-aaaa-4aaa-8aaa-000000000002", "mais uma")
      expect(fifth.status).toBe(429)
      expect(((await fifth.json()) as { error: { code: string } }).error.code).toBe("ASSISTANT_REPLIES_IN_FLIGHT")
      // A pergunta recusada pelo teto não foi gravada.
      expect(memory.messages.filter((message) => message.content === "mais uma")).toHaveLength(0)
      expect(memory.messages.length).toBe(before + 1)
      for (const key of [keys[0]!, keys[1]!, "33333333-aaaa-4aaa-8aaa-000000000001"]) await fetch(`${base}/messages/${key}/cancel`, { method: "POST" })
      for (const reader of readers) await reader.cancel().catch(() => undefined)
    } finally {
      await close()
    }
  })

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

  it("a pessoa SAI DA TELA (a conexão cai no meio): a resposta continua, é GRAVADA, e quem volta vê que ainda está respondendo", async () => {
    setAiCallLimiter(createAiCallLimiter({ ...DEFAULT_AI_CALL_LIMITER_CONFIG, maxConcurrent: 2, reservedInteractive: 1 }, { log: () => {} }))
    let observed: AbortSignal | null = null
    let started!: () => void
    const providerStarted = new Promise<void>((resolve) => (started = resolve))
    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    // O streamer do gateway de verdade (limitador + registro), com um "provedor" que só termina quando o teste solta.
    const stream = createChatStreamer(async (_history, _system, onChunk, cancel) => {
      observed = cancel ?? null
      started()
      onChunk("Para abrir a contestação, ")
      await released
      onChunk("use a opção Contestar na fatura.")
      return null
    })
    const { url, base, memory, close } = await serve(stream, 10_000)
    try {
      const client = new AbortController()
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body("pergunta longa"), signal: client.signal })
      const reader = response.body!.getReader()
      const conversation = (await readUntil(reader, "conversation")) as { conversationId: string; userMessageId: string }
      await providerStarted
      // A pessoa troca de área (o chat desmonta) / recarrega a página: a conexão fecha.
      client.abort()
      await sleep(80)
      expect(observed!.aborted).toBe(false)
      expect(aiCallLimiter().stats().running.INTERACTIVE).toBe(1)
      // Ela volta antes do fim: a conversa diz que a resposta da pergunta ainda está sendo gerada.
      const during = (await (await fetch(`${base}/conversations/${conversation.conversationId}/messages`)).json()) as { data: { pendingReply: { questionInteractionId: string; clientMessageId: string } | null; messages: { role: string }[] } }
      expect(during.data.pendingReply).toMatchObject({ questionInteractionId: conversation.userMessageId, clientMessageId: CLIENT_KEY })
      expect(during.data.messages.map((message) => message.role)).toEqual(["user"])
      release()
      for (let index = 0; index < 50 && !memory.messages.some((message) => message.role === "assistant"); index += 1) await sleep(20)
      // A resposta inteira ficou gravada na conversa, e não há mais nada "em andamento".
      expect(memory.messages.map((message) => [message.role, message.content])).toEqual([["user", "pergunta longa"], ["assistant", "Para abrir a contestação, use a opção Contestar na fatura."]])
      for (let index = 0; index < 50 && aiCallLimiter().stats().running.INTERACTIVE > 0; index += 1) await sleep(20)
      expect(aiCallLimiter().stats().running).toEqual({ INTERACTIVE: 0, BATCH: 0 })
      const after = (await (await fetch(`${base}/conversations/${conversation.conversationId}/messages`)).json()) as { data: { pendingReply: unknown; messages: { role: string }[] } }
      expect(after.data.pendingReply).toBeNull()
      expect(after.data.messages.map((message) => message.role)).toEqual(["user", "assistant"])
    } finally {
      release()
      await close()
    }
  })

  it("PARAR (cancelar de propósito): o cancelamento chega ao gateway, a vaga do limitador volta e nenhuma resposta é gravada", async () => {
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
    const { url, base, memory, close } = await serve(stream, 10_000)
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body("pergunta longa") })
      const reader = response.body!.getReader()
      await readUntil(reader, "conversation")
      await providerStarted
      expect(aiCallLimiter().stats().running.INTERACTIVE).toBe(1)
      const stop = (await (await fetch(`${base}/messages/${CLIENT_KEY}/cancel`, { method: "POST" })).json()) as { data: { cancelled: boolean } }
      expect(stop.data.cancelled).toBe(true)
      for (let index = 0; index < 50 && aiCallLimiter().stats().running.INTERACTIVE > 0; index += 1) await sleep(20)
      expect(observed!.aborted).toBe(true)
      expect(aiCallLimiter().stats().running).toEqual({ INTERACTIVE: 0, BATCH: 0 })
      // O stream termina sem erro para a tela (ela mesma pediu) e sem resposta gravada; a pergunta fica (é uma dúvida real).
      const rest = await new Response(new ReadableStream({ start: async (controller) => { for (;;) { const { value, done } = await reader.read(); if (done) break; controller.enqueue(value) } controller.close() } })).text()
      expect(rest).not.toContain("event: error")
      expect(memory.messages.map((message) => [message.role, message.content])).toEqual([["user", "pergunta longa"]])
      // Cancelar de novo (ou a chave de outra pessoa/resposta já terminada) não acha nada.
      const again = (await (await fetch(`${base}/messages/${CLIENT_KEY}/cancel`, { method: "POST" })).json()) as { data: { cancelled: boolean } }
      expect(again.data.cancelled).toBe(false)
    } finally {
      await close()
    }
  })
})
