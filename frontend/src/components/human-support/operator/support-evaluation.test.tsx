/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/api-client"
import type { PendingEvaluation } from "@/schemas/human-support/state.schema"

import { SupportEvaluation } from "./support-evaluation"

const service = vi.hoisted(() => ({ evaluateSupportAttendance: vi.fn() }))
vi.mock("@/services/human-support/human-support-service", () => service)

const pending = (current: PendingEvaluation["current"] = { resolved: null, stars: null }): PendingEvaluation => ({
  attendanceId: "att-1", requestId: "req-1", protocol: "AP-1", anjoName: "Ana", openUntil: new Date(Date.now() + 3_600_000).toISOString(), current,
})

beforeEach(() => service.evaluateSupportAttendance.mockReset())
afterEach(cleanup)

describe("avaliação do atendimento: escolher e concluir com \"Enviar avaliação\"", () => {
  it("escolher só marca; enviar grava as duas respostas numa chamada, confirma e conclui", async () => {
    service.evaluateSupportAttendance.mockResolvedValue({ resolved: "YES", stars: 4 })
    const onFinished = vi.fn()
    const onSaved = vi.fn()
    render(<SupportEvaluation pending={pending()} onSaved={onSaved} onFinished={onFinished} />)
    const send = screen.getByRole("button", { name: "Enviar avaliação" })
    expect(send).toBeDisabled()
    expect(screen.getByText("Escolha uma resposta ou as estrelas para enviar.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Sim" }))
    fireEvent.click(screen.getByRole("button", { name: "4 estrelas" }))
    expect(service.evaluateSupportAttendance).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Sim" })).toHaveAttribute("aria-pressed", "true")

    await act(async () => {
      fireEvent.click(send)
    })
    expect(service.evaluateSupportAttendance).toHaveBeenCalledTimes(1)
    expect(service.evaluateSupportAttendance).toHaveBeenCalledWith("att-1", { resolved: "YES", stars: 4 })
    expect(onSaved).toHaveBeenCalledWith({ resolved: "YES", stars: 4 })
    expect(onFinished).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("status")).toHaveTextContent("Avaliação enviada. Obrigado!")
  })

  it("já enviada: \"Atualizar avaliação\", ativo só quando algo mudou; falha aparece e não conclui", async () => {
    service.evaluateSupportAttendance.mockRejectedValueOnce(new ApiError("A janela de avaliação terminou.", 409, "HUMAN_SUPPORT_EVALUATION_CLOSED"))
    const onFinished = vi.fn()
    render(<SupportEvaluation pending={pending({ resolved: "PARTIAL", stars: 3 })} onFinished={onFinished} />)
    const update = screen.getByRole("button", { name: "Atualizar avaliação" })
    expect(update).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "5 estrelas" }))
    expect(update).toBeEnabled()
    await act(async () => {
      fireEvent.click(update)
    })
    expect(screen.getByRole("alert")).toHaveTextContent("A janela de avaliação terminou.")
    expect(onFinished).not.toHaveBeenCalled()
  })
})
