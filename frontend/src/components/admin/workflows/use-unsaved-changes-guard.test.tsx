/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"

import { UnsavedChangesGuard } from "./use-unsaved-changes-guard"

installJsdomStubs()
afterEach(cleanup)

const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

function Page({ dirty }: { dirty: boolean }) {
  return (
    <>
      <UnsavedChangesGuard dirty={dirty} />
      <a href="/outra-tela" onClick={(event) => event.preventDefault()}>
        Agentes
      </a>
      <a href="/outra-tela" target="_blank" onClick={(event) => event.preventDefault()}>
        Nova aba
      </a>
    </>
  )
}

describe("UnsavedChangesGuard (WF-03)", () => {
  it("com alteração pendente, um link interno pergunta antes de sair", () => {
    push.mockClear()
    render(<Page dirty />)
    fireEvent.click(screen.getByRole("link", { name: "Agentes" }))
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Sair sem salvar?")
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Sair sem salvar" }))
    expect(push).toHaveBeenCalledWith("/outra-tela")
  })

  it("'Continuar editando' fica na tela", () => {
    push.mockClear()
    render(<Page dirty />)
    fireEvent.click(screen.getByRole("link", { name: "Agentes" }))
    fireEvent.click(screen.getByRole("button", { name: "Continuar editando" }))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it("sem alteração, ou abrindo em nova aba, não atrapalha", () => {
    const { rerender } = render(<Page dirty={false} />)
    fireEvent.click(screen.getByRole("link", { name: "Agentes" }))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    rerender(<Page dirty />)
    fireEvent.click(screen.getByRole("link", { name: "Nova aba" }))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("recarregar ou fechar a página aciona o aviso do navegador só com alteração pendente", () => {
    const { rerender } = render(<Page dirty={false} />)
    const clean = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    rerender(<Page dirty />)
    const pending = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(pending)
    expect(pending.defaultPrevented).toBe(true)
  })
})
