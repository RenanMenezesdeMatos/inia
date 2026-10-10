import { describe, expect, it } from "vitest"
import { buildCsv, csvCell } from "./usability-csv.js"
import { countMetric, coverageOf, distribution, percentileCont, rateMetric, rateVariation, volumeVariation } from "./metric-value.js"
import { deriveSessions, splitByDays, unionSeconds, type SessionInputEvent } from "./sessionization.js"
import { comparisonPeriodOf, dayBoundaries, resolvePeriod, rollingWindows } from "./usage-time.js"
import { createRateLimiter, validateClientEvent } from "./ingestion-rules.js"

const TZ = "America/Fortaleza" // UTC−3, sem horário de verão
const at = (iso: string) => new Date(iso)

describe("período no fuso da organização", () => {
  const now = at("2026-10-06T17:30:00Z") // 14:30 local
  it("últimos 7 dias incluem hoje parcial e começam à meia-noite local", () => {
    const period = resolvePeriod({ preset: "LAST_7_DAYS" }, now, TZ)
    expect(period.fromDate).toBe("2026-09-30")
    expect(period.toDate).toBe("2026-10-06")
    expect(period.start.toISOString()).toBe("2026-09-30T03:00:00.000Z")
    expect(period.end).toEqual(now)
    expect(period.includesPartialToday).toBe(true)
  })
  it("data final escolhida inclui o dia civil inteiro ([início, fim) até o início do dia seguinte)", () => {
    const period = resolvePeriod({ preset: "CUSTOM", from: "2026-10-01", to: "2026-10-02" }, now, TZ)
    expect(period.end.toISOString()).toBe("2026-10-03T03:00:00.000Z")
    expect(period.includesPartialToday).toBe(false)
  })
  it("comparação tem a MESMA duração e corta o último dia no mesmo horário quando hoje é parcial", () => {
    const period = resolvePeriod({ preset: "TODAY" }, now, TZ)
    const previous = comparisonPeriodOf(period)
    expect(previous.fromDate).toBe("2026-10-05")
    expect(previous.end.getTime() - previous.start.getTime()).toBe(period.end.getTime() - period.start.getTime())
    expect(previous.partialAligned).toBe(true)
    expect(previous.label).toContain("até 14:30")
  })
  it("recusa intervalo invertido e acima do máximo", () => {
    expect(() => resolvePeriod({ preset: "CUSTOM", from: "2026-10-05", to: "2026-10-01" }, now, TZ)).toThrow()
    expect(() => resolvePeriod({ preset: "CUSTOM", from: "2024-01-01", to: "2026-10-01" }, now, TZ)).toThrow()
  })
  it("janelas móveis de DAU/WAU/MAU", () => {
    expect(rollingWindows("2026-10-06")).toEqual({ dau: { fromDate: "2026-10-06", toDate: "2026-10-06" }, wau: { fromDate: "2026-09-30", toDate: "2026-10-06" }, mau: { fromDate: "2026-09-07", toDate: "2026-10-06" } })
  })
})

describe("valor de métrica: zero × sem dados × não aplicável × parcial", () => {
  const start = at("2026-10-01T03:00:00Z")
  const end = at("2026-10-08T03:00:00Z")
  it("zero com cobertura é 0; sem cobertura é sem dados", () => {
    expect(countMetric("x", 0, coverageOf(at("2026-09-01T00:00:00Z"), start, end))).toMatchObject({ status: "VALUE", value: 0 })
    expect(countMetric("x", 0, coverageOf(null, start, end))).toMatchObject({ status: "NO_DATA", value: null })
    expect(countMetric("x", 4, coverageOf(at("2026-10-03T00:00:00Z"), start, end))).toMatchObject({ status: "PARTIAL", value: 4 })
  })
  it("taxa com base zero é não aplicável; variação de taxa em p.p., de volume em %", () => {
    const full = coverageOf(at("2026-01-01T00:00:00Z"), start, end)
    expect(rateMetric("r", 0, 0, full)).toMatchObject({ status: "NOT_APPLICABLE", value: null })
    expect(rateMetric("r", 3, 4, full, { numerator: 1, denominator: 2, coverage: full }).variation).toMatchObject({ kind: "PERCENTAGE_POINTS", value: 25 })
    expect(volumeVariation(10, 0)).toMatchObject({ status: "NO_BASE", value: null })
    expect(volumeVariation(15, 10)).toMatchObject({ kind: "PERCENT", value: 50 })
    expect(rateVariation(null, 40)).toMatchObject({ status: "NOT_APPLICABLE" })
  })
  it("percentil do conjunto (nunca média de percentis)", () => {
    const a = [1, 2, 3, 4]
    const b = [100, 200]
    expect(percentileCont([...a, ...b], 0.95)).toBeCloseTo(175)
    expect(((percentileCont(a, 0.95) ?? 0) + (percentileCont(b, 0.95) ?? 0)) / 2).not.toBeCloseTo(175)
    expect(distribution([])).toEqual({ count: 0, mean: null, median: null, p95: null })
  })
})

