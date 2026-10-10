/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkflowIssuesPanel } from "./workflow-issues-panel"

afterEach(cleanup)

const ISSUES = [
  { nodeId: "out-mgr", message: 'O Output "Resumo ao Diretor" está em um fluxo consolidado e não possui um operador individual atual.' },
  { nodeId: "apply", message: 'Nem todos os caminhos individuais de "Aplicar individualmente" chegam ao mesmo "Consolidar resultados".' },
  { nodeId: "", message: "O workflow precisa ter ao menos um nó Fim." },
]

describe("Rodapé do editor — resumo de problemas de publicação", () => {
  it("sem problemas: diz que está pronto para publicar", () => {
    render(<WorkflowIssuesPanel issues={[]} nodeLabelById={() => undefined} onSelectIssue={() => {}} />)
    expect(screen.getByText(/Pronto para publicar/)).toBeInTheDocument()
    expect(screen.queryByText(/Ver problemas/)).not.toBeInTheDocument()
  })

  it("com problemas: mostra a contagem sem esconder o erro e abre a lista completa com o nó de cada um", () => {
    render(<WorkflowIssuesPanel issues={ISSUES} nodeLabelById={(id) => ({ "out-mgr": "Resumo ao Diretor", apply: "Aplicar individualmente" })[id]} onSelectIssue={() => {}} />)
    expect(screen.getByText("Não é possível publicar — 3 problemas")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Ver problemas" }))
    const list = screen.getByRole("list", { name: "Lista de problemas do grafo" })
    expect(list.querySelectorAll("li")).toHaveLength(3)
    expect(screen.getByText("Resumo ao Diretor")).toBeInTheDocument()
    expect(screen.getByText(/precisa ter ao menos um nó Fim/)).toBeInTheDocument()
  })

  it("clicar num problema navega para o nó responsável e fecha a lista; problema sem nó não é clicável", () => {
    const onSelectIssue = vi.fn()
    render(<WorkflowIssuesPanel issues={ISSUES} nodeLabelById={() => undefined} onSelectIssue={onSelectIssue} />)
    fireEvent.click(screen.getByRole("button", { name: "Ver problemas" }))
    const buttons = screen.getByRole("list", { name: "Lista de problemas do grafo" }).querySelectorAll("button")
    expect(buttons[2]).toBeDisabled()
    fireEvent.click(buttons[0]!)
    expect(onSelectIssue).toHaveBeenCalledWith("out-mgr")
    expect(screen.queryByRole("list", { name: "Lista de problemas do grafo" })).not.toBeInTheDocument()
  })

  it("singular quando há um único problema", () => {
    render(<WorkflowIssuesPanel issues={[ISSUES[0]!]} nodeLabelById={() => undefined} onSelectIssue={() => {}} />)
    expect(screen.getByText("Não é possível publicar — 1 problema")).toBeInTheDocument()
  })

  it("estados da validação: stale (salve para validar), validando, erro com 'Validar de novo' — nunca 'Pronto para publicar' fora de ready", () => {
    const { rerender } = render(<WorkflowIssuesPanel issues={[]} status="stale" nodeLabelById={() => undefined} onSelectIssue={() => {}} />)
    expect(screen.getByTestId("workflow-issues-summary")).toHaveAttribute("data-status", "stale")
    expect(screen.getByText(/salve o rascunho para validar/)).toBeInTheDocument()
    expect(screen.queryByText(/Pronto para publicar/)).not.toBeInTheDocument()
    rerender(<WorkflowIssuesPanel issues={[]} status="validating" nodeLabelById={() => undefined} onSelectIssue={() => {}} />)
    expect(screen.getByText(/Validando no servidor/)).toBeInTheDocument()
    const revalidate = vi.fn()
    rerender(<WorkflowIssuesPanel issues={[]} status="error" nodeLabelById={() => undefined} onSelectIssue={() => {}} onRevalidate={revalidate} />)
    fireEvent.click(screen.getByRole("button", { name: /Validar de novo/ }))
    expect(revalidate).toHaveBeenCalledTimes(1)
    rerender(<WorkflowIssuesPanel issues={[]} status="ready" nodeLabelById={() => undefined} onSelectIssue={() => {}} />)
    expect(screen.getByText(/Pronto para publicar — validação local e do servidor/)).toBeInTheDocument()
  })

  it("problema vindo do backend (destinatário ambíguo) entra na mesma lista e navega para o nó pelo nodeId devolvido", () => {
    const onSelectIssue = vi.fn()
    const backendIssue = { nodeId: "output", message: "Esta estrutura possui mais de um Gerente possível (3: A, B, C). Escolha um destinatário compatível ou uma estrutura com responsável inequívoco." }
    render(<WorkflowIssuesPanel issues={[backendIssue]} status="invalid" nodeLabelById={(id) => (id === "output" ? "Padrões recorrentes ao Gerente" : undefined)} onSelectIssue={onSelectIssue} />)
    expect(screen.getByTestId("workflow-issues-summary")).toHaveAttribute("data-status", "invalid")
    fireEvent.click(screen.getByRole("button", { name: "Ver problemas" }))
    fireEvent.click(screen.getByText(/mais de um Gerente possível/))
    expect(onSelectIssue).toHaveBeenCalledWith("output")
  })
})
