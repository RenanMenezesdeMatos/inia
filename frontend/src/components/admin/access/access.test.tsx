/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { AppTopBar } from "@/components/layout/top-bar/app-top-bar"
import { areasFor } from "@/components/layout/top-bar/area-switcher"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AdminApiError } from "@/lib/admin/admin-api"
import type { AccessAccount, AccessRole, IdentifiedUser } from "@/schemas/access/access.schema"
import { accessCapabilitiesSchema, type AccessCapabilities } from "@/schemas/auth/auth.schema"

import { useCurrentUserQuery } from "@/queries/auth/use-current-user"
import { useFeedbackQualityAccessQuery } from "@/queries/feedback-review/use-feedback-reviews"

import { AccessUsersView } from "./access-users-view"
import { AccessRolesView } from "./access-roles-view"
import { UsersAndAccessPage } from "./users-and-access-page"

const service = vi.hoisted(() => ({ fetchIdentifiedUsers: vi.fn(), fetchAccessAccount: vi.fn(), fetchAccessRoles: vi.fn(), fetchScopeOptions: vi.fn(), enableUserAccess: vi.fn(), issueTemporaryPassword: vi.fn(), disableUserAccess: vi.fn(), assignAccessRole: vi.fn(), revokeAccessRole: vi.fn(), grantRoleToLeaders: vi.fn() }))
vi.mock("@/services/access/access-service", () => service)
vi.mock("@/components/admin/users/users-page", () => ({ UsersPage: () => <p>cadastro de pessoas</p> }))
const session = vi.hoisted(() => ({ fetchCurrentUser: vi.fn(), fetchFeedbackQualityAccess: vi.fn(), refresh: vi.fn() }))
vi.mock("@/services/auth/auth-service", () => ({ fetchCurrentUser: session.fetchCurrentUser }))
vi.mock("@/services/feedback-review/feedback-review-service", () => ({ fetchFeedbackQualityAccess: session.fetchFeedbackQualityAccess }))
vi.mock("@/components/notifications/notification-bell", () => ({ NotificationBell: () => null }))
vi.mock("@/components/layout/user-menu/app-user-menu", () => ({ AppUserMenu: () => null }))
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/users", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: session.refresh, push: vi.fn(), replace: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const caps = (patch: Partial<AccessCapabilities> = {}): AccessCapabilities => ({ ...accessCapabilitiesSchema.parse({}), ...patch })
const MARIA: AccessAccount = {
  accountId: "acc-maria", email: "maria@inia.local", active: true, lastLoginAt: null,
  collaborator: { personId: "p-maria", name: "Maria Silva", jobTitle: "Assistente", level: "OPERATOR", active: true, team: { id: "t-b2b", name: "B2B" }, subteam: { id: "s-contas", name: "Contas" } },
  roles: [{ id: "as-1", roleCode: "QA_DE_FEEDBACK", roleName: "QA de feedback", scopeLabel: "Subgrupo Contas", scope: { type: "SUBGROUP" }, grantedAt: "2026-09-25T12:00:00.000Z", grantedByName: "Admin Geral" }],
}
const JOAO: AccessAccount = { ...MARIA, accountId: "acc-joao", email: "joao@inia.local", collaborator: { ...MARIA.collaborator, personId: "p-joao", name: "João Souza", jobTitle: "Supervisor", level: "SUPERVISOR" }, roles: [] }
/** A mesma pessoa vista pela lista de Acessos (pessoas identificadas × situação do login). */
const identified = (account: AccessAccount, patch: Partial<IdentifiedUser> = {}): IdentifiedUser => ({
  personId: account.collaborator.personId, name: account.collaborator.name, matricula: null, jobTitle: account.collaborator.jobTitle, level: account.collaborator.level, personActive: true,
  team: account.collaborator.team, subteam: account.collaborator.subteam, self: false, accessStatus: "ACTIVE", temporaryPasswordExpired: false,
  account: { accountId: account.accountId, email: account.email, active: true, lastLoginAt: null, passwordChangeRequired: false, temporaryPasswordIssuedAt: null, temporaryPasswordExpiresAt: null, accessDisabledAt: null, roles: account.roles.map((role) => ({ code: role.roleCode, name: role.roleName })) },
  ...patch,
})
const page = (items: IdentifiedUser[]) => ({ items, total: items.length, page: 1, pageSize: 20, temporaryPasswordTtlHours: 72 })
const ROLE = (code: string, name: string, assignableByYou: boolean, allowedScopes: AccessRole["allowedScopes"]): AccessRole => ({ code, name, description: `${name} — descrição`, system: true, allowedScopes, permissions: [{ code: "x", label: `permissão de ${name}` }], assignableByYou })
const ROLES = [ROLE("ADMINISTRADOR_GERAL", "Administrador geral", false, ["ORGANIZATION"]), ROLE("ADMINISTRADOR", "Administrador", false, ["ORGANIZATION", "GROUP", "SUBGROUP"]), ROLE("QA_DE_FEEDBACK", "QA de feedback", true, ["ORGANIZATION", "GROUP", "SUBGROUP", "MY_STRUCTURE"])]

