import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { InteractiveOrchestratorScope, ResolvedOrchestrator } from "../../assistant/application/resolve-orchestrator.js"
import type { runOrchestratedReply } from "../../assistant/application/run-orchestrated-reply.js"
import { createMemoryConversationStore } from "../../assistant/testing/memory-conversation-store.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { CLARIFICATION_TOOL_NAME } from "../../knowledge-clarification/domain/clarification-state.js"
import { refOf, TEST_ORCHESTRATOR_AGENT, TEST_ORG, TEST_OTHER_SPECIALIST_AGENT, TEST_PERSON, TEST_SPECIALIST_AGENT, type ScriptedCall } from "../../knowledge-clarification/testing/clarification-fixtures.js"
import { fixtureClarificationService } from "../../knowledge-clarification/testing/clarification-service-fixture.js"
import type { LeadershipChatContext } from "../../leadership-analytics/application/leadership-context.js"
import { PROCESS_CLARIFICATION_NOTE, PROCESS_TOOL, type ProcessScope } from "../../leadership-analytics/application/process-consultation.js"
import { createRealtimeRouter } from "./realtime-router.js"

/**
 * CONSULTA DE PROCESSO DE QUEM LIDERA × ESCLARECIMENTO PELAS BASES: a dúvida de processo passa pelo MESMO serviço do chat de quem
 * atende, com as bases do Orquestrador do Grupo escolhido pela consulta (nunca as do Grupo do cadastro de quem lidera), filtradas pelo
 * acesso de leitura DE QUEM LIDERA. A pergunta com opções (ou a resposta com fontes) vai para a tela como saiu, junto dos cartões de
 * dados; a escolha no formulário continua no mesmo Orquestrador, direto pelo serviço. Catálogo, navegação e contrato REAIS sobre as bases
 * fictícias de `testing/`; só a IA do esclarecimento e a orquestração da liderança são roteirizadas.
 */
const NOW = new Date("2026-10-20T12:00:00.000Z")
const leader: AuthTokenPayload = { sub: "acc-lider", personId: TEST_PERSON, organizationId: TEST_ORG, role: "COORDINATOR", name: "Pessoa que lidera", email: "l@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
const emptyDb = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next
  if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code } })
  res.status(500).json({ error: { message: (error as Error).message } })
}

const GROUP_A = { teamId: "team-a", name: "Grupo A (teste)" }
const GROUP_B = { teamId: "team-b", name: "Grupo B (teste)" }
const ORCHESTRATORS: InteractiveOrchestratorScope[] = [
  { id: "orch-a", name: "Orquestrador A (teste)", scopeType: "TEAM", teamId: "team-a" },
  { id: "orch-b", name: "Orquestrador B (teste)", scopeType: "TEAM", teamId: "team-b" },
]
const resolvedOrchestrator = (id: string): ResolvedOrchestrator => ({
  organizationId: TEST_ORG,
  orchestratorId: id,
  orchestratorName: ORCHESTRATORS.find((item) => item.id === id)!.name,
  // Grupo A: o especialista com todas as bases fictícias; Grupo B: o outro especialista, que só tem uma delas.
  orchestratorAgentId: id === "orch-a" ? TEST_ORCHESTRATOR_AGENT : "",
  systemPrompt: "PROMPT DO GRUPO",
  specialists: [{ agentId: id === "orch-a" ? TEST_SPECIALIST_AGENT : TEST_OTHER_SPECIALIST_AGENT, toolName: "agent_kb" }],
  tools: [],
  outputInstructions: null,
  structuredOutput: null,
  recommendSupportMaterials: false,
})
const CARD = { type: "PEOPLE", structure: { subject: { kind: "COORDINATOR_STRUCTURE", coordinatorId: TEST_PERSON }, label: "Estrutura de teste", description: null }, periodLabel: "Setembro 2026", filter: { label: "Fora da referência" }, total: 3 }

