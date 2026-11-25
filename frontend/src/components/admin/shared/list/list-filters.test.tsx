/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { chooseUnit, closeUnitField, openUnitField, scopeUnitsServiceFrom } from "@/components/admin/shared/testing/scope-units-fake"
import type { OrgScopeFilter } from "@/lib/admin/list-query"
import type { UniverseFilterValue } from "@/lib/operating-universe/hierarchy"

const TEAMS = vi.hoisted(() => [
  { id: "t-b2c", name: "Varejo", operatingUniverse: "B2C", subteams: [
    { id: "s-b2c", name: "Turno A", operatingUniverse: "B2C" },
    { id: "s-b2b", name: "Empresas", operatingUniverse: "B2B" },
  ] },
  { id: "t-b2b", name: "Grandes Contas", operatingUniverse: "B2B", subteams: [] },
])
vi.mock("@/services/scope-units/scope-units-service", () => scopeUnitsServiceFrom(TEAMS))

import { ActiveFilterChips, ListToolbar, ListUniverseFilter, universeChoiceOf } from "./list-filters"
import { ListOrgScopeFilter, useOrgScopeAfterUniverse } from "./org-scope-filter"

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

// O mesmo encadeamento que as listas fazem: universo em cima, Grupo/Subgrupo embaixo.
function Filters({ initialScope = {}, withinTeamIds = null }: { initialScope?: OrgScopeFilter; withinTeamIds?: ReadonlySet<string> | null }) {
  const [universe, setUniverse] = useState<UniverseFilterValue | undefined>()
  const [scope, setScope] = useState<OrgScopeFilter>(initialScope)
  const afterUniverse = useOrgScopeAfterUniverse("agents.manage", scope)
  return (
    <>
      <ListUniverseFilter
        value={universe}
        onChange={(next) => {
          setUniverse(next)
          setScope(afterUniverse(universeChoiceOf(next)))
        }}
      />
      <ListOrgScopeFilter permission="agents.manage" universe={universeChoiceOf(universe)} value={scope} onChange={setScope} withinTeamIds={withinTeamIds} />
      <output data-testid="scope">{JSON.stringify(scope)}</output>
    </>
  )
}

const renderFilters = (props: Parameters<typeof Filters>[0] = {}) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Filters {...props} /></QueryClientProvider>)

function chooseUniverse(optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por universo de atuação" }))
  fireEvent.click(screen.getByRole("option", { name: optionName }))
}
const FIXED = ["Somente globais (todos os grupos)"]
const offered = async () => {
  const names = await openUnitField("Filtrar por grupo")
  closeUnitField()
  return names
}

