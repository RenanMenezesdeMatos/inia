// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SqlBlock } from "./sql-block"

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
}

describe("SqlBlock", () => {
  afterEach(() => {
    cleanup()
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true })
  })

  it("mostra o SQL e copia o texto inteiro", async () => {
    const writeText = vi.fn(async () => undefined)
    stubClipboard(writeText)
    render(<SqlBlock label="Script" code={"CREATE TABLE inia.grupos (\n  codigo varchar(64)\n);"} />)
    fireEvent.click(screen.getByRole("button", { name: "Copiar: Script" }))
    await waitFor(() => expect(screen.getByText("Copiado")).toBeInTheDocument())
    expect(writeText).toHaveBeenCalledWith("CREATE TABLE inia.grupos (\r\n  codigo varchar(64)\r\n);")
  })

  it("sem acesso à área de transferência, deixa o texto selecionado para copiar à mão", async () => {
    stubClipboard(async () => {
      throw new Error("sem permissão")
    })
    render(<SqlBlock label="Script" code="SELECT 1" />)
    fireEvent.click(screen.getByRole("button", { name: "Copiar: Script" }))
    await waitFor(() => expect(screen.getByText("Selecionado: copie com Ctrl+C")).toBeInTheDocument())
    expect(window.getSelection()?.toString()).toBe("SELECT 1")
  })
})
