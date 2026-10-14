import { z } from "zod"
import { comparatorSchema, employeeSelectionCriterionSchema, historicalPeriodSchema, type EmployeeSelectionCriterion } from "../../workflows/domain/graph-schema.js"
import { allowedOnInconclusive, assertsSkillGap, isSensitiveType, stableKeySchema, type ConfigIssue, type InterventionTypeDefinition } from "./intervention-type.js"

/**
 * POLÍTICA DE ACOMPANHAMENTO — contrato declarativo versionado (`INTERVENTION_POLICY_V1`): quando recomendar ou abrir
 * intervenções. Não é uma escada: cada regra declara as próprias condições e ações; a política declara como regras que batem
 * ao mesmo tempo se combinam (`matchStrategy`) e a ordem é uma prioridade EXPLÍCITA e única. Nada aqui é script: condições são
 * tipos fechados avaliados por código (e as de indicador pelo MESMO avaliador das Conditions do Workflow).
 */
export const INTERVENTION_POLICY_SCHEMA_VERSION = "INTERVENTION_POLICY_V1" as const

const numericComparatorSchema = z.enum(["EQUALS", "NOT_EQUALS", "GT", "GTE", "LT", "LTE"])
export type NumericComparator = z.infer<typeof numericComparatorSchema>

/** Indicador: exatamente o critério de dados que "Selecionar colaboradores" e a Condition do Workflow já usam. */
const indicatorConditionSchema = z.object({ kind: z.literal("INDICATOR"), label: z.string().trim().max(120).optional(), criterion: employeeSelectionCriterionSchema }).strict()

/** Situação funcional e disponibilidade: elegível hoje, ou dias elegíveis numa janela (fonte atrasada = inconclusivo). */
const employmentConditionSchema = z.discriminatedUnion("check", [
  z.object({ kind: z.literal("EMPLOYMENT"), check: z.literal("CURRENTLY_ELIGIBLE"), expected: z.boolean() }).strict(),
  z.object({ kind: z.literal("EMPLOYMENT"), check: z.literal("ELIGIBLE_DAYS"), period: historicalPeriodSchema, comparator: numericComparatorSchema, threshold: z.number().int().min(0).max(366) }).strict(),
])

export const PRIOR_STATUS_FILTERS = ["ACTIVE", "COMPLETED", "CANCELLED"] as const
export const OPERATIONAL_RESULTS = ["IMPROVED", "UNCHANGED", "WORSENED", "NOT_MEASURED"] as const
export type OperationalResult = (typeof OPERATIONAL_RESULTS)[number]

/** Intervenções anteriores do colaborador (registros da própria INIA: ausência é fato, nunca "sem dados"). */
const priorInterventionsConditionSchema = z
  .object({
    kind: z.literal("PRIOR_INTERVENTIONS"),
    typeKeys: z.array(stableKeySchema).max(10),
    statuses: z.array(z.enum(PRIOR_STATUS_FILTERS)).min(1),
    /** Só para concluídas: resultado operacional registrado na conclusão. Vazio = qualquer resultado. */
    operationalResults: z.array(z.enum(OPERATIONAL_RESULTS)).max(OPERATIONAL_RESULTS.length),
    sameSubject: z.boolean(),
    withinDays: z.number().int().min(1).max(730),
    comparator: numericComparatorSchema,
    threshold: z.number().int().min(0).max(100),
  })
  .strict()

/** Tempo desde a última intervenção (aberta ou concluída). Sem nenhuma: a política diz explicitamente o que vale. */
const timeSinceInterventionConditionSchema = z
  .object({
    kind: z.literal("TIME_SINCE_INTERVENTION"),
    typeKeys: z.array(stableKeySchema).max(10),
    event: z.enum(["OPENED", "COMPLETED"]),
    sameSubject: z.boolean(),
    comparator: numericComparatorSchema,
    days: z.number().int().min(0).max(730),
    whenNone: z.enum(["MET", "NOT_MET"]),
  })
  .strict()

