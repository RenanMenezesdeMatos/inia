/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { clarificationBubbleText, parseClarification, type ClarificationStep, type ClarificationView } from "@/schemas/knowledge-clarification/clarification.schema"
import { ClarificationForm, SEARCHABLE_FROM } from "./clarification-form"
import { ClarificationAudit } from "./clarification-audit"
import { KnowledgeClarificationBlock } from "./knowledge-clarification-block"

/** Estados fictícios, só para estes testes. */
const source = (documentId: string, heading = "1. Seção", available = true) => ({ documentId, documentTitle: available ? `Base ${documentId} (fictícia)` : "", versionId: `${documentId}-v1`, heading: available ? heading : "", chunkIndex: 0, available })
const step = (labels: string[], options: Partial<ClarificationStep> = {}): ClarificationStep => ({
  id: "step_1_aaaaaaaa",
  dimension: "Dimensão",
  question: "Qual cenário se aplica?",
  selectionMode: "SINGLE",
  options: labels.map((label, index) => ({ id: `opt_${String(index).padStart(10, "0")}`, label, description: index === 0 ? "Descrição do primeiro" : null, group: null, evidence: [source(`kb-${index}`)] })),
  answer: null,
  ...options,
})
const view = (overrides: Partial<ClarificationView> = {}): ClarificationView => ({
  version: "KNOWLEDGE_CLARIFICATION_V1",
  id: "11111111-1111-4111-8111-111111111111",
  originalQuestion: "Pergunta?",
  status: "OPEN",
  steps: [step(["Cenário A", "Cenário B"])],
  questionFacts: [],
  coverage: { consideredDocuments: 4, matchedDocuments: 2, presentedDocuments: 2, omittedDocuments: 0, complete: true },
  sources: [],
  conflicts: [],
  notice: null,
  updatedAt: "2026-10-20T12:00:00.000Z",
  scenario: [],
  ...overrides,
})

// Rádio e caixa de seleção do kit (Radix) medem o tamanho com ResizeObserver, que o jsdom não tem.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
afterEach(() => cleanup())

describe("formulário de uma etapa do esclarecimento", () => {
  it("seleção única: escolhe uma opção (com descrição e fonte visíveis) e envia; nada escolhido = botão desabilitado", () => {
    const onSubmit = vi.fn()
    render(<ClarificationForm step={step(["Cenário A", "Cenário B"])} onSubmit={onSubmit} />)
    expect(screen.getByText("Descrição do primeiro")).toBeInTheDocument()
    // Conversa natural: a fonte de cada opção não aparece no formulário (fica na auditoria).
    expect(screen.queryByText(/Fonte:/)).toBeNull()
    const submit = screen.getByRole("button", { name: "Continuar" })
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole("radio", { name: /Cenário B/ }))
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith({ optionIds: ["opt_0000000001"], noneMatched: false })
  })

  it("seleção múltipla: várias opções + complemento em texto livre", () => {
    const onSubmit = vi.fn()
    render(<ClarificationForm step={step(["Item 1", "Item 2", "Item 3"], { selectionMode: "MULTIPLE" })} onSubmit={onSubmit} />)
    expect(screen.getByText("Escolha uma ou mais opções")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: /Item 1/ }))
    fireEvent.click(screen.getByRole("checkbox", { name: /Item 3/ }))
    fireEvent.change(screen.getByLabelText("Complementar (opcional)"), { target: { value: "  detalhe extra  " } })
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    expect(onSubmit).toHaveBeenCalledWith({ optionIds: ["opt_0000000000", "opt_0000000002"], noneMatched: false, freeText: "detalhe extra" })
  })

  it("'nenhuma das opções corresponde' exige a descrição do caso e limpa a seleção", () => {
    const onSubmit = vi.fn()
    render(<ClarificationForm step={step(["Cenário A", "Cenário B"])} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole("radio", { name: /Cenário A/ }))
    fireEvent.click(screen.getByRole("radio", { name: "Nenhuma das opções corresponde ao meu caso" }))
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Descreva o seu caso"), { target: { value: "É um caso diferente" } })
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    expect(onSubmit).toHaveBeenCalledWith({ optionIds: [], noneMatched: true, freeText: "É um caso diferente" })
  })

  it("muitas opções: busca (sem acento e sem caixa) que nunca esconde as já escolhidas; grupos das fontes", () => {
    const labels = Array.from({ length: SEARCHABLE_FROM + 2 }, (_, index) => `Opção número ${index}`)
    labels[3] = "Situação específica"
    const grouped = step(labels)
    grouped.options = grouped.options.map((option, index) => ({ ...option, group: index < 5 ? "Grupo 1" : "Grupo 2" }))
    render(<ClarificationForm step={grouped} onSubmit={vi.fn()} />)
    expect(screen.getByRole("group", { name: "Grupo 1" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("radio", { name: /Opção número 7/ }))
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar entre as opções" }), { target: { value: "situacao" } })
    expect(screen.getByRole("radio", { name: /Situação específica/ })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /Opção número 7/ })).toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: /Opção número 1$/ })).toBeNull()
    expect(screen.getByText(`Mostrando 2 de ${labels.length} opções`)).toBeInTheDocument()
  })
})

