/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { scopeUnitsServiceFrom } from "@/components/admin/shared/testing/scope-units-fake"

const TEAMS = vi.hoisted(() => [
  { id: "t-b2b", name: "Retenção B2B", operatingUniverse: "B2B", subteams: [{ id: "s-b2b", name: "Carteira", operatingUniverse: "B2B" }] },
  { id: "t-b2c", name: "Suporte B2C", operatingUniverse: "B2C", subteams: [{ id: "s-mix", name: "Empresas", operatingUniverse: "B2B" }] },
])
vi.mock("@/services/scope-units/scope-units-service", () => scopeUnitsServiceFrom(TEAMS))

import { PolicyScopeField } from "./policy-scope-field"

beforeAll(installJsdomStubs)
afterEach(cleanup)

describe("Escopo da política: universo → Grupo → Subgrupo", () => {
  it("parte do universo do Subgrupo já escolhido (vale o efetivo dele, mesmo que o Grupo seja de outro)", async () => {
    renderWithQuery(<PolicyScopeField value={{ scopeType: "SUBTEAM", teamId: "t-b2c", subteamId: "s-mix" }} onChange={vi.fn()} allowAllTeams />)
    await waitFor(() => expect(screen.getByLabelText("Universo de atuação")).toHaveTextContent("B2B"))
    expect(await screen.findByRole("button", { name: "Subgrupo: Empresas" })).toBeInTheDocument()
  })

  it("mostra o universo antes do alcance, já no universo do Grupo salvo", async () => {
    renderWithQuery(<PolicyScopeField value={{ scopeType: "TEAM", teamId: "t-b2b" }} onChange={vi.fn()} allowAllTeams />)
    const universe = screen.getByLabelText("Universo de atuação")
    const scope = screen.getByLabelText("Alcance por grupo")
    await waitFor(() => expect(universe).toHaveTextContent("B2B"))
    expect(universe.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole("button", { name: "Grupo: Retenção B2B" })).toBeInTheDocument()
  })

  it("\"toda a organização\" não parte de universo; Grupo B2C parte de B2C", async () => {
    const { unmount } = renderWithQuery(<PolicyScopeField value={{ scopeType: "ALL_TEAMS" }} onChange={vi.fn()} allowAllTeams />)
    expect(screen.getByLabelText("Universo de atuação")).not.toHaveTextContent(/B2[BCX]/)
    unmount()
    renderWithQuery(<PolicyScopeField value={{ scopeType: "TEAM", teamId: "t-b2c" }} onChange={vi.fn()} allowAllTeams />)
    await waitFor(() => expect(screen.getByLabelText("Universo de atuação")).toHaveTextContent("B2C"))
  })
})
