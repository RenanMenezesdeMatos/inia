/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"

import { OperationalCalendarPage } from "./operational-calendar-page"

const service = vi.hoisted(() => ({
  fetchHolidays: vi.fn(),
  createHoliday: vi.fn(),
  updateHoliday: vi.fn(),
  deleteHoliday: vi.fn(),
  fetchCapitals: vi.fn(),
  fetchCalendarSettings: vi.fn(),
  updateCalendarSettings: vi.fn(),
  fetchHolidayCatalog: vi.fn(),
  fetchHolidayCatalogCoverage: vi.fn(),
}))
vi.mock("@/services/admin/operational-calendar-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const CAPITALS = { capitals: [{ code: "FORTALEZA", name: "Fortaleza", stateCode: "CE", ibgeCode: "2304400" }, { code: "RECIFE", name: "Recife", stateCode: "PE", ibgeCode: "2611606" }], states: ["CE", "PE"] }
const SETTINGS = { holidayFallbackPolicy: "IGNORE" as const, scheduleHorizonWarningDays: 7, horizon: { configured: true, coverageFrom: "2026-09-01", coverageUntil: "2026-09-18", daysRemaining: 3, warningDays: 7, endingSoon: true, peopleWithCalendarAhead: 6 } }
const COVERAGE = {
  years: [
    { year: 2026, national: 10, capitalsWithStateHoliday: 24, capitalsWithMunicipalHoliday: 24, rows: 105, byVerification: { OFFICIAL: 60, LEGAL_DATABASE: 30, SECONDARY: 15 }, unverifiedRows: 0 },
    { year: 2027, national: 9, capitalsWithStateHoliday: 24, capitalsWithMunicipalHoliday: 24, rows: 104, byVerification: { OFFICIAL: 60, LEGAL_DATABASE: 30, SECONDARY: 14 }, unverifiedRows: 0 },
    { year: 2028, national: 9, capitalsWithStateHoliday: 24, capitalsWithMunicipalHoliday: 24, rows: 104, byVerification: { OFFICIAL: 60, LEGAL_DATABASE: 30, SECONDARY: 14 }, unverifiedRows: 0 },
  ],
  totalRows: 313,
  gaps: [{ scope: "MUNICIPAL_CAPITAL" as const, capitalCode: "BELEM", years: [2026, 2027, 2028], reason: "Lei municipal não acessível — nada seedado.", label: "Municipal · Belém / PA" }],
  pendingVerifications: 2,
  capitalsWithoutMunicipalHoliday: ["BELEM", "CAMPO_GRANDE", "BRASILIA"],
  complete: false as const,
}
const CATALOG = [
  { id: "h1", date: "2027-01-01", name: "Confraternização Universal", scope: "NATIONAL" as const, countryCode: "BR", stateCode: null, capitalCode: null, sourceName: "Portaria MGI nº 11.460/2025", sourceReference: "https://www.legisweb.com.br/legislacao/?id=488776", legalReference: "Lei federal nº 662/1949", active: true },
  { id: "h2", date: "2027-03-25", name: "Data Magna do Ceará", scope: "STATE" as const, countryCode: "BR", stateCode: "CE", capitalCode: null, sourceName: "Portaria TJCE nº 24/2025", sourceReference: "https://portal.tjce.jus.br/x.pdf", legalReference: "Emenda à Constituição do Estado do Ceará nº 73/2011", active: true },
  { id: "h3", date: "2027-08-15", name: "Nossa Senhora da Assunção (padroeira)", scope: "MUNICIPAL_CAPITAL" as const, countryCode: "BR", stateCode: null, capitalCode: "FORTALEZA", sourceName: "Portaria TJCE nº 24/2025", sourceReference: "https://portal.tjce.jus.br/x.pdf", legalReference: "Lei municipal nº 8.796/2003", active: true },
]

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Administração › Calendário operacional", () => {
  it("política, horizonte com aviso, calendário-base com fonte/base legal e aba de datas da organização", async () => {
    service.fetchCapitals.mockResolvedValue(CAPITALS)
    service.fetchCalendarSettings.mockResolvedValue(SETTINGS)
    service.fetchHolidayCatalog.mockResolvedValue(CATALOG)
    service.fetchHolidayCatalogCoverage.mockResolvedValue(COVERAGE)
    service.fetchHolidays.mockResolvedValue([{ id: "o1", date: "2026-12-24", name: "Recesso da operação", scope: "ORGANIZATION", active: true, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }])
    renderWithQuery(<OperationalCalendarPage />)
    const settings = await screen.findByTestId("calendar-settings")
    expect(within(settings).getByTestId("calendar-horizon")).toHaveTextContent("Calendário disponível: 01/09/2026 → 18/09/2026")
    expect(within(settings).getByTestId("calendar-horizon-warning")).toHaveTextContent("O calendário termina em 3 dias")
    expect(within(settings).getByText("Ignorar feriados (dia útil continua programado)")).toBeInTheDocument()

    // Cobertura verificada + lacunas explícitas: o catálogo nunca é apresentado como completo.
    const coverage = await screen.findByTestId("holiday-catalog-coverage")
    expect(coverage.textContent).toContain("2 pendência(s) de verificação")
    expect(coverage.textContent).toContain("municipal em 24/27")
    expect(coverage.textContent).toContain("Belém")
    expect(screen.getByTestId("catalog-gaps").textContent).toContain("Lei municipal não acessível")
    const rows = await screen.findAllByTestId("catalog-row")
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent("Feriado nacional")
    expect(rows[0]).toHaveTextContent("Brasil")
    expect(rows[1]).toHaveTextContent("Feriado estadual")
    expect(rows[1]).toHaveTextContent("UF CE")
    expect(rows[2]).toHaveTextContent("Feriado municipal")
    expect(rows[2]).toHaveTextContent("Fortaleza")
    expect(rows[2]).toHaveTextContent("Lei municipal nº 8.796/2003")
    expect(within(rows[0]!).getByRole("link", { name: /Portaria MGI/ })).toHaveAttribute("href", "https://www.legisweb.com.br/legislacao/?id=488776")
    expect(service.fetchHolidayCatalog).toHaveBeenCalledWith(expect.objectContaining({ year: new Date().getFullYear() }))

    // Radix Tabs ativa no mousedown (não no click).
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Datas da organização" }))
    const orgRow = await screen.findByTestId("holiday-row")
    expect(orgRow).toHaveTextContent("Recesso da operação")
    expect(orgRow).toHaveTextContent("Data da organização")
  })

  it("salvar o limite de aviso chama a API com o novo valor", async () => {
    service.fetchCapitals.mockResolvedValue(CAPITALS)
    service.fetchCalendarSettings.mockResolvedValue(SETTINGS)
    service.fetchHolidayCatalog.mockResolvedValue([])
    service.fetchHolidayCatalogCoverage.mockResolvedValue(COVERAGE)
    service.fetchHolidays.mockResolvedValue([])
    service.updateCalendarSettings.mockResolvedValue({ ...SETTINGS, scheduleHorizonWarningDays: 3, horizon: { ...SETTINGS.horizon, warningDays: 3, endingSoon: false } })
    renderWithQuery(<OperationalCalendarPage />)
    await screen.findByTestId("calendar-settings")
    fireEvent.change(screen.getByLabelText("Avisar quando restarem ≤ dias"), { target: { value: "3" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(service.updateCalendarSettings).toHaveBeenCalledWith({ scheduleHorizonWarningDays: 3 }))
  })
})