describe("balão da INIA numa mensagem de esclarecimento", () => {
  it("etapa aberta: o balão vai até a pergunta (as opções são o formulário); o que vem antes dela fica (ex.: os números de quem lidera)", () => {
    expect(clarificationBubbleText("Qual cenário se aplica?\n\nOpções encontradas nas bases consultadas: Cenário A · Cenário B.", view())).toBe("Qual cenário se aplica?")
    expect(clarificationBubbleText("Três pessoas estão fora da referência.\n\nQual cenário se aplica?\n\nOpções encontradas nas bases consultadas: Cenário A · Cenário B.", view())).toBe("Três pessoas estão fora da referência.\n\nQual cenário se aplica?")
    // Texto gravado que não traz a pergunta (formato antigo): só a pergunta.
    expect(clarificationBubbleText("outro texto", view())).toBe("Qual cenário se aplica?")
  })

  it("sem etapa aberta: resposta com fontes sai SEM os marcadores (conversa natural); o que falta, inteiro", () => {
    const answered = view({ status: "ANSWERED", steps: [], sources: [source("kb-0"), source("kb-1")] })
    expect(clarificationBubbleText("Primeiro passo [1].\n- Item [2][1]\n- Nota [7]", answered)).toBe("Primeiro passo.\n- Item\n- Nota [7]")
    expect(clarificationBubbleText("Não encontrei [1].", view({ status: "INSUFFICIENT", steps: [] }))).toBe("Não encontrei [1].")
  })
})

