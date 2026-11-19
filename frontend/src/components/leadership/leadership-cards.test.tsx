/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { parseLeadershipCards } from "@/schemas/leadership/leadership.schema"

import { LeadershipCards } from "./leadership-cards"
import { indicatorAnalysisCard, prioritiesCard, queryTableCard } from "./leadership-fixtures"

afterEach(() => cleanup())

describe("cartões de dados da liderança", () => {
  it("análise de indicador: número com a base, escopo, competência e limitações sempre à vista", () => {
    render(<LeadershipCards cards={[indicatorAnalysisCard()]} />)
    const card = screen.getByRole("region", { name: "Análise de Tempo Médio de Atendimento" })
    expect(within(card).getByText("39,1%")).toBeInTheDocument()
    expect(within(card).getByText("9 de 23 com referência")).toBeInTheDocument()
    expect(within(card).getByText(/Carla Coordenadora · Estrutura · Coordenador/)).toBeInTheDocument()
    expect(within(card).getByText(/Agosto 2026/)).toBeInTheDocument()
    expect(within(card).getByText(/2 sem dado \(fora do denominador\)/)).toBeInTheDocument()
    expect(within(card).getByRole("list", { name: "Limitações" })).toHaveTextContent("fechamento parcial")
    expect(within(card).getByText("Concentrado")).toBeInTheDocument()
  })

  it("links preservam estrutura, competência e indicador; pessoas ligadas diretamente não viram link", () => {
    render(<LeadershipCards cards={[indicatorAnalysisCard()]} />)
    expect(screen.getByRole("link", { name: "Abrir Sara Silva em Tempo Médio de Atendimento" })).toHaveAttribute("href", "/supervisor?tab=indicators&subjectKind=SUPERVISOR_TEAM&subjectId=11111111-1111-4111-8111-111111111111&period=2026-08&indicator=TMA")
    expect(screen.queryByRole("link", { name: /Abrir Ligados diretamente/ })).toBeNull()
    expect(screen.getByRole("link", { name: "Pedro Pior" })).toHaveAttribute("href", "/supervisor/operators/p-worst?tab=indicators&period=2026-08")
    expect(screen.getByRole("link", { name: "Ver todas as pessoas" })).toHaveAttribute("href", "/supervisor?tab=indicators&subjectKind=COORDINATOR_STRUCTURE&subjectId=22222222-2222-4222-8222-222222222222&period=2026-08&indicator=TMA")
  })

  it("prioridades: link para a tela que resolve e 'Perguntar à INIA' só no clique", () => {
    const onAsk = vi.fn()
    render(<LeadershipCards cards={[prioritiesCard()]} onAsk={onAsk} />)
    expect(screen.getByRole("link", { name: "Abrir" })).toHaveAttribute("href", "/supervisor/cases/case-1")
    expect(screen.getByRole("link", { name: "Ver pessoas" })).toHaveAttribute("href", expect.stringContaining("indicator=TMA"))
    expect(onAsk).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: /Perguntar à INIA/ }))
    expect(onAsk).toHaveBeenCalledWith("Onde está concentrado o desvio de Tempo Médio de Atendimento?")
  })

  it("consulta flexível: tabela calculada no backend; a primeira coluna leva à unidade com o indicador aberto", () => {
    render(<LeadershipCards cards={[queryTableCard()]} />)
    expect(screen.getByRole("columnheader", { name: "% fora" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sara Silva" })).toHaveAttribute("href", "/supervisor?tab=indicators&subjectKind=SUPERVISOR_TEAM&subjectId=11111111-1111-4111-8111-111111111111&period=2026-08&indicator=REINCIDENCIA_7D")
  })

  it("no chat os cartões ficam recolhidos: a resposta em markdown já traz as tabelas", () => {
    render(<LeadershipCards collapsible cards={[queryTableCard(), indicatorAnalysisCard()]} />)
    // Pílula curta; os títulos (sem repetição) vão para o tooltip e para o nome acessível.
    const trigger = screen.getByTestId("leadership-cards-trigger")
    expect(trigger).toHaveTextContent("Dados e links · 2 consultas")
    expect(trigger).not.toHaveTextContent("Tempo Médio")
    expect(trigger).toHaveClass("cursor-pointer")
    expect(trigger).toHaveAccessibleName("Dados e links — 2 consultas: Reincidência em até 7 Dias por supervisor; Tempo Médio de Atendimento")
    expect(screen.queryByRole("link", { name: "Sara Silva" })).toBeNull()
    fireEvent.click(screen.getByTestId("leadership-cards-trigger"))
    expect(screen.getByRole("link", { name: "Sara Silva" })).toBeInTheDocument()
  })

  it("consulta repetida no turno aparece uma vez no resumo, com a contagem", () => {
    render(<LeadershipCards collapsible cards={[queryTableCard(), queryTableCard(), queryTableCard(), indicatorAnalysisCard()]} />)
    const trigger = screen.getByTestId("leadership-cards-trigger")
    expect(trigger).toHaveTextContent("Dados e links · 4 consultas")
    expect(trigger).toHaveAccessibleName("Dados e links — 4 consultas: Reincidência em até 7 Dias por supervisor (3 vezes); Tempo Médio de Atendimento")
  })

  it("só leitura (painel do admin): os números aparecem, os links e as ações não", () => {
    render(<LeadershipCards readOnly cards={[indicatorAnalysisCard(), prioritiesCard()]} />)
    expect(screen.getByText("Pedro Pior")).toBeInTheDocument()
    expect(screen.queryAllByRole("link")).toHaveLength(0)
    expect(screen.queryByRole("button", { name: /Perguntar à INIA/ })).toBeNull()
  })

  it("cartão de formato desconhecido é ignorado, nunca quebra o chat", () => {
    expect(parseLeadershipCards([indicatorAnalysisCard(), { type: "OUTRO" }, null])).toHaveLength(1)
    expect(parseLeadershipCards(undefined)).toEqual([])
  })
})

describe("escolha da leitura dos dados (DATA_CHOICE)", () => {
  const choice = () =>
    parseLeadershipCards([
      {
        type: "DATA_CHOICE",
        generatedAt: "2026-11-18T12:00:00.000Z",
        structure: queryTableCard().structure,
        title: 'Onde procurar "contestação"?',
        prompt: '"contestação" aparece em mais de um campo dos atendimentos. Escolha a leitura que você quer:',
        scopeNote: "Estrutura · 01/08/2026 a 31/08/2026 · 4.539 atendimentos no período",
        options: [
          { id: "MOTIVO", label: 'Motivo contém "contestação"', detail: "56 atendimentos · 1,2% do período", question: 'Considere os atendimentos em que o motivo contém "contestação".' },
          { id: "SUBMOTIVO", label: 'Submotivo contém "contestação"', detail: "286 atendimentos · 6,3% do período", question: 'Considere os atendimentos em que o submotivo contém "contestação".' },
        ],
      },
      queryTableCard(),
    ])

  it("fica aberta fora de \"Dados e links\" e a escolha volta como pergunta da pessoa", () => {
    const onAsk = vi.fn()
    render(<LeadershipCards collapsible cards={choice()} onAsk={onAsk} />)
    const card = screen.getByTestId("data-choice-card")
    expect(within(card).getByText("286 atendimentos · 6,3% do período")).toBeInTheDocument()
    expect(screen.getByTestId("leadership-cards-trigger")).toHaveTextContent("1 consulta")
    const consult = within(card).getByRole("button", { name: "Consultar" })
    expect(consult).toBeDisabled()
    fireEvent.click(within(card).getByLabelText(/Submotivo contém/))
    fireEvent.click(consult)
    expect(onAsk).toHaveBeenCalledWith('Considere os atendimentos em que o submotivo contém "contestação".')
    expect(within(card).getByRole("button", { name: "Consultando…" })).toBeDisabled()
  })

  it("sem onAsk (histórico ou só leitura) mostra as opções sem botão", () => {
    render(<LeadershipCards collapsible cards={choice()} />)
    expect(within(screen.getByTestId("data-choice-card")).queryByRole("button", { name: "Consultar" })).toBeNull()
  })
})
