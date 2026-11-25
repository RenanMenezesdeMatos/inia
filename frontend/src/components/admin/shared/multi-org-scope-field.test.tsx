/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { useState } from "react"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { ScopeLinksValue } from "@/lib/scope-links/scope-links"
import { linksFromScopeValue } from "@/lib/scope-links/scope-links"
import type { ScopeUnitOption } from "@/schemas/scope-units/scope-units.schema"

const service = vi.hoisted(() => ({ fetchScopeUnits: vi.fn(), fetchScopeUnitsByIds: vi.fn() }))
vi.mock("@/services/scope-units/scope-units-service", () => service)

import { MultiOrgScopeField } from "./multi-org-scope-field"

beforeAll(installJsdomStubs)
afterEach(cleanup)

const team = (id: string, name: string, extra: Partial<ScopeUnitOption> = {}): ScopeUnitOption => ({ kind: "TEAM", id, name, teamId: null, teamName: null, operatingUniverse: "B2C", productionOperators: 10, eligible: true, manageable: true, ...extra })
const subteam = (id: string, name: string, teamId: string, teamName: string, extra: Partial<ScopeUnitOption> = {}): ScopeUnitOption => ({ kind: "SUBTEAM", id, name, teamId, teamName, operatingUniverse: "B2C", productionOperators: 4, eligible: true, manageable: true, ...extra })

const A = team("t-a", "Cobrança")
const B = team("t-b", "Retenção")
const OLD = team("t-old", "Atendimento antigo", { productionOperators: 0, eligible: false })
const B1 = subteam("s-b1", "Retenção Premium", "t-b", "Retenção")
const A1 = subteam("s-a1", "Cobrança Tarde", "t-a", "Cobrança")
const ALL_TEAMS_PAGE_1 = Array.from({ length: 30 }, (_, index) => team(`t-${index}`, `Grupo ${String(index).padStart(2, "0")}`))

function Harness({ initial, onValue, allowGlobal = true }: { initial: ScopeLinksValue; onValue?: (value: ScopeLinksValue) => void; allowGlobal?: boolean }) {
  const [value, setValue] = useState(initial)
  return <MultiOrgScopeField permission="agents.manage" universe="B2C" value={value} onChange={(next) => { setValue(next); onValue?.(next) }} allowGlobal={allowGlobal} globalLabel="Todos os Grupos e Subgrupos do universo B2C" />
}

beforeEach(() => {
  service.fetchScopeUnits.mockReset()
  service.fetchScopeUnitsByIds.mockReset()
  service.fetchScopeUnitsByIds.mockImplementation(async (kind: "TEAM" | "SUBTEAM", _permission: string, ids: string[]) => [A, B, OLD, A1, B1].filter((unit) => unit.kind === kind && ids.includes(unit.id)))
  service.fetchScopeUnits.mockImplementation(async (search: { kind: string; search?: string; cursor?: string | null }) => {
    if (search.kind === "SUBTEAM") return { items: [A1, B1].filter((unit) => !search.search || unit.name.toLowerCase().includes(search.search.toLowerCase())), nextCursor: null }
    if (search.search) return { items: [A, B].filter((unit) => unit.name.toLowerCase().includes(search.search!.toLowerCase())), nextCursor: null }
    return search.cursor ? { items: [A, B], nextCursor: null } : { items: ALL_TEAMS_PAGE_1, nextCursor: "page-2" }
  })
})