beforeAll(installJsdomStubs)
afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear() })

describe("Usuários e acessos — contas × papéis (V1.5.7)", () => {
  it("lista as pessoas identificadas com o CARGO como dado informativo, a situação do acesso e os PAPÉIS separados", async () => {
    service.fetchIdentifiedUsers.mockResolvedValue(page([identified(MARIA), identified(JOAO)]))
    renderWithQuery(<AccessUsersView canManageUsers canAssignRoles />)
    const rows = await screen.findAllByTestId("access-user-row")
    expect(within(rows[0]!).getByText("Cargo: Assistente · B2B › Contas")).toBeInTheDocument()
    expect(within(rows[0]!).getByText("QA de feedback")).toBeInTheDocument()
    expect(within(rows[0]!).getByText("Ativo")).toBeInTheDocument()
    expect(within(rows[1]!).getByText("Cargo: Supervisor · B2B › Contas")).toBeInTheDocument()
    expect(within(rows[1]!).queryByLabelText("Papéis de acesso")).not.toBeInTheDocument()
    expect(screen.queryByText(/Perfil/)).not.toBeInTheDocument()
  })

  it("carregando, vazio e erro", async () => {
    service.fetchIdentifiedUsers.mockReturnValue(new Promise(() => {}))
    const first = renderWithQuery(<AccessUsersView canManageUsers={false} canAssignRoles={false} />)
    expect(document.querySelector("[data-slot=skeleton]") ?? screen.queryAllByRole("status")).toBeTruthy()
    first.unmount()
    service.fetchIdentifiedUsers.mockResolvedValue(page([]))
    const second = renderWithQuery(<AccessUsersView canManageUsers={false} canAssignRoles={false} />)
    expect(await screen.findByText("Nenhuma pessoa no seu escopo")).toBeInTheDocument()
    second.unmount()
    service.fetchIdentifiedUsers.mockRejectedValue(new AdminApiError("Você não tem permissão para esta ação.", "FORBIDDEN"))
    renderWithQuery(<AccessUsersView canManageUsers={false} canAssignRoles={false} />)
    expect(await screen.findByText("Você não tem permissão para esta ação.")).toBeInTheDocument()
  })

  it("atribuir QA de feedback: só papéis delegáveis e só os escopos que o admin escopado alcança (sem Organização); envia papel + escopo", async () => {
    service.fetchIdentifiedUsers.mockResolvedValue(page([identified(JOAO)]))
    service.fetchAccessAccount.mockResolvedValue(JOAO)
    service.fetchAccessRoles.mockResolvedValue(ROLES)
    service.fetchScopeOptions.mockResolvedValue({ organizationWide: false, teams: [], subteams: [{ id: "s-contas", name: "Contas", teamId: "t-b2b", teamName: "B2B" }] })
    service.assignAccessRole.mockResolvedValue({ id: "as-9" })
    renderWithQuery(<AccessUsersView canManageUsers canAssignRoles />)
    fireEvent.click((await screen.findAllByRole("button", { name: /^Papéis de / }))[0]!)
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("Cargo")).toBeInTheDocument()
    expect(within(dialog).getByText("Nível hierárquico")).toBeInTheDocument()
    expect(within(dialog).getAllByText("Supervisor")).toHaveLength(2)
    expect(within(dialog).getByText(/Nenhum papel/)).toBeInTheDocument()
    const form = await within(dialog).findByRole("form", { name: "Adicionar papel" })
    fireEvent.click(within(form).getByRole("combobox", { name: "Papel" }))
    expect(screen.queryByRole("option", { name: "Administrador geral" })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole("option", { name: "QA de feedback" }))
    fireEvent.click(within(form).getByRole("combobox", { name: "Escopo" }))
    expect(screen.queryByRole("option", { name: "Toda a organização" })).not.toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Grupo" })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole("option", { name: "Subgrupo" }))
    fireEvent.click(within(form).getByRole("combobox", { name: "Subgrupo" }))
    fireEvent.click(await screen.findByRole("option", { name: "B2B › Contas" }))
    fireEvent.click(within(form).getByRole("button", { name: /Atribuir papel/ }))
    await waitFor(() => expect(service.assignAccessRole).toHaveBeenCalledWith("acc-joao", { roleCode: "QA_DE_FEEDBACK", scope: { type: "SUBGROUP", subteamId: "s-contas" } }))
  })

  it("erro de delegação do backend aparece para quem atribui (o backend decide)", async () => {
    service.fetchIdentifiedUsers.mockResolvedValue(page([identified(JOAO)]))
    service.fetchAccessAccount.mockResolvedValue(JOAO)
    service.fetchAccessRoles.mockResolvedValue(ROLES)
    service.fetchScopeOptions.mockResolvedValue({ organizationWide: true, teams: [{ id: "t-b2b", name: "B2B" }], subteams: [] })
    service.assignAccessRole.mockRejectedValue(new AdminApiError("Ninguém pode conceder ou ampliar o próprio acesso — outra pessoa autorizada precisa fazer isso.", "ACCESS_SELF_ASSIGNMENT"))
    renderWithQuery(<AccessUsersView canManageUsers canAssignRoles />)
    fireEvent.click((await screen.findAllByRole("button", { name: /^Papéis de / }))[0]!)
    const form = await within(await screen.findByRole("dialog")).findByRole("form", { name: "Adicionar papel" })
    fireEvent.click(within(form).getByRole("combobox", { name: "Papel" }))
    fireEvent.click(await screen.findByRole("option", { name: "QA de feedback" }))
    fireEvent.click(within(form).getByRole("combobox", { name: "Escopo" }))
    fireEvent.click(await screen.findByRole("option", { name: "Toda a organização" }))
    fireEvent.click(within(form).getByRole("button", { name: /Atribuir papel/ }))
    expect(await within(form).findByRole("alert")).toHaveTextContent("próprio acesso")
  })

  it("revogar papel pede confirmação e chama o backend", async () => {
    service.fetchIdentifiedUsers.mockResolvedValue(page([identified(MARIA)]))
    service.fetchAccessAccount.mockResolvedValue(MARIA)
    service.fetchAccessRoles.mockResolvedValue(ROLES)
    service.fetchScopeOptions.mockResolvedValue({ organizationWide: true, teams: [], subteams: [] })
    service.revokeAccessRole.mockResolvedValue(undefined)
    renderWithQuery(<AccessUsersView canManageUsers canAssignRoles />)
    fireEvent.click((await screen.findAllByRole("button", { name: /^Papéis de / }))[0]!)
    fireEvent.click(await within(await screen.findByRole("dialog")).findByRole("button", { name: "Revogar QA de feedback" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revogar" }))
    await waitFor(() => expect(service.revokeAccessRole).toHaveBeenCalledWith("acc-maria", "as-1", undefined))
  })

  it("sem permissão de atribuir: o detalhe mostra os papéis sem ações de conceder/revogar", async () => {
    service.fetchIdentifiedUsers.mockResolvedValue(page([identified(MARIA)]))
    service.fetchAccessAccount.mockResolvedValue(MARIA)
    renderWithQuery(<AccessUsersView canManageUsers={false} canAssignRoles={false} />)
    fireEvent.click((await screen.findAllByRole("button", { name: /^Papéis de / }))[0]!)
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("QA de feedback")).toBeInTheDocument()
    expect(within(dialog).queryByRole("form", { name: "Adicionar papel" })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: /Revogar/ })).not.toBeInTheDocument()
  })

  it("Papéis: QA de feedback aparece como PAPEL com as permissões e se você pode concedê-lo", async () => {
    service.fetchAccessRoles.mockResolvedValue(ROLES)
    renderWithQuery(<AccessRolesView />)
    const cards = await screen.findAllByTestId("access-role")
    const qa = cards.find((card) => within(card).queryByText("QA de feedback"))!
    expect(within(qa).getByText("Você pode conceder")).toBeInTheDocument()
    expect(within(qa).getByText("permissão de QA de feedback")).toBeInTheDocument()
  })
})

