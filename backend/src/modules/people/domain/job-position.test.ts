import { describe, expect, it } from "vitest"
import { jobPositionInputSchema, jobPositionKey, reservedLevelOf, resolveJobPosition, termsOf, UNKNOWN_JOB_POSITION_PATTERN, unknownJobPositionMessage, type JobPositionCatalog } from "./job-position.js"

const CATALOG: JobPositionCatalog = new Map([
  ["ASSISTENTE RELACIONAMENTO", { id: "p1", name: "Assistente de Relacionamento", level: "OPERATOR" as const, active: true }],
  ["GERENTE SR", { id: "p2", name: "Gerente Sênior", level: "SENIOR_MANAGER" as const, active: true }],
  ["ESTAGIARIO", { id: "p3", name: "Estagiário", level: "STAFF" as const, active: false }],
])

describe("cargo da base → cargo e perfil", () => {
  it("maiúscula, acento, pontuação e espaço não fazem diferença", () => {
    for (const raw of ["ASSISTENTE RELACIONAMENTO", " assistente  relacionamento ", "Assistente-Relacionamento."]) expect(resolveJobPosition(CATALOG, raw)).toEqual({ ok: true, position: { id: "p1", name: "Assistente de Relacionamento", level: "OPERATOR" } })
    expect(resolveJobPosition(CATALOG, "Gerente Sr.")).toMatchObject({ ok: true, position: { level: "SENIOR_MANAGER" } })
    expect(jobPositionKey("  Estagiário (a) ")).toBe("ESTAGIARIO A")
  })

  it("código do nível continua aceito, sem cargo; desconhecido e desativado nunca viram operador; ADMIN não entra", () => {
    expect(resolveJobPosition(CATALOG, "operator")).toEqual({ ok: true, position: { id: null, name: null, level: "OPERATOR" } })
    expect(resolveJobPosition(CATALOG, "STAFF")).toMatchObject({ ok: true, position: { level: "STAFF" } })
    expect(resolveJobPosition(CATALOG, "Trainee")).toEqual({ ok: false, reason: "UNKNOWN" })
    expect(resolveJobPosition(CATALOG, "ESTAGIÁRIO")).toEqual({ ok: false, reason: "INACTIVE" })
    expect(resolveJobPosition(CATALOG, "ADMIN")).toEqual({ ok: false, reason: "UNKNOWN" })
  })

  it("código de nível: cargo desativado com esse nome não volta pelo código, e o código é reservado ao próprio nível", () => {
    const catalog: JobPositionCatalog = new Map([["SUPERVISOR", { id: "s", name: "Supervisor", level: "SUPERVISOR" as const, active: false }]])
    expect(resolveJobPosition(catalog, "SUPERVISOR")).toEqual({ ok: false, reason: "INACTIVE" })
    expect([reservedLevelOf("SENIOR MANAGER"), reservedLevelOf("OPERATOR"), reservedLevelOf("GERENTE")]).toEqual(["SENIOR_MANAGER", "OPERATOR", null])
  })

  it("termo que cresce ao normalizar respeita o limite da chave", () => {
    expect(jobPositionInputSchema.safeParse({ name: "Analista", level: "STAFF", terms: ["ß".repeat(80)] }).success).toBe(jobPositionKey("ß".repeat(80)).length <= 120)
    expect(jobPositionInputSchema.safeParse({ name: "Analista", level: "STAFF", terms: ["ß".repeat(70)] }).success).toBe(false)
  })

  it("o nome é sempre um dos termos, sem repetir a mesma chave; nome só com pontuação é recusado", () => {
    expect(termsOf("Gerente Sênior", ["GERENTE SENIOR", "Gerente Sr", "GERENTE SR."])).toEqual([{ key: "GERENTE SENIOR", term: "Gerente Sênior" }, { key: "GERENTE SR", term: "Gerente Sr" }])
    expect(jobPositionInputSchema.safeParse({ name: "---", level: "STAFF" }).success).toBe(false)
    expect(jobPositionInputSchema.safeParse({ name: "Analista", level: "ADMIN" }).success).toBe(false)
  })

  it("a tela lê de volta o termo da mensagem da quarentena, inclusive com aspas no meio", () => {
    const pattern = new RegExp(UNKNOWN_JOB_POSITION_PATTERN)
    expect(pattern.exec(unknownJobPositionMessage("ANALISTA PL", "UNKNOWN"))?.[1]).toBe("ANALISTA PL")
    expect(pattern.exec(unknownJobPositionMessage('ANALISTA "PL"', "INACTIVE"))?.[1]).toBe('ANALISTA "PL"')
  })
})
