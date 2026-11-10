/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { useEffect } from "react"
import { act, cleanup, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { currentUserSchema, type CurrentUser } from "@/schemas/auth/auth.schema"

import { AuthenticatedAppShell } from "./authenticated-app-shell"

const auth = vi.hoisted(() => ({ fetchCurrentUser: vi.fn() }))
// O estado do Apoio com Anjo faz chamadas à API; aqui só a árvore importa.
vi.mock("@/queries/human-support/use-human-support-state", () => ({ HumanSupportStateProvider: ({ children }: { children: React.ReactNode }) => children }))
vi.mock("@/services/auth/auth-service", async (original) => ({ ...(await original<object>()), ...auth }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/operator", useSearchParams: () => new URLSearchParams() }))
// O cabeçalho real (menus, sino, seletor de área) não interessa aqui: só se ele entra na árvore.
vi.mock("@/components/layout/top-bar/app-top-bar", () => ({ AppTopBar: ({ profile }: { profile: { name: string } }) => <header>Cabeçalho de {profile.name}</header> }))

const USER: CurrentUser = currentUserSchema.parse({
  sub: "acc-1", personId: "p-1", organizationId: "org-1", role: "OPERATOR", name: "Larissa Monteiro", email: "larissa@example.com",
  avatarUrl: null, jobTitle: null, teamId: null, teamName: null,
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("AuthenticatedAppShell", () => {
  it("a sessão chegar não remonta a página: o cabeçalho entra na mesma árvore", async () => {
    let resolveUser!: (user: CurrentUser) => void
    auth.fetchCurrentUser.mockReturnValue(new Promise<CurrentUser>((resolve) => { resolveUser = resolve }))
    const mounts = vi.fn()
    function Page() {
      useEffect(() => { mounts() }, [])
      return <p>Conteúdo da página</p>
    }

    renderWithQuery(<AuthenticatedAppShell><Page /></AuthenticatedAppShell>)
    // Antes da sessão (como no servidor): a página já está na tela, sem cabeçalho.
    expect(screen.getByText("Conteúdo da página")).toBeInTheDocument()
    expect(screen.queryByText(/Cabeçalho de/)).not.toBeInTheDocument()
    expect(mounts).toHaveBeenCalledTimes(1)

    await act(async () => resolveUser(USER))
    expect(await screen.findByText("Cabeçalho de Larissa Monteiro")).toBeInTheDocument()
    expect(screen.getByText("Conteúdo da página")).toBeInTheDocument()
    // Remontar rodaria o efeito de montagem de novo (o chat recarregava a conversa).
    expect(mounts).toHaveBeenCalledTimes(1)
  })
})
