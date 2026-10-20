import { describe, expect, it } from "vitest"
import { matchesGlob } from "./source-config.js"

describe("padrão de arquivo do SFTP (auditoria de segurança 17/10/2026, DATA-11)", () => {
  it("casa `*` e `?` sem diferenciar maiúsculas, ancorado no nome inteiro", () => {
    expect(matchesGlob("colaboradores_*.csv", "Colaboradores_2026-10-17.CSV")).toBe(true)
    expect(matchesGlob("colaboradores_*.csv", "colaboradores_2026.csv.bak")).toBe(false)
    expect(matchesGlob("rh_????.xlsx", "rh_1017.xlsx")).toBe(true)
    expect(matchesGlob("rh_????.xlsx", "rh_10170.xlsx")).toBe(false)
    expect(matchesGlob("*", "qualquer.txt")).toBe(true)
    expect(matchesGlob("*.csv", ".csv")).toBe(true)
    expect(matchesGlob("a.c", "abc")).toBe(false)
    expect(matchesGlob("[a].csv", "[a].csv")).toBe(true)
  })

  it("padrão com muitas `*` contra nome longo termina na hora (era retrocesso exponencial: 64 s)", () => {
    const started = performance.now()
    expect(matchesGlob("*a*a*a*a*a*a*a*a*ab", "a".repeat(255))).toBe(false)
    expect(matchesGlob(`${"*a".repeat(40)}*`, "a".repeat(255))).toBe(true)
    expect(performance.now() - started).toBeLessThan(50)
  })
})
