/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { JourneyDay, MyJourneyView as MyJourneyData } from "@/schemas/my-journey/my-journey.schema"

import { nowInTimeZone, weekRangeLabel } from "./journey-format"
import { journeyMilestones, momentAt, timelineWindow } from "./journey-moments"
import { MyJourneyView } from "./my-journey-view"

const service = vi.hoisted(() => ({ fetchMyJourney: vi.fn() }))
vi.mock("@/services/my-journey/my-journey-service", () => service)

const SHIFT_BLOCKS: JourneyDay["blocks"] = [
  { kind: "SHIFT", label: "Jornada prevista", startMinute: 480, endMinute: 860, continuesFromPreviousDay: false, continuesNextDay: false },
]

function day(date: string, patch: Partial<JourneyDay> = {}): JourneyDay {
  return { date, kind: "WORK", label: "Dia de trabalho", shift: { start: "08:00", end: "14:20", crossesMidnight: false, source: "SCHEDULE_DAY" }, exceptions: [], activities: [], blocks: SHIFT_BLOCKS, ...patch }
}

const nonWorking = (label: string): JourneyDay["blocks"] => [{ kind: "NON_WORKING", label, startMinute: 0, endMinute: 1440, continuesFromPreviousDay: false, continuesNextDay: false }]

const WEEK: MyJourneyData = {
  today: "2026-11-17",
  timeZone: "America/Sao_Paulo",
  generatedAt: "2026-11-17T13:00:00.000Z",
  week: { from: "2026-11-16", to: "2026-11-22", previous: "2026-11-09", next: "2026-11-23", containsToday: true },
  pauses: { available: false, message: "O detalhamento das pausas ainda não chega à INIA." },
  days: [
    day("2026-11-16", { kind: "DAY_OFF", label: "Folga", shift: null, blocks: nonWorking("Folga") }),
    day("2026-11-17"),
    day("2026-11-18", { kind: "EXCEPTION", label: "Banco de horas", shift: null, exceptions: [{ id: "e1", code: "BANCO_HORAS", label: "Banco de horas", originLabel: "Central de Dados" }], blocks: nonWorking("Banco de horas") }),
    day("2026-11-19", { kind: "NO_SCHEDULE", label: "Sem escala publicada", shift: null, blocks: [] }),
    day("2026-11-20", { shift: { start: "22:00", end: "04:20", crossesMidnight: true, source: "SCHEDULE_DAY" } }),
    day("2026-11-21", { kind: "EMPLOYMENT_STATUS", label: "Férias", shift: null, blocks: nonWorking("Férias") }),
    day("2026-11-22", { shift: null, blocks: [] }),
  ],
}

