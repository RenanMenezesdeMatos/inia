import { describe, expect, it } from "vitest"
import { compareImpact, summarizeImpact, type ImpactDecision, type ImpactEvaluation } from "./impact-preview.js"

const RULES = [
  { key: "R1", name: "Pior quartil em 3 fechamentos", priority: 1 },
  { key: "R2", name: "Sem evolução depois do feedback", priority: 2 },
]
const lead = (id: string) => ({ personId: id, name: `Líder ${id}` })
const decision = (over: Partial<ImpactDecision>): ImpactDecision => ({ typeKey: "PLANO", typeName: "Plano de ação", status: "CREATED", sensitive: false, responsible: lead("L1"), problem: null, ...over })
function person(id: string, over: Partial<ImpactEvaluation> & { met?: string[]; unknown?: string[] } = {}): ImpactEvaluation {
  const { met = [], unknown = [], ...rest } = over
  return {
    person: { id, name: `Pessoa ${id}`, teamName: "Retenção" },
    outcome: "NO_MATCH",
    rules: RULES.map((rule) => ({ ...rule, status: met.includes(rule.key) ? "MET" : unknown.includes(rule.key) ? "INCONCLUSIVE" : "NOT_MET" })),
    selected: [...met.map((ruleKey) => ({ ruleKey, mode: "MATCHED" as const })), ...unknown.map((ruleKey) => ({ ruleKey, mode: "INCONCLUSIVE" as const }))],
    decisions: [],
    ...rest,
  }
}

describe("summarizeImpact", () => {
  const evaluations = [
    person("A", { met: ["R1"], outcome: "CREATED", decisions: [decision({})] }),
    person("B", { met: ["R1"], outcome: "PENDING_APPROVAL", decisions: [decision({ typeKey: "CONT", typeName: "Avaliação de continuidade", status: "PENDING_APPROVAL", sensitive: true, responsible: lead("L2") })] }),
    person("C", { met: ["R2"], outcome: "NOTIFIED", decisions: [decision({ typeKey: "AVISO", typeName: "Lado a lado", status: "NOTIFIED" })] }),
    person("D", { met: ["R1"], outcome: "EXISTING", decisions: [decision({ status: "EXISTING" })] }),
    person("E", { met: ["R1"], outcome: "SUPPRESSED", decisions: [decision({ status: "SUPPRESSED" })] }),
    person("F", { unknown: ["R1"], outcome: "INCONCLUSIVE" }),
    person("G", { unknown: ["R1"], outcome: "INCONCLUSIVE", decisions: [decision({ typeKey: "INV", typeName: "Investigar causa", status: "RECOMMENDED", responsible: null, problem: "Sem líder na cadeia." })] }),
    person("H"),
  ]
  const summary = summarizeImpact(evaluations)

  it("coloca cada pessoa em uma linha, pelo que aconteceria com ela", () => {
    expect(summary.evaluated).toBe(8)
    expect(summary.people).toEqual({ withNewFollowUp: 3, onlyNotified: 1, alreadyFollowed: 1, suppressed: 1, inconclusive: 1, noMatch: 1, conflict: 0, notApplicable: 0 })
    expect(Object.values(summary.people).reduce((sum, value) => sum + value, 0)).toBe(summary.evaluated)
  })

  it("conta dado insuficiente à parte, nunca como regra atendida", () => {
    expect(summary.insufficientData).toBe(2)
    expect(summary.rules[0]).toMatchObject({ key: "R1", met: 4, inconclusive: 2, notMet: 2, decided: 4 })
    expect(summary.rules[1]).toMatchObject({ key: "R2", met: 1, inconclusive: 0, notMet: 7, decided: 1 })
  })

  it("soma o que nasceria por formato e destaca a sugestão de continuidade", () => {
    expect(summary.formats.find((row) => row.typeKey === "PLANO")).toMatchObject({ created: 1, existing: 1, suppressed: 1 })
    expect(summary.formats.find((row) => row.typeKey === "CONT")).toMatchObject({ sensitive: true, pendingApproval: 1 })
    expect(summary.continuitySuggestions).toBe(1)
  })

  it("soma por líder só o que chega a ele e aponta destinatário não encontrado", () => {
    expect(summary.leaders.distinct).toBe(2)
    expect(summary.leaders.top[0]).toEqual({ personId: "L1", name: "Líder L1", opened: 1, notified: 1 })
    expect(summary.unresolvedRecipients).toBe(1)
  })

  it("lista primeiro quem teria alguma ação e depois quem só ficou sem dado, por nome", () => {
    expect(summary.affected.total).toBe(7)
    expect(summary.affected.items.map((item) => item.id)).toEqual(["A", "B", "C", "D", "E", "G", "F"])
    expect(summary.affected.items[0]).toMatchObject({ rules: ["Pior quartil em 3 fechamentos"], decisions: [{ typeName: "Plano de ação", status: "CREATED" }] })
  })
})

describe("compareImpact", () => {
  it("compara por pessoa quem passa a receber, deixa de receber ou continua", () => {
    const acts = [decision({})]
    const target = [person("A", { decisions: acts }), person("B"), person("C", { decisions: acts }), person("D", { decisions: [decision({ status: "EXISTING" })] }), person("Z", { decisions: acts })]
    const baseline = [person("A"), person("B", { decisions: acts }), person("C", { decisions: [decision({ status: "NOTIFIED" })] }), person("D")]
    expect(compareImpact(target, baseline)).toEqual({ compared: 4, gained: 1, lost: 1, kept: 1 })
  })
})
