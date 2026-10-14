import { isConditionGroup, typesIncompatible, type PolicyAction, type PolicyCondition, type PolicyConditionGroup, type PolicyDefinition, type PolicyRule } from "./policy-definition.js"
import type { InterventionTypeDefinition } from "./intervention-type.js"

/**
 * AVALIADOR DE POLÍTICAS (`INTERVENTION_POLICY_EVALUATOR_V1`) — puro e determinístico. Os fatos chegam por um resolvedor de
 * condição (a aplicação lê o banco; a condição de indicador usa o MESMO avaliador das Conditions do Workflow). Aqui só:
 *  1. lógica de TRÊS estados (atendida / não atendida / inconclusiva) — dado ausente nunca vira desempenho ruim;
 *  2. seleção de regras pela prioridade explícita e pela estratégia da política;
 *  3. plano de decisões (identidade, deduplicação, incompatibilidade, carência) e o resultado agregado;
 *  4. justificativa textual reproduzível a partir do rastro.
 */
export const INTERVENTION_POLICY_EVALUATOR_VERSION = "INTERVENTION_POLICY_EVALUATOR_V1"

export type ConditionStatus = "MET" | "NOT_MET" | "INCONCLUSIVE"

/** Referência verificável usada pela condição (vira evidência da intervenção quando a regra bate). */
export type FactReference = { kind: "FEEDBACK" | "DIAGNOSIS" | "INDICATOR_RESULT" | "INTERVENTION" | "EMPLOYMENT" | "INTERACTION"; ref: string; label: string; occurredAt?: string | null }

export type ConditionOutcome = {
  status: ConditionStatus
  /** Frase curta e factual: "TMA (média ponderada, últimos 30 dias) = 412 s > meta 360 s". */
  summary: string
  /** Snapshot dos valores efetivamente usados (janela, amostra, cobertura, motivo de inconclusivo…). */
  facts: Record<string, unknown>
  /** Motivo de INCONCLUSIVO (ex.: BELOW_MINIMUM_COVERAGE, EMPLOYMENT_STATUS_STALE). */
  reasonCode?: string
  references: FactReference[]
}

export type ConditionResolver = (condition: PolicyCondition) => Promise<ConditionOutcome>

export type ConditionTrace = { type: "CONDITION"; path: string; kind: PolicyCondition["kind"]; outcome: ConditionOutcome }
export type GroupTrace = { type: "GROUP"; path: string; operator: "ALL" | "ANY"; status: ConditionStatus; items: (ConditionTrace | GroupTrace)[] }

/** Kleene: ALL = algum NÃO → não; senão algum ? → ?; senão sim. ANY = algum SIM → sim; senão algum ? → ?; senão não. */
export function combineStatuses(operator: "ALL" | "ANY", statuses: readonly ConditionStatus[]): ConditionStatus {
  if (operator === "ALL") {
    if (statuses.includes("NOT_MET")) return "NOT_MET"
    if (statuses.includes("INCONCLUSIVE")) return "INCONCLUSIVE"
    return "MET"
  }
  if (statuses.includes("MET")) return "MET"
  if (statuses.includes("INCONCLUSIVE")) return "INCONCLUSIVE"
  return "NOT_MET"
}

/** Avalia TODAS as condições (sem curto-circuito): a avaliação guarda o retrato completo, não só o que decidiu. */
export async function evaluateGroup(group: PolicyConditionGroup, resolve: ConditionResolver, path = "when"): Promise<GroupTrace> {
  const items: (ConditionTrace | GroupTrace)[] = []
  for (const [index, item] of group.items.entries()) {
    const itemPath = `${path}.items.${index}`
    if (isConditionGroup(item)) items.push(await evaluateGroup(item, resolve, itemPath))
    else items.push({ type: "CONDITION", path: itemPath, kind: item.kind, outcome: await resolve(item) })
  }
  const statuses = items.map((item) => (item.type === "GROUP" ? item.status : item.outcome.status))
  return { type: "GROUP", path, operator: group.operator, status: combineStatuses(group.operator, statuses), items }
}

export type RuleTrace = { key: string; name: string; priority: number; status: ConditionStatus; trace: GroupTrace }

export type RuleSelection = {
  /** MATCHED = a regra bateu (ações normais); INCONCLUSIVE = a regra ficou inconclusiva (só as ações de inconclusivo). */
  selected: { rule: PolicyRule; mode: "MATCHED" | "INCONCLUSIVE" }[]
  /** Status da AVALIAÇÃO: MATCHED (alguma regra bateu e decidiu), INCONCLUSIVE ou NO_MATCH. */
  status: "MATCHED" | "INCONCLUSIVE" | "NO_MATCH"
  /** FIRST_MATCH: regra de prioridade MAIOR que ficou inconclusiva e impediu decidir pelas de baixo. */
  blockedBy: string | null
  inconclusiveRules: string[]
}

