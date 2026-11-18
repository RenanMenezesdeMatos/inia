/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { OperatorDailyFeedbackFeed } from "@/components/operator/operator-daily-feedback-feed"
import type { MyAlignment } from "@/schemas/operational-alignments/my-alignment.schema"

import { civilWeekdayLabel, MyAlignmentEntry } from "./my-alignment-entry"

const service = vi.hoisted(() => ({ fetchMyAlignments: vi.fn(), markMyAlignmentRead: vi.fn() }))
vi.mock("@/services/operational-alignments/my-alignments-service", () => service)
const delivered = vi.hoisted(() => ({ fetchMyDeliveredFeedback: vi.fn(async () => []) }))
vi.mock("@/services/feedback-delivery/feedback-delivery-service", () => delivered)
const communications = vi.hoisted(() => ({ fetchReceivedCommunications: vi.fn(async () => []), fetchCommunication: vi.fn() }))
vi.mock("@/services/communications/communication-service", () => communications)

beforeAll(installJsdomStubs)
afterEach(() => { cleanup(); vi.clearAllMocks() })

const base: MyAlignment = {
  alignmentId: "a-1", versionId: "v-1", version: 1, title: "Fatura pelo App Meu Vivo", guidance: "Oriente o cliente a acessar a fatura pelo App Meu Vivo.\nNão envie a fatura.",
  justification: "Envio suspenso durante a troca do sistema.", changeReason: null, affectedTopic: "Envio da fatura", processes: ["PR — Envio de fatura"], productName: null,
  audienceLabel: "Ouvidoria", startsOn: "2026-11-24", endsOn: "2026-11-30", timeZone: "America/Sao_Paulo", effectiveFrom: "2026-11-24T03:00:00.000Z", effectiveUntil: "2026-12-01T03:00:00.000Z",
  state: "IN_FORCE", noLongerValidSince: null, endedEarly: false, publishedAt: "2026-11-21T19:02:00.000Z", definedBy: { name: "Ana Souza", jobTitle: "Supervisora" }, readAt: null,
}