/** Diagnóstico SUSTENTADO (padrão verificado com evidência) — opcionalmente ligado a competências. */
const supportedDiagnosisConditionSchema = z
  .object({
    kind: z.literal("SUPPORTED_DIAGNOSIS"),
    /** null = o indicador da política (ou qualquer um, se a política não tiver indicador). */
    indicatorCode: z.string().trim().min(1).max(40).nullable(),
    competencyKeys: z.array(stableKeySchema).max(10),
    withinDays: z.number().int().min(1).max(365),
    expectation: z.enum(["EXISTS", "NOT_EXISTS"]),
  })
  .strict()

/** Feedbacks publicados (que só publicam com evidência) no período. */
const publishedFeedbackConditionSchema = z
  .object({
    kind: z.literal("PUBLISHED_FEEDBACK"),
    feedbackKind: z.enum(["INDICATOR", "MONITORING"]).nullable(),
    indicatorCode: z.string().trim().min(1).max(40).nullable(),
    withinDays: z.number().int().min(1).max(365),
    comparator: numericComparatorSchema,
    threshold: z.number().int().min(0).max(100),
  })
  .strict()

/**
 * Flag de atendimento — as flags chegam CALCULADAS com cada atendimento (a INIA não as deriva da transcrição): conta, na janela,
 * os atendimentos do colaborador em que a flag veio com o valor procurado (sim/não, ou número comparado a um valor). Atendimento
 * sem a flag = a flag não disparou. Menos atendimentos que o mínimo na janela = INCONCLUSIVA (sem atendimento não há sinal).
 */
const interactionFlagMatchSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("BOOLEAN"), value: z.boolean() }).strict(),
  z.object({ type: z.literal("NUMERIC"), comparator: numericComparatorSchema, threshold: z.number() }).strict(),
])
const interactionFlagConditionSchema = z
  .object({
    kind: z.literal("INTERACTION_FLAG"),
    channel: z.string().trim().min(1).max(40),
    flagName: z.string().trim().min(1).max(80),
    match: interactionFlagMatchSchema,
    withinDays: z.number().int().min(1).max(186),
    /** COUNT = quantidade de atendimentos com a flag; PERCENT = % dos atendimentos do colaborador na janela. */
    measure: z.enum(["COUNT", "PERCENT"]),
    comparator: numericComparatorSchema,
    threshold: z.number().min(0).max(100000),
    minimumInteractions: z.number().int().min(1).max(1000),
  })
  .strict()

export const policyConditionSchema = z.union([
  indicatorConditionSchema,
  employmentConditionSchema,
  priorInterventionsConditionSchema,
  timeSinceInterventionConditionSchema,
  supportedDiagnosisConditionSchema,
  publishedFeedbackConditionSchema,
  interactionFlagConditionSchema,
])
export type PolicyCondition = z.infer<typeof policyConditionSchema>
export type PolicyConditionKind = PolicyCondition["kind"]

export type PolicyConditionGroup = { operator: "ALL" | "ANY"; items: (PolicyCondition | PolicyConditionGroup)[] }
export const policyConditionGroupSchema: z.ZodType<PolicyConditionGroup> = z.lazy(() =>
  z.object({ operator: z.enum(["ALL", "ANY"]), items: z.array(z.union([policyConditionSchema, policyConditionGroupSchema])).min(1).max(12) }).strict(),
)

export const isConditionGroup = (item: PolicyCondition | PolicyConditionGroup): item is PolicyConditionGroup => "operator" in item && "items" in item

export const policyActionSchema = z
  .object({
    typeKey: stableKeySchema,
    /** RECOMMEND = a intervenção nasce PROPOSTA (o responsável aceita ou descarta); OPEN = nasce pronta (ou aguardando aprovação). */
    effect: z.enum(["RECOMMEND", "OPEN"]),
    /** Ausente = prazo padrão do tipo. */
    dueInDays: z.number().int().min(1).max(365).nullable(),
    /** Já existe uma ATIVA com a mesma identidade: KEEP = nada muda; UPDATE = registra o novo sinal nela (sem trocar versões). */
    onActive: z.enum(["KEEP", "UPDATE"]),
    /** Encerrada (concluída/cancelada) há menos de N dias com a mesma identidade = não reabre (SUPPRESSED). 0 = sem carência. */
    cooldownDays: z.number().int().min(0).max(365),
  })
  .strict()
