import { describe, expect, it } from "vitest"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import { compareCards, compareFirstAndLastMonth, columnDirection } from "./comparison.js"
import { cardFingerprint, decideDelivery, type SourceState } from "./delivery-decision.js"
import { definitionSignature, reportAudienceSchema, reportDefinitionSchema, reportScheduleSchema, requiredSources, toToolCall } from "./report-definition.js"
import { isScheduleDateDue, latestDueAtOrBefore, nextRunAfter, upcomingRuns } from "./report-schedule.js"
import { buildVisualizationData, compatibleVisualizations, parseCell, suggestVisualization } from "./visualization.js"

const TZ = "America/Sao_Paulo"

function card(columns: [string, string, boolean][], rows: Record<string, string>[], extra: Partial<QueryTableCard> = {}): QueryTableCard {
  return {
    type: "QUERY_TABLE",
    generatedAt: "2026-10-16T12:00:00.000Z",
    structure: { subject: { kind: "SUPERVISOR_TEAM", supervisorId: "00000000-0000-4000-8000-000000000001" }, label: "Equipe", description: null },
    source: "OFFICIAL",
    title: "Pessoas — TMA",
    scopeNote: "Competência oficial: Agosto 2026",
    period: "2026-08",
    indicatorCode: "TMA",
    columns: columns.map(([key, label, numeric]) => ({ key, label, numeric })),
    rows: rows.map((cells) => ({ cells, subject: null, personId: null })),
    totalRows: rows.length,
    highlights: [],
    methods: [],
    limitations: [],
    ...extra,
  }
}

describe("agenda — fuso, dias da semana e meses sem o dia", () => {
  const daily = reportScheduleSchema.parse({ frequency: "DAILY", times: ["08:00"] })

  it("diária às 08:00 no fuso da organização: próximo horário em UTC respeita o fuso (−03:00)", () => {
    expect(nextRunAfter(daily, TZ, new Date("2026-10-16T10:00:00Z"))!.toISOString()).toBe("2026-10-16T11:00:00.000Z")
    expect(nextRunAfter(daily, TZ, new Date("2026-10-16T11:00:00Z"))!.toISOString()).toBe("2026-10-17T11:00:00.000Z")
  })

  it("semanal: só nos dias escolhidos", () => {
    const weekly = reportScheduleSchema.parse({ frequency: "WEEKLY", times: ["07:30"], weekdays: ["MON", "THU"] })
    expect(upcomingRuns(weekly, TZ, new Date("2026-10-16T12:00:00Z"), 3).map((date) => date.toISOString())).toEqual(["2026-10-19T10:30:00.000Z", "2026-10-22T10:30:00.000Z", "2026-10-26T10:30:00.000Z"])
  })

  it("mensal no dia 31: PULAR meses sem o dia ou usar o ÚLTIMO dia — escolha explícita, nunca escorrega para o mês seguinte", () => {
    const skip = reportScheduleSchema.parse({ frequency: "MONTHLY", times: ["09:00"], dayOfMonth: 31, onMissingDay: "SKIP" })
    const lastDay = reportScheduleSchema.parse({ frequency: "MONTHLY", times: ["09:00"], dayOfMonth: 31, onMissingDay: "LAST_DAY" })
    expect(isScheduleDateDue(skip, "2026-11-30")).toBe(false)
    expect(isScheduleDateDue(lastDay, "2026-11-30")).toBe(true)
    expect(isScheduleDateDue(lastDay, "2026-12-30")).toBe(false)
    expect(nextRunAfter(skip, TZ, new Date("2026-11-01T00:00:00Z"))!.toISOString()).toBe("2026-12-31T12:00:00.000Z")
    expect(nextRunAfter(lastDay, TZ, new Date("2027-02-01T00:00:00Z"))!.toISOString()).toBe("2027-02-28T12:00:00.000Z")
    expect(reportScheduleSchema.safeParse({ frequency: "MONTHLY", times: ["09:00"], dayOfMonth: 31 }).success).toBe(false)
  })

  it("atraso longo: só o ÚLTIMO horário vencido (nunca uma avalanche de execuções)", () => {
    expect(latestDueAtOrBefore(daily, TZ, new Date("2026-10-16T15:00:00Z"))!.toISOString()).toBe("2026-10-16T11:00:00.000Z")
    expect(latestDueAtOrBefore(daily, TZ, new Date("2026-10-16T10:59:00Z"))!.toISOString()).toBe("2026-10-15T11:00:00.000Z")
  })
})

