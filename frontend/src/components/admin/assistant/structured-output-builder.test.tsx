/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { StructuredOutputDefinition, StructuredOutputIssue } from "@/schemas/admin/structured-output"
import { StructuredOutputBuilder } from "./structured-output-builder"

afterEach(cleanup)

/** Legado "Atendimento multidomínio" já convertido pelo backend (dual-read) — paths preservados. */
const SINTESE: StructuredOutputDefinition = {
  schemaVersion: 1,
  nodes: [
    {
      kind: "GROUP",
      key: "sintese",
      label: "Síntese",
      children: [
        { kind: "FIELD", key: "severidade", label: "Severidade", type: "ENUM", required: false, options: [{ value: "BAIXA" }, { value: "MEDIA" }, { value: "ALTA" }, { value: "CRITICA" }] },
        { kind: "FIELD", key: "dominios", label: "Domínios", type: "STRING", required: false },
        { kind: "FIELD", key: "especialistasAcionados", label: "Especialistas acionados", type: "STRING", required: false },
        { kind: "FIELD", key: "requerAcompanhamento", label: "Requer acompanhamento", type: "BOOLEAN", required: false },
      ],
    },
  ],
}

function renderBuilder(props: Partial<React.ComponentProps<typeof StructuredOutputBuilder>> = {}) {
  const onChange = vi.fn<(definition: StructuredOutputDefinition, issues: StructuredOutputIssue[]) => void>()
  const onEnabledChange = vi.fn()
  const view = render(
    <TooltipProvider>
      <StructuredOutputBuilder initialDefinition={null} enabled onEnabledChange={onEnabledChange} onChange={onChange} {...props} />
    </TooltipProvider>,
  )
  return { ...view, onChange, onEnabledChange }
}

function lastDefinition(onChange: ReturnType<typeof vi.fn>): StructuredOutputDefinition {
  const call = onChange.mock.calls[onChange.mock.calls.length - 1]
  return call![0] as StructuredOutputDefinition
}

