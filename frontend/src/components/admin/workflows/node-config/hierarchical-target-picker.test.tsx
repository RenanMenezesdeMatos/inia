/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { FlowGraph, HierarchicalTarget } from "@/schemas/admin/workflow-graph.schema"

import { HierarchicalTargetPicker } from "./hierarchical-target-picker"

vi.mock("@/components/admin/users/user-combobox", () => ({ UserCombobox: ({ value, ariaLabel }: { value: string; ariaLabel: string }) => <button type="button" aria-label={ariaLabel}>{value === "u-1" ? "Maria Fictícia" : "Selecione a pessoa"}</button> }))

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

  it("pessoa específica: escolhe-se pelo nome, nunca digitando um id", () => {
    renderPicker({ type: "SPECIFIC_USER", userId: "u-1" })
    expect(screen.getByRole("button", { name: "Pessoa" })).toHaveTextContent("Maria Fictícia")
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })
})