describe("definição reproduzível", () => {
  const base = { tool: "INDICATOR_QUERY", structure: { mode: "RECIPIENT" }, period: { mode: "LAST_CLOSED" }, indicators: ["TMA"], groupBy: "PESSOA", sortBy: "ATINGIMENTO", order: "ASC", limit: 3 }

  it("preserva a intenção (ordenação, limite, agrupamento); 'minha equipe' não fixa estrutura e 'última competência' não fixa mês", () => {
    const call = toToolCall(reportDefinitionSchema.parse(base))
    expect(call).toEqual({ name: "leadership_indicator_query", args: { indicadores: ["TMA"], agrupar_por: "PESSOA", ordenar_por: "ATINGIMENTO", ordem: "ASC", limite: 3 } })
  })

  it("estrutura fixa e competência fixa viram argumentos explícitos; a referência da comparação troca só o mês", () => {
    const definition = reportDefinitionSchema.parse({ ...base, structure: { mode: "FIXED", subjectKind: "SUPERVISOR_TEAM", subjectId: "00000000-0000-4000-8000-000000000009", label: "Equipe da Ana" }, period: { mode: "FIXED_MONTH", month: "2026-08" } })
    expect(toToolCall(definition).args).toMatchObject({ subject_kind: "SUPERVISOR_TEAM", subject_id: "00000000-0000-4000-8000-000000000009", competencia: "2026-08" })
    expect(toToolCall(definition, { month: "2026-07" }).args.competencia).toBe("2026-07")
  })

  it("período em curso = medição diária; força de trabalho só com 'hoje'; diagnóstico com um indicador", () => {
    expect(toToolCall(reportDefinitionSchema.parse({ ...base, period: { mode: "CURRENT", window: "MES_CORRENTE" } })).args).toMatchObject({ fonte: "OPERACIONAL", janela: "MES_CORRENTE" })
    expect(reportDefinitionSchema.safeParse({ ...base, tool: "WORKFORCE", period: { mode: "LAST_CLOSED" } }).success).toBe(false)
    expect(reportDefinitionSchema.safeParse({ ...base, tool: "INDICATOR_DIAGNOSIS", indicators: ["TMA", "FCR"] }).success).toBe(false)
  })

  it("fontes necessárias: PRV entra com consolidado/quartil geral; período em curso usa a medição diária", () => {
    expect(requiredSources(reportDefinitionSchema.parse({ ...base, indicators: ["PRV"] }))).toEqual(["PRV_PERFORMANCE"])
    expect(requiredSources(reportDefinitionSchema.parse({ ...base, view: "CONSOLIDADO", indicators: [] }))).toEqual(["OFFICIAL_INDICATOR_PERFORMANCE", "PRV_PERFORMANCE"])
    expect(requiredSources(reportDefinitionSchema.parse({ ...base, period: { mode: "CURRENT", window: "MES_CORRENTE" } }))).toEqual(["INDICATOR_MEASUREMENTS"])
  })

  it("assinatura ignora a ordem dos indicadores e o rótulo da estrutura", () => {
    const a = reportDefinitionSchema.parse({ ...base, indicators: ["TMA", "PRV"] })
    const b = reportDefinitionSchema.parse({ ...base, indicators: ["prv", "TMA"] })
    expect(definitionSignature(a)).toBe(definitionSignature(b))
  })

  it("público de distribuição exige ao menos uma seleção", () => {
    expect(reportAudienceSchema.safeParse({ mode: "DISTRIBUTION" }).success).toBe(false)
    expect(reportAudienceSchema.safeParse({ mode: "DISTRIBUTION", levels: ["SUPERVISOR"] }).success).toBe(true)
  })
})