const ev = (usageSessionId: string, iso: string, extra: Partial<SessionInputEvent> = {}): SessionInputEvent => ({ usageSessionId, occurredAt: at(iso), activityAt: at(iso), logout: false, admin: false, ...extra })

describe("sessão de uso", () => {
  const now = at("2026-10-06T23:00:00Z")
  it("três telas, dez cliques e um reload = UM acesso", () => {
    const events = Array.from({ length: 14 }, (_, index) => ev("s1", new Date(Date.parse("2026-10-06T12:00:00Z") + index * 30_000).toISOString()))
    expect(deriveSessions(events, now)).toHaveLength(1)
  })
  it("outra aba do mesmo navegador compartilha a sessão; outro dispositivo cria outra", () => {
    const sameBrowser = [ev("s1", "2026-10-06T12:00:00Z"), ev("s1", "2026-10-06T12:00:05Z")]
    expect(deriveSessions([...sameBrowser, ev("s2", "2026-10-06T12:01:00Z")], now)).toHaveLength(2)
    expect(deriveSessions(sameBrowser, now)).toHaveLength(1)
  })
  it("ação depois de 30 min sem atividade abre nova sessão; heartbeat sozinho não impede a expiração", () => {
    const events = [ev("s1", "2026-10-06T12:00:00Z"), ev("s1", "2026-10-06T12:20:00Z", { activityAt: null }), ev("s1", "2026-10-06T12:31:00Z")]
    const sessions = deriveSessions(events, now)
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({ endReason: "INACTIVITY_INFERRED" })
  })
  it("logout encerra; atividade seguinte é outra sessão", () => {
    const sessions = deriveSessions([ev("s1", "2026-10-06T12:00:00Z"), ev("s1", "2026-10-06T12:05:00Z", { activityAt: null, logout: true }), ev("s1", "2026-10-06T12:06:00Z")], now)
    expect(sessions.map((session) => session.endReason)).toEqual(["LOGOUT", "INACTIVITY_INFERRED"])
  })
  it("sessão ainda dentro da janela fica aberta", () => {
    expect(deriveSessions([ev("s1", "2026-10-06T22:50:00Z")], now)[0]).toMatchObject({ endReason: "OPEN" })
  })
})

describe("tempo ativo observado", () => {
  it("abas/dispositivos simultâneos contam uma vez (união)", () => {
    const spans = [
      { start: at("2026-10-06T12:00:00Z"), end: at("2026-10-06T12:00:15Z") },
      { start: at("2026-10-06T12:00:10Z"), end: at("2026-10-06T12:00:25Z") },
    ]
    expect(unionSeconds(spans)).toBe(25)
  })
  it("atividade atravessando a meia-noite é dividida entre os dias no fuso escolhido", () => {
    const days = dayBoundaries("2026-10-05", "2026-10-06", TZ)
    const split = splitByDays({ start: at("2026-10-06T02:59:50Z"), end: at("2026-10-06T03:00:05Z") }, days)
    expect(split.get("2026-10-05")).toBe(10)
    expect(split.get("2026-10-06")).toBe(5)
  })
})