describe("ListUniverseFilter → ListOrgScopeFilter", () => {
  it("sem universo, oferece todos os Grupos numa aba e os Subgrupos (com o Grupo de origem) na outra", async () => {
    renderFilters()
    expect(await openUnitField("Filtrar por grupo")).toEqual([...FIXED, "Varejo (grupo inteiro)", "Grandes Contas (grupo inteiro)"])
    fireEvent.click(screen.getByRole("radio", { name: "Subgrupos" }))
    expect(await screen.findByRole("option", { name: "Varejo › Turno A" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Varejo › Empresas" })).toBeInTheDocument()
  })

  it("um Subgrupo escolhido aparece com o Grupo de origem, no filtro e no selo", async () => {
    renderFilters()
    await chooseUnit("Filtrar por grupo", "Varejo › Empresas", "Subgrupos")
    expect(screen.getByTestId("scope")).toHaveTextContent(JSON.stringify({ subteamId: ["s-b2b"] }))
    expect(screen.getByRole("button", { name: "Filtrar por grupo: Varejo › Empresas" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Remover filtro Subgrupo: Varejo › Empresas" })).toBeInTheDocument()
  })

  it("vários Grupos e Subgrupos: o seletor fica aberto, os escolhidos abrem no topo e cada selo sai sozinho", async () => {
    renderFilters()
    await openUnitField("Filtrar por grupo")
    fireEvent.click(screen.getByRole("option", { name: "Grandes Contas (grupo inteiro)" }))
    expect(screen.getByRole("option", { name: "Grandes Contas (grupo inteiro)" })).toHaveAttribute("aria-selected", "true")
    fireEvent.click(screen.getByRole("radio", { name: /^Subgrupos/ }))
    fireEvent.click(await screen.findByRole("option", { name: "Varejo › Turno A" }))
    fireEvent.click(screen.getByRole("option", { name: "Varejo › Empresas" }))
    expect(screen.getByTestId("scope")).toHaveTextContent(JSON.stringify({ teamId: ["t-b2b"], subteamId: ["s-b2c", "s-b2b"] }))
    expect(screen.getByText("1 grupo e 2 subgrupos no filtro")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }))
    expect(screen.getByRole("button", { name: "Filtrar por grupo: 1 grupo e 2 subgrupos" })).toBeInTheDocument()
    // Reaberto, o já escolhido vem primeiro (sem repetir).
    fireEvent.click(screen.getByRole("button", { name: /^Filtrar por grupo:/ }))
    fireEvent.click(screen.getByRole("radio", { name: /^Grupos/ }))
    await screen.findByRole("option", { name: "Varejo (grupo inteiro)" })
    expect(screen.getAllByRole("option").map((option) => option.getAttribute("aria-label"))).toEqual([...FIXED, "Grandes Contas (grupo inteiro)", "Varejo (grupo inteiro)"])
    closeUnitField()
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Subgrupo: Varejo › Turno A" }))
    expect(screen.getByTestId("scope")).toHaveTextContent(JSON.stringify({ teamId: ["t-b2b"], subteamId: ["s-b2b"] }))
  })

  it("marcar o Grupo inteiro tira os Subgrupos dele, e marcar um Subgrupo tira o Grupo inteiro: a escolha nunca fica ambígua", async () => {
    renderFilters()
    await chooseUnit("Filtrar por grupo", "Varejo › Empresas", "Subgrupos")
    await chooseUnit("Filtrar por grupo", "Varejo (grupo inteiro)", "Grupos")
    expect(screen.getByTestId("scope")).toHaveTextContent(JSON.stringify({ teamId: ["t-b2c"] }))
    await chooseUnit("Filtrar por grupo", "Varejo › Turno A", "Subgrupos")
    expect(screen.getByTestId("scope")).toHaveTextContent(JSON.stringify({ subteamId: ["s-b2c"] }))
  })

  it("Limpar no rodapé volta para qualquer grupo; \"Somente globais\" substitui a escolha", async () => {
    renderFilters()
    await chooseUnit("Filtrar por grupo", "Varejo (grupo inteiro)")
    await openUnitField("Filtrar por grupo")
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }))
    expect(screen.getByTestId("scope")).toHaveTextContent("{}")
    closeUnitField()
    await chooseUnit("Filtrar por grupo", "Varejo (grupo inteiro)")
    await chooseUnit("Filtrar por grupo", "Somente globais (todos os grupos)")
    expect(screen.getByTestId("scope")).toHaveTextContent(JSON.stringify({ scopeType: "ALL_TEAMS" }))
  })

  it("escolhido B2B, o Grupo B2C que só tem um Subgrupo B2B aparece indisponível (grupo inteiro nunca)", async () => {
    renderFilters()
    chooseUniverse("B2B")
    await openUnitField("Filtrar por grupo")
    expect(screen.getByRole("option", { name: "Varejo (grupo inteiro)" })).toHaveAttribute("aria-disabled", "true")
    fireEvent.click(screen.getByRole("option", { name: "Varejo (grupo inteiro)" }))
    expect(screen.getByTestId("scope")).toHaveTextContent("{}")
    fireEvent.click(screen.getByRole("radio", { name: "Subgrupos" }))
    expect(await screen.findByRole("option", { name: "Varejo › Empresas" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Varejo › Turno A" })).not.toBeInTheDocument()
  })

  it("pendente não restringe os Grupos", async () => {
    renderFilters()
    chooseUniverse("Pendente (sem universo)")
    expect(await offered()).toEqual([...FIXED, "Varejo (grupo inteiro)", "Grandes Contas (grupo inteiro)"])
  })

  it("trocar o universo limpa o Grupo que deixou de caber", async () => {
    renderFilters({ initialScope: { teamId: ["t-b2c"] } })
    expect(await screen.findByRole("button", { name: "Filtrar por grupo: Varejo" })).toBeInTheDocument()
    chooseUniverse("B2B")
    expect(screen.getByRole("button", { name: "Filtrar por grupo: Qualquer grupo" })).toBeInTheDocument()
  })

  it("trocar o universo mantém \"Somente globais\", a escolha que cabe e o Grupo de outro universo com Subgrupo escolhido dele", async () => {
    renderFilters({ initialScope: { scopeType: "ALL_TEAMS" } })
    chooseUniverse("B2B")
    expect(screen.getByTestId("scope")).toHaveTextContent(JSON.stringify({ scopeType: "ALL_TEAMS" }))
    cleanup()
    renderFilters({ initialScope: { teamId: ["t-b2c", "t-b2b"], subteamId: ["s-b2b"] } })
    await screen.findByRole("button", { name: /Remover filtro Grupo: Varejo/ })
    await screen.findByRole("button", { name: /Remover filtro Subgrupo: Varejo › Empresas/ })
    chooseUniverse("B2B")
    expect(screen.getByTestId("scope")).toHaveTextContent(JSON.stringify({ teamId: ["t-b2c", "t-b2b"], subteamId: ["s-b2b"] }))
  })

  it("recorte por Grupos (ex.: os do agente): só eles aparecem", async () => {
    renderFilters({ withinTeamIds: new Set(["t-b2b"]) })
    expect(await offered()).toEqual([...FIXED, "Grandes Contas (grupo inteiro)"])
  })
})

describe("ListToolbar — filtros ativos", () => {
  it("cada filtro em vigor tem um selo com o próprio x", async () => {
    const onClear = vi.fn()
    render(<ListToolbar search={<p />} hasActiveFilters onClearFilters={() => {}} activeFilters={[{ key: "team", label: "Grupo: Varejo", onClear }]} />)
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Grupo: Varejo" }))
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1))
  })

  it("tirar um selo leva o foco ao próximo; no último, ao controle que vem antes", () => {
    function Chips() {
      const [names, setNames] = useState(["Varejo", "Vendas"])
      return (
        <div>
          <button type="button">Filtro</button>
          <ActiveFilterChips label="Filtros" filters={names.map((name) => ({ key: name, label: name, onClear: () => setNames((current) => current.filter((entry) => entry !== name)) }))} />
        </div>
      )
    }
    render(<Chips />)
    const remove = (name: string) => {
      const button = screen.getByRole("button", { name: `Remover filtro ${name}` })
      button.focus()
      fireEvent.click(button)
    }
    remove("Varejo")
    expect(screen.getByRole("button", { name: "Remover filtro Vendas" })).toHaveFocus()
    remove("Vendas")
    expect(screen.getByRole("button", { name: "Filtro" })).toHaveFocus()
  })
})
