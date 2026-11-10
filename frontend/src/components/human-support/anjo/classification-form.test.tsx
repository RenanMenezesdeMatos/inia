/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { ApiError } from "@/lib/api/api-client"

import { ClassificationForm, validateClassification, type PendingClassification } from "./classification-form"

/** Classificação do atendimento pelo Anjo (design_draft.md seção 12). */
const service = vi.hoisted(() => ({ classifySupportAttendance: vi.fn() }))
vi.mock("@/services/human-support/human-support-service", () => service)

beforeAll(installJsdomStubs)
afterEach(() => cleanup())
beforeEach(() => {
  service.classifySupportAttendance.mockReset()
})

const PENDING: PendingClassification = { attendanceId: "att-1", protocol: "AP-7K2QX9", operatorName: "Bruno", startedAt: "2026-11-09T14:40:00.000Z", endedAt: "2026-11-09T15:00:00.000Z", endCause: "ANJO_CLOSED" }
const TITLE = "Título do processo, sistema ou IA"

const renderForm = () => {
  const onDone = vi.fn()
  render(<ClassificationForm pending={PENDING} onDone={onDone} />)
  return { onDone }
}
const submit = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Enviar classificação" }))
  })
}

describe("ClassificationForm", () => {
  it("motivo e resultado são obrigatórios: nada é enviado sem eles", async () => {
    renderForm()
    await submit()
    expect(screen.getByText("Escolha o motivo do encaminhamento.")).toBeInTheDocument()
    expect(screen.getByText("Escolha o resultado do atendimento.")).toBeInTheDocument()
    expect(service.classifySupportAttendance).not.toHaveBeenCalled()
  })

  it("título: obrigatório quando a informação existia, opcional em pergunta mal formulada e ausente nos demais", async () => {
    renderForm()
    expect(screen.queryByLabelText(new RegExp(TITLE))).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("radio", { name: "Informação existente em processo que poderia ter sido encontrada" }))
    expect(screen.getByLabelText(TITLE)).toBeRequired()
    fireEvent.click(screen.getByRole("radio", { name: "Resolvido no atendimento" }))
    await submit()
    expect(screen.getByText("Informe o título do processo, sistema ou IA.")).toBeInTheDocument()
    expect(service.classifySupportAttendance).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("radio", { name: "Pergunta mal formulada" }))
    expect(screen.getByLabelText(`${TITLE} (opcional)`)).not.toBeRequired()
    fireEvent.click(screen.getByRole("radio", { name: "Falta de processo cadastrado" }))
    expect(screen.queryByLabelText(new RegExp(TITLE))).not.toBeInTheDocument()
  })

  it("\"Outro\" exige a descrição (3 a 1000 caracteres)", async () => {
    renderForm()
    fireEvent.click(screen.getByRole("radio", { name: "Outro" }))
    fireEvent.click(screen.getByRole("radio", { name: "Não resolvido" }))
    await submit()
    expect(screen.getByText("Descreva o motivo.")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Descreva o motivo"), { target: { value: "ab" } })
    expect(screen.getByText("A descrição precisa ter de 3 a 1000 caracteres.")).toBeInTheDocument()
    expect(service.classifySupportAttendance).not.toHaveBeenCalled()
  })

  it("link só http(s)", () => {
    const base = { reason: "NO_PROCESS" as const, title: "", description: "", outcome: "GUIDED" as const }
    expect(validateClassification({ ...base, url: "javascript:alert(1)" }).errors.url).toBe("Use um endereço que comece com http:// ou https://.")
    expect(validateClassification({ ...base, url: "ftp://intranet/proc" }).input).toBeNull()
    expect(validateClassification({ ...base, url: " https://intranet/proc " }).input).toEqual({ reason: "NO_PROCESS", outcome: "GUIDED", referenceUrl: "https://intranet/proc" })
  })

  it("envia o corpo limpo, avisa que foi enviada e atualiza as pendências", async () => {
    service.classifySupportAttendance.mockResolvedValue({ reason: "AVAILABLE_ELSEWHERE", referenceTitle: "IAjuda", referenceUrl: null, otherDescription: null, outcome: "GUIDED" })
    const { onDone } = renderForm()
    fireEvent.click(screen.getByRole("radio", { name: "Informação que poderia ter sido obtida pelo sistema ou por outra IA" }))
    fireEvent.change(screen.getByLabelText(TITLE), { target: { value: "  IAjuda  " } })
    fireEvent.click(screen.getByRole("radio", { name: "Orientado, depende de ação do operador" }))
    await submit()
    expect(service.classifySupportAttendance).toHaveBeenCalledWith("att-1", { reason: "AVAILABLE_ELSEWHERE", referenceTitle: "IAjuda", outcome: "GUIDED" })
    expect(screen.getByRole("status")).toHaveTextContent("Classificação de AP-7K2QX9 enviada.")
    expect(onDone).toHaveBeenCalled()
  })

  it("já classificado (409): mostra o aviso do servidor e atualiza as pendências", async () => {
    service.classifySupportAttendance.mockRejectedValue(new ApiError("Este atendimento já foi classificado.", 409, "HUMAN_SUPPORT_ALREADY_CLASSIFIED"))
    const { onDone } = renderForm()
    fireEvent.click(screen.getByRole("radio", { name: "Falta de alinhamento ou orientação disponível" }))
    fireEvent.click(screen.getByRole("radio", { name: "Encaminhado à liderança ou a outra área" }))
    await submit()
    expect(screen.getByRole("alert")).toHaveTextContent("Este atendimento já foi classificado.")
    expect(onDone).toHaveBeenCalled()
  })

  it("impedimentos operacionais: \"Sem acesso\" e \"Ferramenta indisponível\" são opções separadas, com ferramenta e detalhes opcionais", async () => {
    service.classifySupportAttendance.mockResolvedValue({ reason: "NO_TOOL_ACCESS", referenceTitle: "Siebel", referenceUrl: null, otherDescription: "Perfil sem a permissão de troca de titularidade.", outcome: "FORWARDED" })
    const { onDone } = renderForm()
    const access = screen.getByRole("radio", { name: "Sem acesso à ferramenta ou ao sistema" })
    const down = screen.getByRole("radio", { name: "Ferramenta ou sistema indisponível" })
    expect(access).toHaveAccessibleDescription("O operador não tem acesso ou permissão para executar a ação.")
    expect(down).toHaveAccessibleDescription("Serviço fora do ar, com falha ou instável, que impede a execução.")
    fireEvent.click(access)
    // O motivo não marca o resultado: continua obrigatório e escolhido à parte.
    expect(screen.getByRole("radio", { name: "Resolvido no atendimento" })).not.toBeChecked()
    expect(screen.getByText("Ferramenta ou sistema")).toBeInTheDocument()
    expect(screen.getByLabelText("Ferramenta ou sistema afetado (opcional)")).not.toBeRequired()
    expect(screen.getByLabelText("Detalhes (opcional)")).not.toBeRequired()
    await submit()
    expect(screen.getByText("Escolha o resultado do atendimento.")).toBeInTheDocument()
    expect(service.classifySupportAttendance).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("Ferramenta ou sistema afetado (opcional)"), { target: { value: "  Siebel " } })
    fireEvent.change(screen.getByLabelText("Detalhes (opcional)"), { target: { value: " Perfil sem a permissão de troca de titularidade. " } })
    fireEvent.click(screen.getByRole("radio", { name: "Encaminhado à liderança ou a outra área" }))
    await submit()
    expect(service.classifySupportAttendance).toHaveBeenCalledWith("att-1", { reason: "NO_TOOL_ACCESS", referenceTitle: "Siebel", otherDescription: "Perfil sem a permissão de troca de titularidade.", outcome: "FORWARDED" })
    expect(onDone).toHaveBeenCalled()
  })

  it("impedimento sem ferramenta nem detalhes é aceito; detalhes curtos demais não", () => {
    const base = { reason: "TOOL_UNAVAILABLE" as const, title: "", url: "", outcome: "GUIDED" as const }
    expect(validateClassification({ ...base, description: "" }).input).toEqual({ reason: "TOOL_UNAVAILABLE", outcome: "GUIDED" })
    expect(validateClassification({ ...base, description: "ab" }).errors.description).toBe("Os detalhes precisam ter de 3 a 1000 caracteres.")
    expect(validateClassification({ ...base, title: "ab", description: "" }).errors.title).toBe("O nome da ferramenta ou sistema precisa ter de 3 a 200 caracteres.")
    // Detalhes digitados antes de trocar para um motivo que não os pede não vão para o servidor.
    expect(validateClassification({ ...base, reason: "NO_PROCESS", description: "sobrou" }).input).toEqual({ reason: "NO_PROCESS", outcome: "GUIDED" })
  })
})