describe("cartão do alinhamento no Acompanhamento do operador", () => {
  it("dia da semana da data civil, sem deslocar pelo fuso de quem lê", () => {
    expect(civilWeekdayLabel("2026-11-24")).toBe("Terça-feira, 24/11")
  })

  it("antes de valer: faixa em destaque \"válido a partir de\", selo \"Começa em\" e a vigência sempre visível", () => {
    renderWithQuery(<MyAlignmentEntry alignment={{ ...base, state: "UPCOMING" }} />)
    expect(screen.getByTestId("alignment-upcoming-banner")).toHaveTextContent("Alinhamento válido a partir de terça-feira, 24/11")
    expect(screen.getByTestId("alignment-upcoming-banner")).toHaveTextContent("Até lá, siga o procedimento de hoje.")
    expect(screen.getByText("Começa em 24/11")).toBeInTheDocument()
    expect(screen.getByTestId("alignment-period")).toHaveTextContent("Vigência 24/11/2026 a 30/11/2026")
    expect(screen.getByRole("heading", { name: "Fatura pelo App Meu Vivo" })).toBeInTheDocument()
    expect(screen.getByText("Definido por Ana Souza (Supervisora)")).toBeInTheDocument()
  })

  it("em vigor: sem faixa; leitura simples grava e vira \"Você leu em\"", async () => {
    service.markMyAlignmentRead.mockResolvedValue({ readAt: "2026-11-25T13:14:00.000Z" })
    renderWithQuery(<MyAlignmentEntry alignment={base} />)
    expect(screen.queryByTestId("alignment-upcoming-banner")).toBeNull()
    expect(screen.queryByTestId("alignment-ended-banner")).toBeNull()
    expect(screen.getByText("Em vigor · até 30/11")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Li o alinhamento" }))
    await waitFor(() => expect(service.markMyAlignmentRead).toHaveBeenCalledWith("a-1", "v-1"))
  })

  it("nova versão: \"Atualizado em\", o que mudou e \"Li a nova versão\"", () => {
    renderWithQuery(<MyAlignmentEntry alignment={{ ...base, version: 2, versionId: "v-2", changeReason: "Inclusão do site" }} />)
    expect(screen.getByText(/Atualizado em/)).toBeInTheDocument()
    expect(screen.getByText("O que mudou nesta versão")).toBeInTheDocument()
    expect(screen.getByText("Inclusão do site")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Li a nova versão" })).toBeInTheDocument()
  })

  it("não vale mais: vermelho, símbolo de PARE e \"Este alinhamento não está mais vigente\"; sem botão de leitura", () => {
    renderWithQuery(<MyAlignmentEntry alignment={{ ...base, state: "ENDED", noLongerValidSince: "2026-12-01", readAt: "2026-11-25T13:14:00.000Z" }} />)
    const banner = screen.getByTestId("alignment-ended-banner")
    expect(banner).toHaveTextContent("Este alinhamento não está mais vigente")
    expect(banner).toHaveTextContent("A vigência terminou em 30/11/2026.")
    expect(banner).toHaveAttribute("role", "alert")
    expect(document.querySelector("[data-slot=feedback-entry-header]")).toHaveAttribute("data-family", "ALIGNMENT_ENDED")
    expect(screen.getByText("Não vale mais")).toBeInTheDocument()
    expect(screen.getByTestId("alignment-period")).toHaveTextContent("Vigência 24/11/2026 a 30/11/2026")
    expect(screen.queryByRole("button", { name: /Li o/ })).toBeNull()
    expect(screen.getByTestId("alignment-read")).toHaveTextContent("Você leu em")
  })

  it("encerrado antes do prazo diz o dia do encerramento", () => {
    renderWithQuery(<MyAlignmentEntry alignment={{ ...base, state: "ENDED", noLongerValidSince: "2026-11-27", endedEarly: true }} />)
    expect(screen.getByTestId("alignment-ended-banner")).toHaveTextContent("Encerrado antes do prazo em 27/11/2026.")
  })
})

describe("alinhamentos no feed do operador", () => {
  it("entram na timeline, têm o filtro \"Alinhamentos\" e o link do sino destaca o item", async () => {
    service.fetchMyAlignments.mockResolvedValue([base, { ...base, alignmentId: "a-2", versionId: "w-1", title: "Prazo de retorno", publishedAt: "2026-11-20T12:00:00.000Z", state: "ENDED", noLongerValidSince: "2026-11-21" }])
    renderWithQuery(<OperatorDailyFeedbackFeed indicators={{ current: [], history: [] }} highlightItemKey="alignment:a-2" />)
    expect(await screen.findByRole("heading", { name: "Fatura pelo App Meu Vivo" })).toBeInTheDocument()
    expect(screen.getAllByTestId("alignment-entry")).toHaveLength(2)
    await waitFor(() => expect(document.querySelector("[data-testid=alignment-entry][data-highlighted]")).toHaveAttribute("data-state", "ENDED"))
    fireEvent.click(screen.getByRole("button", { name: /Filtrar o Acompanhamento por tipo/ }))
    const popover = await screen.findByRole("dialog")
    expect(within(popover).getByRole("checkbox", { name: "Alinhamentos" })).toBeChecked()
    fireEvent.click(within(popover).getByRole("checkbox", { name: "Alinhamentos" }))
    await waitFor(() => expect(screen.queryAllByTestId("alignment-entry")).toHaveLength(0))
  })
})

/** O alinhamento da estrutura não traz a leitura de quem lê (traz o alcance). */
const structureOf = (alignment: MyAlignment): Omit<MyAlignment, "readAt"> => Object.fromEntries(Object.entries(alignment).filter(([key]) => key !== "readAt")) as Omit<MyAlignment, "readAt">

describe("alinhamento no Acompanhamento de quem lidera (fase 2)", () => {
  it("mostra quantos da equipe leram, sem o botão de leitura", () => {
    renderWithQuery(<MyAlignmentEntry alignment={{ ...structureOf(base), version: 2, versionId: "v-2", audienceLabel: "Ouvidoria; Retenção", reach: { people: 36, read: 9 } }} />)
    expect(screen.getByTestId("alignment-team-reads")).toHaveTextContent("9 de 36 pessoas da equipe leram esta versão")
    expect(screen.getByTestId("alignment-team-reads")).toHaveTextContent("25%")
    expect(screen.getByRole("progressbar", { name: "Leitura do alinhamento pela equipe" })).toHaveAttribute("aria-valuenow", "9")
    expect(screen.queryByRole("button", { name: /Li / })).toBeNull()
    expect(screen.getByText("Para Ouvidoria; Retenção")).toBeInTheDocument()
  })
})
