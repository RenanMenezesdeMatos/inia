import { describe, expect, it } from "vitest"
import { classifyInvalidCredentials, directoryLimits, employeeIdMatches, fullLoginsBehind, identityVerdict, networkLoginMatches, networkLoginThrottle, normalizeNetworkLogin, parseShortLoginFormats, shortNetworkLoginOf } from "./network-login.js"

describe("normalizeNetworkLogin", () => {
  it("maiúsculas, sem espaços nas pontas e sem o prefixo DOMINIO\\", () => {
    expect(normalizeNetworkLogin(" g0055350 ")).toBe("G0055350")
    expect(normalizeNetworkLogin("empresa\\sp0055350")).toBe("SP0055350")
  })
  it("aceita o nome completo do AD (`matricula@dominio`) e ignora caracteres invisíveis de copiar e colar", () => {
    expect(normalizeNetworkLogin("g0055350@empresa.local")).toBe("G0055350")
    for (const invisible of ["\u200b", "\ufeff", "\u00ad", "\u2060", "\u202a", "\u00a0"]) expect(normalizeNetworkLogin(`${invisible}G0055350${invisible}`)).toBe("G0055350")
  })
  it("recusa o que não pode ir num bind", () => {
    for (const value of ["", " ", "a", "@empresa.local", "g0@x@y", "g0055350@", "g0055350@a b", "G00 55", "cn=x,dc=y", "*", "G0055350\u0000", "(G0)"]) expect(normalizeNetworkLogin(value)).toBeNull()
  })
  it("compara a matrícula digitada com a da pessoa", () => {
    expect(networkLoginMatches("g0055350", "G0055350")).toBe(true)
    expect(networkLoginMatches("G0055351", "G0055350")).toBe(false)
    expect(networkLoginMatches("G0055350", null)).toBe(false)
    expect(networkLoginMatches("EMPRESA\\g0055350", " g0055350 ")).toBe(true)
  })
  it("a matrícula do CADASTRO não tem as tolerâncias da digitação (o login nunca a encontraria)", () => {
    for (const registered of ["EMPRESA\\G0055350", "G0055350@empresa.local", "\u200bG0055350", "", "   "]) expect(networkLoginMatches("G0055350", registered), registered).toBe(false)
  })
})

describe("classifyInvalidCredentials", () => {
  it("lê o código do AD na mensagem", () => {
    const ad = (code: string) => `80090308: LdapErr: DSID-0C09044E, comment: AcceptSecurityContext error, data ${code}, v4563`
    expect(classifyInvalidCredentials(ad("52e"))).toEqual({ kind: "INVALID", code: "52e" })
    expect(classifyInvalidCredentials(ad("525"))).toEqual({ kind: "INVALID", code: "525" })
    expect(classifyInvalidCredentials(ad("532"))).toEqual({ kind: "PASSWORD_EXPIRED", code: "532" })
    expect(classifyInvalidCredentials(ad("773"))).toEqual({ kind: "PASSWORD_EXPIRED", code: "773" })
    expect(classifyInvalidCredentials(ad("775"))).toEqual({ kind: "ACCOUNT_LOCKED", code: "775" })
    expect(classifyInvalidCredentials(ad("533"))).toEqual({ kind: "ACCOUNT_DISABLED", code: "533" })
    expect(classifyInvalidCredentials(ad("701"))).toEqual({ kind: "ACCOUNT_DISABLED", code: "701" })
    expect(classifyInvalidCredentials(undefined)).toEqual({ kind: "INVALID" })
  })
})

describe("networkLoginThrottle — a cadeia do contador do AD", () => {
  const start = new Date("2026-11-22T10:00:00Z").getTime()
  const at = (minute: number) => new Date(start + minute * 60_000)
  it("3 falhas a até 16 min (janela do AD + 1 de folga) travam até a última + 16, sempre depois de o AD zerar", () => {
    expect(networkLoginThrottle([at(0), at(14), at(28)], at(30))).toEqual({ locked: true, chain: 3, retryAt: at(44) })
    // No instante exato em que o AD zera (última + 15) a INIA ainda segura.
    expect(networkLoginThrottle([at(0), at(14), at(28)], at(43))).toMatchObject({ locked: true })
    expect(networkLoginThrottle([at(0), at(14), at(28)], at(45))).toEqual({ locked: false, chain: 0 })
  })
  it("intervalo maior que a rodada quebra a cadeia", () => {
    expect(networkLoginThrottle([at(0), at(5), at(22)], at(23))).toEqual({ locked: false, chain: 1 })
    expect(networkLoginThrottle([at(0), at(17), at(34)], at(35))).toEqual({ locked: false, chain: 1 })
    // 15 a 16 min: o AD já zerou, mas a folga ainda conta (na dúvida, a favor da conta de rede).
    expect(networkLoginThrottle([at(0), at(15.5), at(31)], at(31))).toMatchObject({ locked: true })
  })
  it("sem falha, ou a mais recente há mais que a rodada: livre", () => {
    expect(networkLoginThrottle([], at(0))).toEqual({ locked: false, chain: 0 })
    expect(networkLoginThrottle([at(0), at(1), at(2)], at(19))).toEqual({ locked: false, chain: 0 })
  })
})

