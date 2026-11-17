/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import Link from "next/link"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { EditorialCommunication, EditorialCommunicationSummary } from "@/schemas/communications/communication.schema"

import { formOf, payloadOf, scheduleDescription, wentOut } from "./publication-form"
import { PublicationEditorPage } from "./publication-editor-page"
import { PublicationsListPage } from "./publications-list-page"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/admin/publicacoes", useSearchParams: () => new URLSearchParams() }))

const service = vi.hoisted(() => ({
  createCommunication: vi.fn(),
  updateCommunication: vi.fn(),
  fetchMyCommunications: vi.fn(),
  fetchMyCommunication: vi.fn(),
  fetchAudienceOptions: vi.fn(),
  previewAudience: vi.fn(),
  setCommunicationArchived: vi.fn(),
  retireCommunication: vi.fn(),
  fetchReceivedCommunications: vi.fn(),
  fetchCommunication: vi.fn(),
  fetchModerationCommunications: vi.fn(),
  fetchModerationCommunication: vi.fn(),
  moderateRetireCommunication: vi.fn(),
}))
vi.mock("@/services/communications/communication-service", () => service)
const session = vi.hoisted(() => ({ canModerateCommunications: false, canManageOperationalAlignments: false }))
vi.mock("@/services/auth/auth-service", () => ({ fetchCurrentUser: async () => ({ personId: "me", name: "Ana Souza", displayName: "Ana", jobTitle: "Supervisora", access: { capabilities: { canPublishTeamCommunications: true, canManageConfiguration: true, canManageOperationalAlignments: session.canManageOperationalAlignments, canModerateCommunications: session.canModerateCommunications } } }) }))

beforeAll(() => installJsdomStubs())
beforeEach(() => {
  service.fetchAudienceOptions.mockResolvedValue({ audiences: ["TEAM", "ORGANIZATION", "SEGMENT"], teams: [{ id: "t-ouv", name: "Ouvidoria", universe: "B2C", subteams: [{ id: "s-1", name: "Ouvidoria Manhã" }] }, { id: "t-ret", name: "Retenção", universe: "B2C", subteams: [{ id: "s-r1", name: "Retenção Tarde" }, { id: "s-r2", name: "Retenção Noite" }] }], universes: ["B2C"], products: [] })
  service.previewAudience.mockResolvedValue(12)
})
afterEach(() => { cleanup(); vi.clearAllMocks(); session.canModerateCommunications = false; session.canManageOperationalAlignments = false })

const saved = (overrides: Partial<EditorialCommunication> = {}): EditorialCommunication => ({
  id: "c-1", status: "DRAFT", state: "DRAFT", title: "Segunda via da fatura", contentHtml: "<p>Oriente o app.</p>", plainText: "Oriente o app.", tags: ["Processos"], summary: null, featured: false,
  audience: "TEAM", segment: { universe: null, links: [] }, productNodeId: null, productName: null, publishedAt: null, displayUntil: null, recipientCount: 0,
  createdAt: "2026-11-17T10:00:00.000Z", updatedAt: null, editedAt: null, archivedAt: null, author: { personId: "me", name: "Ana Souza", jobTitle: "Supervisora" }, ...overrides,
})

describe("regras do formulário", () => {
  it("depois que saiu, público e horário não vão ao servidor; agendado volta ao formulário só se ainda não chegou a hora", () => {
    const now = new Date("2026-11-17T12:00:00Z")
    const published = saved({ status: "PUBLISHED", state: "PUBLISHED", publishedAt: "2026-11-17T09:00:00.000Z" })
    expect(wentOut(published, now)).toBe(true)
    expect(payloadOf(formOf(published, now), "PUBLISH", true)).not.toHaveProperty("audience")
    const scheduled = saved({ status: "PUBLISHED", state: "SCHEDULED", publishedAt: "2026-11-18T09:00:00.000Z" })
    expect(formOf(scheduled, now).publishAt).toBe("2026-11-18T09:00:00.000Z")
    expect(payloadOf(formOf(scheduled, now), "PUBLISH", false)).toMatchObject({ audience: "TEAM", publishAt: "2026-11-18T09:00:00.000Z", mode: "PUBLISH" })
    expect(payloadOf(formOf(scheduled, now), "DRAFT", false).publishAt).toBeNull()
    expect(scheduleDescription({ publishAt: null, displayUntil: null }, null)).toBe("Publica assim que você confirmar; fica visível até ser arquivado")
  })
})

