/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { AdminApiError } from "@/lib/admin/admin-api"
import { userAccountSchema, userDetailSchema } from "@/schemas/admin/user-account.schema"
import type { AccessAccount } from "@/schemas/access/access.schema"

import { UsersPage } from "./users-page"

const users = vi.hoisted(() => ({
  fetchUserAccounts: vi.fn(),
  fetchUserAccountsPage: vi.fn(),
  fetchUserDetail: vi.fn(),
  createUserAccount: vi.fn(),
  updateUserDetails: vi.fn(),
  updateUserRole: vi.fn(),
  updateUserActive: vi.fn(),
  fetchUserShift: vi.fn(),
  updateUserShift: vi.fn(),
  fetchEmploymentStatus: vi.fn(),
  applyEmploymentStatus: vi.fn(),
  updateUserOperationalCapital: vi.fn(),
  fetchCreationPolicy: vi.fn(),
  linkUserToSourcePerson: vi.fn(),
}))
vi.mock("@/services/admin/user-account-service", () => users)
vi.mock("@/services/admin/org-structure-service", () => ({ fetchTeams: vi.fn(async () => [{ id: "t-atd", name: "Atendimento" }, { id: "t-ret", name: "Retenção" }]), fetchManageableTeams: vi.fn(), fetchSubjects: vi.fn() }))
vi.mock("@/services/admin/operational-calendar-service", () => ({ fetchCapitals: vi.fn(async () => ({ capitals: [] })), fetchCalendarSettings: vi.fn(), fetchHolidayCatalog: vi.fn(), fetchHolidayCatalogCoverage: vi.fn(), fetchHolidays: vi.fn(), createHoliday: vi.fn(), deleteHoliday: vi.fn(), updateCalendarSettings: vi.fn(), updateHoliday: vi.fn() }))
const access = vi.hoisted(() => ({ fetchAccessAccount: vi.fn(), fetchAccessRoles: vi.fn(), fetchScopeOptions: vi.fn(), fetchIdentifiedUsers: vi.fn(), enableUserAccess: vi.fn(), issueTemporaryPassword: vi.fn(), disableUserAccess: vi.fn(), assignAccessRole: vi.fn(), revokeAccessRole: vi.fn(), grantRoleToLeaders: vi.fn() }))
vi.mock("@/services/access/access-service", () => access)
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/users", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const BASE = { sourceName: "RH Corporativo", feedName: "Colaboradores" }
const NOTICE = "Vem da base RH Corporativo · Colaboradores — altere na origem"
// Mariana veio pela Central: nome, nível, Grupo, gestor e "ativo" são da base; e-mail e capital operacional não.
const MARIANA = userAccountSchema.parse({ id: "p-mariana", name: "Mariana Alves", role: "OPERATOR", active: true, teamId: "t-atd", teamName: "Atendimento", accountId: "acc-mariana", email: "mariana@empresa.com", lastLoginAt: null, managedBy: { name: BASE, role: BASE, teamId: BASE, subteamId: BASE, managerId: BASE, active: BASE } })
const MANUAL = userAccountSchema.parse({ id: "p-manual", name: "Pessoa Manual", role: "OPERATOR", active: true, teamId: "t-atd", teamName: "Atendimento", accountId: "acc-manual", email: "manual@empresa.com", lastLoginAt: null })
const detailOf = (user: typeof MARIANA) => userDetailSchema.parse({ id: user.id, name: user.name, role: user.role, jobTitle: "Analista de Atendimento I", matricula: user.id === MARIANA.id ? "OP-10234" : null, hiredAt: "2024-03-11", active: true, operationalCapitalCode: null, team: { id: "t-atd", name: "Atendimento" }, subteam: { id: "s-premium", name: "Premium" }, manager: { id: "p-carlos", name: "Carlos Menezes" }, accountId: user.accountId, email: user.email, managedBy: user.managedBy })
const ROLES: AccessAccount = {
  accountId: "acc-mariana", email: "mariana@empresa.com", active: true, lastLoginAt: null,
  collaborator: { personId: "p-mariana", name: "Mariana Alves", jobTitle: "Analista", level: "OPERATOR", active: true, team: { id: "t-atd", name: "Atendimento" }, subteam: null },
  roles: [
    { id: "as-1", roleCode: "ADMINISTRADOR", roleName: "Administrador", scopeLabel: "Grupo Atendimento", scope: { type: "GROUP" }, grantedAt: "2026-10-01T12:00:00.000Z", grantedByName: "Admin Geral" },
    { id: "as-2", roleCode: "ADMINISTRADOR", roleName: "Administrador", scopeLabel: "Grupo Retenção", scope: { type: "GROUP" }, grantedAt: "2026-10-01T12:00:00.000Z", grantedByName: "Admin Geral" },
  ],
}

