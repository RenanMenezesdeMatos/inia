/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"

import { PublicationsListPage } from "./publications-list-page"

/**
 * Publicações com os dois tipos: Comunicados e Alinhamentos operacionais (a MESMA tela de alinhamentos, por dentro, sem o cabeçalho
 * próprio). A aba vem do endereço; quem só gerencia alinhamentos cai direto neles; "Nova publicação › Alinhamento" abre o formulário.
 */
const state = vi.hoisted(() => ({ params: new URLSearchParams(), caps: { canPublishTeamCommunications: true, canManageOperationalAlignments: true } as Record<string, boolean> }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/publicacoes", useSearchParams: () => state.params }))
vi.mock("@/services/auth/auth-service", () => ({ fetchCurrentUser: async () => ({ personId: "me", name: "Ana", access: { capabilities: state.caps } }) }))
vi.mock("@/services/communications/communication-service", () => ({ fetchMyCommunications: async () => [], fetchModerationCommunications: async () => [] }))
vi.mock("@/components/operational-alignments/operational-alignments-page", () => ({
  OperationalAlignmentsPage: ({ embedded, startWithNew }: { embedded?: boolean; startWithNew?: boolean }) => <div data-testid="alignments" data-embedded={String(embedded)} data-new={String(startWithNew)} />,
}))

beforeAll(() => installJsdomStubs())
afterEach(() => { cleanup(); state.params = new URLSearchParams(); state.caps = { canPublishTeamCommunications: true, canManageOperationalAlignments: true } })

describe("Publicações — comunicados e alinhamentos", () => {
  it("com as duas permissões: abas; comunicados por padrão", async () => {
    renderWithQuery(<PublicationsListPage />)
    expect(await screen.findByRole("tab", { name: /Comunicados/ })).toHaveAttribute("data-state", "active")
    expect(screen.getByRole("tab", { name: /Alinhamentos operacionais/ })).toBeInTheDocument()
    expect(screen.queryByTestId("alignments")).toBeNull()
  })

  it("?tipo=alinhamentos&novo=1: a tela de alinhamentos, por dentro e já no formulário", async () => {
    state.params = new URLSearchParams("tipo=alinhamentos&novo=1")
    renderWithQuery(<PublicationsListPage />)
    const alignments = await screen.findByTestId("alignments")
    expect(alignments).toHaveAttribute("data-embedded", "true")
    expect(alignments).toHaveAttribute("data-new", "true")
  })

  it("só alinhamentos: sem abas, direto neles; só comunicados: o pedido de alinhamentos é ignorado", async () => {
    state.caps = { canManageOperationalAlignments: true }
    renderWithQuery(<PublicationsListPage />)
    expect(await screen.findByTestId("alignments")).toBeInTheDocument()
    expect(screen.queryByRole("tab")).toBeNull()
    cleanup()
    state.caps = { canPublishTeamCommunications: true }
    state.params = new URLSearchParams("tipo=alinhamentos")
    renderWithQuery(<PublicationsListPage />)
    expect(await screen.findByText("Nenhuma publicação ainda")).toBeInTheDocument()
    expect(screen.queryByTestId("alignments")).toBeNull()
  })
})