beforeAll(() => installJsdomStubs())
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-17T13:00:00.000Z")) // 10h00 em São Paulo
  service.fetchMyJourney.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("Minha jornada — Hoje", () => {
  it("mostra entrada, próxima pausa (indisponível com aviso), fim da jornada e marca 'Agora' no bloco previsto", async () => {
    service.fetchMyJourney.mockResolvedValue(WEEK)
    renderWithQuery(<MyJourneyView />)
    expect(await screen.findByText("Entrada prevista")).toBeInTheDocument()
    expect(within(screen.getByText("Entrada prevista").parentElement!).getByText("8h00")).toBeInTheDocument()
    expect(within(screen.getByText("Fim da jornada").parentElement!).getByText("14h20")).toBeInTheDocument()
    expect(screen.getByText("Sem detalhe")).toBeInTheDocument()
    expect(screen.getByRole("note")).toHaveTextContent("O detalhamento das pausas ainda não chega à INIA.")
    // Agenda: Entrada (já passou) e Saída como próximo marco; a barra mostra a linha do "Agora".
    const agenda = screen.getByRole("list", { name: "Horários do dia" })
    expect(within(agenda).getAllByRole("listitem").map((item) => item.textContent)).toEqual([expect.stringContaining("8h00Entrada"), expect.stringContaining("14h20Saída")])
    expect(within(agenda).getByRole("listitem", { current: "step" })).toHaveTextContent("Próximo · em 4h20")
    expect(screen.getByTestId("journey-now-line")).toBeInTheDocument()
    expect(service.fetchMyJourney).toHaveBeenCalledWith(null)
  })

  it("com atividades escaladas: próxima pausa com horário e contagem, bloco 'Pausa prevista' e o login marcado como agora", async () => {
    const blocks: JourneyDay["blocks"] = [
      { kind: "LOGGED_IN", label: "Logado para atendimento", startMinute: 480, endMinute: 620, continuesFromPreviousDay: false, continuesNextDay: false },
      { kind: "BREAK", label: "Pausa NR17", startMinute: 620, endMinute: 630, continuesFromPreviousDay: false, continuesNextDay: false },
      { kind: "LOGGED_IN", label: "Logado para atendimento", startMinute: 630, endMinute: 860, continuesFromPreviousDay: false, continuesNextDay: false },
    ]
    const activities: JourneyDay["activities"] = [
      { type: "LOGGED_IN", typeLabel: "Logado para atendimento", name: "Logado", start: "08:00", end: "14:20", crossesMidnight: false },
      { type: "BREAK", typeLabel: "Pausa programada", name: "Pausa NR17", start: "10:20", end: "10:30", crossesMidnight: false },
    ]
    service.fetchMyJourney.mockResolvedValue({ ...WEEK, pauses: { available: true, message: "Pausas e atividades conforme a escala publicada." }, days: WEEK.days.map((item) => (item.date === "2026-11-17" ? { ...item, activities, blocks } : item)) })
    renderWithQuery(<MyJourneyView />)
    expect(await screen.findByText("10h20 – 10h30")).toBeInTheDocument()
    expect(screen.getByText("Pausa NR17 · em 20 min")).toBeInTheDocument()
    const agenda = screen.getByRole("list", { name: "Horários do dia" })
    expect(within(agenda).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("8h00Login"),
      expect.stringContaining("10h20Pausa NR17"),
      expect.stringContaining("10h30Retorno"),
      expect.stringContaining("14h20Logout"),
    ])
    expect(within(agenda).getByRole("listitem", { current: "step" })).toHaveTextContent("Pausa de 10 min · volta às 10h30")
    expect(screen.queryByRole("note")).not.toBeInTheDocument()
    // Teclado: a barra é um controle deslizante; cada seta anda 5 min e o tooltip diz o momento e quanto falta.
    const slider = screen.getByRole("slider", { name: "Linha do tempo da jornada" })
    slider.focus()
    fireEvent.keyDown(slider, { key: "ArrowRight" })
    expect(screen.getByTestId("journey-scrub-tooltip")).toHaveTextContent("10h05Logado para atendimento · até 10h20Próxima pausa: Pausa NR17 às 10h20 · em 15 min")
    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true })
    expect(screen.getByTestId("journey-scrub-tooltip")).toHaveTextContent("10h35Logado para atendimento · até 14h20Sem mais pausas no dia")
    fireEvent.keyDown(slider, { key: "ArrowLeft" })
    fireEvent.keyDown(slider, { key: "ArrowLeft" })
    expect(slider).toHaveAttribute("aria-valuetext", "10h25: Pausa NR17 · até 10h30. Retorno em 5 min (10h30)")
    fireEvent.keyDown(slider, { key: "Escape" })
    expect(screen.queryByTestId("journey-scrub-tooltip")).not.toBeInTheDocument()

    // Mouse: a linha e o tooltip seguem o ponteiro (janela 7h–15h numa barra de 1000 px → x = 500 é 11h00).
    slider.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 40, right: 1000, bottom: 40, x: 0, y: 0, toJSON: () => ({}) })
    // jsdom não tem PointerEvent: o evento genérico recebe clientX/pointerType à mão.
    const move = createEvent.pointerMove(slider)
    Object.defineProperties(move, { clientX: { value: 500 }, pointerType: { value: "mouse" } })
    fireEvent(slider, move)
    expect(screen.getByTestId("journey-scrub-tooltip")).toHaveTextContent("11h00Logado para atendimento · até 14h20")
    fireEvent.pointerLeave(slider, { pointerType: "mouse" })
    expect(screen.queryByTestId("journey-scrub-tooltip")).not.toBeInTheDocument()
  })

  it("falha ao carregar ≠ sem escala: erro com 'Tentar novamente'", async () => {
    service.fetchMyJourney.mockRejectedValue(new Error("Falha de rede"))
    renderWithQuery(<MyJourneyView />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha de rede")
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument()
  })

  it("folga hoje: aviso de folga, sem horário", async () => {
    service.fetchMyJourney.mockResolvedValue({ ...WEEK, days: WEEK.days.map((item) => (item.date === "2026-11-17" ? { ...item, kind: "DAY_OFF" as const, label: "Folga", shift: null, blocks: nonWorking("Folga") } : item)) })
    renderWithQuery(<MyJourneyView />)
    expect(await screen.findByText("Hoje é sua folga. Bom descanso!")).toBeInTheDocument()
    expect(screen.queryByText("Entrada prevista")).not.toBeInTheDocument()
    expect(screen.queryByRole("slider")).not.toBeInTheDocument()
  })
})

