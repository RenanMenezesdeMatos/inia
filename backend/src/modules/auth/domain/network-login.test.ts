import { describe, expect, it } from "vitest"
import { classifyInvalidCredentials, networkLoginMatches, networkLoginThrottle, normalizeNetworkLogin } from "./network-login.js"

describe("normalizeNetworkLogin", () => {
  it("maiúsculas, sem espaços nas pontas e sem o prefixo DOMINIO\\", () => {
    expect(normalizeNetworkLogin(" g0055350 ")).toBe("G0055350")
    expect(normalizeNetworkLogin("empresa\\sp0055350")).toBe("SP0055350")
  })
  it("recusa o que não pode ir num bind", () => {
    for (const value of ["", " ", "a", "g0055350@empresa.local", "G00 55", "cn=x,dc=y", "*", "G0055350\u0000", "(G0)"]) expect(normalizeNetworkLogin(value)).toBeNull()
  })
  it("compara a matrícula digitada com a da pessoa", () => {
    expect(networkLoginMatches("g0055350", "G0055350")).toBe(true)
    expect(networkLoginMatches("G0055351", "G0055350")).toBe(false)
    expect(networkLoginMatches("G0055350", null)).toBe(false)
  })
})

describe("classifyInvalidCredentials", () => {
  it("lê o código do AD na mensagem", () => {
    const ad = (code: string) => `80090308: LdapErr: DSID-0C09044E, comment: AcceptSecurityContext error, data ${code}, v4563`
    expect(classifyInvalidCredentials(ad("52e"))).toEqual({ kind: "INVALID" })
    expect(classifyInvalidCredentials(ad("525"))).toEqual({ kind: "INVALID" })
    expect(classifyInvalidCredentials(ad("532"))).toEqual({ kind: "PASSWORD_EXPIRED" })
    expect(classifyInvalidCredentials(ad("773"))).toEqual({ kind: "PASSWORD_EXPIRED" })
    expect(classifyInvalidCredentials(ad("775"))).toEqual({ kind: "ACCOUNT_LOCKED" })
    expect(classifyInvalidCredentials(ad("533"))).toEqual({ kind: "ACCOUNT_DISABLED" })
    expect(classifyInvalidCredentials(ad("701"))).toEqual({ kind: "ACCOUNT_DISABLED" })
    expect(classifyInvalidCredentials(undefined)).toEqual({ kind: "INVALID" })
  })
})

describe("networkLoginThrottle — a cadeia do contador do AD", () => {
  const start = new Date("2026-11-22T10:00:00Z").getTime()
  const at = (minute: number) => new Date(start + minute * 60_000)
  it("3 falhas a até 15 min uma da outra travam até a última + 15 min, mesmo fora de qualquer janela de 15 min", () => {
    expect(networkLoginThrottle([at(0), at(14), at(28)], at(30))).toEqual({ locked: true, chain: 3, retryAt: at(43) })
    expect(networkLoginThrottle([at(0), at(14), at(28)], at(43))).toMatchObject({ locked: true })
    expect(networkLoginThrottle([at(0), at(14), at(28)], at(44))).toEqual({ locked: false, chain: 0 })
  })
  it("intervalo maior que 15 min quebra a cadeia", () => {
    expect(networkLoginThrottle([at(0), at(5), at(21)], at(22))).toEqual({ locked: false, chain: 1 })
    expect(networkLoginThrottle([at(0), at(16), at(32)], at(33))).toEqual({ locked: false, chain: 1 })
  })
  it("sem falha, ou a mais recente há mais de 15 min: livre", () => {
    expect(networkLoginThrottle([], at(0))).toEqual({ locked: false, chain: 0 })
    expect(networkLoginThrottle([at(0), at(1), at(2)], at(18))).toEqual({ locked: false, chain: 0 })
  })
})