describe("visualização — valores exatos da aplicação, compatibilidade pelo formato", () => {
  it("lê os formatos da aplicação; '—' é ausência, nunca zero", () => {
    expect(parseCell("80,5%")).toEqual({ value: 80.5, percent: null, unit: "PERCENT" })
    expect(parseCell("2 (40%)")).toEqual({ value: 2, percent: 40, unit: "COUNT" })
    expect(parseCell("1.234")).toEqual({ value: 1234, percent: null, unit: "NUMBER" })
    expect(parseCell("+3,1 p.p.")).toEqual({ value: 3.1, percent: null, unit: "PP" })
    expect(parseCell("452 s").value).toBe(452)
    expect(parseCell("—")).toEqual({ value: null, percent: null, unit: null })
    expect(parseCell("Q4").value).toBeNull()
  })

  it("ranking atual (sem dimensão temporal) não oferece linha/área; quartis oferecem distribuição; mês a mês oferece evolução", () => {
    const ranking = card([["person", "Pessoa", false], ["achievement", "Atingimento", true]], [{ person: "Ana", achievement: "80%" }, { person: "Bia", achievement: "90%" }])
    expect(compatibleVisualizations(ranking)).toEqual(["TABLE", "BAR"])
    expect(buildVisualizationData(ranking, { type: "LINE" })).toMatchObject({ type: "TABLE", fallbackReason: expect.stringContaining("linha") })
    const quartiles = card([["group", "Supervisor", false], ["Q1", "Q1", true], ["Q2", "Q2", true], ["Q3", "Q3", true], ["Q4", "Q4", true]], [{ group: "Sara", Q1: "1 (20%)", Q2: "1 (20%)", Q3: "1 (20%)", Q4: "2 (40%)" }])
    expect(suggestVisualization(quartiles).type).toBe("DISTRIBUTION")
    expect(buildVisualizationData(quartiles, { type: "DISTRIBUTION" }).series.map((series) => series.values[0])).toEqual([20, 20, 20, 40])
    const byMonth = card([["group", "Supervisor", false], ["m0", "% fora jul/26", true], ["m1", "% fora ago/26", true]], [{ group: "Sara", m0: "40%", m1: "—" }])
    const line = buildVisualizationData(byMonth, { type: "LINE" })
    expect(line.categories).toEqual(["jul/26", "ago/26"])
    expect(line.series[0]!.values).toEqual([40, null])
  })

  it("estado vazio é explícito (sem linhas ≠ zero)", () => {
    expect(buildVisualizationData(card([["person", "Pessoa", false], ["achievement", "Atingimento", true]], []), { type: "BAR" }).empty).toBe(true)
  })
})

