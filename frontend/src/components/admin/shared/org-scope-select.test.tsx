/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { chooseUnit, closeUnitField, openUnitField, scopeUnitsServiceFrom } from "@/components/admin/shared/testing/scope-units-fake"

const TEAMS = vi.hoisted(() => [
  { id: "t-b2c", name: "Varejo", operatingUniverse: "B2C", subteams: [
    { id: "s-b2c", name: "Turno A", operatingUniverse: "B2C" },
    { id: "s-b2b", name: "Empresas no Varejo", operatingUniverse: "B2B" },
  ] },
  { id: "t-b2b", name: "Grandes Contas", operatingUniverse: "B2B", subteams: [{ id: "s-misto", name: "Pessoas físicas", operatingUniverse: "B2C" }] },
  { id: "t-pend", name: "Suporte técnico", operatingUniverse: null, subteams: [] },
])
vi.mock("@/services/scope-units/scope-units-service", () => scopeUnitsServiceFrom(TEAMS, ["t-b2b"]))

import { OrgScopeSelect, useOrgScopeUnits, type OrgScopeValue } from "./org-scope-select"

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

function Field({ initial, universe, allowAllTeams }: { initial: OrgScopeValue; universe?: "B2B" | "B2C"; allowAllTeams?: boolean }) {
  const [value, setValue] = useState(initial)
  const units = useOrgScopeUnits("configuration.manage", value)
  return (
    <>
      <OrgScopeSelect permission="configuration.manage" value={value} onChange={setValue} universe={universe} allowAllTeams={allowAllTeams} />
      <button type="button" onClick={() => setValue(units.afterUniverse("B2B"))}>Trocar para B2B</button>
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  )
}
const renderField = (props: Parameters<typeof Field>[0]) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Field {...props} /></QueryClientProvider>)

// Escopo Administrativo (Parte 10/11 do pedido): um admin restrito nunca deve ver "Todos os
// grupos" — a única forma de "esconder a opção pra quem é restrito" (escolha explícita do
// usuário, ver plano) é este item nunca aparecer no menu, não só ficar desabilitado.
describe("OrgScopeSelect com allowAllTeams=false", () => {
  it("nunca renderiza a opção 'Todos os grupos' no menu de Alcance por grupo", () => {
    renderField({ initial: { scopeType: "TEAM", teamId: "t-b2c" }, allowAllTeams: false })
    fireEvent.click(screen.getByRole("combobox", { name: "Alcance por grupo" }))
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Um grupo específico", "Um subgrupo específico"])
  })
})

describe("OrgScopeSelect com universo", () => {
  it("Grupo específico: só os Grupos inteiros do universo, com ou sem gente em produção (o sem universo some)", async () => {
    renderField({ initial: { scopeType: "TEAM" }, universe: "B2B" })
    expect(await openUnitField("Grupo")).toEqual(["Grandes Contas"])
  })

  it("Subgrupo específico: buscável sem escolher o Grupo, que passa a ser o de origem", async () => {
    renderField({ initial: { scopeType: "SUBTEAM" }, universe: "B2B" })
    expect(await openUnitField("Subgrupo")).toEqual(["Varejo › Empresas no Varejo"])
    closeUnitField()
    await chooseUnit("Subgrupo", "Varejo › Empresas no Varejo")
    expect(screen.getByTestId("value")).toHaveTextContent(JSON.stringify({ scopeType: "SUBTEAM", teamId: "t-b2c", subteamId: "s-b2b" }))
    expect(await screen.findByRole("button", { name: "Grupo: Varejo" })).toBeInTheDocument()
  })

  it("trocar o universo limpa o alcance que deixou de caber", async () => {
    renderField({ initial: { scopeType: "SUBTEAM", teamId: "t-b2c", subteamId: "s-b2c" } })
    await screen.findByRole("button", { name: "Subgrupo: Turno A" })
    fireEvent.click(screen.getByRole("button", { name: "Trocar para B2B" }))
    expect(screen.getByTestId("value")).toHaveTextContent(JSON.stringify({ scopeType: "SUBTEAM" }))
  })

  it("trocar o universo: o Grupo que não cabe sai, o que cabe fica e \"Todos os grupos\" não muda", async () => {
    const after = async (initial: OrgScopeValue, label?: string) => {
      renderField({ initial })
      if (label) await screen.findByRole("button", { name: label })
      fireEvent.click(screen.getByRole("button", { name: "Trocar para B2B" }))
      const value = JSON.parse(screen.getByTestId("value").textContent!) as OrgScopeValue
      cleanup()
      return value
    }
    expect(await after({ scopeType: "TEAM", teamId: "t-b2c" }, "Grupo: Varejo")).toEqual({ scopeType: "TEAM" })
    expect(await after({ scopeType: "TEAM", teamId: "t-b2b" }, "Grupo: Grandes Contas")).toEqual({ scopeType: "TEAM", teamId: "t-b2b" })
    expect(await after({ scopeType: "ALL_TEAMS" })).toEqual({ scopeType: "ALL_TEAMS" })
    // Subgrupo que não cabe num Grupo que cabe: fica o Grupo, a pessoa só troca o Subgrupo.
    expect(await after({ scopeType: "SUBTEAM", teamId: "t-b2b", subteamId: "s-misto" }, "Subgrupo: Pessoas físicas")).toEqual({ scopeType: "SUBTEAM", teamId: "t-b2b" })
  })
})

describe("OrgScopeSelect — rótulos associados aos campos", () => {
  it("cada rótulo visível encontra o seu campo", async () => {
    renderField({ initial: { scopeType: "SUBTEAM", teamId: "t-b2c", subteamId: "s-b2c" } })
    await screen.findByRole("button", { name: "Subgrupo: Turno A" })
    const fieldOf = (text: string) => document.getElementById(screen.getAllByText(text, { selector: "label" })[0]!.getAttribute("for")!)
    expect(fieldOf("Alcance por grupo")).toBe(screen.getByRole("combobox", { name: "Alcance por grupo" }))
    expect(fieldOf("Grupo")).toBe(screen.getByRole("button", { name: "Grupo: Varejo" }))
    expect(fieldOf("Subgrupo")).toBe(screen.getByRole("button", { name: "Subgrupo: Turno A" }))
  })
})

// QA de 17/11: Workflow B2B salvo num Grupo ainda sem universo abria com o campo Grupo em branco. O salvo continua visível e marcado.
describe("OrgScopeSelect — valor salvo fora do universo ou do lote carregado", () => {
  it("Grupo salvo sem universo aparece selecionado e marcado; não vira opção", async () => {
    renderField({ initial: { scopeType: "TEAM", teamId: "t-pend" }, universe: "B2B" })
    expect(await screen.findByRole("button", { name: "Grupo: Suporte técnico" })).toBeInTheDocument()
    expect(screen.getByText("Sem universo classificado")).toBeInTheDocument()
    expect(await openUnitField("Grupo")).toEqual(["Grandes Contas"])
  })

  it("Subgrupo salvo de outro universo aparece no Grupo dele, marcado com o universo", async () => {
    renderField({ initial: { scopeType: "SUBTEAM", teamId: "t-b2c", subteamId: "s-b2c" }, universe: "B2B" })
    await waitFor(() => expect(screen.getByRole("button", { name: "Subgrupo: Turno A" })).toBeInTheDocument())
    expect(screen.getAllByText("De outro universo: B2C")).toHaveLength(2)
  })
})
