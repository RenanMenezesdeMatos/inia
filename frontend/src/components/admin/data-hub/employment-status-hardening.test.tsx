/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { evidenceLines } from "@/components/admin/qa-lab/run-result"
import type { EmploymentStatusFreshness, Overview, SourceDetail } from "@/schemas/admin/data-hub.schema"

import { OverviewTab } from "./overview-tab"
import { SourceWizard } from "./source-wizard"

const service = vi.hoisted(() => ({
  fetchOverview: vi.fn(),
  fetchSource: vi.fn(),
  fetchContracts: vi.fn(),
  fetchSourceSample: vi.fn(),
  previewSourceMapping: vi.fn(),
  uploadFile: vi.fn(),
}))
vi.mock("@/services/admin/data-hub-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const navigation = vi.hoisted(() => ({ searchParams: new URLSearchParams() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/data-hub",
  useSearchParams: () => navigation.searchParams,
}))

const NOW = "2026-09-16T12:00:00.000Z"

function freshness(state: EmploymentStatusFreshness["state"], overrides: Partial<EmploymentStatusFreshness["feeds"][number]> = {}): EmploymentStatusFreshness {
  const feed = {
    feedId: "feed-emp",
    feedName: "Colaboradores",
    sourceId: "src-rh",
    sourceName: "API RH",
    sourceKind: "API_PULL",
    contractKey: "EMPLOYEES" as const,
    sourceNamespace: "rh",
    authoritative: true,
    status: "ACTIVE",
    cadenceLabel: "A cada 1h",
    expectedIntervalMinutes: 60,
    lastSuccessAt: state === "STALE" ? "2026-09-14T09:00:00.000Z" : NOW,
    lastDataAt: NOW,
    freshness: state === "STALE" ? ("STALE" as const) : ("FRESH" as const),
    ...overrides,
  }
  return { state, configured: true, feeds: [feed], consideredFeedIds: [feed.feedId], lastSuccessAt: feed.lastSuccessAt, lastDataAt: feed.lastDataAt, lastSuccessLocalDate: "2026-09-14" }
}

const SOURCE: SourceDetail = {
  id: "src-rh",
  publicId: "api-rh",
  name: "API RH",
  description: null,
  kind: "API_PULL",
  status: "ACTIVE",
  config: { kind: "API_PULL", api: { baseUrl: "https://rh.cliente.com.br", auth: { kind: "BEARER" }, headers: {}, timeoutMs: 30000 } },
  connectionHealth: "HEALTHY",
  connectionCheckedAt: NOW,
  connectionError: null,
  createdAt: NOW,
  updatedAt: NOW,
  feedCount: 1,
  activeFeedCount: 1,
  freshness: "FRESH",
  lastRunAt: NOW,
  lastSuccessAt: NOW,
  lastDataAt: NOW,
  nextSyncAt: null,
  lastRecordsReceived: 10,
  lastRecordsRejected: 0,
  feeds: [],
  secrets: [{ purpose: "token", createdAt: NOW, rotatedAt: null }],
  tokens: [],
  transportWarning: null,
}

function overview(employmentStatus: EmploymentStatusFreshness): Overview {
  const feedRef = { feedId: "feed-emp", feedName: "Colaboradores", sourceId: "src-rh", sourceName: "API RH", sourceKind: "API_PULL" as const, status: "ACTIVE" as const, authoritative: true, freshness: "FRESH" as const, lastSuccessAt: NOW, lastDataAt: NOW }
  return {
    generatedAt: NOW,
    cards: { activeSources: 1, sourcesWithError: 0, receivedToday: 10, rejectedToday: 0, warningsToday: 0, staleFeeds: 0, runsToday: 1, queuedRuns: 0 },
    sources: [SOURCE],
    dataMap: [
      { contractKey: "EMPLOYEES", label: "Colaboradores", category: "MASTER", targetEntity: "people", relation: { kind: "COMPLEMENTED_BY", contractKey: "EMPLOYEE_ABSENCES", note: "Ausências complementam o cadastro: férias e afastamentos entram por Ausências de colaboradores." }, feeds: [feedRef], freshness: "FRESH", recordCount: 10 },
      { contractKey: "EMPLOYEE_ABSENCES", label: "Ausências de colaboradores", category: "MASTER", targetEntity: "employee_status_periods", relation: { kind: "COMPLEMENTS", contractKey: "EMPLOYEES", note: "Complementa Colaboradores: mesma camada canônica de situação funcional." }, feeds: [], freshness: "NEVER", recordCount: 0 },
    ],
    employmentStatus,
    recentRuns: [],
  }
}

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  navigation.searchParams = new URLSearchParams()
})

