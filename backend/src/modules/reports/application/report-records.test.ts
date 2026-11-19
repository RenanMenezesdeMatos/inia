import { describe, expect, it } from "vitest"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import { recordPeriodFromArgs, reportAnalysisSchema, reportDefinitionSchema, reportScheduleSchema, reportVisualizationSchema, resolveRecordPeriod, toToolCall, type ReportDefinition } from "../domain/report-definition.js"
import { staticCompatibility } from "../domain/visualization.js"
import { createFakeRuntime, createMemoryReportStore, testStructure, type FakePerson } from "../testing/memory-report-store.js"
import { executeReportRun } from "./report-executor.js"
import { draftFromToolCall, REPORTABLE_TOOL_NAMES } from "./report-proposals.js"
import { processRun } from "./report-scheduler.js"

/**
 * Reports sobre as ferramentas novas da liderança: span de controle e consultas de REGISTROS (motor FACT_QUERY_V1). O período da
 * consulta do chat vira regra relativa na definição e é reescrito em `competencia` ou `data_inicio`/`data_fim` a cada execução.
 */
const ORG = "00000000-0000-4000-8000-0000000000aa"
const OWN = { kind: "SUPERVISOR_TEAM", supervisorId: "00000000-0000-4000-8000-000000000001" }
const SARA = testStructure("sara", "Equipe da Sara", ["op1", "op2"])
const context = { ownSubject: OWN, lastClosedPeriod: "2026-09", today: "2026-10-16", question: "Quantos atendimentos por supervisor no último mês?", indicatorCode: () => null }

function factCard(extra: Partial<QueryTableCard> = {}): QueryTableCard {
  return {
    type: "QUERY_TABLE", generatedAt: "", structure: { subject: OWN as never, label: "Minha equipe", description: null }, source: "OFFICIAL", title: "Atendimentos por supervisor", scopeNote: "Mês 09/2026 (última competência fechada)", period: null, indicatorCode: null,
    columns: [{ key: "group", label: "Supervisor", numeric: false }, { key: "people", label: "Pessoas", numeric: true }, { key: "records", label: "Registros", numeric: true }, { key: "ATENDIMENTOS_POR_PESSOA_MEDIA", label: "Atendimentos por pessoa — Média", numeric: true }],
    rows: [{ cells: { group: "Sara", people: "2", records: "40", ATENDIMENTOS_POR_PESSOA_MEDIA: "20" }, subject: null, personId: null }], totalRows: 1, highlights: [], methods: [], limitations: [], ...extra,
  }
}

