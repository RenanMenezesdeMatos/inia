import { describe, expect, it } from "vitest"
import { LOGIN_MAX_FAILURES, loginThrottle } from "./login-throttle.js"
import { passwordPolicyViolations } from "./password-policy.js"
import { decideSession, type SessionAccountState } from "./session-state.js"
import { generateTemporaryPassword, temporaryPasswordExpiry } from "./temporary-password.js"

const NOW = new Date("2026-10-06T12:00:00Z")
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)

describe("política de senha", () => {
  it("aceita senha com 8+ caracteres, letra e número, sem o login", () => {
    expect(passwordPolicyViolations("Cajueiro2026", { login: "larissa.monteiro@vivo.com" })).toEqual([])
    expect(passwordPolicyViolations("çãoÉ1234", { login: "x@y.com" })).toEqual([])
  })
  it("aponta cada regra que falta", () => {
    expect(passwordPolicyViolations("xyz1", { login: "x@y.com" })).toEqual(["TOO_SHORT"])
    expect(passwordPolicyViolations("somenteletras", { login: "x@y.com" })).toEqual(["MISSING_DIGIT"])
    expect(passwordPolicyViolations("1234567890", { login: "x@y.com" })).toEqual(["MISSING_LETTER"])
    expect(passwordPolicyViolations("larissa.monteiro99", { login: "Larissa.Monteiro@vivo.com" })).toEqual(["CONTAINS_LOGIN"])
  })
  it("recusa senha previsível: palavra comum, empresa, mês ou estação + números/símbolos (auditoria 17/10/2026, AUTH-12)", () => {
    for (const common of ["Senha123", "senha@2026", "Senh@1234", "Vivo2026", "Mudar@123", "Inia2026!", "Primavera2026", "Outubro2026", "Qwerty123", "abc12345", "Aaaa1111", "VivoVivo2026", "Telefônica1"]) {
      expect(passwordPolicyViolations(common, { login: "x@y.com" }), common).toContain("COMMON_PASSWORD")
    }
    for (const strong of ["Cajueiro2026", "Pato-Azul-77", "Vivo-Cajueiro-2026", "3Tigres7Pratos"]) expect(passwordPolicyViolations(strong, { login: "x@y.com" }), strong).toEqual([])
  })
  it("limita em 72 BYTES (bcrypt ignora o resto), não em caracteres", () => {
    expect(passwordPolicyViolations(`a1${"xyz".repeat(23)}`, { login: "x@y.com" })).toEqual([])
    expect(passwordPolicyViolations(`a1b${"é".repeat(36)}`, { login: "x@y.com" })).toEqual(["TOO_LONG"])
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
  it("inatividade: parada além do limite = encerrada (401 SESSION_IDLE); sem registro de atividade ou limite 0, nada a medir", () => {
    const idleTimeoutMs = 30 * 60_000
    expect(decideSession({ ...active, lastActivityAt: minutesAgo(29) }, 3, NOW, { idleTimeoutMs })).toMatchObject({ ok: true })
    expect(decideSession({ ...active, lastActivityAt: minutesAgo(30) }, 3, NOW, { idleTimeoutMs })).toMatchObject({ ok: true })
    expect(decideSession({ ...active, lastActivityAt: minutesAgo(31) }, 3, NOW, { idleTimeoutMs })).toMatchObject({ ok: false, status: 401, code: "SESSION_IDLE" })
    expect(decideSession({ ...active, lastActivityAt: null }, 3, NOW, { idleTimeoutMs })).toMatchObject({ ok: true })
    expect(decideSession({ ...active, lastActivityAt: minutesAgo(600) }, 3, NOW, { idleTimeoutMs: 0 })).toMatchObject({ ok: true })
    // Revogada continua revogada, parada ou não.
    expect(decideSession({ ...active, active: false, lastActivityAt: minutesAgo(1) }, 3, NOW, { idleTimeoutMs })).toMatchObject({ code: "SESSION_REVOKED" })
  })
})
