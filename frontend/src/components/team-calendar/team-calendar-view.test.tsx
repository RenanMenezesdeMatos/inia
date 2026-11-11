/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { TeamCalendarDay, TeamCalendarView as TeamCalendarData } from "@/schemas/team-calendar/team-calendar.schema"

import { describeRange, rangeFor, shiftRange, startOfWeek } from "./calendar-dates"
import { TeamCalendarView } from "./team-calendar-view"

const service = vi.hoisted(() => ({ fetchTeamCalendar: vi.fn(), provisionScheduleException: vi.fn(), cancelScheduleException: vi.fn(), fetchScheduleExceptionAudit: vi.fn(), classifyWorkday: vi.fn(), fetchClassificationHistory: vi.fn() }))
vi.mock("@/services/team-calendar/team-calendar-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function day(date: string, patch: Partial<TeamCalendarDay>): TeamCalendarDay {
  return {
    date,
    state: "PLANNED_WORK",
    stateLabel: "Trabalha (planejado)",
    eligible: true,
    plannedToWork: true,
    plannedBasis: "EXPLICIT_SCHEDULE",
    plannedBasisLabel: "Escala informada pela fonte",
    plannedCause: null,
    holiday: false,
    status: null,
    exception: null,
    cancelledExceptions: 0,
    observed: false,
    evidence: null,
    overridesPlan: false,
    conflict: null,
    shiftStart: "08:00:00",
    shiftEnd: "14:20:00",
    reconciliation: null,
    availability: { state: "READY", label: "Dados fechados", decidedBy: null, decidedByLabel: null, workActivityExpectedAt: null, employmentExpectedAt: null },
    classification: null,
    ...patch,
  }
}

