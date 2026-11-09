/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { SidebarProvider } from "@/components/ui/sidebar"
import { accessCapabilitiesSchema, type AccessCapabilities } from "@/schemas/auth/auth.schema"

import { AdminSidebar } from "./admin-sidebar"

const location = vi.hoisted(() => ({ pathname: "/admin/users", search: "" }))
vi.mock("next/navigation", () => ({ usePathname: () => location.pathname, useSearchParams: () => new URLSearchParams(location.search) }))

const caps = (patch: Partial<AccessCapabilities> = {}): AccessCapabilities => ({ ...accessCapabilitiesSchema.parse({}), ...patch })
const everything = caps(Object.fromEntries(Object.keys(accessCapabilitiesSchema.shape).map((key) => [key, true])) as Partial<AccessCapabilities>)

function at(pathname: string, search = "") {
  location.pathname = pathname
  location.search = search
}

function renderSidebar(capabilities: AccessCapabilities, options: { collapsed?: boolean } = {}) {
  const tree = () => (
    <SidebarProvider defaultOpen={!options.collapsed}>
      <AdminSidebar capabilities={capabilities} />
    </SidebarProvider>
  )
  const result = renderWithQuery(tree())
  return { ...result, rerenderSidebar: () => result.rerender(tree()) }
}

const link = (name: string) => screen.getByRole("link", { name })

beforeAll(() => installJsdomStubs())
afterEach(() => {
  cleanup()
  at("/admin/users")
})

describe("AdminSidebar — organização", () => {
  it("Administrador de dados: só a Central de Dados, sem a entrada de Usuários e acessos", () => {
    renderSidebar(caps({ canAccessAdministration: true, canManageDataHub: true }))
    expect(screen.getByText("Central de Dados")).toBeInTheDocument()
    for (const name of ["Usuários e acessos", "Indicadores", "Flags de canal", "Calendário operacional", "Agentes", "Workflows"]) expect(screen.queryByText(name)).not.toBeInTheDocument()
  })

  it("agrupa por área, sem Checkpoints e sem os atalhos de criação escondidos nas setas", () => {
    renderSidebar(everything)
    const groups = [...document.querySelectorAll('[data-sidebar="group-label"]')].map((label) => label.textContent)
    expect(groups).toEqual(["Dados", "Atendimento com IA", "Automação", "Monitoramento", "Plataforma"])
    expect(screen.queryByText(/Checkpoints/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Novo agente$|^Nova base$|^Nova fonte$/)).not.toBeInTheDocument()
    for (const name of ["Central de Dados", "Indicadores", "Flags de canal", "Agentes", "Orquestrador da INIA", "Argumentários", "IA / Modelos", "Workflows", "QA Lab", "Usuários e acessos", "Cenário da INIA"]) {
      expect(link(name)).toBeInTheDocument()
    }
  })

  it("Base de conhecimento e Domínios de negócio ficam dentro de Agentes; Calendário operacional dentro da Central de Dados", () => {
    renderSidebar(everything)
    // Fechado: só a linha de cima.
    expect(screen.queryByRole("link", { name: "Base de conhecimento" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Calendário operacional" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Expandir Agentes" }))
    const agents = link("Agentes").closest<HTMLElement>("li")!
    expect(within(agents).getByRole("link", { name: "Base de conhecimento" })).toHaveAttribute("href", "/admin/knowledge")
    expect(within(agents).getByRole("link", { name: "Domínios de negócio" })).toHaveAttribute("href", "/admin/business-domains")
    expect(within(agents).getByRole("link", { name: "Produtos" })).toHaveAttribute("href", "/admin/product-catalog")

    fireEvent.click(screen.getByRole("button", { name: "Expandir Central de Dados" }))
    const dataHub = link("Central de Dados").closest<HTMLElement>("li")!
    expect(within(dataHub).getByRole("link", { name: "Calendário operacional" })).toHaveAttribute("href", "/admin/operational-calendar")
  })

  it("Governança (Assuntos proibidos · Glossário geral) fica em Atendimento com IA", () => {
    at("/admin/governance", "tab=glossary")
    renderSidebar(everything)
    const glossary = link("Glossário geral")
    expect(glossary).toHaveAttribute("aria-current", "page")
    expect(link("Assuntos proibidos")).not.toHaveAttribute("aria-current")
    const group = glossary.closest<HTMLElement>('[data-sidebar="group"]')!
    expect(within(group).getByText("Atendimento com IA")).toBeInTheDocument()
  })
})

