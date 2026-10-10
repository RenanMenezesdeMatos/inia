import { describe, expect, it } from "vitest"
import { checkFactPreservation, criticalFactsOf, extractDecisionSignals } from "./decision-critical-facts.js"
import { gateSynthesis } from "./evidence-gating.js"
import type { LedgerEntry } from "./evidence-ledger.js"

const entry = (ref: string, tool: string, signals: LedgerEntry["signals"]): LedgerEntry => ({ ref, sequence: 1, round: 0, tool, capability: "INDICATOR_ANALYSIS", keyArgs: "", summary: `fato ${ref}`, qualityStatus: "SUFFICIENT", qualityNote: null, sampleCount: 21, periodLabel: null, preflight: true, signals })
const objective = { kind: "EXPLAIN_INDICATOR_DEVIATION" as const, question: "?", requiredScope: null, causal: true }
const ledger = [entry("F1", "get_indicator_snapshot", { withinTarget: false }), entry("F2", "compare_periods", { performance: "IMPROVED" }), entry("F3", "compare_population", { performance: "WORSE_THAN_REFERENCE" }), entry("F4", "validate_data_quality", { dataQuality: "SUFFICIENT" })]

describe("decision critical facts + fact preservation (§28–30, §56)", () => {
  it("sinais determinísticos saem dos resultados das Tools (nunca do texto do modelo) e viram fatos críticos por tipo", () => {
    expect(extractDecisionSignals("compare_periods", { performanceDirection: "IMPROVED" })).toEqual({ performance: "IMPROVED" })
    expect(extractDecisionSignals("get_indicator_snapshot", { target: { withinTarget: false } })).toEqual({ withinTarget: false })
    expect(extractDecisionSignals("get_employee_history", { changeFirstToLast: { performance: "DECLINED" } })).toEqual({ performance: "DECLINED" })
    expect(extractDecisionSignals("find_interactions", { total: 2 })).toBeNull()
    expect(criticalFactsOf(ledger, objective).map((fact) => [fact.ref, fact.kind])).toEqual([["F1", "INDICATOR_STATE"], ["F2", "TREND"], ["F3", "COMPARISON"]])
    expect(criticalFactsOf(ledger, { kind: "FEEDBACK_SINGLE_INTERACTION", question: "?", requiredScope: "INTERACTION_SPECIFIC", causal: false })).toEqual([])
  })

  it("fato crítico IMPROVED: 'houve melhora relevante' passa sem repetir números; 'o TMA vem piorando' é contradição; fato não considerado é apontado", () => {
    const facts = criticalFactsOf(ledger, objective)
    expect(checkFactPreservation({ criticalFacts: facts, consideredCriticalFacts: ["F1", "F2", "F3"], text: "Houve melhora relevante em relação ao mês anterior, mas o resultado segue acima da meta e da referência do subgrupo.", criticalLimitationRequired: false, limitationsDeclared: 0 })).toEqual([])
    const contradiction = checkFactPreservation({ criticalFacts: facts, consideredCriticalFacts: ["F1", "F2", "F3"], text: "Seu TMA vem piorando mês a mês e está dentro da meta.", criticalLimitationRequired: false, limitationsDeclared: 0 })
    expect(contradiction.map((item) => item.reason)).toEqual([expect.stringContaining("FORA da meta"), expect.stringContaining("MELHORA")])
    const missing = checkFactPreservation({ criticalFacts: facts, consideredCriticalFacts: ["F1"], text: "ok", criticalLimitationRequired: true, limitationsDeclared: 0 })
    expect(missing.map((item) => item.text)).toEqual(["F2 (tendência), F3 (comparação com a referência)", "limitações"])
  })

  it("no gating: contradição é rejeição CRITICAL_FACT (uma correção pelo mesmo mecanismo); sem fatos críticos nada muda", () => {
    const synthesis = { supportedHypotheses: [], unsupportedHypotheses: [], limitations: ["amostra pequena"], behavioralClaims: [], recommendationSupport: [], consideredCriticalFacts: ["F1", "F2", "F3"] }
    const rejected = gateSynthesis(synthesis, { ledger, knowledgeAvailable: true, criticalFacts: criticalFactsOf(ledger, objective), objective }, "O indicador piorou frente a julho.")
    expect(rejected).toEqual([{ kind: "CRITICAL_FACT", text: "F2 (tendência)", reason: expect.stringContaining("MELHORA") }])
    expect(gateSynthesis(synthesis, { ledger, knowledgeAvailable: true, criticalFacts: criticalFactsOf(ledger, objective), objective }, "Houve melhora frente a julho.")).toEqual([])
    expect(gateSynthesis({ ...synthesis, consideredCriticalFacts: [] }, { ledger, knowledgeAvailable: true }, "piorou")).toEqual([])
  })
})
