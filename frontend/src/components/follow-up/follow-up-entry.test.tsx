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

  it("intervenção aberta pela política: o resumo da INIA aparece direto — fala, situação, o que já foi feito, evolução, o que falta e o próximo passo", () => {
    const lead = "Criei um acompanhamento para você fazer com Mariana Alves: “Plano de ação”, com prazo até 18/12/2026."
    renderEntry(
      alertItem({
        category: "INTERVENTION",
        title: "Nova intervenção: Plano de ação",
        summary: lead,
        caseId: "case-1",
        intervention: {
          interventionId: "int-1",
          typeName: "Plano de ação",
          sensitive: false,
          lead,
          situation: ["TMA: Q4 em 3 dos últimos 3 fechamentos oficiais"],
          alreadyDone: {
            windowDays: 180,
            feedbackCount: 3,
            feedbacks: [{ id: "f1", kind: "INDICATOR", title: "Tempo Médio de Atendimento", publishedAt: "2026-10-19T15:00:00.000Z", acknowledgedAt: null, recommendation: "Avise o cliente antes de cada espera." }],
            interventions: [{ id: "int-0", typeName: "Orientar", status: "COMPLETED", openedAt: "2026-09-01T15:00:00.000Z", closedAt: "2026-09-20T15:00:00.000Z", operationalResult: "UNCHANGED" }],
          },
          evolution: { indicatorCode: "TMA", indicatorName: "Tempo Médio de Atendimento", status: "IMPROVED", statement: "Desde o feedback de 19/10/2026, Tempo Médio de Atendimento foi de 500 s para 450 s: melhorou 10%." },
          unknowns: ["Não há diagnóstico sustentado no período."],
          nextSteps: ["Cumprir as tarefas nos prazos definidos."],
        },
      }),
    )
    const brief = within(screen.getByTestId("intervention-brief"))
    expect(brief.getByText(lead)).toBeInTheDocument()
    expect(within(brief.getByRole("region", { name: "Situação" })).getByText("TMA: Q4 em 3 dos últimos 3 fechamentos oficiais")).toBeInTheDocument()
    const done = within(brief.getByRole("region", { name: "O que já foi feito" }))
    // O que já foi dito ao colaborador aparece como citação, com o estado da ciência; o resto do período só é contado.
    expect(done.getByText("Avise o cliente antes de cada espera.").tagName).toBe("BLOCKQUOTE")
    expect(done.getByText("Aguardando ciência do colaborador")).toBeInTheDocument()
    expect(done.getByText("Mais 2 feedback(s) anteriores no período.")).toBeInTheDocument()
    expect(done.getByText(/Orientar · Concluída em .* · resultado registrado: Sem mudança/)).toBeInTheDocument()
    expect(within(brief.getByRole("region", { name: "Evolução medida" })).getByText(/melhorou 10%/)).toBeInTheDocument()
    expect(within(brief.getByRole("region", { name: "O que ainda não sei" })).getByText("Não há diagnóstico sustentado no período.")).toBeInTheDocument()
    expect(within(brief.getByRole("region", { name: "Próximo passo" })).getByText("Cumprir as tarefas nos prazos definidos.")).toBeInTheDocument()
    // O resumo substitui o "Ver análise completa"; tarefas e decisões continuam no caso.
    expect(screen.queryByRole("button", { name: "Ver análise completa" })).toBeNull()
    expect(screen.getByRole("link", { name: "Abrir no caso de supervisão" })).toHaveAttribute("href", "/supervisor/cases/case-1")
  })

  it("intervenção sem resumo (aviso anterior, ou quem deixou de ser parte): continua o aviso curto com o caminho para o caso", () => {
    renderEntry(alertItem({ category: "INTERVENTION", title: "Aprovada: Plano de ação", summary: "\"Plano de ação\" para Mariana Alves foi aprovada e está em execução.", caseId: "case-1" }))
    expect(screen.queryByTestId("intervention-brief")).toBeNull()
    expect(card()).toHaveTextContent("foi aprovada e está em execução")
    expect(screen.getByRole("link", { name: "Abrir no caso de supervisão" })).toBeInTheDocument()
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
    // Perto da meia-noite os 8 minutos para trás cairiam em "Ontem": a base nunca fica antes de 00:10 de hoje.
    const base = Math.max(today.getTime(), new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 10).getTime())
    const first = Array.from({ length: 8 }, (_, index) => legacyFeedback({ id: `fb-${index}`, title: `Feedback ${index}`, createdAt: new Date(base - index * 60_000).toISOString() }))
    const older = legacyFeedback({ id: "fb-old", title: "Feedback antigo", createdAt: "2026-01-05T12:00:00.000Z" })
    service.fetchFollowUpFeed.mockImplementation(async (_subject: unknown, cursor: string | null) => (cursor === null ? page(first, "cursor-fb-7") : page([older], null)))
    renderWithQuery(<StructureFollowUpFeed subject={null} description="Feedbacks da sua estrutura" />)
    expect(await screen.findByRole("heading", { name: "Feedback 0" })).toBeInTheDocument()
    expect(screen.getAllByTestId("follow-up-day").map((label) => label.textContent)).toEqual(["Hoje"])
    expect(screen.getByText("Carregando feedbacks...")).toBeInTheDocument()
    await act(async () => intersect?.())
    expect(await screen.findByRole("heading", { name: "Feedback antigo" })).toBeInTheDocument()
    expect(service.fetchFollowUpFeed).toHaveBeenLastCalledWith(null, "cursor-fb-7", 8, false, null, null, null)
    expect(screen.getAllByTestId("follow-up-day")).toHaveLength(2)
    expect(screen.getByText("Fim dos feedbacks.")).toBeInTheDocument()
    expect(screen.getAllByTestId("follow-up-entry")).toHaveLength(9)
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("Acompanhamento da estrutura — calendário filtra as ações", () => {
  const page = (items: FollowUpItem[]): FollowUpFeed => ({ items, nextCursor: null })
  const now = new Date()
  const indicator = legacyFeedback({ id: "fb-ind", category: "INDICATOR", title: "TMA acima da meta", origin: { family: "INDICATOR", reason: "INDICATOR", label: "Tempo Médio de Atendimento", iconKey: "timer" }, createdAt: now.toISOString() })
  const monitoring = legacyFeedback({ id: "fb-mon", title: "Contestação de cobrança", origin: { family: "MONITORING", reason: "FLAG", label: "Rechamada", iconKey: "flag" }, createdAt: now.toISOString() })
  // Comunicado da liderança: item do servidor (ramo NOTICE do feed), com o mesmo instante e o mesmo recorte dos demais.
  const notice: FollowUpItem = { id: "n-1", kind: "NOTICE", category: "NOTICE", title: "Nova campanha de retenção", summary: "Começa amanhã.", detail: null, severity: null, operator: null, caseId: null, createdAt: now.toISOString(), acknowledgedAt: null, feedback: null,
    notice: { id: "n-1", title: "Nova campanha de retenção", contentHtml: "<p>Começa amanhã.</p><script>alert(1)</script>", plainText: "Começa amanhã.", tags: ["Aviso"], audience: "TEAM", author: { personId: "me", name: "Eu" }, recipientCount: 12, authoredByViewer: true, publishedAt: now.toISOString() } }
  const pickPreset = async (label: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Filtrar o Acompanhamento por período" }))
    fireEvent.click(await screen.findByRole("button", { name: label }))
  }

  it("visão inicial = todo o período; um recorte vai ao servidor, mostra a faixa e mantém os três tipos identificáveis; vazio oferece a volta", async () => {
    service.fetchFollowUpFeed.mockImplementation(async (_s: unknown, _c: unknown, _l: unknown, _a: unknown, period: { since: string; until: string } | null) => {
      if (period === null || Date.parse(period.until) > now.getTime()) return page([notice, indicator, monitoring])
      return page([])
    })
    renderWithQuery(<StructureFollowUpFeed subject={null} description="Feedbacks da sua estrutura" />)
    expect(await screen.findByRole("heading", { name: "TMA acima da meta" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Filtrar o Acompanhamento por período" })).toHaveTextContent("Todo o período")
    expect(screen.queryByTestId("follow-up-period-bar")).toBeNull()
    expect(service.fetchFollowUpFeed).toHaveBeenLastCalledWith(null, null, 8, false, null, null, null)

    // Recorte com resultados mistos: indicador, monitoria e comunicado de hoje.
    await pickPreset("Hoje")
    const bar = await screen.findByTestId("follow-up-period-bar")
    expect(bar).toHaveTextContent(`de ${now.toLocaleDateString("pt-BR")}`)
    const period = service.fetchFollowUpFeed.mock.lastCall?.[4] as { since: string; until: string }
    expect(new Date(period.since).getTime()).toBe(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime())
    expect(new Date(period.until).getTime()).toBe(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime())
    expect(await screen.findByRole("heading", { name: "Contestação de cobrança" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Nova campanha de retenção" })).toBeInTheDocument()
    const families = Array.from(document.querySelectorAll("[data-slot=feedback-entry-header]")).map((element) => element.getAttribute("data-family"))
    expect(families.sort()).toEqual(["INDICATOR", "MONITORING", "NOTICE"])
    // Quem publicou vê o público; o conteúdo passa de novo pelo saneador da tela.
    expect(screen.getByText("Publicado para sua equipe · 12 pessoas")).toBeInTheDocument()
    expect(screen.getByText("Começa amanhã.")).toBeInTheDocument()
    expect(document.querySelector("[data-testid=communication-entry] script")).toBeNull()

    // Período sem nada: a seção continua montada (faixa + vazio) e o comunicado de hoje não entra.
    await pickPreset("Mês passado")
    expect(await screen.findByText("Nenhuma ação neste período")).toBeInTheDocument()
    expect(screen.getByTestId("follow-up-period-bar")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Nova campanha de retenção" })).toBeNull()

    // Volta à visão inicial pelo próprio vazio.
    fireEvent.click(within(screen.getByText("Nenhuma ação neste período").parentElement!).getByRole("button", { name: "Ver todo o período" }))
    expect(await screen.findByRole("heading", { name: "TMA acima da meta" })).toBeInTheDocument()
    expect(screen.queryByTestId("follow-up-period-bar")).toBeNull()
    expect(screen.getByRole("button", { name: "Filtrar o Acompanhamento por período" })).toHaveTextContent("Todo o período")
    expect(service.fetchFollowUpFeed).toHaveBeenLastCalledWith(null, null, 8, false, null, null, null)

    // Filtro "Tipo": vai ao servidor (o feed é paginado lá) — "todos menos monitoria"; nada nesses tipos → vazio próprio que volta a tudo.
    service.fetchFollowUpFeed.mockResolvedValueOnce({ items: [], nextCursor: null })
    fireEvent.click(screen.getByRole("button", { name: /Filtrar o Acompanhamento por tipo/ }))
    fireEvent.click(await screen.findByRole("checkbox", { name: "Feedbacks de monitoria" }))
    expect(await screen.findByText("Nada nos tipos escolhidos")).toBeInTheDocument()
    expect(service.fetchFollowUpFeed).toHaveBeenLastCalledWith(null, null, 8, false, null, ["NOTICE", "ALIGNMENT", "INDICATOR", "WORKFLOW_OUTPUT", "HUMAN_REVIEW", "ESCALATION", "INTERVENTION", "REPORT", "OTHER"], null)
    fireEvent.click(screen.getByRole("button", { name: "Ver todos os tipos" }))
    expect(await screen.findByRole("heading", { name: "TMA acima da meta" })).toBeInTheDocument()
  })
})

describe("Acompanhamento da estrutura — filtro \"Para quem\"", () => {
  const now = new Date().toISOString()
  const teamFeedback = legacyFeedback({ id: "fb-team", title: "Contestação de cobrança", createdAt: now })
  const myAlert = legacyFeedback({ id: "al-1", kind: "ALERT", category: "WORKFLOW_OUTPUT", title: "Resultado do workflow de TMA", createdAt: now })

  it("só na própria estrutura: Tudo · Para mim · Da equipe vão ao servidor; \"Para mim\" desliga a ciência e o vazio volta a tudo", async () => {
    service.fetchFollowUpFeed.mockImplementation(async (_s: unknown, _c: unknown, _l: unknown, _a: unknown, _p: unknown, _t: unknown, audience: string | null) =>
      ({ items: audience === "MINE" ? [myAlert] : audience === "TEAM" ? [teamFeedback] : [myAlert, teamFeedback], nextCursor: null }))
    const onAck = vi.fn()
    renderWithQuery(<StructureFollowUpFeed subject={null} description="Feedbacks da sua estrutura" audienceFilter unacknowledgedOnly onUnacknowledgedOnlyChange={onAck} />)
    const filter = await screen.findByTestId("follow-up-audience-filter")
    expect(within(filter).getByRole("radio", { name: "Tudo" })).toHaveAttribute("data-state", "on")

    fireEvent.click(within(filter).getByRole("radio", { name: "Da equipe" }))
    expect(await screen.findByRole("heading", { name: "Contestação de cobrança" })).toBeInTheDocument()
    expect(service.fetchFollowUpFeed).toHaveBeenLastCalledWith(null, null, 8, true, null, null, "TEAM")
    expect(onAck).not.toHaveBeenCalled()

    fireEvent.click(within(filter).getByRole("radio", { name: "Para mim" }))
    expect(onAck).toHaveBeenCalledWith(false)

    service.fetchFollowUpFeed.mockResolvedValueOnce({ items: [], nextCursor: null })
    fireEvent.click(within(filter).getByRole("radio", { name: "Da equipe" }))
    expect(await screen.findByText("Nada da equipe")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Ver tudo" }))
    expect(await screen.findByRole("heading", { name: "Resultado do workflow de TMA" })).toBeInTheDocument()
    expect(within(filter).getByRole("radio", { name: "Tudo" })).toHaveAttribute("data-state", "on")
  })

  it("na ficha do colaborador (sem audienceFilter) o controle não aparece e nada vai ao servidor", async () => {
    service.fetchFollowUpFeed.mockResolvedValue({ items: [teamFeedback], nextCursor: null })
    renderWithQuery(<StructureFollowUpFeed subject={{ kind: "EMPLOYEE", id: "op-1" }} description="Feedbacks da Ana" />)
    expect(await screen.findByRole("heading", { name: "Contestação de cobrança" })).toBeInTheDocument()
    expect(screen.queryByTestId("follow-up-audience-filter")).toBeNull()
    expect(service.fetchFollowUpFeed.mock.lastCall?.[6]).toBeNull()
  })
})
