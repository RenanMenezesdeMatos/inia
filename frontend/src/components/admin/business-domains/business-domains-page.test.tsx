/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { BusinessDomain } from "@/schemas/admin/business-domain.schema"

import { BusinessDomainsPage } from "./business-domains-page"

const service = vi.hoisted(() => ({
  fetchBusinessDomains: vi.fn(),
  fetchBusinessDomainsPage: vi.fn(),
  fetchBusinessDomainDependencies: vi.fn(),
  createBusinessDomain: vi.fn(),
  updateBusinessDomain: vi.fn(),
  setBusinessDomainActive: vi.fn(),
  deleteBusinessDomain: vi.fn(),
}))
vi.mock("@/services/admin/business-domain-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const navigation = vi.hoisted(() => ({ search: new URLSearchParams() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/business-domains",
  useSearchParams: () => navigation.search,
}))

// Domínios são DADOS: a lista inclui um domínio que nunca existiu em enum algum.
const FATURAMENTO: BusinessDomain = { id: "d1", code: "FATURAMENTO", name: "Faturamento", description: "Processos de fatura.", active: true, createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z", agentCount: 3, orchestratorCount: 2 }
const LOGISTICA: BusinessDomain = { id: "d5", code: "LOGISTICA", name: "Logística", description: null, active: true, createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z", agentCount: 0, orchestratorCount: 0 }

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  navigation.search = new URLSearchParams()
})