export type PolicyAction = z.infer<typeof policyActionSchema>

export const policyRuleSchema = z
  .object({
    key: stableKeySchema,
    name: z.string().trim().min(1).max(120),
    /** 1 = maior prioridade. Única na política — nunca empate silencioso. */
    priority: z.number().int().min(1).max(999),
    /** Por que esta regra existe (entra na justificativa reproduzível de cada avaliação). */
    justification: z.string().trim().min(1).max(1000),
    when: policyConditionGroupSchema,
    // Rascunho pode ficar sem ação/regra enquanto é montado; a publicação exige (POLICY_RULE_WITHOUT_ACTIONS / POLICY_WITHOUT_RULES).
    actions: z.array(policyActionSchema).max(5),
    /** O que fazer quando a regra é INCONCLUSIVA (dados ausentes/insuficientes): só tipos que não classificam o colaborador. */
    inconclusiveActions: z.array(policyActionSchema).max(3),
  })
  .strict()
export type PolicyRule = z.infer<typeof policyRuleSchema>

export const policyDefinitionSchema = z
  .object({
    schemaVersion: z.literal(INTERVENTION_POLICY_SCHEMA_VERSION),
    description: z.string().trim().max(2000),
    /** Indicador principal (assunto das intervenções e do caso). null = política geral. */
    indicatorCode: z.string().trim().min(1).max(40).nullable(),
    /** FIRST_MATCH = só a regra de maior prioridade que bate; ALL_MATCHES = todas as que batem (sem conflito entre ações). */
    matchStrategy: z.enum(["FIRST_MATCH", "ALL_MATCHES"]),
    rules: z.array(policyRuleSchema).max(20),
    /** Relatório de inteligência: a parte estruturada sempre existe; a narrativa redigida pela IA é opcional (custa uma chamada). */
    report: z.object({ aiNarrative: z.boolean() }).strict(),
  })
  .strict()
export type PolicyDefinition = z.infer<typeof policyDefinitionSchema>

export const MAX_GROUP_DEPTH = 3
export const MAX_CONDITIONS_PER_RULE = 30

export function emptyPolicyDefinition(): PolicyDefinition {
  return { schemaVersion: INTERVENTION_POLICY_SCHEMA_VERSION, description: "", indicatorCode: null, matchStrategy: "FIRST_MATCH", rules: [], report: { aiNarrative: false } }
}

/** O que a validação precisa saber do mundo (carregado pela aplicação; a regra é pura). */
export type PolicyValidationCatalog = {
  /** Tipos com versão publicada, por chave. */
  types: ReadonlyMap<string, { active: boolean; definition: InterventionTypeDefinition }>
  /** Chaves de todos os tipos (inclusive sem versão publicada ou inativos) — referências históricas em condições. */
  allTypeKeys: ReadonlySet<string>
  competencyKeys: ReadonlySet<string>
  /** Indicadores ativos da organização, por código. */
  indicators: ReadonlyMap<string, { active: boolean }>
  /** Catálogo de flags por canal, chave `CANAL:nome`. */
  flags: ReadonlyMap<string, { valueType: "BOOLEAN" | "NUMERIC"; active: boolean }>
}

export const flagCatalogKey = (channel: string, flagName: string) => `${channel}:${flagName}`

export function walkConditions(group: PolicyConditionGroup, visit: (condition: PolicyCondition, path: string, depth: number) => void, path = "when", depth = 1): void {
  group.items.forEach((item, index) => {
    const itemPath = `${path}.items.${index}`
    if (isConditionGroup(item)) walkConditions(item, visit, itemPath, depth + 1)
    else visit(item, itemPath, depth)
  })
}

function groupDepth(group: PolicyConditionGroup): number {
  return 1 + Math.max(0, ...group.items.map((item) => (isConditionGroup(item) ? groupDepth(item) : 0)))
}

