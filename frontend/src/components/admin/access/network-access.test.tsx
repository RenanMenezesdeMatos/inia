/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { networkEnableReportCsv, networkSignals, networkVerdict } from "@/lib/access/network-access-labels"
import { AdminApiError } from "@/lib/admin/admin-api"
import type { IdentifiedUser, NetworkAttempts, NetworkEnableReport } from "@/schemas/access/access.schema"

import { AccessUsersView } from "./access-users-view"

const service = vi.hoisted(() => ({ fetchIdentifiedUsers: vi.fn(), enableUserAccess: vi.fn(), issueTemporaryPassword: vi.fn(), disableUserAccess: vi.fn(), downloadNetworkEnableTemplate: vi.fn(), previewNetworkEnable: vi.fn(), applyNetworkEnable: vi.fn(), checkNetworkLogin: vi.fn(), fetchAccessAccount: vi.fn(), fetchAccessRoles: vi.fn(), fetchScopeOptions: vi.fn(), assignAccessRole: vi.fn(), revokeAccessRole: vi.fn() }))
vi.mock("@/services/access/access-service", () => service)
const download = vi.hoisted(() => ({ downloadBlob: vi.fn() }))
vi.mock("@/lib/access/download", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/access/download")>()), ...download }))
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/users", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

/** Acesso pela rede (AD) na aba Acessos: habilitar sem senha, CSV em massa, conferir matrícula e situação do login. */
const NOW = new Date("2026-11-25T12:00:00Z")
const user = (patch: Partial<IdentifiedUser> = {}): IdentifiedUser => ({
  personId: "p-1", name: "Ana Prado", matricula: "G0055350", jobTitle: "Assistente", level: "OPERATOR", personActive: true, team: { id: "t", name: "Ouvidoria" }, subteam: null, self: false,
  accessStatus: "DISABLED", temporaryPasswordExpired: false, canIssueTemporaryPassword: false, enableCredential: "NETWORK", networkIssue: null, networkAttempts: null, loginGuide: { kind: "NETWORK", typed: "G0055350", directoryLogins: ["G0055350"], proven: false }, account: null, ...patch,
})
const account = (patch: Partial<NonNullable<IdentifiedUser["account"]>> = {}): NonNullable<IdentifiedUser["account"]> => ({ accountId: "a-1", email: "g0055350@empresa.local", active: true, lastLoginAt: null, passwordChangeRequired: false, temporaryPasswordIssuedAt: null, temporaryPasswordExpiresAt: null, accessDisabledAt: null, roles: [], credentialProvider: "NETWORK", disabledReason: null, ...patch })
const attempts = (reason: NonNullable<NetworkAttempts["last"]>["reason"], patch: Partial<NonNullable<NetworkAttempts["last"]>> = {}, lockedUntil: string | null = null): NetworkAttempts => ({ lockedUntil, last: { at: "2026-11-25T11:50:00.000Z", outcome: "INVALID_CREDENTIALS", reason, directoryCode: null, ...patch } })
const show = (items: IdentifiedUser[], canManage = true) => {
  service.fetchIdentifiedUsers.mockResolvedValue({ items, total: items.length, page: 1, pageSize: 20, temporaryPasswordTtlHours: 72, networkLoginEnabled: true })
  renderWithQuery(<AccessUsersView canManageUsers={canManage} canAssignRoles={false} />)
}

beforeAll(installJsdomStubs)
afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear() })