describe("Central de Dados — situação funcional na visão geral", () => {
  it("fonte atrasada: card em alerta com o feed fora da cadência, sem confundir com saúde da conexão", async () => {
    service.fetchOverview.mockResolvedValue(overview(freshness("STALE")))
    renderWithQuery(<OverviewTab onOpenTab={() => undefined} />)
    const card = await screen.findByTestId("employment-status-card")
    expect(card).toHaveAttribute("data-state", "STALE")
    expect(within(card).getByText("Fonte atrasada")).toBeInTheDocument()
    expect(within(card).getByText(/API RH › Colaboradores fora da cadência/)).toBeInTheDocument()
    expect(within(card).getByText(/a conexão pode estar saudável e ainda assim a situação estar atrasada/)).toBeInTheDocument()
    // O banner geral continua verde: nenhum feed "atrasado" no KPI e nenhuma conexão com erro.
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Tudo funcionando")
  })

  it("fonte atualizada: card verde; mapa explica que Ausências complementam Colaboradores", async () => {
    service.fetchOverview.mockResolvedValue(overview(freshness("FRESH")))
    renderWithQuery(<OverviewTab onOpenTab={() => undefined} />)
    const card = await screen.findByTestId("employment-status-card")
    expect(card).toHaveAttribute("data-state", "FRESH")
    expect(within(card).getByText("Atualizada")).toBeInTheDocument()
    expect(within(card).getByText(/cadência A cada 1h/)).toBeInTheDocument()
    expect(screen.getByTestId("data-map-relation-EMPLOYEES")).toHaveTextContent("Ausências complementam o cadastro")
    expect(screen.getByTestId("data-map-relation-EMPLOYEE_ABSENCES")).toHaveTextContent("Complementa Colaboradores")
  })

  it("sem feed de situação configurado (legado/manual) o card não aparece — nada é degradado", async () => {
    service.fetchOverview.mockResolvedValue(overview({ state: "UNKNOWN", configured: false, feeds: [], consideredFeedIds: [], lastSuccessAt: null, lastDataAt: null, lastSuccessLocalDate: null }))
    renderWithQuery(<OverviewTab onOpenTab={() => undefined} />)
    await screen.findByText("Dados da INIA")
    expect(screen.queryByTestId("employment-status-card")).not.toBeInTheDocument()
  })
})

describe("Wizard — adicionar feed a uma fonte existente", () => {
  it("com ?sourceId= começa em Adicionar feed, reutiliza a conexão e não pede credenciais", async () => {
    navigation.searchParams = new URLSearchParams("sourceId=src-rh&contractKey=EMPLOYEE_ABSENCES")
    service.fetchSource.mockResolvedValue(SOURCE)
    service.fetchContracts.mockResolvedValue({ contracts: [], categories: [] })
    renderWithQuery(<SourceWizard />)
    expect(await screen.findByText("Adicionar feed em API RH")).toBeInTheDocument()
    const steps = screen.getByRole("list", { name: "Etapas" })
    expect(within(steps).queryByText("Tipo da conexão")).not.toBeInTheDocument()
    expect(within(steps).queryByText("Configurar conexão")).not.toBeInTheDocument()
    expect(within(steps).queryByText("Testar conexão")).not.toBeInTheDocument()
    expect(within(steps).getByText("Adicionar feed").closest("li")).toHaveAttribute("aria-current", "step")
    expect(within(steps).getAllByRole("listitem")).toHaveLength(7)
    const note = screen.getByTestId("add-feed-reuse-note")
    expect(note).toHaveTextContent("Conexão reutilizada: API Pull")
    expect(note).toHaveTextContent("Conexão OK")
    expect(screen.queryByLabelText(/Token/)).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Voltar à fonte/ })).toHaveAttribute("href", "/admin/data-hub/sources/src-rh")
    await waitFor(() => expect(service.fetchSource).toHaveBeenCalledWith("src-rh"))
  })

  it("sem ?sourceId= continua sendo Nova fonte a partir do tipo da conexão", async () => {
    service.fetchContracts.mockResolvedValue({ contracts: [], categories: [] })
    renderWithQuery(<SourceWizard />)
    expect(await screen.findByText("Nova fonte")).toBeInTheDocument()
    expect(within(screen.getByRole("list", { name: "Etapas" })).getAllByRole("listitem")).toHaveLength(10)
    expect(screen.queryByTestId("add-feed-reuse-note")).not.toBeInTheDocument()
  })
})

