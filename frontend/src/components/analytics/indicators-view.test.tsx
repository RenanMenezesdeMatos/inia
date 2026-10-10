/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { IndicatorsView } from "./indicators-view"
import { EMPLOYEE_DASHBOARD, EMPTY_EMPLOYEE_DASHBOARD, MANAGER_CONTEXT, MONTH_COMPARISON, OPERATOR_CONTEXT, STRUCTURE_DASHBOARD } from "./testing/fixtures"
import { installJsdomStubs } from "./testing/jsdom-stubs"
import { renderWithQuery } from "./testing/render-with-query"

const service = vi.hoisted(() => ({
  fetchIndicatorDashboard: vi.fn(),
  fetchStructureBreakdown: vi.fn(),
  fetchIndicatorMembers: vi.fn(),
}))
vi.mock("@/services/analytics/analytics-service", () => service)

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Indicadores — visão EMPLOYEE (Operador)", () => {
  it("mostra o PRV oficial exatamente como veio, a composição com peso, o histórico e os indicadores", async () => {
    service.fetchIndicatorDashboard.mockResolvedValue(EMPLOYEE_DASHBOARD)
    renderWithQuery(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, indicator: null, groupBy: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)

    expect(await screen.findByText("Meu PRV")).toBeInTheDocument()
    expect(screen.getByText("105%")).toBeInTheDocument()
    expect(screen.getByText("Meta 100%")).toBeInTheDocument()
    expect(screen.getByText("Q1 — melhor quartil")).toBeInTheDocument()
    expect(screen.getByLabelText(/Em alta: \+4 p\.p\./)).toBeInTheDocument()
    // composição: peso oficial + atingimento, sem recomposição
    const composition = screen.getByLabelText("Composição do PRV")
    expect(composition).toHaveTextContent("Nota da Pesquisa na URA")
    expect(composition).toHaveTextContent("60%")
    expect(composition).toHaveTextContent("112,5%")
    // histórico acessível (tabela textual do gráfico)
    expect(screen.getAllByText(/jul\/26: 96%/)[0]).toBeInTheDocument()
    // indicadores individuais: valor bruto na unidade + atingimento + peso + quartil
    expect(screen.getByRole("heading", { name: "Tempo Médio de Atendimento" })).toBeInTheDocument()
    expect(screen.getByText("4m40s")).toBeInTheDocument()
    expect(screen.getByText("93,3% de atingimento")).toBeInTheDocument()
    expect(screen.getByText("Peso PRV 40%")).toBeInTheDocument()
    expect(screen.getByText("Abaixo da referência")).toBeInTheDocument()
    // pontos positivos determinísticos do PRV
    expect(screen.getByText("Atingimento de 105% — igual ou acima da meta.")).toBeInTheDocument()
    // a chamada usa o sujeito padrão e a competência corrente do contexto
    expect(service.fetchIndicatorDashboard).toHaveBeenCalledWith(null, "2026-09", null)
  })

  it("abrir um indicador pede o detalhe pela URL (indicator) — e o painel mostra a análise persistida da INIA", async () => {
    service.fetchIndicatorDashboard.mockResolvedValue(EMPLOYEE_DASHBOARD)
    const onStateChange = vi.fn()
    const { rerender } = renderWithQuery(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, indicator: null, groupBy: null }} onStateChange={onStateChange} employeeHref={(id) => `/e/${id}`} />)
    fireEvent.click(await screen.findByRole("button", { name: "Ver detalhes de Tempo Médio de Atendimento" }))
    expect(onStateChange).toHaveBeenCalledWith({ indicator: "TMA" })

    rerender(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, indicator: "TMA", groupBy: null }} onStateChange={onStateChange} employeeHref={(id) => `/e/${id}`} />)
    expect(await screen.findByRole("dialog")).toHaveTextContent("Análise da INIA")
    expect(screen.getByRole("dialog")).toHaveTextContent("Recomendação persistida da INIA")
    expect(screen.getByRole("dialog")).toHaveTextContent("Análise persistida em")
  }, 20_000)

  it("abrir o detalhe não abre tooltip sozinho: o foco inicial vai para o painel, não para o botão de informação", async () => {
    service.fetchIndicatorDashboard.mockResolvedValue(EMPLOYEE_DASHBOARD)
    renderWithQuery(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, indicator: "TMA", groupBy: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    const dialog = await screen.findByRole("dialog")
    await waitFor(() => expect(dialog).toHaveFocus())
    expect(screen.getByRole("button", { name: "Como o acompanhamento operacional é calculado" })).toHaveAttribute("data-state", "closed")
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
  })

  it("Fechamento oficial × Acompanhamento operacional: rótulos inequívocos, Q oficial e Q operacional nunca se confundem; indicador sem medição diária não tem painel operacional", async () => {
    service.fetchIndicatorDashboard.mockResolvedValue(EMPLOYEE_DASHBOARD)
    const { rerender } = renderWithQuery(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, indicator: null, groupBy: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    // Card: chip operacional só no TMA (medição diária), com o valor na unidade real e a performance pela direção.
    const chip = await screen.findByTestId("operational-chip")
    expect(chip).toHaveTextContent("Operacional 7d: 7m55s")
    // Evolução/queda/estabilidade é um selo com palavra + número (nunca só cor): "Piorou −8%", e o aria-label mantém a frase completa.
    expect(chip).toHaveTextContent("Piorou−8%vs. os 7 dias anteriores")
    expect(chip.querySelector("[data-performance-trend]")).toHaveAttribute("data-performance-trend", "DECLINED")
    expect(screen.getAllByLabelText(/Variação de performance vs\. os 7 dias anteriores: −8% de performance \(piorou\)/)[0]).toBeInTheDocument()
    expect(chip).toHaveTextContent("Q4 operacional · 95º de 108 · Subgrupo Voz")
    expect(screen.getByText("Q2 oficial")).toBeInTheDocument()

    rerender(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, indicator: "TMA", groupBy: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Fechamento oficial")
    expect(dialog).toHaveTextContent("Quartil oficial")
    expect(dialog).toHaveTextContent("Q2")
    expect(dialog).toHaveTextContent("Acompanhamento operacional")
    expect(dialog).toHaveTextContent("Quartil operacional — últimos 7 dias")
    // Quartil com a POPULAÇÃO explícita: quartil, posição, tamanho, pares.
    expect(dialog).toHaveTextContent("Q4 operacional · 95º de 108")
    expect(dialog).toHaveTextContent("Pares: Subgrupo Voz (106 de 108 elegíveis)")
    expect(dialog).toHaveTextContent("7 dias anteriores")
    expect(dialog).toHaveTextContent("7m20s")
    // Cobertura em dias ELEGÍVEIS + mínimo do INDICADOR (catálogo: 60%), nunca 40% fixo.
    expect(dialog).toHaveTextContent("5 de 5 dias elegíveis · 100%")
    expect(dialog).toHaveTextContent("Mínimo do indicador: 60% de cobertura")
    expect(dialog).not.toHaveTextContent("mínimo de 40%")

    rerender(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, indicator: "NOTA_URA", groupBy: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("Nota da Pesquisa na URA"))
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Acompanhamento operacional")
  }, 20_000)

  it("cobertura insuficiente pelo mínimo do INDICADOR (1 de 5 = 20% < 60%): 'Sem dados operacionais suficientes' — nunca 0, nunca quartil", async () => {
    const tma = EMPLOYEE_DASHBOARD.indicators[0]!
    const insufficient = { ...tma.operationalTrend!, sufficient: false, current: { ...tma.operationalTrend!.current, daysWithData: 1, coverage: 0.2, sampleCount: 1 }, changePercent: null, performanceChangePercent: null, performanceTrend: null, quartile: { ...tma.operationalTrend!.quartile, quartile: null, position: null, rank: null, reason: "BELOW_MINIMUM_COVERAGE" as const } }
    service.fetchIndicatorDashboard.mockResolvedValue({ ...EMPLOYEE_DASHBOARD, indicators: [{ ...tma, operationalTrend: insufficient }] })
    renderWithQuery(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, indicator: "TMA", groupBy: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Sem dados operacionais suficientes")
    expect(dialog).toHaveTextContent("1 de 5 dias elegíveis · 20%")
    expect(dialog).toHaveTextContent("Mínimo do indicador: 60% de cobertura")
    expect(dialog).not.toHaveTextContent("posição 95 de 108")
    expect(dialog).not.toHaveTextContent("Quartil operacional — últimos 7 dias") // sem dado suficiente não há quartil nenhum a mostrar
    expect(dialog).toHaveTextContent("Quartil oficial")
  }, 20_000)

  it("férias: 'Situação: FÉRIAS' no perfil; janela com dias excluídos mostra cobertura só sobre elegíveis; janela toda em férias = sem dado suficiente, sem quartil", async () => {
    const tma = EMPLOYEE_DASHBOARD.indicators[0]!
    const partial = { ...tma.operationalTrend!, current: { ...tma.operationalTrend!.current, daysWithData: 2, expectedDays: 2, coverage: 1, sampleCount: 2, excludedByStatus: [{ status: "FERIAS", label: "FÉRIAS", days: 3 }] } }
    service.fetchIndicatorDashboard.mockResolvedValue({
      ...EMPLOYEE_DASHBOARD,
      employmentStatus: { status: "FERIAS", label: "FÉRIAS", since: "2026-09-14", sinceInferred: false, until: "2026-09-26", source: "DEMO_SEED", basis: "EXPLICIT_PERIOD", basisLabel: "Período explícito", periodId: "p1", origin: null, freshness: { state: "UNKNOWN", lastSuccessAt: null, cadenceLabel: null, sourceName: null, feedName: null }, history: [], schedule: null },
      indicators: [{ ...tma, operationalTrend: partial }],
    })
    const { rerender } = renderWithQuery(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, indicator: "TMA", groupBy: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    expect(await screen.findByTestId("employment-status")).toHaveTextContent("Situação: FÉRIAS")
    expect(screen.getByTestId("employment-status")).toHaveTextContent("desde 14/09/2026 até 26/09/2026")
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("2 de 2 dias elegíveis · 100%")
    expect(dialog).toHaveTextContent("3 dias em FÉRIAS excluídos")
    expect(dialog).not.toHaveTextContent("2 de 5")

    const whole = { ...partial, sufficient: false, current: { ...partial.current, value: null, daysWithData: 0, expectedDays: 0, coverage: null, sampleCount: 0, excludedByStatus: [{ status: "FERIAS", label: "FÉRIAS", days: 5 }], noEligibleDays: true, unconfirmedDays: 0 }, changePercent: null, performanceChangePercent: null, performanceTrend: null, quartile: { ...partial.quartile, quartile: null, position: null, rank: null, reason: "NO_ELIGIBLE_DAYS" as const } }
    service.fetchIndicatorDashboard.mockResolvedValue({ ...EMPLOYEE_DASHBOARD, indicators: [{ ...tma, operationalTrend: whole }] })
    rerender(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: "2026-08", indicator: "TMA", groupBy: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("Nenhum dia elegível nos últimos 7 dias (10/09/2026 → 16/09/2026) (5 dias em FÉRIAS excluídos)"))
    expect(screen.getByRole("dialog")).toHaveTextContent("Sem dados operacionais suficientes")
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Q4 operacional")
    expect(screen.getByRole("dialog")).toHaveTextContent("Quartil oficial") // oficial intacto
  }, 20_000)

  it("day off + folga + INSS: '4 de 4 dias elegíveis · 100%' com 1 folga agendada, 1 Day off, 1 dia em INSS e 2 medições ignoradas — valor não muda por medição de dia não elegível", async () => {
    const tma = EMPLOYEE_DASHBOARD.indicators[0]!
    const trend = { ...tma.operationalTrend!, current: { ...tma.operationalTrend!.current, daysWithData: 4, expectedDays: 4, coverage: 1, sampleCount: 4, businessDays: 6, calendarDays: 7, excludedByScheduledDayOff: 1, excludedByScheduleException: [{ code: "DAY_OFF", label: "Day off", days: 1 }], excludedByStatus: [{ status: "INSS", label: "INSS", days: 1 }], ignoredMeasurements: 2, schedule: { basis: "EXPLICIT_SCHEDULE" as const, freshness: "FRESH" as const, scheduleType: "SIX_BY_ONE" as const, unconfirmedScheduleDays: 0 } } }
    service.fetchIndicatorDashboard.mockResolvedValue({ ...EMPLOYEE_DASHBOARD, indicators: [{ ...tma, operationalTrend: trend }] })
    renderWithQuery(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, indicator: "TMA", groupBy: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("4 de 4 dias elegíveis · 100%")
    expect(dialog).toHaveTextContent("1 folga agendada")
    expect(dialog).toHaveTextContent("1 Day off")
    expect(dialog).toHaveTextContent("1 dia em INSS excluídos de 7 no calendário")
    expect(dialog).toHaveTextContent("2 medições em dias não elegíveis ignoradas")
  }, 20_000)

  it("sem PRV e sem indicadores: estados vazios explícitos, nunca 0%", async () => {
    service.fetchIndicatorDashboard.mockResolvedValue(EMPTY_EMPLOYEE_DASHBOARD)
    renderWithQuery(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, indicator: null, groupBy: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    expect(await screen.findByText("Não há dados de PRV para setembro 2026.")).toBeInTheDocument()
    expect(screen.getByText("Nenhum indicador disponível no período")).toBeInTheDocument()
    expect(screen.queryByText("0%")).not.toBeInTheDocument()
  })

  it("trocar a competência atualiza só o estado de período (a query é refeita com o novo mês)", async () => {
    service.fetchIndicatorDashboard.mockResolvedValue(EMPLOYEE_DASHBOARD)
    const onStateChange = vi.fn()
    const { rerender } = renderWithQuery(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, indicator: null, groupBy: null }} onStateChange={onStateChange} employeeHref={(id) => `/e/${id}`} />)
    await screen.findByText("Meu PRV")
    rerender(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: "2026-08", indicator: null, groupBy: null }} onStateChange={onStateChange} employeeHref={(id) => `/e/${id}`} />)
    await waitFor(() => expect(service.fetchIndicatorDashboard).toHaveBeenCalledWith(null, "2026-08", null))
  })

  it("comparação operacional configurável: o seletor vai pro estado (URL) e a query é refeita com a comparação; os cards passam a usar os rótulos da comparação vinda do backend", async () => {
    service.fetchIndicatorDashboard.mockResolvedValue(EMPLOYEE_DASHBOARD)
    const onStateChange = vi.fn()
    const { rerender } = renderWithQuery(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, indicator: null, groupBy: null }} onStateChange={onStateChange} employeeHref={(id) => `/e/${id}`} />)
    await screen.findByText("Meu PRV")
    // Padrão: últimos 7 dias × 7 anteriores (comparison null — nem vai na URL nem na query string).
    expect(screen.getByRole("combobox", { name: "Comparação operacional" })).toHaveTextContent("Últimos 7 dias × 7 dias anteriores")
    expect(screen.getByTestId("operational-chip")).toHaveTextContent("Operacional 7d:")
    expect(service.fetchIndicatorDashboard).toHaveBeenCalledWith(null, "2026-09", null)

    const tma = EMPLOYEE_DASHBOARD.indicators[0]!
    const monthly = { ...tma.operationalTrend!, comparison: MONTH_COMPARISON, windowCalendarDays: 16, previousWindowCalendarDays: 31, currentPeriodCalendarDays: 30, current: { ...tma.operationalTrend!.current, label: "01/09/2026 → 16/09/2026" }, previous: { ...tma.operationalTrend!.previous, label: "01/08/2026 → 31/08/2026" } }
    service.fetchIndicatorDashboard.mockResolvedValue({ ...EMPLOYEE_DASHBOARD, indicators: [{ ...tma, operationalTrend: monthly }] })
    rerender(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, comparison: "MONTH", indicator: null, groupBy: null }} onStateChange={onStateChange} employeeHref={(id) => `/e/${id}`} />)
    await waitFor(() => expect(service.fetchIndicatorDashboard).toHaveBeenCalledWith(null, "2026-09", "MONTH"))
    expect(screen.getByRole("combobox", { name: "Comparação operacional" })).toHaveTextContent("Mês corrente (até hoje) × mês anterior")
    // Card compacto: chip com o sufixo da comparação e a variação "vs. o mês anterior"
    await waitFor(() => expect(screen.getByTestId("operational-chip")).toHaveTextContent("Operacional mês:"))
    expect(screen.getByLabelText(/Variação de performance vs\. o mês anterior/)).toBeInTheDocument()

    rerender(<IndicatorsView context={OPERATOR_CONTEXT} state={{ subject: null, period: null, comparison: "MONTH", indicator: "TMA", groupBy: null }} onStateChange={onStateChange} employeeHref={(id) => `/e/${id}`} />)
    const dialog = await screen.findByRole("dialog")
    await waitFor(() => expect(dialog).toHaveTextContent("Mês corrente (até hoje) · 01/09/2026 → 16/09/2026 · 16 de 30 dias — o mês ainda está em curso · calculado pela INIA"))
    expect(dialog).toHaveTextContent("Mês anterior")
    expect(dialog).toHaveTextContent("01/08/2026 → 31/08/2026")
    expect(dialog).toHaveTextContent("Quartil operacional — mês corrente (até hoje)")
    expect(dialog).not.toHaveTextContent("últimos 7 dias")
  }, 20_000)
})