describe("habilitar pela rede", () => {
  it("não fala em senha temporária, não exige e-mail e não mostra nenhuma senha", async () => {
    show([user()])
    service.enableUserAccess.mockResolvedValue({ credential: "NETWORK", personId: "p-1", accountId: "a-1", name: "Ana Prado", matricula: "G0055350" })
    fireEvent.click(await screen.findByRole("button", { name: /^Habilitar acesso$/ }))
    const form = await screen.findByRole("form", { name: "Habilitar acesso" })
    expect(form).toHaveTextContent("Nenhuma senha é gerada")
    expect(form).not.toHaveTextContent(/senha temporária/)
    expect(form).toHaveTextContent("G0055350")
    fireEvent.click(within(form).getByRole("button", { name: "Habilitar acesso" }))
    await waitFor(() => expect(service.enableUserAccess).toHaveBeenCalledWith("p-1", undefined))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Login: G0055350 e a senha do Windows")))
    expect(screen.queryByText(/Senha temporária de/)).not.toBeInTheDocument()
  })
  it("e-mail opcional é conferido quando preenchido; reabilitar não pede e-mail", async () => {
    show([user({ personId: "p-2", name: "Bia", account: account({ active: false, accessDisabledAt: "2026-11-20T10:00:00.000Z", disabledReason: "PERSON_DEACTIVATED_BY_SOURCE" }) }), user()])
    const [bia, ana] = await screen.findAllByTestId("access-user-row")
    expect(bia).toHaveTextContent("a base do cliente inativou a pessoa")
    fireEvent.click(within(ana!).getByRole("button", { name: /Habilitar acesso/ }))
    const form = await screen.findByRole("form", { name: "Habilitar acesso" })
    fireEvent.change(within(form).getByLabelText("E-mail (opcional)"), { target: { value: "sem-arroba" } })
    fireEvent.click(within(form).getByRole("button", { name: "Habilitar acesso" }))
    expect(await within(form).findByRole("alert")).toHaveTextContent("e-mail válido")
    expect(service.enableUserAccess).not.toHaveBeenCalled()
    fireEvent.click(within(form).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("form", { name: "Habilitar acesso" })).not.toBeInTheDocument())
    fireEvent.click(within(bia!).getByRole("button", { name: /Habilitar acesso/ }))
    expect(within(await screen.findByRole("form", { name: "Habilitar acesso" })).queryByLabelText(/E-mail/)).not.toBeInTheDocument()
  })
  it("impedimento do cadastro aparece na linha e não deixa habilitar", async () => {
    show([user({ matricula: null, networkIssue: "MATRICULA_MISSING", loginGuide: null })])
    const row = await screen.findByTestId("access-user-row")
    expect(row).toHaveTextContent("Sem matrícula")
    expect(within(row).queryByTestId("login-guide")).not.toBeInTheDocument()
    expect(within(row).getByRole("button", { name: /Habilitar acesso/ })).toBeDisabled()
  })
  it("sem gerenciar acessos: nem CSV nem conferência", async () => {
    show([user()], false)
    await screen.findByTestId("access-user-row")
    expect(screen.queryByRole("button", { name: /Habilitar em massa|Conferir matrícula/ })).not.toBeInTheDocument()
  })
})