describe("AdminSidebar — item com subpáginas", () => {
  it("abre sozinho numa subpágina e, recolhido, destaca a linha de cima (o 'onde estou' nunca some)", () => {
    at("/admin/knowledge/doc-1")
    renderSidebar(everything)
    expect(link("Base de conhecimento")).toHaveAttribute("aria-current", "page")
    // Aberto: o fundo de "página atual" fica na subpágina; o item de cima fica maior e roxo (as de baixo são filhas dele).
    expect(link("Agentes")).toHaveAttribute("data-active", "false")
    expect(link("Agentes")).toHaveClass("text-[0.9375rem]", "!text-primary")

    fireEvent.click(screen.getByRole("button", { name: "Recolher Agentes" }))
    expect(screen.queryByRole("link", { name: "Base de conhecimento" })).not.toBeInTheDocument()
    expect(link("Agentes")).toHaveAttribute("data-active", "true")
    expect(link("Agentes")).not.toHaveClass("text-[0.9375rem]")
  })

  it("entrar na área depois (link de fora) abre o item", () => {
    const { rerenderSidebar } = renderSidebar(everything)
    expect(screen.queryByRole("link", { name: "Calendário operacional" })).not.toBeInTheDocument()
    at("/admin/operational-calendar")
    rerenderSidebar()
    expect(link("Calendário operacional")).toHaveAttribute("aria-current", "page")
  })

  it("subpágina sem acesso à página de cima sobe para o primeiro nível", () => {
    renderSidebar(caps({ canAccessAdministration: true, canManageKnowledge: true }))
    expect(link("Base de conhecimento")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Agentes" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Expandir/ })).not.toBeInTheDocument()
  })

  it("só a página de cima visível vira item simples, sem seta", () => {
    renderSidebar(caps({ canAccessAdministration: true, canManageDataHub: true }))
    expect(link("Central de Dados")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Expandir Central de Dados" })).not.toBeInTheDocument()
    expect(screen.queryByText("Calendário operacional")).not.toBeInTheDocument()
  })

  it("recolhido em ícones, nada muda de lugar: títulos viram divisor e as subpáginas abertas continuam (só o ícone)", () => {
    at("/admin/business-domains")
    renderSidebar(everything, { collapsed: true })
    // Títulos dos grupos continuam ocupando a linha (o texto só some visualmente).
    expect(screen.getByText("Atendimento com IA")).toBeInTheDocument()
    // Item com subpáginas continua sendo o link da página; a subpágina aberta segue logo abaixo, com nome acessível.
    expect(link("Agentes")).toHaveAttribute("href", "/admin/agents")
    expect(link("Domínios de negócio")).toHaveAttribute("aria-current", "page")
    expect(link("Base de conhecimento")).toBeInTheDocument()
    // Área fechada continua fechada — e a seta ao lado do ícone abre sem navegar.
    expect(screen.queryByRole("link", { name: "Calendário operacional" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Expandir Central de Dados" }))
    expect(link("Calendário operacional")).toBeInTheDocument()
    // Governança não é página: a seta ao lado do ícone também abre (antes era só desenho, o clique não fazia nada).
    expect(screen.queryByRole("link", { name: "Glossário geral" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Expandir Governança" }))
    expect(link("Glossário geral")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Recolher Governança" })).toHaveAttribute("aria-expanded", "true")
  })

  it("o menu não repete o título 'Administração' no topo", () => {
    renderSidebar(everything)
    expect(screen.queryByText("Administração")).not.toBeInTheDocument()
  })
})
