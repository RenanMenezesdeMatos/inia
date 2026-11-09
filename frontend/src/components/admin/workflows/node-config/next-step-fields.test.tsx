/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import type { FlowGraph, FlowNode } from "@/schemas/admin/workflow-graph.schema"

import { NextStepFields } from "./next-step-fields"

installJsdomStubs()
afterEach(cleanup)

const position = { x: 0, y: 0 }
const condition: FlowNode = { id: "cond", type: "condition", label: "Nota baixa?", position, config: { comparator: "EQUALS", thresholdBoolean: true, thresholdNumeric: null } }
const graph: FlowGraph = {
  nodes: [
    { id: "trigger", type: "trigger", label: "Início", position, config: {} },
    condition,
    { id: "aviso", type: "output", label: "", position, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["NOTIFICATION"], source: "" } },
    { id: "end", type: "end", label: "Fim", position, config: {} },
  ],
  edges: [{ id: "e", source: "cond", sourceHandle: "true", target: "end" }],
}

describe("NextStepFields — ligar etapas sem arrastar (WF-33)", () => {
  it("mostra uma pergunta por saída, com o destino atual ou 'Sem ligação'", () => {
    render(<NextStepFields node={condition} graph={graph} onConnectBranch={() => {}} />)
    expect(screen.getByRole("combobox", { name: 'Se "Sim"' })).toHaveTextContent("Fim")
    expect(screen.getByRole("combobox", { name: 'Se "Não"' })).toHaveTextContent("Sem ligação")
  })

  it("permite ligar pelo teclado; não oferece o Gatilho nem a própria etapa; etapa sem nome aparece pelo tipo", () => {
    const onConnectBranch = vi.fn()
    render(<NextStepFields node={condition} graph={graph} onConnectBranch={onConnectBranch} />)
    const select = screen.getByRole("combobox", { name: 'Se "Não"' })
    fireEvent.keyDown(select, { key: "ArrowDown" })
    const options = screen.getAllByRole("option").map((option) => option.textContent)
    expect(options).toEqual(["Sem ligação", "Output", "Fim"])
    fireEvent.click(screen.getByRole("option", { name: "Output" }))
    expect(onConnectBranch).toHaveBeenCalledWith("false", "aviso")
  })

  it("'Sem ligação' remove a ligação existente", () => {
    const onConnectBranch = vi.fn()
    render(<NextStepFields node={condition} graph={graph} onConnectBranch={onConnectBranch} />)
    fireEvent.keyDown(screen.getByRole("combobox", { name: 'Se "Sim"' }), { key: "ArrowDown" })
    fireEvent.click(screen.getByRole("option", { name: "Sem ligação" }))
    expect(onConnectBranch).toHaveBeenCalledWith("true", null)
  })

  it("etapa sem saída (Fim) não mostra a seção", () => {
    const { container } = render(<NextStepFields node={graph.nodes[3]!} graph={graph} onConnectBranch={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
