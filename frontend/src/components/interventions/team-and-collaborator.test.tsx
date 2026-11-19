/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { MyFollowUp, TeamOverview } from "@/schemas/interventions/intervention.schema"

import { MyFollowUpPlans } from "./my-follow-up-plans"
import { TeamInterventions } from "./team-interventions"

const service = vi.hoisted(() => ({ fetchTeamOverview: vi.fn(), fetchMyFollowUps: vi.fn(), markMyStep: vi.fn() }))
vi.mock("@/services/interventions/intervention-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const OVERVIEW: TeamOverview = {
  windowDays: 180,
  activeTotal: 1,
  activeTruncated: false,
  active: [
    {
      id: "int-1",
      caseId: "case-1",
      person: { id: "op-1", name: "Rafael Cardoso", teamName: "B2C" },
      typeName: "Lado a lado",
      sensitive: false,
      indicatorName: "Tempo Médio de Atendimento",
      status: "IN_PROGRESS",
      statusLabel: "Em execução",
      dueAt: "2026-11-10",
      overdue: true,
      responsible: { id: "sup-1", name: "Daniela Rocha" },
      createdAt: "2026-10-20T12:00:00.000Z",
      progress: { done: 1, total: 5 },
      nextStep: { title: "2ª sessão lado a lado", dueAt: "2026-11-05", overdue: true, ownerName: "Daniela Rocha" },
    },
  ],
  results: [
    {
      typeKey: "LADO_A_LADO",
      typeName: "Lado a lado",
      indicatorName: "Tempo Médio de Atendimento",
      completed: 4,
      worked: { yes: 2, partial: 1, no: 1, unanswered: 0 },
      measured: { improved: 2, unchanged: 0, worsened: 1, notComparable: 1 },
      reasons: [
        { reason: "NOT_APPLIED", label: "O colaborador não aplicou o que foi combinado", worked: "NO", count: 1 },
        { reason: "APPLIED_AGREEMENT", label: "O colaborador aplicou o que foi combinado", worked: "YES", count: 2 },
      ],
    },
  ],
}

describe("Acompanhamentos da estrutura (aba Equipe)", () => {
  it("lista o que está em andamento com o próximo passo e o atraso, e o resumão por formato com os motivos", async () => {
    service.fetchTeamOverview.mockResolvedValue(OVERVIEW)
    renderWithQuery(<TeamInterventions />)
    const block = within(await screen.findByTestId("team-interventions"))
    expect(block.getByText("1 em andamento na sua estrutura · 1 com prazo ou passo vencido.")).toBeInTheDocument()
    expect(block.getByRole("link", { name: "Lado a lado" })).toHaveAttribute("href", "/supervisor/cases/case-1?intervention=int-1")
    expect(block.getByText("Conduz: Daniela Rocha")).toBeInTheDocument()
    expect(block.getByText("1 de 5 passos registrados")).toBeInTheDocument()
    expect(block.getByText("2ª sessão lado a lado")).toBeInTheDocument()
    expect(block.getByText("Daniela Rocha · até 05/11/2026 · vencido")).toBeInTheDocument()
    expect(block.getByText("Atrasado")).toBeInTheDocument()
    const results = within(block.getByTestId("team-intervention-results"))
    expect(results.getByText("2 sim · 1 em parte · 1 não")).toBeInTheDocument()
    expect(results.getByText("2 melhorou · 0 igual · 1 piorou")).toBeInTheDocument()
    expect(results.getByText("1 sem medição suficiente para comparar")).toBeInTheDocument()
    expect(results.getByText("O colaborador não aplicou o que foi combinado")).toBeInTheDocument()
    expect(results.getByText("(1 · não deu resultado)")).toBeInTheDocument()
  })

  it("sem nada em andamento nem concluído, o bloco não aparece", async () => {
    service.fetchTeamOverview.mockResolvedValue({ windowDays: 180, active: [], activeTotal: 0, activeTruncated: false, results: [] })
    renderWithQuery(<TeamInterventions />)
    await waitFor(() => expect(service.fetchTeamOverview).toHaveBeenCalled())
    expect(screen.queryByTestId("team-interventions")).toBeNull()
  })

  it("consulta que falha não some: mostra o erro com \"Tentar novamente\"", async () => {
    service.fetchTeamOverview.mockRejectedValueOnce(new Error("500")).mockResolvedValue(OVERVIEW)
    renderWithQuery(<TeamInterventions />)
    const error = within(await screen.findByTestId("team-interventions-error"))
    expect(error.getByRole("alert")).toHaveTextContent("Não foi possível carregar os acompanhamentos da sua estrutura.")
    fireEvent.click(error.getByRole("button", { name: "Tentar novamente" }))
    expect(await screen.findByTestId("team-interventions")).toBeInTheDocument()
  })

  const manyActive = (length: number) => Array.from({ length }, (_, index) => ({ ...OVERVIEW.active[0]!, id: `int-${index}`, overdue: false, nextStep: null }))

  it("lista cortada pelo servidor: mostra o total REAL informado por ele, avisa o corte e pagina a tabela", async () => {
    service.fetchTeamOverview.mockResolvedValue({ ...OVERVIEW, active: manyActive(200), activeTotal: 347, activeTruncated: true })
    renderWithQuery(<TeamInterventions />)
    const block = within(await screen.findByTestId("team-interventions"))
    expect(block.getByTestId("team-interventions-truncated")).toHaveTextContent("A lista mostra os 200 primeiros de 347")
    expect(block.getByText("347 em andamento na sua estrutura.")).toBeInTheDocument()
    expect(block.getAllByRole("link", { name: "Lado a lado" })).toHaveLength(20)
    expect(block.getByText(/1–20 de 200 acompanhamentos/)).toBeInTheDocument()
  })

  it("exatamente 200 em andamento e nada cortado: sem aviso de corte (quem decide é o servidor, não a quantidade que veio)", async () => {
    service.fetchTeamOverview.mockResolvedValue({ ...OVERVIEW, active: manyActive(200), activeTotal: 200, activeTruncated: false })
    renderWithQuery(<TeamInterventions />)
    const block = within(await screen.findByTestId("team-interventions"))
    expect(block.getByText("200 em andamento na sua estrutura.")).toBeInTheDocument()
    expect(block.queryByTestId("team-interventions-truncated")).not.toBeInTheDocument()
  })
})