beforeAll(installJsdomStubs)
afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear() })

// Pessoa que chegou pela base, ainda sem conta — candidata a receber a conta da Pessoa Manual.
const FROM_BASE = userAccountSchema.parse({ id: "p-base", name: "Pessoa Manual da Base", role: "OPERATOR", matricula: "OP-55555", active: true, teamId: "t-atd", teamName: "Atendimento", accountId: null, email: null, lastLoginAt: null })

function setup(props: { canManageAccess?: boolean; onOpenAccess?: (focus: { search: string; personId: string | null }) => void } = {}) {
  users.fetchUserAccountsPage.mockImplementation(async (params: { hasMatricula?: boolean }) => (params.hasMatricula ? { items: [FROM_BASE], total: 1, page: 1, pageSize: 8 } : { items: [MARIANA, MANUAL], total: 2, page: 1, pageSize: 10 }))
  users.fetchCreationPolicy.mockResolvedValue({ hierarchyRequiresMatricula: false, sources: [] })
  users.fetchUserDetail.mockImplementation(async (id: string) => detailOf(id === MARIANA.id ? MARIANA : MANUAL))
  users.fetchUserShift.mockResolvedValue(null)
  users.fetchEmploymentStatus.mockResolvedValue({ current: { status: "EM_PRODUCAO", label: "EM PRODUÇÃO" }, history: [], schedule: null, operationalCapital: null })
  users.updateUserDetails.mockResolvedValue(undefined)
  access.fetchAccessAccount.mockResolvedValue(ROLES)
  renderWithQuery(<UsersPage canViewAccess canAssignRoles={false} {...props} />)
}

async function openEdit(name: string) {
  const row = (await screen.findByText(name)).closest("tr")!
  fireEvent.click(within(row).getByRole("button", { name: "Editar usuário" }))
}

