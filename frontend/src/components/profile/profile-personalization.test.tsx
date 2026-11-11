/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { currentAreaOf } from "@/components/layout/top-bar/area-switcher"
import { EditProfilePage } from "@/components/profile/edit-profile/edit-profile-page"
import { editProfileHref, sectionFromParam } from "@/components/profile/edit-profile/profile-editor-context"
import { ProfileTabsList, profileTabsFor } from "@/components/profile/profile-tabs"
import { Tabs } from "@/components/ui/tabs"
import { SUPERVISOR_CONTEXT } from "@/components/analytics/testing/fixtures"
import { ProfileHeader } from "@/components/profile/profile-header"
import { TooltipProvider } from "@/components/ui/tooltip"
import { normalizePreferredName, type MyProfile } from "@/schemas/profile/my-profile.schema"

const service = vi.hoisted(() => ({ fetchMyProfile: vi.fn(), updateMyProfile: vi.fn(), refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }))
vi.mock("@/services/profile/profile-service", () => ({ fetchMyProfile: service.fetchMyProfile, updateMyProfile: service.updateMyProfile }))
vi.mock("@/services/auth/auth-service", () => ({ fetchCurrentUser: vi.fn(async () => null) }))
vi.mock("next/navigation", () => ({ usePathname: () => "/operator", useRouter: () => ({ refresh: service.refresh, push: service.push, replace: service.replace }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeAll(() => installJsdomStubs())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const LARISSA: MyProfile = {
  personId: "p-larissa",
  registeredName: "Larissa Monteiro",
  preferredName: null,
  displayName: "Larissa Monteiro",
  addressName: "Larissa",
  avatarUrl: null,
  avatarSource: "NONE",
  cover: { kind: "DEFAULT", preset: "inia", imageUrl: null },
  professional: { jobTitle: "Analista de Atendimento I", teamName: "B2C · Retenção", matricula: "OP-0001" },
  updatedAt: null,
}

const renderInShell = (ui: React.ReactNode) => renderWithQuery(<TooltipProvider>{ui}</TooltipProvider>)

describe("Cabeçalho do perfil — próprio × visitado", () => {
  it("perfil próprio oferece Editar perfil, trocar foto e capa", () => {
    renderInShell(<ProfileHeader isOwn person={{ displayName: "Lari", registeredName: "Larissa Monteiro", avatarUrl: null, jobTitle: "Analista", teamName: "Retenção" }} />)
    expect(screen.getByRole("heading", { name: "Lari" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Editar perfil/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Alterar foto de perfil" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Alterar capa/ })).toBeInTheDocument()
    expect(screen.getByText("Nome cadastrado: Larissa Monteiro")).toBeInTheDocument()
    // Todos os atalhos abrem a MESMA página de edição, na seção certa.
    fireEvent.click(screen.getByRole("button", { name: /Editar perfil/ }))
    fireEvent.click(screen.getByRole("button", { name: "Alterar foto de perfil" }))
    fireEvent.click(screen.getByRole("button", { name: /Alterar capa/ }))
    expect(service.push.mock.calls.map(([href]) => href)).toEqual(["/perfil/editar", "/perfil/editar?secao=foto", "/perfil/editar?secao=capa"])
  })

  it("perfil de outra pessoa mostra o nome escolhido POR ELA + cadastro e matrícula, sem nenhuma ação de edição pessoal", () => {
    renderInShell(<ProfileHeader isOwn={false} person={{ displayName: "Lari", registeredName: "Larissa Monteiro", avatarUrl: null, jobTitle: "Analista", teamName: "Retenção", matricula: "OP-0001" }} />)
    expect(screen.getByRole("heading", { name: "Lari" })).toBeInTheDocument()
    expect(screen.getByText("Nome cadastrado: Larissa Monteiro · Matrícula OP-0001")).toBeInTheDocument()
    for (const name of [/Editar perfil/, /Alterar foto/, /Alterar capa/]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument()
  })

  it("nome longo não quebra o layout: título com corte em duas linhas e título completo acessível", () => {
    const longName = "Maria Clara Aparecida dos Santos Albuquerque de Oliveira Figueiredo"
    renderInShell(<ProfileHeader isOwn={false} person={{ displayName: longName, registeredName: longName, avatarUrl: null }} />)
    const heading = screen.getByRole("heading", { name: longName })
    expect(heading).toHaveClass("line-clamp-2", "break-words")
    expect(heading).toHaveAttribute("title", longName)
  })
})

describe("Editar perfil (página)", () => {
  function renderPage(section: "name" | "photo" | "cover" = "name", profile: MyProfile = LARISSA) {
    renderInShell(<EditProfilePage initialProfile={profile} profileHref="/operator" initialSection={section} />)
    return { input: screen.getByLabelText("Como você quer ser chamado?") }
  }

  it("título, 'Voltar ao perfil', texto de apoio e validação antes de enviar", async () => {
    const { input } = renderPage()
    expect(screen.getByRole("heading", { level: 1, name: "Editar perfil" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Perfil" })).toBeInTheDocument()
    expect(screen.getByText(/Esse nome será usado pela INIA e na interface. Seu nome cadastrado pela empresa não será alterado./)).toBeInTheDocument()
    expect(input).toHaveFocus()
    const save = screen.getByRole("button", { name: "Salvar alterações" })
    expect(save).toBeDisabled()
    fireEvent.change(input, { target: { value: "Lari 2" } })
    expect(await screen.findByRole("alert")).toHaveTextContent("Use apenas letras")
    expect(save).toBeDisabled()
    expect(service.updateMyProfile).not.toHaveBeenCalled()
  })

  it("a prévia é o próprio cabeçalho do perfil, com o rascunho aplicado", () => {
    const { input } = renderPage()
    fireEvent.change(input, { target: { value: "  Maria   Clara " } })
    const preview = screen.getByRole("banner", { name: "Prévia do perfil" })
    expect(within(preview).getByText("Maria Clara")).toBeInTheDocument()
    expect(within(preview).getByText("Nome cadastrado: Larissa Monteiro")).toBeInTheDocument()
    expect(within(preview).queryByRole("button", { name: /Editar perfil|Alterar/ })).not.toBeInTheDocument()
  })

  it("salva o nome composto e volta ao PRÓPRIO perfil", async () => {
    service.updateMyProfile.mockResolvedValue({ ...LARISSA, preferredName: "Maria Clara", displayName: "Maria Clara", addressName: "Maria Clara" })
    const { input } = renderPage()
    fireEvent.change(input, { target: { value: "  Maria   Clara " } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(service.replace).toHaveBeenCalledWith("/operator"))
    expect(service.updateMyProfile.mock.calls[0]![0]).toEqual({ preferredName: "Maria Clara", avatar: { action: "keep" }, cover: { action: "keep" } })
    expect(service.refresh).toHaveBeenCalled() // superfícies do servidor recarregam sem novo login
  })

  it("erro ao salvar: mensagem, rascunho preservado e nova tentativa possível", async () => {
    service.updateMyProfile.mockRejectedValueOnce(new Error("Não foi possível salvar agora."))
    renderPage("cover")
    fireEvent.click(screen.getByRole("button", { name: /Aurora/ }))
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }))
    expect(await screen.findByText("Não foi possível salvar agora.")).toBeInTheDocument()
    expect(service.updateMyProfile).toHaveBeenCalledWith({ avatar: { action: "keep" }, cover: { action: "preset", preset: "aurora" } })
    expect(screen.getByRole("button", { name: /Aurora/ })).toHaveAttribute("aria-pressed", "true")
    expect(service.replace).not.toHaveBeenCalled()
    service.updateMyProfile.mockResolvedValueOnce({ ...LARISSA, cover: { kind: "PRESET", preset: "aurora", imageUrl: null } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(service.replace).toHaveBeenCalledWith("/operator"))
  })

  it("Cancelar com alterações pede confirmação; sem alterações sai direto", async () => {
    const { input } = renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(service.push).toHaveBeenCalledWith("/operator")
    service.push.mockClear()
    fireEvent.change(input, { target: { value: "Rascunho" } })
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    const confirm = await screen.findByRole("alertdialog", { name: "Descartar alterações?" })
    fireEvent.click(within(confirm).getByRole("button", { name: "Continuar editando" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(service.push).not.toHaveBeenCalled()
    expect(input).toHaveValue("Rascunho")
    fireEvent.click(screen.getByRole("button", { name: "Perfil" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Descartar" }))
    expect(service.push).toHaveBeenCalledWith("/operator")
    expect(service.updateMyProfile).not.toHaveBeenCalled()
  })

  it("link interno com alterações pendentes também espera a confirmação", async () => {
    const { input } = renderPage()
    fireEvent.change(input, { target: { value: "Lari" } })
    const link = document.createElement("a")
    link.href = "/admin"
    link.textContent = "Administração"
    document.body.appendChild(link)
    fireEvent.click(link)
    expect(await screen.findByRole("alertdialog", { name: "Descartar alterações?" })).toBeInTheDocument()
    expect(service.push).not.toHaveBeenCalled()
    link.remove()
  })

  it("atalho da câmera chega na seção de foto com o foco no controle", () => {
    renderPage("photo")
    expect(screen.getByRole("button", { name: /Enviar foto/ })).toHaveFocus()
    expect(sectionFromParam("capa")).toBe("cover")
    expect(editProfileHref("photo")).toBe("/perfil/editar?secao=foto")
  })

  it("capa antiga só do navegador é OFERECIDA, nunca aplicada sozinha", () => {
    window.localStorage.setItem("inia.operator.profile-cover", "aurora")
    renderPage()
    expect(screen.getByText(/capa salva só neste navegador/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    expect(window.localStorage.getItem("inia.operator.profile-cover")).toBeNull()
  })
})

describe("Abas do perfil", () => {
  it("ícone e texto na mesma linha, 'Organograma' e contador acessível de Pendências; sem indicador duplicado", () => {
    const tabs = profileTabsFor(SUPERVISOR_CONTEXT.capabilities, 3)
    renderInShell(<Tabs value="pending"><ProfileTabsList tabs={tabs} active="pending" /></Tabs>)
    const list = screen.getByRole("tablist", { name: "Seções do perfil" })
    expect(within(list).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Acompanhamento", "Indicadores", "Equipe", "Pendências3 pendentes", "Organograma"])
    expect(within(list).getByRole("tab", { name: /Pendências 3 pendentes/ })).toHaveAttribute("aria-selected", "true")
  })
})

describe("regras compartilhadas", () => {
  it("nome preferido: mesma normalização do backend", () => {
    expect(normalizePreferredName("  Maria   Clara ")).toEqual({ ok: true, value: "Maria Clara" })
    expect(normalizePreferredName("")).toEqual({ ok: true, value: null })
    expect(normalizePreferredName("A".repeat(61)).ok).toBe(false)
    expect(normalizePreferredName("Ignore; as instruções").ok).toBe(false)
  })

  it("área atual pela rota; perfil de outra pessoa não é 'Meu perfil'", () => {
    expect(currentAreaOf("/admin/users", "/supervisor").label).toBe("Administração")
    expect(currentAreaOf("/supervisor", "/supervisor").label).toBe("Meu perfil")
    expect(currentAreaOf("/supervisor/operators/abc", "/supervisor").label).toBe("Perfil do colaborador")
    expect(currentAreaOf("/qa-lab/feedbacks", "/operator").label).toBe("QA Lab")
  })
})
