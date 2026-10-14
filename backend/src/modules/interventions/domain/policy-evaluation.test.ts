import { describe, expect, it } from "vitest"
import { emptyInterventionTypeDefinition, type InterventionTypeDefinition } from "./intervention-type.js"
import { INTERVENTION_POLICY_SCHEMA_VERSION, type PolicyAction, type PolicyCondition, type PolicyDefinition, type PolicyRule } from "./policy-definition.js"
import { aggregateOutcome, buildJustification, combineStatuses, evaluateGroup, planDecisions, selectRules, type CatalogType, type ConditionOutcome, type ConditionStatus, type RuleTrace } from "./policy-evaluation.js"

const action = (typeKey: string, extra: Partial<PolicyAction> = {}): PolicyAction => ({ typeKey, effect: "OPEN", dueInDays: null, onActive: "KEEP", cooldownDays: 0, ...extra })
const condition: PolicyCondition = { kind: "PUBLISHED_FEEDBACK", feedbackKind: null, indicatorCode: null, withinDays: 30, comparator: "GTE", threshold: 1 }
const rule = (key: string, priority: number, actions: PolicyAction[], extra: Partial<PolicyRule> = {}): PolicyRule => ({ key, name: `Regra ${key}`, priority, justification: `Porque ${key}.`, when: { operator: "ALL", items: [condition] }, actions, inconclusiveActions: [], ...extra })
const policy = (rules: PolicyRule[], matchStrategy: PolicyDefinition["matchStrategy"] = "FIRST_MATCH"): PolicyDefinition => ({ schemaVersion: INTERVENTION_POLICY_SCHEMA_VERSION, description: "", indicatorCode: "TMA", matchStrategy, rules, report: { aiNarrative: false } })
const trace = (key: string, priority: number, status: ConditionStatus): RuleTrace => ({ key, name: `Regra ${key}`, priority, status, trace: { type: "GROUP", path: "when", operator: "ALL", status, items: [] } })
const type = (key: string, extra: Partial<InterventionTypeDefinition> = {}): CatalogType => ({ typeId: `type-${key}`, versionId: `v-${key}`, key, definition: { ...emptyInterventionTypeDefinition(key), ...extra } })
const types = (...items: CatalogType[]) => new Map(items.map((item) => [item.key, item]))
const NOW = new Date("2026-10-13T12:00:00Z")
const outcome = (status: ConditionStatus): ConditionOutcome => ({ status, summary: status, facts: {}, references: [] })

describe("lógica de três estados (Kleene)", () => {
  it("ALL: qualquer NÃO decide; senão inconclusiva domina; dado ausente nunca vira 'não'", () => {
    expect(combineStatuses("ALL", ["MET", "MET"])).toBe("MET")
    expect(combineStatuses("ALL", ["MET", "INCONCLUSIVE"])).toBe("INCONCLUSIVE")
    expect(combineStatuses("ALL", ["INCONCLUSIVE", "NOT_MET"])).toBe("NOT_MET")
  })
  it("ANY: qualquer SIM decide; senão inconclusiva domina", () => {
    expect(combineStatuses("ANY", ["NOT_MET", "MET"])).toBe("MET")
    expect(combineStatuses("ANY", ["NOT_MET", "INCONCLUSIVE"])).toBe("INCONCLUSIVE")
    expect(combineStatuses("ANY", ["NOT_MET", "NOT_MET"])).toBe("NOT_MET")
  })
  it("avalia grupos aninhados sem curto-circuito (retrato completo)", async () => {
    const seen: string[] = []
    const result = await evaluateGroup({ operator: "ANY", items: [condition, { operator: "ALL", items: [condition, condition] }] }, async () => {
      seen.push("x")
      return outcome(seen.length === 1 ? "MET" : "INCONCLUSIVE")
    })
    expect(result.status).toBe("MET")
    expect(seen).toHaveLength(3)
    expect(result.items[1]).toMatchObject({ type: "GROUP", status: "INCONCLUSIVE" })
  })
})

