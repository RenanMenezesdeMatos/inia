/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { DispatchDetail, DispatchRow, PersonResult, ResultsSummary, UsageTotals } from "@/schemas/admin/workflow-results.schema"

import { describeFindings, formatCost, formatTokens, WorkflowResultsTab } from "./workflow-results-tab"

/** V1.5.13 — aba "Resultados": cards do período, disparo = matrícula raiz, detalhe com o texto FINAL emitido e o uso de IA. */
const service = vi.hoisted(() => ({ fetchWorkflowResultsSummary: vi.fn(), fetchWorkflowResultsPage: vi.fn(), fetchWorkflowDispatchDetail: vi.fn() }))
vi.mock("@/services/admin/workflow-results-service", () => service)

const usage = (total: number | null, cost: string | null = null, extra: Partial<UsageTotals> = {}): UsageTotals => ({ calls: 1, inputTokens: total, outputTokens: 0, totalTokens: total, incomplete: false, costs: cost ? [{ currency: "USD", amount: cost }] : [], costUnknownCalls: 0, ...extra })

const SUMMARY: ResultsSummary = { period: { from: "2026-08-26", to: "2026-09-24" }, dispatches: 1, persons: 3, feedbacksProduced: 3, feedbacksSent: 2, awaitingQa: 1, blocked: 0, usage: usage(31840, "0.0123") }
const DISPATCH: DispatchRow = {
  rootEnrollmentId: "root-1",
  createdAt: "2026-09-24T18:42:00.000Z",
  status: "RUNNING",
  trigger: { kind: "SCHEDULE", label: "Agenda" },
  version: { id: "v1", number: 3, active: true },
  consolidated: true,
  persons: 3,
  feedbacksProduced: 3,
  feedbacksSent: 2,
  awaitingQa: 1,
  blocked: 0,
  usage: usage(31840, "0.0123"),
  durationMs: null,
}
const person = (patch: Partial<PersonResult>): PersonResult => ({
  enrollmentId: "e-1",
  person: { id: "p-1", name: "Franciele Cardoso Duarte", teamName: "B2C", subteamName: "Retenção" },
  status: "completed",
  waitingForQa: false,
  agents: [{ nodeId: "agent", name: "Especialista de Eficiência Operacional" }],
  orchestrators: [],
  feedbacks: [],
  outputs: [],
  usage: usage(1540, "0.0014"),
  aiCalls: [
    { nodeId: "agent", nodeLabel: "Analisar", actor: "Especialista de Eficiência Operacional", useCase: "AGENT_RESPONSE", useCaseLabel: "Resposta do Agent", providerKey: "GOOGLE_GENAI", modelName: "gemini-3.8-flash", usage: usage(1120, "0.0010") },
    { nodeId: "gen", nodeLabel: "Gerar feedback", actor: null, useCase: "FEEDBACK_WRITER", useCaseLabel: "Redator do feedback", providerKey: "GOOGLE_GENAI", modelName: "gemini-3.1-flash-lite", usage: usage(420, "0.0004") },
  ],
  durationMs: 5000,
  error: null,
  ...patch,
})
const DETAIL: DispatchDetail = {
  dispatch: DISPATCH,
  persons: {
    total: 2,
    page: 1,
    pageSize: 50,
    items: [
      person({
        feedbacks: [{
          kind: "RELIABLE", nodeId: "gen", nodeLabel: "Gerar feedback", domain: "MONITORING", label: "24/09 · Segunda via", disposition: "READY", reasons: [], legacy: null, sent: true, emittedAt: "2026-09-24T18:43:00.000Z", error: null,
          items: [{ section: "OPPORTUNITY", sectionLabel: "Ponto de desenvolvimento", wording: { observed: "Texto final editado pelo QA", whyItMatters: "Porque importa", whatYouCanDo: "Faça assim" }, wordingSource: "HUMAN_EDITED", qaStatus: "APPROVED_EDITED", facts: [{ role: "OPERADOR", text: "Aguarde um momento.", truncated: false }] }],
        }],
        outputs: [
          { nodeId: "out", nodeLabel: "Enviar", surface: "FOLLOW_UP", recipientName: "Franciele Cardoso Duarte", status: "SENT", emittedAt: "2026-09-24T18:43:00.000Z" },
          { nodeId: "out", nodeLabel: "Enviar", surface: "CHAT", recipientName: "Franciele Cardoso Duarte", status: "NOT_EMITTED", emittedAt: null },
        ],
      }),
      person({
        enrollmentId: "e-2",
        person: { id: "p-2", name: "Caio Lima", teamName: "B2C", subteamName: null },
        status: "waiting",
        waitingForQa: true,
        usage: usage(null, null, { incomplete: true, costUnknownCalls: 1 }),
        aiCalls: [],
        feedbacks: [{ kind: "RELIABLE", nodeId: "gen", nodeLabel: "Gerar feedback", domain: "MONITORING", label: null, disposition: "HOLD_FOR_QA", reasons: ["FEEDBACK_KIND_NOT_RELEASED_FOR_AUTONOMY"], legacy: null, sent: false, emittedAt: null, error: null, items: [] }],
      }),
    ],
  },
  rootUsage: null,
}

