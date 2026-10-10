/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import type { EmploymentStatusView } from "@/schemas/analytics/analytics.schema"
import { UNKNOWN_FRESHNESS } from "@/schemas/people/employment-status.schema"

import { EmployeeIndicatorsDashboard } from "./employee-indicators-dashboard"
import { EMPLOYEE_DASHBOARD } from "./testing/fixtures"
import { installJsdomStubs } from "./testing/jsdom-stubs"
import { renderWithQuery } from "./testing/render-with-query"

beforeAll(installJsdomStubs)
afterEach(cleanup)

const STALE = { state: "STALE" as const, lastSuccessAt: "2026-09-12T09:00:00.000Z", cadenceLabel: "A cada 1h", sourceName: "API RH", feedName: "Colaboradores" }
const FRESH = { state: "FRESH" as const, lastSuccessAt: "2026-09-16T09:00:00.000Z", cadenceLabel: "A cada 1h", sourceName: "API RH", feedName: "Colaboradores" }

type StatusFixture = Omit<EmploymentStatusView, "operationalCapital" | "schedule"> & { operationalCapital?: EmploymentStatusView["operationalCapital"]; schedule: ScheduleFixture | null }
type ScheduleFixture = Omit<NonNullable<EmploymentStatusView["schedule"]>, "knownUntil" | "upcomingExceptions" | "todayException"> & Partial<Pick<NonNullable<EmploymentStatusView["schedule"]>, "knownUntil" | "upcomingExceptions" | "todayException">>

function renderWith(fixture: StatusFixture) {
  const employmentStatus: EmploymentStatusView = { ...fixture, operationalCapital: fixture.operationalCapital ?? null, schedule: fixture.schedule ? { knownUntil: null, upcomingExceptions: [], todayException: null, ...fixture.schedule } : null }
  return renderWithQuery(<EmployeeIndicatorsDashboard dashboard={{ ...EMPLOYEE_DASHBOARD, employmentStatus }} openIndicator={null} onOpenIndicator={() => undefined} isOwnProfile />)
}

describe("Perfil — situação funcional com confiança da fonte", () => {
  it("ativo com fonte atualizada: nada aparece (o normal não vira aviso)", () => {
    renderWith({ status: "EM_PRODUCAO", label: "EM PRODUÇÃO", since: "2026-09-01", sinceInferred: false, until: null, source: "rh", basis: "OPEN_PERIOD", basisLabel: "Período em aberto", periodId: "p1", origin: { sourceName: "API RH", feedName: "Colaboradores", feedId: "f1", sourceId: "s1" }, freshness: FRESH, history: [], schedule: null })
    expect(screen.queryByTestId("employment-status")).not.toBeInTheDocument()
  })

  it("ativo presumido com fonte atrasada: aviso discreto com última atualização, cadência e origem", () => {
    renderWith({ status: "EM_PRODUCAO", label: "EM PRODUÇÃO", since: "2026-09-01", sinceInferred: false, until: null, source: "rh", basis: "OPEN_PERIOD", basisLabel: "Período em aberto", periodId: "p1", origin: { sourceName: "API RH", feedName: "Colaboradores", feedId: "f1", sourceId: "s1" }, freshness: STALE, history: [], schedule: null })
    const block = screen.getByTestId("employment-status")
    expect(block).toHaveTextContent("Situação: EM PRODUÇÃO")
    expect(block).toHaveTextContent("Origem: API RH › Colaboradores")
    const badge = screen.getByTestId("employment-status-stale")
    expect(badge).toHaveTextContent("Fonte atrasada — situação funcional atualizada pela última vez em 12/09/2026")
    expect(badge).toHaveTextContent("cadência esperada: a cada 1h")
  })

  it("retorno presumido após o fim do período: diz que o retorno não foi confirmado", () => {
    renderWith({ status: "EM_PRODUCAO", label: "EM PRODUÇÃO", since: "2026-09-15", sinceInferred: false, until: null, source: "rh-ausencias", basis: "PRESUMED_AFTER_PERIOD", basisLabel: "Ativo presumido (após o fim do último período)", periodId: "p2", origin: null, freshness: FRESH, history: [], schedule: null })
    expect(screen.getByTestId("employment-status")).toHaveTextContent("retorno não confirmado pela fonte")
    expect(screen.queryByTestId("employment-status-stale")).not.toBeInTheDocument()
  })

  it("férias com início e fim explícitos NÃO mostram 'fonte atrasada' mesmo com o feed atrasado", () => {
    renderWith({ status: "FERIAS", label: "FÉRIAS", since: "2026-09-14", sinceInferred: false, until: "2026-09-26", source: "rh-ausencias", basis: "EXPLICIT_PERIOD", basisLabel: "Período explícito", periodId: "p3", origin: { sourceName: "API RH", feedName: "Ausências", feedId: "f2", sourceId: "s1" }, freshness: STALE, history: [], schedule: null })
    const block = screen.getByTestId("employment-status")
    expect(block).toHaveTextContent("Situação: FÉRIAS")
    expect(block).toHaveTextContent("desde 14/09/2026 até 26/09/2026")
    expect(screen.queryByTestId("employment-status-stale")).not.toBeInTheDocument()
  })
})

