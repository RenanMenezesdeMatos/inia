/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import larissa from "@/components/feedbacks/__fixtures__/larissa-feedback-view.json"
import prv from "@/components/feedbacks/__fixtures__/prv-indicator-views.json"
import type { FollowUpFeed, FollowUpItem } from "@/schemas/analytics/analytics.schema"
import { feedbackViewSchema } from "@/schemas/feedbacks/feedback-view.schema"
import { prvSupervisorViewSchema } from "@/schemas/feedbacks/prv-supervisor-view.schema"

import { FollowUpEntry } from "./follow-up-entry"
import { StructureFollowUpFeed } from "./structure-follow-up-feed"

const service = vi.hoisted(() => ({ fetchFollowUpFeed: vi.fn() }))
vi.mock("@/services/analytics/analytics-service", () => service)

let intersect: (() => void) | null = null
class IntersectionObserverStub {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe() { intersect = () => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
  disconnect() {}
  unobserve() {}
}

beforeAll(() => {
  installJsdomStubs()
  global.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.clearAllMocks(); intersect = null })

const LARISSA = feedbackViewSchema.parse(larissa)

const LONG_ANALYSIS = [
  "## Visão geral",
  "",
  "**8 colaboradores analisados**, 3 pontos de atenção, 2 evoluções.",
  "",
  "### Padrões recorrentes",
  "- Encerramento sem protocolo em 5 chamadas",
  "- Prazo de estorno informado errado (\"em 24h na conta\")",
  "",
  "| Colaborador | PRV | Situação |",
  "|---|---|---|",
  "| Mariana Alves | 83% | Q4 recorrente |",
  "| Rafael Cardoso | 87% | Em queda |",
  "",
  "> hipótese: a mudança de meta de TMA em julho pressionou o fechamento das chamadas.",
  "",
  "Referência: https://intranet.exemplo.com/procedimentos/faturamento/estorno/prazos/versao-2026-09/um-caminho-muito-longo-sem-espacos",
].join("\n")

function alertItem(overrides: Partial<FollowUpItem> = {}): FollowUpItem {
  return {
    id: "alert-1",
    kind: "ALERT",
    category: "WORKFLOW_OUTPUT",
    title: "Resumo mensal ao Supervisor",
    summary: LONG_ANALYSIS,
    detail: null,
    severity: "MEDIUM",
    operator: { personId: "op-1", name: "Mariana Alves" },
    caseId: null,
    createdAt: "2026-09-16T12:00:00.000Z",
    acknowledgedAt: null,
    feedback: null,
    ...overrides,
  }
}

const legacyFeedback = (overrides: Partial<FollowUpItem> = {}): FollowUpItem =>
  alertItem({
    id: "fb-1",
    kind: "FEEDBACK",
    category: "MONITORING",
    title: "MONITORIA_QUALIDADE",
    summary: "Comportamento observado curto",
    acknowledgedAt: null,
    feedback: { evidenceFound: "Operador: \"o estorno cai em 24h na conta\"", observedBehavior: "Informou prazo **divergente** do procedimento.", relatedProcedure: "Procedimento de Estorno — seção 3", recommendation: "Confirmar o prazo oficial antes de informar.\n\n- Consultar a seção 3\n- Registrar protocolo", supportMaterials: [] },
    ...overrides,
  })

const renderEntry = (item: FollowUpItem, props: Partial<Parameters<typeof FollowUpEntry>[0]> = {}) => renderWithQuery(<FollowUpEntry item={item} showRecipient {...props} />)
const card = () => document.querySelector<HTMLElement>("[data-slot=feedback-card]")!
const header = () => document.querySelector<HTMLElement>("[data-slot=feedback-entry-header]")!

describe("Acompanhamento da estrutura — o item tem a apresentação do Acompanhamento do colaborador", () => {
  it("feedback publicado: o MESMO cabeçalho do colaborador (tipo + motivo do backend, título, quando aconteceu fora do cartão) e a narrativa direto, sem painel lateral", () => {
    const item = legacyFeedback({ id: "fb-v2", title: "Contestação de cobrança", subtitle: "Atendimento de 28/09/2026", origin: { family: "MONITORING", reason: "FLAG", label: "Rechamada", iconKey: "flag" }, feedback: { ...legacyFeedback().feedback!, view: LARISSA } })
    renderEntry(item)
    expect(header()).toHaveAttribute("data-family", "MONITORING")
    expect(within(header()).getByText("Monitoria · Rechamada")).toBeInTheDocument()
    expect(within(header()).getByRole("heading", { level: 3, name: "Contestação de cobrança" })).toBeInTheDocument()
    // Quando aconteceu fica na linha do autor ("INIA · publicação"), fora do cartão.
    expect(document.querySelector("[data-slot=feedback-entry-when]")).toHaveTextContent("Atendimento de 28/09/2026")
    expect(card()).not.toHaveTextContent("Atendimento de 28/09/2026")
    expect(screen.getByText(/^Larissa, você conduziu bem a investigação do caso e a tratativa/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Ver feedback completo/ })).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
    // Quem lidera vê de quem é o feedback e o estado da ciência — nunca confirma no lugar do colaborador.
    expect(document.querySelector("[data-slot=feed-item-recipient]")).toHaveTextContent("para Mariana Alves")
    expect(card()).toHaveTextContent("Aguardando ciência do colaborador")
    expect(screen.queryByRole("button", { name: /Confirmar ciência/ })).toBeNull()
  })

  it("feedback de indicador: o diagnóstico técnico do fechamento aparece só para a liderança, depois da narrativa", () => {
    const view = feedbackViewSchema.parse(prv.collaborator)
    const supervisorView = prvSupervisorViewSchema.parse(prv.supervisor)
    renderEntry(legacyFeedback({ category: "INDICATOR", title: "TMA", origin: { family: "INDICATOR", reason: "INDICATOR", label: "Tempo Médio de Atendimento", iconKey: "timer" }, acknowledgedAt: "2026-09-17T10:00:00.000Z", feedback: { ...legacyFeedback().feedback!, view, supervisorView } }))
    expect(within(header()).getByText("Indicador · Tempo Médio de Atendimento")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Diagnóstico técnico \(gestão\)/ })).toBeInTheDocument()
    expect(screen.getByTestId("reading-confirmed")).toHaveTextContent(/Ciência confirmada em 17\/09\/2026/)
  })

  it("feedback anterior ao view model: resumo curto e as 4 partes integrais abertas no próprio cartão", () => {
    renderEntry(legacyFeedback())
    // Sem motivo do backend, o tipo vem da categoria.
    expect(within(header()).getByText("Monitoria")).toBeInTheDocument()
    expect(screen.getByText("Comportamento observado curto")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Evidência encontrada" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Ver feedback completo" }))
    for (const heading of ["Evidência encontrada", "Comportamento observado", "Procedimento relacionado", "Recomendação"]) expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument()
    // Aberto, o resumo dá lugar ao conteúdo inteiro (nunca repetido).
    expect(screen.queryByText("Comportamento observado curto")).toBeNull()
    // Evidência é citação literal: preservada como texto, nunca interpretada como Markdown.
    expect(card().querySelector("blockquote")).toHaveTextContent('Operador: "o estorno cai em 24h na conta"')
    expect(screen.getByText("divergente").tagName).toBe("STRONG")
    expect(card().querySelectorAll("ul > li")).toHaveLength(2)
    expect(card()).toHaveTextContent("Aguardando ciência do colaborador")
    expect(screen.queryByRole("region", { name: /Materia(l|is) de apoio/ })).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("resultado de Workflow: cabeçalho da família, \"sobre\" a pessoa e a análise inteira (Markdown) no próprio cartão", () => {
    renderEntry(alertItem({ severity: "HIGH" }))
    expect(header()).toHaveAttribute("data-family", "WORKFLOW_OUTPUT")
    expect(within(header()).getByText("Resultado de workflow")).toBeInTheDocument()
    expect(within(header()).getByText("Alta prioridade")).toBeInTheDocument()
    expect(document.querySelector("[data-slot=feed-item-recipient]")).toHaveTextContent("sobre Mariana Alves")
    fireEvent.click(screen.getByRole("button", { name: "Ver análise completa" }))
    expect(screen.getByText("8 colaboradores analisados").tagName).toBe("STRONG")
    expect(card().querySelectorAll("ul > li")).toHaveLength(2)
    expect(card().querySelector("table")).not.toBeNull()
    expect(card().querySelectorAll("tbody tr")).toHaveLength(2)
    expect(card().querySelector("blockquote")).toHaveTextContent("hipótese")
    // Link externo escrito no resultado não é clicável (só com o domínio na lista da instalação — ver rich-content.tsx, AI-08).
    expect(screen.queryByRole("link", { name: /intranet\.exemplo\.com/ })).toBeNull()
    expect(card()).toHaveTextContent("intranet.exemplo.com")
    expect(card().textContent).not.toContain("**")
    expect(card().textContent).not.toContain("## ")
    expect(card().querySelector("table")?.parentElement?.className).toContain("overflow-x-auto")
    // Alerta não tem ciência.
    expect(card()).not.toHaveTextContent(/ciência/i)
  })

  it("material de apoio: título real, motivo e link para a página do material; indisponível vira aviso neutro sem título", () => {
    renderEntry(legacyFeedback({
      acknowledgedAt: "2026-09-16T10:00:00.000Z",
      feedback: {
        evidenceFound: "Cliente: quero cancelar. Operador: então vou abrir o protocolo.",
        observedBehavior: "Apresentou a solução sem aprofundar a necessidade.",
        relatedProcedure: "Técnicas de sondagem em retenção",
        recommendation: "Aprofunde a sondagem antes da oferta.",
        supportMaterials: [
          { materialId: "11111111-1111-4111-8111-111111111111", available: true, title: "Técnicas de sondagem em retenção", reason: "Este material apresenta exemplos práticos de perguntas de sondagem para retenção por preço." },
          { materialId: "22222222-2222-4222-8222-222222222222", available: false },
        ],
      },
    }))
    fireEvent.click(screen.getByRole("button", { name: "Ver feedback completo" }))
    const region = screen.getByRole("region", { name: "Materiais de apoio recomendados" })
    expect(region).toHaveTextContent("Técnicas de sondagem em retenção")
    expect(screen.getByText(/exemplos práticos de perguntas de sondagem/)).toBeInTheDocument()
    const cta = screen.getByRole("link", { name: "Acessar material: Técnicas de sondagem em retenção (abre em nova aba)" })
    expect(cta).toHaveAttribute("href", "/materiais/11111111-1111-4111-8111-111111111111")
    expect(cta).toHaveAttribute("target", "_blank")
    expect(screen.getByText("Um material de apoio recomendado não está mais disponível.")).toBeInTheDocument()
  })

  it("na ficha do colaborador não repete de quem é; o deep link do sino destaca o item, rola até ele e abre o conteúdo", () => {
    renderEntry(legacyFeedback(), { showRecipient: false, highlighted: true })
    expect(document.querySelector("[data-slot=feed-item-recipient]")).toBeNull()
    expect(document.querySelector("#follow-up-fb-1")).toHaveAttribute("data-highlighted", "true")
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(screen.getByRole("heading", { name: "Evidência encontrada" })).toBeInTheDocument()
  })
})

