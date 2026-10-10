/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { RichContent } from "./rich-content"

afterEach(cleanup)

describe("RichContent — formatação", () => {
  it("**texto qualquer** vira <strong> sem asteriscos", () => {
    const { container } = render(<RichContent text="Antes **texto qualquer** depois" />)
    expect(screen.getByText("texto qualquer").tagName).toBe("STRONG")
    expect(container.textContent).not.toContain("**")
  })

  it("renderiza itálico, títulos discretos, listas, numeradas, citação, código e links", () => {
    const md = ["### **Roteiro**", "", "*ênfase* e `codigo`", "", "- item a", "- item b", "", "1. um", "2. dois", "", "> citação", "", "[docs](https://exemplo.com/x)"].join("\n")
    const { container } = render(<RichContent text={md} />)
    expect(container.querySelector("h3")).toBeNull()
    expect(screen.getByText("Roteiro").tagName).toBe("STRONG")
    expect(screen.getByText("ênfase").tagName).toBe("EM")
    expect(screen.getByText("codigo").tagName).toBe("CODE")
    expect(container.querySelectorAll("ul > li")).toHaveLength(2)
    expect(container.querySelectorAll("ol > li")).toHaveLength(2)
    expect(container.querySelector("blockquote")).toHaveTextContent("citação")
    const link = screen.getByRole("link", { name: "docs" })
    expect(link).toHaveAttribute("href", "https://exemplo.com/x")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"))
  })

  it("tabelas e blocos de código ficam em containers com rolagem própria (nunca da página)", () => {
    const md = ["| a | b |", "|---|---|", "| 1 | 2 |", "", "```", "linha muito longa".repeat(20), "```"].join("\n")
    const { container } = render(<RichContent text={md} />)
    expect(container.querySelector("table")?.parentElement?.className).toContain("overflow-x-auto")
    expect(container.querySelector("pre")?.className).toContain("overflow-x-auto")
  })

  it("texto simples antigo (sem markdown) continua renderizando em parágrafos", () => {
    const { container } = render(<RichContent text={"Primeira frase.\n\nSegunda frase."} />)
    expect(container.querySelectorAll("p")).toHaveLength(2)
  })

  it("texto vazio não renderiza nada", () => {
    const { container } = render(<RichContent text="   " />)
    expect(container.firstChild).toBeNull()
  })
})

describe("RichContent — segurança", () => {
  it("HTML embutido nunca vira elemento (script/img/iframe descartados)", () => {
    const md = 'Olá <script>window.__xss = 1</script><img src=x onerror="window.__xss=2"><iframe src="https://x"></iframe> fim'
    const { container } = render(<RichContent text={md} />)
    expect(container.querySelector("script")).toBeNull()
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("iframe")).toBeNull()
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
    expect(container.textContent).toContain("Olá")
    expect(container.textContent).toContain("fim")
  })

  it("links javascript: e data: são neutralizados", () => {
    const { container } = render(<RichContent text="[clique](javascript:alert(1)) e [dados](data:text/html,x)" />)
    for (const link of container.querySelectorAll("a")) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/^(javascript|data):/i)
    }
  })

  it("nunca usa innerHTML: o texto literal de uma tag aparece como texto quando escapado", () => {
    const { container } = render(<RichContent text={"Use `<b>` para negrito"} />)
    expect(container.querySelector("b")).toBeNull()
    expect(screen.getByText("<b>").tagName).toBe("CODE")
  })
})