describe("Indicadores — visão STRUCTURE (Supervisor e acima)", () => {
  it("nunca fala em PRV da estrutura: mostra 'Atingimento consolidado', distribuição por quartil e agrupamento", async () => {
    service.fetchIndicatorDashboard.mockResolvedValue(STRUCTURE_DASHBOARD)
    renderWithQuery(<IndicatorsView context={MANAGER_CONTEXT} state={{ subject: null, period: null, indicator: null, groupBy: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    expect(await screen.findByText("Atingimento consolidado")).toBeInTheDocument()
    expect(screen.getByText("87,2%")).toBeInTheDocument()
    expect(screen.queryByText(/^Meu PRV$|^PRV da equipe$|^PRV da estrutura$/)).not.toBeInTheDocument()
    expect(screen.getByText("PRV da equipe por quartil")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /Q1: 1 pessoa, Q2: 1 pessoa, Q3: 0 pessoas, Q4: 1 pessoa/ })).toBeInTheDocument()
    expect(screen.getByText("4 colaboradores")).toBeInTheDocument()
    expect(screen.getByLabelText("Agrupar por")).toBeInTheDocument()
    expect(screen.getByText("Consolidado evoluiu 7,2 p.p. em relação ao período anterior.")).toBeInTheDocument()
    // Resumo operacional pequeno, separado do consolidado oficial e sempre rotulado como operacional.
    expect(screen.getByText(/Acompanhamento operacional · últimos 7 dias/)).toBeInTheDocument()
    expect(screen.getByText("6m51s")).toBeInTheDocument()
    expect(screen.getByText(/3 de 3 elegíveis com dados suficientes · 1 em férias\/afastamento/)).toBeInTheDocument()
    expect(screen.getByText(/3 de 4 colaboradores com ao menos um dia elegível no período — 1 em férias\/afastamento a janela inteira/)).toBeInTheDocument()
    // As duas janelas, cada uma com rótulo, datas e tamanho — nunca "A vs. B" numa linha só.
    const windows = screen.getByTestId("comparison-windows")
    expect(windows).toHaveTextContent("Últimos 7 dias10/09/2026 → 16/09/20267 dias de calendário")
    expect(windows).toHaveTextContent("7 dias anteriores03/09/2026 → 09/09/20267 dias de calendário")
  })

  it("comparação em período civil na estrutura: janela atual mostra '16 de 30 dias — o mês ainda está em curso', anterior mostra 'completo', e o texto avisa que somas não são comparadas", async () => {
    const summary = STRUCTURE_DASHBOARD.operationalSummary!
    service.fetchIndicatorDashboard.mockResolvedValue({
      ...STRUCTURE_DASHBOARD,
      operationalSummary: { ...summary, comparison: MONTH_COMPARISON, windowLabel: "01/09/2026 → 16/09/2026", previousWindowLabel: "01/08/2026 → 31/08/2026", windowCalendarDays: 16, previousWindowCalendarDays: 31, currentPeriodCalendarDays: 30, memberCount: 130, eligibleMemberCount: 130 },
    })
    renderWithQuery(<IndicatorsView context={MANAGER_CONTEXT} state={{ subject: null, period: null, comparison: "MONTH", indicator: null, groupBy: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    expect(await screen.findByText(/Acompanhamento operacional · mês corrente \(até hoje\) × mês anterior/)).toBeInTheDocument()
    const windows = screen.getByTestId("comparison-windows")
    expect(windows).toHaveTextContent("Mês corrente (até hoje)01/09/2026 → 16/09/202616 de 30 dias — o mês ainda está em curso")
    expect(windows).toHaveTextContent("Mês anterior (completo)01/08/2026 → 31/08/202631 dias de calendário")
    expect(screen.getByText(/130 colaboradores, todos com ao menos um dia elegível no período/)).toBeInTheDocument()
    expect(screen.getByText(/somas \(ex\.: volume\) não são comparadas com o período anterior; médias e taxas são/)).toBeInTheDocument()
  })

  it("escolher 'Agrupar por' carrega o breakdown e cada grupo permite drill-down (novo sujeito na URL)", async () => {
    service.fetchIndicatorDashboard.mockResolvedValue(STRUCTURE_DASHBOARD)
    service.fetchStructureBreakdown.mockResolvedValue({
      subject: STRUCTURE_DASHBOARD.subject,
      period: "2026-09",
      groupBy: "SUPERVISOR",
      groupByLabel: "Supervisor",
      groups: [
        { subject: { kind: "SUPERVISOR_TEAM", supervisorId: "sup-1" }, label: "Vanessa Supervisora", description: "Supervisor", memberCount: 2, membersWithData: 2, consolidatedAchievementPercent: 81.1, deltaPp: 14.8, trend: "UP", attentionCount: 2, improvingCount: 0, noDataCount: 0, topAttentionIndicators: [] },
        { subject: null, label: "Sem supervisor", description: "Ligados diretamente à estrutura", memberCount: 1, membersWithData: 0, consolidatedAchievementPercent: null, deltaPp: null, trend: "UNKNOWN", attentionCount: 0, improvingCount: 0, noDataCount: 1, topAttentionIndicators: [] },
      ],
    })
    const onStateChange = vi.fn()
    renderWithQuery(<IndicatorsView context={MANAGER_CONTEXT} state={{ subject: null, period: null, indicator: null, groupBy: "SUPERVISOR" }} onStateChange={onStateChange} employeeHref={(id) => `/e/${id}`} />)
    expect(await screen.findByText("Estrutura por supervisor")).toBeInTheDocument()
    expect(await screen.findByText("Vanessa Supervisora")).toBeInTheDocument()
    expect(screen.getByText("Sem supervisor")).toBeInTheDocument()
    expect(screen.getAllByText("Sem dados").length).toBeGreaterThan(0)
    expect(screen.queryByRole("button", { name: "Analisar Sem supervisor" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Analisar Vanessa Supervisora" }))
    expect(onStateChange).toHaveBeenCalledWith({ subject: { kind: "SUPERVISOR_TEAM", id: "sup-1" }, indicator: null, groupBy: null })
    expect(service.fetchStructureBreakdown).toHaveBeenCalledWith(null, "2026-09", "SUPERVISOR")
  })

  it("breadcrumb do drill-down volta pela cadeia", async () => {
    service.fetchIndicatorDashboard.mockResolvedValue({ ...STRUCTURE_DASHBOARD, breadcrumb: [{ kind: "MANAGER_STRUCTURE", id: "mgr-1", label: "Roberto Gerente" }, { kind: "SUPERVISOR_TEAM", id: "sup-1", label: "Vanessa Supervisora" }] })
    const onStateChange = vi.fn()
    renderWithQuery(<IndicatorsView context={MANAGER_CONTEXT} state={{ subject: { kind: "SUPERVISOR_TEAM", id: "sup-1" }, period: null, indicator: null, groupBy: null }} onStateChange={onStateChange} employeeHref={(id) => `/e/${id}`} />)
    const nav = await screen.findByRole("navigation", { name: "Estrutura em análise" })
    expect(nav).toHaveTextContent("Roberto Gerente")
    expect(nav).toHaveTextContent("Vanessa Supervisora")
    fireEvent.click(screen.getByRole("button", { name: "Roberto Gerente" }))
    expect(onStateChange).toHaveBeenCalledWith({ subject: null, indicator: null, groupBy: null })
  })

  it("403 de escopo vira um estado 'Sem acesso' — nunca um erro genérico", async () => {
    const { ApiError } = await import("@/lib/api/api-client")
    service.fetchIndicatorDashboard.mockRejectedValue(new ApiError("Você não tem acesso a esta estrutura.", 403, "STRUCTURE_ACCESS_DENIED"))
    renderWithQuery(<IndicatorsView context={MANAGER_CONTEXT} state={{ subject: { kind: "SUPERVISOR_TEAM", id: "outro" }, period: null, indicator: null, groupBy: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    expect(await screen.findByText("Sem acesso a esta estrutura")).toBeInTheDocument()
  })

  it("mostra skeleton enquanto carrega, sem bloquear o seletor de competência", () => {
    service.fetchIndicatorDashboard.mockReturnValue(new Promise(() => {}))
    renderWithQuery(<IndicatorsView context={MANAGER_CONTEXT} state={{ subject: null, period: null, indicator: null, groupBy: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    expect(screen.getByLabelText("Período")).toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })
})