describe("Pessoas — campos que vêm da base do cliente", () => {
  it("na lista, nível hierárquico e ativo da base ficam desabilitados com a origem; os da pessoa manual seguem editáveis", async () => {
    setup()
    const mariana = await screen.findByLabelText("Nível hierárquico de Mariana Alves")
    expect(mariana).toBeDisabled()
    expect(mariana.closest("[title]")).toHaveAttribute("title", NOTICE)
    expect(screen.getByLabelText("Nível hierárquico de Pessoa Manual")).toBeEnabled()
    const [marianaActive, manualActive] = screen.getAllByRole("button", { name: "Desativar usuário" })
    expect(marianaActive).toBeDisabled()
    expect(manualActive).toBeEnabled()
  })

  it("na ficha, campo da base aparece desabilitado com o aviso; campo não mapeado continua editável e só ele é enviado", async () => {
    setup()
    await openEdit("Mariana Alves")
    const name = screen.getByLabelText("Nome")
    expect(name).toBeDisabled()
    expect(name).toHaveAccessibleDescription(NOTICE)
    expect(screen.getByRole("combobox", { name: "Nível hierárquico" })).toBeDisabled()
    const email = screen.getByLabelText("E-mail")
    expect(email).toBeEnabled()
    expect(email).not.toHaveAccessibleDescription()

    fireEvent.change(email, { target: { value: "mariana.alves@empresa.com" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(users.updateUserDetails).toHaveBeenCalledTimes(1))
    expect(users.updateUserDetails.mock.calls[0]![0]).toEqual({ personId: "p-mariana", email: "mariana.alves@empresa.com" })
  })

  it("a ficha separa Pertence a (Grupo, Subgrupo, gestor da base) de Administra / acessos (papéis com escopo, vários Grupos)", async () => {
    setup()
    await openEdit("Mariana Alves")
    const belongs = screen.getByTestId("person-belongs-to")
    expect(within(belongs).getByRole("heading", { name: "Pertence a" })).toBeInTheDocument()
    const team = within(belongs).getByRole("combobox", { name: "Grupo" })
    expect(team).toBeDisabled()
    expect(team).toHaveAccessibleDescription(NOTICE)
    expect(await within(belongs).findByText("Premium")).toBeInTheDocument()
    expect(within(belongs).getByText("Carlos Menezes")).toBeInTheDocument()

    const administers = screen.getByTestId("person-access")
    expect(within(administers).getByRole("heading", { name: "Administra / acessos" })).toBeInTheDocument()
    expect(within(administers).getByText(/para administrar vários Grupos, atribua o papel uma vez para cada Grupo/)).toBeInTheDocument()
    expect(await within(administers).findByText("Escopo: Grupo Atendimento")).toBeInTheDocument()
    expect(within(administers).getByText("Escopo: Grupo Retenção")).toBeInTheDocument()
    expect(within(administers).queryByTestId("source-managed-notice")).not.toBeInTheDocument()
  })

  it("pessoa sem feed: tudo editável, sem aviso de origem", async () => {
    setup()
    await openEdit("Pessoa Manual")
    expect(screen.getByLabelText("Nome")).toBeEnabled()
    expect(screen.getByRole("combobox", { name: "Nível hierárquico" })).toBeEnabled()
    expect(screen.getByRole("combobox", { name: "Grupo" })).toBeEnabled()
    await screen.findByText("Premium")
    expect(screen.queryByTestId("source-managed-notice")).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Pessoa Corrigida" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(users.updateUserDetails).toHaveBeenCalledTimes(1))
    expect(users.updateUserDetails.mock.calls[0]![0]).toEqual({ personId: "p-manual", name: "Pessoa Corrigida" })
  })
})

async function fillNewUser(fields: { matricula?: string } = {}) {
  fireEvent.click(await screen.findByRole("button", { name: /Novo usuário/ }))
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Nova Pessoa" } })
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "nova@empresa.com" } })
  if (fields.matricula) fireEvent.change(screen.getByLabelText("Matrícula (opcional)"), { target: { value: fields.matricula } })
}

const ISSUED = { personId: "p-nova", accountId: "a-nova", name: "Nova Pessoa", email: "nova@empresa.com", temporaryPassword: "Kq7m-Pz4x-Wn9r", expiresAt: "2026-10-20T12:00:00.000Z" }