describe("StructuredOutputBuilder — 'Quais informações eu quero que este Orquestrador produza?'", () => {
  it("desligado mostra o empty state de texto livre; ligado e vazio pergunta o que produzir", () => {
    const { onEnabledChange } = renderBuilder({ enabled: false })
    expect(screen.getByText("Este Orquestrador retorna apenas texto livre.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Adicionar campo/ }))
    expect(onEnabledChange).toHaveBeenCalledWith(true)
    cleanup()
    renderBuilder({ enabled: true })
    expect(screen.getByText("Quais informações você quer que este Orquestrador produza?")).toBeInTheDocument()
    expect(screen.getByText(/Você não precisa escrever JSON/)).toBeInTheDocument()
  })

  it("cria grupo Análise com Assunto (Texto, obrigatório), Severidade (Lista) e Requer acompanhamento (Sim/Não) — chaves geradas, prévia e campos do Workflow automáticos", () => {
    const { onChange } = renderBuilder()
    fireEvent.click(screen.getByRole("button", { name: /Adicionar grupo/ }))
    const groupForm = screen.getByTestId("structured-group-form")
    fireEvent.change(within(groupForm).getByLabelText("Nome exibido"), { target: { value: "Análise" } })
    expect(within(groupForm).getByLabelText("Chave técnica")).toHaveValue("analise")

    // campo dentro do grupo
    fireEvent.click(screen.getByRole("button", { name: "Adicionar campo em Análise" }))
    let fieldForm = screen.getByTestId("structured-field-form")
    fireEvent.change(within(fieldForm).getByLabelText("Nome exibido"), { target: { value: "Assunto" } })
    expect(within(fieldForm).getByLabelText("Chave técnica")).toHaveValue("assunto")
    expect(within(fieldForm).getByText(/Caminho:/).textContent).toContain("analise.assunto")
    fireEvent.change(within(fieldForm).getByLabelText("O que a IA deve identificar?"), { target: { value: "Identifique o principal motivo do contato em uma frase curta." } })
    fireEvent.click(within(fieldForm).getByRole("switch", { name: "Campo obrigatório" }))

    fireEvent.click(screen.getByRole("button", { name: "Adicionar campo em Análise" }))
    fieldForm = screen.getByTestId("structured-field-form")
    fireEvent.change(within(fieldForm).getByLabelText("Nome exibido"), { target: { value: "Requer acompanhamento" } })
    expect(within(fieldForm).getByLabelText("Chave técnica")).toHaveValue("requerAcompanhamento")

    let definition = lastDefinition(onChange)
    expect(definition.nodes[0]).toMatchObject({ kind: "GROUP", key: "analise", label: "Análise" })
    const group = definition.nodes[0]
    if (group?.kind !== "GROUP") throw new Error("expected group")
    expect(group.children[0]).toMatchObject({ kind: "FIELD", key: "assunto", type: "STRING", required: true, description: "Identifique o principal motivo do contato em uma frase curta." })
    expect(group.children[1]).toMatchObject({ kind: "FIELD", key: "requerAcompanhamento", type: "STRING", required: false })

    // Sim/Não: o tipo é escolhido por rótulo amigável (nunca BOOLEAN na tela) — o Select do Radix
    // não abre no jsdom, então o tipo é trocado por um campo duplicado depois; aqui garantimos que
    // o vocabulário exposto é amigável.
    expect(within(fieldForm).getByRole("combobox", { name: "Tipo de dado" }).textContent).toBe("Texto")
    expect(screen.queryByText("STRING")).toBeNull()
    expect(screen.queryByText("BOOLEAN")).toBeNull()

    // Prévia e campos do Workflow reagem sem request
    fireEvent.click(screen.getByRole("button", { name: /Prévia do resultado/ }))
    expect(JSON.parse(screen.getByTestId("structured-output-preview").textContent ?? "{}")).toEqual({ analise: { assunto: "texto", requerAcompanhamento: "texto" } })
    fireEvent.click(screen.getByRole("button", { name: /Disponível no Workflow/ }))
    const workflowFields = screen.getByTestId("structured-output-workflow-fields")
    expect(workflowFields.textContent).toContain("Análise › Assunto")
    expect(workflowFields.textContent).toContain("Análise › Requer acompanhamento")
    fireEvent.click(screen.getByRole("button", { name: /Visualizar formato técnico/ }))
    expect(screen.getByTestId("structured-output-paths").textContent).toContain("analise.assunto")

    // sem problemas de validação
    definition = lastDefinition(onChange)
    const issues = onChange.mock.calls[onChange.mock.calls.length - 1]![1] as StructuredOutputIssue[]
    expect(issues).toEqual([])
    expect(definition.nodes).toHaveLength(1)
  })

  it("chave editada à mão nunca é sobrescrita pela sugestão; chave duplicada mostra mensagem humana e bloqueia", () => {
    const { onChange } = renderBuilder()
    fireEvent.click(screen.getByRole("button", { name: /Adicionar campo/ }))
    let form = screen.getByTestId("structured-field-form")
    fireEvent.change(within(form).getByLabelText("Nome exibido"), { target: { value: "Assunto" } })
    fireEvent.change(within(form).getByLabelText("Chave técnica"), { target: { value: "motivo" } })
    fireEvent.change(within(form).getByLabelText("Nome exibido"), { target: { value: "Assunto principal" } })
    expect(within(form).getByLabelText("Chave técnica")).toHaveValue("motivo")

    fireEvent.click(screen.getByRole("button", { name: "Adicionar campo na raiz" }))
    form = screen.getByTestId("structured-field-form")
    fireEvent.change(within(form).getByLabelText("Nome exibido"), { target: { value: "Motivo" } })
    const issues = onChange.mock.calls[onChange.mock.calls.length - 1]![1] as StructuredOutputIssue[]
    expect(issues[0]!.message).toContain('Já existe um campo com a chave "motivo" na raiz do resultado')
    expect(within(form).getByRole("alert").textContent).toContain('Já existe um campo com a chave "motivo"')
  })

  it("legado Atendimento multidomínio aparece como árvore Síntese › Severidade/Domínios/Especialistas acionados/Requer acompanhamento, sem JSON", () => {
    renderBuilder({ initialDefinition: SINTESE, source: "LEGACY_SCHEMA" })
    const tree = screen.getByRole("tree", { name: "Resultado estruturado" })
    expect(within(tree).getByRole("treeitem", { name: "Síntese" })).toBeInTheDocument()
    for (const label of ["Severidade", "Domínios", "Especialistas acionados", "Requer acompanhamento"]) {
      expect(within(tree).getByRole("treeitem", { name: label })).toBeInTheDocument()
    }
    expect(within(tree).getByText(/Lista · 4 opções/)).toBeInTheDocument()
    expect(screen.getByText(/Configuração antiga convertida automaticamente/)).toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: /JSON/ })).toBeNull()
  })

  it("legado divergente mostra a revisão pendente com as chaves em conflito", () => {
    renderBuilder({
      initialDefinition: SINTESE,
      source: "LEGACY_SCHEMA",
      review: { reason: "KEY_MISMATCH", missingInInstructions: ["severidade"], unknownInInstructions: ["criticidade"], message: "Esta configuração antiga possui diferenças entre o formato solicitado à IA e os campos cadastrados. Revise o resultado estruturado." },
    })
    const review = screen.getByTestId("structured-output-review")
    expect(review.textContent).toContain("Revise o resultado estruturado")
    expect(review.textContent).toContain("criticidade")
    expect(review.textContent).toContain("severidade")
  })

  it("adicionar Assunto ao legado preserva os paths existentes e acrescenta sintese.assunto", () => {
    const { onChange } = renderBuilder({ initialDefinition: SINTESE, source: "LEGACY_SCHEMA" })
    fireEvent.click(screen.getByRole("button", { name: "Adicionar campo em Síntese" }))
    const form = screen.getByTestId("structured-field-form")
    fireEvent.change(within(form).getByLabelText("Nome exibido"), { target: { value: "Assunto" } })
    const definition = lastDefinition(onChange)
    const group = definition.nodes[0]
    if (group?.kind !== "GROUP") throw new Error("expected group")
    expect(group.children.map((child) => child.key)).toEqual(["severidade", "dominios", "especialistasAcionados", "requerAcompanhamento", "assunto"])
  })

  it("excluir um campo usado por Workflow mostra o impacto antes; excluir grupo com filhos avisa quantos campos somem", () => {
    const usage = [{ workflowId: "wf-1", workflowName: "Modelo · 08", published: false, nodeId: "cond", nodeLabel: "Severidade alta?", path: "sintese.severidade" }]
    const { onChange } = renderBuilder({ initialDefinition: SINTESE, source: "DEFINITION", usage })
    const severidade = screen.getByRole("treeitem", { name: "Severidade" })
    fireEvent.click(within(severidade).getByRole("button", { name: "Excluir campo" }))
    const dialog = screen.getByRole("alertdialog")
    expect(dialog.textContent).toContain("Este dado é usado em Workflows")
    expect(dialog.textContent).toContain("Modelo · 08 (rascunho) › Severidade alta? — sintese.severidade")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))
    expect(screen.getByRole("treeitem", { name: "Severidade" })).toBeInTheDocument()

    const group = screen.getByRole("treeitem", { name: "Síntese" })
    fireEvent.click(within(group).getAllByRole("button", { name: "Excluir grupo" })[0]!)
    const groupDialog = screen.getByRole("alertdialog")
    expect(groupDialog.textContent).toContain("Este grupo possui 4 campo(s). Excluir o grupo também removerá esses campos.")
    fireEvent.click(within(groupDialog).getByRole("button", { name: "Excluir" }))
    expect(lastDefinition(onChange).nodes).toEqual([])
  })

  it("lista de opções: adiciona, rejeita duplicada e permite rótulo amigável", () => {
    const { onChange } = renderBuilder({ initialDefinition: SINTESE, source: "DEFINITION" })
    fireEvent.click(within(screen.getByRole("treeitem", { name: "Severidade" })).getByRole("button", { name: "Editar Severidade" }))
    const options = screen.getByTestId("structured-enum-options")
    fireEvent.change(within(options).getByLabelText("Rótulo da opção 3"), { target: { value: "Alta" } })
    fireEvent.change(within(options).getByLabelText("Nova opção"), { target: { value: "ALTA" } })
    fireEvent.click(within(options).getByRole("button", { name: /Adicionar opção/ }))
    let issues = onChange.mock.calls[onChange.mock.calls.length - 1]![1] as StructuredOutputIssue[]
    expect(issues[0]!.message).toContain('tem a opção "ALTA" repetida')
    // duas opções "ALTA" agora existem — remove a segunda (a recém-adicionada)
    fireEvent.click(within(options).getAllByRole("button", { name: "Remover opção ALTA" })[1]!)
    issues = onChange.mock.calls[onChange.mock.calls.length - 1]![1] as StructuredOutputIssue[]
    expect(issues).toEqual([])
    const definition = lastDefinition(onChange)
    const group = definition.nodes[0]
    if (group?.kind !== "GROUP" || group.children[0]?.kind !== "FIELD") throw new Error("expected enum field")
    expect(group.children[0].options).toEqual([{ value: "BAIXA" }, { value: "MEDIA" }, { value: "ALTA", label: "Alta" }, { value: "CRITICA" }])
  })

  it("subir/descer reordena irmãos", () => {
    const { onChange } = renderBuilder({ initialDefinition: SINTESE, source: "DEFINITION" })
    const dominios = screen.getByRole("treeitem", { name: "Domínios" })
    fireEvent.click(within(dominios).getByRole("button", { name: "Mover para cima" }))
    const group = lastDefinition(onChange).nodes[0]
    if (group?.kind !== "GROUP") throw new Error("expected group")
    expect(group.children.map((child) => child.key)).toEqual(["dominios", "severidade", "especialistasAcionados", "requerAcompanhamento"])
  })
})