/**
 * A condição é OBRIGATÓRIA para a regra bater? (aparece num caminho só de ALL, ou em TODOS os ramos de um ANY). É assim que
 * a validação garante, por estrutura, que um treinamento nunca nasce só de "indicador abaixo da meta".
 */
export function groupRequires(group: PolicyConditionGroup, predicate: (condition: PolicyCondition) => boolean): boolean {
  const required = (item: PolicyCondition | PolicyConditionGroup) => (isConditionGroup(item) ? groupRequires(item, predicate) : predicate(item))
  return group.operator === "ALL" ? group.items.some(required) : group.items.every(required)
}

const isSupportedDiagnosis = (condition: PolicyCondition) => condition.kind === "SUPPORTED_DIAGNOSIS" && condition.expectation === "EXISTS"
const countsAtLeastOne = (comparator: NumericComparator, threshold: number) => (comparator === "GT" || comparator === "GTE") && threshold >= (comparator === "GT" ? 0 : 1)
const isVerifiableEvidenceCondition = (condition: PolicyCondition) =>
  isSupportedDiagnosis(condition) ||
  condition.kind === "INDICATOR" ||
  (condition.kind === "PUBLISHED_FEEDBACK" && countsAtLeastOne(condition.comparator, condition.threshold)) ||
  (condition.kind === "INTERACTION_FLAG" && condition.measure === "COUNT" && countsAtLeastOne(condition.comparator, condition.threshold))

/** Validação do critério de indicador sem banco (formato da consulta). As capacidades do indicador ficam com a aplicação. */
function indicatorCriterionIssues(criterion: EmployeeSelectionCriterion, path: string, catalog: PolicyValidationCatalog): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const historical = criterion.historicalQuery
  const performance = criterion.performanceQuery
  if (Boolean(historical) === Boolean(performance)) return [{ path, code: "POLICY_INDICATOR_QUERY_REQUIRED", message: "Escolha UMA consulta: histórico do indicador ou resultado oficial." }]
  const code = historical?.indicatorCode ?? performance?.indicatorCode
  const prvOnly = historical?.source === "PRV_ACHIEVEMENT" || (performance && performance.metric.startsWith("PRV_"))
  if (!prvOnly) {
    if (!code) issues.push({ path, code: "POLICY_INDICATOR_REQUIRED", message: "Escolha o indicador da condição." })
    else if (!catalog.indicators.has(code)) issues.push({ path, code: "POLICY_INDICATOR_NOT_FOUND", message: `O indicador ${code} não existe nesta organização.` })
    else if (!catalog.indicators.get(code)!.active) issues.push({ path, code: "POLICY_INDICATOR_INACTIVE", message: `O indicador ${code} está desativado.` })
  }
  if (historical) {
    // O quartil OPERACIONAL depende da população do Workflow; numa política vale só o quartil OFICIAL recebido da fonte.
    if (historical.source === "OPERATIONAL_QUARTILE") issues.push({ path, code: "POLICY_OPERATIONAL_QUARTILE_UNSUPPORTED", message: "Quartil operacional não está disponível em políticas: use o quartil oficial do fechamento." })
    if (!historical.period && historical.windowDays === undefined) issues.push({ path, code: "POLICY_INDICATOR_PERIOD_REQUIRED", message: "Defina a janela de análise." })
    const aggregation = historical.aggregation ?? "COUNT"
    if (aggregation === "COUNT") {
      if (!historical.comparator || historical.indicatorThreshold === undefined) issues.push({ path, code: "POLICY_INDICATOR_COUNT_FILTER", message: "Recorrência: defina qual medição conta (comparação e valor)." })
      if (criterion.thresholdNumeric === undefined || criterion.thresholdNumeric === null) issues.push({ path, code: "POLICY_INDICATOR_THRESHOLD", message: "Recorrência: defina quantas ocorrências." })
      if (historical.compareTo) issues.push({ path, code: "POLICY_INDICATOR_COUNT_COMPARE", message: "Recorrência compara uma contagem com um número, não com meta ou período anterior." })
    } else if (historical.compareTo?.kind !== "GOAL" && (criterion.thresholdNumeric === undefined || criterion.thresholdNumeric === null) && !(historical.compareTo?.kind === "PREVIOUS_PERIOD" && historical.compareTo.changeMode !== "PERCENT")) {
      issues.push({ path, code: "POLICY_INDICATOR_THRESHOLD", message: "Defina o valor de comparação." })
    }
    if (!["EQUALS", "NOT_EQUALS", "GT", "GTE", "LT", "LTE"].includes(criterion.comparator)) issues.push({ path, code: "POLICY_INDICATOR_COMPARATOR", message: "Use um comparador numérico." })
  }
  if (performance) {
    const quartile = performance.metric.endsWith("_QUARTILE")
    if (performance.recurrence) {
      if (!quartile) issues.push({ path, code: "POLICY_PERFORMANCE_RECURRENCE", message: "Recorrência de fechamentos só existe para quartil oficial." })
      if (criterion.thresholdNumeric === undefined || criterion.thresholdNumeric === null) issues.push({ path, code: "POLICY_INDICATOR_THRESHOLD", message: "Defina em quantos fechamentos o quartil precisa aparecer." })
    } else if (quartile) {
      if (!["EQUALS", "NOT_EQUALS"].includes(criterion.comparator) || !/^Q[1-4]$/.test(criterion.thresholdText ?? "")) issues.push({ path, code: "POLICY_PERFORMANCE_QUARTILE", message: "Quartil oficial compara com Q1 a Q4 (Q1 = melhor, Q4 = pior), usando igual ou diferente." })
    } else if (criterion.thresholdNumeric === undefined || criterion.thresholdNumeric === null) {
      issues.push({ path, code: "POLICY_INDICATOR_THRESHOLD", message: "Defina o valor de comparação." })
    }
  }
  return issues
}