describe("V1.5.13 — aba Resultados do Workflow", () => {
  beforeAll(() => installJsdomStubs())
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("formata tokens e custo REGISTRADOS; ausência = N/D, nunca estimativa", () => {
    expect(formatTokens(null)).toBe("N/D")
    expect(formatTokens(31840)).toBe("31.840")
    expect(formatTokens(1200, true)).toBe("1.200+")
    expect(formatCost(usage(10, null))).toBe("Indisponível")
    expect(formatCost({ ...usage(null), calls: 0 })).toBe("—")
    expect(formatCost(usage(10, "0.0014"))).toMatch(/US\$\s?0,0014/)
  })

  it("cards do período + um disparo por matrícula raiz; abrir o disparo carrega as pessoas UMA vez e mostra o texto FINAL emitido", async () => {
    service.fetchWorkflowResultsSummary.mockResolvedValue(SUMMARY)
    service.fetchWorkflowResultsPage.mockResolvedValue({ items: [DISPATCH], total: 1, page: 1, pageSize: 20 })
    service.fetchWorkflowDispatchDetail.mockResolvedValue(DETAIL)
    renderWithQuery(<WorkflowResultsTab workflowId="wf-1" />)

    const cards = await screen.findByRole("region", { name: "Resumo do período" })
    expect(within(cards).getByText("Pessoas processadas").nextSibling).toHaveTextContent("3")
    expect(within(cards).getByText("Tokens consumidos").nextSibling).toHaveTextContent("31.840")
    expect(await screen.findByTestId("dispatch-counters")).toHaveTextContent("3 pessoas · 2 enviados · 1 QA · 0 bloqueados · 31.840 tokens")
    expect(service.fetchWorkflowDispatchDetail).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /Agenda · versão 3/ }))
    await waitFor(() => expect(service.fetchWorkflowDispatchDetail).toHaveBeenCalledTimes(1))
    expect(service.fetchWorkflowDispatchDetail).toHaveBeenCalledWith("wf-1", "root-1", 1, 50)

    fireEvent.click(await screen.findByRole("button", { name: /Franciele Cardoso Duarte/ }))
    expect(await screen.findByText("Texto final editado pelo QA")).toBeInTheDocument()
    // conteúdo carregado depois de abrir: a área expandida acompanha a altura real (nunca a medida na abertura)
    for (const region of document.querySelectorAll('[data-slot="accordion-content"] > div')) expect(region.className).toContain("h-auto")
    expect(screen.getByText("Editado no QA")).toBeInTheDocument()
    expect(screen.getByText("Mensagem enviada")).toBeInTheDocument()
    expect(screen.getByText(/Acompanhamento — enviado/)).toBeInTheDocument()
    expect(screen.getByText(/Chat — não emitido/)).toBeInTheDocument()
    expect(screen.getByText("Especialista de Eficiência Operacional")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Uso de IA · 1.540 tokens/ }))
    expect(await screen.findByText("gemini-3.1-flash-lite · nó \"Gerar feedback\"")).toBeInTheDocument()
    expect(screen.getByText("Total")).toBeInTheDocument()
    expect(service.fetchWorkflowDispatchDetail).toHaveBeenCalledTimes(1)
  })

  it("HOLD_FOR_QA: aparece como aguardando QA com o motivo, sem Output, tokens N/D", async () => {
    service.fetchWorkflowResultsSummary.mockResolvedValue(SUMMARY)
    service.fetchWorkflowResultsPage.mockResolvedValue({ items: [DISPATCH], total: 1, page: 1, pageSize: 20 })
    service.fetchWorkflowDispatchDetail.mockResolvedValue(DETAIL)
    renderWithQuery(<WorkflowResultsTab workflowId="wf-1" />)
    fireEvent.click(await screen.findByRole("button", { name: /Agenda · versão 3/ }))
    const caio = await screen.findByRole("button", { name: /Caio Lima/ })
    expect(caio).toHaveTextContent("Aguardando QA")
    expect(caio).toHaveTextContent("N/D tokens")
    fireEvent.click(caio)
    expect(await screen.findByText("Feedback produzido — aguardando QA")).toBeInTheDocument()
    expect(screen.getByText("Tipo de feedback ainda não liberado para seguir sem QA")).toBeInTheDocument()
    expect(screen.getByText("Nenhum Output emitido.")).toBeInTheDocument()
  })

  it("motor de feedback: mensagem enviada com card e narrativa; abstenção aparece como 'sem mensagem' com o motivo — nunca como QA", async () => {
    const engine = (patch: Partial<DispatchDetail["persons"]["items"][number]["feedbacks"][number]>) => ({ kind: "ENGINE" as const, nodeId: "gen", nodeLabel: "Gerar feedback", domain: "MONITORING" as const, label: "29/09 · Segunda via", disposition: "READY" as const, reasons: [], items: [], findings: null, presentation: null, legacy: null, engine: { card: "Confirme a data de nascimento antes de enviar.", narrative: ["Você confirmou o tipo da conta antes de enviar.", "Faltou a data de nascimento."], tone: "MIXED", developments: 1, strengths: 1, abstainDetail: null }, sent: true, emittedAt: "2026-09-29T14:00:00.000Z", error: null, ...patch })
    service.fetchWorkflowResultsSummary.mockResolvedValue(SUMMARY)
    service.fetchWorkflowResultsPage.mockResolvedValue({ items: [DISPATCH], total: 1, page: 1, pageSize: 20 })
    service.fetchWorkflowDispatchDetail.mockResolvedValue({ ...DETAIL, persons: { ...DETAIL.persons, items: [person({ feedbacks: [engine({})] }), person({ enrollmentId: "e-9", person: { id: "p-9", name: "Caio Lima", teamName: "B2C", subteamName: null }, feedbacks: [engine({ disposition: "ABSTAINED", reasons: ["INSUFFICIENT_EVIDENCE"], sent: false, emittedAt: null, engine: { card: null, narrative: [], tone: null, developments: 0, strengths: 0, abstainDetail: "TRANSCRIPT_INCOMPLETE" } })] })] } })
    renderWithQuery(<WorkflowResultsTab workflowId="wf-1" />)
    fireEvent.click(await screen.findByRole("button", { name: /Agenda · versão 3/ }))
    fireEvent.click(await screen.findByRole("button", { name: /Franciele Cardoso Duarte/ }))
    expect(await screen.findByText("Mensagem enviada")).toBeInTheDocument()
    expect(screen.getByText("Confirme a data de nascimento antes de enviar.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Caio Lima/ }))
    expect(await screen.findByText("Análise registrada — sem mensagem ao colaborador")).toBeInTheDocument()
    expect(screen.getByText(/Evidência insuficiente para concluir/)).toBeInTheDocument()
    expect(screen.queryByText(/aguardando QA/)).not.toBeInTheDocument()
  })

  it("V1.7.1 — coordenação do Orquestrador: roteamento sem IA e síntese dispensada aparecem como tal (nunca como chamada de IA)", async () => {
    service.fetchWorkflowResultsSummary.mockResolvedValue(SUMMARY)
    service.fetchWorkflowResultsPage.mockResolvedValue({ items: [DISPATCH], total: 1, page: 1, pageSize: 20 })
    service.fetchWorkflowDispatchDetail.mockResolvedValue({ ...DETAIL, persons: { ...DETAIL.persons, items: [person({ agents: [], orchestrators: [{ nodeId: "orch", name: "Orquestrador de Monitoria Operacional", routing: "DETERMINISTIC", synthesis: "PASSTHROUGH" }] })] } })
    renderWithQuery(<WorkflowResultsTab workflowId="wf-1" />)
    fireEvent.click(await screen.findByRole("button", { name: /Agenda · versão 3/ }))
    fireEvent.click(await screen.findByRole("button", { name: /Franciele Cardoso Duarte/ }))
    expect(await screen.findByText("especialista definido pelo Workflow (sem IA), síntese dispensada (resultado do especialista)")).toBeInTheDocument()
  })

  it("V1.7.1a — análise completa × feedback: nunca finge que só existiam os publicados; etapa, ordem e exemplo de condução por item", async () => {
    expect(describeFindings({ detected: 6, reliable: 5, inFeedback: 4, blocked: 1, heldForQa: 1, rejected: 0, collapsedDuplicates: 0, notObservable: 2, notApplicable: 1 })).toBe("Achados: 6 detectados · 5 confiáveis · 4 no feedback · 1 aguardando QA · 1 bloqueado pela estrutura · 2 não observáveis · 1 não aplicável")
    service.fetchWorkflowResultsSummary.mockResolvedValue(SUMMARY)
    service.fetchWorkflowResultsPage.mockResolvedValue({ items: [DISPATCH], total: 1, page: 1, pageSize: 20 })
    const feedback = DETAIL.persons.items[0]!.feedbacks[0]!
    const withExample = {
      ...feedback,
      findings: { detected: 4, reliable: 4, inFeedback: 4, blocked: 0, heldForQa: 0, rejected: 0, collapsedDuplicates: 0, notObservable: 0, notApplicable: 1 },
      items: [{ ...feedback.items[0]!, stepTitle: "Explicar prazo", priorityRank: 1, wording: { observed: "O prazo não foi explicado.", whyItMatters: "", whatYouCanDo: "Informe o prazo exibido na ferramenta.", suggestedResponse: "Registrei a sua contestação. O prazo da análise é o que aparece aqui na ferramenta." } }],
    }
    service.fetchWorkflowDispatchDetail.mockResolvedValue({ ...DETAIL, persons: { ...DETAIL.persons, items: [person({ feedbacks: [withExample] })] } })
    renderWithQuery(<WorkflowResultsTab workflowId="wf-1" />)
    fireEvent.click(await screen.findByRole("button", { name: /Agenda · versão 3/ }))
    fireEvent.click(await screen.findByRole("button", { name: /Franciele Cardoso Duarte/ }))
    expect(await screen.findByTestId("result-findings")).toHaveTextContent("Achados: 4 detectados · 4 confiáveis · 4 no feedback · 1 não aplicável")
    expect(screen.getByText("Explicar prazo")).toBeInTheDocument()
    expect(screen.getByText("Exemplo de condução (sugestão, não é fala da chamada)")).toBeInTheDocument()
    expect(screen.getByText(/Registrei a sua contestação\. O prazo da análise/)).toBeInTheDocument()
  })

  it("V1.7.1b — apresentação pessoal e ponto 'Vale confirmar o produto' aparecem como saíram (nunca como erro)", async () => {
    service.fetchWorkflowResultsSummary.mockResolvedValue(SUMMARY)
    service.fetchWorkflowResultsPage.mockResolvedValue({ items: [DISPATCH], total: 1, page: 1, pageSize: 20 })
    const feedback = DETAIL.persons.items[0]!.feedbacks[0]!
    const personal = {
      ...feedback,
      presentation: { greeting: "Olá, Franciele!", introduction: "Analisei seu atendimento de 24/09/2026 sobre mudança de endereço.", closing: "Quando o procedimento muda conforme o produto, vale confirmar o produto antes de seguir.", source: "SYSTEM" as const },
      items: [{ ...feedback.items[0]!, section: "ATTENTION" as const, sectionLabel: "Vale confirmar o produto", stepTitle: null, priorityRank: 1, wording: { observed: "Não foi possível identificar com segurança se a solicitação estava relacionada a DDR, SIP ou Linha Analógica.", whyItMatters: "Como os procedimentos são diferentes conforme o produto, este ponto não é classificado como erro.", whatYouCanDo: "", suggestedResponse: "Antes de seguir, vou confirmar qual produto está vinculado à sua solicitação." } }],
    }
    service.fetchWorkflowDispatchDetail.mockResolvedValue({ ...DETAIL, persons: { ...DETAIL.persons, items: [person({ feedbacks: [personal] })] } })
    renderWithQuery(<WorkflowResultsTab workflowId="wf-1" />)
    fireEvent.click(await screen.findByRole("button", { name: /Agenda · versão 3/ }))
    fireEvent.click(await screen.findByRole("button", { name: /Franciele Cardoso Duarte/ }))
    expect(await screen.findByText("Abertura (versão do sistema)")).toBeInTheDocument()
    expect(screen.getByText(/Olá, Franciele! Analisei seu atendimento/)).toBeInTheDocument()
    expect(screen.getByText("Fechamento")).toBeInTheDocument()
    expect(screen.getByText("Vale confirmar o produto")).toBeInTheDocument()
    expect(screen.getByText(/não é classificado como erro/)).toBeInTheDocument()
  })

  it("filtros vão ao servidor (status/gatilho/colaborador), com página 1", async () => {
    service.fetchWorkflowResultsSummary.mockResolvedValue({ ...SUMMARY, dispatches: 0 })
    service.fetchWorkflowResultsPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    renderWithQuery(<WorkflowResultsTab workflowId="wf-1" />)
    expect(await screen.findByText("Nenhum disparo no período")).toBeInTheDocument()
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar colaborador" }), { target: { value: "ana" } })
    await waitFor(() => expect(service.fetchWorkflowResultsPage).toHaveBeenLastCalledWith("wf-1", { period: {}, collaborator: "ana" }, 1, 20))
  })
})
