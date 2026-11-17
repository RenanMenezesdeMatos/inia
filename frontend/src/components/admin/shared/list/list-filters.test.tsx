/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { ListOrgScopeFilter, ListUniverseFilter, universeChoiceOf } from "./list-filters"
import type { OrgScopeFilter } from "@/lib/admin/list-query"
import { orgScopeAfterUniverseChange, type UniverseFilterValue } from "@/lib/operating-universe/hierarchy"
import type { Team } from "@/schemas/admin/org-structure.schema"

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

const TEAMS: Team[] = [
  { id: "t-b2c", name: "Varejo", operationId: "op", operatingUniverse: "B2C", subteams: [
    { id: "s-b2c", teamId: "t-b2c", name: "Turno A", operatingUniverse: "B2C" },
    { id: "s-b2b", teamId: "t-b2c", name: "Empresas", operatingUniverse: "B2B" },
  ] },
  { id: "t-b2b", name: "Grandes Contas", operationId: "op", operatingUniverse: "B2B", subteams: [] },
]

// O mesmo encadeamento que as listas fazem: universo em cima, Grupo/Subgrupo embaixo.
function Filters({ initialScope = {} }: { initialScope?: OrgScopeFilter }) {
  const [universe, setUniverse] = useState<UniverseFilterValue | undefined>()
  const [scope, setScope] = useState<OrgScopeFilter>(initialScope)
  return (
    <>
      <ListUniverseFilter
        value={universe}
        onChange={(next) => {
          setUniverse(next)
          setScope(orgScopeAfterUniverseChange(scope, TEAMS, universeChoiceOf(next)))
        }}
      />
      <ListOrgScopeFilter teams={TEAMS} universe={universeChoiceOf(universe)} value={scope} onChange={setScope} />
    </>
  )
}

function choose(comboboxName: string, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }))
  fireEvent.click(screen.getByRole("option", { name: optionName }))
}

function groupOptions() {
  fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por grupo" }))
  const options = screen.getAllByRole("option").map((option) => option.textContent)
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
  return options
}

describe("ListUniverseFilter → ListOrgScopeFilter", () => {
  it("sem universo, oferece todos os Grupos e Subgrupos", () => {
    render(<Filters />)
    expect(groupOptions()).toEqual(["Qualquer grupo", "Somente globais (todos os grupos)", "Varejo (grupo inteiro)", "Varejo › Turno A", "Varejo › Empresas", "Grandes Contas (grupo inteiro)"])
  })

  it("escolhido B2B, só Grupo/Subgrupo B2B — o Grupo B2C não é selecionável inteiro", () => {
    render(<Filters />)
    choose("Filtrar por universo de atuação", "B2B")
    expect(groupOptions()).toEqual(["Qualquer grupo", "Somente globais (todos os grupos)", "Varejo › Empresas", "Grandes Contas (grupo inteiro)"])
  })

  it("pendente não restringe os Grupos", () => {
    render(<Filters />)
    choose("Filtrar por universo de atuação", "Pendente (sem universo)")
    expect(groupOptions()).toHaveLength(6)
  })

  it("trocar o universo limpa o Grupo que deixou de caber", () => {
    render(<Filters initialScope={{ teamId: "t-b2c" }} />)
    expect(screen.getByRole("combobox", { name: "Filtrar por grupo" })).toHaveTextContent("Varejo (grupo inteiro)")
    choose("Filtrar por universo de atuação", "B2B")
    expect(screen.getByRole("combobox", { name: "Filtrar por grupo" })).toHaveTextContent("Qualquer grupo")
  })
})