describe("login sem o último dígito (25/11/2026)", () => {
  const formats = parseShortLoginFormats(" r:8 , X:6 ")
  it("só no formato da instalação: prefixo, tamanho exato e o resto só dígitos", () => {
    expect(formats).toEqual([{ prefix: "R", length: 8 }, { prefix: "X", length: 6 }])
    expect(shortNetworkLoginOf("R4567891", formats)).toBe("R456789")
    for (const other of ["R456789", "R45678910", "A4567891", "RA567891", "R456789A", "4567891", "R"]) expect(shortNetworkLoginOf(other, formats), other).toBeNull()
    expect(shortNetworkLoginOf("R4567891", parseShortLoginFormats(undefined))).toBeNull()
  })
  it("a ID funcional precisa ser a da matrícula (sem contar zeros à esquerda); vazia ou com letra nunca confere", () => {
    expect(employeeIdMatches("R4567891", "04567891")).toBe(true)
    expect(employeeIdMatches("R0567891", "00567891")).toBe(true)
    for (const id of [null, undefined, "", "  ", "04567895", "4567891X", "0", "04567891 1"]) expect(employeeIdMatches("R4567891", id), String(id)).toBe(false)
    expect(employeeIdMatches("R0000000", "00000000")).toBe(false)
  })
})

describe("relógio e logins que podem ser de outra pessoa (revisão independente, 25/11/2026)", () => {
  it("falha datada no futuro (relógio corrigido para trás, outro servidor adiantado) conta como de agora, nunca some", () => {
    const now = new Date("2026-11-25T12:00:00Z")
    const ahead = Array.from({ length: 5 }, () => new Date(now.getTime() + 60_000))
    expect(networkLoginThrottle(ahead, now, 5)).toMatchObject({ locked: true, chain: 5 })
  })
  it("matrículas inteiras por trás de um login cortado possível", () => {
    const formats = parseShortLoginFormats("R:8")
    expect(fullLoginsBehind("R456789", formats)).toEqual(Array.from({ length: 10 }, (_, digit) => `R456789${digit}`))
    for (const other of ["R4567891", "R45678", "A456789", "RA56789", ""]) expect(fullLoginsBehind(other, formats)).toEqual([])
  })
})

describe("identityVerdict — de quem é a conta que entrou (run-12)", () => {
  const WHOLE = { employeeIdOf: "R4567891", whenUnreadable: "ALLOW" } as const
  const CUT = { employeeIdOf: "R4567891", whenUnreadable: "REFUSE" } as const
  const read = (employeeId: string, ownLogin = true) => ({ kind: "READ", employeeId, ownLogin }) as const
  const refused = { kind: "UNAVAILABLE", identityUnreadable: true }
  it("ID da matrícula entra, pelo login ou pelo nome completo; de outra matrícula recusa", () => {
    for (const check of [WHOLE, CUT]) for (const ownLogin of [true, false]) {
      expect(identityVerdict(check, read("04567891", ownLogin))).toEqual({ kind: "OK" })
      expect(identityVerdict(check, read("04567895", ownLogin))).toEqual({ kind: "INVALID", identityMismatch: true })
    }
  })
  it("ilegível segue a regra de quem pediu; não provável recusa sempre", () => {
    expect(identityVerdict(WHOLE, { kind: "UNREADABLE" })).toEqual({ kind: "OK" })
    expect(identityVerdict(CUT, { kind: "UNREADABLE" })).toMatchObject(refused)
    for (const check of [WHOLE, CUT]) expect(identityVerdict(check, { kind: "NOT_PROVABLE" })).toMatchObject(refused)
  })
  it("ID de outra pessoa do cadastro recusa; ficha de outro login não prova nada quando não há ID esperada", () => {
    const others = { notEmployeeIdOf: ["R4567891"], whenUnreadable: "REFUSE" } as const
    expect(identityVerdict(others, read("04567891"))).toEqual({ kind: "INVALID", identityMismatch: true })
    expect(identityVerdict(others, read("09999999"))).toEqual({ kind: "OK" })
    expect(identityVerdict(others, read("09999999", false))).toMatchObject(refused)
  })
})

describe("directoryLimits — os limites da conta do AD", () => {
  const limits = (provenLogin: string | null) => directoryLimits({ networkLogin: "R4567891", shortLogin: "R456789", fullLogins: [], provenLogin })
  const both = { logins: ["R4567891", "R456789"], max: 5 }
  it("formato: sem prova os dois recebem (3 no cortado, 5 na soma); provado, só um; memória de outra matrícula não vale", () => {
    for (const unproven of [null, "R999999"]) expect(limits(unproven)).toEqual({ whole: [both], cut: [both, { logins: ["R456789"], max: 3 }] })
    expect(limits("R456789")).toEqual({ whole: null, cut: [both] })
    expect(limits("R4567891")).toEqual({ whole: [both], cut: null })
  })
  it("comum: só o próprio; cortado digitado direto: soma as inteiras por trás dele", () => {
    expect(directoryLimits({ networkLogin: "G0055350", shortLogin: null, fullLogins: [], provenLogin: null })).toEqual({ whole: [{ logins: ["G0055350"], max: 5 }], cut: null })
    expect(directoryLimits({ networkLogin: "R456789", shortLogin: null, fullLogins: ["R4567890", "R4567891"], provenLogin: null })).toEqual({ whole: [{ logins: ["R456789", "R4567890", "R4567891"], max: 5 }], cut: null })
  })
})
