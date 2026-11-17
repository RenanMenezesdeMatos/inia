/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { Communication, ReceivedCommunication } from "@/schemas/communications/communication.schema"

import { CommunicationEntry } from "./communication-entry"

const service = vi.hoisted(() => ({ retireCommunication: vi.fn(), fetchReceivedCommunications: vi.fn(), fetchCommunication: vi.fn(), moderateRetireCommunication: vi.fn() }))
vi.mock("@/services/communications/communication-service", () => service)
const session = vi.hoisted(() => ({ canModerateCommunications: false }))
vi.mock("@/services/auth/auth-service", () => ({ fetchCurrentUser: async () => ({ personId: "me", name: "Ana", access: { capabilities: { canModerateCommunications: session.canModerateCommunications } } }) }))

beforeAll(() => installJsdomStubs())
afterEach(() => { cleanup(); vi.clearAllMocks(); session.canModerateCommunications = false })

const notice = (overrides: Partial<Communication> = {}): Communication => ({
  id: "c-1", title: "Roteiro novo", contentHtml: "<p>Usem o <strong>roteiro</strong>.</p>", plainText: "Usem o roteiro.", tags: ["Processos"], audience: "TEAM",
  author: { personId: "me", name: "Paula" }, recipientCount: 12, authoredByViewer: true, publishedAt: "2026-11-16T12:00:00.000Z", editedAt: null, ...overrides,
})

const openMenu = () => {
  const trigger = screen.getByRole("button", { name: "Ações do comunicado" })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.keyDown(trigger, { key: "Enter" })
}

describe("Comunicado — ações de quem publicou", () => {
  it("quem recebeu não tem menu; vê \"editado\" quando o texto mudou", () => {
    renderWithQuery(<CommunicationEntry notice={notice({ authoredByViewer: false, recipientCount: null, editedAt: "2026-11-16T13:00:00.000Z" })} />)
    expect(screen.queryByRole("button", { name: "Ações do comunicado" })).toBeNull()
    expect(screen.getByText(/editado/)).toBeInTheDocument()
  })

  it("editar leva à área editorial da publicação (Administração › Publicações)", async () => {
    renderWithQuery(<CommunicationEntry notice={notice()} />)
    openMenu()
    expect(await screen.findByRole("menuitem", { name: "Editar" })).toHaveAttribute("href", "/admin/publicacoes/c-1")
  })

  it("retirar só depois de confirmar; manter não chama o servidor", async () => {
    service.retireCommunication.mockResolvedValue(undefined)
    renderWithQuery(<CommunicationEntry notice={notice()} />)
    openMenu()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Retirar" }))
    expect(await screen.findByText("Retirar o comunicado?")).toBeInTheDocument()
    expect(screen.getByText(/Consultar dados › Itens excluídos/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Manter" }))
    expect(service.retireCommunication).not.toHaveBeenCalled()
    openMenu()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Retirar" }))
    fireEvent.click(await screen.findByRole("button", { name: "Retirar" }))
    await waitFor(() => expect(service.retireCommunication).toHaveBeenCalledWith("c-1"))
  })
})

describe("Comunicado recebido — lista leve", () => {
  const received: ReceivedCommunication = { id: "c-2", title: "Só imagem", excerpt: "", hasImages: true, tags: ["Aviso"], audience: "ORGANIZATION", author: { personId: "x", name: "Diretora" }, recipientCount: null, authoredByViewer: false, publishedAt: "2026-11-16T12:00:00.000Z", editedAt: null }

  it("comunicado só de imagem mostra o aviso, e o conteúdo vem do servidor ao abrir; falha mostra tentar de novo", async () => {
    service.fetchCommunication.mockRejectedValueOnce(new Error("404")).mockResolvedValueOnce({ ...received, contentHtml: `<img src="data:image/png;base64,aGVsbG8=">`, plainText: "(imagem)" })
    renderWithQuery(<CommunicationEntry notice={received} />)
    expect(screen.getByText("Comunicado com imagem.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Ações do comunicado" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Ler comunicado completo" }))
    fireEvent.click(await screen.findByRole("button", { name: "Tentar novamente" }, { timeout: 5_000 }))
    await waitFor(() => expect(screen.getByRole("img", { name: "Imagem do comunicado" })).toBeInTheDocument())
    expect(service.fetchCommunication).toHaveBeenCalledWith("c-2")
  })
})

describe("Comunicado — moderação (Administrador geral)", () => {
  it("quem modera retira o comunicado de outra pessoa com motivo; sem a permissão, não há menu", async () => {
    renderWithQuery(<CommunicationEntry notice={notice({ authoredByViewer: false, recipientCount: null, author: { personId: "p-2", name: "Carlos" } })} />)
    await waitFor(() => expect(screen.queryByRole("button", { name: "Moderação do comunicado" })).toBeNull())
    cleanup()

    session.canModerateCommunications = true
    service.moderateRetireCommunication.mockResolvedValue(undefined)
    renderWithQuery(<CommunicationEntry notice={notice({ authoredByViewer: false, recipientCount: null, author: { personId: "p-2", name: "Carlos" } })} />)
    const trigger = await screen.findByRole("button", { name: "Moderação do comunicado" })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.keyDown(trigger, { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: /Retirar \(moderação\)/ }))
    expect(await screen.findByText("Retirar publicação de Carlos")).toBeInTheDocument()
    const confirm = screen.getByRole("button", { name: "Retirar publicação" })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Motivo da retirada"), { target: { value: "Orientação contrária ao procedimento." } })
    fireEvent.click(confirm)
    await waitFor(() => expect(service.moderateRetireCommunication).toHaveBeenCalledWith("c-1", "Orientação contrária ao procedimento."))
  })
})