const clarify = (call: ScriptedCall) => ({ decision: "CLARIFY", questionFacts: [], clarification: { dimension: "Tipo de cliente", question: "Para qual tipo de cliente é a troca de titularidade?", selectionMode: "SINGLE", options: [{ label: "Empresa", evidence: [refOf(call.prompt, "titularidade — Empresa")] }, { label: "Residencial", evidence: [refOf(call.prompt, "— Residencial")] }] } })
const answerFor = (call: ScriptedCall) =>
  call.stage === "PLANNER"
    ? { decision: "ANSWER", answerEvidence: [refOf(call.prompt, "titularidade — Empresa", "troca comum")] }
    : { answer: `Contrato social das duas empresas e identificação dos representantes. [${refOf(call.prompt, "titularidade — Empresa", "troca comum")}]`, sources: [refOf(call.prompt, "titularidade — Empresa", "troca comum")], limitations: null }

function events(text: string) {
  return text.split("\n\n").filter(Boolean).flatMap((block) => {
    const event = /^event: (.+)$/m.exec(block)?.[1]
    const data = /^data: (.+)$/m.exec(block)?.[1]
    return event && data ? [{ event, data: JSON.parse(data) as Record<string, unknown> }] : []
  })
}

function setup(script: (call: ScriptedCall, index: number) => unknown, options: { accessible?: (documentId: string) => boolean } = {}) {
  const memory = createMemoryConversationStore()
  const clarification = fixtureClarificationService(script, { now: () => NOW, ...(options.accessible ? { accessible: options.accessible } : {}) })
  let processScope: ProcessScope = { groups: [GROUP_A, GROUP_B], groupsOfStructure: () => ({ kind: "NOT_FOUND", message: "Não encontrei." }) }
  /** O que o modelo da liderança faz no turno: aciona a consulta de processo (e, se pedido, uma ferramenta de dados). */
  const top: { process: Record<string, unknown> | null; data: boolean; text: string } = { process: { pergunta: "Quais documentos preciso para troca de titularidade?", grupo: GROUP_A.name }, data: false, text: "Texto do modelo da liderança." }
  const orchestrated: string[] = []
  const toolTexts: string[] = []
  const reply: typeof runOrchestratedReply = async (_db, resolved, _history, _extra, _operatorId, _options, _fastPath, hooks = {}) => {
    orchestrated.push(resolved.orchestratorId)
    if (resolved.orchestratorId !== "") return { text: `Procedimento do ${resolved.orchestratorName}.`, agentId: "agent-kb", calls: [{ toolName: "agent_kb", query: "q" }], results: [], structuredResult: null, supportMaterialCandidates: [] }
    const directResults: NonNullable<Awaited<ReturnType<typeof runOrchestratedReply>>["directResults"]> = []
    if (top.data) {
      const outcome = await hooks.directTools!.execute("leadership_indicator_analysis", {})
      directResults.push({ toolName: "leadership_indicator_analysis", args: {}, card: outcome.card })
    }
    if (top.process) {
      const outcome = await hooks.directTools!.execute(PROCESS_TOOL, top.process)
      toolTexts.push(outcome.text)
      directResults.push({ toolName: PROCESS_TOOL, args: top.process, card: outcome.card, ...(outcome.trace ? { trace: outcome.trace } : {}) })
    }
    return { text: top.text, agentId: null, calls: directResults.map((result) => ({ toolName: result.toolName, query: JSON.stringify(result.args) })), results: [], structuredResult: null, supportMaterialCandidates: [], directResults }
  }
  const leadership = (): LeadershipChatContext => ({
    instructions: "[CONTEXTO DE LIDERANÇA]",
    voiceInstructions: "[VOZ DA LIDERANÇA]",
    toolset: { declarations: [{ name: "leadership_indicator_analysis", description: "x", parameters: { type: "object", properties: {} } }], handles: (name) => name === "leadership_indicator_analysis", execute: async () => ({ text: "fatos da estrutura", card: CARD as never }) },
    processScope,
  })
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = leader
    next()
  })
  app.use(
    "/api/v1/realtime",
    createRealtimeRouter(emptyDb, async () => ({ wsUrl: "wss://x", model: "m", expiresAt: "" }), async () => undefined, {
      conversations: memory.store,
      now: () => NOW,
      resolveOrchestrator: async () => resolvedOrchestrator("orch-a"),
      orchestratedReply: reply,
      conversationGuardrails: async () => "",
      leadershipContext: async () => leadership(),
      visibleLeadershipCards: async (_user, cards) => cards,
      processOrchestrators: async () => ORCHESTRATORS,
      orchestratorById: async (_org, id) => resolvedOrchestrator(id),
      knowledgeClarification: clarification.service,
      accessibleKnowledgeDocuments: async (_org, _person, ids) => new Set(ids),
      reportProposals: { prepareOffer: async () => null, pendingForConversation: async () => null, decide: async () => undefined, attach: async () => undefined, forInteractions: async () => new Map() } as never,
    }),
  )
  app.use(errorHandler)
  const ask = async (text: string, extra: Record<string, unknown> = {}, conversationId: string | null = null) =>
    events((await request(app).post("/api/v1/realtime/messages").send({ conversationId, text, clientMessageId: `aaaaaaaa-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`, ...extra })).text)
  return { app, memory, ask, top, orchestrated, toolTexts, clarification, setScope: (scope: ProcessScope) => (processScope = scope) }
}

