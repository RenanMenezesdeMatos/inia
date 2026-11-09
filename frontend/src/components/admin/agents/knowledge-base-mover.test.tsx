/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"

import { KnowledgeBaseMover } from "./knowledge-base-mover"

const DOCUMENTS = [
  { id: "a", title: "Base em uso", inUseVersion: 4 },
  { id: "b", title: "Base só rascunho", inUseVersion: null },
]

beforeAll(() => installJsdomStubs())
afterEach(cleanup)

describe("seletor de bases do agente (PEN-008, CA-WF008.5)", () => {
  it("base sem versão pronta ganha o selo e a explicação; a base em uso, não", () => {
    render(<KnowledgeBaseMover documents={DOCUMENTS} selectedIds={[]} onChange={vi.fn()} />)
    const withoutVersion = screen.getByRole("button", { name: /Base só rascunho/ })
    expect(within(withoutVersion).getByText("Sem versão disponível")).toBeInTheDocument()
    expect(within(screen.getByRole("button", { name: /Base em uso/ })).queryByText("Sem versão disponível")).not.toBeInTheDocument()
    expect(screen.getByText(/o agente não consulta esta base até haver uma versão pronta/)).toBeInTheDocument()
  })

  it("selecionada, continua com o selo: a seleção não promete que o agente vai consultá-la", () => {
    const onChange = vi.fn()
    const { rerender } = render(<KnowledgeBaseMover documents={DOCUMENTS} selectedIds={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: /Base só rascunho/ }))
    expect(onChange).toHaveBeenCalledWith(["b"])
    rerender(<KnowledgeBaseMover documents={DOCUMENTS} selectedIds={["b"]} onChange={onChange} />)
    expect(within(screen.getByRole("button", { name: /Base só rascunho/ })).getByText("Sem versão disponível")).toBeInTheDocument()
  })

  it("sem base nessa situação, nada de aviso; 'Vale para' não aparece aqui (PEN-064 continua aberta)", () => {
    render(<KnowledgeBaseMover documents={[DOCUMENTS[0]!]} selectedIds={[]} onChange={vi.fn()} />)
    expect(screen.queryByText(/Sem versão disponível/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Vale para/)).not.toBeInTheDocument()
  })
})