describe("situação do login pela rede", () => {
  it.each([
    ["NETWORK_ACCOUNT_LOCKED", "775", "Bloqueada no AD", "Só o suporte de TI desbloqueia"],
    ["NETWORK_ACCOUNT_DISABLED", "531", "Conta de rede sem permissão", "estações específicas"],
    ["NETWORK_PASSWORD_EXPIRED", "773", "Senha de rede vencida", "troca da senha"],
    ["NETWORK_INVALID", "52e", "Senha recusada pelo AD", "recusou a matrícula ou a senha"],
    ["NETWORK_NO_ANSWER", null, "AD sem resposta", "não respondeu"],
    ["NO_ACCOUNT", null, "Tentou entrar sem acesso", "o AD nem foi consultado"],
    ["INIA_ACCESS_DISABLED", null, "Tentou entrar com o acesso desabilitado", "o AD confirmou a senha"],
    [null, null, "Última tentativa recusada", "não foi registrado"],
  ] as const)("%s (%s) → %s", (reason, directoryCode, title, detail) => {
    const [signal] = networkSignals(attempts(reason, { directoryCode }), NOW)
    expect(signal).toMatchObject({ title })
    expect(signal!.detail).toContain(detail)
  })
  it("trava temporária com a hora em que libera; vencida some; login certo não deixa sinal", () => {
    expect(networkSignals(attempts("NO_ACCOUNT", {}, "2026-11-25T12:10:00.000Z"), NOW)[0]!.title).toMatch(/^Bloqueio temporário até /)
    expect(networkSignals(attempts("NO_ACCOUNT", {}, "2026-11-25T11:59:00.000Z"), NOW).map((signal) => signal.key)).toEqual(["inia"])
    expect(networkSignals(attempts(null, { outcome: "SUCCEEDED" }), NOW)).toEqual([])
    expect(networkSignals(null, NOW)).toEqual([])
  })
  it("aparece na lista, com texto (a cor nunca é a única informação)", async () => {
    show([user({ accessStatus: "ACTIVE", account: account(), networkAttempts: attempts("NETWORK_ACCOUNT_LOCKED", { directoryCode: "775" }) })])
    const row = await screen.findByTestId("access-user-row")
    expect(within(row).getByRole("list", { name: "Situação do login pela rede" })).toHaveTextContent("Bloqueada no AD")
  })
  it("veredito: pode entrar, trava e bloqueio no AD impedem; senha recusada é só aviso", () => {
    const active = user({ accessStatus: "ACTIVE", account: account() })
    expect(networkVerdict(active, NOW)).toEqual({ ok: true, signals: [] })
    expect(networkVerdict({ ...active, networkAttempts: attempts("NETWORK_INVALID") }, NOW).ok).toBe(true)
    expect(networkVerdict({ ...active, networkAttempts: attempts("NETWORK_ACCOUNT_LOCKED") }, NOW).ok).toBe(false)
    expect(networkVerdict({ ...active, networkAttempts: attempts("NETWORK_INVALID", {}, "2026-11-25T12:10:00.000Z") }, NOW).ok).toBe(false)
    expect(networkVerdict(user(), NOW).signals[0]!.title).toBe("Acesso não habilitado")
  })
})

