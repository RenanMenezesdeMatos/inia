/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { useState } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import type { FlowNode } from "@/schemas/admin/workflow-graph.schema"

import { WaitForm } from "./wait-form"

installJsdomStubs()
afterEach(cleanup)

type WaitNode = Extract<FlowNode, { type: "wait" }>

function Harness({ durationMs, onDuration }: { durationMs: number; onDuration: (value: number) => void }) {
  const [node, setNode] = useState<WaitNode>({ id: "w", type: "wait", label: "Aguardar", position: { x: 0, y: 0 }, config: { durationMs } })
  return (
    <WaitForm
      node={node}
      onChange={(next) => {
        setNode(next as WaitNode)
        onDuration((next as WaitNode).config.durationMs)
      }}
    />
  )
}

function typeDigits(input: HTMLElement, digits: string) {
  for (let length = 1; length <= digits.length; length += 1) fireEvent.change(input, { target: { value: digits.slice(0, length) } })
}

describe("WaitForm", () => {
  it("WF-10: digitar 605 minutos grava 605 minutos, sem pular para horas no meio da digitação", () => {
    const onDuration = vi.fn()
    render(<Harness durationMs={5 * 60_000} onDuration={onDuration} />)
    const input = screen.getByLabelText("Duração")
    typeDigits(input, "605")
    expect(onDuration).toHaveBeenLastCalledWith(605 * 60_000)
    expect(input).toHaveValue(605)
    expect(screen.getByRole("combobox", { name: "Unidade" })).toHaveTextContent("Minutos")
  })

  it("apagar o campo para digitar outro valor não vira 1 nem altera a duração", () => {
    const onDuration = vi.fn()
    render(<Harness durationMs={45 * 60_000} onDuration={onDuration} />)
    const input = screen.getByLabelText("Duração")
    fireEvent.change(input, { target: { value: "" } })
    expect(input).toHaveValue(null)
    expect(onDuration).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(input).toHaveValue(45)
  })

  it("ao abrir, a unidade reflete a duração salva", () => {
    render(<Harness durationMs={2 * 3_600_000} onDuration={() => {}} />)
    expect(screen.getByLabelText("Duração")).toHaveValue(2)
    expect(screen.getByRole("combobox", { name: "Unidade" })).toHaveTextContent("Horas")
  })
})