/**
 * Seleção pela prioridade (1 = maior) — nunca pela "ação mais severa".
 * FIRST_MATCH: percorre por prioridade; a primeira que BATE decide. Se uma regra de prioridade maior ficou INCONCLUSIVA antes
 * dela, a avaliação é INCONCLUSIVA (não se sabe se a de cima valeria) e só as ações de inconclusivo dessa regra rodam — a
 * política nunca "cai" silenciosamente para uma regra de prioridade menor por falta de dado.
 * ALL_MATCHES: todas as que batem decidem; as inconclusivas contribuem só com as próprias ações de inconclusivo.
 */
export function selectRules(definition: PolicyDefinition, results: readonly RuleTrace[]): RuleSelection {
  const ordered = [...results].sort((a, b) => a.priority - b.priority)
  const ruleOf = (key: string) => definition.rules.find((rule) => rule.key === key)!
  const inconclusiveRules = ordered.filter((result) => result.status === "INCONCLUSIVE").map((result) => result.key)
  if (definition.matchStrategy === "FIRST_MATCH") {
    for (const result of ordered) {
      if (result.status === "MET") return { selected: [{ rule: ruleOf(result.key), mode: "MATCHED" }], status: "MATCHED", blockedBy: null, inconclusiveRules }
      if (result.status === "INCONCLUSIVE") return { selected: [{ rule: ruleOf(result.key), mode: "INCONCLUSIVE" }], status: "INCONCLUSIVE", blockedBy: result.key, inconclusiveRules }
    }
    return { selected: [], status: "NO_MATCH", blockedBy: null, inconclusiveRules }
  }
  const matched = ordered.filter((result) => result.status === "MET").map((result) => ({ rule: ruleOf(result.key), mode: "MATCHED" as const }))
  const inconclusive = ordered.filter((result) => result.status === "INCONCLUSIVE").map((result) => ({ rule: ruleOf(result.key), mode: "INCONCLUSIVE" as const }))
  const selected = [...matched, ...inconclusive].sort((a, b) => a.rule.priority - b.rule.priority)
  return { selected, status: matched.length > 0 ? "MATCHED" : inconclusive.length > 0 ? "INCONCLUSIVE" : "NO_MATCH", blockedBy: null, inconclusiveRules }
}

// ---------------------------------------------------------------------------------------------
// DECISÕES
// ---------------------------------------------------------------------------------------------

export type DecisionStatus = "CREATED" | "PENDING_APPROVAL" | "RECOMMENDED" | "EXISTING" | "SUPPRESSED" | "CONFLICT"

export type CatalogType = { typeId: string; versionId: string; key: string; definition: InterventionTypeDefinition }
export type ActiveIntervention = { id: string; typeKey: string; subjectKey: string; status: string }
export type ClosedIntervention = { id: string; typeKey: string; subjectKey: string; closedAt: string }

export type PlannedDecision = {
  typeKey: string
  typeName: string
  ruleKey: string
  /** Outras regras que pediram o mesmo tipo (deduplicado: vale a configuração da regra de maior prioridade). */
  alsoRequestedBy: string[]
  mode: "MATCHED" | "INCONCLUSIVE"
  action: PolicyAction
  /** Efeito aplicado de fato (o da regra, ou RECOMMEND quando o nó está em "Somente recomendar"). */
  effectiveEffect: PolicyAction["effect"]
  status: DecisionStatus
  /** EXISTING: a intervenção ativa de mesma identidade; `updated` = o novo sinal foi registrado nela (onActive UPDATE). */
  existingInterventionId: string | null
  updated: boolean
  /** Por que não foi aplicada (SUPPRESSED/CONFLICT) — texto factual. */
  note: string | null
}

export type EvaluationOutcome = "RECOMMENDED" | "EXISTING" | "CREATED" | "PENDING_APPROVAL" | "NO_MATCH" | "INCONCLUSIVE" | "CONFLICT" | "SUPPRESSED" | "NOT_APPLICABLE"

export type DecisionPlanInput = {
  selection: RuleSelection
  subjectKey: string
  types: ReadonlyMap<string, CatalogType>
  active: readonly ActiveIntervention[]
  closed: readonly ClosedIntervention[]
  now: Date
  /** Nó em "Somente recomendar": toda ação que abriria nasce como PROPOSTA (o responsável aceita). Nunca o contrário. */
  recommendOnly: boolean
}

