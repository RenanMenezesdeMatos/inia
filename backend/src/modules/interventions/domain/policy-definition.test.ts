import { describe, expect, it } from "vitest"
import { emptyInterventionTypeDefinition, interventionTypeDefinitionSchema, scriptItemsOf, validateInterventionType, type InterventionTypeDefinition } from "./intervention-type.js"
import { groupRequires, INTERVENTION_POLICY_SCHEMA_VERSION, policyDefinitionSchema, validatePolicyDefinition, type PolicyCondition, type PolicyDefinition, type PolicyRule, type PolicyValidationCatalog } from "./policy-definition.js"

const definitionOf = (name: string, extra: Partial<InterventionTypeDefinition> = {}): InterventionTypeDefinition => ({ ...emptyInterventionTypeDefinition(name), ...extra })
const catalog = (types: Record<string, InterventionTypeDefinition>): PolicyValidationCatalog => ({
  types: new Map(Object.entries(types).map(([key, definition]) => [key, { active: true, definition }])),
  allTypeKeys: new Set(Object.keys(types)),
  competencyKeys: new Set(["ATENDIMENTO_CONSULTIVO"]),
  indicators: new Map([["TMA", { active: true }]]),
  flags: new Map([["VOICE:rechamada", { valueType: "BOOLEAN" as const, active: true }], ["VOICE:nota_ura", { valueType: "NUMERIC" as const, active: true }], ["VOICE:antiga", { valueType: "BOOLEAN" as const, active: false }]]),
})
const below: PolicyCondition = { kind: "INDICATOR", criterion: { comparator: "GT", historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", source: "MEASUREMENT", period: { kind: "ROLLING_DAYS", days: 30 }, compareTo: { kind: "GOAL" }, minimumCoverage: 0.6 } } }
const diagnosis: PolicyCondition = { kind: "SUPPORTED_DIAGNOSIS", indicatorCode: null, competencyKeys: [], withinDays: 90, expectation: "EXISTS" }
const action = (typeKey: string) => ({ typeKey, effect: "OPEN" as const, dueInDays: null, onActive: "KEEP" as const, cooldownDays: 0 })
const rule = (extra: Partial<PolicyRule>): PolicyRule => ({ key: "R1", name: "Regra", priority: 1, justification: "Justificativa suficiente para testes de validação.", when: { operator: "ALL", items: [below] }, actions: [], inconclusiveActions: [], ...extra })
const policy = (rules: PolicyRule[]): PolicyDefinition => ({ schemaVersion: INTERVENTION_POLICY_SCHEMA_VERSION, description: "", indicatorCode: "TMA", matchStrategy: "FIRST_MATCH", rules, report: { aiNarrative: false } })
const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code)

const TYPES = {
  OBSERVAR: definitionOf("Observar", { capabilities: ["OBSERVATION"] }),
  TREINAR: definitionOf("Treinar", { capabilities: ["TRAINING"] }),
  PLANO: definitionOf("Plano", { capabilities: ["ACTION_PLAN"] }),
  RECONHECER: definitionOf("Reconhecer", { capabilities: ["RECOGNITION"], incompatibleWith: ["PLANO"] }),
  CONTINUIDADE: definitionOf("Avaliação de continuidade", { capabilities: ["CONTINUITY_REVIEW"], approval: { required: true, approverRole: "MANAGER" }, evidence: { minimumItems: 2, acceptedKinds: ["EVALUATION", "FEEDBACK"] }, completion: { requireAllTasksDone: false, requireLearningAssessment: false, requireOperationalReading: false, requireOutcomeNote: false } }),
}

describe("roteiro do formato (os passos com que a intervenção nasce)", () => {
  const step = (extra: Partial<InterventionTypeDefinition["script"][number]> = {}): InterventionTypeDefinition["script"][number] => ({ kind: "TASK", title: "1ª sessão", description: "", owner: "RESPONSIBLE", dueInDays: 5, ...extra })

  it("passo exige a capacidade correspondente, prazo dentro do prazo do tipo e título único", () => {
    const keys = new Set(["LADO"])
    expect(validateInterventionType(definitionOf("Lado a lado", { capabilities: ["TASKS", "CHECKPOINTS"], script: [step(), step({ kind: "CHECKPOINT", title: "Leitura", dueInDays: null })] }), "LADO", keys)).toEqual([])
    expect(codes(validateInterventionType(definitionOf("Orientar", { capabilities: ["GUIDANCE"], completion: { requireAllTasksDone: false, requireLearningAssessment: false, requireOperationalReading: false, requireOutcomeNote: true }, script: [step(), step({ kind: "CHECKPOINT", title: "Leitura" })] }), "LADO", keys))).toEqual(["TYPE_SCRIPT_NEEDS_TASKS", "TYPE_SCRIPT_NEEDS_CHECKPOINTS"])
    // Plano de ação implica tarefas e checkpoints.
    expect(validateInterventionType(definitionOf("Plano", { capabilities: ["ACTION_PLAN"], script: [step(), step({ kind: "CHECKPOINT", title: "Leitura" })] }), "LADO", keys)).toEqual([])
    expect(codes(validateInterventionType(definitionOf("Lado a lado", { defaultDueDays: 10, script: [step({ dueInDays: 11 }), step({ title: " 1ª SESSÃO " })] }), "LADO", keys))).toEqual(["TYPE_SCRIPT_DUE_AFTER_DEADLINE", "TYPE_SCRIPT_STEP_DUPLICATED"])
  })

  it("os itens nascem com dono e prazo; o prazo do passo nunca passa do prazo da intervenção; versão antiga vale como roteiro vazio", () => {
    const definition = definitionOf("Lado a lado", { script: [step(), step({ title: "Aplicar", owner: "COLLABORATOR", dueInDays: 12 }), step({ kind: "CHECKPOINT", title: "Leitura", dueInDays: null })] })
    expect(scriptItemsOf(definition, { openedDay: "2026-11-18", dueAt: "2026-11-28", responsibleId: "lider", personId: "operador" })).toEqual([
      { kind: "TASK", title: "1ª sessão", description: "", ownerId: "lider", dueAt: "2026-11-23" },
      // 12 dias depois seria 30/11: fica no prazo da intervenção (a política abriu com prazo menor que o do tipo).
      { kind: "TASK", title: "Aplicar", description: "", ownerId: "operador", dueAt: "2026-11-28" },
      { kind: "CHECKPOINT", title: "Leitura", description: "", ownerId: "lider", dueAt: "2026-11-28" },
    ])
    const { script: _script, ...stored } = definition
    void _script
    expect(interventionTypeDefinitionSchema.parse(stored).script).toEqual([])
  })
})

describe("validação da política (o que torna o rascunho publicável)", () => {
  it("prioridade é única: empate é recusado (nunca decide em silêncio)", () => {
    const issues = validatePolicyDefinition(policy([rule({ key: "A", actions: [action("OBSERVAR")] }), rule({ key: "B", actions: [action("OBSERVAR")] })]), catalog(TYPES))
    expect(codes(issues)).toContain("POLICY_RULE_PRIORITY_DUPLICATED")
  })

  it("dado insuficiente nunca vira classificação: com regra inconclusiva só cabem capacidades que não classificam", () => {
    expect(codes(validatePolicyDefinition(policy([rule({ actions: [action("OBSERVAR")], inconclusiveActions: [action("PLANO")] })]), catalog(TYPES)))).toContain("POLICY_INCONCLUSIVE_ACTION_CLASSIFIES")
    expect(codes(validatePolicyDefinition(policy([rule({ actions: [action("OBSERVAR")], inconclusiveActions: [action("OBSERVAR")] })]), catalog(TYPES)))).toEqual([])
  })

  it("elegibilidade é por CAPACIDADE, não por nome: um tipo novo chamado qualquer coisa com OBSERVATION também serve", () => {
    const types = { ...TYPES, ACOMPANHAR_DE_PERTO: definitionOf("Acompanhar de perto", { capabilities: ["OBSERVATION", "CHECKPOINTS"] }) }
    expect(validatePolicyDefinition(policy([rule({ actions: [action("ACOMPANHAR_DE_PERTO")], inconclusiveActions: [action("ACOMPANHAR_DE_PERTO")] })]), catalog(types))).toEqual([])
  })

  it("treinamento (lacuna de habilidade) exige diagnóstico sustentado na regra — indicador abaixo da meta sozinho não basta", () => {
    expect(codes(validatePolicyDefinition(policy([rule({ actions: [action("TREINAR")] })]), catalog(TYPES)))).toContain("POLICY_SKILL_GAP_NEEDS_DIAGNOSIS")
    expect(validatePolicyDefinition(policy([rule({ when: { operator: "ALL", items: [below, diagnosis] }, actions: [action("TREINAR")] })]), catalog(TYPES))).toEqual([])
    // Num ANY o diagnóstico precisa estar em TODOS os ramos para ser obrigatório.
    expect(codes(validatePolicyDefinition(policy([rule({ when: { operator: "ANY", items: [below, diagnosis] }, actions: [action("TREINAR")] })]), catalog(TYPES)))).toContain("POLICY_SKILL_GAP_NEEDS_DIAGNOSIS")
  })

  it("quartil OPERACIONAL não entra em política (só o quartil oficial da fonte)", () => {
    const operational: PolicyCondition = { kind: "INDICATOR", criterion: { comparator: "EQUALS", thresholdText: "Q4", historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", source: "OPERATIONAL_QUARTILE", aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 7 } } } }
    expect(codes(validatePolicyDefinition(policy([rule({ when: { operator: "ALL", items: [operational] }, actions: [action("OBSERVAR")] })]), catalog(TYPES)))).toContain("POLICY_OPERATIONAL_QUARTILE_UNSUPPORTED")
  })

  it("quartil oficial: compara com Q1..Q4 (Q1 = melhor, Q4 = pior)", () => {
    const quartile = (thresholdText: string): PolicyCondition => ({ kind: "INDICATOR", criterion: { comparator: "EQUALS", thresholdText, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "TMA" } } })
    expect(validatePolicyDefinition(policy([rule({ when: { operator: "ALL", items: [quartile("Q4")] }, actions: [action("OBSERVAR")] })]), catalog(TYPES))).toEqual([])
    expect(codes(validatePolicyDefinition(policy([rule({ when: { operator: "ALL", items: [quartile("pior")] }, actions: [action("OBSERVAR")] })]), catalog(TYPES)))).toContain("POLICY_PERFORMANCE_QUARTILE")
  })

  it("ações incompatíveis na mesma regra nunca publicam", () => {
    expect(codes(validatePolicyDefinition(policy([rule({ when: { operator: "ALL", items: [below, diagnosis] }, actions: [action("PLANO"), action("RECONHECER")] })]), catalog(TYPES)))).toContain("POLICY_RULE_ACTIONS_INCOMPATIBLE")
  })

  it("avaliação de continuidade: nunca com dado insuficiente, exige condição verificável e justificativa", () => {
    const issues = codes(validatePolicyDefinition(policy([rule({ when: { operator: "ALL", items: [{ kind: "EMPLOYMENT", check: "CURRENTLY_ELIGIBLE", expected: true }] }, justification: "curta", actions: [action("CONTINUIDADE")], inconclusiveActions: [action("CONTINUIDADE")] })]), catalog(TYPES)))
    expect(issues).toEqual(expect.arrayContaining(["CONTINUITY_REVIEW_EVIDENCE_CONDITION", "CONTINUITY_REVIEW_JUSTIFICATION", "CONTINUITY_REVIEW_NOT_ON_INCONCLUSIVE"]))
  })

  it("avaliação de continuidade: resultado ruim sozinho nunca basta — exige acompanhamento anterior concluído sem evolução", () => {
    const prior = (overrides: Partial<Extract<PolicyCondition, { kind: "PRIOR_INTERVENTIONS" }>> = {}): PolicyCondition => ({ kind: "PRIOR_INTERVENTIONS", typeKeys: [], statuses: ["COMPLETED"], operationalResults: ["UNCHANGED", "WORSENED"], sameSubject: true, withinDays: 180, comparator: "GTE", threshold: 1, ...overrides })
    const justification = "Acompanhamento concluído sem evolução e resultado abaixo da meta: solicitar a avaliação a quem decide."
    const continuity = (items: PolicyCondition[], operator: "ALL" | "ANY" = "ALL") => codes(validatePolicyDefinition(policy([rule({ when: { operator, items }, justification, actions: [action("CONTINUIDADE")] })]), catalog(TYPES)))
    expect(continuity([below])).toContain("CONTINUITY_REVIEW_PRIOR_FOLLOW_UP")
    expect(continuity([below, prior()])).toEqual([])
    // Não vale: intervenção ainda ativa, resultado "melhorou"/"não medido", qualquer resultado, contagem que aceita zero, ou só num ramo do OU.
    expect(continuity([below, prior({ statuses: ["ACTIVE", "COMPLETED"] })])).toContain("CONTINUITY_REVIEW_PRIOR_FOLLOW_UP")
    expect(continuity([below, prior({ operationalResults: ["UNCHANGED", "NOT_MEASURED"] })])).toContain("CONTINUITY_REVIEW_PRIOR_FOLLOW_UP")
    expect(continuity([below, prior({ operationalResults: [] })])).toContain("CONTINUITY_REVIEW_PRIOR_FOLLOW_UP")
    expect(continuity([below, prior({ comparator: "GTE", threshold: 0 })])).toContain("CONTINUITY_REVIEW_PRIOR_FOLLOW_UP")
    expect(continuity([below, prior()], "ANY")).toContain("CONTINUITY_REVIEW_PRIOR_FOLLOW_UP")
  })

  it("avaliação de continuidade nunca é 'só avisar': sempre abre a solicitação decidida por pessoa autorizada", () => {
    const prior: PolicyCondition = { kind: "PRIOR_INTERVENTIONS", typeKeys: [], statuses: ["COMPLETED"], operationalResults: ["UNCHANGED"], sameSubject: true, withinDays: 180, comparator: "GTE", threshold: 1 }
    const notify = policy([rule({ when: { operator: "ALL", items: [below, prior] }, justification: "Acompanhamento concluído sem evolução e resultado abaixo da meta.", actions: [{ ...action("CONTINUIDADE"), effect: "NOTIFY" }] })])
    expect(codes(validatePolicyDefinition(notify, catalog(TYPES)))).toEqual(["CONTINUITY_REVIEW_NO_NOTIFY"])
    // Para os outros tipos, só avisar é uma escolha válida da regra.
    expect(validatePolicyDefinition(policy([rule({ actions: [{ ...action("OBSERVAR"), effect: "NOTIFY" }] })]), catalog(TYPES))).toEqual([])
  })

  it("grupos: obrigatoriedade de uma condição respeita ALL/ANY", () => {
    expect(groupRequires({ operator: "ALL", items: [below, { operator: "ANY", items: [diagnosis, diagnosis] }] }, (condition) => condition.kind === "SUPPORTED_DIAGNOSIS")).toBe(true)
    expect(groupRequires({ operator: "ANY", items: [below, diagnosis] }, (condition) => condition.kind === "SUPPORTED_DIAGNOSIS")).toBe(false)
  })

  it("nada de script: campo desconhecido no contrato é recusado pelo formato", () => {
    const parsed = policyDefinitionSchema.safeParse({ ...policy([]), rules: [{ ...rule({ actions: [action("OBSERVAR")] }), script: "drop table people" }] })
    expect(parsed.success).toBe(false)
  })
})

describe("tipo de intervenção — regras fixas da avaliação de continuidade", () => {
  const keys = new Set(Object.keys(TYPES))
  it("não é possível desligar a aprovação humana, as evidências nem liberar a IA", () => {
    const weakened = definitionOf("Continuidade", { capabilities: ["CONTINUITY_REVIEW"], approval: { required: false }, evidence: { minimumItems: 0, acceptedKinds: ["EVALUATION"] }, aiDraft: true })
    expect(codes(validateInterventionType(weakened, "CONTINUIDADE", keys))).toEqual(expect.arrayContaining(["CONTINUITY_REVIEW_APPROVAL_REQUIRED", "CONTINUITY_REVIEW_EVIDENCE_REQUIRED", "CONTINUITY_REVIEW_NO_AI"]))
  })
  it("não se mistura com capacidades de execução", () => {
    expect(codes(validateInterventionType(definitionOf("X", { capabilities: ["CONTINUITY_REVIEW", "TASKS"], approval: { required: true, approverRole: "MANAGER" } }), "X", keys))).toContain("CONTINUITY_REVIEW_EXCLUSIVE")
  })
  it("a configuração correta passa", () => {
    expect(validateInterventionType(TYPES.CONTINUIDADE, "CONTINUIDADE", keys)).toEqual([])
  })
})

describe("condição de flag de atendimento", () => {
  const flag = (extra: Partial<Extract<PolicyCondition, { kind: "INTERACTION_FLAG" }>> = {}): PolicyCondition => ({ kind: "INTERACTION_FLAG", channel: "VOICE", flagName: "rechamada", match: { type: "BOOLEAN", value: true }, withinDays: 30, measure: "COUNT", comparator: "GTE", threshold: 3, minimumInteractions: 5, ...extra })
  const withFlag = (condition: PolicyCondition) => policy([rule({ when: { operator: "ALL", items: [condition] }, actions: [action("OBSERVAR")] })])

  it("flag do catálogo, com o tipo de valor certo, publica sem pendências", () => {
    expect(validatePolicyDefinition(withFlag(flag()), catalog(TYPES))).toEqual([])
    expect(validatePolicyDefinition(withFlag(flag({ flagName: "nota_ura", match: { type: "NUMERIC", comparator: "LTE", threshold: 2 }, measure: "PERCENT", threshold: 20 })), catalog(TYPES))).toEqual([])
  })

  it("evolução desde o feedback: precisa de indicador (o da condição ou o da política) com medição diária", () => {
    const evolution = (extra: Partial<Extract<PolicyCondition, { kind: "EVOLUTION" }>> = {}): PolicyCondition => ({ kind: "EVOLUTION", indicatorCode: null, withinDays: 90, expectation: "NOT_IMPROVED", minimumImprovementPercent: 0, ...extra })
    const withEvolution = (condition: PolicyCondition, indicatorCode: string | null = "TMA") => ({ ...policy([rule({ when: { operator: "ALL", items: [condition] }, actions: [action("OBSERVAR")] })]), indicatorCode })
    expect(validatePolicyDefinition(withEvolution(evolution()), catalog(TYPES))).toEqual([])
    expect(codes(validatePolicyDefinition(withEvolution(evolution(), null), catalog(TYPES)))).toEqual(["POLICY_EVOLUTION_INDICATOR_REQUIRED"])
    expect(codes(validatePolicyDefinition(withEvolution(evolution({ indicatorCode: "NPS" })), catalog(TYPES)))).toEqual(["POLICY_INDICATOR_NOT_FOUND"])
    const withoutDaily = { ...catalog(TYPES), indicators: new Map([["TMA", { active: true, dailySupported: false }]]) }
    expect(codes(validatePolicyDefinition(withEvolution(evolution()), withoutDaily))).toEqual(["POLICY_EVOLUTION_NEEDS_DAILY"])
    expect(policyDefinitionSchema.safeParse(withEvolution(evolution({ minimumImprovementPercent: 101 }))).success).toBe(false)
  })

  it("flag inexistente, desativada, com valor do tipo errado ou percentual acima de 100 é recusada", () => {
    expect(codes(validatePolicyDefinition(withFlag(flag({ flagName: "nao_existe" })), catalog(TYPES)))).toContain("POLICY_FLAG_NOT_FOUND")
    expect(codes(validatePolicyDefinition(withFlag(flag({ flagName: "antiga" })), catalog(TYPES)))).toContain("POLICY_FLAG_INACTIVE")
    expect(codes(validatePolicyDefinition(withFlag(flag({ flagName: "nota_ura" })), catalog(TYPES)))).toContain("POLICY_FLAG_VALUE_TYPE")
    expect(codes(validatePolicyDefinition(withFlag(flag({ measure: "PERCENT", threshold: 120 })), catalog(TYPES)))).toContain("POLICY_FLAG_PERCENT")
  })

  it("contagem de atendimentos com a flag é evidência verificável para a avaliação de continuidade", () => {
    const continuity = policy([rule({ when: { operator: "ALL", items: [flag()] }, actions: [action("CONTINUIDADE")] })])
    expect(codes(validatePolicyDefinition(continuity, catalog(TYPES)))).not.toContain("CONTINUITY_REVIEW_EVIDENCE_CONDITION")
  })
})
