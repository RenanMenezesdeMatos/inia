/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { useState } from "react"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { useKnownKnowledgeOptions } from "@/queries/admin/use-agent-knowledge-options-queries"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

import { KnowledgeBasePicker } from "./knowledge-base-picker"
import { createFakeKnowledgeOptions, option } from "./knowledge-base-picker/testing/fake-knowledge-options"
import { agentKnowledgeScopeOf, matchesLocalSearch, optionProblems } from "./knowledge-base-picker/picker-rules"

const TEAM_A = { scopeType: "TEAM" as const, teamId: "team-a", teamName: "Grupo A", subteamId: null, subteamName: null }
const TEAM_B = { scopeType: "TEAM" as const, teamId: "team-b", teamName: "Grupo B", subteamId: null, subteamName: null }
// 45 bases do Grupo A (para paginar) + casos especiais.
const MANY = Array.from({ length: 45 }, (_, index) => option(`kb-${String(index).padStart(2, "0")}`, `Procedimento ${String(index).padStart(2, "0")}`, { orgScopes: [TEAM_A] }))
const SPECIAL = [
  option("kb-portab", "Portabilidade numérica", { subjects: ["Portabilidade"], products: ["Móvel › Pós-pago"] }),
  option("kb-b2b", "Base Empresas", { operatingUniverse: "B2B" }),
  option("kb-arch", "Base arquivada", { state: "ARCHIVED", inUseVersion: null, orgScopes: [TEAM_A] }),
  option("kb-other-group", "Base do Grupo B", { orgScopes: [TEAM_B] }),
]
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeKnowledgeOptions> | null }))
vi.mock("@/services/admin/agent-knowledge-options-service", () => ({
  searchKnowledgeOptions: (filter: never) => fake.current!.searchKnowledgeOptions(filter),
  fetchKnowledgeOptionIds: (filter: never) => fake.current!.fetchKnowledgeOptionIds(filter),
  fetchGroupDefaultKnowledgeIds: (scope: never) => fake.current!.fetchGroupDefaultKnowledgeIds(scope),
  lookupKnowledgeOptions: (ids: string[]) => fake.current!.lookupKnowledgeOptions(ids),
  fetchKnowledgeOptionFacets: () => fake.current!.fetchKnowledgeOptionFacets(),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

beforeAll(() => installJsdomStubs())
afterEach(cleanup)

function Harness({ initial, universe = "B2C", scope = { scopeType: "TEAM", teamId: "team-a" }, onIds }: { initial: string[]; universe?: OperatingUniverse | null; scope?: OrgScopeValue; onIds?: (ids: string[]) => void }) {
  const [ids, setIds] = useState(initial)
  const known = useKnownKnowledgeOptions(ids)
  return (
    <>
      {/* Mudança por fora, como a pré-seleção do Grupo no formulário. */}
      <button type="button" onClick={() => setIds(["kb-00", "kb-01"])}>
        Pré-selecionar por fora
      </button>
      <KnowledgeBasePicker
      selectedIds={ids}
      onChange={(next) => {
        setIds(next)
        onIds?.(next)
      }}
      universe={universe}
      orgScope={scope}
      teams={[{ id: "team-a", name: "Grupo A", operationId: "op", subteams: [] }] as never}
      known={known}
      fallbackTitles={new Map()}
      />
    </>
  )
}

function setup(initial: string[] = [], props: Partial<Parameters<typeof Harness>[0]> = {}) {
  fake.current = createFakeKnowledgeOptions([...MANY, ...SPECIAL])
  const onIds = vi.fn()
  renderWithQuery(<Harness initial={initial} onIds={onIds} {...props} />)
  return onIds
}

async function openAvailable() {
  fireEvent.mouseDown(screen.getByRole("tab", { name: /Disponíveis/ }))
  fireEvent.click(screen.getByRole("tab", { name: /Disponíveis/ }))
  return screen.findByRole("list", { name: "Bases disponíveis" })
}

describe("regras do seletor de bases", () => {
  it("alcance do formulário vira o do servidor; Grupo ainda não escolhido não restringe", () => {
    expect(agentKnowledgeScopeOf({ scopeType: "ALL_TEAMS" })).toEqual({ scopeType: "ALL_TEAMS" })
    expect(agentKnowledgeScopeOf({ scopeType: "TEAM" })).toBeUndefined()
    expect(agentKnowledgeScopeOf({ scopeType: "SUBTEAM", teamId: "t", subteamId: "s" })).toEqual({ scopeType: "SUBTEAM", teamId: "t", subteamId: "s" })
  })

  it("aponta o que impede salvar: outro universo e outro Grupo; pendente e global cabem", () => {
    const scope = { scopeType: "TEAM" as const, teamId: "team-a" }
    expect(optionProblems(SPECIAL[1]!, "B2C", scope, undefined)).toEqual(["OTHER_UNIVERSE"])
    expect(optionProblems(SPECIAL[3]!, "B2C", scope, undefined)).toEqual(["OTHER_GROUP"])
    expect(optionProblems(option("p", "Pendente", { operatingUniverse: null }), "B2C", scope, undefined)).toEqual([])
    expect(optionProblems(SPECIAL[3]!, "B2C", { scopeType: "ALL_TEAMS" }, undefined)).toEqual([])
  })

  it("busca local nas ligadas por título, assunto e produto, sem acento", () => {
    expect(matchesLocalSearch(SPECIAL[0]!, "portabilidade numerica")).toBe(true)
    expect(matchesLocalSearch(SPECIAL[0]!, "pos-pago")).toBe(true)
    expect(matchesLocalSearch(SPECIAL[0]!, "fibra")).toBe(false)
  })
})

describe("seletor de bases do agente", () => {
  it("mostra o total ligado e, em Ligadas, a arquivada e a de outro universo continuam marcadas com o selo", async () => {
    setup(["kb-arch", "kb-b2b", "kb-00"])
    expect(screen.getByTestId("agent-knowledge-count")).toHaveTextContent("3")
    const list = await screen.findByRole("list", { name: "Bases ligadas" })
    await waitFor(() => expect(within(list).getAllByRole("checkbox")).toHaveLength(3))
    for (const box of within(list).getAllByRole("checkbox")) expect(box).toBeChecked()
    expect(within(list).getByText("Arquivada")).toBeInTheDocument()
    expect(within(list).getByText("De outro universo")).toBeInTheDocument()
    expect(screen.getByText(/1 impede salvar/)).toBeInTheDocument()
  })

  it("Disponíveis: só o que o agente pode salvar (universo e Grupo), sem as já ligadas, paginado no servidor", async () => {
    setup(["kb-00"])
    const list = await openAvailable()
    expect(within(list).queryByText("Base Empresas")).toBeNull()
    expect(within(list).queryByText("Base do Grupo B")).toBeNull()
    expect(within(list).queryByText("Procedimento 00")).toBeNull()
    expect(within(list).getAllByRole("checkbox")).toHaveLength(20)
    // 45 do Grupo A + portabilidade + arquivada - a ligada = 46.
    expect(screen.getByText(/46 bases disponíveis/)).toBeInTheDocument()
    expect(fake.current!.calls.search.at(-1)).toMatchObject({ agentUniverse: "B2C", agentScope: { scopeType: "TEAM", teamId: "team-a" }, excludeIds: ["kb-00"] })
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }))
    await waitFor(() => expect(fake.current!.calls.search.at(-1)?.cursor).toBe("20"))
  })

  it("escolha mudada por fora (pré-seleção do Grupo) refaz Disponíveis sem as que entraram", async () => {
    setup()
    let list = await openAvailable()
    await waitFor(() => expect(within(list).getByRole("checkbox", { name: /Procedimento 00/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Pré-selecionar por fora" }))
    await waitFor(() => expect(fake.current!.calls.search.at(-1)?.excludeIds).toEqual(["kb-00", "kb-01"]))
    list = await screen.findByRole("list", { name: "Bases disponíveis" })
    await waitFor(() => expect(within(list).queryByRole("checkbox", { name: /Procedimento 00/ })).toBeNull())
    expect(screen.getByTestId("agent-knowledge-count")).toHaveTextContent("2")
  })

  it("busca por assunto/produto no servidor e marcar liga sem tirar a linha da lista", async () => {
    const onIds = setup()
    await openAvailable()
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar bases disponíveis" }), { target: { value: "pos-pago" } })
    const row = await screen.findByRole("checkbox", { name: /Portabilidade numérica/ })
    fireEvent.click(row)
    expect(onIds).toHaveBeenLastCalledWith(["kb-portab"])
    expect(screen.getByRole("checkbox", { name: /Portabilidade numérica/ })).toBeChecked()
    expect(screen.getByTestId("agent-knowledge-count")).toHaveTextContent("1")
  })

  it("“Ligar as filtradas” pede confirmação com a quantidade e liga o filtro inteiro, não só a página", async () => {
    const onIds = setup()
    await openAvailable()
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar bases disponíveis" }), { target: { value: "procedimento" } })
    const button = await screen.findByRole("button", { name: "Ligar as 45 filtradas" })
    fireEvent.click(button)
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/não só as desta página/)).toBeInTheDocument()
    expect(onIds).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Ligar as filtradas" }))
    })
    await waitFor(() => expect(onIds).toHaveBeenLastCalledWith(expect.arrayContaining(["kb-00", "kb-44"])))
    expect(onIds.mock.lastCall![0]).toHaveLength(45)
  })

  it("sem filtro, o botão diz que liga TODAS e o aviso recomenda filtrar", async () => {
    setup()
    await openAvailable()
    fireEvent.click(await screen.findByRole("button", { name: "Ligar todas as 47" }))
    expect(await screen.findByText(/Nenhum filtro está aplicado/)).toBeInTheDocument()
  })

  it("Ligadas: desmarcar desliga; “Desligar as listadas” só tira as da busca, com confirmação", async () => {
    const onIds = setup(["kb-00", "kb-01", "kb-portab"])
    const list = await screen.findByRole("list", { name: "Bases ligadas" })
    await waitFor(() => expect(within(list).getByRole("checkbox", { name: /Procedimento 01/ })).toBeInTheDocument())
    fireEvent.click(within(list).getByRole("checkbox", { name: /Procedimento 01/ }))
    expect(onIds).toHaveBeenLastCalledWith(["kb-00", "kb-portab"])
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar nas bases ligadas" }), { target: { value: "procedimento" } })
    fireEvent.click(screen.getByRole("button", { name: "Desligar as 1 listadas" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/As outras 1 continuam ligadas/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Desligar" }))
    expect(onIds).toHaveBeenLastCalledWith(["kb-portab"])
  })
})
