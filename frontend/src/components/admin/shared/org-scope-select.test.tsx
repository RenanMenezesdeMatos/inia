/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { OrgScopeSelect, orgScopeValueAfterUniverseChange, type OrgScopeValue } from "./org-scope-select"
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

// Cada rótulo visível nomeia o seu seletor: o leitor de tela anuncia "Alcance por grupo", "Grupo" e "Subgrupo", não um combobox sem nome.
describe("OrgScopeSelect — rótulos associados aos seletores", () => {
  it("cada rótulo encontra o seu combobox", () => {
    const teams: Team[] = [{ id: "team-a", name: "FATURAS", operationId: "op-1", subteams: [{ id: "sub-1", teamId: "team-a", name: "Turno A" }] }]
    render(<OrgScopeSelect teams={teams} value={{ scopeType: "SUBTEAM", teamId: "team-a", subteamId: "sub-1" }} onChange={() => {}} />)
    const comboboxes = screen.getAllByRole("combobox")
    expect(screen.getByLabelText("Alcance por grupo")).toBe(comboboxes[0])
    expect(screen.getByLabelText("Grupo")).toBe(comboboxes[1])
    expect(screen.getByLabelText("Subgrupo")).toBe(comboboxes[2])
    expect(screen.getByRole("combobox", { name: "Subgrupo" })).toHaveTextContent("Turno A")
  })
})

// Hierarquia universo → Grupo → Subgrupo: com o universo do recurso escolhido, nunca se oferece Grupo/Subgrupo de outro universo.
describe("OrgScopeSelect com universo", () => {
  const teams: Team[] = [
    { id: "t-b2c", name: "Varejo", operationId: "op", operatingUniverse: "B2C", subteams: [
      { id: "s-b2c", teamId: "t-b2c", name: "Turno A", operatingUniverse: "B2C" },
      { id: "s-b2b", teamId: "t-b2c", name: "Empresas no Varejo", operatingUniverse: "B2B" },
    ] },
    { id: "t-b2b", name: "Grandes Contas", operationId: "op", operatingUniverse: "B2B", subteams: [] },
    { id: "t-pend", name: "Sem universo", operationId: "op", operatingUniverse: null, subteams: [] },
  ]

  it("Grupo específico: só os Grupos inteiros classificados no universo (o sem universo some)", () => {
    render(<OrgScopeSelect teams={teams} universe="B2B" value={{ scopeType: "TEAM" }} onChange={() => {}} />)
    fireEvent.click(screen.getByRole("combobox", { name: "Grupo" }))
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Grandes Contas"])
  })

  it("Subgrupo específico: o Grupo de outro universo aparece só com o Subgrupo do universo", () => {
    render(<OrgScopeSelect teams={teams} universe="B2B" value={{ scopeType: "SUBTEAM", teamId: "t-b2c" }} onChange={() => {}} />)
    fireEvent.click(screen.getByRole("combobox", { name: "Subgrupo" }))
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Empresas no Varejo"])
  })

  it("trocar o universo limpa o alcance que deixou de caber", () => {
    expect(orgScopeValueAfterUniverseChange({ scopeType: "TEAM", teamId: "t-b2c" }, teams, "B2B")).toEqual({ scopeType: "TEAM" })
    expect(orgScopeValueAfterUniverseChange({ scopeType: "SUBTEAM", teamId: "t-b2c", subteamId: "s-b2c" }, teams, "B2B")).toEqual({ scopeType: "SUBTEAM", teamId: "t-b2c", subteamId: undefined })
    expect(orgScopeValueAfterUniverseChange({ scopeType: "TEAM", teamId: "t-b2b" }, teams, "B2B")).toEqual({ scopeType: "TEAM", teamId: "t-b2b" })
    expect(orgScopeValueAfterUniverseChange({ scopeType: "ALL_TEAMS" }, teams, "B2X")).toEqual({ scopeType: "ALL_TEAMS" })
  })
})

// QA de 17/11: Workflow B2B salvo num Grupo ainda sem universo abria com o campo Grupo em branco. O salvo continua visível e marcado.
describe("OrgScopeSelect — valor salvo fora do universo", () => {
  const teams: Team[] = [
    { id: "t-b2b", name: "Grandes Contas", operationId: "op", operatingUniverse: "B2B", subteams: [] },
    { id: "t-pend", name: "SUPORTE TÉCNICO", operationId: "op", operatingUniverse: null, subteams: [{ id: "s-pend", teamId: "t-pend", name: "Voz", operatingUniverse: null }] },
    { id: "t-b2c", name: "Varejo", operationId: "op", operatingUniverse: "B2C", subteams: [{ id: "s-b2c", teamId: "t-b2c", name: "Turno A", operatingUniverse: "B2C" }] },
  ]

  it("Grupo salvo sem universo aparece selecionado e marcado; não vira opção para outros", () => {
    render(<OrgScopeSelect teams={teams} universe="B2B" value={{ scopeType: "TEAM", teamId: "t-pend" }} onChange={() => {}} />)
    expect(screen.getByRole("combobox", { name: "Grupo" })).toHaveTextContent("SUPORTE TÉCNICO (sem universo classificado)")
    fireEvent.click(screen.getByRole("combobox", { name: "Grupo" }))
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Grandes Contas", "SUPORTE TÉCNICO (sem universo classificado)"])
  })

  it("Subgrupo salvo de outro universo aparece no Grupo dele, marcado com o universo", () => {
    render(<OrgScopeSelect teams={teams} universe="B2B" value={{ scopeType: "SUBTEAM", teamId: "t-b2c", subteamId: "s-b2c" }} onChange={() => {}} />)
    expect(screen.getByRole("combobox", { name: "Grupo" })).toHaveTextContent("Varejo (de outro universo: B2C)")
    expect(screen.getByRole("combobox", { name: "Subgrupo" })).toHaveTextContent("Turno A (de outro universo: B2C)")
  })
})