describe("Publicações — lista", () => {
  const items: EditorialCommunicationSummary[] = [
    { ...saved(), excerpt: "Oriente o app.", hasImages: false },
    { ...saved({ id: "c-2", title: "Campanha de novembro", status: "PUBLISHED", state: "PUBLISHED", publishedAt: "2026-11-10T12:00:00.000Z", recipientCount: 30, audience: "ORGANIZATION" }), excerpt: "Metas.", hasImages: false },
  ]

  it("mostra estado, filtra por status e busca; vazio convida a criar", async () => {
    service.fetchMyCommunications.mockResolvedValue(items)
    renderWithQuery(<PublicationsListPage />)
    expect(await screen.findByRole("heading", { level: 1, name: "Publicações" })).toBeInTheDocument()
    expect(await screen.findByRole("link", { name: "Segunda via da fatura" })).toHaveAttribute("href", "/admin/publicacoes/c-1")
    expect(screen.getByText("Rascunho")).toBeInTheDocument()
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar publicação" }), { target: { value: "campanha" } })
    await waitFor(() => expect(screen.queryByRole("link", { name: "Segunda via da fatura" })).toBeNull())
    expect(screen.getByRole("link", { name: "Campanha de novembro" })).toBeInTheDocument()
  })

  it("moderação: \"Toda a organização\" lista as de outras pessoas com o autor e leva à conferência", async () => {
    session.canModerateCommunications = true
    service.fetchMyCommunications.mockResolvedValue([])
    service.fetchModerationCommunications.mockResolvedValue([{ ...saved({ id: "c-7", title: "Gracinha", status: "PUBLISHED", state: "PUBLISHED", publishedAt: "2026-11-10T12:00:00.000Z", author: { personId: "p-2", name: "Carlos Lima", jobTitle: null } }), excerpt: "x", hasImages: false }])
    renderWithQuery(<PublicationsListPage />)
    const owner = await screen.findByRole("combobox", { name: "De quem" })
    expect(service.fetchModerationCommunications).not.toHaveBeenCalled()
    fireEvent.click(owner)
    fireEvent.click(await screen.findByRole("option", { name: "Toda a organização" }))
    expect(await screen.findByRole("link", { name: "Gracinha" })).toHaveAttribute("href", "/admin/publicacoes/moderacao/c-7")
    expect(screen.getByText("Carlos Lima")).toBeInTheDocument()
  })

  it("atalho de alinhamento segue a permissão de alinhamentos, não a de configuração", async () => {
    service.fetchMyCommunications.mockResolvedValue([])
    const openNew = async () => {
      const trigger = (await screen.findAllByRole("button", { name: /Nova publicação/ }))[0]!
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
      fireEvent.keyDown(trigger, { key: "Enter" })
      await screen.findByRole("menuitem", { name: /Comunicado/ })
    }
    renderWithQuery(<PublicationsListPage />)
    await openNew()
    expect(screen.queryByRole("menuitem", { name: /Alinhamento operacional/ })).toBeNull()
    cleanup()
    session.canManageOperationalAlignments = true
    renderWithQuery(<PublicationsListPage />)
    await openNew()
    expect(screen.getByRole("menuitem", { name: /Alinhamento operacional/ })).toHaveAttribute("href", "/admin/publicacoes?tipo=alinhamentos&novo=1")
  })

  it("sem publicações: estado vazio com o atalho de criar", async () => {
    service.fetchMyCommunications.mockResolvedValue([])
    renderWithQuery(<PublicationsListPage />)
    expect(await screen.findByText("Nenhuma publicação ainda")).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: /Nova publicação/ }).at(-1)).toHaveAttribute("href", "/admin/publicacoes/nova")
  })

  it("erro ao carregar oferece tentar de novo", async () => {
    service.fetchMyCommunications.mockRejectedValue(new Error("falhou"))
    renderWithQuery(<PublicationsListPage />)
    expect(await screen.findByText("Não foi possível carregar as publicações.")).toBeInTheDocument()
  })
})