describe("Novo usuário — sem pessoa duplicada entre o cadastro e a base", () => {
  it("com Colaboradores vigente, sem matrícula só \"Fora da hierarquia\"; com matrícula, a hierarquia volta e a matrícula vai junto", async () => {
    setup()
    users.fetchCreationPolicy.mockResolvedValue({ hierarchyRequiresMatricula: true, sources: [BASE] })
    users.createUserAccount.mockResolvedValue(ISSUED)
    await fillNewUser()
    expect(await screen.findByTestId("hierarchy-requires-source")).toHaveTextContent("RH Corporativo · Colaboradores")
    expect(screen.getByRole("combobox", { name: "Nível hierárquico" })).toHaveTextContent("Fora da hierarquia")
    fireEvent.change(screen.getByLabelText("Matrícula (opcional)"), { target: { value: " OP-99999 " } })
    expect(screen.getByRole("combobox", { name: "Nível hierárquico" })).toHaveTextContent("Operador")
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(users.createUserAccount).toHaveBeenCalledTimes(1))
    expect(users.createUserAccount.mock.calls[0]![0]).toEqual({ name: "Nova Pessoa", email: "nova@empresa.com", role: "OPERATOR", teamId: undefined, matricula: "OP-99999" })
  })

  it("a senha provisória não é digitada: a INIA gera e mostra uma vez depois de criar (auditoria 17/10/2026, AUTH-6)", async () => {
    setup()
    users.fetchCreationPolicy.mockResolvedValue({ hierarchyRequiresMatricula: false, sources: [] })
    users.createUserAccount.mockResolvedValue(ISSUED)
    await fillNewUser()
    expect(screen.queryByLabelText("Senha provisória")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    expect(await screen.findByDisplayValue("Kq7m-Pz4x-Wn9r")).toBeInTheDocument()
    expect(users.createUserAccount.mock.calls[0]![0]).not.toHaveProperty("password")
  })

  it("sem matrícula e com Colaboradores vigente, o cadastro sai como \"Fora da hierarquia\"", async () => {
    setup()
    users.fetchCreationPolicy.mockResolvedValue({ hierarchyRequiresMatricula: true, sources: [BASE] })
    users.createUserAccount.mockResolvedValue(ISSUED)
    await fillNewUser()
    await screen.findByTestId("hierarchy-requires-source")
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(users.createUserAccount).toHaveBeenCalledTimes(1))
    expect(users.createUserAccount.mock.calls[0]![0]).toMatchObject({ role: "ADMIN", matricula: undefined })
  })

  it("matrícula que já existe: mostra a saída e leva para \"Habilitar acesso\" da pessoa", async () => {
    const onOpenAccess = vi.fn()
    setup({ onOpenAccess })
    users.createUserAccount.mockRejectedValue(new AdminApiError("Já existe uma pessoa com esta matrícula na organização. Não cadastre de novo: libere o acesso dela em Acessos › Habilitar acesso.", "PERSON_MATRICULA_IN_USE", { personId: "p-base" }))
    await fillNewUser({ matricula: "OP-55555" })
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    const box = await screen.findByTestId("matricula-in-use")
    expect(box).toHaveTextContent("Já existe uma pessoa com esta matrícula")
    fireEvent.click(within(box).getByRole("button", { name: "Ir para Habilitar acesso" }))
    expect(onOpenAccess).toHaveBeenCalledWith({ search: "OP-55555", personId: "p-base" })
  })
})

describe("Vincular à pessoa da base", () => {
  it("na ficha da pessoa cadastrada à mão: busca quem veio da base sem conta, explica os efeitos e vincula", async () => {
    setup({ canManageAccess: true })
    users.linkUserToSourcePerson.mockResolvedValue({ fromPersonId: "p-manual", toPersonId: "p-base", matricula: "OP-55555", accountId: "acc-manual", sessionsRevoked: true })
    await openEdit("Pessoa Manual")
    fireEvent.click(await screen.findByRole("button", { name: "Vincular à pessoa da base" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(await within(dialog).findByRole("button", { name: /Pessoa Manual da Base/ }))
    expect(users.fetchUserAccountsPage).toHaveBeenCalledWith(expect.objectContaining({ hasAccount: false, hasMatricula: true }))
    const effects = within(dialog).getByRole("list", { name: "O que acontece" })
    expect(effects).toHaveTextContent("A conta de login (manual@empresa.com) e os papéis de acesso passam para Pessoa Manual da Base (matrícula OP-55555)")
    expect(effects).toHaveTextContent("As sessões abertas são encerradas")
    expect(effects).toHaveTextContent("continuam com ela")
    fireEvent.click(within(dialog).getByRole("button", { name: "Vincular" }))
    await waitFor(() => expect(users.linkUserToSourcePerson).toHaveBeenCalledWith("p-manual", "p-base"))
  })

  it("sem custódia de acesso, a ação não aparece; pessoa da base não tem a ação; vinculada mostra para quem", async () => {
    setup()
    await openEdit("Pessoa Manual")
    expect(await screen.findByText(/Cadastrada à mão na INIA/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Vincular à pessoa da base" })).not.toBeInTheDocument()
    cleanup()
    setup({ canManageAccess: true })
    users.fetchUserDetail.mockImplementation(async (id: string) => ({ ...detailOf(id === MARIANA.id ? MARIANA : MANUAL), linkedTo: id === MANUAL.id ? { id: "p-base", name: "Pessoa Manual da Base", matricula: "OP-55555", at: "2026-10-15T14:00:00.000Z" } : null }))
    await openEdit("Pessoa Manual")
    expect(await screen.findByTestId("person-linked-to")).toHaveTextContent("Vinculada a Pessoa Manual da Base (matrícula OP-55555)")
    expect(screen.queryByRole("button", { name: "Vincular à pessoa da base" })).not.toBeInTheDocument()
  })
})
