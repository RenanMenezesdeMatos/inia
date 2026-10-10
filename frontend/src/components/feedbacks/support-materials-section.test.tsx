/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { SupportMaterialsSection } from "./support-materials-section"

afterEach(cleanup)

const A = { materialId: "11111111-1111-4111-8111-111111111111", available: true as const, title: "Técnicas de sondagem em retenção", reason: "Este material apresenta exemplos práticos de perguntas que ajudam a aprofundar a necessidade antes da oferta." }
const B = { materialId: "22222222-2222-4222-8222-222222222222", available: true as const, title: "Tratamento de objeções por preço", reason: "Mostra como responder à objeção de preço sem antecipar desconto." }

describe("SupportMaterialsSection", () => {
  it("sem materiais não renderiza seção nenhuma (nem vazia)", () => {
    const { container } = render(<SupportMaterialsSection materials={[]} />)
    expect(container).toBeEmptyDOMElement()
    const { container: absent } = render(<SupportMaterialsSection materials={undefined} />)
    expect(absent).toBeEmptyDOMElement()
  })

  it("um material: título no singular, título real, motivo e CTA 'Acessar material' para a rota canônica interna", () => {
    render(<SupportMaterialsSection materials={[A]} />)
    expect(screen.getByRole("heading", { name: "Material de apoio recomendado" })).toBeInTheDocument()
    expect(screen.getByText(A.title)).toBeInTheDocument()
    expect(screen.getByText(A.reason)).toBeInTheDocument()
    const link = screen.getByRole("link", { name: `Acessar material: ${A.title} (abre em nova aba)` })
    expect(link).toHaveTextContent("Acessar material")
    expect(link).toHaveAttribute("href", `/materiais/${A.materialId}`)
    // V1.6.0 (KNOWLEDGE_LINK_POLICY = NEW_TAB): link interno em nova aba, sem acesso ao opener, nunca URL vinda de fora.
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link.getAttribute("href")).not.toMatch(/^https?:/)
  })

  it("vários materiais: título no plural e um CTA por material, na ordem recebida", () => {
    render(<SupportMaterialsSection materials={[A, B]} />)
    expect(screen.getByRole("heading", { name: "Materiais de apoio recomendados" })).toBeInTheDocument()
    const links = screen.getAllByRole("link", { name: /Acessar material/ })
    expect(links.map((link) => link.getAttribute("href"))).toEqual([`/materiais/${A.materialId}`, `/materiais/${B.materialId}`])
  })

  it("material indisponível: aviso neutro, sem título e sem link", () => {
    render(<SupportMaterialsSection materials={[{ materialId: "33333333-3333-4333-8333-333333333333", available: false }]} />)
    expect(screen.getByRole("heading", { name: "Material de apoio recomendado" })).toBeInTheDocument()
    expect(screen.getByText("Um material de apoio recomendado não está mais disponível.")).toBeInTheDocument()
    expect(screen.queryByRole("link")).toBeNull()
  })
})
