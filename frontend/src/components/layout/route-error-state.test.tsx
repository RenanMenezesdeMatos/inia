/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import AppRouteError from "@/app/(app)/error"
import RootRouteError from "@/app/error"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("fronteira de erro de rota", () => {
  it.each([
    ["área autenticada", AppRouteError],
    ["raiz", RootRouteError],
  ])("%s: aviso em português, sem a mensagem interna, e 'Tentar novamente' chama o retry do Next", (_, Boundary) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const retry = vi.fn()
    const error = new Error("Cannot read properties of undefined (reading 'items')")

    render(<Boundary error={error} retry={retry} />)

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível exibir esta tela.")
    expect(screen.queryByText(/Cannot read properties/)).not.toBeInTheDocument()
    expect(logged).toHaveBeenCalledWith(error)
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
