/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { Communication, ReceivedCommunication } from "@/schemas/communications/communication.schema"

import { CommunicationEntry } from "./communication-entry"

const service = vi.hoisted(() => ({ editCommunication: vi.fn(), retireCommunication: vi.fn(), publishCommunication: vi.fn(), fetchReceivedCommunications: vi.fn(), fetchCommunication: vi.fn() }))
vi.mock("@/services/communications/communication-service", () => service)

beforeAll(() => installJsdomStubs())
afterEach(() => { cleanup(); vi.clearAllMocks() })

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

  it("editar abre o formulário com o texto atual e salva sem mexer no público", async () => {
    service.editCommunication.mockResolvedValue(notice({ title: "Roteiro corrigido", editedAt: "2026-11-16T13:00:00.000Z" }))
    renderWithQuery(<CommunicationEntry notice={notice()} />)
    openMenu()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Editar" }))
    const title = await screen.findByLabelText("Título")
    expect(title).toHaveValue("Roteiro novo")
    expect(screen.getByText(/O público não muda \(sua equipe\)/)).toBeInTheDocument()
    expect(screen.queryByText("Publicar para")).toBeNull()
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Conteúdo do comunicado" }).innerHTML).toContain("<strong>roteiro</strong>"))
    fireEvent.change(title, { target: { value: "Roteiro corrigido" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(service.editCommunication).toHaveBeenCalledTimes(1))
    const [id, input] = service.editCommunication.mock.calls[0]!
    expect(id).toBe("c-1")
    expect(input).toEqual({ title: "Roteiro corrigido", contentHtml: expect.stringContaining("<strong>roteiro</strong>"), tags: ["Processos"] })
    expect(input).not.toHaveProperty("audience")
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
