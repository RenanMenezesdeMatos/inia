import express from "express"
import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { parseStructuredFeedback } from "../../agents/application/run-agent.js"
import type { AgentSpecialty } from "../../agents/domain/agent-specialty.js"
import { runOrchestratedReply } from "../../assistant/application/run-orchestrated-reply.js"
import { specialistContractFor } from "../../assistant/application/run-specialist-tool.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import type { SelfChatContext } from "../../leadership-analytics/application/self-context.js"
import { INIA_CHAT_PERSONA, createRealtimeRouter } from "./realtime-router.js"

/**
 * CONTEXTO DA CONVERSA ≠ TRANSCRIÇÃO (2026-10-16). O contexto extra de `runOrchestratedReply` chega a cada especialista como
 * material de análise (`sharedContext`), e especialista de DOMÍNIO/transversal com material de análise cai no contrato
 * estruturado de feedback, cuja evidência precisa ser citação literal DESSE material. No chat de quem atende, a instrução da
 * conversa (persona, contexto da tela, tratamento, perfil, contexto de origem, regras de "meus resultados") ia como contexto extra:
 * uma dúvida de processo encaminhada a um especialista de domínio terminava em "A evidência retornada pelo agente não corresponde
 * a um trecho literal da transcrição". A instrução vai no prompt do Orquestrador; o contexto extra fica vazio (como na sessão de
 * feedback e na consulta de processo da liderança). Só a IA é falsa aqui: a orquestração, a escolha do contrato e a verificação
 * literal são as reais.
 */
const generateWithTools = vi.fn()
const specialistCalls: { agentId: string; query: string; sharedContext: string | undefined; options: Record<string, unknown> }[] = []
// O chat usa a chamada EM FLUXO: o mesmo modelo falso, com o texto entregue de uma vez.
vi.mock("../../assistant/infrastructure/gemini-function-calling-client.js", () => ({
  generateWithTools: (...args: unknown[]) => generateWithTools(...args),
  streamWithTools: async (contents: unknown, system: unknown, tools: unknown, onText: (text: string) => void, options: unknown) => {
    const result = (await generateWithTools(contents, system, tools, options)) as { kind: string; text?: string }
    if (result.kind === "text" && result.text) onText(result.text)
    return { ...result, streamedChars: result.kind === "text" ? (result.text ?? "").length : 0, firstTokenMs: 0 }
  },
}))
vi.mock("../../assistant/application/run-specialist-tool.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../assistant/application/run-specialist-tool.js")>()
  return { ...actual, runSpecialistTool: (...args: unknown[]) => fakeSpecialist(...(args as Parameters<typeof fakeSpecialist>)) }
})

const DOMAIN: AgentSpecialty = { kind: "DOMAIN", domain: null, capability: null, acceptsConsolidated: false }
/** O que um especialista responde a uma dúvida de processo quando é forçado ao contrato de feedback: evidência = paráfrase. */
const FEEDBACK_RAW = JSON.stringify({ title: "Contestação de fatura", summary: "Orientação de processo.", impactedIndicator: "Rechamada", evidenceFound: "O colaborador perguntou como contestar uma fatura.", observedBehavior: "Dúvida de processo.", relatedProcedure: "Contestação de fatura", recommendation: "Abrir a contestação no sistema." })

let feedbackRaw = FEEDBACK_RAW

/** Especialista de DOMÍNIO: contrato escolhido pela regra real; no contrato de feedback, a resposta passa pela verificação literal real. */
async function fakeSpecialist(_db: unknown, _organizationId: string, agentId: string, query: string, _operatorId: string, _periodDays?: number, sharedContext?: string, options: Record<string, unknown> = {}) {
  specialistCalls.push({ agentId, query, sharedContext, options })
  if (specialistContractFor(DOMAIN, sharedContext) === "FEEDBACK") parseStructuredFeedback(feedbackRaw, sharedContext ?? "")
  return { contract: "TEXT" as const, text: "Para contestar, abra a contestação no sistema em até 30 dias." }
}

