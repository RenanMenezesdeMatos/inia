/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { userAccountSchema } from "@/schemas/admin/user-account.schema"

const users = vi.hoisted(() => ({ fetchUserAccountsPage: vi.fn() }))
vi.mock("@/services/admin/user-account-service", () => users)

import { PersonPicker } from "./person-picker"

installJsdomStubs()
afterEach(cleanup)

const person = (id: string, name: string, active = true) => userAccountSchema.parse({ id, name, role: "OPERATOR", active, teamId: "t", teamName: "B2C", accountId: null, email: null, lastLoginAt: null })
const PEOPLE = [person("p1", "João Fictício"), person("p2", "Maria Fictícia"), person("p3", "Pessoa Inativa", false)]
users.fetchUserAccountsPage.mockImplementation(async (params: { ids?: string[]; search?: string; active?: boolean; page: number; pageSize: number }) => {
  const found = PEOPLE.filter((entry) => (params.ids ? params.ids.includes(entry.id) : (!params.active || entry.active) && (!params.search || entry.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(params.search))))
  return { items: found, total: found.length, page: params.page, pageSize: params.pageSize }
})

describe("PersonPicker (WF-17)", () => {
  it("busca no servidor, só entre as ativas e em lote pequeno, e devolve o id", async () => {
    const onChange = vi.fn()
    renderWithQuery(<PersonPicker value="" onChange={onChange} />)
    expect(users.fetchUserAccountsPage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Pessoa: Selecione a pessoa" }))
    expect(await screen.findByRole("option", { name: "Maria Fictícia" })).toBeInTheDocument()
    expect(users.fetchUserAccountsPage.mock.lastCall![0]).toMatchObject({ active: true, page: 1, pageSize: 30 })
    expect(screen.queryByRole("option", { name: "Pessoa Inativa" })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole("combobox", { name: /Buscar pessoa/ }), { target: { value: "joao" } })
    await waitFor(() => expect(screen.queryByRole("option", { name: "Maria Fictícia" })).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole("option", { name: "João Fictício" }))
    expect(onChange).toHaveBeenCalledWith("p1")
  })

  it("mostra o nome da pessoa escolhida, não o id", async () => {
    renderWithQuery(<PersonPicker value="p2" onChange={() => {}} />)
    expect(await screen.findByRole("button", { name: "Pessoa: Maria Fictícia" })).toBeInTheDocument()
  })

  it("avisa quando a pessoa salva não existe mais ou está inativa", async () => {
    renderWithQuery(<PersonPicker value="p3" onChange={() => {}} />)
    expect(await screen.findByRole("button", { name: "Pessoa: Pessoa não encontrada ou inativa" })).toBeInTheDocument()
  })
})