describe("bloco do esclarecimento na resposta da INIA", () => {
  it("etapa aberta e interativa: aviso de cobertura honesto e escolha enviada com o texto legível", () => {
    const onAnswer = vi.fn()
    render(<KnowledgeClarificationBlock view={view({ coverage: { consideredDocuments: 9, matchedDocuments: 9, presentedDocuments: 8, omittedDocuments: 1, complete: false } })} interactive onAnswer={onAnswer} />)
    expect(screen.getByTestId("clarification-coverage")).toHaveTextContent("Encontrei estes cenários nas bases consultadas. A análise não cobriu todo o conteúdo encontrado")
    fireEvent.click(screen.getByRole("radio", { name: /Cenário A/ }))
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    expect(onAnswer).toHaveBeenCalledWith({ clarificationId: view().id, stepId: "step_1_aaaaaaaa", optionIds: ["opt_0000000000"], noneMatched: false, revise: false }, "Cenário A")
  })

  it("esclarecimento antigo (ou conversa somente leitura): só o registro das opções, sem formulário", () => {
    render(<KnowledgeClarificationBlock view={view()} interactive={false} onAnswer={vi.fn()} />)
    expect(screen.queryByTestId("clarification-form")).toBeNull()
    expect(screen.getByText("Opções apresentadas: Cenário A · Cenário B")).toBeInTheDocument()
  })

  it("resposta: cenário discreto (chip com o valor; detalhe e 'Alterar' ao clicar), fontes recolhidas com link e fonte sem acesso como aviso neutro", () => {
    const onAnswer = vi.fn()
    const answeredStep = { ...step(["Cenário A", "Cenário B"]), answer: { optionIds: ["opt_0000000000"], freeText: null, noneMatched: false, via: "FORM" as const, answeredAt: "2026-10-20T12:00:00.000Z" } }
    render(
      <KnowledgeClarificationBlock
        view={view({ status: "ANSWERED", steps: [answeredStep], sources: [source("kb-0", "2. Documentos"), source("kb-9", "", false)], scenario: [{ dimension: "Tópico", value: "da pergunta", origin: "QUESTION", stepId: null }, { dimension: "Dimensão", value: "Cenário A", origin: "SELECTION", stepId: answeredStep.id }] })}
        interactive
        onAnswer={onAnswer}
      />,
    )
    // No chat o cenário é um chip por fato, só com o valor; o nome acessível diz o que é e de onde veio.
    const scenario = screen.getByTestId("clarification-scenario")
    expect(scenario).toHaveTextContent("da perguntaCenário A")
    expect(scenario).not.toHaveTextContent("Tópico")
    expect(within(scenario).queryByRole("button", { name: /Alterar/ })).toBeNull()
    // Clicar abre o detalhe; o que veio da pergunta não tem "Alterar".
    fireEvent.click(within(scenario).getByRole("button", { name: "Tópico: da pergunta (da sua pergunta)" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("Tópicoda perguntada sua pergunta")
    expect(screen.queryByRole("button", { name: /Alterar/ })).toBeNull()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    // No chat as fontes ficam recolhidas; abrindo, aparecem por base, sem numeração.
    const sources = screen.getByTestId("knowledge-sources")
    expect(within(sources).queryByTestId("knowledge-sources-list")).toBeNull()
    fireEvent.click(within(sources).getByRole("button", { name: /Fontes consultadas \(2\)/ }))
    expect(within(sources).getByRole("link", { name: /Base kb-0/ })).toHaveAttribute("href", "/materiais/kb-0")
    expect(sources).toHaveTextContent("Base kb-0 (fictícia)2. Documentos")
    expect(sources).toHaveTextContent("Fonte não disponível para vocêseção indisponível")
    expect(sources).not.toHaveTextContent("kb-9")
    expect(sources).not.toHaveTextContent("[1]")
    // Corrigir: o detalhe da escolha tem "Alterar"; o formulário volta com a escolha anterior marcada; enviar = correção.
    fireEvent.click(within(scenario).getByRole("button", { name: "Dimensão: Cenário A (você escolheu)" }))
    fireEvent.click(screen.getByRole("button", { name: "Alterar Dimensão" }))
    expect(screen.getByRole("radio", { name: /Cenário A/ })).toBeChecked()
    fireEvent.click(screen.getByRole("radio", { name: /Cenário B/ }))
    fireEvent.click(screen.getByRole("button", { name: "Refazer a partir daqui" }))
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ stepId: answeredStep.id, optionIds: ["opt_0000000001"], revise: true }), "Cenário B")
  })

  it("fontes da mesma base: o título aparece uma vez, as seções numeradas abaixo; seção igual ao título = abertura; sem título = número do trecho", () => {
    const opening = { ...source("kb-0"), heading: "Base kb-0 (fictícia)", chunkIndex: 0 }
    const untitled = { ...source("kb-2"), heading: "", chunkIndex: 3 }
    render(<ClarificationAudit view={view({ status: "ANSWERED", steps: [], sources: [source("kb-0", "2. Documentos"), source("kb-1", "3. Prazo"), { ...source("kb-0", "5. Exceções"), chunkIndex: 5 }, opening, untitled] })} />)
    // Na AUDITORIA as fontes ficam abertas e numeradas como os marcadores do texto gravado.
    const sources = screen.getByTestId("knowledge-sources")
    expect(within(sources).getAllByRole("link")).toHaveLength(3)
    expect(sources).toHaveTextContent("Base kb-0 (fictícia)[1] 2. Documentos[3] 5. Exceções[4] abertura do documentoBase kb-1 (fictícia)[2] 3. PrazoBase kb-2 (fictícia)[5] trecho 4")
  })

  it("auditoria: pergunta original, opções com a base/seção que sustenta cada uma e cobertura", () => {
    render(<ClarificationAudit view={view({ coverage: { consideredDocuments: 9, matchedDocuments: 2, presentedDocuments: 9, omittedDocuments: 0, complete: true }, scenario: [{ dimension: "Assunto", value: "x", origin: "QUESTION", stepId: null }] })} />)
    const audit = screen.getByTestId("clarification-audit")
    expect(audit).toHaveTextContent("Esclarecimento pelas bases · pediu esclarecimento")
    expect(audit).toHaveTextContent("Pergunta original: “Pergunta?”")
    expect(audit).toHaveTextContent("Cenário A — Base kb-0 (fictícia) › 1. Seção")
    expect(audit).toHaveTextContent("Bases listadas para a IA: 9 de 9 que a pessoa podia consultar · 2 abertas")
    // Na auditoria o cenário vai todo escrito, sem "Alterar".
    expect(within(audit).getByTestId("clarification-scenario")).toHaveTextContent("Cenário considerado: Assunto: x (da sua pergunta)")
    expect(within(audit).queryByRole("button", { name: /Alterar/ })).toBeNull()
  })

  it("fontes divergentes aparecem explicitamente", () => {
    render(<KnowledgeClarificationBlock view={view({ status: "ANSWERED", steps: [], sources: [source("kb-0")], conflicts: [{ description: "Os prazos divergem.", sources: [source("kb-0"), source("kb-1")] }] })} interactive={false} />)
    expect(screen.getByRole("note")).toHaveTextContent("As bases consultadas divergem")
    expect(screen.getByRole("note")).toHaveTextContent("Os prazos divergem.")
  })

  it("estado de outra versão ou inválido é ignorado (nenhum formulário quebrado na tela)", () => {
    expect(parseClarification({ id: "x" })).toBeNull()
    expect(parseClarification(view())).not.toBeNull()
  })
})