describe("proposta no chat — ferramentas novas", () => {
  it("\"quantos atendimentos por supervisor no último mês\": registros, último mês fechado RELATIVO, parâmetros da consulta preservados", () => {
    const draft = draftFromToolCall("leadership_interactions", { agrupar_por: "SUPERVISOR", medidas: ["ATENDIMENTOS_POR_PESSOA"], estatisticas: ["TOTAL", "MEDIA"] }, factCard(), context)!
    expect(draft.definition).toMatchObject({ tool: "INTERACTIONS", structure: { mode: "RECIPIENT" }, period: { mode: "LAST_CLOSED" }, queryArgs: { agrupar_por: "SUPERVISOR", medidas: ["ATENDIMENTOS_POR_PESSOA"], estatisticas: ["TOTAL", "MEDIA"] } })
    expect(draft.description).toBe("Quantos atendimentos por supervisor no último mês?")
    // A competência explícita do mês fechado mais recente também é "último mês fechado" (relativo), nunca fixa.
    expect(draftFromToolCall("leadership_interactions", { agrupar_por: "SUPERVISOR", competencia: "2026-09" }, factCard(), context)!.definition.period).toEqual({ mode: "LAST_CLOSED" })
  })

  it("estrutura e período nunca ficam nos parâmetros; mês antigo fica fixo; mês em curso vira calendário", () => {
    const draft = draftFromToolCall("leadership_monitoring", { estrutura: "Equipe da Sara", agrupar_por: "CRITERIO", competencia: "2026-03", data_x: undefined }, factCard(), context)!
    expect(draft.definition.queryArgs).toEqual({ agrupar_por: "CRITERIO" })
    expect(draft.definition.period).toEqual({ mode: "FIXED_MONTH", month: "2026-03" })
    expect(draftFromToolCall("leadership_schedule", { competencia: "2026-10" }, factCard(), context)!.definition.period).toEqual({ mode: "CALENDAR", unit: "MONTH", offset: 0 })
    expect(draftFromToolCall("leadership_schedule", { competencia: "2026-11" }, factCard(), context)!.definition.period).toEqual({ mode: "CALENDAR", unit: "MONTH", offset: 1 })
  })

  it("datas viram janela relativa quando são relativas a hoje: últimos 7 dias, semana passada, esta semana até hoje, amanhã; datas antigas ficam fixas", () => {
    const period = (args: Record<string, unknown>) => draftFromToolCall("leadership_workday", { agrupar_por: "DIA", ...args }, factCard(), context)!.definition.period
    // 16/10/2026 é sexta-feira.
    expect(period({ data_inicio: "2026-10-09", data_fim: "2026-10-15" })).toEqual({ mode: "RELATIVE_DAYS", fromOffset: -7, toOffset: -1 })
    expect(period({ data_inicio: "2026-10-10", data_fim: "2026-10-16" })).toEqual({ mode: "RELATIVE_DAYS", fromOffset: -6, toOffset: 0 })
    expect(period({ data_inicio: "2026-10-05", data_fim: "2026-10-11" })).toEqual({ mode: "CALENDAR", unit: "WEEK", offset: -1 })
    expect(period({ data_inicio: "2026-10-12", data_fim: "2026-10-16" })).toEqual({ mode: "CALENDAR", unit: "WEEK", offset: 0, toDate: true })
    expect(period({ data_inicio: "2026-10-17", data_fim: "2026-10-17" })).toEqual({ mode: "RELATIVE_DAYS", fromOffset: 1, toOffset: 1 })
    expect(period({ data_inicio: "2026-09-01", data_fim: "2026-09-30" })).toEqual({ mode: "CALENDAR", unit: "MONTH", offset: -1 })
    expect(period({ data_inicio: "2026-08-03", data_fim: "2026-08-14" })).toEqual({ mode: "FIXED_DATES", from: "2026-08-03", to: "2026-08-14" })
  })

  it("span de controle: organograma na data da execução, parâmetros do span preservados", () => {
    const draft = draftFromToolCall("leadership_span", { por: "GRUPO", nivel: "SUPERVISOR", estrutura: "minha" }, factCard({ title: "Span de controle por Grupo" }), context)!
    expect(draft.definition).toMatchObject({ tool: "SPAN", structure: { mode: "RECIPIENT" }, period: { mode: "TODAY" }, queryArgs: { por: "GRUPO", nivel: "SUPERVISOR" } })
    expect(toToolCall(draft.definition)).toEqual({ name: "leadership_span", args: { por: "GRUPO", nivel: "SUPERVISOR" } })
  })

  it("lista do chat: todas as ferramentas com dado próprio; a calculadora nunca vira report", () => {
    for (const name of ["leadership_span", "leadership_interactions", "leadership_monitoring", "leadership_feedbacks", "leadership_cases", "leadership_schedule", "leadership_workday", "leadership_communications", "leadership_inia_usage", "leadership_support", "leadership_indicator_query"]) expect(REPORTABLE_TOOL_NAMES).toContain(name)
    expect(REPORTABLE_TOOL_NAMES).not.toContain("leadership_calculate")
    expect(draftFromToolCall("leadership_calculate", { calculos: [] }, factCard(), context)).toBeNull()
  })

  it("visualização sugerida só quando a definição a sustenta (registros por dia = evolução; estrutura inteira = resumo)", () => {
    const byDay = reportDefinitionSchema.parse({ tool: "INTERACTIONS", structure: { mode: "RECIPIENT" }, period: { mode: "RELATIVE_DAYS", fromOffset: -7, toOffset: -1 }, queryArgs: { agrupar_por: "DIA" } })
    expect(staticCompatibility(byDay)).toEqual(expect.arrayContaining(["TABLE", "BAR", "LINE", "AREA"]))
    expect(staticCompatibility({ ...byDay, queryArgs: {} })).toContain("KPI")
  })
})

