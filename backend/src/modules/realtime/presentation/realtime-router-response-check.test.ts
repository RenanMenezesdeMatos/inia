import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import type { runOrchestratedReply } from "../../assistant/application/run-orchestrated-reply.js"
import type { ResponseCheckResult } from "../../governance/application/response-compliance.js"
import { RESPONSE_BLOCKED_TEXT, RESPONSE_CHECK_UNAVAILABLE_TEXT, SPOKEN_VIOLATION_NOTICE } from "../../governance/domain/response-compliance.js"
import { createRealtimeRouter } from "./realtime-router.js"

/**
 * CONFERÊNCIA DA RESPOSTA NAS ROTAS (PEN-017). O que importa aqui é a ORDEM: no chat, nenhum pedaço da resposta sai antes da conferência; numa
 * violação ou falha, o texto gerado nunca aparece no fluxo. Na voz, o que vem do servidor é conferido antes de chegar ao modelo de voz; o que já foi
 * falado só é conferido depois, e o teste deixa isso explícito.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const PERSON = "aaaaaaaa-0000-4000-8000-000000000001"
const user: AuthTokenPayload = { sub: "acc-1", personId: PERSON, organizationId: ORG, role: "OPERATOR", name: "Larissa", email: "l@inia.com", avatarUrl: null, jobTitle: null, teamId: null, subteamId: null } as never
const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next
  if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code } })
  res.status(500).json({ error: { message: (error as Error).message } })
}
const orchestrator = { organizationId: ORG, orchestratorId: "orch-1", orchestratorName: "INIA", orchestratorAgentId: "agent-orch", systemPrompt: "PROMPT", specialists: [], tools: [], outputInstructions: null, structuredOutput: null }
const VIOLATION: ResponseCheckResult = { outcome: "VIOLATION", hits: [{ kind: "PROHIBITED_TOPIC", name: "Política" }], reason: "Opinou sobre política.", model: "m", durationMs: 3 }
const FAILED: ResponseCheckResult = { outcome: "CHECK_FAILED", code: "RESPONSE_CHECK_PROVIDER_ERROR", message: "O provedor não concluiu.", model: null, durationMs: 3 }
const ALLOWED: ResponseCheckResult = { outcome: "ALLOWED", model: "m", durationMs: 3 }
const GENERATED = "Em quem votar: minha opinião é esta."

type Row = { sql: string; params: unknown[] }
const RETRIEVED = { documentId: "kb-1", documentTitle: "Reparo — Linha Móvel", heading: "Prazo", excerpt: "Abra a análise de rede, com prazo de até 72 horas.", score: 1 }
const KB_SOURCE = { origin: "KNOWLEDGE", title: "Reparo — Linha Móvel › Prazo", text: RETRIEVED.excerpt }
function setup(options: { check: () => ResponseCheckResult; rules?: boolean; streamed?: boolean; results?: unknown[]; orchestratorKnowledge?: unknown; directResults?: unknown[] }) {
  const memory = createMemoryConversationStore()
  const inserts: Row[] = []
  const checks: { text: string; question: unknown; agentId: unknown; sources: unknown }[] = []
  // Sugestões de falar com um Anjo registradas (Apoio com Anjo): só a falha da conferência gera sinal.
  const suggestions: string[] = []
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("insert into response_compliance_checks")) inserts.push({ sql, params })
      if (sql.includes("from prohibited_topics") && options.rules !== false) return { rows: [{ name: "Política", required_behavior: "Não opine sobre política." }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Database
  const reply: typeof runOrchestratedReply = async (...args) => {
    const hooks = args[7] as { stream?: { text: (chunk: string) => void } } | undefined
    if (options.streamed !== false) hooks?.stream?.text(GENERATED)
    return { text: GENERATED, agentId: null, calls: [], results: (options.results ?? []) as never, ...(options.directResults ? { directResults: options.directResults as never } : {}), structuredResult: null, supportMaterialCandidates: [], ...(options.streamed !== false ? { streamedText: GENERATED } : {}) }
  }
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use(
    "/api/v1/realtime",
    createRealtimeRouter(db, async () => ({ wsUrl: "wss://x", model: "m", expiresAt: "" }), async (_history, _instruction, onText) => { onText(GENERATED) }, {
      conversations: memory.store,
      now: () => new Date("2026-11-04T12:00:00.000Z"),
      resolveOrchestrator: async () => ({ ...orchestrator, ...(options.orchestratorKnowledge ? { knowledge: options.orchestratorKnowledge } : {}) }) as never,
      orchestratedReply: reply,
      conversationGuardrails: async () => "",
      selfContext: async () => ({ instructions: "", voiceInstructions: "", toolset: { handles: () => false, execute: async () => ({}), declarations: [] } }),
      recordSuggestion: async (input: { interactionId: string }) => {
        suggestions.push(input.interactionId)
      },
      responseCheck: async (_db: unknown, input: { text: string; question?: unknown; agentId?: unknown; sources?: unknown }) => {
        checks.push({ text: input.text, question: input.question, agentId: input.agentId ?? null, sources: input.sources })
        return options.check()
      },
    } as never),
  )
  app.use(errorHandler)
  const chat = async (conversationId: string | null = null) => {
    const response = await request(app).post("/api/v1/realtime/messages").send({ conversationId, text: "Em quem votar?", clientMessageId: `${Date.now()}-${Math.random()}`.replace(".", "") })
    const events = [...response.text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((match) => ({ event: match[1]!, data: JSON.parse(match[2]!) as Record<string, unknown> }))
    return { response, events, shown: events.filter((item) => item.event === "chunk").map((item) => item.data.text).join("") }
  }
  const assistantMessages = () => memory.messages.filter((message) => message.role === "assistant")
  return { app, memory, inserts, checks, suggestions, chat, assistantMessages }
}
const recorded = (row: Row) => ({ surface: row.params[1], control: row.params[2], outcome: row.params[3], action: row.params[4], flagged: row.params[8] })

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.spyOn(console, "info").mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("chat: conferência ANTES da entrega (prevenção)", () => {
  it("permitida: o texto só sai depois da conferência, e fica registrado sem conteúdo", async () => {
    let shownBeforeCheck: boolean | null = null
    const harness = setup({ check: () => { shownBeforeCheck = false; return ALLOWED } })
    const { events, shown } = await harness.chat()
    expect(shown).toBe(GENERATED)
    expect(harness.checks[0]).toMatchObject({ text: GENERATED, question: "Em quem votar?", agentId: "agent-orch" })
    // A ordem no fluxo: o aviso de conferência vem antes de qualquer pedaço da resposta.
    const names = events.map((item) => item.event)
    const checking = events.findIndex((item) => item.event === "status" && item.data.stage === "RESPONSE_CHECK")
    expect(checking).toBeGreaterThanOrEqual(0)
    expect(checking).toBeLessThan(names.indexOf("chunk"))
    expect(events[checking]!.data.label).toBe("Conferindo a resposta…")
    expect(harness.assistantMessages()[0]!.content).toBe(GENERATED)
    expect(recorded(harness.inserts[0]!)).toEqual({ surface: "CHAT", control: "PREVENTIVE", outcome: "ALLOWED", action: "DELIVERED", flagged: null })
    expect(shownBeforeCheck).toBe(false)
  })

  it("violação: o texto gerado nunca entra no fluxo nem na conversa; a pessoa recebe o texto fixo; o original fica só no registro", async () => {
    const harness = setup({ check: () => VIOLATION })
    const { response, shown, events } = await harness.chat()
    expect(response.text).not.toContain(GENERATED)
    expect(shown).toBe(RESPONSE_BLOCKED_TEXT)
    expect(events.some((item) => item.event === "retract")).toBe(false)
    const saved = harness.assistantMessages()[0]!
    expect(saved.content).toBe(RESPONSE_BLOCKED_TEXT)
    expect(saved.toolCalls).toEqual([{ toolName: "response_check", outcome: "VIOLATION", control: "PREVENTIVE", rules: [{ kind: "PROHIBITED_TOPIC", name: "Política" }] }])
    expect(recorded(harness.inserts[0]!)).toEqual({ surface: "CHAT", control: "PREVENTIVE", outcome: "VIOLATION", action: "BLOCKED", flagged: GENERATED })
    expect(harness.inserts[0]!.params[10]).toBe(saved.id)
    // Violação de regra não é falta de informação: sem sinal, sem sugestão de falar com um Anjo.
    expect(harness.memory.signals.get(saved.id)).toEqual([])
    expect(harness.suggestions).toEqual([])
  })

  it("falha da própria conferência: nada do texto sai; a pessoa é avisada e a falha fica registrada", async () => {
    const harness = setup({ check: () => FAILED })
    const { response, shown, events } = await harness.chat()
    expect(response.text).not.toContain(GENERATED)
    expect(shown).toBe(RESPONSE_CHECK_UNAVAILABLE_TEXT)
    const saved = harness.assistantMessages()[0]!
    expect(saved.content).toBe(RESPONSE_CHECK_UNAVAILABLE_TEXT)
    // Para a pessoa, a consulta não terminou: `CONSULTATION_FAILED` na mensagem e na tela, e a sugestão de falar com um Anjo.
    expect(harness.memory.signals.get(saved.id)).toEqual(["CONSULTATION_FAILED"])
    expect(events.find((item) => item.event === "persisted")?.data.signals).toEqual(["CONSULTATION_FAILED"])
    expect(harness.suggestions).toEqual([saved.id])
    expect(recorded(harness.inserts[0]!)).toEqual({ surface: "CHAT", control: "PREVENTIVE", outcome: "CHECK_FAILED", action: "BLOCKED", flagged: GENERATED })
    expect(harness.inserts[0]!.params[7]).toBe("RESPONSE_CHECK_PROVIDER_ERROR")
  })

  it("sem regra cadastrada: fluxo normal, sem segurar o texto", async () => {
    const harness = setup({ rules: false, check: () => ({ outcome: "NOT_APPLICABLE" }) })
    const { shown, events } = await harness.chat()
    expect(shown).toBe(GENERATED)
    expect(events.some((item) => item.event === "status" && item.data.stage === "RESPONSE_CHECK")).toBe(false)
    expect(harness.inserts).toEqual([])
  })

  it("retentativa da mesma mensagem devolve o que foi gravado, sem gerar nem conferir de novo", async () => {
    const harness = setup({ check: () => VIOLATION })
    const body = { conversationId: null, text: "Em quem votar?", clientMessageId: "11111111-1111-4111-8111-111111111111" }
    await request(harness.app).post("/api/v1/realtime/messages").send(body)
    const again = await request(harness.app).post("/api/v1/realtime/messages").send(body)
    expect(again.text).toContain(RESPONSE_BLOCKED_TEXT)
    expect(again.text).not.toContain(GENERATED)
    expect(harness.checks).toHaveLength(1)
  })
})

describe("chat em AUDIT: só DETECÇÃO, e isso não é chamado de prevenção", () => {
  beforeEach(() => vi.stubEnv("INIA_RESPONSE_CHECK", "AUDIT"))

  it("violação: o texto já saiu; ele é retirado da tela e da conversa, e o registro diz DETECTIVE", async () => {
    const harness = setup({ check: () => VIOLATION })
    const { response, events } = await harness.chat()
    expect(response.text).toContain(GENERATED)
    const names = events.map((item) => item.event)
    expect(names.indexOf("chunk")).toBeLessThan(names.indexOf("retract"))
    expect(harness.assistantMessages()[0]!.content).toBe(SPOKEN_VIOLATION_NOTICE)
    expect(recorded(harness.inserts[0]!)).toEqual({ surface: "CHAT", control: "DETECTIVE", outcome: "VIOLATION", action: "RECORDED", flagged: GENERATED })
  })

  it("falha da conferência: a resposta já entregue fica, e a falha vai para o registro", async () => {
    const harness = setup({ check: () => FAILED })
    await harness.chat()
    expect(harness.assistantMessages()[0]!.content).toBe(GENERATED)
    expect(recorded(harness.inserts[0]!)).toEqual({ surface: "CHAT", control: "DETECTIVE", outcome: "CHECK_FAILED", action: "RECORDED", flagged: GENERATED })
  })
})

describe("modo desligado", () => {
  it("OFF: não confere nem registra", async () => {
    vi.stubEnv("INIA_RESPONSE_CHECK", "OFF")
    const harness = setup({ check: () => VIOLATION })
    const { shown } = await harness.chat()
    expect(shown).toBe(GENERATED)
    expect(harness.checks).toEqual([])
    expect(harness.inserts).toEqual([])
  })
})

describe("voz: o que vem do servidor é conferido ANTES de chegar ao modelo de voz", () => {
  const toolCall = (harness: ReturnType<typeof setup>, toolName: string, turnId: string) => request(harness.app).post("/api/v1/realtime/tool-call").send({ toolName, query: "Em quem votar?", conversationId: null, turnId, callId: "call-1" })

  it("self_ask em violação: o modelo de voz e a tela recebem só o texto fixo", async () => {
    const harness = setup({ check: () => VIOLATION, streamed: false })
    const response = await toolCall(harness, "self_ask", "turno-de-voz-1")
    expect(response.status, response.text).toBe(200)
    expect(response.text).not.toContain(GENERATED)
    expect(response.body.data.text).toBe(RESPONSE_BLOCKED_TEXT)
    expect(response.body.data.modelText).toContain(RESPONSE_BLOCKED_TEXT)
    expect(response.body.data.modelText).toContain("fale exatamente o texto acima")
    expect(recorded(harness.inserts[0]!)).toEqual({ surface: "VOICE_TOOL", control: "PREVENTIVE", outcome: "VIOLATION", action: "BLOCKED", flagged: GENERATED })
    expect(harness.memory.signals.get(response.body.data.interactionId)).toEqual([])
    expect(harness.suggestions).toEqual([])
  })

  it("self_ask permitido: segue igual, com o registro", async () => {
    const harness = setup({ check: () => ALLOWED, streamed: false })
    const response = await toolCall(harness, "self_ask", "turno-de-voz-2")
    expect(response.body.data.text).toBe(GENERATED)
    expect(recorded(harness.inserts[0]!)).toEqual({ surface: "VOICE_TOOL", control: "PREVENTIVE", outcome: "ALLOWED", action: "DELIVERED", flagged: null })
  })

  it("self_ask com falha da conferência: não fala o texto gerado", async () => {
    const harness = setup({ check: () => FAILED, streamed: false })
    const response = await toolCall(harness, "self_ask", "turno-de-voz-3")
    expect(response.text).not.toContain(GENERATED)
    expect(response.body.data.text).toBe(RESPONSE_CHECK_UNAVAILABLE_TEXT)
    expect(recorded(harness.inserts[0]!)).toMatchObject({ surface: "VOICE_TOOL", outcome: "CHECK_FAILED", action: "BLOCKED" })
    // Como no chat: a consulta não terminou para a pessoa (sinal gravado e sugestão de falar com um Anjo).
    expect(harness.memory.signals.get(response.body.data.interactionId)).toEqual(["CONSULTATION_FAILED"])
    expect(harness.suggestions).toEqual([response.body.data.interactionId])
  })
})

describe("a conferência sabe de onde veio a resposta (V3)", () => {
  const toolCall = (harness: ReturnType<typeof setup>, toolName: string, turnId: string, conversationId: string | null = null) => request(harness.app).post("/api/v1/realtime/tool-call").send({ toolName, query: "Como abro o reparo?", conversationId, turnId, callId: "call-1" })
  const voiceTurn = (harness: ReturnType<typeof setup>, body: Record<string, unknown>) => request(harness.app).post("/api/v1/realtime/voice-turn").send({ turnId: `turno-de-voz-${Math.random()}`.replace(".", ""), ...body })

  it("chat: recebe os trechos consultados pelos especialistas e os do próprio Orquestrador; na primeira mensagem, nenhuma resposta anterior", async () => {
    const harness = setup({ check: () => ALLOWED, results: [{ agentId: "esp", toolName: "agent_a", text: "x", knowledge: { retrieved: [RETRIEVED] } }], orchestratorKnowledge: { retrieved: [{ ...RETRIEVED, heading: "Geral", excerpt: "Regra geral do Orquestrador." }] } })
    await harness.chat()
    expect(harness.checks[0]!.sources).toEqual([KB_SOURCE, { origin: "KNOWLEDGE", title: "Reparo — Linha Móvel › Geral", text: "Regra geral do Orquestrador." }])
  })

  it("chat, sem consulta a nenhuma base: nenhuma fonte, e a conferência fica como era", async () => {
    const harness = setup({ check: () => ALLOWED })
    await harness.chat()
    expect(harness.checks[0]!.sources).toEqual([])
  })

  it("chat, mensagem seguinte da mesma conversa: a resposta anterior vai como fonte", async () => {
    const harness = setup({ check: () => ALLOWED })
    const first = await harness.chat()
    const conversationId = first.events.find((item) => item.event === "conversation")!.data.conversationId as string
    await harness.chat(conversationId)
    expect(harness.checks[1]!.sources).toEqual([{ origin: "PRIOR_ANSWER", title: null, text: GENERATED }])
  })

  it("chat bloqueado: o texto barrado não vira fonte da mensagem seguinte; só o texto fixo fica na conversa", async () => {
    let answer: ResponseCheckResult = VIOLATION
    const harness = setup({ check: () => answer })
    const first = await harness.chat()
    answer = ALLOWED
    await harness.chat(first.events.find((item) => item.event === "conversation")!.data.conversationId as string)
    expect(harness.checks[1]!.sources).toEqual([{ origin: "PRIOR_ANSWER", title: null, text: RESPONSE_BLOCKED_TEXT }])
  })

  it("voz, self_ask: recebe os trechos consultados antes de chegar ao modelo de voz", async () => {
    const harness = setup({ check: () => ALLOWED, streamed: false, results: [{ agentId: "esp", toolName: "agent_a", text: "x", knowledge: { retrieved: [RETRIEVED] } }] })
    const response = await toolCall(harness, "self_ask", "turno-de-voz-fontes-1")
    expect(response.status, response.text).toBe(200)
    expect(harness.checks[0]!.sources).toEqual([KB_SOURCE])
  })

  // Caso real de 11/11/2026: "quero saber dos MEUS números" — `my_results` calculou e a conferência barrou os números por "criar valores".
  const MY_RESULTS = { agentId: null, toolName: "my_results", text: "[Seus resultados, calculados pelo sistema]\n| Reincidência em até 7 Dias | 11,6% | 9% |" }
  const DATA_SOURCE = { origin: "DATA", title: "my_results", text: MY_RESULTS.text }
  it("chat: os dados calculados por uma ferramenta do backend vão como fonte; a consulta de processo (texto de IA) não", async () => {
    const process = { agentId: null, toolName: "leadership_process", text: "Resposta do Orquestrador do Grupo." }
    const harness = setup({ check: () => ALLOWED, results: [MY_RESULTS, process], directResults: [{ toolName: "my_results", args: {}, card: null }, { toolName: "leadership_process", args: {}, card: null }] })
    await harness.chat()
    expect(harness.checks[0]!.sources).toEqual([DATA_SOURCE])
  })

  it("voz, self_ask: os dados calculados chegam à conferência antes do modelo de voz", async () => {
    const harness = setup({ check: () => ALLOWED, streamed: false, results: [MY_RESULTS], directResults: [{ toolName: "my_results", args: {}, card: null }] })
    const response = await toolCall(harness, "self_ask", "turno-de-voz-dados-1")
    expect(response.status, response.text).toBe(200)
    expect(harness.checks[0]!.sources).toEqual([DATA_SOURCE])
  })

  it("voz, o que já foi falado: compara com o que o servidor entregou à voz nesta conversa, porque repetir não é criar", async () => {
    const harness = setup({ check: () => ALLOWED, streamed: false })
    const tool = await toolCall(harness, "self_ask", "turno-de-voz-fontes-2")
    await voiceTurn(harness, { conversationId: tool.body.data.conversationId, userText: "Como abro o reparo?", spokenText: "O prazo é o que está na tela." })
    expect(harness.checks.at(-1)).toMatchObject({ text: "O prazo é o que está na tela.", sources: [{ origin: "PRIOR_ANSWER", title: null, text: GENERATED }] })
  })

  it("voz, fala numa conversa nova sem nenhuma resposta do servidor: vai sem fonte", async () => {
    const harness = setup({ check: () => ALLOWED })
    await voiceTurn(harness, { conversationId: null, userText: "Oi", assistantText: "Olá!" })
    expect(harness.checks[0]!.sources).toEqual([])
  })
})

describe("voz: o que já foi falado só pode ser DETECTADO", () => {
  const voiceTurn = (harness: ReturnType<typeof setup>, body: Record<string, unknown>) => request(harness.app).post("/api/v1/realtime/voice-turn").send({ conversationId: null, turnId: `turno-de-voz-${Math.random()}`.replace(".", ""), ...body })

  it("fala permitida: gravada como foi dita", async () => {
    const harness = setup({ check: () => ALLOWED })
    const response = await voiceTurn(harness, { userText: "Oi", assistantText: "Olá!" })
    expect(response.body.data.responseCheck).toBeUndefined()
    expect(harness.assistantMessages()[0]!.content).toBe("Olá!")
    expect(recorded(harness.inserts[0]!)).toEqual({ surface: "VOICE_SPOKEN", control: "DETECTIVE", outcome: "ALLOWED", action: "DELIVERED", flagged: null })
  })

  it("fala em violação: registro DETECTIVE com o texto; a conversa e o contexto da IA ficam com o aviso; a tela é avisada", async () => {
    const harness = setup({ check: () => VIOLATION })
    const response = await voiceTurn(harness, { userText: "Em quem votar?", assistantText: GENERATED })
    expect(response.body.data.responseCheck).toEqual({ outcome: "VIOLATION", notice: SPOKEN_VIOLATION_NOTICE })
    expect(harness.assistantMessages()[0]!.content).toBe(SPOKEN_VIOLATION_NOTICE)
    expect(recorded(harness.inserts[0]!)).toEqual({ surface: "VOICE_SPOKEN", control: "DETECTIVE", outcome: "VIOLATION", action: "RECORDED", flagged: GENERATED })
  })

  it("turno com especialista: a fala não vira mensagem, mas é conferida", async () => {
    const harness = setup({ check: () => VIOLATION })
    const response = await voiceTurn(harness, { userText: "Em quem votar?", spokenText: GENERATED })
    expect(response.status).toBe(200)
    expect(response.body.data.assistantInteractionId).toBeNull()
    expect(response.body.data.responseCheck.notice).toBe(SPOKEN_VIOLATION_NOTICE)
    expect(harness.assistantMessages()).toEqual([])
    expect(recorded(harness.inserts[0]!)).toMatchObject({ surface: "VOICE_SPOKEN", outcome: "VIOLATION", flagged: GENERATED })
  })

  it("falha da conferência depois de falado: não há o que impedir; a fala fica e a falha é registrada", async () => {
    const harness = setup({ check: () => FAILED })
    const response = await voiceTurn(harness, { userText: "Oi", assistantText: "Olá!" })
    expect(response.body.data.responseCheck).toBeUndefined()
    expect(harness.assistantMessages()[0]!.content).toBe("Olá!")
    expect(recorded(harness.inserts[0]!)).toEqual({ surface: "VOICE_SPOKEN", control: "DETECTIVE", outcome: "CHECK_FAILED", action: "RECORDED", flagged: "Olá!" })
  })
})
