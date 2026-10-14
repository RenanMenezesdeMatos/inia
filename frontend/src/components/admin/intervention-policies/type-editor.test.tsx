/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import * as service from "@/services/admin/intervention-policy-service"

import { InterventionPoliciesPage } from "./intervention-policies-page"
import { CATALOG, OBSERVE_TYPE } from "./testing/fixtures"

vi.mock("@/services/admin/intervention-policy-service", async () => (await import("./testing/fixtures")).createServiceMock())
vi.mock("@/services/admin/indicator-rule-service", async (importOriginal) => ({ ...(await importOriginal<object>()), fetchIndicatorsWithRules: vi.fn().mockResolvedValue([]) }))
vi.mock("@/queries/auth/use-current-user", async () => {
  const { CAPABILITIES: capabilities } = await import("./testing/fixtures")
  return { useCurrentUserQuery: () => ({ data: { access: { capabilities } } }) }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/intervention-policies",
  useSearchParams: () => new URLSearchParams(),
}))

const mocked = vi.mocked(service)

beforeAll(installJsdomStubs)
beforeEach(() => {
  mocked.fetchCapabilityCatalog.mockResolvedValue(CATALOG)
  mocked.fetchInterventionTypes.mockResolvedValue([OBSERVE_TYPE])
  mocked.fetchCompetencies.mockResolvedValue([])
  mocked.fetchPolicies.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Tipos de intervenção", () => {
  it("'Solicitar avaliação de continuidade' aplica as regras fixas e mostra o aviso permanente; o rascunho salvo respeita as regras", async () => {
    mocked.saveInterventionTypeDraft.mockResolvedValue({ ...OBSERVE_TYPE })
    renderWithQuery(<InterventionPoliciesPage />)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Tipos de intervenção" }))
    const row = await screen.findByTestId("type-row-OBSERVAR")
    fireEvent.click(within(row).getByRole("button", { name: "Abrir e editar" }))
    const editor = await screen.findByTestId("type-editor")
    // Publicado sem rascunho: só leitura até abrir um novo rascunho.
    fireEvent.click(within(editor).getByRole("button", { name: /Editar \(novo rascunho\)/ }))
    fireEvent.click(within(editor).getByRole("checkbox", { name: /Solicitar avaliação de continuidade/ }))

    const note = within(editor).getByTestId("continuity-review-note")
    expect(note).toHaveTextContent("A INIA nunca decide nem executa desligamento e nunca altera a situação funcional do colaborador.")
    expect(within(editor).getByRole("checkbox", { name: /Observação/ })).toBeDisabled()
    expect(within(editor).getByRole("switch", { name: "Exige aprovação antes de começar" })).toBeChecked()
    expect(within(editor).getByRole("switch", { name: "Exige aprovação antes de começar" })).toBeDisabled()

    fireEvent.click(within(editor).getByRole("button", { name: /Salvar rascunho/ }))
    await waitFor(() => expect(mocked.saveInterventionTypeDraft).toHaveBeenCalledTimes(1))
    const [typeId, definition] = mocked.saveInterventionTypeDraft.mock.calls[0]!
    expect(typeId).toBe("t1")
    expect(definition.capabilities).toEqual(["CONTINUITY_REVIEW"])
    expect(definition.approval).toEqual({ required: true, approverRole: "MANAGER" })
    expect(definition.evidence.minimumItems).toBeGreaterThanOrEqual(1)
    expect(definition.aiDraft).toBe(false)
  })
})
