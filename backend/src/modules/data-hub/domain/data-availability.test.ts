import { describe, expect, it } from "vitest"
import { combineSourceAvailability, describeAvailabilityPolicy, expectedAvailableAt, resolveSourceAvailability } from "./data-availability.js"

const TZ = "America/Sao_Paulo"
const at = (iso: string) => new Date(iso)

describe("disponibilidade esperada dos dados (SLA D-1/D-2) — distinta de freshness", () => {
  it("expectedAvailableAt: D + lagDays às HH:MM no fuso da organização (nunca UTC implícito)", () => {
    expect(expectedAvailableAt("2026-09-17", { lagDays: 1, availableByLocalTime: "11:00" }, TZ).toISOString()).toBe("2026-09-18T14:00:00.000Z")
    expect(expectedAvailableAt("2026-09-17", { lagDays: 2, availableByLocalTime: "08:00" }, TZ).toISOString()).toBe("2026-09-19T11:00:00.000Z")
    expect(expectedAvailableAt("2026-09-17", { lagDays: 0, availableByLocalTime: "23:30" }, "America/Manaus").toISOString()).toBe("2026-09-18T03:30:00.000Z")
  })

  it("rótulo: D-1 até 11:00 / mesmo dia / não configurado", () => {
    expect(describeAvailabilityPolicy({ lagDays: 1, availableByLocalTime: "11:00" })).toBe("D-1 até 11:00")
    expect(describeAvailabilityPolicy({ lagDays: 0, availableByLocalTime: "23:00" })).toBe("No mesmo dia até 23:00")
    expect(describeAvailabilityPolicy(null)).toBe("SLA de disponibilidade não configurado")
  })

  const policy = { lagDays: 1, availableByLocalTime: "11:00" }

  it("D+1 antes do horário → WAITING (dado ainda pode chegar; não é atraso de ninguém)", () => {
    expect(resolveSourceAvailability({ policy, workDate: "2026-09-17", now: at("2026-09-18T10:59:00-03:00"), timeZone: TZ, lastSuccessAt: at("2026-09-18T08:00:00-03:00"), lastDataLocalDate: "2026-09-16" })).toMatchObject({ state: "WAITING" })
  })

  it("feed sincronizou hoje às 08:00 (FRESH) mas o dado de ontem só é esperado às 11:00: FRESH ≠ dia fechado", () => {
    const fresh = resolveSourceAvailability({ policy, workDate: "2026-09-17", now: at("2026-09-18T08:30:00-03:00"), timeZone: TZ, lastSuccessAt: at("2026-09-18T08:00:00-03:00"), lastDataLocalDate: "2026-09-16" })
    expect(fresh.state).toBe("WAITING")
  })

  it("D+1 depois do horário com carga bem-sucedida após o prazo → READY (a fonte teve a oportunidade de entregar D)", () => {
    expect(resolveSourceAvailability({ policy, workDate: "2026-09-17", now: at("2026-09-18T12:00:00-03:00"), timeZone: TZ, lastSuccessAt: at("2026-09-18T11:05:00-03:00"), lastDataLocalDate: null })).toMatchObject({ state: "READY" })
  })

  it("depois do prazo com dado de negócio já cobrindo D → READY mesmo que a última carga seja anterior ao prazo", () => {
    expect(resolveSourceAvailability({ policy, workDate: "2026-09-17", now: at("2026-09-18T12:00:00-03:00"), timeZone: TZ, lastSuccessAt: at("2026-09-18T09:00:00-03:00"), lastDataLocalDate: "2026-09-17" })).toMatchObject({ state: "READY" })
  })

  it("depois do prazo sem carga após ele e sem dado de D → DELAYED (fonte atrasada — problema de dado)", () => {
    expect(resolveSourceAvailability({ policy, workDate: "2026-09-17", now: at("2026-09-18T12:00:00-03:00"), timeZone: TZ, lastSuccessAt: at("2026-09-18T08:00:00-03:00"), lastDataLocalDate: "2026-09-16" })).toMatchObject({ state: "DELAYED" })
    expect(resolveSourceAvailability({ policy, workDate: "2026-09-17", now: at("2026-09-18T12:00:00-03:00"), timeZone: TZ, lastSuccessAt: null, lastDataLocalDate: null })).toMatchObject({ state: "DELAYED" })
  })

  it("D+2 avaliado em D+1 → WAITING; depois do prazo de D+2 → READY/DELAYED", () => {
    const d2 = { lagDays: 2, availableByLocalTime: "08:00" }
    expect(resolveSourceAvailability({ policy: d2, workDate: "2026-09-17", now: at("2026-09-18T15:00:00-03:00"), timeZone: TZ, lastSuccessAt: at("2026-09-18T14:00:00-03:00"), lastDataLocalDate: "2026-09-17" }).state).toBe("WAITING")
    expect(resolveSourceAvailability({ policy: d2, workDate: "2026-09-17", now: at("2026-09-19T09:00:00-03:00"), timeZone: TZ, lastSuccessAt: at("2026-09-19T08:30:00-03:00"), lastDataLocalDate: null }).state).toBe("READY")
    expect(resolveSourceAvailability({ policy: d2, workDate: "2026-09-17", now: at("2026-09-19T09:00:00-03:00"), timeZone: TZ, lastSuccessAt: at("2026-09-18T08:30:00-03:00"), lastDataLocalDate: "2026-09-16" }).state).toBe("DELAYED")
  })

  it("sem política → UNKNOWN (nunca D+1 presumido)", () => {
    expect(resolveSourceAvailability({ policy: null, workDate: "2026-09-17", now: at("2026-09-30T00:00:00Z"), timeZone: TZ, lastSuccessAt: at("2026-09-30T00:00:00Z"), lastDataLocalDate: "2026-09-29" })).toEqual({ state: "UNKNOWN", expectedAt: null })
  })

  it("combinação: a fonte mais conservadora decide — UNKNOWN > WAITING > DELAYED > READY; nenhuma fonte = UNKNOWN", () => {
    expect(combineSourceAvailability(["READY", "READY"])).toBe("READY")
    expect(combineSourceAvailability(["READY", "DELAYED"])).toBe("DELAYED")
    expect(combineSourceAvailability(["DELAYED", "WAITING"])).toBe("WAITING")
    expect(combineSourceAvailability(["WAITING", "UNKNOWN"])).toBe("UNKNOWN")
    expect(combineSourceAvailability([])).toBe("UNKNOWN")
  })
})