describe("Central — card de Escalas de trabalho", () => {
  it("feed de escalas atrasado: card 'Escalas de trabalho — Fonte atrasada' separado do card de situação funcional", async () => {
    const data = overview(freshness("FRESH"))
    const scheduleFeed = { ...freshness("STALE").feeds[0]!, feedId: "feed-ws", feedName: "Work Schedules", contractKey: "WORK_SCHEDULE_DAYS", sourceNamespace: "wfm" }
    service.fetchOverview.mockResolvedValue({ ...data, workSchedule: { state: "STALE", configured: true, feeds: [scheduleFeed], consideredFeedIds: ["feed-ws"], lastSuccessAt: scheduleFeed.lastSuccessAt, lastDataAt: NOW, lastSuccessLocalDate: "2026-09-14" } })
    renderWithQuery(<OverviewTab onOpenTab={() => undefined} />)
    const card = await screen.findByTestId("work-schedule-card")
    expect(card).toHaveAttribute("data-state", "STALE")
    expect(within(card).getByText("Escalas de trabalho")).toBeInTheDocument()
    expect(within(card).getByText(/API RH › Work Schedules fora da cadência/)).toBeInTheDocument()
    expect(within(card).getByText(/ausência de produção nesses dias não vira feedback negativo/)).toBeInTheDocument()
    expect(screen.getByTestId("employment-status-card")).toHaveAttribute("data-state", "FRESH")
  })
})

describe("QA Lab — situação funcional no trace só quando é relevante", () => {
  const base = { windowLabel: "09/09/2026 → 15/09/2026", aggregation: "WEIGHTED_AVERAGE", aggregationKind: "WEIGHTED_AVERAGE", method: "média ponderada", sampleCount: 3, daysWithData: 3, expectedDays: 5, coverage: 0.6, numerator: null, denominator: null, sampleTotal: null }

  it("fonte atrasada com dias presumidos: linha de alerta com última carga e quantidade", () => {
    const lines = evidenceLines({ ...base, eligibility: { businessDays: 5, eligibleDays: 5, excludedBeforeHire: 0, excludedByStatus: {}, statusConfidence: { freshness: "STALE", unconfirmedDays: 2, lastSuccessLocalDate: "2026-09-12" } } })
    expect(lines).toContain("⚠ Fonte de situação funcional atrasada (última carga 12/09/2026) · 2 dia(s) elegível(is) presumido(s), não confirmado(s)")
  })

  it("fonte atualizada e nenhum dia excluído: nenhuma linha sobre situação funcional", () => {
    const lines = evidenceLines({ ...base, eligibility: { businessDays: 5, eligibleDays: 5, excludedBeforeHire: 0, excludedByStatus: {}, statusConfidence: { freshness: "FRESH", unconfirmedDays: 0, lastSuccessLocalDate: "2026-09-16" } } })
    expect(lines.some((line) => line.includes("Situação funcional"))).toBe(false)
  })

  it("dias excluídos por férias com fonte atualizada: informa a fonte, sem alerta", () => {
    const lines = evidenceLines({ ...base, eligibility: { businessDays: 5, eligibleDays: 3, excludedBeforeHire: 0, excludedByStatus: { FERIAS: 2 }, statusConfidence: { freshness: "FRESH", unconfirmedDays: 0, lastSuccessLocalDate: "2026-09-16" } } })
    expect(lines).toContain("Dias úteis: 5 · excluídos: 2 por FÉRIAS")
    expect(lines).toContain("Situação funcional: fonte atualizada (última carga 16/09/2026)")
    expect(lines.some((line) => line.startsWith("⚠"))).toBe(false)
  })
})

