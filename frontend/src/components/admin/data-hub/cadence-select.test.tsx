/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { Cadence } from "@/schemas/admin/data-hub.schema"

const service = vi.hoisted(() => ({ fetchCadencePreview: vi.fn() }))
vi.mock("@/services/admin/data-hub-service", async (importOriginal) => ({ ...(await importOriginal<object>()), ...service }))

import { CadenceSelect } from "./cadence-select"

afterEach(cleanup)
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.scrollIntoView = () => {}
})
beforeEach(() => {
  service.fetchCadencePreview.mockReset()
  service.fetchCadencePreview.mockResolvedValue({ label: "", timeZone: "America/Fortaleza", nextRuns: ["2026-11-06T21:00:00.000Z", "2026-11-09T09:00:00.000Z", "2026-11-09T21:00:00.000Z"] })
})

let current: Cadence
function Harness({ initial, saved }: { initial: Cadence; saved?: Cadence }) {
  const [value, setValue] = useState<Cadence>(initial)
  function change(next: Cadence) {
    current = next
    setValue(next)
  }
  return <CadenceSelect value={value} onChange={change} {...(saved ? { savedValue: saved } : {})} />
}

function renderSelect(initial: Cadence, saved?: Cadence) {
  current = initial
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} {...(saved ? { saved } : {})} />
    </QueryClientProvider>,
  )
}

function pick(option: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Frequência" }))
  fireEvent.click(screen.getByRole("option", { name: option }))
}

const summary = () => screen.getByTestId("cadence-summary")

