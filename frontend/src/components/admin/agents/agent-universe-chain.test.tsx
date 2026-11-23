/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { offeredScopeUnits, pickScopeUnit } from "@/components/admin/shared/testing/scope-units-fake"

import { NewAgentPage } from "./agent-detail-page"
import { createFakeKnowledgeOptions, option } from "./knowledge-base-picker/testing/fake-knowledge-options"

/**
 * Hierarquia universo → Grupo → bases/domínio no cadastro de agente: escolhido o universo, só se oferecem Grupos, bases e domínios dele
 * (ou ainda sem universo); trocar o universo limpa bases e domínio que deixaram de caber e marca (sem tirar) o Grupo de outro universo; escolher o Grupo pré-seleciona as bases dele (servidor).
 * O backend continua recusando (OPERATING_UNIVERSE_LINK_CONFLICT).
 */
vi.mock("@/services/admin/agent-service", () => ({ fetchAgent: vi.fn(), createAgent: vi.fn(), fetchAgents: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof import("./knowledge-base-picker/testing/fake-knowledge-options").createFakeKnowledgeOptions> | null }))
vi.mock("@/services/admin/agent-knowledge-options-service", () => ({
  searchKnowledgeOptions: (filter: never) => fake.current!.searchKnowledgeOptions(filter),
  fetchKnowledgeOptionIds: (filter: never) => fake.current!.fetchKnowledgeOptionIds(filter),
  fetchGroupDefaultKnowledgeIds: (scope: never) => fake.current!.fetchGroupDefaultKnowledgeIds(scope),
  lookupKnowledgeOptions: (ids: string[]) => fake.current!.lookupKnowledgeOptions(ids),
  fetchKnowledgeOptionFacets: () => fake.current!.fetchKnowledgeOptionFacets(),
}))

// Resultados estáveis entre renderizações, como os do React Query.
const lookups = vi.hoisted(() => ({
  teams: {
    data: {
      unrestricted: true,
      teams: [
        { id: "team-b2b", name: "Grandes Contas", operationId: "op", operatingUniverse: "B2B", subteams: [] },
        { id: "team-b2c", name: "Varejo", operationId: "op", operatingUniverse: "B2C", subteams: [] },
      ],
    },
  },
  domains: { data: [], isPending: false },
}))
vi.mock("@/queries/admin/use-org-structure-queries", () => ({ useManageableTeamsQuery: () => lookups.teams }))
// Opções do campo de alcance vêm do servidor (`/admin/scope-units`): o falso aplica universo, busca e elegibilidade sobre a estrutura acima.
vi.mock("@/services/scope-units/scope-units-service", async () => (await import("@/components/admin/shared/testing/scope-units-fake")).scopeUnitsServiceFrom(lookups.teams.data.teams))
vi.mock("@/queries/admin/use-business-domain-queries", () => ({ useBusinessDomainsQuery: () => lookups.domains }))

const DOCS = [option("kb-b2b", "Base Empresas", { operatingUniverse: "B2B" }), option("kb-b2c", "Base Consumidor", { operatingUniverse: "B2C" }), option("kb-pending", "Base Pendente", { operatingUniverse: null })]

beforeAll(() => installJsdomStubs())
afterEach(cleanup)

async function chooseUniverse(name: RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: "Universo de atuação" }))
  fireEvent.click(await screen.findByRole("option", { name }))
}

function tab(name: RegExp) {
  const element = screen.getByRole("tab", { name })
  fireEvent.mouseDown(element)
  fireEvent.click(element)
}

describe("Agente — universo encadeia Grupo e bases", () => {
  it("escolhido B2B, a base B2C não é oferecida; trocar para B2C tira a base B2B já escolhida", async () => {
    fake.current = createFakeKnowledgeOptions(DOCS)
    renderWithQuery(<NewAgentPage />)
    await chooseUniverse(/^B2B/)
    tab(/Disponíveis/)
    const list = await screen.findByRole("list", { name: "Bases disponíveis" })
    await waitFor(() => expect(within(list).getByRole("checkbox", { name: /Base Empresas/ })).toBeInTheDocument())
    expect(within(list).getByRole("checkbox", { name: /Base Pendente/ })).toBeInTheDocument()
    expect(within(list).queryByRole("checkbox", { name: /Base Consumidor/ })).toBeNull()

    fireEvent.click(within(list).getByRole("checkbox", { name: /Base Empresas/ }))
    expect(screen.getByTestId("agent-knowledge-count")).toHaveTextContent("1")
    await chooseUniverse(/^B2C/)
    expect(screen.getByTestId("agent-knowledge-count")).toHaveTextContent("0")
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Base Consumidor/ })).toBeInTheDocument())
    expect(screen.queryByRole("checkbox", { name: /Base Empresas/ })).toBeNull()
  })

  it("escolher Grupos pré-seleciona as bases deles (pedido ao servidor com todos os vínculos e o universo do agente)", async () => {
    const defaults = vi.fn(() => ["kb-b2c", "kb-pending"])
    fake.current = createFakeKnowledgeOptions(DOCS, defaults)
    renderWithQuery(<NewAgentPage />)
    await chooseUniverse(/^B2C/)
    fireEvent.click(await screen.findByRole("radio", { name: /Grupos e Subgrupos específicos/ }))
    await pickScopeUnit("Varejo")
    await waitFor(() => expect(screen.getByTestId("agent-knowledge-count")).toHaveTextContent("2"))
    expect(defaults).toHaveBeenLastCalledWith({ scopeType: "GROUPS", links: [{ teamId: "team-b2c", subteamId: null }] })
  })

  it("o Grupo de outro universo não é oferecido; trocar o universo NÃO tira o Grupo em silêncio: marca, avisa e trava o salvar (run-10 QA-10)", async () => {
    fake.current = createFakeKnowledgeOptions(DOCS)
    renderWithQuery(<NewAgentPage />)
    await chooseUniverse(/^B2B/)
    fireEvent.click(await screen.findByRole("radio", { name: /Grupos e Subgrupos específicos/ }))
    expect(await offeredScopeUnits()).toEqual(["Grandes Contas"])
    await pickScopeUnit("Grandes Contas")
    expect(await screen.findByTestId("scope-reach-summary")).toHaveTextContent("Grandes Contas")

    await chooseUniverse(/^B2C/)
    expect(await screen.findByText("Fora do universo")).toBeInTheDocument()
    expect(screen.getByTestId("scope-reach-summary")).toHaveTextContent("Grandes Contas")
    expect(screen.getByText(/precisa sair antes de salvar/)).toBeInTheDocument()
    const create = screen.getByRole("button", { name: "Criar agente" })
    expect(create).toBeDisabled()
    fireEvent.focus(create.parentElement!)
    expect((await screen.findAllByText(/Remova do alcance os Grupos\/Subgrupos fora do universo/)).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole("button", { name: "Remover os que não cabem" }))
    await waitFor(() => expect(screen.getByTestId("scope-reach-summary")).not.toHaveTextContent("Grandes Contas"))
    expect(screen.queryByText("Fora do universo")).toBeNull()
    expect(await offeredScopeUnits()).toEqual(["Varejo"])
  })
})