const DAY_MS = 86_400_000

/**
 * Plano de decisões — o que ACONTECERIA (a aplicação grava; a simulação só mostra). Ordem fixa:
 *  1. ações das regras selecionadas, por prioridade; mesmo tipo pedido por duas regras = UMA decisão (a de maior prioridade);
 *  2. incompatibilidade (entre as planejadas e contra as ATIVAS da pessoa, de qualquer política): havendo qualquer par
 *     incompatível, NADA é aplicado — todas viram CONFLICT, para decisão humana (nunca se escolhe uma das duas);
 *  3. por ação: ativa com a mesma identidade → EXISTING (mantém ou registra o sinal); encerrada há menos que a carência →
 *     SUPPRESSED; senão nasce RECOMMENDED (proposta), PENDING_APPROVAL (tipo exige aprovação) ou CREATED.
 */
export function planDecisions(input: DecisionPlanInput): PlannedDecision[] {
  const planned = new Map<string, PlannedDecision>()
  for (const { rule, mode } of input.selection.selected) {
    const actions = mode === "MATCHED" ? rule.actions : rule.inconclusiveActions
    for (const action of actions) {
      const existing = planned.get(action.typeKey)
      if (existing) {
        existing.alsoRequestedBy.push(rule.key)
        continue
      }
      const type = input.types.get(action.typeKey)
      planned.set(action.typeKey, { typeKey: action.typeKey, typeName: type?.definition.name ?? action.typeKey, ruleKey: rule.key, alsoRequestedBy: [], mode, action, effectiveEffect: input.recommendOnly ? "RECOMMEND" : action.effect, status: "CREATED", existingInterventionId: null, updated: false, note: null })
    }
  }
  const decisions = [...planned.values()]
  if (decisions.length === 0) return decisions

  const missing = decisions.filter((decision) => !input.types.has(decision.typeKey))
  const conflicts: string[] = []
  for (const decision of missing) conflicts.push(`O tipo ${decision.typeKey} não tem versão publicada ativa.`)
  for (let i = 0; i < decisions.length; i += 1) {
    for (let j = i + 1; j < decisions.length; j += 1) {
      const a = decisions[i]!
      const b = decisions[j]!
      if (typesIncompatible(input.types.get(a.typeKey)?.definition, a.typeKey, input.types.get(b.typeKey)?.definition, b.typeKey)) conflicts.push(`${a.typeName} e ${b.typeName} são incompatíveis.`)
    }
    const decision = decisions[i]!
    for (const active of input.active) {
      if (typesIncompatible(input.types.get(decision.typeKey)?.definition, decision.typeKey, input.types.get(active.typeKey)?.definition, active.typeKey)) {
        conflicts.push(`${decision.typeName} é incompatível com uma intervenção ativa (${input.types.get(active.typeKey)?.definition.name ?? active.typeKey}).`)
      }
    }
  }
  if (conflicts.length > 0) {
    const note = [...new Set(conflicts)].join(" ")
    return decisions.map((decision) => ({ ...decision, status: "CONFLICT" as const, note }))
  }

  return decisions.map((decision) => {
    const type = input.types.get(decision.typeKey)!
    const active = input.active.find((item) => item.typeKey === decision.typeKey && item.subjectKey === input.subjectKey)
    if (active) return { ...decision, status: "EXISTING" as const, existingInterventionId: active.id, updated: decision.action.onActive === "UPDATE" }
    const cooldownMs = decision.action.cooldownDays * DAY_MS
    const recent = input.closed
      .filter((item) => item.typeKey === decision.typeKey && item.subjectKey === input.subjectKey)
      .find((item) => cooldownMs > 0 && input.now.getTime() - new Date(item.closedAt).getTime() < cooldownMs)
    if (recent) return { ...decision, status: "SUPPRESSED" as const, note: `Uma intervenção igual foi encerrada há menos de ${decision.action.cooldownDays} dia(s) (carência da regra).` }
    if (decision.effectiveEffect === "RECOMMEND") return { ...decision, status: "RECOMMENDED" as const }
    return { ...decision, status: type.definition.approval.required ? ("PENDING_APPROVAL" as const) : ("CREATED" as const) }
  })
}

/**
 * Resultado AGREGADO para quem consome (Condition do Workflow, tela). Descreve a AVALIAÇÃO, não a gravidade da ação:
 * inconclusiva/sem correspondência/conflito primeiro; senão o que aconteceu, nesta ordem fixa — trabalho novo criado,
 * aguardando aprovação, recomendado, já existente, suprimido pela carência.
 */