describe("validação da ingestão", () => {
  const receivedAt = at("2026-10-06T12:00:10Z")
  const base = { eventId: "11111111-1111-4111-8111-111111111111", schemaVersion: 1, occurredAt: "2026-10-06T12:00:00Z", usageSessionId: "22222222-2222-4222-8222-222222222222", tabId: "33333333-3333-4333-8333-333333333333", screenInstanceId: "44444444-4444-4444-8444-444444444444", entity: null, correlationId: null }
  const view = { ...base, name: "screen.viewed", screenKey: "my_profile.operator.followup", elementKey: null, routeTemplate: "/operator", properties: { kind: "TAB", navigation: "INITIAL", entry: true } }
  it("aceita tela do catálogo na rota certa", () => {
    expect(validateClientEvent(view, { receivedAt, clockOffsetMs: 0 }).ok).toBe(true)
  })
  it("recusa propriedade fora do esquema, tela desconhecida e rota trocada", () => {
    expect(validateClientEvent({ ...view, properties: { ...view.properties, text: "conteúdo" } }, { receivedAt, clockOffsetMs: 0 })).toMatchObject({ ok: false, reason: "INVALID_PROPERTIES" })
    expect(validateClientEvent({ ...view, screenKey: "tela.inventada" }, { receivedAt, clockOffsetMs: 0 })).toMatchObject({ ok: false, reason: "UNKNOWN_SCREEN" })
    expect(validateClientEvent({ ...view, routeTemplate: "/supervisor" }, { receivedAt, clockOffsetMs: 0 })).toMatchObject({ ok: false, reason: "ROUTE_MISMATCH" })
  })
  it("relógio do cliente adiantado é corrigido e marcado; futuro e expirado são recusados; atrasado mantém o horário do fato", () => {
    const corrected = validateClientEvent({ ...view, occurredAt: "2026-10-06T12:10:00Z" }, { receivedAt, clockOffsetMs: -600_000 })
    expect(corrected).toMatchObject({ ok: true, event: { timestampStatus: "CLIENT_CLOCK_CORRECTED" } })
    expect(validateClientEvent({ ...view, occurredAt: "2026-10-06T13:00:00Z" }, { receivedAt, clockOffsetMs: 0 })).toMatchObject({ ok: false, reason: "TIMESTAMP_IN_FUTURE" })
    expect(validateClientEvent({ ...view, occurredAt: "2026-10-01T12:00:00Z" }, { receivedAt, clockOffsetMs: 0 })).toMatchObject({ ok: false, reason: "TIMESTAMP_TOO_OLD" })
    const late = validateClientEvent({ ...view, occurredAt: "2026-10-06T10:00:00Z" }, { receivedAt, clockOffsetMs: 0 })
    expect(late).toMatchObject({ ok: true, event: { timestampStatus: "LATE" } })
    if (late.ok) expect(late.event.effectiveOccurredAt.toISOString()).toBe("2026-10-06T10:00:00.000Z")
  })
  it("heartbeat acima de 20 s é intervalo inválido", () => {
    const heartbeat = { ...base, name: "activity.heartbeat", screenKey: "home", elementKey: null, routeTemplate: "/", properties: { spanStart: "2026-10-06T11:59:00Z", spanEnd: "2026-10-06T12:00:00Z", reason: "INTERACTION", lastInteractionAt: null } }
    expect(validateClientEvent(heartbeat, { receivedAt, clockOffsetMs: 0 })).toMatchObject({ ok: false, reason: "INVALID_SPAN" })
  })
  it("limite de frequência por conta", () => {
    const limiter = createRateLimiter(3)
    expect(limiter.take("a", 2, receivedAt)).toBe(2)
    expect(limiter.take("a", 2, receivedAt)).toBe(1)
    expect(limiter.take("b", 2, receivedAt)).toBe(2)
  })
})

describe("CSV para planilha brasileira", () => {
  it("separador ;, decimal com vírgula, escape e neutralização de fórmula", () => {
    expect(csvCell(12.5)).toBe("12,5")
    expect(csvCell('a;b"c')).toBe('"a;b""c"')
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`)
    expect(csvCell("-2+3")).toBe(`"'-2+3"`)
  })
  it("começa com BOM e metadados do recorte", () => {
    const csv = buildCsv({ title: "Pessoas", period: "01/10 a 07/10", timeZone: TZ, filters: "nenhum", definitionsVersion: "V1", coverage: "completa", generatedAt: at("2026-10-06T12:00:00Z") }, ["Nome"], [["Ana"]])
    expect(csv.startsWith("﻿Monitoria de usabilidade")).toBe(true)
    expect(csv).toContain("Gerado em;06/10/2026 09:00:00 (America/Fortaleza)")
  })
})
