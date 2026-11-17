/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { ApiError } from "@/lib/api/api-client"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { ResponseTimesPanel } from "@/schemas/human-support/admin.schema"

import { ResponseTimesControl, responseTimesProblem } from "./response-times-control"

const service = vi.hoisted(() => ({ fetchResponseTimes: vi.fn(), saveResponseTimes: vi.fn() }))
vi.mock("@/services/human-support/human-support-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const DEFAULT = { operatorRequeueMinutes: 15, operatorCloseMinutes: 20, anjoRequeueMinutes: 15 }
const COORDINATOR: ResponseTimesPanel = { organization: { times: DEFAULT, anjoUnresponsive: { pauseAfterMinutes: 20, offlineAfterMinutes: 10 }, version: 3, canEdit: false }, groups: [{ teamId: "g1", teamName: "Retenção", custom: false, times: DEFAULT, version: 0, canEdit: true }] }

beforeAll(() => installJsdomStubs())
beforeEach(() => {
  service.fetchResponseTimes.mockResolvedValue(COORDINATOR)
  service.saveResponseTimes.mockReset()
})
afterEach(() => cleanup())

describe("Tempos de resposta (migrations 193/194)", () => {
  it("as mesmas regras do servidor", () => {
    expect(responseTimesProblem({ operatorRequeueMinutes: 15, operatorCloseMinutes: 20, anjoRequeueMinutes: 15 })).toBeNull()
    expect(responseTimesProblem({ operatorRequeueMinutes: 15, operatorCloseMinutes: 15, anjoRequeueMinutes: 15 })).toBe("O encerramento precisa ser depois da volta à fila do operador.")
    expect(responseTimesProblem({ operatorRequeueMinutes: 0, operatorCloseMinutes: 20, anjoRequeueMinutes: 15 })).toBe("Os tempos de volta à fila vão de 1 a 120 minutos.")
  })

  it("Coordenador do Grupo: vê só o próprio Grupo, cada tempo diz a partir de quando conta, bloqueia o inválido e salva no Grupo", async () => {
    service.saveResponseTimes.mockResolvedValue(COORDINATOR)
    renderWithQuery(<ResponseTimesControl />)
    fireEvent.click(await screen.findByRole("button", { name: /Tempos de resposta.*15\/20\/15 min/ }))
    expect(await screen.findByText("Grupo Retenção")).toBeInTheDocument()
    expect(screen.getByTestId("response-times-source")).toHaveTextContent("Este Grupo usa o padrão da organização (15/20/15 min). Ao salvar, ele passa a ter tempos próprios.")
    expect(screen.queryByText("Padrão da organização")).not.toBeInTheDocument()
    // Os tempos do Anjo que não responde ninguém são da organização: o Coordenador do Grupo só os lê.
    expect(screen.getByTestId("anjo-unresponsive-note")).toHaveTextContent("Anjo que não responde ninguém por 20 min entra em pausa “Desconexão”; 10 min nela sem voltar, fica Indisponível.")
    // A partir de quando conta, em cada tempo.
    expect(screen.getByText("Conta a partir da última mensagem do Anjo.")).toBeInTheDocument()
    expect(screen.getByText(/Também conta a partir da última mensagem do Anjo — não de quando o pedido passou a aguardar/)).toBeInTheDocument()
    expect(screen.getByText(/Conta a partir da última mensagem do operador — ou do início do atendimento/)).toBeInTheDocument()
    const operator = screen.getByLabelText("Operador sem responder")
    const close = screen.getByLabelText("Encerrar se o operador não voltar")
    const anjo = screen.getByLabelText("Anjo sem responder")
    fireEvent.change(close, { target: { value: "10" } })
    expect(screen.getByRole("alert")).toHaveTextContent("O encerramento precisa ser depois da volta à fila do operador.")
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled()
    fireEvent.change(operator, { target: { value: "10" } })
    fireEvent.change(close, { target: { value: "25" } })
    fireEvent.change(anjo, { target: { value: "12" } })
    expect(screen.getByText(/o operador tem mais 15 min depois de o Anjo ficar livre/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(service.saveResponseTimes).toHaveBeenCalledWith({ teamId: "g1", times: { operatorRequeueMinutes: 10, operatorCloseMinutes: 25, anjoRequeueMinutes: 12 }, version: 0 }))
  })

  it("Grupo com tempos próprios volta ao padrão; sem permissão, só leitura", async () => {
    service.fetchResponseTimes.mockResolvedValue({ ...COORDINATOR, groups: [{ ...COORDINATOR.groups[0]!, custom: true, times: { operatorRequeueMinutes: 10, operatorCloseMinutes: 12, anjoRequeueMinutes: 5 }, version: 2 }] })
    service.saveResponseTimes.mockResolvedValue(COORDINATOR)
    renderWithQuery(<ResponseTimesControl />)
    fireEvent.click(await screen.findByRole("button", { name: /Tempos de resposta.*10\/12\/5 min/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Usar o padrão da organização" }))
    await waitFor(() => expect(service.saveResponseTimes).toHaveBeenCalledWith({ teamId: "g1", times: null, version: 2 }))
    cleanup()
    service.fetchResponseTimes.mockResolvedValue({ ...COORDINATOR, groups: [{ ...COORDINATOR.groups[0]!, canEdit: false }] })
    renderWithQuery(<ResponseTimesControl />)
    fireEvent.click(await screen.findByRole("button", { name: /Tempos de resposta/ }))
    expect(await screen.findByLabelText("Anjo sem responder")).toBeDisabled()
    expect(screen.getByTestId("response-times-source")).toHaveTextContent("Só o Coordenador de Anjos do Grupo muda estes tempos.")
    expect(screen.queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument()
  })

  it("quem acompanha a organização começa pelo padrão e salva o padrão", async () => {
    service.fetchResponseTimes.mockResolvedValue({ ...COORDINATOR, organization: { ...COORDINATOR.organization, canEdit: true } })
    service.saveResponseTimes.mockResolvedValue(COORDINATOR)
    renderWithQuery(<ResponseTimesControl />)
    fireEvent.click(await screen.findByRole("button", { name: /Tempos de resposta/ }))
    expect(await screen.findByText("Vale para todo Grupo sem tempos próprios.")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Anjo sem responder"), { target: { value: "30" } })
    // Anjo que não responde ninguém (195): a partir de quando conta e o que acontece, editável só no padrão.
    expect(screen.getByText(/Conta a partir do primeiro retorno que ele ficou devendo a um operador/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Tempo na pausa Desconexão"), { target: { value: "0" } })
    expect(screen.getByRole("alert")).toHaveTextContent("O tempo na pausa Desconexão vai de 1 a 120 minutos.")
    fireEvent.change(screen.getByLabelText("Tempo na pausa Desconexão"), { target: { value: "5" } })
    fireEvent.change(screen.getByLabelText("Anjo sem responder ninguém"), { target: { value: "25" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(service.saveResponseTimes).toHaveBeenCalledWith({ teamId: null, times: { operatorRequeueMinutes: 15, operatorCloseMinutes: 20, anjoRequeueMinutes: 30 }, anjoUnresponsive: { pauseAfterMinutes: 25, offlineAfterMinutes: 5 }, version: 3 }))
  })

  it("outra pessoa salvou antes: avisa e recarrega", async () => {
    service.saveResponseTimes.mockRejectedValue(new ApiError("mudou", 409, "HUMAN_SUPPORT_CONCURRENT_CHANGE"))
    renderWithQuery(<ResponseTimesControl />)
    fireEvent.click(await screen.findByRole("button", { name: /Tempos de resposta/ }))
    fireEvent.change(await screen.findByLabelText("Anjo sem responder"), { target: { value: "30" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    expect(await screen.findByText(/Outra pessoa alterou os tempos/)).toBeInTheDocument()
  })
})