describe("Acompanhamento da estrutura — timeline", () => {
  const page = (items: FollowUpItem[], nextCursor: string | null): FollowUpFeed => ({ items, nextCursor })

  it("rótulo do dia como no colaborador e \"carregar mais\" anexando a próxima página ao chegar ao fim", async () => {
    const today = new Date()
    const first = Array.from({ length: 8 }, (_, index) => legacyFeedback({ id: `fb-${index}`, title: `Feedback ${index}`, createdAt: new Date(today.getTime() - index * 60_000).toISOString() }))
    const older = legacyFeedback({ id: "fb-old", title: "Feedback antigo", createdAt: "2026-01-05T12:00:00.000Z" })
    service.fetchFollowUpFeed.mockImplementation(async (_subject: unknown, cursor: string | null) => (cursor === null ? page(first, "cursor-fb-7") : page([older], null)))
    renderWithQuery(<StructureFollowUpFeed subject={null} description="Feedbacks da sua estrutura" />)
    expect(await screen.findByRole("heading", { name: "Feedback 0" })).toBeInTheDocument()
    expect(screen.getAllByTestId("follow-up-day").map((label) => label.textContent)).toEqual(["Hoje"])
    expect(screen.getByText("Carregando feedbacks...")).toBeInTheDocument()
    await act(async () => intersect?.())
    expect(await screen.findByRole("heading", { name: "Feedback antigo" })).toBeInTheDocument()
    expect(service.fetchFollowUpFeed).toHaveBeenLastCalledWith(null, "cursor-fb-7", 8, false)
    expect(screen.getAllByTestId("follow-up-day")).toHaveLength(2)
    expect(screen.getByText("Fim dos feedbacks deste período.")).toBeInTheDocument()
    expect(screen.getAllByTestId("follow-up-entry")).toHaveLength(9)
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