export function aggregateOutcome(selection: RuleSelection, decisions: readonly PlannedDecision[]): EvaluationOutcome {
  if (selection.status === "NO_MATCH") return "NO_MATCH"
  if (selection.status === "INCONCLUSIVE") return "INCONCLUSIVE"
  if (decisions.some((decision) => decision.status === "CONFLICT")) return "CONFLICT"
  for (const status of ["CREATED", "PENDING_APPROVAL", "RECOMMENDED", "EXISTING", "SUPPRESSED"] as const) {
    if (decisions.some((decision) => decision.status === status && decision.mode === "MATCHED")) return status
  }
  return "NO_MATCH"
}

// ---------------------------------------------------------------------------------------------
// JUSTIFICATIVA REPRODUZÍVEL
// ---------------------------------------------------------------------------------------------

export const CONDITION_STATUS_TEXT: Record<ConditionStatus, string> = { MET: "atendida", NOT_MET: "não atendida", INCONCLUSIVE: "inconclusiva" }
export const DECISION_STATUS_TEXT: Record<DecisionStatus, string> = {
  CREATED: "aberta",
  PENDING_APPROVAL: "aberta aguardando aprovação",
  RECOMMENDED: "recomendada ao responsável",
  EXISTING: "já existia ativa",
  SUPPRESSED: "não reaberta (carência)",
  CONFLICT: "não aplicada (conflito)",
}
export const OUTCOME_TEXT: Record<EvaluationOutcome, string> = {
  RECOMMENDED: "Intervenção recomendada",
  EXISTING: "Intervenção já existente",
  CREATED: "Intervenção criada",
  PENDING_APPROVAL: "Aprovação pendente",
  NO_MATCH: "Nenhuma regra atendida",
  INCONCLUSIVE: "Avaliação inconclusiva",
  CONFLICT: "Conflito entre intervenções",
  SUPPRESSED: "Suprimida pela carência",
  NOT_APPLICABLE: "Política não aplicável",
}

function describeTrace(trace: GroupTrace, indent: string): string[] {
  const lines: string[] = []
  for (const item of trace.items) {
    if (item.type === "GROUP") {
      lines.push(`${indent}- Grupo (${item.operator === "ALL" ? "todas" : "qualquer uma"}): ${CONDITION_STATUS_TEXT[item.status]}`)
      lines.push(...describeTrace(item, `${indent}  `))
    } else {
      lines.push(`${indent}- ${item.outcome.summary} → ${CONDITION_STATUS_TEXT[item.outcome.status]}`)
    }
  }
  return lines
}

export function buildJustification(input: { policyName: string; policyVersion: number; matchStrategy: PolicyDefinition["matchStrategy"]; rules: readonly RuleTrace[]; selection: RuleSelection; decisions: readonly PlannedDecision[]; outcome: EvaluationOutcome; definition: PolicyDefinition }): string {
  const lines = [`Política "${input.policyName}" v${input.policyVersion} (${input.matchStrategy === "FIRST_MATCH" ? "primeira regra atendida por prioridade" : "todas as regras atendidas"}): ${OUTCOME_TEXT[input.outcome]}.`]
  for (const rule of [...input.rules].sort((a, b) => a.priority - b.priority)) {
    lines.push(`Regra ${rule.priority} · ${rule.name} (${rule.key}): ${CONDITION_STATUS_TEXT[rule.status]}.`)
    lines.push(...describeTrace(rule.trace, "  "))
  }
  if (input.selection.blockedBy) lines.push(`A regra ${input.selection.blockedBy} ficou inconclusiva antes de qualquer regra atendida: as regras de prioridade menor não decidem por falta de dado.`)
  for (const selected of input.selection.selected) {
    const why = input.definition.rules.find((rule) => rule.key === selected.rule.key)?.justification
    if (why) lines.push(`Motivo da regra ${selected.rule.key}: ${why}`)
  }
  for (const decision of input.decisions) {
    lines.push(`Ação: ${decision.typeName} — ${DECISION_STATUS_TEXT[decision.status]}${decision.updated ? " (novo sinal registrado)" : ""}${decision.note ? `. ${decision.note}` : ""}.`)
  }
  return lines.join("\n")
}

/** Referências verificáveis das condições ATENDIDAS de uma regra (viram evidência da intervenção). */
export function referencesOf(trace: GroupTrace): FactReference[] {
  const references: FactReference[] = []
  const visit = (group: GroupTrace) => {
    for (const item of group.items) {
      if (item.type === "GROUP") visit(item)
      else if (item.outcome.status === "MET") references.push(...item.outcome.references)
    }
  }
  visit(trace)
  const seen = new Set<string>()
  return references.filter((reference) => {
    const key = `${reference.kind}:${reference.ref}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