describe("Publicações — editor", () => {
  const typeTitle = (value: string) => fireEvent.change(screen.getByRole("textbox", { name: "Título da publicação" }), { target: { value } })
  const typeContent = (html: string) => {
    const editor = screen.getByRole("textbox", { name: "Conteúdo da publicação" })
    editor.innerHTML = html
    fireEvent.input(editor)
  }

  it("nova: salva rascunho (sem exigir conteúdo) e vai para a página dela", async () => {
    service.createCommunication.mockResolvedValue({ id: "c-9", status: "DRAFT", recipientCount: 0, publishedAt: null })
    renderWithQuery(<PublicationEditorPage id={null} />)
    typeTitle("Segunda via")
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Salvar rascunho/ }))
    await waitFor(() => expect(service.createCommunication).toHaveBeenCalledTimes(1))
    expect(service.createCommunication.mock.calls[0]![0]).toMatchObject({ title: "Segunda via", mode: "DRAFT", audience: "TEAM", publishAt: null })
    expect(router.replace).toHaveBeenCalledWith("/admin/publicacoes/c-9")
  })

  it("publicar pede o conteúdo e confirma com público e datas antes de enviar", async () => {
    service.createCommunication.mockResolvedValue({ id: "c-9", status: "PUBLISHED", recipientCount: 12, publishedAt: "2026-11-17T12:00:00.000Z" })
    renderWithQuery(<PublicationEditorPage id={null} />)
    typeTitle("Segunda via")
    fireEvent.click(screen.getByRole("button", { name: /^Publicar$/ }))
    expect(await screen.findByText("Escreva o conteúdo da publicação.")).toBeInTheDocument()
    typeContent("<p>Oriente o <strong>app</strong>.</p>")
    fireEvent.click(screen.getByRole("button", { name: /^Publicar$/ }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/Sua equipe/)).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByText(/12 pessoas hoje/)).toBeInTheDocument())
    expect(within(dialog).getByText(/Publica assim que você confirmar/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Publicar" }))
    await waitFor(() => expect(service.createCommunication).toHaveBeenCalledTimes(1))
    expect(service.createCommunication.mock.calls[0]![0]).toMatchObject({ mode: "PUBLISH", contentHtml: "<p>Oriente o <strong>app</strong>.</p>" })
  })

  it("já publicada: público travado, botão Atualizar só com alteração; prévia mostra público e datas", async () => {
    service.fetchMyCommunication.mockResolvedValue(saved({ status: "PUBLISHED", state: "PUBLISHED", publishedAt: "2026-11-10T12:00:00.000Z", recipientCount: 30, audience: "ORGANIZATION" }))
    service.updateCommunication.mockResolvedValue(saved({ status: "PUBLISHED", state: "PUBLISHED", title: "Novo título", publishedAt: "2026-11-10T12:00:00.000Z", recipientCount: 30, audience: "ORGANIZATION", editedAt: "2026-11-17T12:00:00.000Z" }))
    renderWithQuery(<PublicationEditorPage id="c-1" />)
    expect(await screen.findByDisplayValue("Segunda via da fatura")).toBeInTheDocument()
    expect(screen.getAllByText(/O público não muda depois da publicação/).length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: /Atualizar/ })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: /Pré-visualizar/ }))
    const preview = await screen.findByRole("dialog")
    expect(within(preview).getByText(/Toda a empresa · 30 pessoas hoje/)).toBeInTheDocument()
    expect(within(preview).getByText(/Publicado em 10\/11\/2026/)).toBeInTheDocument()
    expect(within(preview).getByText("Comunicado de Ana")).toBeInTheDocument()
    fireEvent.keyDown(preview, { key: "Escape" })
    typeTitle("Novo título")
    fireEvent.click(screen.getByRole("button", { name: /Atualizar/ }))
    await waitFor(() => expect(service.updateCommunication).toHaveBeenCalledTimes(1))
    const [, input] = service.updateCommunication.mock.calls[0]!
    expect(input).toMatchObject({ title: "Novo título" })
    expect(input).not.toHaveProperty("audience")
    expect(input).not.toHaveProperty("publishAt")
  })

  it("alteração pendente: clicar num link interno pergunta antes de sair", async () => {
    renderWithQuery(<><Link href="/admin/agents">Agentes</Link><PublicationEditorPage id={null} /></>)
    typeTitle("Rascunho")
    fireEvent.click(screen.getByRole("link", { name: "Agentes" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Sair sem salvar?")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Sair sem salvar" }))
    expect(router.push).toHaveBeenCalledWith("/admin/agents")
  })

  it("público específico: escolhe Grupos (um inteiro, outro só alguns Subgrupos), estima o público e envia o recorte", async () => {
    service.createCommunication.mockResolvedValue({ id: "c-9", status: "DRAFT", recipientCount: 0, publishedAt: null })
    renderWithQuery(<PublicationEditorPage id={null} />)
    typeTitle("Ouvidoria")
    fireEvent.click(await screen.findByRole("radio", { name: /Público específico/ }))
    const addGroup = async (name: string) => {
      fireEvent.click(await screen.findByRole("combobox", { name: "Adicionar Grupo" }))
      fireEvent.click(await screen.findByRole("option", { name }))
    }
    await addGroup("Ouvidoria")
    await waitFor(() => expect(service.previewAudience).toHaveBeenCalledWith({ audience: "SEGMENT", segment: { universe: null, links: [{ teamId: "t-ouv", subteamId: null }] } }))
    await addGroup("Retenção")
    fireEvent.click(within(screen.getByTestId("scope-group-t-ret")).getByRole("radio", { name: "Só alguns Subgrupos" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Retenção Noite" }))
    expect(screen.getByTestId("scope-reach-summary")).toHaveTextContent("Vale para: Ouvidoria (Grupo inteiro) · Retenção: só Retenção Noite")
    fireEvent.click(screen.getByRole("button", { name: /Salvar rascunho/ }))
    await waitFor(() => expect(service.createCommunication).toHaveBeenCalled())
    expect(service.createCommunication.mock.calls[0]![0]).toMatchObject({ audience: "SEGMENT", segment: { universe: null, links: [{ teamId: "t-ouv", subteamId: null }, { teamId: "t-ret", subteamId: "s-r2" }] } })
  })

  it("não encontrada (outra pessoa ou retirada): mensagem de erro com voltar", async () => {
    service.fetchMyCommunication.mockRejectedValue(new Error("404"))
    renderWithQuery(<PublicationEditorPage id="c-x" />)
    expect(await screen.findByText(/Não foi possível abrir a publicação/)).toBeInTheDocument()
  })
})