describe("definição — regras do período e dos parâmetros", () => {
  const base = { structure: { mode: "RECIPIENT" } }
  it("registros aceitam mês ou datas; span só a data da execução; período por datas não vale para indicadores", () => {
    expect(reportDefinitionSchema.safeParse({ ...base, tool: "INTERACTIONS", period: { mode: "LAST_N_CLOSED", months: 3, display: "MEDIA" } }).success).toBe(false)
    expect(reportDefinitionSchema.safeParse({ ...base, tool: "INTERACTIONS", period: { mode: "TODAY" } }).success).toBe(false)
    expect(reportDefinitionSchema.safeParse({ ...base, tool: "SPAN", period: { mode: "LAST_CLOSED" } }).success).toBe(false)
    expect(reportDefinitionSchema.safeParse({ ...base, tool: "INDICATOR_QUERY", period: { mode: "RELATIVE_DAYS", fromOffset: -7, toOffset: -1 } }).success).toBe(false)
    expect(reportDefinitionSchema.safeParse({ ...base, tool: "CASES", period: { mode: "CALENDAR", unit: "WEEK", offset: -1, toDate: true } }).success).toBe(false)
    expect(reportDefinitionSchema.safeParse({ ...base, tool: "CASES", period: { mode: "LAST_CLOSED" }, queryArgs: { competencia: "2026-01" } }).success).toBe(false)
    expect(reportDefinitionSchema.safeParse({ ...base, tool: "INDICATOR_QUERY", period: { mode: "LAST_CLOSED" }, queryArgs: { agrupar_por: "PESSOA" } }).success).toBe(false)
  })

  it("resolução a cada execução: mês, semana, dias e as referências equivalentes da comparação", () => {
    const at = (period: ReportDefinition["period"], today = "2026-10-16") => resolveRecordPeriod(period, { today, lastClosedPeriod: "2026-09" })
    expect(at({ mode: "LAST_CLOSED" })).toMatchObject({ month: "2026-09", key: "2026-09", label: "Setembro 2026", reference: { month: "2026-08" } })
    expect(at({ mode: "CALENDAR", unit: "WEEK", offset: -1 })).toMatchObject({ dates: { from: "2026-10-05", to: "2026-10-11" }, reference: { dates: { from: "2026-09-28", to: "2026-10-04" } } })
    expect(at({ mode: "CALENDAR", unit: "WEEK", offset: 0, toDate: true })).toMatchObject({ dates: { from: "2026-10-12", to: "2026-10-16" }, reference: { dates: { from: "2026-10-05", to: "2026-10-09" } } })
    expect(at({ mode: "CALENDAR", unit: "MONTH", offset: 0, toDate: true }, "2026-03-31")).toMatchObject({ dates: { from: "2026-03-01", to: "2026-03-31" }, reference: { dates: { from: "2026-02-01", to: "2026-02-28" } } })
    expect(at({ mode: "CALENDAR", unit: "MONTH", offset: 0 }, "2027-01-05")).toMatchObject({ month: "2027-01", reference: { month: "2026-12" } })
    expect(at({ mode: "RELATIVE_DAYS", fromOffset: -7, toOffset: -1 })).toMatchObject({ dates: { from: "2026-10-09", to: "2026-10-15" }, key: "2026-10-09..2026-10-15", label: "09/10/2026 a 15/10/2026", reference: { dates: { from: "2026-10-02", to: "2026-10-08" } } })
    expect(recordPeriodFromArgs({}, { today: "2026-10-16", lastClosedPeriod: "2026-09" })).toEqual({ mode: "LAST_CLOSED" })
  })
})