describe("QA Lab — calendário real no trace", () => {
  const base = { windowLabel: "07/09/2026 → 13/09/2026", aggregation: "WEIGHTED_AVERAGE", aggregationKind: "WEIGHTED_AVERAGE", method: "média ponderada", sampleCount: 4, daysWithData: 4, expectedDays: 4, coverage: 1, numerator: null, denominator: null, sampleTotal: null }

  it("7 dias no calendário · 6 programados (1 folga) · 2 em INSS · 4 elegíveis · 4 com dado · 100%", () => {
    const lines = evidenceLines({ ...base, eligibility: { businessDays: 6, calendarDays: 7, scheduledWorkDays: 6, eligibleDays: 4, excludedBeforeHire: 0, excludedByStatus: { INSS: 2 }, excludedByScheduledDayOff: 1, excludedByHoliday: 0, excludedByUnknownSchedule: 0, statusConfidence: { freshness: "FRESH", unconfirmedDays: 0, lastSuccessLocalDate: "2026-09-13" }, scheduleConfidence: { freshness: "FRESH", basis: "EXPLICIT_SCHEDULE", scheduleType: "SIX_BY_ONE", unconfirmedScheduleDays: 0, unknownScheduleDays: 0, lastSuccessLocalDate: "2026-09-13" } } })
    expect(lines).toContain("Dias no calendário: 7 · programados para trabalho: 6 (1 por folga programada) · escala informada pela fonte · regime 6x1")
    expect(lines).toContain("Excluídos por situação: 2 por INSS")
    expect(lines).toContain("Dias elegíveis: 4 · dias com medição elegível: 4 · medições: 4")
    expect(lines).toContain("Cobertura: 100%")
  })

  it("fonte de escala atrasada: warning específico de escala", () => {
    const lines = evidenceLines({ ...base, eligibility: { businessDays: 5, calendarDays: 7, scheduledWorkDays: 5, eligibleDays: 5, excludedBeforeHire: 0, excludedByStatus: {}, excludedByScheduledDayOff: 2, excludedByHoliday: 0, excludedByUnknownSchedule: 0, statusConfidence: { freshness: "FRESH", unconfirmedDays: 0, lastSuccessLocalDate: "2026-09-13" }, scheduleConfidence: { freshness: "STALE", basis: "EXPLICIT_SCHEDULE", scheduleType: "FIVE_BY_TWO", unconfirmedScheduleDays: 3, unknownScheduleDays: 0, lastSuccessLocalDate: "2026-09-10" } } })
    expect(lines).toContain("⚠ Fonte de escala atrasada (última carga 10/09/2026) · 3 dia(s) com escala presumida — a folga pode ter mudado")
    expect(lines.some((line) => line.includes("situação funcional atrasada"))).toBe(false)
  })
})

