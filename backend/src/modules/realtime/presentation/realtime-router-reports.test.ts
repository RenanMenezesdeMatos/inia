import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import type { runOrchestratedReply } from "../../assistant/application/run-orchestrated-reply.js"
import type { LeadershipChatContext } from "../../leadership-analytics/application/leadership-context.js"
import { REPORT_OFFER_LINE, type ProposalRecord, type ProposalStore } from "../../reports/application/report-proposals.js"
import type { ReportRuntime } from "../../reports/application/report-runtime.js"
import { createMemoryReportStore } from "../../reports/testing/memory-report-store.js"
import { reportDefinitionSchema } from "../../reports/domain/report-definition.js"
import { createRealtimeRouter } from "./realtime-router.js"

/**
 * REPORT DESTA CONSULTA no chat: depois de uma consulta elegível a INIA oferece criar um report (botão + linha de texto); o
 * "sim" só vale para a proposta da ÚLTIMA resposta (texto e voz) e abre a configuração; "não" dispensa; outra pergunta expira.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const LEADER = "bbbbbbbb-0000-4000-8000-000000000001"
const leader: AuthTokenPayload = { sub: "acc-l", personId: LEADER, organizationId: ORG, role: "SUPERVISOR", name: "Sara", email: "s@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
const emptyDb = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next
  if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code } })
  res.status(500).json({ error: { message: (error as Error).message } })
}
const CARD = { type: "QUERY_TABLE", title: "TOP 3 — Reincidência", structure: { subject: { kind: "SUPERVISOR_TEAM", supervisorId: LEADER }, label: "Sara", description: null }, rows: [] }
const LEADERSHIP: LeadershipChatContext = { instructions: "[LIDERANÇA]", voiceInstructions: "[VOZ]", toolset: { declarations: [], handles: () => true, execute: async () => ({ text: "x", card: CARD as never }) } }

function parseSse(text: string) {
  return text.split("\n\n").filter((block) => block.startsWith("event:")).map((block) => {
    const [eventLine, dataLine] = block.split("\n")
    return { event: eventLine!.slice(7), data: JSON.parse(dataLine!.slice(6)) as Record<string, unknown> }
  })
}

function setup() {
  const memory = createMemoryConversationStore()
  const proposals: ProposalRecord[] = []
  let replies = 0
  const store: ProposalStore = {
    async prepareOffer(input) {
      if (!input.directResults.some((result) => result.toolName === "leadership_indicator_query")) return null
      if (proposals.some((proposal) => proposal.conversationId === input.conversationId)) return null
      const proposal: ProposalRecord = { id: `00000000-0000-4000-8000-00000000000${proposals.length + 1}`, organizationId: ORG, ownerAccountId: input.accountId, conversationId: input.conversationId, interactionId: null, toolName: "leadership_indicator_query", draft: { name: "TOP 3 — Reincidência", description: input.question, definition: reportDefinitionSchema.parse({ tool: "INDICATOR_QUERY", structure: { mode: "RECIPIENT" }, period: { mode: "LAST_CLOSED" } }), visualization: { type: "BAR" } }, signature: "s", status: "OFFERED", reportId: null, createdAt: new Date().toISOString() }
      proposals.push(proposal)
      return proposal
    },
    async attach(id, interactionId) {
      proposals.find((proposal) => proposal.id === id)!.interactionId = interactionId
    },
    async pendingForConversation(_organizationId, _accountId, conversationId) {
      const lastAssistant = memory.messages.filter((message) => message.conversationId === conversationId && message.role === "assistant").at(-1)
      return proposals.find((proposal) => proposal.conversationId === conversationId && proposal.status === "OFFERED" && proposal.interactionId === lastAssistant?.id) ?? null
    },
    async decide(id, status) {
      proposals.find((proposal) => proposal.id === id)!.status = status
    },
    async get(_organizationId, _accountId, id) {
      return proposals.find((proposal) => proposal.id === id) ?? null
    },
    async forInteractions(_organizationId, ids) {
      return new Map(proposals.filter((proposal) => proposal.interactionId && ids.includes(proposal.interactionId)).map((proposal) => [proposal.interactionId!, proposal]))
    },
  }
  const reply: typeof runOrchestratedReply = async () => {
    replies += 1
    return { text: "Os TOP 3 em Reincidência são Ana, Bia e Caio.", agentId: null, calls: [{ toolName: "leadership_indicator_query", query: "{}" }], results: [], structuredResult: null, supportMaterialCandidates: [], directResults: [{ toolName: "leadership_indicator_query", args: { indicadores: ["Reincidência"], limite: 3 }, card: CARD }] }
  }
  const runtime = { contextFor: async () => ({}) } as unknown as ReportRuntime
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = leader; next() })
  app.use(
    "/api/v1/realtime",
    createRealtimeRouter(emptyDb, async () => ({ wsUrl: "", model: "", expiresAt: "" }), async () => undefined, {
      conversations: memory.store,
      now: () => new Date(),
      resolveOrchestrator: async () => null,
      orchestratedReply: reply,
      conversationGuardrails: async () => "",
      leadershipContext: async () => LEADERSHIP,
      visibleLeadershipCards: async (_user, cards) => cards,
      reportProposals: store,
      reportRuntime: runtime,
      reportStore: createMemoryReportStore().store,
    }),
  )
  app.use(errorHandler)
  let counter = 0
  const say = (text: string, conversationId: string | null = null) => request(app).post("/api/v1/realtime/messages").send({ conversationId, text, clientMessageId: `33333333-aaaa-4aaa-8aaa-${String(++counter).padStart(12, "0")}` })
  return { app, memory, proposals, say, replies: () => replies }
}

describe("criar report a partir do chat", () => {
  it("consulta elegível → oferta (texto + evento + botão ao reabrir); 'sim' na resposta seguinte abre a configuração já preenchida", async () => {
    const { app, proposals, say, replies } = setup()
    const first = parseSse((await say("Quem são os TOP 3 em Reincidência do meu time?")).text)
    const conversationId = String(first[0]!.data.conversationId)
    expect(first.find((entry) => entry.event === "chunk")!.data.text).toContain(REPORT_OFFER_LINE.trim().slice(0, 30))
    expect(first.find((entry) => entry.event === "report_offer")!.data).toMatchObject({ proposalId: proposals[0]!.id, title: "TOP 3 — Reincidência" })
    const history = await request(app).get(`/api/v1/realtime/conversations/${conversationId}/messages`)
    expect(history.body.data.messages.find((message: { role: string }) => message.role === "assistant").reportOffer).toMatchObject({ proposalId: proposals[0]!.id, status: "OFFERED" })

    const accepted = parseSse((await say("sim, pode criar", conversationId)).text)
    expect(accepted.find((entry) => entry.event === "navigate")!.data).toMatchObject({ href: `/reports/novo?proposta=${proposals[0]!.id}` })
    expect(proposals[0]!.status).toBe("ACCEPTED")
    expect(replies()).toBe(1)
  })

  it("'não' dispensa a oferta; outra pergunta expira — e um 'sim' depois disso não abre nada (nunca fora de contexto)", async () => {
    const dismiss = setup()
    const conversationA = String(parseSse((await dismiss.say("TOP 3 em Reincidência?")).text)[0]!.data.conversationId)
    const no = parseSse((await dismiss.say("não precisa", conversationA)).text)
    expect(no.some((entry) => entry.event === "navigate")).toBe(false)
    expect(dismiss.proposals[0]!.status).toBe("DISMISSED")

    const expire = setup()
    const conversationB = String(parseSse((await expire.say("TOP 3 em Reincidência?")).text)[0]!.data.conversationId)
    await expire.say("E quem está fora da meta em TMA?", conversationB)
    expect(expire.proposals[0]!.status).toBe("EXPIRED")
    const late = parseSse((await expire.say("sim", conversationB)).text)
    expect(late.some((entry) => entry.event === "navigate")).toBe(false)
    expect(expire.replies()).toBe(3)
  })

  it("voz: o 'sim' encaminhado pela leadership_ask também abre a configuração (navegação na resposta da ferramenta)", async () => {
    const { app, proposals, say } = setup()
    const conversationId = String(parseSse((await say("TOP 3 em Reincidência?")).text)[0]!.data.conversationId)
    const response = await request(app).post("/api/v1/realtime/tool-call").send({ toolName: "leadership_ask", query: "sim, cria o report", conversationId, turnId: "voice-1-2", callId: "call-1" })
    expect(response.body.error ?? null).toBeNull()
    expect(response.status).toBe(200)
    expect(response.body.data.navigate).toEqual({ href: `/reports/novo?proposta=${proposals[0]!.id}`, proposalId: proposals[0]!.id })
  })
})
