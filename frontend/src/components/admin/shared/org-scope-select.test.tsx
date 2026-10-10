/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { OrgScopeSelect, type OrgScopeValue } from "./org-scope-select"
import type { Team } from "@/schemas/admin/org-structure.schema"

const TEAMS: Team[] = [{ id: "team-a", name: "FATURAS", operationId: "op-1", subteams: [] }]

// Radix Select depende de APIs que o jsdom não implementa — stubs mínimos só pro suficiente
// pra abrir o dropdown num teste, sem exercitar layout real (irrelevante aqui).
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.scrollIntoView = () => {}
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = ResizeObserverStub
})

afterEach(cleanup)

function Wrapper() {
  const value: OrgScopeValue = { scopeType: "TEAM", teamId: "team-a" }
  return <OrgScopeSelect teams={TEAMS} value={value} onChange={() => {}} allowAllTeams={false} />
}

// Escopo Administrativo (Parte 10/11 do pedido): um admin restrito nunca deve ver "Todos os
// grupos" — a única forma de "esconder a opção pra quem é restrito" (escolha explícita do
// usuário, ver plano) é este item nunca aparecer no menu, não só ficar desabilitado.
describe("OrgScopeSelect com allowAllTeams=false", () => {
  it("nunca renderiza a opção 'Todos os grupos' no menu de Alcance por grupo", () => {
    render(<Wrapper />)
    fireEvent.click(screen.getAllByRole("combobox")[0]!)
    const options = screen.getAllByRole("option").map((option) => option.textContent)
    expect(options).not.toContain("Todos os grupos")
    expect(options).toEqual(["Um grupo específico", "Um subgrupo específico"])
  })
})
