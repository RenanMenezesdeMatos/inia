import { describe, expect, it } from "vitest"
import { resolveWorkdayDataAvailability, type AvailabilitySourceInput } from "./workday-data-availability.js"

const TZ = "America/Sao_Paulo"
const source = (partial: Partial<AvailabilitySourceInput> & Pick<AvailabilitySourceInput, "key" | "group">): AvailabilitySourceInput => ({
  label: partial.key,
  policy: { lagDays: 1, availableByLocalTime: "11:00" },
  lastSuccessAt: new Date("2026-09-18T11:30:00-03:00"),
  lastDataLocalDate: "2026-09-17",
  freshness: "FRESH",
  lastErrorCode: null,
  ...partial,
})
const evidence = { interactions: true, indicatorCodes: ["PRODUCAO", "QUALIDADE"] }

describe("disponibilidade dos dados de um dia de trabalho (organização, por data)", () => {
  it("todas as fontes relevantes fechadas e entregues → READY", () => {
    const day = resolveWorkdayDataAvailability({ date: "2026-09-17", now: new Date("2026-09-18T12:00:00-03:00"), timeZone: TZ, evidenceSources: evidence, sources: [source({ key: "interactions", group: "WORK_ACTIVITY" }), source({ key: "PRODUCAO", group: "WORK_ACTIVITY" }), source({ key: "rh", group: "EMPLOYMENT" })] })
    expect(day).toMatchObject({ state: "READY", decidedBy: null, workActivity: { state: "READY" }, employment: { state: "READY" } })
  })

  it("Indicador A D+1 10:00 e Indicador B D+2 08:00: em D+1 12:00 o dia ainda AGUARDA (o último prazo relevante decide)", () => {
    const day = resolveWorkdayDataAvailability({
      date: "2026-09-17",
      now: new Date("2026-09-18T12:00:00-03:00"),
      timeZone: TZ,
      evidenceSources: evidence,
      sources: [source({ key: "A", group: "WORK_ACTIVITY", policy: { lagDays: 1, availableByLocalTime: "10:00" } }), source({ key: "B", group: "WORK_ACTIVITY", policy: { lagDays: 2, availableByLocalTime: "08:00" }, lastDataLocalDate: "2026-09-16" })],
    })
    expect(day).toMatchObject({ state: "WAITING_FOR_SOURCES", decidedBy: "WORK_ACTIVITY" })
    expect(day.workActivity.expectedAt).toBe(new Date("2026-09-19T08:00:00-03:00").toISOString())
    expect(day.sources.map((entry) => entry.state)).toEqual(["READY", "WAITING"])
  })

  it("prazo vencido e feed sem carga após ele → DATA_SOURCE_DELAY (alerta de fonte, não falta)", () => {
    const day = resolveWorkdayDataAvailability({ date: "2026-09-17", now: new Date("2026-09-18T12:00:00-03:00"), timeZone: TZ, evidenceSources: evidence, sources: [source({ key: "interactions", group: "WORK_ACTIVITY", lastSuccessAt: new Date("2026-09-18T08:00:00-03:00"), lastDataLocalDate: "2026-09-16", freshness: "STALE" })] })
    expect(day).toMatchObject({ state: "DATA_SOURCE_DELAY", decidedBy: "WORK_ACTIVITY" })
  })

  it("produção fechou mas RH é D-2 e ainda está no prazo → WAITING (RH) — ninguém é cobrado", () => {
    const day = resolveWorkdayDataAvailability({ date: "2026-09-17", now: new Date("2026-09-18T12:00:00-03:00"), timeZone: TZ, evidenceSources: evidence, sources: [source({ key: "prod", group: "WORK_ACTIVITY" }), source({ key: "rh", group: "EMPLOYMENT", policy: { lagDays: 2, availableByLocalTime: "08:00" }, lastDataLocalDate: null })] })
    expect(day).toMatchObject({ state: "WAITING_FOR_SOURCES", decidedBy: "EMPLOYMENT", workActivity: { state: "READY" }, employment: { state: "WAITING" } })
  })

  it("RH com SLA vencido e stale → DATA_SOURCE_DELAY (nunca presumir EM_PRODUCAO)", () => {
    const day = resolveWorkdayDataAvailability({ date: "2026-09-17", now: new Date("2026-09-20T12:00:00-03:00"), timeZone: TZ, evidenceSources: evidence, sources: [source({ key: "prod", group: "WORK_ACTIVITY", lastSuccessAt: new Date("2026-09-20T11:30:00-03:00") }), source({ key: "rh", group: "EMPLOYMENT", policy: { lagDays: 2, availableByLocalTime: "08:00" }, lastSuccessAt: new Date("2026-09-15T08:00:00-03:00"), lastDataLocalDate: null, freshness: "STALE" })] })
    expect(day).toMatchObject({ state: "DATA_SOURCE_DELAY", decidedBy: "EMPLOYMENT" })
  })

  it("sem feed de situação configurado (cadastro manual/legado) → nada a esperar do RH", () => {
    const day = resolveWorkdayDataAvailability({ date: "2026-09-17", now: new Date("2026-09-18T12:00:00-03:00"), timeZone: TZ, evidenceSources: evidence, sources: [source({ key: "prod", group: "WORK_ACTIVITY" })] })
    expect(day).toMatchObject({ state: "READY", employment: { state: "READY", configured: false } })
  })

  it("fonte de evidência sem política (ou sem feed) → AVAILABILITY_UNKNOWN: a INIA não assume D+1", () => {
    expect(resolveWorkdayDataAvailability({ date: "2026-09-17", now: new Date("2026-09-30T00:00:00Z"), timeZone: TZ, evidenceSources: evidence, sources: [source({ key: "prod", group: "WORK_ACTIVITY", policy: null })] }).state).toBe("AVAILABILITY_UNKNOWN")
    expect(resolveWorkdayDataAvailability({ date: "2026-09-17", now: new Date("2026-09-30T00:00:00Z"), timeZone: TZ, evidenceSources: evidence, sources: [] }).state).toBe("AVAILABILITY_UNKNOWN")
  })

  it("organização sem fonte de evidência: disponibilidade de produção não se aplica (READY) — ninguém é cobrado por outro caminho", () => {
    expect(resolveWorkdayDataAvailability({ date: "2026-09-17", now: new Date("2026-09-30T00:00:00Z"), timeZone: TZ, evidenceSources: { interactions: false, indicatorCodes: [] }, sources: [] })).toMatchObject({ state: "READY", workActivity: { configured: false } })
  })
})