describe("Minha jornada — Semana", () => {
  it("sete dias com hoje destacado, lançamentos e estados diferentes; escolher um dia abre o detalhe", async () => {
    service.fetchMyJourney.mockResolvedValue(WEEK)
    renderWithQuery(<MyJourneyView />)
    fireEvent.mouseDown(await screen.findByRole("radio", { name: "Semana" }))
    fireEvent.click(screen.getByRole("radio", { name: "Semana" }))
    const list = await screen.findByRole("list", { name: "Dias da semana" })
    const cards = within(list).getAllByRole("button")
    expect(cards).toHaveLength(7)
    expect(cards[1]).toHaveAccessibleName("terça-feira, 17/11 (hoje): 8h00 – 14h20")
    expect(cards[1]).toHaveAttribute("aria-pressed", "true")
    expect(cards[2]).toHaveAccessibleName(/Banco de horas/)
    expect(cards[3]).toHaveAccessibleName(/Sem escala publicada/)
    expect(cards[4]).toHaveAccessibleName(/22h00 – 4h20 \(\+1\)/)
    expect(cards[5]).toHaveAccessibleName(/Férias/)
    expect(cards[6]).toHaveAccessibleName(/Horário não informado/)

    fireEvent.click(cards[2]!)
    expect(cards[2]).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("Banco de horas · vigente · Central de Dados")).toBeInTheDocument()

    fireEvent.click(cards[3]!)
    expect(screen.getByText(/A escala deste dia ainda não foi publicada/)).toBeInTheDocument()
  })

  it("navega para a próxima semana pedindo a data da semana", async () => {
    service.fetchMyJourney.mockResolvedValue(WEEK)
    renderWithQuery(<MyJourneyView />)
    fireEvent.mouseDown(await screen.findByRole("radio", { name: "Semana" }))
    fireEvent.click(screen.getByRole("radio", { name: "Semana" }))
    fireEvent.click(await screen.findByRole("button", { name: "Próxima semana" }))
    await waitFor(() => expect(service.fetchMyJourney).toHaveBeenCalledWith("2026-11-23"))
  })
})

describe("Minha jornada — formatação", () => {
  it("frases dos blocos, faixa da semana e relógio no fuso da escala", () => {
    // Turno da noite: entrada às 22h e a jornada segue depois da meia-noite; no dia seguinte, a parte da madrugada abre o dia.
    const night = [{ kind: "LOGGED_IN" as const, label: "Logado para atendimento", startMinute: 1320, endMinute: 1440, continuesFromPreviousDay: false, continuesNextDay: true }]
    expect(journeyMilestones(night).map((item) => [item.minute, item.title])).toEqual([[1320, "Login"], [1440, "Segue depois da meia-noite"]])
    const dawn = [
      { kind: "LOGGED_IN" as const, label: "Logado para atendimento", startMinute: 0, endMinute: 200, continuesFromPreviousDay: true, continuesNextDay: false },
      { kind: "BREAK" as const, label: "Pausa NR17", startMinute: 200, endMinute: 210, continuesFromPreviousDay: false, continuesNextDay: false },
      { kind: "LOGGED_IN" as const, label: "Logado para atendimento", startMinute: 210, endMinute: 260, continuesFromPreviousDay: false, continuesNextDay: false },
    ]
    expect(journeyMilestones(dawn).map((item) => [item.minute, item.title])).toEqual([[0, "Jornada que começou ontem"], [200, "Pausa NR17"], [210, "Retorno"], [260, "Logout"]])
    expect(timelineWindow(dawn)).toEqual({ start: 0, end: 300 })
    expect(momentAt(dawn, 205)).toMatchObject({ clock: "3h25", now: "Pausa NR17 · até 3h30", next: "Retorno em 5 min (3h30)" })
    expect(momentAt(dawn, 280)).toMatchObject({ block: null, now: "Sem atividade prevista", next: "Sem mais pausas no dia" })
    expect(weekRangeLabel("2026-12-28", "2027-01-03")).toBe("28 de dez a 3 de jan")
    expect(nowInTimeZone(new Date("2026-11-17T02:30:00Z"), "America/Sao_Paulo")).toEqual({ date: "2026-11-16", minute: 23 * 60 + 30 })
  })
})
