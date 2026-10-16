/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest"

import { indicatorAnalysisCard } from "@/components/leadership/leadership-fixtures"

import { ConversationClosedError, fetchConversationMessages, fetchTextReply } from "./gemini-text-client"

function sseResponse(body: string): Response {
  const bytes = new TextEncoder().encode(body)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } })
}

afterEach(() => vi.restoreAllMocks())

const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333"
const CONVERSATION = `event: conversation\ndata: ${JSON.stringify({ conversationId: CONVERSATION_ID, created: true, rotatedFrom: null, userMessageId: "u1" })}\n\n`
const MESSAGE = (text: string) => ({ conversationId: null, text, clientMessageId: "11111111-aaaa-4aaa-8aaa-000000000001", contextHint: "Contexto atual: indicador X." })

describe("fetchTextReply — materiais recomendados pelo Orquestrador chegam por evento próprio", () => {
  it("monta o texto dos chunks e lê support_materials (título real + motivo) antes de done; nenhuma URL vem do stream", async () => {
    const material = { materialId: "11111111-1111-4111-8111-111111111111", available: true, title: "Técnicas de sondagem em retenção", reason: "Traz perguntas de sondagem para retenção por preço." }
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(`${CONVERSATION}event: chunk\ndata: ${JSON.stringify({ text: "Aprofunde a " })}\n\nevent: chunk\ndata: ${JSON.stringify({ text: "sondagem." })}\n\nevent: support_materials\ndata: ${JSON.stringify({ interactionId: "int-1", supportMaterials: [material] })}\n\nevent: done\ndata: {}\n\n`),
    )
    const chunks: string[] = []
    const reply = await fetchTextReply(MESSAGE("como reter?"), (chunk) => chunks.push(chunk))
    expect(chunks).toEqual(["Aprofunde a ", "sondagem."])
    expect(reply.text).toBe("Aprofunde a sondagem.")
    expect(reply.supportMaterials).toEqual([material])
    expect(reply.interactionId).toBe("int-1")
    expect(JSON.stringify(reply)).not.toMatch(/https?:\/\/|\/materiais\//)
  })

  it("sem o evento, supportMaterials fica vazio (resposta funciona exatamente como antes)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(`${CONVERSATION}event: chunk\ndata: ${JSON.stringify({ text: "Olá!" })}\n\nevent: persisted\ndata: ${JSON.stringify({ interactionId: "int-9" })}\n\nevent: done\ndata: {}\n\n`))
    const reply = await fetchTextReply(MESSAGE("oi"), () => {})
    expect(reply).toEqual({ text: "Olá!", supportMaterials: [], interactionId: "int-9", conversationId: CONVERSATION_ID, persisted: true })
  })
})

describe("fetchTextReply — cartões de dados da liderança", () => {
  it("lê o evento analytics (números do backend) e ignora cartão de formato desconhecido", async () => {
    const card = indicatorAnalysisCard()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(`${CONVERSATION}event: chunk\ndata: ${JSON.stringify({ text: "9 de 23 fora." })}\n\nevent: persisted\ndata: ${JSON.stringify({ interactionId: "int-2" })}\n\nevent: analytics\ndata: ${JSON.stringify({ interactionId: "int-2", cards: [card, { type: "OUTRO" }] })}\n\nevent: done\ndata: {}\n\n`))
    const reply = await fetchTextReply(MESSAGE("qual % fora em TMA?"), () => {})
    expect(reply.analytics).toEqual([card])
  })
})

describe("fetchTextReply — conversa", () => {
  it("envia só a mensagem nova + a conversa exibida (nenhum histórico sai do navegador) e avisa a conversa antes do texto", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(`${CONVERSATION}event: chunk\ndata: {"text":"ok"}\n\nevent: done\ndata: {}\n\n`))
    const order: string[] = []
    await fetchTextReply(MESSAGE("oi"), () => order.push("chunk"), (conversation) => order.push(`conversation:${conversation.conversationId}`))
    expect(order).toEqual([`conversation:${CONVERSATION_ID}`, "chunk"])
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as { body: string }).body)
    expect(body).toEqual({ conversationId: null, text: "oi", clientMessageId: "11111111-aaaa-4aaa-8aaa-000000000001", contextHint: "Contexto atual: indicador X." })
    expect(body).not.toHaveProperty("history")
  })

  it("resposta exibida mas não salva: persisted = false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(`${CONVERSATION}event: chunk\ndata: {"text":"ok"}\n\nevent: persist_error\ndata: {"message":"x"}\n\nevent: done\ndata: {}\n\n`))
    expect((await fetchTextReply(MESSAGE("oi"), () => {})).persisted).toBe(false)
  })

  it("conversa encerrada em outra aba: erro próprio com a conversa atual", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { code: "ASSISTANT_CONVERSATION_CLOSED", details: { activeConversationId: "44444444-4444-4444-8444-444444444444" } } }), { status: 409 }))
    const error = await fetchTextReply(MESSAGE("oi"), () => {}).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ConversationClosedError)
    expect((error as ConversationClosedError).activeConversationId).toBe("44444444-4444-4444-8444-444444444444")
  })

  it("mensagens de uma conversa: página com cursor (anteriores)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { conversation: { id: CONVERSATION_ID }, messages: [], hasMore: false } }), { status: 200 }))
    await fetchConversationMessages(CONVERSATION_ID, { before: "abc", limit: 30 })
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain(`/api/v1/realtime/conversations/${CONVERSATION_ID}/messages?limit=30&before=abc`)
  })

  it("falha ao carregar mensagens é erro (nunca uma conversa vazia)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }))
    await expect(fetchConversationMessages(CONVERSATION_ID)).rejects.toThrow()
  })
})