describe("Campo de alcance — seletor pesquisável de Grupos e Subgrupos", () => {
  it("edição: o salvo sem operador em produção continua marcado e pode ser removido; resumo mostra o alcance", async () => {
    const onValue = vi.fn()
    renderWithQuery(<Harness initial={{ global: false, groups: [{ teamId: "t-old", subteamIds: [], mode: "WHOLE" }, { teamId: "t-b", subteamIds: ["s-b1"], mode: "SUBTEAMS" }] }} onValue={onValue} />)
    const chosen = await screen.findByRole("list", { name: "Escolhidos" })
    expect(await within(chosen).findByText("Atendimento antigo (Grupo inteiro)")).toBeInTheDocument()
    expect(within(chosen).getByText("Sem operadores em produção")).toBeInTheDocument()
    expect(within(chosen).getByText("Retenção › Retenção Premium")).toBeInTheDocument()
    expect(screen.getByTestId("scope-reach-summary")).toHaveTextContent("Atendimento antigo (Grupo inteiro) · Retenção › Retenção Premium")
    fireEvent.click(within(chosen).getByRole("button", { name: "Remover Atendimento antigo (Grupo inteiro)" }))
    expect(linksFromScopeValue(onValue.mock.calls.at(-1)![0])).toEqual([{ teamId: "t-b", subteamId: "s-b1" }])
  })

  it("busca no servidor, carrega mais na rolagem (cursor) e preserva o que já foi marcado ao trocar a busca e a aba", async () => {
    const onValue = vi.fn()
    renderWithQuery(<Harness initial={{ global: false, groups: [] }} onValue={onValue} />)
    fireEvent.click(screen.getByRole("button", { name: /Adicionar Grupo ou Subgrupo/ }))
    expect(await screen.findByText("Grupo 00")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }))
    expect(await screen.findByText("Cobrança")).toBeInTheDocument()
    expect(service.fetchScopeUnits).toHaveBeenCalledWith(expect.objectContaining({ kind: "TEAM", permission: "agents.manage", universes: ["B2C"], cursor: "page-2" }), expect.anything())
    fireEvent.click(screen.getByText("Cobrança"))
    fireEvent.change(screen.getByRole("combobox", { name: /Buscar grupo/ }), { target: { value: "reten" } })
    await waitFor(() => expect(service.fetchScopeUnits).toHaveBeenCalledWith(expect.objectContaining({ kind: "TEAM", search: "reten" }), expect.anything()))
    const option = await screen.findByRole("option", { name: /Retenção/ })
    fireEvent.click(option)
    // Subgrupos: o do Grupo já escolhido inteiro fica indisponível ("já incluído"); escolher um Subgrupo não leva os irmãos.
    fireEvent.change(screen.getByRole("combobox", { name: /Buscar grupo/ }), { target: { value: "" } })
    fireEvent.click(screen.getByRole("radio", { name: "Subgrupos" }))
    const included = await screen.findByRole("option", { name: /Cobrança Tarde/ })
    expect(included).toHaveAttribute("aria-disabled", "true")
    expect(included).toHaveTextContent("Já incluído")
    await waitFor(() => expect(linksFromScopeValue(onValue.mock.calls.at(-1)![0])).toEqual([{ teamId: "t-a", subteamId: null }, { teamId: "t-b", subteamId: null }]))
  })

  it("teclado: ↓ percorre as opções e Enter marca; escolher o Grupo inteiro substitui os Subgrupos dele e avisa", async () => {
    const onValue = vi.fn()
    renderWithQuery(<Harness initial={{ global: false, groups: [{ teamId: "t-b", subteamIds: ["s-b1"], mode: "SUBTEAMS" }] }} onValue={onValue} />)
    fireEvent.click(screen.getByRole("button", { name: /Adicionar Grupo ou Subgrupo/ }))
    const input = screen.getByRole("combobox", { name: /Buscar grupo/ })
    fireEvent.change(input, { target: { value: "reten" } })
    await screen.findByRole("option", { name: /Retenção/ })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(linksFromScopeValue(onValue.mock.calls.at(-1)![0])).toEqual([{ teamId: "t-b", subteamId: null }])
    expect(await screen.findByText(/Retenção agora vale inteiro/)).toBeInTheDocument()
  })

  it("“Todos” é uma escolha explícita (não uma seleção vazia) e diz que inclui os criados depois", async () => {
    const onValue = vi.fn()
    renderWithQuery(<Harness initial={{ global: false, groups: [] }} onValue={onValue} />)
    expect(screen.getByText("Escolha ao menos um Grupo ou Subgrupo.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("radio", { name: /Todos os Grupos e Subgrupos do universo B2C/ }))
    expect(onValue.mock.calls.at(-1)![0]).toEqual({ global: true, groups: [] })
    expect(screen.getByText(/Inclui automaticamente os Grupos e Subgrupos que forem criados depois/)).toBeInTheDocument()
    expect(screen.getByTestId("scope-reach-summary")).toHaveTextContent("Todos os Grupos e Subgrupos do universo B2C")
    expect(screen.queryByRole("button", { name: /Adicionar Grupo ou Subgrupo/ })).not.toBeInTheDocument()
  })

  it("erro ao carregar as opções aparece com “Tentar de novo”; lista vazia explica o motivo", async () => {
    service.fetchScopeUnits.mockRejectedValueOnce(new Error("falhou"))
    renderWithQuery(<Harness initial={{ global: false, groups: [] }} />)
    fireEvent.click(screen.getByRole("button", { name: /Adicionar Grupo ou Subgrupo/ }))
    expect(await screen.findByText("Não foi possível carregar as opções.")).toBeInTheDocument()
    service.fetchScopeUnits.mockResolvedValueOnce({ items: [], nextCursor: null })
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }))
    expect(await screen.findByText(/Nenhum Grupo com operadores em produção em B2C no seu escopo/)).toBeInTheDocument()
  })

  it("a11y (run-10 QA-15): o listbox só tem opções; “Carregar mais” e a sentinela ficam fora dele", async () => {
    renderWithQuery(<Harness initial={{ global: false, groups: [] }} />)
    fireEvent.click(screen.getByRole("button", { name: /Adicionar Grupo ou Subgrupo/ }))
    expect(await screen.findByText("Grupo 00")).toBeInTheDocument()
    const listbox = screen.getByRole("listbox")
    expect([...listbox.children].every((child) => child.getAttribute("role") === "option")).toBe(true)
    expect(listbox.children).toHaveLength(30)
    const more = screen.getByRole("button", { name: "Carregar mais" })
    expect(listbox.contains(more)).toBe(false)
    fireEvent.click(more)
    expect(await screen.findByText("Cobrança")).toBeInTheDocument()
  })

  it("falha ao conferir os já escolhidos (run-10 QA-06) aparece como aviso com “Tentar de novo”", async () => {
    service.fetchScopeUnitsByIds.mockRejectedValueOnce(new Error("falhou"))
    renderWithQuery(<Harness initial={{ global: false, groups: [{ teamId: "t-a", subteamIds: [], mode: "WHOLE" }] }} />)
    expect(await screen.findByText(/Não foi possível conferir os nomes dos Grupos e Subgrupos escolhidos/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }))
    const chosen = await screen.findByRole("list", { name: "Escolhidos" })
    expect(await within(chosen).findByText("Cobrança (Grupo inteiro)")).toBeInTheDocument()
    expect(screen.queryByText(/Não foi possível conferir os nomes/)).toBeNull()
  })

  it("escolha fora do universo é contada para quem salva travar o salvar (run-10 QA-02/QA-10) e volta a 0 ao remover", async () => {
    const B2B = team("t-b2b", "Grandes Contas", { operatingUniverse: "B2B" })
    service.fetchScopeUnitsByIds.mockImplementation(async (kind: "TEAM" | "SUBTEAM", _permission: string, ids: string[]) => [A, B2B].filter((unit) => unit.kind === kind && ids.includes(unit.id)))
    const onOutside = vi.fn()
    function OutsideHarness() {
      const [value, setValue] = useState<ScopeLinksValue>({ global: false, groups: [{ teamId: "t-a", subteamIds: [], mode: "WHOLE" }, { teamId: "t-b2b", subteamIds: [], mode: "WHOLE" }] })
      return <MultiOrgScopeField permission="workflows.manage" universe="B2C" value={value} onChange={setValue} onOutsideUniverseChange={onOutside} />
    }
    renderWithQuery(<OutsideHarness />)
    expect(await screen.findByText("Fora do universo")).toBeInTheDocument()
    await waitFor(() => expect(onOutside).toHaveBeenLastCalledWith(1))
    fireEvent.click(screen.getByRole("button", { name: "Remover os que não cabem" }))
    await waitFor(() => expect(onOutside).toHaveBeenLastCalledWith(0))
  })
})
