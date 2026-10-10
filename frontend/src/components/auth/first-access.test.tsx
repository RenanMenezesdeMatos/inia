/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { passwordChangePendingIn } from "@/lib/auth/session-hint"
import { passwordRules } from "@/schemas/auth/password-policy"
import { NO_ACCESS_CAPABILITIES } from "@/schemas/auth/auth.schema"

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => navigation }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const auth = vi.hoisted(() => ({ login: vi.fn(), fetchCurrentUser: vi.fn(), defineFirstPassword: vi.fn(), logout: vi.fn() }))
vi.mock("@/services/auth/auth-service", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/services/auth/auth-service")>()), ...auth }))

import { CreatePasswordForm } from "./create-password-form"
import { LoginFields } from "./login-fields"
import { DefinePasswordError, InvalidCredentialsError, LoginRefusedError, landingRouteFor, retryMessage } from "@/services/auth/auth-service"

const ME = { sub: "acc-1", personId: "p-1", organizationId: "org", role: "OPERATOR" as const, name: "Larissa Monteiro", email: "larissa@inia.local", avatarUrl: null, jobTitle: null, teamId: null, teamName: null, preferredName: null, passwordChangeRequired: false, temporaryPasswordExpiresAt: null, access: { permissions: [], capabilities: NO_ACCESS_CAPABILITIES, roles: [] }, features: { interactionFeedbackQa: false, usageCollection: false, usabilityPanel: false } }
const token = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`

beforeAll(installJsdomStubs)
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("primeiro acesso — regras puras", () => {
  it("checklist ao vivo espelha a política do backend", () => {
    const met = (password: string) => Object.fromEntries(passwordRules(password, "larissa@inia.local").map((rule) => [rule.code, rule.met]))
    expect(met("")).toMatchObject({ TOO_SHORT: false, MISSING_LETTER: false, MISSING_DIGIT: false, CONTAINS_LOGIN: false })
    expect(met("Primavera2026")).toEqual({ TOO_SHORT: true, MISSING_LETTER: true, MISSING_DIGIT: true, CONTAINS_LOGIN: true })
    expect(met(`a1${"x".repeat(80)}`)).toMatchObject({ TOO_LONG: false })
    expect(met("larissa2026")).toMatchObject({ CONTAINS_LOGIN: false })
  })
  it("destino: troca pendente leva só à tela de criar senha; mensagem da trava em minutos", () => {
    expect(landingRouteFor({ ...ME, passwordChangeRequired: true })).toBe("/auth/create-password")
    expect(landingRouteFor(ME)).toBe("/operator")
    expect(retryMessage(new Date("2026-10-06T12:10:30Z"), new Date("2026-10-06T12:00:00Z"))).toBe("Muitas tentativas de acesso. Tente novamente em 11 minutos.")
  })
  it("o proxy lê a dica de troca pendente do token (sem confiar nela para autorizar)", () => {
    expect(passwordChangePendingIn(token({ sub: "a", pc: true, name: "Lúcia" }))).toBe(true)
    expect(passwordChangePendingIn(token({ sub: "a", sv: 2 }))).toBe(false)
    expect(passwordChangePendingIn("lixo")).toBe(false)
  })
})

describe("login", () => {
  const submit = (email: string, password: string) => {
    fireEvent.change(screen.getByLabelText("E-mail corporativo"), { target: { value: email } })
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: password } })
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }))
  }
  it("senha temporária aceita → vai direto para criar a senha", async () => {
    auth.login.mockResolvedValue({ id: "acc-1", personId: "p-1", name: "Larissa", role: "OPERATOR", email: "larissa@inia.local", avatarUrl: null, jobTitle: null, teamId: null, teamName: null, passwordChangeRequired: true })
    auth.fetchCurrentUser.mockResolvedValue({ ...ME, passwordChangeRequired: true })
    renderWithQuery(<LoginFields />)
    submit("larissa@inia.local", "Kq7m-Pz4x-Wn9r")
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/auth/create-password"))
    expect(screen.getByText("Senha temporária aceita. Agora crie a sua senha.")).toBeInTheDocument()
  })
  it("mostra o motivo da recusa: trava, acesso desabilitado, temporária vencida, credencial inválida", async () => {
    renderWithQuery(<LoginFields />)
    for (const error of [new LoginRefusedError("Muitas tentativas de acesso. Tente novamente em 9 minutos.", "LOGIN_TOO_MANY_ATTEMPTS"), new LoginRefusedError("Seu acesso à INIA está desabilitado. Procure o administrador.", "ACCESS_DISABLED"), new LoginRefusedError("Sua senha temporária expirou. Peça uma nova ao administrador.", "TEMPORARY_PASSWORD_EXPIRED"), new InvalidCredentialsError()]) {
      auth.login.mockRejectedValueOnce(error)
      submit("larissa@inia.local", "x")
      expect(await screen.findByText(error.message)).toBeInTheDocument()
    }
    expect(navigation.push).not.toHaveBeenCalled()
  })
})

describe("tela de criar senha", () => {
  const fill = (newPassword: string, confirmPassword: string) => {
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: newPassword } })
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: confirmPassword } })
  }
  it("campos 'Nova senha' e 'Confirmar nova senha', checklist e aviso de senhas diferentes; só envia quando tudo confere", async () => {
    renderWithQuery(<CreatePasswordForm name="Larissa" email="larissa@inia.local" temporaryPasswordExpiresAt="2026-10-09T12:00:00.000Z" />)
    expect(screen.getByText(/Olá, Larissa!/)).toBeInTheDocument()
    fill("curta", "curta")
    expect(within(screen.getByRole("list", { name: "Requisitos da senha" })).getByText("Pelo menos 8 caracteres").parentElement).toHaveTextContent("(pendente)")
    fireEvent.click(screen.getByRole("button", { name: "Criar senha e entrar" }))
    expect(await screen.findByText("A nova senha ainda não atende a todos os requisitos.")).toBeInTheDocument()
    fill("Primavera2026", "Primavera2027")
    expect(screen.getByText("As senhas não conferem.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Criar senha e entrar" }))
    expect(await screen.findByText("A confirmação não é igual à nova senha.")).toBeInTheDocument()
    expect(auth.defineFirstPassword).not.toHaveBeenCalled()
  })
  it("sucesso: cria a senha e segue para a casa da pessoa (acesso liberado conforme as permissões)", async () => {
    auth.defineFirstPassword.mockResolvedValue(undefined)
    auth.fetchCurrentUser.mockResolvedValue(ME)
    renderWithQuery(<CreatePasswordForm name="Larissa" email="larissa@inia.local" temporaryPasswordExpiresAt={null} />)
    fill("Primavera2026", "Primavera2026")
    fireEvent.click(screen.getByRole("button", { name: "Criar senha e entrar" }))
    await waitFor(() => expect(auth.defineFirstPassword).toHaveBeenCalledWith({ newPassword: "Primavera2026", confirmPassword: "Primavera2026" }))
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/operator"))
  })
  it("recusa do backend (igual à temporária / política) e sessão encerrada (temporária vencida) com caminho de volta", async () => {
    renderWithQuery(<CreatePasswordForm name="Larissa" email="larissa@inia.local" temporaryPasswordExpiresAt={null} />)
    auth.defineFirstPassword.mockRejectedValueOnce(new DefinePasswordError("A nova senha precisa ser diferente da senha temporária.", "PASSWORD_SAME_AS_TEMPORARY", 422))
    fill("Kq7mPz4xWn9r", "Kq7mPz4xWn9r")
    fireEvent.click(screen.getByRole("button", { name: "Criar senha e entrar" }))
    expect(await screen.findByText("A nova senha precisa ser diferente da senha temporária.")).toBeInTheDocument()
    auth.defineFirstPassword.mockRejectedValueOnce(new DefinePasswordError("Sua senha temporária expirou. Peça uma nova ao administrador.", "TEMPORARY_PASSWORD_EXPIRED", 401))
    fill("Primavera2026", "Primavera2026")
    fireEvent.click(screen.getByRole("button", { name: "Criar senha e entrar" }))
    expect(await screen.findByText(/Sua senha temporária expirou/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Voltar para o login" })).toHaveAttribute("href", "/auth/login")
    expect(screen.getByRole("button", { name: "Criar senha e entrar" })).toBeDisabled()
  })
  it("'Sair' encerra a sessão e volta ao login", async () => {
    auth.logout.mockResolvedValue(undefined)
    renderWithQuery(<CreatePasswordForm name="Larissa" email="larissa@inia.local" temporaryPasswordExpiresAt={null} />)
    fireEvent.click(screen.getByRole("button", { name: "Sair" }))
    await waitFor(() => expect(auth.logout).toHaveBeenCalled())
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/auth/login"))
  })
})