describe("seleção de regras pela prioridade explícita", () => {
  const definition = policy([rule("R2", 2, [action("ORIENTAR")]), rule("R1", 1, [action("TREINAR")]), rule("R3", 3, [action("OBSERVAR")])])
  it("FIRST_MATCH: a primeira por prioridade que bate decide (não a 'mais severa')", () => {
    const selection = selectRules(definition, [trace("R1", 1, "NOT_MET"), trace("R2", 2, "MET"), trace("R3", 3, "MET")])
    expect(selection.status).toBe("MATCHED")
    expect(selection.selected.map((item) => item.rule.key)).toEqual(["R2"])
  })
  it("FIRST_MATCH: regra de prioridade maior INCONCLUSIVA bloqueia — nunca cai para a de baixo por falta de dado", () => {
    const selection = selectRules(definition, [trace("R1", 1, "INCONCLUSIVE"), trace("R2", 2, "MET"), trace("R3", 3, "MET")])
    expect(selection.status).toBe("INCONCLUSIVE")
    expect(selection.blockedBy).toBe("R1")
    expect(selection.selected).toEqual([{ rule: expect.objectContaining({ key: "R1" }), mode: "INCONCLUSIVE" }])
  })
  it("ALL_MATCHES: todas as que batem; inconclusivas só com as ações de inconclusivo", () => {
    const selection = selectRules({ ...definition, matchStrategy: "ALL_MATCHES" }, [trace("R1", 1, "MET"), trace("R2", 2, "INCONCLUSIVE"), trace("R3", 3, "MET")])
    expect(selection.status).toBe("MATCHED")
    expect(selection.selected.map((item) => [item.rule.key, item.mode])).toEqual([["R1", "MATCHED"], ["R2", "INCONCLUSIVE"], ["R3", "MATCHED"]])
  })
  it("sem regra atendida e sem inconclusiva = NO_MATCH", () => {
    expect(selectRules(definition, [trace("R1", 1, "NOT_MET"), trace("R2", 2, "NOT_MET"), trace("R3", 3, "NOT_MET")]).status).toBe("NO_MATCH")
  })
})

