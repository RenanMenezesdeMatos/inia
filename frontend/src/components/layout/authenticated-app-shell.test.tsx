/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { NO_ACCESS_CAPABILITIES } from "@/schemas/auth/auth.schema"

/**
 * Fronteira de sessão = documento novo (achado C08 da 4ª auditoria): sair, sair de todos os aparelhos, inatividade e sessão
 * perdida nunca usam o roteador do Next — que guardava em memória as páginas da conta anterior e o Voltar as restaurava. A saída
 * só carrega o login DEPOIS de o logout terminar no servidor.
 */
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => navigation }))
const documentLoad = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/session-navigation", () => ({ loadSessionDocument: documentLoad }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const auth = vi.hoisted(() => ({ logout: vi.fn(), logoutEverywhere: vi.fn() }))
vi.mock("@/services/auth/auth-service", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/services/auth/auth-service")>()), ...auth }))
const usage = vi.hoisted(() => ({ shutdownUsageForLogout: vi.fn(async () => undefined) }))
vi.mock("@/lib/usage/usage-provider", () => ({ ...usage, UsageAnalyticsProvider: ({ children }: { children: React.ReactNode }) => children }))
const session = vi.hoisted(() => ({ current: { data: undefined as unknown, isSuccess: false } }))
vi.mock("@/queries/auth/use-current-user", () => ({ useCurrentUserQuery: () => session.current }))
vi.mock("@/components/profile/edit-profile/profile-editor-context", () => ({ useProfileEditor: () => ({ open: vi.fn() }) }))
const idle = vi.hoisted(() => ({ onExpired: null as null | (() => void) }))
vi.mock("@/components/auth/session-idle-guard", () => ({ SessionIdleGuard: ({ onExpired }: { onExpired: () => void }) => ((idle.onExpired = onExpired), null) }))
vi.mock("@/components/layout/top-bar/app-top-bar", () => ({
  AppTopBar: ({ onSignOut, onSignOutEverywhere }: { onSignOut: () => void; onSignOutEverywhere: () => void }) => (
    <div>
      <button onClick={onSignOut}>Sair</button>
      <button onClick={onSignOutEverywhere}>Sair de todos os aparelhos</button>
    </div>
  ),
}))

import { AuthenticatedAppShell } from "./authenticated-app-shell"

const ME = { sub: "acc-1", personId: "p-1", organizationId: "org", role: "SUPERVISOR" as const, name: "Marta Lima", email: "marta@inia.local", avatarUrl: null, jobTitle: null, teamId: null, teamName: null, preferredName: null, passwordChangeRequired: false, temporaryPasswordExpiresAt: null, sessionIdleTimeoutMinutes: 30, access: { permissions: [], capabilities: NO_ACCESS_CAPABILITIES, roles: [] }, features: { interactionFeedbackQa: false, usageCollection: false, usabilityPanel: false } }

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  session.current = { data: undefined, isSuccess: false }
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

describe("shell autenticado — saída da sessão", () => {
  it("'Sair' derruba a sessão no servidor e SÓ ENTÃO carrega o login como documento novo, sem o roteador", async () => {
    session.current = { data: ME, isSuccess: true }
    const pending = deferred()
    auth.logout.mockReturnValue(pending.promise)
    renderWithQuery(<AuthenticatedAppShell><p>Caso da Marta</p></AuthenticatedAppShell>)
    fireEvent.click(screen.getByRole("button", { name: "Sair" }))
    await waitFor(() => expect(auth.logout).toHaveBeenCalled())
    expect(usage.shutdownUsageForLogout).toHaveBeenCalled()
    expect(documentLoad).not.toHaveBeenCalled()
    await act(async () => pending.resolve())
    await waitFor(() => expect(documentLoad).toHaveBeenCalledWith("/auth/login", { replace: true }))
    expect(navigation.push).not.toHaveBeenCalled()
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it("logout que falha (sessão já caída) ainda leva ao login como documento novo", async () => {
    session.current = { data: ME, isSuccess: true }
    auth.logout.mockRejectedValue(new Error("401"))
    renderWithQuery(<AuthenticatedAppShell><p>Caso</p></AuthenticatedAppShell>)
    fireEvent.click(screen.getByRole("button", { name: "Sair" }))
    await waitFor(() => expect(documentLoad).toHaveBeenCalledWith("/auth/login", { replace: true }))
  })

  it("'Sair de todos os aparelhos' e inatividade: o mesmo caminho, com o motivo no login", async () => {
    session.current = { data: ME, isSuccess: true }
    auth.logoutEverywhere.mockResolvedValue(undefined)
    auth.logout.mockResolvedValue(undefined)
    renderWithQuery(<AuthenticatedAppShell><p>Caso</p></AuthenticatedAppShell>)
    fireEvent.click(screen.getByRole("button", { name: "Sair de todos os aparelhos" }))
    await waitFor(() => expect(documentLoad).toHaveBeenCalledWith("/auth/login?motivo=todos-os-aparelhos", { replace: true }))
    act(() => idle.onExpired!())
    await waitFor(() => expect(documentLoad).toHaveBeenCalledWith("/auth/login?motivo=inatividade", { replace: true }))
    expect(auth.logout).toHaveBeenCalled()
    expect(navigation.push).not.toHaveBeenCalled()
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it("sessão perdida (o servidor responde sem conta): login como documento novo", async () => {
    session.current = { data: null, isSuccess: true }
    renderWithQuery(<AuthenticatedAppShell><p>Caso</p></AuthenticatedAppShell>)
    await waitFor(() => expect(documentLoad).toHaveBeenCalledWith("/auth/login", { replace: true }))
    expect(navigation.replace).not.toHaveBeenCalled()
  })
})
