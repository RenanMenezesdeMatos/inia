/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"

import { PersonPicker } from "./person-picker"

installJsdomStubs()
afterEach(cleanup)

vi.mock("@/queries/admin/use-user-account-queries", () => ({
  useUserAccountsQuery: () => ({
    data: [
      { id: "p1", name: "João Fictício", email: "joao@exemplo.invalid", role: "SUPERVISOR", teamName: "B2C", active: true },
      { id: "p2", name: "Maria Fictícia", email: "maria@exemplo.invalid", role: "OPERATOR", teamName: "B2B", active: true },
      { id: "p3", name: "Pessoa Inativa", email: "inativa@exemplo.invalid", role: "OPERATOR", teamName: null, active: false },
    ],
    isLoading: false,
    isError: false,
  }),
}))

describe("PersonPicker (WF-17)", () => {
  it("encontra pelo nome, sem exigir acento, e devolve o id", () => {
    const onChange = vi.fn()
    render(<PersonPicker value="" onChange={onChange} />)
    fireEvent.click(screen.getByRole("combobox"))
    fireEvent.change(screen.getByRole("textbox", { name: /Buscar pessoa/ }), { target: { value: "joao" } })
    expect(screen.queryByText("Maria Fictícia")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /João Fictício/ }))
    expect(onChange).toHaveBeenCalledWith("p1")
  })

  it("mostra o nome da pessoa escolhida, não o id", () => {
    render(<PersonPicker value="p2" onChange={() => {}} />)
    expect(screen.getByRole("combobox")).toHaveTextContent("Maria Fictícia")
  })

  it("avisa quando a pessoa salva não existe mais ou está inativa, e não a oferece", () => {
    render(<PersonPicker value="p3" onChange={() => {}} />)
    expect(screen.getByRole("combobox")).toHaveTextContent("Pessoa não encontrada ou inativa")
    fireEvent.click(screen.getByRole("combobox"))
    expect(screen.queryByRole("button", { name: /Pessoa Inativa/ })).not.toBeInTheDocument()
  })
})