import { fixedClock, systemClock } from "../../../shared/domain/clock.js"

describe("Clock determinístico × fronteiras do SLA (D+1 10:59 / 11:00 / 11:01, D+2, virada de dia, fusos)", () => {
  const D1 = { lagDays: 1, availableByLocalTime: "11:00" }
  const D2 = { lagDays: 2, availableByLocalTime: "08:00" }
  const delivered = { lastSuccessAt: null, lastDataLocalDate: "2026-09-17" } // dado de negócio já cobre D=17 → READY quando o prazo vencer

  it.each(["America/Fortaleza", "America/Sao_Paulo", "America/Manaus"])("%s — D+1: 10:59 aguarda, 11:00 e 11:01 já venceram (relógio fixo, nunca o relógio real)", (timeZone) => {
    const at = (local: string) => fixedClock(new Date(`2026-09-18T${local}:00${offset(timeZone)}`)).now()
    expect(resolveSourceAvailability({ policy: D1, workDate: "2026-09-17", timeZone, now: at("10:59"), ...delivered }).state).toBe("WAITING")
    expect(resolveSourceAvailability({ policy: D1, workDate: "2026-09-17", timeZone, now: at("11:00"), ...delivered }).state).toBe("READY")
    expect(resolveSourceAvailability({ policy: D1, workDate: "2026-09-17", timeZone, now: at("11:01"), ...delivered }).state).toBe("READY")
    // Sem entrega depois do prazo: 11:00 em diante é atraso da FONTE.
    expect(resolveSourceAvailability({ policy: D1, workDate: "2026-09-17", timeZone, now: at("11:00"), lastSuccessAt: null, lastDataLocalDate: "2026-09-16" }).state).toBe("DELAYED")
    expect(expectedAvailableAt("2026-09-17", D1, timeZone).toISOString()).toBe(new Date(`2026-09-18T11:00:00${offset(timeZone)}`).toISOString())
  })

  it.each(["America/Fortaleza", "America/Sao_Paulo"])("%s — D+2 08:00: em D+1 (qualquer hora) aguarda; D+2 07:59 aguarda; D+2 08:00 vence", (timeZone) => {
    const clock = (iso: string) => fixedClock(new Date(`${iso}${offset(timeZone)}`)).now()
    expect(resolveSourceAvailability({ policy: D2, workDate: "2026-09-17", timeZone, now: clock("2026-09-18T23:59:59"), ...delivered }).state).toBe("WAITING")
    expect(resolveSourceAvailability({ policy: D2, workDate: "2026-09-17", timeZone, now: clock("2026-09-19T07:59:59"), ...delivered }).state).toBe("WAITING")
    expect(resolveSourceAvailability({ policy: D2, workDate: "2026-09-17", timeZone, now: clock("2026-09-19T08:00:00"), ...delivered }).state).toBe("READY")
  })

  it("virada de dia: às 23:59 locais de D+1 o dado de D (D-1 11:00) já venceu e o de D+1 ainda não; 00:00 de D+2 idem — o dia civil vem do fuso, o instante do Clock", () => {
    const tz = "America/Fortaleza"
    const late = fixedClock("2026-09-18T23:59:59-03:00").now()
    const midnight = fixedClock("2026-09-19T00:00:00-03:00").now()
    expect(resolveSourceAvailability({ policy: D1, workDate: "2026-09-17", timeZone: tz, now: late, lastSuccessAt: late, lastDataLocalDate: null }).state).toBe("READY")
    expect(resolveSourceAvailability({ policy: D1, workDate: "2026-09-18", timeZone: tz, now: late, lastSuccessAt: late, lastDataLocalDate: null }).state).toBe("WAITING")
    expect(resolveSourceAvailability({ policy: D1, workDate: "2026-09-18", timeZone: tz, now: midnight, lastSuccessAt: midnight, lastDataLocalDate: null }).state).toBe("WAITING")
    // Mesmo instante UTC lido em Manaus (UTC-4) ainda é 22:59 de D+1: nada muda de dia — o Clock é absoluto, o fuso interpreta.
    expect(expectedAvailableAt("2026-09-18", D1, "America/Manaus").getTime()).toBe(expectedAvailableAt("2026-09-18", D1, tz).getTime() + 60 * 60_000)
  })

  it("fixedClock devolve sempre o mesmo instante (cópia, nunca a mesma instância mutável); systemClock acompanha o relógio real", () => {
    const clock = fixedClock("2026-09-18T11:00:00-03:00")
    const a = clock.now()
    a.setFullYear(2000)
    expect(clock.now().toISOString()).toBe("2026-09-18T14:00:00.000Z")
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1000)
    expect(() => fixedClock("não é data")).toThrow()
  })
})

/** Offset fixo de setembro (sem horário de verão nesses fusos): Fortaleza/São Paulo −03:00, Manaus −04:00. */
function offset(timeZone: string): string {
  return timeZone === "America/Manaus" ? "-04:00" : "-03:00"
}
