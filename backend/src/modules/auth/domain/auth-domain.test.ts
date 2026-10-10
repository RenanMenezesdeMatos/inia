import { describe, expect, it } from "vitest"
import { LOGIN_MAX_FAILURES, loginThrottle } from "./login-throttle.js"
import { passwordPolicyViolations } from "./password-policy.js"
import { decideSession, type SessionAccountState } from "./session-state.js"
import { generateTemporaryPassword, temporaryPasswordExpiry } from "./temporary-password.js"

const NOW = new Date("2026-10-06T12:00:00Z")
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)

describe("política de senha", () => {
  it("aceita senha com 8+ caracteres, letra e número, sem o login", () => {
    expect(passwordPolicyViolations("Primavera2026", { login: "larissa.monteiro@vivo.com" })).toEqual([])
    expect(passwordPolicyViolations("çãoÉ1234", { login: "x@y.com" })).toEqual([])
  })
  it("aponta cada regra que falta", () => {
    expect(passwordPolicyViolations("abc1", { login: "x@y.com" })).toEqual(["TOO_SHORT"])
    expect(passwordPolicyViolations("somenteletras", { login: "x@y.com" })).toEqual(["MISSING_DIGIT"])
    expect(passwordPolicyViolations("1234567890", { login: "x@y.com" })).toEqual(["MISSING_LETTER"])
    expect(passwordPolicyViolations("larissa.monteiro99", { login: "Larissa.Monteiro@vivo.com" })).toEqual(["CONTAINS_LOGIN"])
  })
  it("limita em 72 BYTES (bcrypt ignora o resto), não em caracteres", () => {
    expect(passwordPolicyViolations(`a1${"x".repeat(70)}`, { login: "x@y.com" })).toEqual([])
    expect(passwordPolicyViolations(`a1${"é".repeat(36)}`, { login: "x@y.com" })).toEqual(["TOO_LONG"])
  })
})

describe("senha temporária", () => {
  it("12 símbolos sem caracteres ambíguos, em 3 blocos, sempre com maiúscula, minúscula e número", () => {
    for (let index = 0; index < 200; index += 1) {
      const password = generateTemporaryPassword()
      expect(password).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{4}-[A-HJ-NP-Za-km-np-z2-9]{4}-[A-HJ-NP-Za-km-np-z2-9]{4}$/)
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[2-9]/)
    }
    expect(new Set(Array.from({ length: 200 }, () => generateTemporaryPassword())).size).toBe(200)
  })
  it("refaz a sorteio quando falta uma classe de caractere (nunca aceita só letras)", () => {
    // Primeiro sorteio: só "A" (índice 0); depois um ciclo que cobre as três classes.
    const sequence = [...Array(12).fill(0), 0, 24, 48, ...Array(9).fill(1)]
    let call = 0
    expect(generateTemporaryPassword(() => sequence[call++]!)).toBe("Aa2B-BBBB-BBBB")
  })
  it("validade a partir da emissão", () => {
    expect(temporaryPasswordExpiry(NOW, 72).toISOString()).toBe("2026-10-09T12:00:00.000Z")
  })
})

describe("trava de login", () => {
  it(`bloqueia com ${LOGIN_MAX_FAILURES} falhas na janela de 15 min e libera quando a 5ª mais recente sai da janela`, () => {
    expect(loginThrottle([minutesAgo(1), minutesAgo(2), minutesAgo(3), minutesAgo(4)], NOW)).toEqual({ locked: false })
    expect(loginThrottle([minutesAgo(1), minutesAgo(2), minutesAgo(3), minutesAgo(4), minutesAgo(10)], NOW)).toEqual({ locked: true, retryAt: new Date(minutesAgo(10).getTime() + 15 * 60_000) })
    expect(loginThrottle([minutesAgo(1), minutesAgo(2), minutesAgo(3), minutesAgo(4), minutesAgo(16)], NOW)).toEqual({ locked: false })
  })
})

describe("estado da sessão (conferido no banco a cada request)", () => {
  const active: SessionAccountState = { active: true, sessionVersion: 3, passwordChangeRequired: false, temporaryPasswordExpiresAt: null }
  const pending: SessionAccountState = { active: true, sessionVersion: 3, passwordChangeRequired: true, temporaryPasswordExpiresAt: new Date(NOW.getTime() + 3_600_000) }
  it("sessão em dia passa; conta desabilitada, inexistente ou versão diferente = revogada (401)", () => {
    expect(decideSession(active, 3, NOW)).toMatchObject({ ok: true, passwordChangeRequired: false })
    expect(decideSession({ ...active, active: false }, 3, NOW)).toMatchObject({ ok: false, status: 401, code: "SESSION_REVOKED" })
    expect(decideSession(null, 3, NOW)).toMatchObject({ ok: false, code: "SESSION_REVOKED" })
    expect(decideSession(active, 2, NOW)).toMatchObject({ ok: false, code: "SESSION_REVOKED" })
  })
  it("troca pendente: bloqueia as rotas comuns (403) e só passa onde é permitido; temporária vencida derruba (401)", () => {
    expect(decideSession(pending, 3, NOW)).toMatchObject({ ok: false, status: 403, code: "PASSWORD_CHANGE_REQUIRED" })
    expect(decideSession(pending, 3, NOW, { allowPendingPasswordChange: true })).toMatchObject({ ok: true, passwordChangeRequired: true })
    const expired = { ...pending, temporaryPasswordExpiresAt: NOW }
    expect(decideSession(expired, 3, NOW, { allowPendingPasswordChange: true })).toMatchObject({ ok: false, status: 401, code: "TEMPORARY_PASSWORD_EXPIRED" })
    expect(decideSession({ ...pending, temporaryPasswordExpiresAt: null }, 3, NOW, { allowPendingPasswordChange: true })).toMatchObject({ ok: false, code: "TEMPORARY_PASSWORD_EXPIRED" })
  })
})
