/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OrchestratorPolicyFields } from "./orchestrator-policy-fields"

afterEach(cleanup)

// Catálogo dinâmico (DADOS): inclui um domínio que nunca existiu em enum e um desativado.
const FATURAMENTO = { id: "d1", code: "FATURAMENTO", name: "Faturamento", active: true }
const RETENCAO = { id: "d2", code: "RETENCAO", name: "Retenção e Cancelamento", active: true }
const LOGISTICA = { id: "d5", code: "LOGISTICA", name: "Logística", active: true }
const BACKOFFICE = { id: "d6", code: "BACKOFFICE", name: "Backoffice", active: false }
const CATALOG = [FATURAMENTO, RETENCAO, LOGISTICA, BACKOFFICE]

describe("OrchestratorPolicyFields — 'Como este Orquestrador pode escolher especialistas?'", () => {
  it("Domínios específicos mostra o catálogo (só ativos, inclusive um domínio novo) e devolve DOMAINS com as referências escolhidas", () => {
    const onChange = vi.fn()
    const { rerender } = render(<OrchestratorPolicyFields routing={{ kind: null }} domains={CATALOG} onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio", { name: "Domínios específicos" }))
    expect(onChange).toHaveBeenLastCalledWith({ kind: "DOMAINS", domains: [] })
    rerender(<OrchestratorPolicyFields routing={{ kind: "DOMAINS", domains: [FATURAMENTO] }} domains={CATALOG} onChange={onChange} />)
    expect(screen.getByRole("button", { name: "Logística" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Backoffice/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Retenção e Cancelamento" }))
    expect(onChange).toHaveBeenLastCalledWith({ kind: "DOMAINS", domains: [FATURAMENTO, RETENCAO] })
  })

  it("um domínio desativado que o registro já tinha continua marcado como '(desativado)'; sem catálogo, aponta para Domínios de negócio", () => {
    render(<OrchestratorPolicyFields routing={{ kind: "DOMAINS", domains: [BACKOFFICE] }} domains={CATALOG} onChange={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Backoffice (desativado)" })).toHaveAttribute("data-state", "on")
    cleanup()
    render(<OrchestratorPolicyFields routing={{ kind: "DOMAINS", domains: [] }} domains={[]} onChange={vi.fn()} />)
    expect(screen.getByTestId("routing-domains-empty").textContent).toContain("Nenhum domínio de negócio ativo")
  })

  it("Qualquer assunto autorizado devolve OPEN e não mostra domínios", () => {
    const onChange = vi.fn()
    render(<OrchestratorPolicyFields routing={{ kind: "DOMAINS", domains: [RETENCAO] }} domains={CATALOG} onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio", { name: "Qualquer assunto autorizado" }))
    expect(onChange).toHaveBeenLastCalledWith({ kind: "OPEN" })
    cleanup()
    render(<OrchestratorPolicyFields routing={{ kind: "OPEN" }} domains={CATALOG} onChange={onChange} />)
    expect(screen.queryByLabelText("Domínios autorizados")).toBeNull()
  })

  it("registro legado (Gerencial/Transversal) aparece traduzido, sem obrigar correção", () => {
    render(<OrchestratorPolicyFields routing={{ kind: "LEGACY", legacy: { kind: "MANAGERIAL", domains: [] } }} domains={CATALOG} onChange={vi.fn()} />)
    expect(screen.getByTestId("routing-legacy").textContent).toContain("Legado: Gerencial")
    expect(screen.getByTestId("routing-legacy").textContent).toContain("não é obrigatório agora")
  })
})