describe("comparação — períodos equivalentes e semântica de melhora/piora", () => {
  const columns: [string, string, boolean][] = [["group", "Supervisor", false], ["belowPercent", "% fora", true], ["achievement", "Atingimento", true], ["value", "Valor", true]]
  const now = card(columns, [{ group: "Sara", belowPercent: "40%", achievement: "95%", value: "420 s" }, { group: "Saulo", belowPercent: "20%", achievement: "101%", value: "380 s" }])
  const before = card(columns, [{ group: "Sara", belowPercent: "50%", achievement: "92%", value: "450 s" }, { group: "Hugo", belowPercent: "10%", achievement: "100%", value: "300 s" }], { period: "2026-07" })

  it("% fora caindo é MELHORA; atingimento subindo é MELHORA; tempo (menor é melhor) caindo é MELHORA", () => {
    const comparison = compareCards(now, before, { basis: "ago × jul", currentLabel: "Agosto 2026", referenceLabel: "Julho 2026", valueDirection: "LOWER" })
    const sara = comparison.changes.filter((change) => change.row === "Sara")
    expect(sara.map((change) => [change.column, change.delta, change.assessment])).toEqual([["belowPercent", -10, "IMPROVED"], ["achievement", 3, "IMPROVED"], ["value", -30, "IMPROVED"]])
    expect(sara[0]!.deltaPercent).toBe(-20)
  })

  it("composição: linhas que entraram e saíram ficam explícitas (nunca comparadas como se fossem as mesmas)", () => {
    const comparison = compareCards(now, before, { basis: "", currentLabel: "", referenceLabel: "", valueDirection: null })
    expect(comparison.rowsAdded).toEqual(["Saulo"])
    expect(comparison.rowsRemoved).toEqual(["Hugo"])
  })

  it("meta-alvo é neutra; referência vazia = sem histórico (nunca zero)", () => {
    expect(columnDirection("value", "Valor", "TARGET")).toBe("NEUTRAL")
    expect(compareCards(now, card(columns, []), { basis: "", currentLabel: "", referenceLabel: "Julho 2026", valueDirection: null }).status).toBe("NO_HISTORY")
  })

  it("mês a mês: primeira × última competência do próprio conjunto", () => {
    const byMonth = card([["group", "Supervisor", false], ["m0", "% com indicador fora jul/26", true], ["m1", "% com indicador fora ago/26", true]], [{ group: "Sara", m0: "50%", m1: "40%" }])
    expect(compareFirstAndLastMonth(byMonth).changes[0]).toMatchObject({ delta: -10, assessment: "IMPROVED" })
  })
})

describe("regra de atualização das bases", () => {
  const source = (watermark: string | null, stale = false): SourceState => ({ source: "OFFICIAL_INDICATOR_PERFORMANCE", label: "Fechamento oficial", watermark, lastUpdatedAt: null, stale, detail: null })
  const decide = (overrides: Partial<Parameters<typeof decideDelivery>[0]>) => decideDelivery({ coverage: 0.9, sources: [source("v5")], periodKey: "2026-08", fingerprint: "f1", baseline: null, ...overrides })

  it("primeira entrega e competência nova entregam", () => {
    expect(decide({}).kind).toBe("DELIVERY")
    expect(decide({ baseline: { periodKey: "2026-07", fingerprint: "f0", watermarks: { OFFICIAL_INDICATOR_PERFORMANCE: "v5" } } }).kind).toBe("DELIVERY")
  })

  it("mesmo período e base sem atualização → não encaminhado com a mensagem de referência", () => {
    const decision = decide({ baseline: { periodKey: "2026-08", fingerprint: "f0", watermarks: { OFFICIAL_INDICATOR_PERFORMANCE: "v5" } } })
    expect(decision).toMatchObject({ kind: "NOT_FORWARDED", reason: "STALE_SOURCES", message: "Report não encaminhado: as bases necessárias ainda não foram atualizadas para o período configurado." })
  })

  it("base atualizada mas dados idênticos → não encaminhado (sem mudança), nunca entrega repetida", () => {
    expect(decide({ fingerprint: "f1", baseline: { periodKey: "2026-08", fingerprint: "f1", watermarks: { OFFICIAL_INDICATOR_PERFORMANCE: "v4" } } })).toMatchObject({ kind: "NOT_FORWARDED", reason: "NO_CHANGE" })
    expect(decide({ fingerprint: "f2", baseline: { periodKey: "2026-08", fingerprint: "f1", watermarks: { OFFICIAL_INDICATOR_PERFORMANCE: "v4" } } }).kind).toBe("DELIVERY")
  })

  it("cobertura insuficiente e fonte vencida não entregam", () => {
    expect(decide({ coverage: 0.4 })).toMatchObject({ kind: "NOT_FORWARDED", reason: "INSUFFICIENT_COVERAGE" })
    expect(decide({ sources: [source("v5", true)] })).toMatchObject({ kind: "NOT_FORWARDED", reason: "STALE_SOURCES" })
  })

  it("impressão digital ignora o horário de geração", () => {
    const a = card([["person", "Pessoa", false]], [{ person: "Ana" }])
    expect(cardFingerprint(a)).toBe(cardFingerprint({ ...a, generatedAt: "2026-10-17T00:00:00.000Z" }))
  })
})