const WEEK = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"]
const DATA: TeamCalendarData = {
  anchor: { personId: "sup-1", name: "Vanessa", role: "SUPERVISOR", roleLabel: "Supervisor" },
  availableAnchors: [{ personId: "sup-1", name: "Vanessa", roleLabel: "Supervisor", teamName: "Atendimento" }],
  range: { from: "2026-09-14", to: "2026-09-20" },
  today: "2026-09-16",
  timeZone: "America/Fortaleza",
  evidenceSources: { interactions: true, indicatorCodes: ["TMA"], enabled: true },
  provisionableCodes: [
    { code: "DAY_OFF", label: "Day off" },
    { code: "BANCO_HORAS", label: "Banco de horas" },
    { code: "ATESTADO", label: "Atestado" },
    { code: "FOLGA_EXTRAORDINARIA", label: "Folga extraordinária" },
  ],
  classifications: [
    { code: "UNJUSTIFIED_ABSENCE", label: "Falta injustificada" },
    { code: "JUSTIFIED_ABSENCE", label: "Ausência justificada" },
    { code: "WORKED_DATA_MISSING", label: "Trabalhou — dados não chegaram" },
  ],
  justifiedReasons: [
    { code: "ATESTADO", label: "Atestado" },
    { code: "DAY_OFF", label: "Day off" },
    { code: "BANCO_HORAS", label: "Banco de horas" },
    { code: "FOLGA_EXTRAORDINARIA", label: "Folga extraordinária" },
    { code: "OTHER_JUSTIFIED", label: "Outro motivo justificado" },
  ],
  canProvision: true,
  provisionablePeople: [{ personId: "op-1", name: "Joana Esteves" }, { personId: "op-2", name: "Caio Lima" }],
  filterOptions: { teams: [{ id: "team-1", name: "Atendimento", subteams: [{ id: "sub-1", name: "Retenção" }] }, { id: "team-2", name: "Vendas", subteams: [] }], jobTitles: ["Operador", "Operadora"], scheduleTypes: [{ code: "FIVE_BY_TWO", label: "5x2" }, { code: "NONE", label: "Sem escala configurada" }], attention: [{ code: "MISSING_PRODUCTION", label: "Com pendência (sem produção)" }, { code: "WAITING_FOR_DATA", label: "Aguardando dados" }, { code: "DATA_SOURCE_DELAY", label: "Fonte atrasada" }, { code: "UNJUSTIFIED_ABSENCE", label: "Com falta injustificada" }, { code: "DIVERGENCE", label: "Com divergência (produção fora do plano)" }, { code: "CONFLICT", label: "Com inconsistência (produção em situação não produtiva)" }] },
  pagination: { page: 1, pageSize: 10, total: 2, totalPeople: 2 },
  people: [
    {
      personId: "op-1",
      name: "Joana Esteves",
      teamId: "team-1",
      teamName: "Atendimento",
      subteamId: "sub-1",
      subteamName: "Retenção",
      jobTitle: "Operadora",
      scheduleType: "FIVE_BY_TWO",
      scheduleTypeLabel: "5x2",
      days: [
        day("2026-09-14", { state: "WORKED_OBSERVED", stateLabel: "Trabalhou (produção observada)", observed: true, evidence: "medição de TMA" }),
        day("2026-09-15", { state: "MISSING_EXPECTED_PRODUCTION", stateLabel: "Sem produção · classificar", reconciliation: { id: "rec-1", kind: "MISSING_EXPECTED_PRODUCTION", kindLabel: "Produção não identificada", status: "OPEN", resolution: null, resolutionLabel: null } }),
        day("2026-09-16", { state: "WORKED_OBSERVED", stateLabel: "Trabalhou (produção observada)", observed: true, evidence: "2 interação(ões)", overridesPlan: true, plannedToWork: false, plannedCause: "EXCEPTION", exception: { id: "exc-1", code: "DAY_OFF", label: "Day off", origin: "CENTRAL_DATA", originLabel: "Central de Dados", manualOverride: false }, reconciliation: { id: "rec-2", kind: "PRODUCTION_ON_NON_WORKING_DAY", kindLabel: "Produção em dia planejado como não trabalhado", status: "NOTED", resolution: null, resolutionLabel: null } }),
        day("2026-09-17", { state: "PLANNED_NON_WORKING", stateLabel: "Não trabalha (planejado)", eligible: false, plannedToWork: false, plannedCause: "EXCEPTION", exception: { id: "exc-2", code: "BANCO_HORAS", label: "Banco de horas", origin: "SUPERVISOR_MANUAL", originLabel: "Registrada pelo Supervisor", manualOverride: false } }),
        day("2026-09-18", {}),
        day("2026-09-19", { state: "PLANNED_NON_WORKING", stateLabel: "Não trabalha (planejado)", eligible: false, plannedToWork: false, plannedCause: "SCHEDULED_DAY_OFF", shiftStart: null, shiftEnd: null }),
        day("2026-09-20", { state: "PLANNED_NON_WORKING", stateLabel: "Não trabalha (planejado)", eligible: false, plannedToWork: false, plannedCause: "SCHEDULED_DAY_OFF", shiftStart: null, shiftEnd: null }),
      ],
      summary: { plannedWork: 2, workedObserved: 2, nonWorking: 3, missingProduction: 1, divergences: 1, conflicts: 0, waitingForData: 0, dataSourceDelay: 0, unjustifiedAbsences: 0 },
    },
    {
      personId: "op-2",
      name: "Caio Lima",
      teamId: "team-1",
      teamName: "Atendimento",
      subteamId: null,
      subteamName: null,
      jobTitle: "Operador",
      scheduleType: null,
      scheduleTypeLabel: null,
      days: WEEK.map((date, index) => (index < 2 ? day(date, { state: "NON_ELIGIBLE_EMPLOYMENT_STATUS", stateLabel: "Situação funcional não produtiva", eligible: false, status: { code: "INSS", label: "INSS" }, conflict: index === 0 ? "PRODUCTION_WITH_NON_ELIGIBLE_STATUS" : null, observed: index === 0, evidence: index === 0 ? "medição de TMA" : null }) : day(date, { plannedBasis: "LEGACY_WEEKDAY_FALLBACK", plannedBasisLabel: "Segunda a sexta (compatibilidade — sem escala configurada)" }))),
      summary: { plannedWork: 5, workedObserved: 0, nonWorking: 2, missingProduction: 0, divergences: 0, conflicts: 1, waitingForData: 0, dataSourceDelay: 0, unjustifiedAbsences: 0 },
    },
  ],
}

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  service.fetchClassificationHistory.mockResolvedValue([])
})
service.fetchClassificationHistory.mockResolvedValue([])

