/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { AdminApiError } from "@/lib/admin/admin-api"
import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"

const service = vi.hoisted(() => ({ fetchJobPositions: vi.fn(), createJobPosition: vi.fn(), updateJobPosition: vi.fn() }))
vi.mock("@/services/admin/data-hub-service", async (importOriginal) => ({ ...(await importOriginal<object>()), ...service }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { JobPositionsTab } from "./job-positions-tab"

const position = (id: string, name: string, level: string, extra: object = {}) => ({ id, name, level, levelLabel: "", terms: [name], active: true, peopleCount: 0, peopleTotal: 0, ...extra })
const CATALOG = {
  positions: [position("p-ar", "Assistente de Relacionamento", "OPERATOR", { terms: ["Assistente de Relacionamento", "ASSISTENTE RELACIONAMENTO"], peopleCount: 12, peopleTotal: 14 }), position("p-es", "Estagiário", "STAFF"), position("p-su", "Supervisor", "SUPERVISOR", { peopleCount: 1, peopleTotal: 1 })],
  unknown: [{ term: "ANALISTA DE MIS", records: 3, lastSeenAt: "2026-11-24T12:00:00Z", inactivePositionId: null }, { term: "TRAINEE", records: 1, lastSeenAt: "2026-11-24T12:00:00Z", inactivePositionId: "p-tr" }],
}

beforeAll(installJsdomStubs)
afterEach(cleanup)
beforeEach(() => {
  Object.values(service).forEach((fn) => fn.mockReset())
  service.fetchJobPositions.mockResolvedValue(CATALOG)
  service.createJobPosition.mockResolvedValue(CATALOG.positions[0])
  service.updateJobPosition.mockResolvedValue(CATALOG.positions[0])
})

const renderTab = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><JobPositionsTab /></QueryClientProvider>)
async function choose(label: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Perfil" }), { key: "Enter" })
  fireEvent.keyDown(await screen.findByRole("option", { name: label }), { key: "Enter" })
}

describe("Cargos", () => {
  it("lista cargo, perfil e nomes na base; a busca acha pelo nome da base, sem acento", async () => {
    renderTab()
    const row = (await screen.findByRole("button", { name: "Editar Assistente de Relacionamento" })).closest("tr")!
    expect(row).toHaveTextContent("Operador")
    expect(row).toHaveTextContent("ASSISTENTE RELACIONAMENTO")
    expect(row).toHaveTextContent("12")
    expect(screen.getByRole("button", { name: "Editar Estagiário" }).closest("tr")).toHaveTextContent("Apoio")
    fireEvent.change(screen.getByLabelText("Buscar cargo"), { target: { value: "estagiario" } })
    await waitFor(() => expect(screen.queryByRole("button", { name: "Editar Assistente de Relacionamento" })).not.toBeInTheDocument())
    expect(screen.getByRole("button", { name: "Editar Estagiário" })).toBeInTheDocument()
  })

  it("cargo que chegou sem cadastro: o botão preenche o nome, o perfil é escolha da pessoa e o termo da base vai junto", async () => {
    renderTab()
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar o cargo ANALISTA DE MIS" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByLabelText("Nome que aparece na INIA")).toHaveValue("Analista de Mis")
    expect(within(dialog).getByRole("button", { name: "Cadastrar cargo" })).toBeDisabled()
    await choose("Apoio")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cadastrar cargo" }))
    await waitFor(() => expect(service.createJobPosition.mock.calls[0]?.[0]).toEqual({ name: "Analista de Mis", level: "STAFF", terms: ["ANALISTA DE MIS"] }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("recusa do servidor fica no formulário, com o que foi digitado", async () => {
    service.updateJobPosition.mockRejectedValue(new AdminApiError("1 pessoa tem este cargo.", "JOB_POSITION_LEVEL_LOCKED"))
    renderTab()
    fireEvent.click(await screen.findByRole("button", { name: "Editar Supervisor" }))
    await choose("Operador")
    expect(screen.getByText(/1 pessoa muda de perfil ao salvar/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Salvar cargo" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("1 pessoa tem este cargo.")
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("cargo desativado que chegou: a saída é ativar, não cadastrar de novo", async () => {
    renderTab()
    fireEvent.click(await screen.findByRole("button", { name: "Ativar o cargo TRAINEE" }))
    await waitFor(() => expect(service.updateJobPosition.mock.calls[0]?.[0]).toEqual({ id: "p-tr", active: true }))
    expect(screen.queryByRole("button", { name: "Cadastrar o cargo TRAINEE" })).not.toBeInTheDocument()
  })

  it("desativar cargo em uso pede confirmação; sem ninguém, vai direto", async () => {
    renderTab()
    fireEvent.click(await screen.findByRole("switch", { name: "Desativar Assistente de Relacionamento" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(service.updateJobPosition).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Desativar" }))
    await waitFor(() => expect(service.updateJobPosition.mock.calls[0]?.[0]).toEqual({ id: "p-ar", active: false }))
  })

  it("desativar é pelo interruptor da linha", async () => {
    renderTab()
    fireEvent.click(await screen.findByRole("switch", { name: "Desativar Estagiário" }))
    await waitFor(() => expect(service.updateJobPosition.mock.calls[0]?.[0]).toEqual({ id: "p-es", active: false }))
  })
})
