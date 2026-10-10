import { describe, expect, it } from "vitest"
import { credentialFailureOf, loginMatchesAccount, READ_CONFIRMATION_MAX_FAILURES, readConfirmationThrottle } from "./read-confirmation.js"

const NOW = new Date("2026-10-06T15:00:00.000Z")
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)

describe("confirmação de ciência com login e senha — regras puras", () => {
  it("trava: abaixo do limite diz quantas tentativas restam; falha fora da janela não conta", () => {
    expect(readConfirmationThrottle([], NOW)).toEqual({ blocked: false, remaining: READ_CONFIRMATION_MAX_FAILURES })
    expect(readConfirmationThrottle([minutesAgo(1), minutesAgo(2), minutesAgo(30)], NOW)).toEqual({ blocked: false, remaining: 3 })
  })

  it("trava: no limite bloqueia até a falha que completou o limite sair da janela de 15 min", () => {
    const failures = [minutesAgo(20), minutesAgo(10), minutesAgo(8), minutesAgo(6), minutesAgo(4), minutesAgo(2)]
    const result = readConfirmationThrottle(failures, NOW)
    // Na janela: 10, 8, 6, 4, 2 min atrás (5). Libera quando a de 10 min atrás sair: daqui a 5 min.
    expect(result).toEqual({ blocked: true, retryAt: new Date(NOW.getTime() + 5 * 60_000) })
    expect(readConfirmationThrottle(failures, new Date(NOW.getTime() + 5 * 60_000))).toEqual({ blocked: false, remaining: 1 })
  })

  it("login = e-mail da própria conta, sem diferenciar maiúsculas nem espaços nas pontas", () => {
    expect(loginMatchesAccount("  Larissa.Monteiro@Empresa.com ", "larissa.monteiro@empresa.com")).toBe(true)
    expect(loginMatchesAccount("larissa.monteiro", "larissa.monteiro@empresa.com")).toBe(false)
    expect(loginMatchesAccount("outra.pessoa@empresa.com", "larissa.monteiro@empresa.com")).toBe(false)
  })

  it("motivo da falha: login errado (ou conta inativa) vem antes da senha", () => {
    expect(credentialFailureOf({ accountActive: true, loginMatches: true, passwordMatches: true })).toBeNull()
    expect(credentialFailureOf({ accountActive: true, loginMatches: false, passwordMatches: true })).toBe("WRONG_LOGIN")
    expect(credentialFailureOf({ accountActive: true, loginMatches: false, passwordMatches: false })).toBe("WRONG_LOGIN")
    expect(credentialFailureOf({ accountActive: true, loginMatches: true, passwordMatches: false })).toBe("WRONG_PASSWORD")
    expect(credentialFailureOf({ accountActive: false, loginMatches: true, passwordMatches: true })).toBe("WRONG_LOGIN")
  })
})