describe("Calendário da equipe — planejado × observado", () => {
  it("datas civis: semana começa na segunda, mês fecha no último dia, navegação avança/recua", () => {
    expect(startOfWeek("2026-09-16")).toBe("2026-09-14")
    expect(startOfWeek("2026-09-20")).toBe("2026-09-14") // domingo pertence à semana que começou na segunda 14
    expect(rangeFor("WEEK", "2026-09-16")).toEqual({ from: "2026-09-14", to: "2026-09-20" })
    expect(rangeFor("MONTH", "2026-09-16")).toEqual({ from: "2026-09-01", to: "2026-09-30" })
    expect(rangeFor("MONTH", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
    expect(shiftRange("WEEK", "2026-09-16", 1)).toBe("2026-09-23")
    expect(shiftRange("MONTH", "2026-12-16", 1)).toBe("2027-01-01")
    expect(describeRange("MONTH", { from: "2026-09-01", to: "2026-09-30" })).toBe("setembro de 2026")
  })

  it("mostra por colaborador × dia o estado resolvido: trabalhou, sem produção (pendência), day off com produção (divergência), banco de horas do Supervisor, INSS com produção (inconsistência)", async () => {
    service.fetchTeamCalendar.mockResolvedValue(DATA)
    service.fetchScheduleExceptionAudit.mockResolvedValue([{ action: "SCHEDULE_EXCEPTION_PROVISIONED", actorPersonId: "sup-1", actorName: "Vanessa", createdAt: "2026-09-15T10:00:00.000Z", payload: {} }])
    renderWithQuery(<TeamCalendarView state={{ calendarDate: "2026-09-16", calendarPerson: null, calendarAnchor: null }} onStateChange={vi.fn()} pendingHref={(id) => `/supervisor?tab=pending&review=workday:${id}`} />)
    expect(await screen.findByTestId("calendar-grid")).toBeInTheDocument()
    expect(screen.getByTestId("calendar-evidence-sources").textContent).toContain("interações registradas e indicador(es) TMA")
    expect(screen.getAllByTestId("calendar-person-row")).toHaveLength(2)
    // Coluna de HOJE demarcada: bordas laterais na cor primária nas células; no cabeçalho roxo (padrão das tabelas), barra branca sob o dia.
    const todayCells = [...document.querySelectorAll("[data-today]")]
    expect(todayCells).toHaveLength(3)
    const [head, ...cells] = todayCells
    expect(head!.tagName).toBe("TH")
    expect(head!.className).toContain("bg-topbar")
    expect(head!.className).toContain("shadow-[inset_0_-3px_0_0_var(--topbar-foreground)]")
    for (const cell of cells) expect(cell.className).toContain("border-x border-primary/40")
    expect(screen.getAllByTestId("calendar-day-WORKED_OBSERVED").length).toBeGreaterThanOrEqual(2)
    const missing = screen.getByTestId("calendar-day-MISSING_EXPECTED_PRODUCTION")
    expect(missing.textContent).toContain("Sem produção")
    expect(missing.textContent).toContain("!")
    // Day off com produção: dia trabalhado, o plano fica visível ("era day off").
    const worked = screen.getAllByTestId("calendar-day-WORKED_OBSERVED").find((cell) => cell.getAttribute("data-date") === "2026-09-16")!
    expect(worked.textContent).toContain("era day off")
    // Detalhe do dia: planejado × observado + link da pendência.
    fireEvent.click(missing)
    const sheet = await screen.findByTestId("calendar-day-sheet")
    expect(screen.getByTestId("day-planned").textContent).toContain("Trabalha · 08:00–14:20")
    expect(screen.getByTestId("day-observed").textContent).toContain("Nenhuma evidência de produção")
    expect(sheet.textContent).toContain("Pendência aberta")
    expect(screen.getByTestId("day-availability").textContent).toContain("Dados fechados")
    expect(screen.getByText("abrir pendência")).toHaveAttribute("href", "/supervisor?tab=pending&review=workday:rec-1")
    expect(screen.getByTestId("day-provision")).toBeInTheDocument()
    expect(screen.getByTestId("day-classify")).toHaveTextContent("Classificar")
  })

  it("FIM DO TURNO ≠ DADO FECHADO: 'Aguardando dados' (D-1 até hora) e 'Aguardando RH' e 'Fonte atrasada' são estados distintos de 'Sem produção' — sem pendência, sem classificar", async () => {
    const waitingWork = { state: "WAITING_FOR_SOURCES" as const, label: "Aguardando dados", decidedBy: "WORK_ACTIVITY" as const, decidedByLabel: "Evidência de produção", workActivityExpectedAt: "2026-09-17T14:00:00.000Z", employmentExpectedAt: null }
    const waitingRh = { ...waitingWork, decidedBy: "EMPLOYMENT" as const, decidedByLabel: "Situação funcional (RH)", employmentExpectedAt: "2026-09-18T11:00:00.000Z" }
    const delayed = { state: "DATA_SOURCE_DELAY" as const, label: "Fonte atrasada", decidedBy: "WORK_ACTIVITY" as const, decidedByLabel: "Evidência de produção", workActivityExpectedAt: "2026-09-15T14:00:00.000Z", employmentExpectedAt: null }
    const person = DATA.people[0]!
    service.fetchTeamCalendar.mockResolvedValue({ ...DATA, people: [{ ...person, days: [day("2026-09-14", { state: "DATA_SOURCE_DELAY", stateLabel: "Fonte de dados atrasada", availability: delayed }), day("2026-09-15", { state: "WAITING_FOR_SOURCES", stateLabel: "Aguardando dados", availability: waitingWork }), day("2026-09-16", { state: "WAITING_FOR_SOURCES", stateLabel: "Aguardando dados", availability: waitingRh }), day("2026-09-17", {}), day("2026-09-18", {}), day("2026-09-19", {}), day("2026-09-20", {})], summary: { ...person.summary, missingProduction: 0, waitingForData: 2, dataSourceDelay: 1 } }] })
    renderWithQuery(<TeamCalendarView state={{ calendarDate: "2026-09-16", calendarPerson: null, calendarAnchor: null }} onStateChange={vi.fn()} />)
    await screen.findByTestId("calendar-grid")
    const cells = screen.getAllByTestId("calendar-day-WAITING_FOR_SOURCES")
    expect(cells[0]!.textContent).toContain("Aguardando dados")
    expect(cells[1]!.textContent).toContain("Aguardando RH")
    expect(screen.getByTestId("calendar-day-DATA_SOURCE_DELAY").textContent).toContain("Fonte atrasada")
    expect(screen.queryByTestId("calendar-day-MISSING_EXPECTED_PRODUCTION")).not.toBeInTheDocument()
    fireEvent.click(cells[0]!)
    await screen.findByTestId("calendar-day-sheet")
    expect(screen.getByTestId("day-availability").textContent).toContain("Nada é cobrado antes disso")
    expect(screen.queryByTestId("day-classify")).not.toBeInTheDocument()
    expect(screen.getAllByTestId("calendar-person-row")[0]!.textContent).toContain("2 aguardando dados")
  })

  it("classificação: 'Sem produção · classificar' → Falta injustificada (POST); falta classificada mostra quem classificou e 'Editar classificação' com histórico; editar para Atestado envia o motivo", async () => {
    const person = DATA.people[0]!
    const classified = { id: "cls-1", classification: "UNJUSTIFIED_ABSENCE" as const, reasonCode: null, label: "Falta injustificada", classifiedByName: "Ricardo Miranda Campos", classifiedAt: "2026-09-16T12:12:00.000Z", contradictedBy: null }
    service.fetchTeamCalendar.mockResolvedValue({ ...DATA, people: [{ ...person, days: [day("2026-09-14", { state: "CLASSIFIED_UNJUSTIFIED_ABSENCE", stateLabel: "Falta injustificada", classification: classified, reconciliation: { id: "rec-9", kind: "MISSING_EXPECTED_PRODUCTION", kindLabel: "Produção não identificada", status: "RESOLVED", resolution: "UNJUSTIFIED_ABSENCE", resolutionLabel: "Falta injustificada" } }), ...person.days.slice(1)], summary: { ...person.summary, unjustifiedAbsences: 1 } }] })
    service.fetchClassificationHistory.mockResolvedValue([
      { id: "cls-0", personId: "op-1", workday: "2026-09-14", classification: "WORKED_DATA_MISSING", reasonCode: null, label: "Trabalhou — dados não chegaram", reasonLabel: null, classifiedByPersonId: "sup-1", classifiedByName: "Ricardo Miranda Campos", classifiedAt: "2026-09-16T11:00:00.000Z", supersedesId: null, supersededAt: "2026-09-16T12:12:00.000Z", supersededByName: "Ricardo Miranda Campos", supersededReason: "REVISED", supersededReasonLabel: "Revisada pelo Supervisor" },
      { id: "cls-1", personId: "op-1", workday: "2026-09-14", classification: "UNJUSTIFIED_ABSENCE", reasonCode: null, label: "Falta injustificada", reasonLabel: null, classifiedByPersonId: "sup-1", classifiedByName: "Ricardo Miranda Campos", classifiedAt: "2026-09-16T12:12:00.000Z", supersedesId: "cls-0", supersededAt: null, supersededByName: null, supersededReason: null, supersededReasonLabel: null },
    ])
    service.classifyWorkday.mockResolvedValue({ changed: true, previous: { id: "cls-1", label: "Falta injustificada" }, current: { id: "cls-2", label: "Ausência justificada · Atestado" } })
    renderWithQuery(<TeamCalendarView state={{ calendarDate: "2026-09-16", calendarPerson: null, calendarAnchor: null }} onStateChange={vi.fn()} />)
    await screen.findByTestId("calendar-grid")
    const cell = screen.getByTestId("calendar-day-CLASSIFIED_UNJUSTIFIED_ABSENCE")
    expect(cell.textContent).toContain("Falta injustificada")
    expect(cell.textContent).toContain("por Ricardo")
    expect(screen.getAllByTestId("calendar-person-row")[0]!.textContent).toContain("1 falta(s) injustificada(s)")
    fireEvent.click(cell)
    await screen.findByTestId("calendar-day-sheet")
    expect(screen.getByTestId("day-classification").textContent).toContain("Classificada por Ricardo Miranda Campos")
    expect((await screen.findByTestId("day-classification-history")).textContent).toContain("Trabalhou — dados não chegaram")
    fireEvent.click(screen.getByTestId("day-classify"))
    const dialog = await screen.findByTestId("classify-dialog")
    expect(screen.getByTestId("classify-current").textContent).toContain("Falta injustificada")
    // Escolher a mesma classificação não habilita; Ausência justificada pede motivo (Atestado por padrão) e envia.
    fireEvent.click(screen.getByLabelText(/Falta injustificada/))
    expect(screen.getByTestId("classify-submit")).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/Ausência justificada/))
    expect(dialog.textContent).toContain("não armazena diagnóstico, CID")
    fireEvent.click(screen.getByTestId("classify-submit"))
    await waitFor(() => expect(service.classifyWorkday).toHaveBeenCalledWith({ personId: "op-1", date: "2026-09-14", classification: "JUSTIFIED_ABSENCE", reasonCode: "ATESTADO" }))
  })

  it("exceção vigente: mostra origem e trilha de auditoria e permite cancelar (nunca apaga); INSS não permite provisionar", async () => {
    service.fetchTeamCalendar.mockResolvedValue(DATA)
    service.fetchScheduleExceptionAudit.mockResolvedValue([{ action: "SCHEDULE_EXCEPTION_PROVISIONED", actorPersonId: "sup-1", actorName: "Vanessa", createdAt: "2026-09-15T10:00:00.000Z", payload: {} }])
    service.cancelScheduleException.mockResolvedValue({ id: "exc-2", active: false })
    renderWithQuery(<TeamCalendarView state={{ calendarDate: "2026-09-16", calendarPerson: null, calendarAnchor: null }} onStateChange={vi.fn()} />)
    await screen.findByTestId("calendar-grid")
    const banco = screen.getAllByTestId("calendar-day-PLANNED_NON_WORKING").find((cell) => cell.getAttribute("data-date") === "2026-09-17")!
    expect(banco.textContent).toContain("Banco de horas")
    fireEvent.click(banco)
    expect(await screen.findByText(/Exceção vigente: Banco de horas/)).toBeInTheDocument()
    expect(screen.getByText(/Origem: Registrada pelo Supervisor/)).toBeInTheDocument()
    expect((await screen.findByTestId("day-audit")).textContent).toContain("Provisionada por Vanessa")
    fireEvent.click(screen.getByTestId("day-cancel-exception"))
    await waitFor(() => expect(service.cancelScheduleException).toHaveBeenCalledWith("exc-2"))
    // INSS: situação funcional soberana — sem provisionamento; inconsistência marcada.
    const inss = screen.getAllByTestId("calendar-day-NON_ELIGIBLE_EMPLOYMENT_STATUS")[0]!
    expect(inss.textContent).toContain("INSS")
    expect(inss.textContent).toContain("produção")
    fireEvent.click(inss)
    await screen.findByText(/Inconsistência de dados/)
    expect(screen.queryByTestId("day-provision")).not.toBeInTheDocument()
  })

  it("provisionar exceção: colaborador, motivo e período (dia ou intervalo) → POST com os dados; atestado avisa que não guarda dado clínico", async () => {
    service.fetchTeamCalendar.mockResolvedValue(DATA)
    service.provisionScheduleException.mockResolvedValue({ created: [{ id: "x" }, { id: "y" }], reactivated: [], unchanged: [], provisionGroupId: "g" })
    renderWithQuery(<TeamCalendarView state={{ calendarDate: "2026-09-16", calendarPerson: null, calendarAnchor: null }} onStateChange={vi.fn()} />)
    await screen.findByTestId("calendar-grid")
    fireEvent.click(screen.getByTestId("calendar-provision"))
    const dialog = await screen.findByTestId("provision-dialog")
    fireEvent.change(screen.getByTestId("provision-from"), { target: { value: "2026-09-21" } })
    fireEvent.change(screen.getByTestId("provision-to"), { target: { value: "2026-09-22" } })
    expect(dialog.textContent).toContain("2 dia(s)")
    fireEvent.click(screen.getByTestId("provision-submit"))
    await waitFor(() => expect(service.provisionScheduleException).toHaveBeenCalledWith({ personId: "op-1", code: "DAY_OFF", from: "2026-09-21", to: "2026-09-22" }))
  })

  it("sem fonte de evidência configurada avisa que ausência de produção não gera pendência", async () => {
    service.fetchTeamCalendar.mockResolvedValue({ ...DATA, evidenceSources: { interactions: false, indicatorCodes: [], enabled: false } })
    renderWithQuery(<TeamCalendarView state={{ calendarDate: "2026-09-16", calendarPerson: null, calendarAnchor: null }} onStateChange={vi.fn()} />)
    expect((await screen.findByTestId("calendar-evidence-sources")).textContent).toContain("Sem fonte de evidência de produção configurada")
  })
})