function conditionIssues(condition: PolicyCondition, path: string, catalog: PolicyValidationCatalog): ConfigIssue[] {
  switch (condition.kind) {
    case "INDICATOR":
      return indicatorCriterionIssues(condition.criterion, path, catalog)
    case "EMPLOYMENT":
      return condition.check === "ELIGIBLE_DAYS" && condition.period.kind === "CLOSURES" ? [{ path, code: "POLICY_EMPLOYMENT_PERIOD", message: "Dias elegíveis usam uma janela de dias ou de calendário." }] : []
    case "PRIOR_INTERVENTIONS":
    case "TIME_SINCE_INTERVENTION": {
      const unknown = condition.typeKeys.filter((key) => !catalog.allTypeKeys.has(key))
      const issues: ConfigIssue[] = unknown.map((key) => ({ path, code: "POLICY_CONDITION_TYPE_UNKNOWN", message: `Não existe tipo de intervenção com a chave ${key}.` }))
      if (condition.kind === "PRIOR_INTERVENTIONS" && condition.operationalResults.length > 0 && !condition.statuses.includes("COMPLETED")) issues.push({ path, code: "POLICY_PRIOR_RESULT_NEEDS_COMPLETED", message: "Resultado operacional só existe em intervenções concluídas." })
      return issues
    }
    case "SUPPORTED_DIAGNOSIS": {
      const issues = condition.competencyKeys.filter((key) => !catalog.competencyKeys.has(key)).map((key) => ({ path, code: "POLICY_COMPETENCY_UNKNOWN", message: `Não existe competência com a chave ${key}.` }))
      if (condition.indicatorCode && !catalog.indicators.has(condition.indicatorCode)) issues.push({ path, code: "POLICY_INDICATOR_NOT_FOUND", message: `O indicador ${condition.indicatorCode} não existe nesta organização.` })
      return issues
    }
    case "PUBLISHED_FEEDBACK":
      return condition.indicatorCode && !catalog.indicators.has(condition.indicatorCode) ? [{ path, code: "POLICY_INDICATOR_NOT_FOUND", message: `O indicador ${condition.indicatorCode} não existe nesta organização.` }] : []
    case "INTERACTION_FLAG": {
      const flag = catalog.flags.get(flagCatalogKey(condition.channel, condition.flagName))
      if (!flag) return [{ path, code: "POLICY_FLAG_NOT_FOUND", message: `A flag ${condition.flagName} (${condition.channel}) não existe no catálogo de flags.` }]
      const issues: ConfigIssue[] = []
      if (!flag.active) issues.push({ path, code: "POLICY_FLAG_INACTIVE", message: `A flag ${condition.flagName} está desativada no catálogo.` })
      if (flag.valueType !== condition.match.type) issues.push({ path, code: "POLICY_FLAG_VALUE_TYPE", message: `A flag ${condition.flagName} é ${flag.valueType === "BOOLEAN" ? "sim/não" : "numérica"}: ajuste o valor procurado.` })
      if (condition.measure === "PERCENT" && condition.threshold > 100) issues.push({ path, code: "POLICY_FLAG_PERCENT", message: "Percentual de atendimentos vai de 0 a 100." })
      return issues
    }
  }
}