describe("Perfil — escala e histórico (só o que a fonte informou)", () => {
  const base = { status: "EM_PRODUCAO" as const, label: "EM PRODUÇÃO", since: "2026-09-01", sinceInferred: false, until: null, source: "rh", basis: "OPEN_PERIOD" as const, basisLabel: "Período em aberto", periodId: "p1", origin: null, freshness: FRESH }
  const scheduleFresh = { state: "FRESH" as const, lastSuccessAt: "2026-09-16T08:00:00.000Z", cadenceLabel: "A cada 1h", sourceName: "API Workforce", feedName: "Work Schedules" }

  it("6x1 com calendário explícito: mostra 'Escala: 6x1', próxima folga programada e origem — mesmo com a pessoa em produção", () => {
    renderWith({ ...base, history: [], schedule: { scheduleType: "SIX_BY_ONE", scheduleTypeLabel: "6x1", basis: "EXPLICIT_SCHEDULE", basisLabel: "Escala informada pela fonte", nextDayOff: "2026-09-18", knownDaysAhead: 14, freshness: scheduleFresh, origin: { sourceName: "API Workforce", feedName: "Work Schedules", feedId: "f9", sourceId: "s9" } } })
    const schedule = screen.getByTestId("work-schedule")
    expect(schedule).toHaveTextContent("Escala: 6x1")
    expect(schedule).toHaveTextContent("próxima folga programada: 18/09/2026")
    expect(schedule).toHaveTextContent("Origem: API Workforce › Work Schedules")
    expect(screen.queryByTestId("work-schedule-stale")).not.toBeInTheDocument()
  })

  it("6x1 sem folga informada: diz que a INIA não presume a folga; sem próxima folga inventada", () => {
    renderWith({ ...base, history: [], schedule: { scheduleType: "SIX_BY_ONE", scheduleTypeLabel: "6x1", basis: "UNKNOWN_SCHEDULE", basisLabel: "Escala desconhecida", nextDayOff: null, knownDaysAhead: 0, freshness: UNKNOWN_FRESHNESS, origin: null } })
    const schedule = screen.getByTestId("work-schedule")
    expect(schedule).toHaveTextContent("folgas não informadas pela fonte")
    expect(schedule).not.toHaveTextContent("próxima folga")
  })

  it("sem escala configurada (fallback seg–sex) e em produção confiável: nada aparece", () => {
    renderWith({ ...base, history: [], schedule: { scheduleType: null, scheduleTypeLabel: null, basis: "LEGACY_WEEKDAY_FALLBACK", basisLabel: "Segunda a sexta (compatibilidade)", nextDayOff: null, knownDaysAhead: 0, freshness: UNKNOWN_FRESHNESS, origin: null } })
    expect(screen.queryByTestId("employment-status")).not.toBeInTheDocument()
    expect(screen.queryByTestId("work-schedule")).not.toBeInTheDocument()
  })

  it("INSS com histórico: 'Situação: INSS', dias não contam, e o histórico lista EM PRODUÇÃO 01/09–10/09 · INSS desde 11/09", () => {
    renderWith({ ...base, status: "INSS", label: "INSS", since: "2026-09-11", history: [
      { periodId: "p2", status: "INSS", label: "INSS", from: "2026-09-11", to: null, fromInferred: false, source: "rh", rawStatus: "INSS" },
      { periodId: "p1", status: "EM_PRODUCAO", label: "EM PRODUÇÃO", from: "2026-09-01", to: "2026-09-10", fromInferred: false, source: "rh", rawStatus: "PROD" },
    ], schedule: null })
    const block = screen.getByTestId("employment-status")
    expect(block).toHaveTextContent("Situação: INSS")
    expect(block).toHaveTextContent("Os dias nessa situação não contam como elegíveis")
    expect(screen.getByTestId("employment-status-history")).toHaveTextContent("Histórico: INSS desde 11/09/2026 · EM PRODUÇÃO 01/09/2026–10/09/2026")
  })

  it("fonte de escala atrasada: aviso específico de ESCALA (não de situação funcional)", () => {
    renderWith({ ...base, history: [], schedule: { scheduleType: "FIVE_BY_TWO", scheduleTypeLabel: "5x2", basis: "EXPLICIT_SCHEDULE", basisLabel: "Escala informada pela fonte", nextDayOff: "2026-09-19", knownDaysAhead: 3, freshness: { ...scheduleFresh, state: "STALE", lastSuccessAt: "2026-09-12T08:00:00.000Z" }, origin: null } })
    expect(screen.getByTestId("work-schedule-stale")).toHaveTextContent("Fonte de escala atrasada — última carga em 12/09/2026")
    expect(screen.queryByTestId("employment-status-stale")).not.toBeInTheDocument()
  })
})

