import { describe, expect, it } from "vitest"
import { contextLevelOf, contextMatches, levelsFor, populationMatches, practiceProductOf, productMatches, selectedFromOf, SELECTION_LEVELS } from "./selection-levels.js"

/** `BEST_PRACTICE_SELECTION_V1` — ordem do recuo, casamento por nível e "de onde veio" (domínio puro). */
const placement = { teamId: "g1", teamName: "Atendimento", subteamId: "s1", subteamName: "Célula A" }
const ctx = (reason: string, subReason: string | null, level?: "REASON" | "SUB_REASON") => ({ cellKey: level === "REASON" || (!level && subReason === null) ? reason : `${reason} › ${subReason ?? "(sem submotivo)"}`, reason, subReason, ...(level ? { level } : {}) })

describe("BEST_PRACTICE_SELECTION_V1 — níveis do recuo", () => {
  it("amplia primeiro as pessoas e só depois o tipo de chamada; sem Subgrupo no cadastro, só os níveis do Grupo", () => {
    expect(SELECTION_LEVELS.map((level) => `${level.population}/${level.context}`)).toEqual(["SUBGROUP/SUB_REASON", "GROUP/SUB_REASON", "SUBGROUP/REASON", "GROUP/REASON"])
    expect(levelsFor({ subteamId: null }).map((level) => `${level.population}/${level.context}`)).toEqual(["GROUP/SUB_REASON", "GROUP/REASON"])
  })

  it("no nível do submotivo casa o mesmo motivo e submotivo; no do motivo, só contexto medido por motivo", () => {
    const subject = { reason: "Faturamento", subReason: "Segunda via" }
    expect(contextMatches(ctx("Faturamento", "Segunda via", "SUB_REASON"), subject, "SUB_REASON")).toBe(true)
    expect(contextMatches(ctx("faturamento ", "SEGUNDA VIA", "SUB_REASON"), subject, "SUB_REASON")).toBe(true)
    expect(contextMatches(ctx("Faturamento", "Contestação", "SUB_REASON"), subject, "SUB_REASON")).toBe(false)
    // Contexto por submotivo nunca vale como o motivo inteiro, e o do motivo nunca vale no nível do submotivo.
    expect(contextMatches(ctx("Faturamento", "Contestação", "SUB_REASON"), subject, "REASON")).toBe(false)
    expect(contextMatches(ctx("Faturamento", null, "REASON"), subject, "SUB_REASON")).toBe(false)
    expect(contextMatches(ctx("Faturamento", null, "REASON"), subject, "REASON")).toBe(true)
    expect(contextMatches(ctx("Reparo", null, "REASON"), subject, "REASON")).toBe(false)
  })

  it("\"(sem submotivo)\" é do nível do submotivo: casa a chamada sem submotivo, nunca vale como o motivo inteiro", () => {
    const semSubmotivo = ctx("Faturamento", null, "SUB_REASON")
    expect(semSubmotivo.cellKey).toBe("Faturamento › (sem submotivo)")
    expect(contextMatches(semSubmotivo, { reason: "Faturamento", subReason: null }, "SUB_REASON")).toBe(true)
    expect(contextMatches(semSubmotivo, { reason: "Faturamento", subReason: "Segunda via" }, "REASON")).toBe(false)
  })

  it("contexto gravado antes da V2 (sem o nível) é lido pela chave", () => {
    expect(contextLevelOf({ cellKey: "Faturamento › Segunda via" })).toBe("SUB_REASON")
    expect(contextLevelOf({ cellKey: "Faturamento › (sem submotivo)" })).toBe("SUB_REASON")
    expect(contextLevelOf({ cellKey: "Faturamento" })).toBe("REASON")
  })

  it("população: padrão do Subgrupo da pessoa no nível do subgrupo; padrão do Grupo (sem Subgrupo) no nível do grupo", () => {
    expect(populationMatches({ teamId: "g1", subteamId: "s1" }, placement, "SUBGROUP")).toBe(true)
    expect(populationMatches({ teamId: "g1", subteamId: "s2" }, placement, "SUBGROUP")).toBe(false)
    expect(populationMatches({ teamId: "g1", subteamId: "s1" }, placement, "GROUP")).toBe(false)
    expect(populationMatches({ teamId: "g1", subteamId: null }, placement, "GROUP")).toBe(true)
    expect(populationMatches({ teamId: "g2", subteamId: null }, placement, "GROUP")).toBe(false)
    expect(populationMatches({ teamId: "g1", subteamId: "s1" }, { ...placement, subteamId: null }, "SUBGROUP")).toBe(false)
  })

  it("a prática diz de onde veio: população, assunto e resultado", () => {
    const subject = { reason: "Faturamento", subReason: "Segunda via" }
    expect(selectedFromOf({ level: SELECTION_LEVELS[0]!, placement, subject, outcomeName: "TMA" }).text).toBe("Dos operadores com melhor TMA do seu subgrupo (Célula A), em chamadas de Segunda via.")
    expect(selectedFromOf({ level: SELECTION_LEVELS[3]!, placement, subject, outcomeName: "TMA" }).text).toBe("Dos operadores com melhor TMA do seu grupo (Atendimento), em chamadas de Faturamento.")
    expect(selectedFromOf({ level: SELECTION_LEVELS[1]!, placement, subject: { reason: "Faturamento", subReason: null }, outcomeName: "Nota da URA" }).subjectLabel).toBe("Faturamento")
  })

  it("pelo sinal da chamada, \"os melhores\" são as chamadas com resultado bom — nunca \"operadores com melhores resultados\"", () => {
    const from = selectedFromOf({ level: SELECTION_LEVELS[0]!, placement, subject: { reason: "Faturamento", subReason: "Segunda via" }, outcomeName: "Nota da URA", outcomeKind: "CALL_SIGNAL" })
    expect(from.text).toBe("Das chamadas de Segunda via com resultado bom em Nota da URA, no seu subgrupo (Célula A).")
    expect(from.text).not.toMatch(/operadores/)
  })
})

describe("BEST_PRACTICE_SELECTION_V2 — produto da prática", () => {
  it("um produto só, na maior parte das chamadas em que apareceu = deste produto; vários ou poucos com produto = geral", () => {
    expect(practiceProductOf({ presentCalls: 4, callsWithProduct: 3, products: ["Banda Larga", "banda larga ", "Banda Larga"] })).toBe("Banda Larga")
    expect(practiceProductOf({ presentCalls: 4, callsWithProduct: 4, products: ["Banda Larga", "IP Dedicado"] })).toBeNull()
    expect(practiceProductOf({ presentCalls: 5, callsWithProduct: 2, products: ["Banda Larga", "Banda Larga"] })).toBeNull()
    expect(practiceProductOf({ presentCalls: 0, callsWithProduct: 0, products: [] })).toBeNull()
  })

  it("prática de um produto só casa com feedback desse produto; a geral casa com qualquer um, inclusive sem produto", () => {
    expect(productMatches("Banda Larga", ["IP Dedicado", "banda larga"])).toBe(true)
    expect(productMatches("Banda Larga", ["IP Dedicado"])).toBe(false)
    expect(productMatches("Banda Larga", [])).toBe(false)
    expect(productMatches(null, [])).toBe(true)
  })
})