describe("habilitar em massa (CSV)", () => {
  const REPORT: NetworkEnableReport = {
    rows: [
      { line: 2, matricula: "g1", name: "Ana", login: "G1", outcome: "CREATE", refusal: null, similar: [], emailIgnored: false },
      { line: 3, matricula: "g2", name: "Bia", login: "G2", outcome: "REENABLE", refusal: null, similar: [], emailIgnored: true },
      { line: 4, matricula: "0055350", name: null, login: null, outcome: "REFUSED", refusal: "PERSON_NOT_FOUND", similar: ["G0055350"], emailIgnored: false },
    ],
    counts: { CREATE: 1, REENABLE: 1, ALREADY_ENABLED: 0, REFUSED: 1 }, ignoredColumns: ["nome"],
  }
  const open = async () => {
    show([user()])
    fireEvent.click(await screen.findByRole("button", { name: /Habilitar em massa/ }))
    return screen.findByRole("dialog", { name: "Habilitar em massa pela rede" })
  }
  // O jsdom não implementa `File.arrayBuffer`.
  const fileOf = (content: string, name: string) => Object.assign(new File([content], name, { type: "text/csv" }), { arrayBuffer: async () => new TextEncoder().encode(content).buffer })
  const choose = (dialog: HTMLElement, content: string, name = "pessoas.csv") => fireEvent.change(within(dialog).getByLabelText("Arquivo CSV de matrículas"), { target: { files: [fileOf(content, name)] } })

  it("baixa o modelo do servidor", async () => {
    service.downloadNetworkEnableTemplate.mockResolvedValue({ blob: new Blob(["x"]), filename: "modelo.csv" })
    const dialog = await open()
    fireEvent.click(within(dialog).getByRole("button", { name: /Baixar modelo CSV/ }))
    await waitFor(() => expect(download.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "modelo.csv"))
  })
  it("confere sem gravar, mostra o motivo e as matrículas parecidas, e só habilita depois de confirmar", async () => {
    service.previewNetworkEnable.mockResolvedValue(REPORT)
    service.applyNetworkEnable.mockResolvedValue(REPORT)
    const dialog = await open()
    expect(within(dialog).getByRole("button", { name: "Habilitar" })).toBeDisabled()
    choose(dialog, "matricula\ng1")
    expect(await within(dialog).findByText(/No cadastro há: G0055350/)).toBeInTheDocument()
    expect(service.previewNetworkEnable).toHaveBeenCalledWith(btoa("matricula\ng1"), expect.anything())
    expect(service.applyNetworkEnable).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent("Colunas ignoradas do arquivo: nome.")
    // Quem precisa de atenção primeiro; o filtro mostra só o resultado escolhido.
    expect(within(dialog).getAllByRole("row")[1]).toHaveTextContent("0055350")
    fireEvent.click(within(dialog).getByRole("button", { name: /Vai reabilitar: 1/ }))
    expect(within(dialog).getAllByRole("row")).toHaveLength(2)
    expect(dialog).toHaveTextContent("O e-mail do arquivo não foi usado")
    fireEvent.click(within(dialog).getByRole("button", { name: "Habilitar 2 pessoas" }))
    expect(await within(dialog).findByText(/2 pessoas habilitadas/)).toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: /Habilitar/ })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: /Baixar relatório/ }))
    expect(download.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "resultado-habilitar-pela-rede.csv")
    fireEvent.click(within(dialog).getByRole("button", { name: "Concluir" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
  it("nada a habilitar: o botão fica travado; erro do servidor e arquivo grande aparecem na janela", async () => {
    service.previewNetworkEnable.mockResolvedValueOnce({ ...REPORT, rows: [REPORT.rows[2]!], counts: { CREATE: 0, REENABLE: 0, ALREADY_ENABLED: 0, REFUSED: 1 } })
    const dialog = await open()
    choose(dialog, "matricula\n0055350")
    await within(dialog).findByText(/No cadastro há/)
    expect(within(dialog).getByRole("button", { name: "Habilitar" })).toBeDisabled()
    service.previewNetworkEnable.mockRejectedValueOnce(new AdminApiError("Este arquivo não é um CSV.", "ACCESS_CSV_INVALID"))
    choose(dialog, "PK", "x.xlsx")
    expect(await within(dialog).findByText("Este arquivo não é um CSV.")).toBeInTheDocument()
    choose(dialog, "a".repeat(700_001))
    expect(await within(dialog).findByText(/grande demais/)).toBeInTheDocument()
    expect(service.previewNetworkEnable).toHaveBeenCalledTimes(2)
  })
  it("relatório baixado não vira fórmula na planilha", () => {
    const csv = networkEnableReportCsv([{ line: 2, matricula: "=1+1", name: "+Nome; \"x\"", login: null, outcome: "REFUSED", refusal: "MATRICULA_INVALID", similar: [], emailIgnored: false }], "preview")
    expect(csv).toContain("\"2\";\"'=1+1\";\"'+Nome; \"\"x\"\"\";\"\";\"Não vai habilitar\";")
    // Planilha que separa por vírgula: o texto do arquivo enviado não pode virar uma célula com fórmula (CFA-07 da run-12).
    const comma = networkEnableReportCsv([{ line: 3, matricula: "x,=1+1", name: null, login: null, outcome: "REFUSED", refusal: "MATRICULA_INVALID", similar: [], emailIgnored: false }], "preview")
    expect(comma).toContain("\"3\";\"x,'=1+1\";")
  })
})

describe("conferir matrícula", () => {
  const open = async () => {
    show([user()])
    fireEvent.click(await screen.findByRole("button", { name: /Conferir matrícula/ }))
    const dialog = await screen.findByRole("dialog", { name: "Conferir matrícula" })
    fireEvent.change(within(dialog).getByLabelText("Matrícula de rede"), { target: { value: " g0055350 " } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Conferir" }))
    return dialog
  }
  it("pessoa sem acesso: diz por quê e habilita dali", async () => {
    service.checkNetworkLogin.mockResolvedValue({ networkLogin: "G0055350", networkLoginEnabled: true, people: [user()], similar: [], attempts: null })
    const dialog = await open()
    expect(await within(dialog).findByText("Não entra agora")).toBeInTheDocument()
    expect(service.checkNetworkLogin).toHaveBeenCalledWith("g0055350", expect.anything())
    fireEvent.click(within(dialog).getByRole("button", { name: "Habilitar acesso" }))
    expect(await screen.findByRole("form", { name: "Habilitar acesso" })).toBeInTheDocument()
  })
  it("não existe: oferece as parecidas e confere a escolhida", async () => {
    service.checkNetworkLogin.mockResolvedValueOnce({ networkLogin: "0055350", networkLoginEnabled: true, people: [], similar: ["G0055350"], attempts: attempts("NO_ACCOUNT") })
    const dialog = await open()
    fireEvent.click(await within(dialog).findByRole("button", { name: "G0055350" }))
    await waitFor(() => expect(service.checkNetworkLogin).toHaveBeenLastCalledWith("G0055350", expect.anything()))
  })
  it("pode entrar; o que não é matrícula; erro", async () => {
    service.checkNetworkLogin.mockResolvedValueOnce({ networkLogin: "G0055350", networkLoginEnabled: true, people: [user({ accessStatus: "ACTIVE", account: account() })], similar: [], attempts: null })
    const dialog = await open()
    expect(await within(dialog).findByText("Pode entrar")).toBeInTheDocument()
    service.checkNetworkLogin.mockResolvedValueOnce({ networkLogin: null, networkLoginEnabled: true, people: [], similar: [], attempts: null })
    fireEvent.click(within(dialog).getByRole("button", { name: "Conferir" }))
    expect(await within(dialog).findByText("Isto não é uma matrícula de rede")).toBeInTheDocument()
    service.checkNetworkLogin.mockRejectedValueOnce(new AdminApiError("Você não tem permissão para esta ação.", "FORBIDDEN"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Conferir" }))
    expect(await within(dialog).findByText("Você não tem permissão para esta ação.")).toBeInTheDocument()
  })
})

describe("sinalização de qual login usar (25/11/2026)", () => {
  const guide = (patch: object) => user({ accessStatus: "ACTIVE", account: account(), loginGuide: { kind: "NETWORK", typed: "R4567891", directoryLogins: ["R4567891"], proven: false, ...patch } })
  it("mostra o que a pessoa digita e qual senha; igual no AD, nada a explicar", async () => {
    show([guide({})])
    const line = await screen.findByTestId("login-guide")
    expect(line).toHaveTextContent("Login na INIA:R4567891+ senha do Windows")
    expect(line).not.toHaveTextContent("No AD")
  })
  it("login do AD diferente: a pessoa continua digitando a matrícula inteira; ainda não descoberto: diz que a INIA descobre", async () => {
    show([guide({ directoryLogins: ["R456789"], proven: true }), guide({ directoryLogins: ["R4567891", "R456789"] })])
    const [known, unknown] = await screen.findAllByTestId("login-guide")
    expect(known).toHaveTextContent("No AD o login é R456789: a INIA usa sozinha, a pessoa não digita.")
    expect(unknown).toHaveTextContent("No AD pode ser R4567891 ou R456789: a INIA descobre no primeiro acesso.")
  })
  it("copia a orientação pronta para mandar à pessoa", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    show([guide({}), user({ personId: "p-2", name: "Emergência", enableCredential: "LOCAL", accessStatus: "ACTIVE", account: account({ credentialProvider: "LOCAL" }), loginGuide: { kind: "EMAIL", typed: "admin@empresa.com", directoryLogins: [], proven: false } })])
    fireEvent.click(await screen.findByRole("button", { name: "Copiar o login de Ana Prado" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Login: R4567891 e a senha do Windows"))
    fireEvent.click(screen.getByRole("button", { name: "Copiar o login de Emergência" }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("Login: admin@empresa.com (e-mail) e senha da INIA"))
    writeText.mockRejectedValueOnce(new Error("sem permissão"))
    fireEvent.click(screen.getByRole("button", { name: "Copiar o login de Ana Prado" }))
    expect(await screen.findByText("O navegador não deixou copiar: copie o texto da linha.")).toBeInTheDocument()
  })
})
