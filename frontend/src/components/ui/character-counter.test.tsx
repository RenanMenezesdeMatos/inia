/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { CharacterCounter, characterCountState, isWithinTextLimits } from "./character-counter"

afterEach(cleanup)

const PROMPT = { min: 10, max: 12_000 }

describe("characterCountState", () => {
  it("conta o texto como está e calcula quanto falta", () => {
    expect(characterCountState("a".repeat(1_234), PROMPT)).toMatchObject({ length: 1_234, remaining: 10_766, over: false, nearLimit: false, belowMin: false })
  })

  it("avisa perto do fim (90%) e marca acima do limite", () => {
    expect(characterCountState("a".repeat(10_800), PROMPT)).toMatchObject({ nearLimit: true, over: false })
    expect(characterCountState("a".repeat(12_001), PROMPT)).toMatchObject({ remaining: -1, over: true, nearLimit: false })
  })

  it("mínimo sem os espaços das pontas, como o backend", () => {
    expect(characterCountState("   abc     ", { min: 5, max: 1_000 }).belowMin).toBe(true)
    expect(isWithinTextLimits("abcde", { min: 5, max: 1_000 })).toBe(true)
    expect(isWithinTextLimits("a".repeat(1_001), { min: 5, max: 1_000 })).toBe(false)
    expect(isWithinTextLimits("", { min: 0, max: 80 })).toBe(true)
  })
})

describe("CharacterCounter", () => {
  it("mostra contagem e quanto falta, com milhar em pt-BR", () => {
    render(<CharacterCounter id="count" value={"a".repeat(1_234)} limits={PROMPT} />)
    expect(document.getElementById("count")).toHaveTextContent("1.234 de 12.000 caracteres · faltam 10.766")
    expect(document.getElementById("count")).toHaveAttribute("data-state", "ok")
  })

  it("acima do limite: quanto passou, em destaque, e anúncio para leitor de tela", () => {
    render(<CharacterCounter id="count" value={"a".repeat(12_345)} limits={PROMPT} />)
    expect(document.getElementById("count")).toHaveTextContent("12.345 de 12.000 caracteres · 345 acima do limite")
    expect(document.getElementById("count")).toHaveAttribute("data-state", "over")
    expect(screen.getByText("Limite de 12.000 caracteres excedido.")).toBeInTheDocument()
  })

  it("singular, limite exato e aviso de mínimo só depois de começar a digitar", () => {
    const { rerender } = render(<CharacterCounter id="count" value={"a".repeat(79)} limits={{ min: 0, max: 80 }} />)
    expect(document.getElementById("count")).toHaveTextContent("· falta 1")
    rerender(<CharacterCounter id="count" value={"a".repeat(80)} limits={{ min: 0, max: 80 }} />)
    expect(document.getElementById("count")).toHaveTextContent("· limite atingido")
    rerender(<CharacterCounter id="count" value="" limits={{ min: 5, max: 1_000 }} />)
    expect(screen.queryByText("Mínimo de 5 caracteres.")).not.toBeInTheDocument()
    rerender(<CharacterCounter id="count" value="abc" limits={{ min: 5, max: 1_000 }} />)
    expect(screen.getByText("Mínimo de 5 caracteres.")).toBeInTheDocument()
  })
})
