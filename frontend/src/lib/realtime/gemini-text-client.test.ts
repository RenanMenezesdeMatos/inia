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

describe("fetchTextReply — esclarecimento pelas bases", () => {
  // Estado fictício (base de teste).
  const view = {
    version: "KNOWLEDGE_CLARIFICATION_V1",
    id: "11111111-1111-4111-8111-111111111111",
    originalQuestion: "Pergunta?",
    status: "OPEN",
    steps: [{ id: "step_1_aaaaaaaa", dimension: "Dimensão", question: "Qual cenário?", selectionMode: "SINGLE", options: ["A", "B"].map((label, index) => ({ id: `opt_00000000${index}${index}`, label, description: null, group: null, evidence: [{ documentId: `kb-${index}`, documentTitle: `Base ${index}`, versionId: "v1", heading: "1. Seção", chunkIndex: 0, available: true }] })), answer: null }],
    questionFacts: [],
    coverage: { consideredDocuments: 2, matchedDocuments: 2, presentedDocuments: 2, omittedDocuments: 0, complete: true },
    sources: [],
    conflicts: [],
    notice: null,
    updatedAt: "2026-10-20T12:00:00.000Z",
    scenario: [],
  }

  it("envia a escolha estruturada junto do texto legível e lê o estado validado do evento knowledge_clarification", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(`${CONVERSATION}event: chunk\ndata: ${JSON.stringify({ text: "Qual cenário?" })}\n\nevent: persisted\ndata: ${JSON.stringify({ interactionId: "int-c" })}\n\nevent: knowledge_clarification\ndata: ${JSON.stringify({ interactionId: "int-c", clarification: view })}\n\nevent: done\ndata: {}\n\n`))
    const choice = { clarificationId: view.id, stepId: "step_1_aaaaaaaa", optionIds: ["opt_0000000000"], noneMatched: false, revise: false }
    const reply = await fetchTextReply({ ...MESSAGE("A"), clarification: choice }, () => {})
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body))).toMatchObject({ text: "A", clarification: choice })
    expect(reply.clarification).toMatchObject({ id: view.id, status: "OPEN" })
    expect(reply.interactionId).toBe("int-c")
  })

  it("estado fora do formato esperado é ignorado (a resposta aparece sem formulário)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(`${CONVERSATION}event: chunk\ndata: ${JSON.stringify({ text: "Qual cenário?" })}\n\nevent: knowledge_clarification\ndata: ${JSON.stringify({ interactionId: "int-c", clarification: { id: "x" } })}\n\nevent: done\ndata: {}\n\n`))
    const reply = await fetchTextReply(MESSAGE("pergunta"), () => {})
    expect(reply.clarification).toBeUndefined()
    expect(reply.text).toBe("Qual cenário?")
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

describe("fetchTextReply — resposta em fluxo", () => {
  /** Corpo entregue em pedaços arbitrários (o servidor manda cada evento assim que acontece). */
  function chunkedSse(body: string, size = 9): Response {
    const bytes = new TextEncoder().encode(body)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < bytes.length; index += size) controller.enqueue(bytes.slice(index, index + size))
        controller.close()
      },
    })
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } })
  }

  it("progresso (`status`) vai para onStatus e nunca entra no texto; `retract` apaga o que foi mostrado; batimentos são ignorados", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(chunkedSse(`${CONVERSATION}: ping\n\nevent: status\ndata: ${JSON.stringify({ stage: "TOOLS", label: "Consultando as bases de conhecimento…" })}\n\nevent: chunk\ndata: ${JSON.stringify({ text: "Vou ver" })}\n\nevent: retract\ndata: {}\n\nevent: chunk\ndata: ${JSON.stringify({ text: "Resposta " })}\n\nevent: chunk\ndata: ${JSON.stringify({ text: "final." })}\n\nevent: persisted\ndata: ${JSON.stringify({ interactionId: "int-3" })}\n\nevent: done\ndata: {}\n\n`))
    const seen: string[] = []
    const statuses: string[] = []
    let retracts = 0
    const reply = await fetchTextReply(MESSAGE("pergunta"), (chunk) => seen.push(chunk), undefined, { onStatus: (status) => statuses.push(status.label), onRetract: () => (retracts += 1) })
    expect(statuses).toEqual(["Consultando as bases de conhecimento…"])
    expect(retracts).toBe(1)
    expect(seen).toEqual(["Vou ver", "Resposta ", "final."])
    expect(reply.text).toBe("Resposta final.")
  })

  it("pedaço da resposta pelas bases (`citations`) chega marcado para a tela tirar os marcadores de fonte; os outros, sem marca", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(chunkedSse(`${CONVERSATION}event: chunk\ndata: ${JSON.stringify({ text: "Abra o protocolo [1].", citations: true })}\n\nevent: chunk\ndata: ${JSON.stringify({ text: " Fim." })}\n\nevent: done\ndata: {}\n\n`))
    const seen: [string, unknown][] = []
    const reply = await fetchTextReply(MESSAGE("pergunta"), (chunk, meta) => seen.push([chunk, meta]))
    expect(seen).toEqual([["Abra o protocolo [1].", { citations: true }], [" Fim.", undefined]])
    expect(reply.text).toBe("Abra o protocolo [1]. Fim.")
  })

  it("quem pediu desiste (troca de conversa): o pedido é cancelado pelo sinal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const signal = (init as RequestInit).signal!
      return await new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))
    })
    const controller = new AbortController()
    const pending = fetchTextReply(MESSAGE("pergunta"), () => {}, undefined, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
