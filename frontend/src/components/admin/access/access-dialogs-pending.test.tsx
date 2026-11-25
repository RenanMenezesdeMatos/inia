/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { adminQueryKeys } from "@/queries/admin/admin-query-keys"
import { useCreateUserAccountMutation, useUpdateUserActiveMutation } from "@/queries/admin/use-user-account-queries"
import { accessQueryRootKey, useEnableUserAccessMutation } from "@/queries/access/use-access"
import type { IdentifiedUser } from "@/schemas/access/access.schema"

import { AccessUsersView } from "./access-users-view"
import { NetworkBulkEnableDialog } from "./network-bulk-enable-dialog"

const service = vi.hoisted(() => ({ fetchIdentifiedUsers: vi.fn(), enableUserAccess: vi.fn(), issueTemporaryPassword: vi.fn(), disableUserAccess: vi.fn(), downloadNetworkEnableTemplate: vi.fn(), previewNetworkEnable: vi.fn(), applyNetworkEnable: vi.fn(), checkNetworkLogin: vi.fn(), fetchAccessAccount: vi.fn(), fetchAccessRoles: vi.fn(), fetchScopeOptions: vi.fn(), assignAccessRole: vi.fn(), revokeAccessRole: vi.fn() }))
vi.mock("@/services/access/access-service", () => service)
const accounts = vi.hoisted(() => ({ createUserAccount: vi.fn(), updateUserActive: vi.fn() }))
vi.mock("@/services/admin/user-account-service", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/services/admin/user-account-service")>()), ...accounts }))
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/users", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const REPORT = { ignoredColumns: [], counts: { CREATE: 1, REENABLE: 0, ALREADY_ENABLED: 0, REFUSED: 0 }, rows: [] }
const user: IdentifiedUser = {
  personId: "p-1", name: "Ana Prado", matricula: "G0000010", jobTitle: "Assistente", level: "OPERATOR", personActive: true, team: null, subteam: null, self: false,
  accessStatus: "DISABLED", temporaryPasswordExpired: false, canIssueTemporaryPassword: false, enableCredential: "NETWORK", networkIssue: null, networkAttempts: null, loginGuide: null, account: null,
}
// O jsdom não implementa `File.arrayBuffer`.
const fileOf = (content: string) => Object.assign(new File([content], "lista.csv", { type: "text/csv" }), { arrayBuffer: async () => new TextEncoder().encode(content).buffer })
const pending = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeAll(installJsdomStubs)
afterEach(() => { cleanup(); vi.clearAllMocks() })

/** QAF-08 (run-12): fechar no meio da gravação perdia o relatório do CSV, a senha temporária ou o erro. */
describe("diálogos de habilitar enquanto gravam", () => {
  it("CSV: Esc durante \"Habilitando…\" não fecha; depois do resultado, fecha", async () => {
    const apply = pending<typeof REPORT>()
    service.previewNetworkEnable.mockResolvedValue(REPORT)
    service.applyNetworkEnable.mockReturnValue(apply.promise)
    const onOpenChange = vi.fn()
    renderWithQuery(<NetworkBulkEnableDialog open onOpenChange={onOpenChange} />)
    fireEvent.change(screen.getByLabelText("Arquivo CSV de matrículas"), { target: { files: [fileOf("matricula\nG0000010")] } })
    fireEvent.click(await screen.findByRole("button", { name: "Habilitar 1 pessoa" }))
    await screen.findByRole("button", { name: "Habilitando…" })
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => { apply.resolve(REPORT) })
    await screen.findByRole("button", { name: "Concluir" })
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("Habilitar acesso: Esc e Cancelar esperam a resposta; a recusa continua à vista", async () => {
    let fail!: (error: Error) => void
    service.enableUserAccess.mockReturnValue(new Promise((_resolve, reject) => { fail = reject }))
    service.fetchIdentifiedUsers.mockResolvedValue({ items: [user], total: 1, page: 1, pageSize: 20, temporaryPasswordTtlHours: 72, networkLoginEnabled: true })
    renderWithQuery(<AccessUsersView canManageUsers canAssignRoles={false} />)
    fireEvent.click(await screen.findByRole("button", { name: /^Habilitar acesso$/ }))
    const form = await screen.findByRole("form", { name: "Habilitar acesso" })
    fireEvent.click(within(form).getByRole("button", { name: "Habilitar acesso" }))
    expect(await within(form).findByRole("button", { name: "Habilitando…" })).toBeDisabled()
    expect(within(form).getByRole("button", { name: "Cancelar" })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    await act(async () => { fail(new Error("Matrícula repetida no cadastro.")) })
    expect(await screen.findByRole("alert")).toHaveTextContent("Matrícula repetida")
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
})

/** QAF-09 (run-12): Acessos e Pessoas mostram a mesma conta; mudar numa recarrega a outra. */
describe("Acessos × Pessoas", () => {
  const setup = () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, "invalidateQueries")
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const asked = (key: readonly unknown[]) => invalidate.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(key))
    return { wrapper, asked }
  }

  it("habilitar em Acessos recarrega Pessoas", async () => {
    const { wrapper, asked } = setup()
    service.enableUserAccess.mockResolvedValue({ credential: "NETWORK" })
    const { result } = renderHook(() => useEnableUserAccessMutation(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ personId: "p-1" }) })
    await waitFor(() => expect(asked(adminQueryKeys.users())).toBe(true))
    expect(asked(accessQueryRootKey)).toBe(true)
  })

  it("criar e inativar em Pessoas recarrega Acessos", async () => {
    for (const run of ["create", "active"] as const) {
      const { wrapper, asked } = setup()
      accounts.createUserAccount.mockResolvedValue({})
      accounts.updateUserActive.mockResolvedValue({})
      const { result } = renderHook(() => ({ create: useCreateUserAccountMutation(), active: useUpdateUserActiveMutation() }), { wrapper })
      await act(async () => { await (run === "create" ? result.current.create.mutateAsync({} as never) : result.current.active.mutateAsync({ personId: "p-1", active: false })) })
      expect(asked(accessQueryRootKey)).toBe(true)
      expect(asked(adminQueryKeys.users())).toBe(true)
    }
  })
})