describe("QA Lab — exceções, feriados por capital e medição ignorada no trace", () => {
  const base = { windowLabel: "07/09/2026 → 13/09/2026", aggregation: "WEIGHTED_AVERAGE", aggregationKind: "WEIGHTED_AVERAGE", method: "média ponderada", sampleCount: 4, daysWithData: 4, expectedDays: 4, coverage: 1, numerator: null, denominator: null, sampleTotal: null }

  it("7 no calendário · 6 programados · 1 folga · 1 Day off · 1 INSS · 4 elegíveis · 2 medições ignoradas · 100%", () => {
    const lines = evidenceLines({
      ...base,
      ignoredMeasurements: 2,
      eligibility: { businessDays: 6, calendarDays: 7, scheduledWorkDays: 6, eligibleDays: 4, excludedBeforeHire: 0, excludedByStatus: { INSS: 1 }, excludedByScheduleException: { DAY_OFF: 1 }, excludedByScheduledDayOff: 1, excludedByHoliday: 0, excludedByUnknownSchedule: 0, statusConfidence: { freshness: "FRESH", unconfirmedDays: 0, lastSuccessLocalDate: "2026-09-13" }, scheduleConfidence: { freshness: "FRESH", basis: "EXPLICIT_SCHEDULE", scheduleType: "SIX_BY_ONE", unconfirmedScheduleDays: 0, unknownScheduleDays: 0, lastSuccessLocalDate: "2026-09-13" }, holidayConfidence: { policy: "EXCLUDE_APPLICABLE_HOLIDAYS", operationalCapitalCode: "FORTALEZA", confidence: "CAPITAL_KNOWN", applicableHolidayDays: 1 } },
    })
    expect(lines).toContain("Dias no calendário: 7 · programados para trabalho: 6 (1 por folga programada) · escala informada pela fonte · regime 6x1")
    expect(lines).toContain("Exceções individuais: 1 Day off — a exceção vence a escala naquele dia")
    expect(lines).toContain("Excluídos por situação: 1 por INSS")
    expect(lines).toContain("Feriados: 1 aplicável(is) na janela · política excluir no fallback · capital operacional FORTALEZA")
    expect(lines).toContain("Dias elegíveis: 4 · dias com medição elegível: 4 · medições: 4")
    expect(lines).toContain("Medições ignoradas por inelegibilidade: 2 (preservadas no banco, fora do valor e da cobertura)")
    expect(lines).toContain("Cobertura: 100%")
  })

  it("sem capital operacional: o trace diz que só feriados nacionais são conhecidos; sem medição ignorada não há linha de ignoradas", () => {
    const lines = evidenceLines({ ...base, ignoredMeasurements: 0, eligibility: { businessDays: 5, calendarDays: 7, scheduledWorkDays: 5, eligibleDays: 5, excludedBeforeHire: 0, excludedByStatus: {}, excludedByScheduledDayOff: 2, excludedByHoliday: 0, excludedByUnknownSchedule: 0, holidayConfidence: { policy: "IGNORE", operationalCapitalCode: null, confidence: "CAPITAL_UNKNOWN", applicableHolidayDays: 1 } } })
    expect(lines).toContain("Feriados: 1 aplicável(is) na janela · política ignorar · sem capital operacional — só feriados nacionais e datas da organização são conhecidos")
    expect(lines.some((line) => line.startsWith("Medições ignoradas"))).toBe(false)
  })
})

describe("Central — horizonte da escala e qualidade do calendário", () => {
  it("calendário terminando em 3 dias: aviso no card de Escalas (≠ freshness FRESH) e linha de qualidade com capital e 6x1 sem calendário", async () => {
    const data = overview(freshness("FRESH"))
    const scheduleFeed = { ...freshness("FRESH").feeds[0]!, feedId: "feed-ws", feedName: "Work Schedules", contractKey: "WORK_SCHEDULE_DAYS", sourceNamespace: "wfm" }
    service.fetchOverview.mockResolvedValue({
      ...data,
      workSchedule: { state: "FRESH", configured: true, feeds: [scheduleFeed], consideredFeedIds: ["feed-ws"], lastSuccessAt: NOW, lastDataAt: NOW, lastSuccessLocalDate: "2026-09-16" },
      workScheduleHorizon: { configured: true, coverageFrom: "2026-09-01", coverageUntil: "2026-09-18", daysRemaining: 3, warningDays: 7, endingSoon: true, peopleWithCalendarAhead: 6 },
      calendarQuality: { operationalCapital: { filled: 1980, total: 2120 }, sixByOne: { withCalendar: 3, withoutCalendar: 1, total: 4 }, activeExceptionsAhead: 2 },
    })
    renderWithQuery(<OverviewTab onOpenTab={() => undefined} />)
    const card = await screen.findByTestId("work-schedule-card")
    expect(card).toHaveAttribute("data-state", "FRESH")
    expect(within(card).getByTestId("schedule-horizon")).toHaveTextContent("Calendário disponível: 01/09/2026 → 18/09/2026")
    expect(within(card).getByTestId("schedule-horizon-warning")).toHaveTextContent("Calendário termina em 3 dias (limite de aviso: 7 dias)")
    const quality = screen.getByTestId("calendar-quality")
    expect(quality).toHaveTextContent("Capital operacional preenchida: 1.980 de 2.120")
    expect(quality).toHaveTextContent("6x1 com calendário válido: 3 de 4")
    expect(quality).toHaveTextContent("1 sem calendário (escala desconhecida — a INIA não presume a folga)")
    expect(quality).toHaveTextContent("Exceções de calendário à frente: 2")
  })
})