const PLAN: MyFollowUp = {
  id: "int-9",
  typeName: "Atendimento assistido",
  description: "",
  responsibleName: "Daniela Rocha",
  startedAt: "2026-11-10T12:00:00.000Z",
  dueAt: "2026-12-01",
  objective: null,
  revision: 3,
  steps: [
    { id: "s1", kind: "TASK", title: "Atender com apoio ao vivo", description: "", mine: false, ownerName: "Daniela Rocha", dueAt: "2026-11-15", done: true, overdue: false },
    { id: "s2", kind: "TASK", title: "Atender sozinho e trazer as dúvidas", description: "", mine: true, ownerName: null, dueAt: "2026-11-20", done: false, overdue: false },
  ],
}

describe("O acompanhamento visto pelo colaborador", () => {
  it("mostra o combinado com quem lidera e deixa marcar só o passo que é dele", async () => {
    service.fetchMyFollowUps.mockResolvedValue([PLAN])
    service.markMyStep.mockResolvedValue({ ...PLAN, steps: [PLAN.steps[0]!, { ...PLAN.steps[1]!, done: true }] })
    renderWithQuery(<MyFollowUpPlans />)
    const plan = within(await screen.findByTestId("my-follow-up-plan"))
    expect(plan.getByText("Acompanhamento com Daniela Rocha")).toBeInTheDocument()
    expect(plan.getByText("Até 01/12/2026 · 1 de 2 passos feitos")).toBeInTheDocument()
    expect(plan.getByText("Com Daniela Rocha · até 15/11/2026")).toBeInTheDocument()
    expect(plan.getByText("Com você · até 20/11/2026")).toBeInTheDocument()
    // O passo de quem conduz não é um botão; o do colaborador é.
    expect(plan.queryByRole("button", { name: /Atender com apoio ao vivo/ })).toBeNull()
    fireEvent.click(plan.getByRole("button", { name: "Marcar como feito: Atender sozinho e trazer as dúvidas" }))
    await waitFor(() => expect(service.markMyStep).toHaveBeenCalledWith("int-9", "s2", { done: true }))
  })

  it("sem acompanhamento visível, nada aparece no feed", async () => {
    service.fetchMyFollowUps.mockResolvedValue([])
    renderWithQuery(<MyFollowUpPlans />)
    await waitFor(() => expect(service.fetchMyFollowUps).toHaveBeenCalled())
    expect(screen.queryByTestId("my-follow-up-plans")).toBeNull()
  })

  it("consulta que falha mostra o erro com nova tentativa, em vez de esconder o plano", async () => {
    service.fetchMyFollowUps.mockRejectedValueOnce(new Error("500")).mockResolvedValue([PLAN])
    renderWithQuery(<MyFollowUpPlans />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar o seu acompanhamento com quem lidera você.")
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }))
    expect(await screen.findByTestId("my-follow-up-plan")).toBeInTheDocument()
  })
})
