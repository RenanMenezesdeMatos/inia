/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import type { Team } from "@/schemas/admin/org-structure.schema"

import { PolicyScopeField, universeOfScope } from "./policy-scope-field"

const TEAMS: Team[] = [
  { id: "t-b2b", name: "Retenção B2B", operationId: "op", operatingUniverse: "B2B", subteams: [{ id: "s-b2b", teamId: "t-b2b", name: "Carteira", operatingUniverse: "B2B" }] },
  { id: "t-b2c", name: "Suporte B2C", operationId: "op", operatingUniverse: "B2C", subteams: [{ id: "s-mix", teamId: "t-b2c", name: "Empresas", operatingUniverse: "B2B" }] },
]

beforeAll(installJsdomStubs)
afterEach(cleanup)

describe("Escopo da política: universo → Grupo → Subgrupo", () => {
  it("parte do universo do Grupo ou do Subgrupo já escolhido (o Subgrupo vale o efetivo dele)", () => {
    expect(universeOfScope(TEAMS, { scopeType: "ALL_TEAMS" })).toBeNull()
    expect(universeOfScope(TEAMS, { scopeType: "TEAM", teamId: "t-b2c" })).toBe("B2C")
    expect(universeOfScope(TEAMS, { scopeType: "SUBTEAM", teamId: "t-b2c", subteamId: "s-mix" })).toBe("B2B")
  })

  it("mostra o universo antes do alcance, já no universo do Grupo salvo", () => {
    render(<PolicyScopeField teams={TEAMS} value={{ scopeType: "TEAM", teamId: "t-b2b" }} onChange={vi.fn()} allowAllTeams />)
    const universe = screen.getByLabelText("Universo de atuação")
    const scope = screen.getByLabelText("Alcance por grupo")
    expect(universe).toHaveTextContent("B2B")
    expect(universe.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText("Retenção B2B")).toBeInTheDocument()
  })
})