function actionIssues(action: PolicyAction, path: string, catalog: PolicyValidationCatalog, inconclusive: boolean, rule: PolicyRule): ConfigIssue[] {
  const type = catalog.types.get(action.typeKey)
  if (!type) return [{ path, code: "POLICY_ACTION_TYPE_UNPUBLISHED", message: `O tipo ${action.typeKey} não existe ou ainda não tem versão publicada.` }]
  const issues: ConfigIssue[] = []
  if (!type.active) issues.push({ path, code: "POLICY_ACTION_TYPE_INACTIVE", message: `O tipo ${action.typeKey} está inativo.` })
  if (inconclusive && !allowedOnInconclusive(type.definition)) {
    issues.push({ path, code: "POLICY_INCONCLUSIVE_ACTION_CLASSIFIES", message: `Dados insuficientes nunca viram classificação: com regra inconclusiva só cabem tipos de observação, revisão de dados ou revisão pela liderança (${type.definition.name} não é).` })
  }
  if (!inconclusive && assertsSkillGap(type.definition) && !groupRequires(rule.when, isSupportedDiagnosis)) {
    issues.push({ path, code: "POLICY_SKILL_GAP_NEEDS_DIAGNOSIS", message: `${type.definition.name} afirma uma lacuna de habilidade: a regra precisa exigir um diagnóstico sustentado (indicador abaixo da meta, sozinho, não basta).` })
  }
  if (isSensitiveType(type.definition)) {
    if (inconclusive) issues.push({ path, code: "CONTINUITY_REVIEW_NOT_ON_INCONCLUSIVE", message: "A avaliação de continuidade nunca é aberta com dados insuficientes." })
    if (!groupRequires(rule.when, isVerifiableEvidenceCondition)) issues.push({ path, code: "CONTINUITY_REVIEW_EVIDENCE_CONDITION", message: "A avaliação de continuidade exige uma condição com evidência verificável (indicador, diagnóstico sustentado ou feedback publicado)." })
    if (rule.justification.trim().length < 30) issues.push({ path: `${path}`, code: "CONTINUITY_REVIEW_JUSTIFICATION", message: "A regra que abre avaliação de continuidade precisa de uma justificativa com pelo menos 30 caracteres." })
  }
  return issues
}