describe("Perfil — exceções, horizonte e capital operacional", () => {
  const base = { status: "EM_PRODUCAO" as const, label: "EM PRODUÇÃO", since: "2026-09-01", sinceInferred: false, until: null, source: "rh", basis: "OPEN_PERIOD" as const, basisLabel: "Período em aberto", periodId: "p1", origin: null, freshness: FRESH, history: [] }
  const scheduleFresh = { state: "FRESH" as const, lastSuccessAt: "2026-09-16T08:00:00.000Z", cadenceLabel: "A cada 1h", sourceName: "API Workforce", feedName: "Work Schedules" }

  it("day off hoje + calendário conhecido até 31/10 + capital Fortaleza / CE", () => {
    renderWith({
      ...base,
      operationalCapital: { code: "FORTALEZA", name: "Fortaleza", stateCode: "CE", label: "Fortaleza / CE" },
      schedule: { scheduleType: "SIX_BY_ONE", scheduleTypeLabel: "6x1", basis: "EXPLICIT_SCHEDULE", basisLabel: "Escala informada pela fonte", nextDayOff: "2026-09-18", knownDaysAhead: 45, knownUntil: "2026-10-31", freshness: scheduleFresh, origin: null, todayException: { id: "x1", code: "DAY_OFF", label: "Day off", rawReason: "Compensação" }, upcomingExceptions: [{ id: "x1", date: "2026-09-16", code: "DAY_OFF", label: "Day off", rawReason: "Compensação" }, { id: "x2", date: "2026-09-23", code: "BANCO_HORAS", label: "Banco de horas", rawReason: null }] },
    })
    const schedule = screen.getByTestId("work-schedule")
    expect(schedule).toHaveTextContent("Escala: 6x1")
    expect(schedule).toHaveTextContent("calendário conhecido até 31/10/2026")
    expect(screen.getByTestId("work-schedule-today-exception")).toHaveTextContent("Hoje: Day off")
    expect(screen.getByTestId("work-schedule-exceptions")).toHaveTextContent("exceções: Banco de horas em 23/09/2026")
    expect(screen.getByTestId("operational-capital")).toHaveTextContent("Capital operacional: Fortaleza / CE")
    expect(screen.getByTestId("operational-capital")).not.toHaveTextContent(/endereço|teletrabalho|lotação/)
  })

  it("sem capital e sem nada relevante: nem capital nem escala aparecem (o normal não vira aviso)", () => {
    renderWith({ ...base, operationalCapital: null, schedule: { scheduleType: null, scheduleTypeLabel: null, basis: "LEGACY_WEEKDAY_FALLBACK", basisLabel: "Segunda a sexta (compatibilidade)", nextDayOff: null, knownDaysAhead: 0, freshness: UNKNOWN_FRESHNESS, origin: null } })
    expect(screen.queryByTestId("operational-capital")).not.toBeInTheDocument()
    expect(screen.queryByTestId("work-schedule")).not.toBeInTheDocument()
  })
})