const conversationOf = (sse: { event: string; data: Record<string, unknown> }[]) => sse[0]!.data.conversationId as string
const clarificationOf = (sse: { event: string; data: Record<string, unknown> }[]) => sse.find((item) => item.event === "knowledge_clarification")?.data.clarification as { id: string; status: string; steps: { id: string; options: { id: string; label: string }[] }[]; sources: { documentId: string }[] } | undefined


describe("consulta de processo de quem lidera — esclarecimento pelas bases do Orquestrador do Grupo", () => {
  it("dúvida ambígua: as bases do Orquestrador do Grupo escolhido (lidas por quem lidera); pergunta com opções; o Orquestrador do Grupo não roda", async () => {
    const { ask, memory, orchestrated, toolTexts, clarification } = setup((call) => clarify(call))
    const sse = await ask("Quais documentos preciso para troca de titularidade no Grupo A?")
    // As bases são as dos agentes do Orquestrador do Grupo A, lidas por quem lidera — e a IA as viu.
    expect(clarification.knowledge.requests[0]).toMatchObject({ organizationId: TEST_ORG, viewerPersonId: TEST_PERSON, agentIds: [TEST_ORCHESTRATOR_AGENT, TEST_SPECIALIST_AGENT] })
    expect(clarification.calls[0]!.prompt).toContain("Troca de titularidade — Empresa (fictícia)")
    // Só a camada da liderança roda: a consulta foi respondida pelo esclarecimento, sem o Orquestrador do Grupo.
    expect(orchestrated).toEqual([""])
    // O modelo da liderança recebe o texto marcado como "vai para a tela como está".
    expect(toolTexts[0]).toContain(PROCESS_CLARIFICATION_NOTE)
    expect(toolTexts[0]).toContain("Para qual tipo de cliente é a troca de titularidade?")
    const view = clarificationOf(sse)!
    expect(view.status).toBe("OPEN")
    expect(view.steps[0]!.options.map((option) => option.label)).toEqual(["Empresa", "Residencial"])
    // O esclarecimento parte da mensagem de quem lidera, como ela escreveu — nunca da `pergunta` reescrita pelo modelo da liderança.
    expect((view as unknown as { originalQuestion: string }).originalQuestion).toBe("Quais documentos preciso para troca de titularidade no Grupo A?")
    // Só a consulta no turno: o texto gravado é o do esclarecimento, sem o texto do modelo da liderança.
    expect(sse.find((item) => item.event === "chunk")!.data.text).toMatch(/^Para qual tipo de cliente é a troca de titularidade\?\n\nOpções encontradas nas bases consultadas: Empresa · Residencial\.$/)
    const saved = memory.messages.find((message) => message.role === "assistant")!
    expect(saved.toolCalls).toEqual([
      expect.objectContaining({ toolName: PROCESS_TOOL, trace: { groups: [GROUP_A.name], orchestratorId: "orch-a", orchestratorName: "Orquestrador A (teste)", knowledgeClarification: "OPEN" } }),
      expect.objectContaining({ toolName: CLARIFICATION_TOOL_NAME, state: expect.objectContaining({ id: view.id }), scope: { kind: "LEADERSHIP_PROCESS", orchestratorId: "orch-a", orchestratorName: "Orquestrador A (teste)", groupNames: [GROUP_A.name] } }),
    ])
  })

  it("a pergunta reescrita pelo modelo da liderança (que escolhe um sentido para o termo ambíguo) não chega ao esclarecimento: a mensagem literal chega", async () => {
    const { ask, top, clarification, toolTexts } = setup((call) => clarify(call))
    // O modelo da liderança "resolve" a ambiguidade por conta própria ao montar a consulta (visto no QA de 20/10).
    top.process = { pergunta: "Quais documentos preciso para troca de titularidade residencial?", grupo: GROUP_A.name }
    const sse = await ask("Quais documentos preciso para a troca de titularidade?")
    expect(clarification.calls[0]!.prompt).toContain("Quais documentos preciso para a troca de titularidade?")
    expect(clarification.calls[0]!.prompt).not.toContain("titularidade residencial?")
    expect((clarificationOf(sse) as unknown as { originalQuestion: string }).originalQuestion).toBe("Quais documentos preciso para a troca de titularidade?")
    expect(toolTexts[0]).toContain(PROCESS_CLARIFICATION_NOTE)
  })

  it("outro Grupo, outras bases: o Orquestrador do Grupo B só alcança as bases dele", async () => {
    const { ask, top, clarification } = setup((call) => ({ decision: "INSUFFICIENT", insufficient: { reason: `Bases vistas: ${call.prompt.includes("titularidade") ? "com" : "sem"} titularidade.` } }))
    top.process = { pergunta: "Quais documentos preciso para troca de titularidade?", grupo: GROUP_B.name }
    const sse = await ask("E no Grupo B?")
    expect(clarification.knowledge.requests[0]!.agentIds).toEqual([TEST_OTHER_SPECIALIST_AGENT])
    expect(clarification.calls[0]!.prompt).toContain("Mudança de endereço — Banda larga (fictícia)")
    expect(clarification.calls[0]!.prompt).not.toContain("Troca de titularidade")
    expect(clarificationOf(sse)!.status).toBe("INSUFFICIENT")
  })

  it("acesso de quem lidera: base que ela não pode ler não chega à IA, nem como opção", async () => {
    const { ask, clarification } = setup((call) => ({ decision: "INSUFFICIENT", insufficient: { reason: call.prompt.includes("titularidade — Empresa") ? "viu" : "não viu" } }), { accessible: (id) => id !== "kb-fic-tt-empresa" })
    await ask("Quais documentos preciso para troca de titularidade?")
    expect(clarification.calls[0]!.prompt).toContain("— Residencial")
    expect(clarification.calls[0]!.prompt).not.toContain("titularidade — Empresa")
  })

  it("escolha no formulário: continua no MESMO Orquestrador do Grupo, direto pelo serviço (sem o modelo da liderança), e responde com fontes", async () => {
    const { ask, memory, orchestrated, clarification } = setup((call, index) => (index === 0 ? clarify(call) : answerFor(call)))
    const first = await ask("Quais documentos preciso para troca de titularidade?")
    const view = clarificationOf(first)!
    const step = view.steps[0]!
    const second = await ask("Empresa", { clarification: { clarificationId: view.id, stepId: step.id, optionIds: [step.options[0]!.id] } }, conversationOf(first))
    expect(orchestrated).toEqual([""])
    // As bases da continuação são as do MESMO Orquestrador (gravado com o estado), para quem lidera.
    expect(clarification.knowledge.requests[1]).toMatchObject({ viewerPersonId: TEST_PERSON, agentIds: [TEST_ORCHESTRATOR_AGENT, TEST_SPECIALIST_AGENT] })
    const answered = clarificationOf(second)!
    expect(answered).toMatchObject({ id: view.id, status: "ANSWERED", sources: [{ documentId: "kb-fic-tt-empresa" }] })
    expect(second.find((item) => item.event === "chunk")!.data.text).toBe("Contrato social das duas empresas e identificação dos representantes. [1]")
    const saved = memory.messages.filter((message) => message.role === "assistant").at(-1)!
    expect(saved.toolCalls).toEqual([expect.objectContaining({ toolName: CLARIFICATION_TOOL_NAME, scope: expect.objectContaining({ orchestratorId: "orch-a" }) })])
  })

  it("escolha no formulário com o Orquestrador fora do alcance (a estrutura mudou): erro explícito, nada respondido", async () => {
    const { ask, setScope, clarification } = setup((call) => clarify(call))
    const first = await ask("Quais documentos preciso para troca de titularidade?")
    const view = clarificationOf(first)!
    setScope({ groups: [GROUP_B], groupsOfStructure: () => ({ kind: "NOT_FOUND", message: "x" }) })
    const second = await ask("Empresa", { clarification: { clarificationId: view.id, stepId: view.steps[0]!.id, optionIds: [view.steps[0]!.options[0]!.id] } }, conversationOf(first))
    expect(second.find((item) => item.event === "error")!.data.message).toContain("Este esclarecimento não está mais disponível")
    expect(clarification.calls).toHaveLength(1)
  })

  it("cartões de dados + formulário: o texto da liderança vem antes da pergunta e cartão e formulário acompanham a mesma resposta", async () => {
    const { ask, top } = setup((call) => clarify(call))
    top.data = true
    top.text = "Três pessoas da estrutura estão fora da referência."
    const sse = await ask("Quem está fora da referência e quais documentos para troca de titularidade?")
    expect(sse.find((item) => item.event === "chunk")!.data.text).toBe("Três pessoas da estrutura estão fora da referência.\n\nPara qual tipo de cliente é a troca de titularidade?\n\nOpções encontradas nas bases consultadas: Empresa · Residencial.")
    expect(sse.find((item) => item.event === "analytics")!.data.cards).toEqual([CARD])
    expect(clarificationOf(sse)!.status).toBe("OPEN")
  })

  it("resposta DIGITADA à etapa aberta: a pergunta da consulta é interpretada como escolha (texto livre) no mesmo Orquestrador", async () => {
    const { ask, top, clarification } = setup((call, index) => {
      if (index === 0) return clarify(call)
      if (call.stage === "PLANNER") return { decision: "ANSWER", pendingReply: { kind: "OPTIONS", optionRefs: ["O1"] }, questionFacts: [], answerEvidence: [refOf(call.prompt, "titularidade — Empresa", "troca comum")] }
      return answerFor(call)
    })
    const first = await ask("Quais documentos preciso para troca de titularidade?")
    top.process = { pergunta: "Quais documentos preciso para troca de titularidade? É para empresa.", grupo: GROUP_A.name }
    const typed = await ask("é para empresa", {}, conversationOf(first))
    expect(clarification.calls[1]!.prompt).toContain("Pergunta de esclarecimento EM ABERTO")
    expect(clarification.calls[1]!.prompt).toContain('O1 = "Empresa"')
    const view = clarificationOf(typed)!
    expect(view).toMatchObject({ id: clarificationOf(first)!.id, status: "ANSWERED" })
  })

  it("dúvida que não é das bases (NOT_APPLICABLE): a consulta de sempre ao Orquestrador do Grupo, sem formulário", async () => {
    const { ask, orchestrated, memory } = setup(() => ({ decision: "NOT_APPLICABLE" }))
    const sse = await ask("Como orientar a equipe sobre troca de titularidade?")
    expect(orchestrated).toEqual(["", "orch-a"])
    expect(clarificationOf(sse)).toBeUndefined()
    expect(sse.find((item) => item.event === "chunk")!.data.text).toBe("Texto do modelo da liderança.")
    const saved = memory.messages.find((message) => message.role === "assistant")!
    expect((saved.toolCalls as { toolName: string }[]).map((call) => call.toolName)).toEqual([PROCESS_TOOL])
  })

  it("voz (leadership_ask): o estado vai para a tela e a fala recebe a pergunta com as opções curtas e a ferramenta para a resposta falada", async () => {
    const { app } = setup((call) => clarify(call))
    const response = await request(app).post("/api/v1/realtime/tool-call").send({ toolName: "leadership_ask", query: "Quais documentos preciso para troca de titularidade no Grupo A?", conversationId: null, turnId: "voice-1-1", callId: "call-1" })
    expect(response.status).toBe(200)
    expect(response.body.data.clarification).toMatchObject({ status: "OPEN" })
    expect(response.body.data.text).toContain("Para qual tipo de cliente é a troca de titularidade?")
    expect(response.body.data.modelText).toContain("Empresa ou Residencial")
    expect(response.body.data.modelText).toContain("acione leadership_ask de novo")
    expect(response.body.data.modelText).not.toContain("Fale um resumo curto")
  })

  it("voz (leadership_ask): parte das palavras de quem lidera e a escolha no formulário com a voz aberta segue no MESMO Orquestrador, sem o modelo da liderança", async () => {
    const { app, top, orchestrated, clarification } = setup((call, index) => (index === 0 ? clarify(call) : answerFor(call)))
    // O modelo da liderança escolhe um sentido ao montar a consulta; o modelo de voz acrescenta contexto. Nenhum dos dois chega ao esclarecimento.
    top.process = { pergunta: "Quais documentos preciso para troca de titularidade residencial?", grupo: GROUP_A.name }
    const first = await request(app).post("/api/v1/realtime/tool-call").send({ toolName: "leadership_ask", query: "A liderança do Grupo A quer saber os documentos da troca de titularidade residencial", utterance: "Quais documentos para a troca de titularidade?", conversationId: null, turnId: "voice-3-1", callId: "call-1" })
    expect(clarification.calls[0]!.prompt).toContain("Quais documentos para a troca de titularidade?")
    expect(clarification.calls[0]!.prompt).not.toContain("titularidade residencial")
    const view = first.body.data.clarification as { id: string; steps: { id: string; options: { id: string; label: string }[] }[] }
    expect(orchestrated).toEqual([""])
    const step = view.steps[0]!
    const second = await request(app).post("/api/v1/realtime/tool-call").send({ toolName: "leadership_ask", query: "Empresa", utterance: "Empresa", clarification: { clarificationId: view.id, stepId: step.id, optionIds: [step.options.find((option) => option.label === "Empresa")!.id], noneMatched: false, revise: false }, conversationId: first.body.data.conversationId, turnId: "voice-3-2", callId: "call-1" })
    expect(second.status).toBe(200)
    // Só a primeira rodada passou pelo modelo da liderança; a escolha foi direto ao serviço, no Orquestrador gravado com o estado.
    expect(orchestrated).toEqual([""])
    expect(second.body.data.clarification).toMatchObject({ id: view.id, status: "ANSWERED", sources: [{ documentId: "kb-fic-tt-empresa" }] })
    expect(second.body.data.clarification.steps[0].answer).toMatchObject({ via: "FORM" })
    expect(second.body.data.modelText).toContain("Não leia os marcadores de fonte")
  })
})