describe("Domínios de negócio — catálogo administrável", () => {
  it("lista Domínio, Código, Agents, Orchestrators e Status a partir do backend (nunca de uma constante)", async () => {
    service.fetchBusinessDomainsPage.mockResolvedValue({ items: [FATURAMENTO, LOGISTICA], total: 2, page: 1, pageSize: 10 })
    renderWithQuery(<BusinessDomainsPage />)
    expect(await screen.findByText("Faturamento")).toBeInTheDocument()
    expect(screen.getByText("Logística")).toBeInTheDocument()
    const row = screen.getByTestId("domain-row-FATURAMENTO")
    expect(row).toHaveTextContent("FATURAMENTO")
    expect(row).toHaveTextContent("3")
    expect(row).toHaveTextContent("2")
    expect(row).toHaveTextContent("Ativo")
    expect(service.fetchBusinessDomainsPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: undefined }))
  })

  it("?new (atalho da sidebar) abre o formulário de criação — e abre de novo a cada nova navegação com ?new", async () => {
    service.fetchBusinessDomainsPage.mockResolvedValue({ items: [FATURAMENTO], total: 1, page: 1, pageSize: 10 })
    navigation.search = new URLSearchParams("new=1")
    const { rerender } = renderWithQuery(<BusinessDomainsPage />)
    expect(screen.getByLabelText("Nome *")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(await screen.findByText("Faturamento")).toBeInTheDocument()
    navigation.search = new URLSearchParams()
    rerender(<BusinessDomainsPage />)
    expect(screen.queryByLabelText("Nome *")).not.toBeInTheDocument()
    navigation.search = new URLSearchParams("new=1")
    rerender(<BusinessDomainsPage />)
    expect(screen.getByLabelText("Nome *")).toBeInTheDocument()
  })

  it("Novo domínio: sugere o código a partir do nome (normalizado) e envia nome/código/descrição/status pelo serviço", async () => {
    service.fetchBusinessDomainsPage.mockResolvedValue({ items: [FATURAMENTO], total: 1, page: 1, pageSize: 10 })
    service.createBusinessDomain.mockResolvedValue(LOGISTICA)
    renderWithQuery(<BusinessDomainsPage />)
    await screen.findByText("Faturamento")
    fireEvent.click(screen.getByRole("button", { name: /Novo domínio/ }))
    fireEvent.change(screen.getByLabelText("Nome *"), { target: { value: "Logística e Entregas" } })
    expect(screen.getByLabelText("Código *")).toHaveValue("LOGISTICA_E_ENTREGAS")
    fireEvent.change(screen.getByLabelText("Código *"), { target: { value: "logística" } })
    expect(screen.getByLabelText("Código *")).toHaveValue("LOGISTICA")
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Processos relacionados a logística, rastreamento e entrega." } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar domínio" }))
    await waitFor(() => expect(service.createBusinessDomain.mock.calls[0]?.[0]).toEqual({ name: "Logística e Entregas", code: "LOGISTICA", description: "Processos relacionados a logística, rastreamento e entrega.", active: true }))
  })

  it("Editar: código travado quando há dependências, 'Utilizado por' lista Agents e Orchestrators, excluir fica bloqueado", async () => {
    service.fetchBusinessDomainsPage.mockResolvedValue({ items: [FATURAMENTO], total: 1, page: 1, pageSize: 10 })
    service.fetchBusinessDomainDependencies.mockResolvedValue({ agents: [{ id: "a1", name: "Especialista de Faturamento", active: true }], orchestrators: [{ id: "o1", name: "Orquestrador · Faturamento", active: true }], total: 2, agentsOutOfScope: 0, orchestratorsOutOfScope: 0 })
    renderWithQuery(<BusinessDomainsPage />)
    await screen.findByText("Faturamento")
    fireEvent.click(screen.getByRole("button", { name: "Editar Faturamento" }))
    expect(screen.getByLabelText("Código *")).toBeDisabled()
    expect(screen.getByText("Este código já é utilizado por Agents ou Orchestrators e não pode ser alterado.")).toBeInTheDocument()
    expect(await screen.findByText("Especialista de Faturamento")).toBeInTheDocument()
    expect(screen.getByText("Orquestrador · Faturamento")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Nome *"), { target: { value: "Faturamento e Cobrança" } })
    service.updateBusinessDomain.mockResolvedValue({ ...FATURAMENTO, name: "Faturamento e Cobrança" })
    fireEvent.click(screen.getByRole("button", { name: "Salvar domínio" }))
    await waitFor(() => expect(service.updateBusinessDomain.mock.calls[0]?.[0]).toEqual({ id: "d1", name: "Faturamento e Cobrança", description: "Processos de fatura.", active: true }))
  })

  it("'Utilizado por' mostra pelo nome só o que a pessoa administra; o que é de outros Grupos aparece só na contagem (lote 2 da 4ª auditoria)", async () => {
    service.fetchBusinessDomainsPage.mockResolvedValue({ items: [FATURAMENTO], total: 1, page: 1, pageSize: 10 })
    service.fetchBusinessDomainDependencies.mockResolvedValue({ agents: [{ id: "a1", name: "Especialista de Faturamento", active: true }], orchestrators: [], total: 4, agentsOutOfScope: 2, orchestratorsOutOfScope: 1 })
    renderWithQuery(<BusinessDomainsPage />)
    await screen.findByText("Faturamento")
    fireEvent.click(screen.getByRole("button", { name: "Editar Faturamento" }))
    const dependencies = await screen.findByTestId("domain-dependencies")
    expect(within(dependencies).getByText("Especialista de Faturamento")).toBeInTheDocument()
    expect(within(dependencies).getByText("3")).toBeInTheDocument()
    expect(within(dependencies).getByText("+ 2 em outros Grupos (fora do seu escopo)")).toBeInTheDocument()
    expect(within(dependencies).getByText("+ 1 em outros Grupos (fora do seu escopo)")).toBeInTheDocument()
    expect(within(dependencies).queryByText("Nenhum Orquestrador restrito a este domínio.")).not.toBeInTheDocument()
  })

  it("Excluir: bloqueado com dependências (o botão de confirmação fica desabilitado) e livre sem dependências", async () => {
    service.fetchBusinessDomainsPage.mockResolvedValue({ items: [FATURAMENTO, LOGISTICA], total: 2, page: 1, pageSize: 10 })
    service.deleteBusinessDomain.mockResolvedValue(undefined)
    renderWithQuery(<BusinessDomainsPage />)
    await screen.findByText("Faturamento")
    fireEvent.click(screen.getByRole("button", { name: "Excluir Faturamento" }))
    expect(await screen.findByText(/A exclusão é bloqueada enquanto houver dependências/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Excluir" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    fireEvent.click(screen.getByRole("button", { name: "Excluir Logística" }))
    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }))
    await waitFor(() => expect(service.deleteBusinessDomain.mock.calls[0]?.[0]).toBe("d5"))
  })

  it("Desativar chama o serviço de status — o domínio continua existindo para as referências existentes", async () => {
    service.fetchBusinessDomainsPage.mockResolvedValue({ items: [FATURAMENTO], total: 1, page: 1, pageSize: 10 })
    service.setBusinessDomainActive.mockResolvedValue({ ...FATURAMENTO, active: false })
    renderWithQuery(<BusinessDomainsPage />)
    await screen.findByText("Faturamento")
    fireEvent.click(screen.getByRole("switch", { name: "Desativar Faturamento" }))
    await waitFor(() => expect(service.setBusinessDomainActive.mock.calls[0]?.slice(0, 2)).toEqual(["d1", false]))
  })
})