describe("Calendário da equipe — filtros e paginação (mesmo padrão das listagens administrativas)", () => {
  it("busca, grupo/subgrupo, cargo, escala e atenção vão para a API como parâmetros de lista; 'Limpar filtros' zera tudo e volta à página 1", async () => {
    service.fetchTeamCalendar.mockResolvedValue(DATA)
    renderWithQuery(<TeamCalendarView state={{ calendarDate: "2026-09-16", calendarPerson: null, calendarAnchor: null }} onStateChange={vi.fn()} />)
    await screen.findByTestId("calendar-grid")
    expect(service.fetchTeamCalendar).toHaveBeenLastCalledWith({ from: "2026-09-14", to: "2026-09-20", anchorId: null, list: { search: undefined, teamId: undefined, subteamId: undefined, jobTitle: undefined, scheduleType: undefined, attention: undefined, scheduledToday: undefined, page: 1, pageSize: 10 } })
    expect(screen.getByText("1–2 de 2 colaboradores · página 1 de 1")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Buscar colaborador"), { target: { value: "  Joana " } })
    await waitFor(() => expect(service.fetchTeamCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ list: expect.objectContaining({ search: "Joana", page: 1 }) })))

    fireEvent.click(screen.getByLabelText("Filtrar por grupo"))
    fireEvent.click(await screen.findByRole("option", { name: "Atendimento" }))
    await waitFor(() => expect(service.fetchTeamCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ list: expect.objectContaining({ teamId: "team-1", subteamId: undefined }) })))
    fireEvent.click(screen.getByLabelText("Filtrar por subgrupo"))
    fireEvent.click(await screen.findByRole("option", { name: "Retenção" }))
    await waitFor(() => expect(service.fetchTeamCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ list: expect.objectContaining({ teamId: "team-1", subteamId: "sub-1" }) })))
    // Trocar o grupo limpa o subgrupo (que pertencia ao grupo anterior).
    fireEvent.click(screen.getByLabelText("Filtrar por grupo"))
    fireEvent.click(await screen.findByRole("option", { name: "Vendas" }))
    await waitFor(() => expect(service.fetchTeamCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ list: expect.objectContaining({ teamId: "team-2", subteamId: undefined }) })))
    expect(screen.getByLabelText("Filtrar por subgrupo")).toBeDisabled()
    expect(screen.getByLabelText("Filtrar por subgrupo").textContent).toContain("Sem subgrupos neste grupo")

    fireEvent.click(screen.getByLabelText("Filtrar por cargo"))
    fireEvent.click(await screen.findByRole("option", { name: "Operadora" }))
    await waitFor(() => expect(service.fetchTeamCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ list: expect.objectContaining({ jobTitle: "Operadora" }) })))

    fireEvent.click(screen.getByLabelText("Filtrar por escala"))
    fireEvent.click(await screen.findByRole("option", { name: "Sem escala configurada" }))
    await waitFor(() => expect(service.fetchTeamCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ list: expect.objectContaining({ scheduleType: "NONE" }) })))

    fireEvent.click(screen.getByLabelText("Filtrar por situação no período"))
    fireEvent.click(await screen.findByRole("option", { name: "Com falta injustificada" }))
    await waitFor(() => expect(service.fetchTeamCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ list: expect.objectContaining({ attention: "UNJUSTIFIED_ABSENCE" }) })))

    fireEvent.click(screen.getByLabelText("Filtrar por quem trabalha hoje"))
    fireEvent.click(await screen.findByRole("option", { name: "Hoje: trabalham" }))
    await waitFor(() => expect(service.fetchTeamCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ list: expect.objectContaining({ scheduledToday: true }) })))

    fireEvent.click(await screen.findByRole("button", { name: "Limpar filtros" }))
    await waitFor(() => expect(service.fetchTeamCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ list: { search: undefined, teamId: undefined, subteamId: undefined, jobTitle: undefined, scheduleType: undefined, attention: undefined, scheduledToday: undefined, page: 1, pageSize: 10 } })))
  })

  it("paginação: a grade mostra só a página corrente, navega páginas e o seletor de provisionar continua com TODOS os operadores diretos", async () => {
    const page1 = { ...DATA, people: [DATA.people[0]!], pagination: { page: 1, pageSize: 10, total: 12, totalPeople: 12 } }
    const page2 = { ...DATA, people: [DATA.people[1]!], pagination: { page: 2, pageSize: 10, total: 12, totalPeople: 12 } }
    service.fetchTeamCalendar.mockImplementation(async (input: { list: { page: number } }) => (input.list.page === 2 ? page2 : page1))
    renderWithQuery(<TeamCalendarView state={{ calendarDate: "2026-09-16", calendarPerson: null, calendarAnchor: null }} onStateChange={vi.fn()} />)
    await screen.findByTestId("calendar-grid")
    expect(screen.getByText("1–10 de 12 colaboradores · página 1 de 2")).toBeInTheDocument()
    expect(screen.getAllByTestId("calendar-person-row")).toHaveLength(1)
    expect(screen.getByText("Joana Esteves")).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText("Próxima página"))
    await waitFor(() => expect(service.fetchTeamCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ list: expect.objectContaining({ page: 2, pageSize: 10 }) })))
    await waitFor(() => expect(screen.getByText("11–12 de 12 colaboradores · página 2 de 2")).toBeInTheDocument())
    expect(screen.getByText("Caio Lima")).toBeInTheDocument()
    expect(screen.queryByText("Joana Esteves")).not.toBeInTheDocument()

    // Provisionar lista todos os operadores diretos (não só a página corrente).
    fireEvent.click(screen.getByTestId("calendar-provision"))
    fireEvent.click(await screen.findByTestId("provision-person"))
    expect(await screen.findByRole("option", { name: "Joana Esteves" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Caio Lima" })).toBeInTheDocument()
  })

  it("sem resultado para os filtros mostra 'Nenhum colaborador corresponde aos filtros' (≠ equipe sem operadores) com atalho para limpar", async () => {
    service.fetchTeamCalendar.mockResolvedValue({ ...DATA, people: [], pagination: { page: 1, pageSize: 10, total: 0, totalPeople: 2 } })
    renderWithQuery(<TeamCalendarView state={{ calendarDate: "2026-09-16", calendarPerson: null, calendarAnchor: null }} onStateChange={vi.fn()} />)
    expect(await screen.findByText("Nenhum colaborador corresponde aos filtros")).toBeInTheDocument()
    expect(screen.queryByText("Nenhum operador direto nesta equipe")).not.toBeInTheDocument()
    expect(screen.queryByTestId("calendar-grid")).not.toBeInTheDocument()

    service.fetchTeamCalendar.mockResolvedValue({ ...DATA, people: [], canProvision: false, provisionablePeople: [], filterOptions: { jobTitles: [], scheduleTypes: [], attention: [] }, pagination: { page: 1, pageSize: 10, total: 0, totalPeople: 0 } })
    cleanup()
    renderWithQuery(<TeamCalendarView state={{ calendarDate: "2026-09-16", calendarPerson: null, calendarAnchor: null }} onStateChange={vi.fn()} />)
    expect(await screen.findByText("Nenhum operador direto nesta equipe")).toBeInTheDocument()
    expect(screen.queryByLabelText("Buscar colaborador")).not.toBeInTheDocument()
  })
})