/** Validação de COMBINAÇÃO da política — a que decide se o rascunho pode ser publicado. Pura e determinística. */
export function validatePolicyDefinition(definition: PolicyDefinition, catalog: PolicyValidationCatalog): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  if (definition.rules.length === 0) issues.push({ path: "rules", code: "POLICY_WITHOUT_RULES", message: "A política precisa de pelo menos uma regra." })
  if (definition.indicatorCode && !catalog.indicators.has(definition.indicatorCode)) issues.push({ path: "indicatorCode", code: "POLICY_INDICATOR_NOT_FOUND", message: `O indicador ${definition.indicatorCode} não existe nesta organização.` })
  const keys = new Map<string, number>()
  const priorities = new Map<number, string>()
  definition.rules.forEach((rule, index) => {
    const path = `rules.${index}`
    if (keys.has(rule.key)) issues.push({ path: `${path}.key`, code: "POLICY_RULE_KEY_DUPLICATED", message: `A chave de regra ${rule.key} está repetida.` })
    keys.set(rule.key, index)
    const other = priorities.get(rule.priority)
    if (other) issues.push({ path: `${path}.priority`, code: "POLICY_RULE_PRIORITY_DUPLICATED", message: `A prioridade ${rule.priority} já é da regra ${other}: cada regra precisa de uma prioridade própria (sem empate).` })
    priorities.set(rule.priority, rule.key)
    if (groupDepth(rule.when) > MAX_GROUP_DEPTH) issues.push({ path: `${path}.when`, code: "POLICY_GROUP_TOO_DEEP", message: `Use no máximo ${MAX_GROUP_DEPTH} níveis de grupos.` })
    let count = 0
    walkConditions(rule.when, (condition, conditionPath) => {
      count += 1
      issues.push(...conditionIssues(condition, `${path}.${conditionPath}`, catalog))
    })
    if (count > MAX_CONDITIONS_PER_RULE) issues.push({ path: `${path}.when`, code: "POLICY_TOO_MANY_CONDITIONS", message: `Use no máximo ${MAX_CONDITIONS_PER_RULE} condições por regra.` })
    if (rule.actions.length === 0) issues.push({ path: `${path}.actions`, code: "POLICY_RULE_WITHOUT_ACTIONS", message: `A regra ${rule.name} precisa de pelo menos uma ação.` })
    const seenTypes = new Set<string>()
    rule.actions.forEach((action, actionIndex) => {
      if (seenTypes.has(action.typeKey)) issues.push({ path: `${path}.actions.${actionIndex}`, code: "POLICY_ACTION_DUPLICATED", message: `O tipo ${action.typeKey} aparece duas vezes na mesma regra.` })
      seenTypes.add(action.typeKey)
      issues.push(...actionIssues(action, `${path}.actions.${actionIndex}`, catalog, false, rule))
    })
    rule.inconclusiveActions.forEach((action, actionIndex) => issues.push(...actionIssues(action, `${path}.inconclusiveActions.${actionIndex}`, catalog, true, rule)))
    // Duas ações da MESMA regra com tipos incompatíveis entre si nunca poderiam ser aplicadas: bloqueia já na publicação.
    for (const a of rule.actions) for (const b of rule.actions) {
      if (a.typeKey >= b.typeKey) continue
      if (typesIncompatible(catalog.types.get(a.typeKey)?.definition, a.typeKey, catalog.types.get(b.typeKey)?.definition, b.typeKey)) {
        issues.push({ path: `${path}.actions`, code: "POLICY_RULE_ACTIONS_INCOMPATIBLE", message: `${a.typeKey} e ${b.typeKey} são incompatíveis e não podem estar na mesma regra.` })
      }
    }
  })
  return issues
}

/** Incompatibilidade é simétrica: basta um dos dois tipos declarar o outro. */
export function typesIncompatible(a: Pick<InterventionTypeDefinition, "incompatibleWith"> | undefined, aKey: string, b: Pick<InterventionTypeDefinition, "incompatibleWith"> | undefined, bKey: string): boolean {
  if (aKey === bKey) return false
  return Boolean(a?.incompatibleWith.includes(bKey) || b?.incompatibleWith.includes(aKey))
}

export const numericComparatorMatches = (comparator: NumericComparator, value: number, threshold: number): boolean => {
  switch (comparator) {
    case "EQUALS":
      return value === threshold
    case "NOT_EQUALS":
      return value !== threshold
    case "GT":
      return value > threshold
    case "GTE":
      return value >= threshold
    case "LT":
      return value < threshold
    case "LTE":
      return value <= threshold
  }
}

export const NUMERIC_COMPARATOR_TEXT: Record<NumericComparator, string> = { EQUALS: "=", NOT_EQUALS: "≠", GT: ">", GTE: "≥", LT: "<", LTE: "≤" }
export { comparatorSchema }