const ORG = "00000000-0000-4000-8000-000000000001"
const LARISSA = "aaaaaaaa-0000-4000-8000-000000000001"
const user: AuthTokenPayload = { sub: "acc-1", personId: LARISSA, organizationId: ORG, role: "OPERATOR", name: "Larissa", email: "l@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
const emptyDb = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
const SPECIALIST_TOOL = { name: "agent_contestacao", description: "Contestação de fatura.", parameters: { type: "object" as const, properties: { query: { type: "string" } } } }
const orchestrator = { organizationId: ORG, orchestratorId: "orch-1", orchestratorName: "INIA", orchestratorAgentId: "agent-orch", systemPrompt: "PROMPT DO ORQUESTRADOR", specialists: [{ agentId: "agent-contestacao", toolName: "agent_contestacao" }], tools: [SPECIALIST_TOOL], outputInstructions: null, structuredOutput: null, recommendSupportMaterials: false }
const ORIGIN = "\n\n[CONTEXTO DE ORIGEM: recado do fechamento de agosto]"
const QUESTION = "Como eu contesto uma fatura?"
const self: SelfChatContext = { instructions: "REGRAS DE MEUS RESULTADOS", voiceInstructions: "REGRAS DA VOZ", toolset: { declarations: [], handles: () => false, execute: async () => ({ text: "", card: null }) } } as unknown as SelfChatContext

function setup() {
  const memory = createMemoryConversationStore()
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use(
    "/api/v1/realtime",
    createRealtimeRouter(emptyDb, async () => ({ wsUrl: "wss://x", model: "m", expiresAt: "" }), async (_history, _instruction, onChunk) => onChunk("genérico"), {
      conversations: memory.store,
      now: () => new Date("2026-10-16T12:00:00.000Z"),
      resolveOrchestrator: async () => orchestrator as never,
      // A orquestração REAL (sem injeção): é ela que repassa o contexto extra aos especialistas.
      conversationGuardrails: async () => "\n\nLIMITES",
      leadershipContext: async () => null,
      selfContext: async () => self,
      workflowContext: async () => ORIGIN,
    }),
  )
  return { app, memory }
}

/** Eventos SSE da resposta do chat de texto. */
function events(text: string) {
  return text.split("\n\n").filter(Boolean).flatMap((block) => {
    const event = /^event: (.+)$/m.exec(block)?.[1]
    const data = /^data: (.+)$/m.exec(block)?.[1]
    return event && data ? [{ event, data: JSON.parse(data) as Record<string, unknown> }] : []
  })
}

beforeEach(() => {
  specialistCalls.length = 0
  feedbackRaw = FEEDBACK_RAW
  generateWithTools.mockReset()
    .mockResolvedValueOnce({ kind: "functionCalls", calls: [{ name: "agent_contestacao", args: { query: QUESTION } }] })
    .mockResolvedValueOnce({ kind: "text", text: "Para contestar, abra a contestação no sistema em até 30 dias." })
})

describe("chat e voz de quem atende — a instrução da conversa nunca chega ao especialista como transcrição", () => {
  it("chat de texto: especialista de domínio responde em texto, sem material de análise; a instrução fica no prompt do Orquestrador", async () => {
    const { app } = setup()
    const response = await request(app).post("/api/v1/realtime/messages").send({ conversationId: null, text: QUESTION, clientMessageId: "11111111-aaaa-4aaa-8aaa-000000000001", contextHint: "Indicador prioritário: Rechamada" })
    const sse = events(response.text)
    expect(sse.find((item) => item.event === "error")).toBeUndefined()
    expect(sse.find((item) => item.event === "chunk")!.data.text).toBe("Para contestar, abra a contestação no sistema em até 30 dias.")

    expect(specialistCalls).toHaveLength(1)
    expect(specialistCalls[0]!.sharedContext).toBeUndefined()
    expect(specialistContractFor(DOMAIN, specialistCalls[0]!.sharedContext)).toBe("TEXT")
    expect(specialistCalls[0]!.options).toMatchObject({ collaboratorConversation: true })

    // O Orquestrador continua vendo tudo o que via: o prompt dele seguido da instrução da conversa.
    const routingPrompt = generateWithTools.mock.calls[0]![1] as string
    expect(routingPrompt.startsWith("PROMPT DO ORQUESTRADOR\n\n")).toBe(true)
    expect(routingPrompt).toContain(INIA_CHAT_PERSONA)
    expect(routingPrompt).toContain("Indicador prioritário: Rechamada")
    expect(routingPrompt).toContain("REGRAS DE MEUS RESULTADOS")
    // O prompt do Orquestrador já traz os limites dele: nada é anexado de novo.
    expect(routingPrompt).not.toContain("LIMITES")
  })

  it("chat de texto numa conversa de Workflow: o contexto de origem vai ao Orquestrador, nunca ao especialista", async () => {
    const { app, memory } = setup()
    const conversationId = memory.seedWorkflowConversation({ organizationId: ORG, ownerPersonId: LARISSA }, { title: "Retorno do fechamento de agosto", text: "Olá! Tenho um retorno novo…", at: new Date("2026-10-16T11:00:00.000Z") })
    const response = await request(app).post("/api/v1/realtime/messages").send({ conversationId, text: QUESTION, clientMessageId: "22222222-aaaa-4aaa-8aaa-000000000001" })
    expect(events(response.text).find((item) => item.event === "error")).toBeUndefined()
    expect(specialistCalls[0]!.sharedContext).toBeUndefined()
    expect(generateWithTools.mock.calls[0]![1] as string).toContain("[CONTEXTO DE ORIGEM: recado do fechamento de agosto]")
  })

  it("voz (self_ask): a mesma orquestração, sem material de análise para o especialista", async () => {
    const { app, memory } = setup()
    const conversationId = memory.seedWorkflowConversation({ organizationId: ORG, ownerPersonId: LARISSA }, { title: "Retorno do fechamento de agosto", text: "Olá! Tenho um retorno novo…", at: new Date("2026-10-16T11:00:00.000Z") })
    const response = await request(app).post("/api/v1/realtime/tool-call").send({ toolName: "self_ask", query: QUESTION, conversationId, turnId: "voice-1-1", callId: "call-1" })
    expect(response.status).toBe(200)
    expect(response.body.data.text).toBe("Para contestar, abra a contestação no sistema em até 30 dias.")
    expect(specialistCalls).toHaveLength(1)
    expect(specialistCalls[0]!.sharedContext).toBeUndefined()
    const routingPrompt = generateWithTools.mock.calls[0]![1] as string
    expect(routingPrompt.startsWith("PROMPT DO ORQUESTRADOR\n\n")).toBe(true)
    expect(routingPrompt).toContain(INIA_CHAT_PERSONA)
    expect(routingPrompt).toContain("REGRAS DE MEUS RESULTADOS")
    expect(routingPrompt).toContain("[CONTEXTO DE ORIGEM: recado do fechamento de agosto]")
  })

  it("Workflow (não muda): o contexto extra é a transcrição da interação e chega ao especialista, que cita dela literalmente", async () => {
    const transcript = "Cliente: Quero contestar minha fatura.\nAtendente: Vou abrir a contestação agora."
    feedbackRaw = JSON.stringify({ ...JSON.parse(FEEDBACK_RAW), evidenceFound: "Vou abrir a contestação agora." })
    await runOrchestratedReply(emptyDb, orchestrator, [{ role: "user", text: "Avalie a chamada." }], transcript, LARISSA)
    expect(specialistCalls[0]!.sharedContext).toBe(transcript)
    expect(specialistContractFor(DOMAIN, transcript)).toBe("FEEDBACK")
  })
})