describe("execução agendada — ferramentas novas", () => {
  const sara: FakePerson = { accountId: "acc-sara", personId: "p-sara", name: "Sara", role: "SUPERVISOR", active: true, own: SARA, reachable: {}, level: "SUPERVISOR" }

  async function setup(definition: unknown, card: (args: Record<string, unknown>) => QueryTableCard) {
    const memory = createMemoryReportStore()
    const fake = createFakeRuntime({ people: [sara], card: (_label, args) => card(args), sources: () => [{ source: "PLATFORM_RECORDS", label: "Registros", watermark: `checked:${Math.random()}`, lastUpdatedAt: null, stale: false, detail: null }], coverage: () => null })
    const report = await memory.store.createReport(
      {
        organizationId: ORG, ownerAccountId: sara.accountId, ownerPersonId: sara.personId, name: "Report", description: null, status: "ACTIVE", origin: "CHAT", timeZone: "America/Sao_Paulo", nextRunAt: null, sourceProposalId: null,
        definition: reportDefinitionSchema.parse(definition), visualization: reportVisualizationSchema.parse({ type: "TABLE" }), schedule: reportScheduleSchema.parse({ frequency: "DAILY", times: ["08:00"] }), audience: { mode: "SELF" }, analysis: reportAnalysisSchema.parse({}),
      },
      sara.accountId,
    )
    let slot = 0
    const run = async (now: string) => {
      const queued = (await memory.store.enqueueRun({ organizationId: ORG, reportId: report.id, scheduledFor: new Date(Date.UTC(2026, 9, 16 + slot++, 11)).toISOString(), triggerKind: "SCHEDULE", configVersion: 1 }))!
      // O caminho do worker: `processRun` → `executeReportRun`.
      return processRun({ store: memory.store, runtime: fake.runtime, now: () => new Date(now) }, queued)
    }
    return { memory, fake, run }
  }

  it("atendimentos por supervisor no último mês: competência reescrita a cada execução, comparação com o mês anterior", async () => {
    const { memory, fake, run } = await setup({ tool: "INTERACTIONS", structure: { mode: "RECIPIENT" }, period: { mode: "LAST_CLOSED" }, queryArgs: { agrupar_por: "SUPERVISOR", medidas: ["ATENDIMENTOS_POR_PESSOA"] } }, (args) =>
      factCard({ rows: [{ cells: { group: "Sara", people: "2", records: args.competencia === "2026-08" ? "30" : "40", ATENDIMENTOS_POR_PESSOA_MEDIA: args.competencia === "2026-08" ? "15" : "20" }, subject: null, personId: null }] }),
    )
    expect(await run("2026-10-16T11:00:00Z")).toBe("COMPLETED")
    expect(fake.calls.map((call) => call.name)).toEqual(["leadership_interactions", "leadership_interactions"])
    expect(fake.calls[0]!.args).toEqual({ agrupar_por: "SUPERVISOR", medidas: ["ATENDIMENTOS_POR_PESSOA"], competencia: "2026-09" })
    expect(fake.calls[1]!.args.competencia).toBe("2026-08")
    const delivery = memory.deliveries[0]!
    expect(delivery).toMatchObject({ kind: "DELIVERY", periodKey: "2026-09", periodLabel: "Setembro 2026", structureLabel: "Equipe da Sara" })
    expect(delivery.comparison).toMatchObject({ status: "COMPARED", currentLabel: "Setembro 2026", referenceLabel: "Agosto 2026" })
    expect(delivery.comparison!.changes.find((change) => change.column === "records")).toMatchObject({ delta: 10, assessment: "NEUTRAL" })
  })

  it("últimos 7 dias até ontem: as datas andam com a data da execução (fuso da organização) e cada janela é uma entrega", async () => {
    const { memory, fake, run } = await setup({ tool: "INTERACTIONS", structure: { mode: "RECIPIENT" }, period: { mode: "RELATIVE_DAYS", fromOffset: -7, toOffset: -1 }, queryArgs: { agrupar_por: "DIA" } }, () => factCard())
    expect(await run("2026-10-16T11:00:00Z")).toBe("COMPLETED")
    // 02:30 UTC de 17/10 ainda é 16/10 em São Paulo: mesma janela; o resultado igual não vira outra entrega.
    expect(await run("2026-10-17T02:30:00Z")).toBe("NOT_FORWARDED")
    expect(await run("2026-10-17T11:00:00Z")).toBe("COMPLETED")
    // Execução 1: consulta + referência (7 dias antes); execução 2: só a consulta (não encaminhada); execução 3: consulta + referência.
    expect(fake.calls.map((call) => [call.args.data_inicio, call.args.data_fim])).toEqual([["2026-10-09", "2026-10-15"], ["2026-10-02", "2026-10-08"], ["2026-10-09", "2026-10-15"], ["2026-10-10", "2026-10-16"], ["2026-10-03", "2026-10-09"]])
    expect(memory.deliveries.map((item) => [item.kind, item.periodKey])).toEqual([["DELIVERY", "2026-10-09..2026-10-15"], ["NOT_FORWARDED", "2026-10-09..2026-10-15"], ["DELIVERY", "2026-10-10..2026-10-16"]])
    expect(memory.deliveries[1]).toMatchObject({ reason: "NO_CHANGE" })
    expect(memory.deliveries[0]!.comparison).toMatchObject({ referenceLabel: "02/10/2026 a 08/10/2026" })
  })

  it("span de controle: sem período nos argumentos, organograma da data da execução, comparação com a entrega anterior", async () => {
    let operators = "25"
    const spanCard = () => factCard({ title: "Span de controle por Grupo", scopeNote: "Organograma vigente", columns: [{ key: "group", label: "Grupo", numeric: false }, { key: "leaders", label: "Supervisores", numeric: true }, { key: "operators", label: "Operadores", numeric: true }], rows: [{ cells: { group: "B2B", leaders: "1", operators }, subject: null, personId: null }] })
    const { memory, fake, run } = await setup({ tool: "SPAN", structure: { mode: "RECIPIENT" }, period: { mode: "TODAY" }, queryArgs: { por: "GRUPO", nivel: "SUPERVISOR" } }, spanCard)
    expect(await run("2026-10-16T11:00:00Z")).toBe("COMPLETED")
    operators = "27"
    expect(await run("2026-10-17T11:00:00Z")).toBe("COMPLETED")
    expect(fake.calls.map((call) => call.args)).toEqual([{ por: "GRUPO", nivel: "SUPERVISOR" }, { por: "GRUPO", nivel: "SUPERVISOR" }])
    expect(memory.deliveries.map((item) => [item.periodKey, item.periodLabel])).toEqual([["2026-10-16", "Organograma em 16/10/2026"], ["2026-10-17", "Organograma em 17/10/2026"]])
    expect(memory.deliveries[0]!.comparison).toMatchObject({ status: "NO_HISTORY" })
    expect(memory.deliveries[1]!.comparison!.changes.find((change) => change.column === "operators")).toMatchObject({ delta: 2 })
  })

  it("estrutura fixa: o sujeito vai junto dos parâmetros; executar direto dá o mesmo resultado que pelo worker", async () => {
    const fixed: FakePerson = { ...sara, reachable: {} }
    const memory = createMemoryReportStore()
    const fake = createFakeRuntime({ people: [fixed], card: () => factCard() })
    const report = await memory.store.createReport(
      {
        organizationId: ORG, ownerAccountId: fixed.accountId, ownerPersonId: fixed.personId, name: "Feedbacks", description: null, status: "ACTIVE", origin: "SCREEN", timeZone: "America/Sao_Paulo", nextRunAt: null, sourceProposalId: null,
        definition: reportDefinitionSchema.parse({ tool: "FEEDBACKS", structure: { mode: "FIXED", subjectKind: "SUPERVISOR_TEAM", subjectId: "00000000-0000-4000-8000-0000000000a1", label: "Equipe da Ana" }, period: { mode: "CALENDAR", unit: "WEEK", offset: -1 }, queryArgs: { agrupar_por: "PESSOA" } }),
        visualization: reportVisualizationSchema.parse({ type: "TABLE" }), schedule: reportScheduleSchema.parse({ frequency: "WEEKLY", times: ["08:00"], weekdays: ["MON"] }), audience: { mode: "SELF" }, analysis: reportAnalysisSchema.parse({ comparison: false }),
      },
      fixed.accountId,
    )
    fixed.reachable = { "00000000-0000-4000-8000-0000000000a1": testStructure("ana", "Equipe da Ana", ["op5"]) }
    const queued = (await memory.store.enqueueRun({ organizationId: ORG, reportId: report.id, scheduledFor: "2026-10-19T11:00:00.000Z", triggerKind: "SCHEDULE", configVersion: 1 }))!
    const result = await executeReportRun({ store: memory.store, runtime: fake.runtime, now: () => new Date("2026-10-19T11:00:00Z") }, queued)
    expect(result.status).toBe("COMPLETED")
    expect(fake.calls[0]!.args).toEqual({ agrupar_por: "PESSOA", subject_kind: "SUPERVISOR_TEAM", subject_id: "00000000-0000-4000-8000-0000000000a1", data_inicio: "2026-10-12", data_fim: "2026-10-18" })
    expect(memory.deliveries[0]).toMatchObject({ periodLabel: "12/10/2026 a 18/10/2026", comparison: { status: "DISABLED" } })
  })
})
