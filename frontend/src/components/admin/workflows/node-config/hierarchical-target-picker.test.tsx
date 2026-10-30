/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { FlowGraph, HierarchicalTarget } from "@/schemas/admin/workflow-graph.schema"

import { HierarchicalTargetPicker } from "./hierarchical-target-picker"

afterEach(cleanup)

const GRAPH: FlowGraph = { nodes: [], edges: [] }

function renderPicker(target: HierarchicalTarget) {
  return render(<HierarchicalTargetPicker target={target} graph={GRAPH} fromNodeId="review-1" label="Revisor" onChange={() => {}} />)
}

// Cada rótulo visível nomeia o seu campo — inclusive o rótulo que vem por prop ("Revisor"/"Destino"), que a regra de lint não enxerga.
describe("HierarchicalTargetPicker — rótulos associados aos campos", () => {
  it("cargo relativo ao operador: o rótulo da prop e 'Cargo' encontram os seus seletores", () => {
    renderPicker({ type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" })
    expect(screen.getByLabelText("Revisor")).toHaveAttribute("role", "combobox")
    expect(screen.getByLabelText("Cargo")).toHaveAttribute("role", "combobox")
    expect(screen.getByRole("combobox", { name: "Revisor" })).toHaveTextContent("Cargo relativo ao operador")
  })

  it("pessoa específica: 'Id da pessoa' encontra o campo de texto", () => {
    renderPicker({ type: "SPECIFIC_USER", userId: "u-1" })
    expect(screen.getByRole("textbox", { name: "Id da pessoa" })).toHaveValue("u-1")
  })
})
