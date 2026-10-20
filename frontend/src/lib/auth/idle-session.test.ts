import { describe, expect, it } from "vitest"

import { idlePhase, minutesLeft, shouldReportActivity } from "./idle-session"
import { readSessionCookie, sessionCookieHeader } from "./session-cookie"

const MINUTE = 60_000

describe("encerramento por inatividade (regra da tela)", () => {
  it("ativa até faltar 2 minutos; aviso nos 2 minutos finais; encerrada no limite", () => {
    const timeout = 30 * MINUTE
    expect(idlePhase(0, 27 * MINUTE, timeout)).toBe("active")
    expect(idlePhase(0, 28 * MINUTE, timeout)).toBe("warning")
    expect(idlePhase(0, 30 * MINUTE - 1, timeout)).toBe("warning")
    expect(idlePhase(0, 30 * MINUTE, timeout)).toBe("expired")
    expect(idlePhase(0, 999 * MINUTE, 0)).toBe("active")
  })
  it("limite curto: o aviso ocupa no máximo a metade do tempo", () => {
    expect(idlePhase(0, 1 * MINUTE, 3 * MINUTE)).toBe("active")
    expect(idlePhase(0, 2 * MINUTE, 3 * MINUTE)).toBe("warning")
  })
  it("o servidor é avisado no máximo uma vez por minuto", () => {
    expect(shouldReportActivity(null, 0)).toBe(true)
    expect(shouldReportActivity(0, 59_999)).toBe(false)
    expect(shouldReportActivity(0, MINUTE)).toBe(true)
  })
  it("minutos que faltam, nunca menos de 1", () => {
    expect(minutesLeft(0, 28 * MINUTE, 30 * MINUTE)).toBe(2)
    expect(minutesLeft(0, 29.5 * MINUTE, 30 * MINUTE)).toBe(1)
    expect(minutesLeft(0, 31 * MINUTE, 30 * MINUTE)).toBe(1)
  })
})

describe("cookie de sessão", () => {
  const store = (cookies: Record<string, string>) => ({ get: (name: string) => (name in cookies ? { value: cookies[name]! } : undefined) })
  it("lê o nome que existir — `__Host-` (HTTPS) antes do nome de HTTP — e repassa com o MESMO nome", () => {
    expect(readSessionCookie(store({ "__Host-inia_session": "a.b.c" }))).toEqual({ value: "a.b.c", header: "__Host-inia_session=a.b.c" })
    expect(readSessionCookie(store({ inia_session: "x.y.z" }))).toEqual({ value: "x.y.z", header: "inia_session=x.y.z" })
    expect(readSessionCookie(store({ "__Host-inia_session": "novo", inia_session: "antigo" }))?.value).toBe("novo")
    expect(readSessionCookie(store({}))).toBeNull()
    expect(sessionCookieHeader(null)).toBe("")
  })
})
