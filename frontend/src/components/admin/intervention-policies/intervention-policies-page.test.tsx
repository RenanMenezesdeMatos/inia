/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import * as service from "@/services/admin/intervention-policy-service"

import { InterventionPoliciesPage } from "./intervention-policies-page"
import { CAPABILITIES, CATALOG, EDITOR_CATALOG, OBSERVE_TYPE, policyWithDraft } from "./testing/fixtures"

vi.mock("@/services/admin/intervention-policy-service", async () => (await import("./testing/fixtures")).createServiceMock())
vi.mock("@/services/admin/indicator-rule-service", async (importOriginal) => ({ ...(await importOriginal<object>()), fetchIndicatorsWithRules: vi.fn().mockResolvedValue([]) }))
const session = vi.hoisted(() => ({ capabilities: {} as Record<string, boolean> }))
vi.mock("@/queries/auth/use-current-user", () => ({ useCurrentUserQuery: () => ({ data: { access: { capabilities: session.capabilities } } }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const navigation = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: navigation.push }),
  usePathname: () => "/admin/intervention-policies",
  useSearchParams: () => new URLSearchParams(),
}))

const mocked = vi.mocked(service)

beforeAll(installJsdomStubs)
beforeEach(() => {
  session.capabilities = { ...CAPABILITIES }
  mocked.fetchCapabilityCatalog.mockResolvedValue(CATALOG)
  mocked.fetchInterventionTypes.mockResolvedValue([OBSERVE_TYPE])
  mocked.fetchCompetencies.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Políticas de acompanhamento — lista e criação", () => {
  it("lista as políticas do backend com escopo, vigência, rascunho e status", async () => {
    const inForce = { id: "pv0", version: 1, status: "PUBLISHED" as const, definition: policyWithDraft().draft!.definition, updatedAt: "2026-09-01T10:00:00.000Z", publishedAt: "2026-09-01T10:00:00.000Z", effectiveFrom: "2026-09-01T10:00:00.000Z" }
    const published = policyWithDraft(undefined, { inForce, versions: [{ ...policyWithDraft().draft!, id: "pv2", version: 2 }, inForce], draft: { ...policyWithDraft().draft!, id: "pv2", version: 2 }, evaluations: { last30Days: 12 } })
    const inactive = policyWithDraft(undefined, { id: "p2", key: "RECONHECIMENTO", name: "Reconhecimento de bons resultados", active: false, scopeType: "GROUP", scopeLabel: "Grupo Atendimento" })
    mocked.fetchPolicies.mockResolvedValue([published, inactive])
    renderWithQuery(<InterventionPoliciesPage />)

    const row = await screen.findByTestId("policy-row-ACOMPANHAMENTO_TMA")
    expect(row).toHaveTextContent("Acompanhamento de TMA")
    expect(row).toHaveTextContent("Organização inteira")
    expect(row).toHaveTextContent("v1 desde")
    expect(row).toHaveTextContent("v2")
    expect(row).toHaveTextContent("12")
    expect(row).toHaveTextContent("Ativa")
    const other = screen.getByTestId("policy-row-RECONHECIMENTO")
    expect(other).toHaveTextContent("Grupo Atendimento")
    expect(other).toHaveTextContent("Inativa")
    expect(within(row).getByRole("link", { name: "Acompanhamento de TMA" })).toHaveAttribute("href", "/admin/intervention-policies/p1")
  })

  it("Nova política: sugere a chave a partir do nome, cria com o escopo escolhido e abre a política criada", async () => {
    mocked.fetchPolicies.mockResolvedValue([])
    mocked.createPolicy.mockResolvedValue({ id: "p-new" })
    renderWithQuery(<InterventionPoliciesPage />)

    expect(await screen.findByText("Nenhuma política de acompanhamento")).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: /Nova política/ })[0]!)
    const form = screen.getByTestId("policy-create-form")
    fireEvent.change(within(form).getByLabelText("Nome da política *"), { target: { value: "Retenção de clientes" } })
    expect(within(form).getByLabelText("Chave *")).toHaveValue("RETENCAO_DE_CLIENTES")
    await waitFor(() => expect(within(form).getByRole("button", { name: "Criar política" })).toBeEnabled())
    fireEvent.click(within(form).getByRole("button", { name: "Criar política" }))

    await waitFor(() => expect(mocked.createPolicy.mock.calls[0]?.[0]).toEqual({ key: "RETENCAO_DE_CLIENTES", name: "Retenção de clientes", scopeType: "ORGANIZATION", teamId: null, subteamId: null }))
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/admin/intervention-policies/p-new"))
  })

  it("quem edita com escopo de grupo cria no próprio grupo (os grupos vêm do catálogo do editor, nunca a organização inteira)", async () => {
    mocked.fetchPolicies.mockResolvedValue([])
    mocked.fetchEditorCatalog.mockResolvedValueOnce({ ...EDITOR_CATALOG, unrestricted: false })
    mocked.createPolicy.mockResolvedValue({ id: "p-group" })
    renderWithQuery(<InterventionPoliciesPage />)

    fireEvent.click((await screen.findAllByRole("button", { name: /Nova política/ }))[0]!)
    const form = screen.getByTestId("policy-create-form")
    fireEvent.change(within(form).getByLabelText("Nome da política *"), { target: { value: "TMA do grupo" } })
    await waitFor(() => expect(within(form).getByRole("button", { name: "Criar política" })).toBeEnabled())
    expect(within(form).queryByText("Todos os grupos")).not.toBeInTheDocument()
    fireEvent.click(within(form).getByRole("button", { name: "Criar política" }))
    await waitFor(() => expect(mocked.createPolicy.mock.calls[0]?.[0]).toEqual({ key: "TMA_DO_GRUPO", name: "TMA do grupo", scopeType: "GROUP", teamId: "team-1", subteamId: null }))
  })

  it("sem permissão de edição, 'Nova política' fica desabilitado e a aba Auditoria não aparece sem permissão de auditoria", async () => {
    session.capabilities = { ...CAPABILITIES, canEditInterventionPolicies: false, canAuditInterventionPolicies: false }
    mocked.fetchPolicies.mockResolvedValue([policyWithDraft(undefined, { can: { edit: false, publish: false, simulate: true } })])
    renderWithQuery(<InterventionPoliciesPage />)
    await screen.findByTestId("policy-row-ACOMPANHAMENTO_TMA")
    expect(screen.getByRole("button", { name: /Nova política/ })).toBeDisabled()
    expect(screen.queryByRole("tab", { name: "Auditoria" })).not.toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Tipos de intervenção" })).toBeInTheDocument()
  })
})