describe("Usuários e acessos — o que cada um enxerga vem das capabilities (derivadas dos papéis)", () => {
  it("abas por capability; sem nenhuma, a tela explica e não carrega nada", async () => {
    service.fetchIdentifiedUsers.mockResolvedValue(page([]))
    const accessAdmin = renderWithQuery(<UsersAndAccessPage capabilities={caps({ canViewUsers: true, canViewRoles: true, canManageUsers: true, canAssignRoles: true })} />)
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Acessos", "Papéis"])
    accessAdmin.unmount()
    renderWithQuery(<UsersAndAccessPage capabilities={caps()} />)
    expect(screen.getByText(/não tem permissão/)).toBeInTheDocument()
    expect(service.fetchIdentifiedUsers).toHaveBeenCalledTimes(1)
  })

  it("menu da Administração: sem capability não aparece; QA Lab só com canUseQaLab; supervisor sem papel não vê 'Administração'", () => {
    const sidebar = (capabilities: AccessCapabilities) => renderWithQuery(<SidebarProvider><AdminSidebar capabilities={capabilities} /></SidebarProvider>)
    const accessAdmin = sidebar(caps({ canAccessAdministration: true, canViewUsers: true }))
    expect(screen.getByText("Usuários e acessos")).toBeInTheDocument()
    expect(screen.queryByText("Workflows")).not.toBeInTheDocument()
    expect(screen.queryByText("Agentes")).not.toBeInTheDocument()
    expect(screen.queryByText("QA Lab")).not.toBeInTheDocument()
    expect(screen.queryByText("Governança")).not.toBeInTheDocument()
    accessAdmin.unmount()
    sidebar(caps({ canAccessAdministration: true, canManageWorkflows: true, canUseQaLab: true }))
    expect(screen.getByText("Workflows")).toBeInTheDocument()
    expect(screen.getByText("QA Lab")).toBeInTheDocument()
    cleanup()
    // Seletor de área do cabeçalho: "Administração" só com a capability.
    const labels = (options: Parameters<typeof areasFor>[0]) => areasFor(options).areas.map((area) => area.label)
    expect(labels({ profileHref: "/supervisor", canAccessAdministration: false, canReviewFeedback: false, canViewDiagnostics: false })).toEqual(["Meu perfil"])
    expect(labels({ profileHref: "/supervisor", canAccessAdministration: true, canReviewFeedback: false, canViewDiagnostics: false })).toEqual(["Meu perfil", "Administração"])
  })

  it("V1.5.8a: atribuir e revogar papel recarregam a sessão (/auth/me), o acesso do QA e a página — sem logout, sem esperar cache", async () => {
    session.fetchCurrentUser.mockResolvedValue(null)
    session.fetchFeedbackQualityAccess.mockResolvedValue({ enabled: true, canReview: false, canDecide: false, scopes: [] })
    // Consumidores reais dessas queries (menus/QA) montados junto da tela de acessos.
    function Dependents() { useCurrentUserQuery(); useFeedbackQualityAccessQuery(); return null }
    service.fetchIdentifiedUsers.mockResolvedValue(page([identified(MARIA)]))
    service.fetchAccessAccount.mockResolvedValue(MARIA)
    service.fetchAccessRoles.mockResolvedValue(ROLES)
    service.fetchScopeOptions.mockResolvedValue({ organizationWide: true, teams: [], subteams: [] })
    service.assignAccessRole.mockResolvedValue({ id: "as-9" })
    service.revokeAccessRole.mockResolvedValue(undefined)
    renderWithQuery(<><Dependents /><AccessUsersView canManageUsers canAssignRoles /></>)
    await waitFor(() => expect(session.fetchFeedbackQualityAccess).toHaveBeenCalledTimes(1))
    expect(session.fetchCurrentUser).toHaveBeenCalledTimes(1)

    fireEvent.click((await screen.findAllByRole("button", { name: /^Papéis de / }))[0]!)
    const dialog = await screen.findByRole("dialog")
    const form = await within(dialog).findByRole("form", { name: "Adicionar papel" })
    fireEvent.click(within(form).getByRole("combobox", { name: "Papel" }))
    fireEvent.click(await screen.findByRole("option", { name: "QA de feedback" }))
    fireEvent.click(within(form).getByRole("combobox", { name: "Escopo" }))
    fireEvent.click(await screen.findByRole("option", { name: "Toda a organização" }))
    fireEvent.click(within(form).getByRole("button", { name: /Atribuir papel/ }))
    await waitFor(() => expect(session.fetchFeedbackQualityAccess).toHaveBeenCalledTimes(2))
    expect(session.fetchCurrentUser).toHaveBeenCalledTimes(2)
    expect(session.refresh).toHaveBeenCalledTimes(1)

    fireEvent.click(within(dialog).getByRole("button", { name: "Revogar QA de feedback" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revogar" }))
    await waitFor(() => expect(session.fetchFeedbackQualityAccess).toHaveBeenCalledTimes(3))
    expect(session.fetchCurrentUser).toHaveBeenCalledTimes(3)
    expect(session.refresh).toHaveBeenCalledTimes(2)
  })

  it("V1.5.8a: atalho 'QA Lab' da barra superior = módulo ligado E permissão de QA (os dois do /auth/me)", () => {
    const qa = (options: Parameters<typeof areasFor>[0]) => areasFor(options).tools.find((tool) => tool.key === "qa")
    expect(qa({ profileHref: "/supervisor", canAccessAdministration: true, canReviewFeedback: false, canViewDiagnostics: false })).toBeUndefined()
    expect(qa({ profileHref: "/supervisor", canAccessAdministration: false, canReviewFeedback: true, canViewDiagnostics: false })?.href).toBe("/qa-lab/feedbacks")
    // O cabeçalho continua renderizando para quem não tem nenhuma área extra (sem links fixos técnicos).
    renderWithQuery(<AppTopBar profile={{ name: "Renan", role: "Fora da hierarquia" }} profileHref="/supervisor" canReviewFeedback />)
    for (const legacy of ["Operador", "Supervisor", "Diagnóstico"]) expect(screen.queryByRole("link", { name: legacy })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Área atual: Administração/ })).toBeInTheDocument()
  })
})

describe("Diagnóstico — acesso na UI", () => {
  it("'Diagnóstico' só aparece com a capability (liderança OU indicators.view); sem ferramentas, a seção some", () => {
    const base = { profileHref: "/operator", canAccessAdministration: false, canReviewFeedback: false }
    expect(areasFor({ ...base, canViewDiagnostics: false }).tools).toEqual([])
    expect(areasFor({ ...base, canViewDiagnostics: true }).tools.map((tool) => tool.href)).toEqual(["/diagnostics"])
  })
})

describe("Conversas com a INIA — acesso na UI", () => {
  it("quem só lê conversas vê SÓ esse item na Administração (nenhum outro módulo)", () => {
    renderWithQuery(<SidebarProvider><AdminSidebar capabilities={caps({ canViewAssistantConversations: true })} /></SidebarProvider>)
    expect(screen.getByText("Conversas com a INIA")).toBeInTheDocument()
    for (const other of ["Usuários e acessos", "Workflows", "Agentes", "Base de conhecimento", "Governança", "QA Lab"]) expect(screen.queryByText(other)).not.toBeInTheDocument()
  })

  it("Administrador geral concede o papel de leitura aos gestores em lote, com confirmação", async () => {
    const { toast } = await import("sonner")
    service.fetchAccessRoles.mockResolvedValue([...ROLES, ROLE("LEITOR_DE_CONVERSAS_INIA", "Leitor de conversas da INIA", true, ["ORGANIZATION", "GROUP", "SUBGROUP", "MY_STRUCTURE"])])
    service.grantRoleToLeaders.mockResolvedValue({ leaders: 3, granted: 3, alreadyAssigned: 0, skipped: 0 })
    renderWithQuery(<AccessRolesView />)
    const buttons = await screen.findAllByRole("button", { name: "Conceder aos gestores" })
    expect(buttons).toHaveLength(1) // só no papel de leitura de conversas
    fireEvent.click(buttons[0]!)
    expect(await screen.findByText(/Minha estrutura/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Conceder" }))
    await waitFor(() => expect(service.grantRoleToLeaders).toHaveBeenCalledWith("LEITOR_DE_CONVERSAS_INIA"))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("3 gestores receberam")))
  })

  it("sem poder conceder o papel, o botão não aparece", async () => {
    service.fetchAccessRoles.mockResolvedValue([ROLE("LEITOR_DE_CONVERSAS_INIA", "Leitor de conversas da INIA", false, ["MY_STRUCTURE"])])
    renderWithQuery(<AccessRolesView />)
    await screen.findByText("Leitor de conversas da INIA")
    expect(screen.queryByRole("button", { name: "Conceder aos gestores" })).not.toBeInTheDocument()
  })
})

describe("Liberação de acesso — habilitar, senha temporária e desabilitar", () => {
  const SEM_CONTA = identified(JOAO, { personId: "p-ana", name: "Ana Prado", accessStatus: "DISABLED", account: null })
  const PENDENTE = identified(MARIA, { accessStatus: "PENDING_PASSWORD_CHANGE", temporaryPasswordExpired: true, account: { ...identified(MARIA).account!, passwordChangeRequired: true, temporaryPasswordIssuedAt: "2026-10-01T12:00:00.000Z", temporaryPasswordExpiresAt: "2026-10-04T12:00:00.000Z" } })
  const EU = identified(JOAO, { self: true })
  const ISSUED = { personId: "p-ana", accountId: "acc-ana", name: "Ana Prado", email: "ana.prado@inia.local", temporaryPassword: "Kq7m-Pz4x-Wn9r", expiresAt: "2026-10-09T12:00:00.000Z" }

  it("situação de cada pessoa e ações conforme o estado: sem conta → Habilitar; ativa/pendente → nova senha e desabilitar; nunca no próprio acesso", async () => {
    service.fetchIdentifiedUsers.mockResolvedValue(page([SEM_CONTA, PENDENTE, EU]))
    renderWithQuery(<AccessUsersView canManageUsers canAssignRoles={false} />)
    const [semConta, pendente, eu] = await screen.findAllByTestId("access-user-row")
    expect(within(semConta!).getByText("Desabilitado")).toBeInTheDocument()
    expect(within(semConta!).getByText("Sem conta de login")).toBeInTheDocument()
    expect(within(semConta!).getByRole("button", { name: /Habilitar acesso/ })).toBeEnabled()
    expect(within(semConta!).queryByRole("button", { name: /Nova senha/ })).not.toBeInTheDocument()
    expect(within(pendente!).getByText("Aguardando troca de senha")).toBeInTheDocument()
    expect(within(pendente!).getByText(/Senha temporária expirada/)).toBeInTheDocument()
    expect(within(pendente!).getByRole("button", { name: /Nova senha temporária/ })).toBeInTheDocument()
    expect(within(pendente!).getByRole("button", { name: /Desabilitar/ })).toBeInTheDocument()
    expect(within(eu!).getByText("Você")).toBeInTheDocument()
    expect(within(eu!).queryByRole("button", { name: /Nova senha|Desabilitar|Habilitar/ })).not.toBeInTheDocument()
  })

  it("aberta pelo Novo usuário com uma matrícula que já existe: filtra pela matrícula e abre \"Habilitar acesso\" da pessoa", async () => {
    service.fetchIdentifiedUsers.mockResolvedValue(page([SEM_CONTA]))
    renderWithQuery(<AccessUsersView canManageUsers canAssignRoles={false} focus={{ search: "OP-10234", personId: "p-ana" }} />)
    expect(await screen.findByRole("form", { name: "Habilitar acesso" })).toBeInTheDocument()
    expect(screen.getByText("Habilitar acesso de Ana Prado")).toBeInTheDocument()
    expect(service.fetchIdentifiedUsers).toHaveBeenCalledWith(expect.objectContaining({ search: "OP-10234" }))
    expect(screen.getByLabelText("Buscar pessoa")).toHaveValue("OP-10234")
  })

  it("sem permissão de gerenciar: só leitura (nenhuma ação de acesso)", async () => {
    service.fetchIdentifiedUsers.mockResolvedValue(page([SEM_CONTA, PENDENTE]))
    renderWithQuery(<AccessUsersView canManageUsers={false} canAssignRoles={false} />)
    await screen.findAllByTestId("access-user-row")
    expect(screen.queryByRole("button", { name: /Habilitar acesso|Nova senha temporária|Desabilitar/ })).not.toBeInTheDocument()
  })

  it("habilitar sem conta pede o e-mail de login, mostra a senha temporária UMA vez com cópia e descarta ao concluir", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    service.fetchIdentifiedUsers.mockResolvedValue(page([SEM_CONTA]))
    service.enableUserAccess.mockResolvedValue(ISSUED)
    renderWithQuery(<AccessUsersView canManageUsers canAssignRoles={false} />)
    fireEvent.click(await screen.findByRole("button", { name: /Habilitar acesso/ }))
    const form = await screen.findByRole("form", { name: "Habilitar acesso" })
    fireEvent.change(within(form).getByLabelText("E-mail de login"), { target: { value: "ana.prado" } })
    fireEvent.click(within(form).getByRole("button", { name: "Habilitar e gerar senha" }))
    expect(await within(form).findByRole("alert")).toHaveTextContent("e-mail válido")
    expect(service.enableUserAccess).not.toHaveBeenCalled()
    fireEvent.change(within(form).getByLabelText("E-mail de login"), { target: { value: " ana.prado@inia.local " } })
    fireEvent.click(within(form).getByRole("button", { name: "Habilitar e gerar senha" }))
    await waitFor(() => expect(service.enableUserAccess).toHaveBeenCalledWith("p-ana", "ana.prado@inia.local"))
    const dialog = await screen.findByRole("dialog", { name: /Senha temporária de Ana Prado/ })
    expect(within(dialog).getByLabelText("Senha temporária")).toHaveValue("Kq7m-Pz4x-Wn9r")
    expect(within(dialog).getByText("ana.prado@inia.local")).toBeInTheDocument()
    expect(within(dialog).getByText(/não será exibida de novo/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Copiar senha temporária" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Kq7m-Pz4x-Wn9r"))
    expect(await within(dialog).findByText("Senha copiada para a área de transferência.")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Concluído" }))
    await waitFor(() => expect(screen.queryByDisplayValue("Kq7m-Pz4x-Wn9r")).not.toBeInTheDocument())
  })

  it("erro do backend ao habilitar aparece no formulário (o backend decide)", async () => {
    service.fetchIdentifiedUsers.mockResolvedValue(page([SEM_CONTA]))
    service.enableUserAccess.mockRejectedValue(new AdminApiError("Já existe uma conta com este e-mail.", "EMAIL_ALREADY_IN_USE"))
    renderWithQuery(<AccessUsersView canManageUsers canAssignRoles={false} />)
    fireEvent.click(await screen.findByRole("button", { name: /Habilitar acesso/ }))
    const form = await screen.findByRole("form", { name: "Habilitar acesso" })
    fireEvent.change(within(form).getByLabelText("E-mail de login"), { target: { value: "maria@inia.local" } })
    fireEvent.click(within(form).getByRole("button", { name: "Habilitar e gerar senha" }))
    expect(await within(form).findByRole("alert")).toHaveTextContent("Já existe uma conta com este e-mail.")
  })

  it("nova senha temporária pede confirmação (avisa que a atual deixa de valer e as sessões caem) e mostra a nova", async () => {
    service.fetchIdentifiedUsers.mockResolvedValue(page([PENDENTE]))
    service.issueTemporaryPassword.mockResolvedValue({ ...ISSUED, personId: "p-maria", accountId: "acc-maria", name: "Maria Silva", email: "maria@inia.local", temporaryPassword: "Abc2-Def3-Ghj4" })
    renderWithQuery(<AccessUsersView canManageUsers canAssignRoles={false} />)
    fireEvent.click(await screen.findByRole("button", { name: /Nova senha temporária/ }))
    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText(/deixa de funcionar agora/)).toBeInTheDocument()
    expect(within(confirm).getByText(/sessões abertas/)).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole("button", { name: "Gerar nova senha" }))
    await waitFor(() => expect(service.issueTemporaryPassword).toHaveBeenCalledWith("acc-maria"))
    expect(within(await screen.findByRole("dialog", { name: /Senha temporária de Maria Silva/ })).getByLabelText("Senha temporária")).toHaveValue("Abc2-Def3-Ghj4")
  })

  it("desabilitar pede confirmação e chama o backend", async () => {
    service.fetchIdentifiedUsers.mockResolvedValue(page([identified(MARIA)]))
    service.disableUserAccess.mockResolvedValue({ personId: "p-maria", accountId: "acc-maria" })
    renderWithQuery(<AccessUsersView canManageUsers canAssignRoles={false} />)
    fireEvent.click(await screen.findByRole("button", { name: /^Desabilitar$/ }))
    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText(/sai de todas as sessões abertas/)).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole("button", { name: "Desabilitar acesso" }))
    await waitFor(() => expect(service.disableUserAccess).toHaveBeenCalledWith("acc-maria"))
  })
})
