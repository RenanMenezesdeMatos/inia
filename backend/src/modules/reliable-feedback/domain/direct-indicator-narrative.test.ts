import { describe, expect, it } from "vitest"
import { causalIndicatorClaims, strategyProhibitedClaims } from "./indicator-diagnosis-claims.js"
import { deterministicPrvNarrative, prvTextViolations, type PrvNarrativeBrief } from "./prv-closing-views.js"

/**
 * INDICATOR DIAGNOSIS V2 — NO_CAUSAL_UPGRADE e frases proibidas pela estratégia no texto do diagnóstico DIRETO (Rechamada V1).
 * Associação ("nas interações marcadas, X aparece") nunca vira causa ("X causou as rechamadas"), com o termo no plural, verbo de
 * efeito sem "porque" ou promessa de redução. O texto do sistema nunca é causal e nunca fala em "fechamento do PRV".
 */
const brief: PrvNarrativeBrief = {
  itemsKey: "k",
  cycle: "agosto de 2026",
  source: "DIRECT_INDICATOR",
  sharedTopics: [],
  indicators: [{
    code: "RECHAMADA",
    name: "Rechamada",
    result: "14,6%",
    target: "10,0%",
    position: "fora da meta",
    quartile: "Q4",
    previous: "9,8%, quartil Q2 (julho de 2026)",
    motive: "Contestação de cobrança",
    conclusion: "MIX_SHIFT",
    mix: null,
    adjust: [],
    maintain: [],
    cannotConclude: [],
    signal: { label: "rechamada", interactions: 48, signaled: 7, rate: "14,6%", status: "CONCENTRATED", concentration: { motive: "Contestação de cobrança", signaled: 5, share: "71,4%", motiveInteractions: 14, motiveRate: "35,7%", othersRate: "5,9%" }, previous: { period: "julho de 2026", signaled: 3, interactions: 44, rate: "6,8%" }, shift: { motive: "Contestação de cobrança", before: "33,3%", now: "71,4%" } },
    evidenceUnavailable: true,
    prohibitedClaims: ["reduzirá a rechamada"],
  }],
}

describe("V2 — NO_CAUSAL_UPGRADE (genérico, pelo nome do indicador e pelo sinal)", () => {
  const upgrades = [
    "As rechamadas aconteceram porque o prazo não foi informado.",
    "Isso provocou as rechamadas deste mês.",
    "Esse comportamento aumentou a rechamada.",
    "Fazer isso reduzirá a rechamada.",
    "Informar o prazo evita novas rechamadas.",
  ]
  it.each(upgrades)("bloqueia: %s", (text) => {
    expect(causalIndicatorClaims(text, { name: "Rechamada", code: "RECHAMADA" }, ["rechamada"])).not.toEqual([])
    expect(prvTextViolations(text, brief, "COLLABORATOR", { firstName: null })).toContain("CAUSAL_CLAIM")
  })
  it("fato de composição passa (associação descrita, sem causa)", () => {
    const facts = ["Das 48 interações que você atendeu no período, 7 chegaram marcadas como rechamada (14,6%).", "Contestação de cobrança reuniu 5 delas."]
    for (const text of facts) expect(prvTextViolations(text, brief, "COLLABORATOR", { firstName: null })).not.toContain("CAUSAL_CLAIM")
  })
  it("frase proibida pela ESTRATÉGIA é recusada por código (sem acento/caixa)", () => {
    expect(strategyProhibitedClaims("Se você fizer isso, REDUZIRA A RECHAMADA.", ["reduzirá a rechamada"])).toEqual(["reduzirá a rechamada"])
    expect(prvTextViolations("Isso reduzirá a rechamada.", brief, "COLLABORATOR", { firstName: null })).toContain("STRATEGY_PROHIBITED_CLAIM")
  })
})

describe("V2 — texto do SISTEMA do diagnóstico direto", () => {
  const narrative = deterministicPrvNarrative(brief)
  const text = [...narrative.paragraphs, narrative.card].join(" ")
  it("resultado oficial + onde o sinal aparece + limitação do vínculo; nunca 'fechamento do PRV', nunca causa, nunca ação sem base", () => {
    expect(narrative.paragraphs[0]).toBe("Em agosto de 2026, o resultado oficial de Rechamada foi de 14,6%, fora da meta de 10,0% (quartil oficial Q4). No período anterior, foi de 9,8%, quartil Q2 (julho de 2026).")
    expect(text).toContain("Das 48 interações que você atendeu no período, 7 chegaram marcadas como rechamada (14,6%). Contestação de cobrança reuniu 5 delas")
    expect(text).toContain("não indicam qual atendimento anterior o originou nem quem atendeu")
    expect(text).not.toMatch(/fechamento|PRV|porque|por causa|causou|provocou|reduzir|próximas chamadas/i)
    expect(prvTextViolations(narrative.paragraphs.join("\n"), brief, "COLLABORATOR", { firstName: null }).filter((violation) => violation !== "UNSUPPORTED_NUMBER")).toEqual([])
  })
})