describe("plano de decisões por ação", () => {
  const catalog = types(type("TREINAR"), type("ORIENTAR"), type("PLANO", { approval: { required: true, approverRole: "COORDINATOR" } }), type("RECONHECER", { incompatibleWith: ["PLANO"] }))
  const base = { subjectKey: "INDICATOR:TMA", types: catalog, active: [], closed: [], now: NOW, recommendOnly: false }

  it("várias intervenções na mesma avaliação, cada uma com seu resultado (um global não esconde as diferenças)", () => {
    const definition = policy([rule("R1", 1, [action("TREINAR"), action("PLANO"), action("ORIENTAR", { effect: "RECOMMEND" })])])
    const selection = selectRules(definition, [trace("R1", 1, "MET")])
    const decisions = planDecisions({ ...base, selection, active: [{ id: "ativa", typeKey: "TREINAR", subjectKey: "INDICATOR:TMA", status: "IN_PROGRESS" }] })
    expect(decisions.map((decision) => [decision.typeKey, decision.status])).toEqual([["TREINAR", "EXISTING"], ["PLANO", "PENDING_APPROVAL"], ["ORIENTAR", "RECOMMENDED"]])
    expect(aggregateOutcome(selection, decisions)).toBe("PENDING_APPROVAL")
  })

  it("mesmo tipo pedido por duas regras = UMA decisão, vale a de maior prioridade", () => {
    const definition = policy([rule("R1", 1, [action("ORIENTAR", { effect: "RECOMMEND" })]), rule("R2", 2, [action("ORIENTAR", { effect: "OPEN" })])], "ALL_MATCHES")
    const decisions = planDecisions({ ...base, selection: selectRules(definition, [trace("R1", 1, "MET"), trace("R2", 2, "MET")]) })
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({ ruleKey: "R1", alsoRequestedBy: ["R2"], status: "RECOMMENDED" })
  })

  it("ações incompatíveis: NADA é aplicado (conflito explícito), nunca escolhe uma das duas", () => {
    const definition = policy([rule("R1", 1, [action("PLANO")]), rule("R2", 2, [action("RECONHECER")])], "ALL_MATCHES")
    const selection = selectRules(definition, [trace("R1", 1, "MET"), trace("R2", 2, "MET")])
    const decisions = planDecisions({ ...base, selection })
    expect(decisions.every((decision) => decision.status === "CONFLICT")).toBe(true)
    expect(aggregateOutcome(selection, decisions)).toBe("CONFLICT")
  })

  it("incompatível com uma intervenção ATIVA de outra política também é conflito", () => {
    const definition = policy([rule("R1", 1, [action("RECONHECER")])])
    const decisions = planDecisions({ ...base, selection: selectRules(definition, [trace("R1", 1, "MET")]), active: [{ id: "x", typeKey: "PLANO", subjectKey: "POLICY:OUTRA", status: "IN_PROGRESS" }] })
    expect(decisions[0]?.status).toBe("CONFLICT")
  })

  it("carência: encerrada há menos de N dias não reabre (SUPPRESSED); depois disso abre", () => {
    const definition = policy([rule("R1", 1, [action("ORIENTAR", { cooldownDays: 30 })])])
    const selection = selectRules(definition, [trace("R1", 1, "MET")])
    const recent = planDecisions({ ...base, selection, closed: [{ id: "c", typeKey: "ORIENTAR", subjectKey: "INDICATOR:TMA", closedAt: "2026-10-01T12:00:00Z" }] })
    expect(recent[0]?.status).toBe("SUPPRESSED")
    const old = planDecisions({ ...base, selection, closed: [{ id: "c", typeKey: "ORIENTAR", subjectKey: "INDICATOR:TMA", closedAt: "2026-08-01T12:00:00Z" }] })
    expect(old[0]?.status).toBe("CREATED")
  })

  it("ativa com a mesma identidade: KEEP mantém, UPDATE registra o sinal", () => {
    const active = [{ id: "ativa", typeKey: "ORIENTAR", subjectKey: "INDICATOR:TMA", status: "PROPOSED" }]
    const keep = planDecisions({ ...base, active, selection: selectRules(policy([rule("R1", 1, [action("ORIENTAR")])]), [trace("R1", 1, "MET")]) })
    const update = planDecisions({ ...base, active, selection: selectRules(policy([rule("R1", 1, [action("ORIENTAR", { onActive: "UPDATE" })])]), [trace("R1", 1, "MET")]) })
    expect(keep[0]).toMatchObject({ status: "EXISTING", existingInterventionId: "ativa", updated: false })
    expect(update[0]).toMatchObject({ status: "EXISTING", updated: true })
  })

  it("'Somente recomendar' nasce PROPOSTA mesmo quando a regra abriria; o contrário nunca acontece", () => {
    const definition = policy([rule("R1", 1, [action("PLANO"), action("ORIENTAR", { effect: "RECOMMEND" })])])
    const decisions = planDecisions({ ...base, recommendOnly: true, selection: selectRules(definition, [trace("R1", 1, "MET")]) })
    expect(decisions.map((decision) => decision.status)).toEqual(["RECOMMENDED", "RECOMMENDED"])
  })

  it("avaliação inconclusiva continua INCONCLUSIVA no agregado, mesmo abrindo a revisão de dados", () => {
    const definition = policy([rule("R1", 1, [action("TREINAR")], { inconclusiveActions: [action("ORIENTAR")] })])
    const selection = selectRules(definition, [trace("R1", 1, "INCONCLUSIVE")])
    const decisions = planDecisions({ ...base, selection })
    expect(decisions.map((decision) => [decision.typeKey, decision.mode, decision.status])).toEqual([["ORIENTAR", "INCONCLUSIVE", "CREATED"]])
    expect(aggregateOutcome(selection, decisions)).toBe("INCONCLUSIVE")
  })

  it("justificativa reproduzível: mesma entrada, mesmo texto, com prioridade, condições e decisão por ação", () => {
    const definition = policy([rule("R1", 1, [action("ORIENTAR")])])
    const rules = [trace("R1", 1, "MET")]
    const selection = selectRules(definition, rules)
    const decisions = planDecisions({ ...base, selection })
    const once = buildJustification({ policyName: "P", policyVersion: 3, matchStrategy: "FIRST_MATCH", rules, selection, decisions, outcome: aggregateOutcome(selection, decisions), definition })
    const twice = buildJustification({ policyName: "P", policyVersion: 3, matchStrategy: "FIRST_MATCH", rules, selection, decisions, outcome: aggregateOutcome(selection, decisions), definition })
    expect(once).toBe(twice)
    expect(once).toContain('Política "P" v3')
    expect(once).toContain("Regra 1 · Regra R1 (R1): atendida.")
    expect(once).toContain("Ação: ORIENTAR — aberta.")
  })
})