describe("opções prontas continuam disponíveis", () => {
  it("lista as opções de sempre e as personalizadas, sem nada de cron", () => {
    renderSelect({ kind: "MANUAL" })
    fireEvent.click(screen.getByRole("combobox", { name: "Frequência" }))
    const options = screen.getAllByRole("option").map((option) => option.textContent)
    expect(options).toEqual(["Manual (só quando eu pedir)", "A cada 15 min", "A cada 1 h", "A cada 6 h", "Diário, em um ou mais horários", "A cada N minutos ou horas", "A cada N dias", "Em dias da semana", "Em um dia do mês"])
    expect(document.body.textContent).not.toMatch(/cron/i)
  })

  it.each([
    [/A cada 15 min/, { kind: "INTERVAL", minutes: 15 }],
    [/A cada 1 h/, { kind: "INTERVAL", minutes: 60 }],
    [/A cada 6 h/, { kind: "INTERVAL", minutes: 360 }],
  ])("%s grava a forma de sempre", (option, expected) => {
    renderSelect({ kind: "MANUAL" })
    pick(option)
    expect(current).toEqual(expected)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("diário com um horário grava a forma de sempre; com dois vira agenda; voltar a um volta à forma de sempre", async () => {
    renderSelect({ kind: "MANUAL" })
    pick(/Diário/)
    expect(current).toEqual({ kind: "DAILY", time: "06:00" })
    fireEvent.change(screen.getByLabelText("Horário 1"), { target: { value: "07:30" } })
    expect(current).toEqual({ kind: "DAILY", time: "07:30" })
    fireEvent.click(screen.getByRole("button", { name: /Adicionar horário/ }))
    expect(current).toEqual({ kind: "CALENDAR", times: ["07:30", "08:30"], frequency: { type: "DAILY" } })
    fireEvent.click(screen.getByRole("button", { name: "Remover horário 2" }))
    expect(current).toEqual({ kind: "DAILY", time: "07:30" })
    expect(summary()).toHaveTextContent("Diário às 07:30")
  })

  it("feed gravado com diário abre no modo diário, com o horário dele", () => {
    renderSelect({ kind: "DAILY", time: "05:45" })
    expect(screen.getByRole("combobox", { name: "Frequência" })).toHaveTextContent("Diário")
    expect(screen.getByLabelText("Horário 1")).toHaveValue("05:45")
  })
})

describe("a cada N minutos ou horas", () => {
  it("minutos e horas viram minutos; abaixo de 15 mostra o limite", () => {
    renderSelect({ kind: "MANUAL" })
    pick(/A cada N minutos ou horas/)
    expect(current).toEqual({ kind: "INTERVAL", minutes: 30 })
    fireEvent.change(screen.getByLabelText("A cada"), { target: { value: "45" } })
    expect(current).toEqual({ kind: "INTERVAL", minutes: 45 })
    expect(summary()).toHaveTextContent("A cada 45 min")

    fireEvent.change(screen.getByLabelText("A cada"), { target: { value: "10" } })
    expect(screen.getByRole("alert")).toHaveTextContent("O intervalo mínimo entre cargas é de 15 minutos.")

    fireEvent.click(screen.getByRole("combobox", { name: "Unidade do intervalo" }))
    fireEvent.click(screen.getByRole("option", { name: "horas" }))
    fireEvent.change(screen.getByLabelText("A cada"), { target: { value: "2" } })
    expect(current).toEqual({ kind: "INTERVAL", minutes: 120 })
    expect(summary()).toHaveTextContent("A cada 2h")
    expect(screen.getByRole("combobox", { name: "Frequência" })).toHaveTextContent("A cada N minutos ou horas")
  })

  it("escolher um valor igual ao de uma opção pronta não pula o campo de baixo", () => {
    renderSelect({ kind: "MANUAL" })
    pick(/A cada N minutos ou horas/)
    fireEvent.change(screen.getByLabelText("A cada"), { target: { value: "60" } })
    expect(current).toEqual({ kind: "INTERVAL", minutes: 60 })
    expect(screen.getByLabelText("A cada")).toHaveValue(60)
  })

  it("feed antigo com intervalo abaixo do mínimo abre sem erro enquanto não mudar", () => {
    renderSelect({ kind: "INTERVAL", minutes: 5 }, { kind: "INTERVAL", minutes: 5 })
    expect(screen.getByLabelText("A cada")).toHaveValue(5)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("A cada"), { target: { value: "10" } })
    expect(screen.getByRole("alert")).toHaveTextContent("mínimo")
  })
})

describe("a cada N dias", () => {
  it("escolhe dias, data de início e horário", async () => {
    renderSelect({ kind: "MANUAL" })
    pick(/A cada N dias/)
    fireEvent.change(screen.getByLabelText("A cada quantos dias"), { target: { value: "3" } })
    fireEvent.change(screen.getByLabelText("A partir de"), { target: { value: "2026-11-10" } })
    fireEvent.change(screen.getByLabelText("Horário 1"), { target: { value: "22:00" } })
    expect(current).toEqual({ kind: "CALENDAR", times: ["22:00"], frequency: { type: "EVERY_N_DAYS", days: 3, startDate: "2026-11-10" } })
    expect(summary()).toHaveTextContent("A cada 3 dias às 22:00")
    fireEvent.change(screen.getByLabelText("A cada quantos dias"), { target: { value: "" } })
    expect(screen.getByRole("alert")).toHaveTextContent("Informe de 1 a 90 dias.")
  })
})

describe("em dias da semana", () => {
  it("seg a sex às 06:00 e 18:00: frase legível e próximas execuções no fuso da operação", async () => {
    renderSelect({ kind: "MANUAL" })
    pick(/Em dias da semana/)
    expect(current).toEqual({ kind: "CALENDAR", times: ["06:00"], frequency: { type: "WEEKLY", weekdays: ["MON", "TUE", "WED", "THU", "FRI"] } })
    fireEvent.click(screen.getByRole("button", { name: /Adicionar horário/ }))
    fireEvent.change(screen.getByLabelText("Horário 2"), { target: { value: "18:00" } })
    expect(summary()).toHaveTextContent("Seg a sex às 06:00 e 18:00")

    const expected: Cadence = { kind: "CALENDAR", times: ["06:00", "18:00"], frequency: { type: "WEEKLY", weekdays: ["MON", "TUE", "WED", "THU", "FRI"] } }
    await waitFor(() => expect(service.fetchCadencePreview).toHaveBeenCalledWith(expected))
    const next = await screen.findByTestId("cadence-next-runs")
    expect(next).toHaveTextContent("sex 06/11 às 18:00")
    expect(next).toHaveTextContent("seg 09/11 às 06:00")
    expect(next).toHaveTextContent("America/Fortaleza")
  })

  it("marca e desmarca dias; nenhum dia marcado bloqueia, sem consultar a prévia", async () => {
    renderSelect({ kind: "CALENDAR", times: ["06:00"], frequency: { type: "WEEKLY", weekdays: ["MON"] } })
    fireEvent.click(screen.getByRole("button", { name: "Sábado" }))
    expect(current).toMatchObject({ frequency: { weekdays: ["MON", "SAT"] } })
    expect(summary()).toHaveTextContent("Seg e sáb às 06:00")
    await waitFor(() => expect(service.fetchCadencePreview).toHaveBeenCalled())
    service.fetchCadencePreview.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Sábado" }))
    fireEvent.click(screen.getByRole("button", { name: "Segunda" }))
    expect(screen.getByRole("alert")).toHaveTextContent("Escolha ao menos um dia da semana.")
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(service.fetchCadencePreview).not.toHaveBeenCalled()
  })

  it("horário repetido ou colado demais é apontado", () => {
    renderSelect({ kind: "CALENDAR", times: ["06:00", "18:00"], frequency: { type: "WEEKLY", weekdays: ["MON"] } })
    fireEvent.change(screen.getByLabelText("Horário 2"), { target: { value: "06:00" } })
    expect(screen.getByRole("alert")).toHaveTextContent("Há horários repetidos.")
    fireEvent.change(screen.getByLabelText("Horário 2"), { target: { value: "06:10" } })
    expect(screen.getByRole("alert")).toHaveTextContent("Deixe ao menos 15 minutos entre os horários.")
    fireEvent.change(screen.getByLabelText("Horário 2"), { target: { value: "" } })
    expect(screen.getByRole("alert")).toHaveTextContent("Use o horário no formato HH:mm.")
  })

  it("um novo horário nasce longe dos outros, mesmo no fim do dia", () => {
    renderSelect({ kind: "CALENDAR", times: ["23:30"], frequency: { type: "WEEKLY", weekdays: ["MON"] } })
    fireEvent.click(screen.getByRole("button", { name: /Adicionar horário/ }))
    expect(current).toMatchObject({ times: ["23:30", "00:30"] })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})

describe("em um dia do mês", () => {
  it("dia do mês, aviso nos meses sem o dia e último dia", () => {
    renderSelect({ kind: "MANUAL" })
    pick(/Em um dia do mês/)
    expect(current).toEqual({ kind: "CALENDAR", times: ["06:00"], frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 1 } })
    fireEvent.change(screen.getByLabelText("Dia"), { target: { value: "31" } })
    expect(summary()).toHaveTextContent("Todo dia 31 às 06:00")
    expect(screen.getByText(/Nos meses sem o dia 31 não há carga/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Dia"), { target: { value: "" } })
    expect(screen.getByRole("alert")).toHaveTextContent("Informe um dia de 1 a 31.")
    fireEvent.click(screen.getByRole("combobox", { name: "Quando" }))
    fireEvent.click(screen.getByRole("option", { name: "Último dia do mês" }))
    expect(current).toEqual({ kind: "CALENDAR", times: ["06:00"], frequency: { type: "MONTHLY", mode: "LAST_DAY" } })
    expect(summary()).toHaveTextContent("Último dia do mês às 06:00")
  })
})

describe("trocar de forma mantém os horários já escolhidos", () => {
  it("de dias da semana para a cada N dias e diário", () => {
    renderSelect({ kind: "CALENDAR", times: ["06:00", "18:00"], frequency: { type: "WEEKLY", weekdays: ["MON"] } })
    pick(/A cada N dias/)
    expect(current).toMatchObject({ times: ["06:00", "18:00"], frequency: { type: "EVERY_N_DAYS", days: 2 } })
    pick(/Diário/)
    expect(current).toEqual({ kind: "CALENDAR", times: ["06:00", "18:00"], frequency: { type: "DAILY" } })
    expect(screen.getByRole("combobox", { name: "Frequência" })).toHaveTextContent("Diário")
    pick(/Manual/)
    expect(current).toEqual({ kind: "MANUAL" })
    expect(screen.queryByLabelText("Horário 1")).not.toBeInTheDocument()
  })
})
