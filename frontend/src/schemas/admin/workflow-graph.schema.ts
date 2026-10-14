import { z } from "zod"
import { quartileSchema } from "./employee-performance.schema"
import { investigationCapabilitySchema } from "./investigation.schema"

export const comparatorSchema = z.enum([
  "EQUALS",
  "GT",
  "LT",
  "GTE",
  "LTE",
  "NOT_EQUALS",
  "CONTAINS",
  "NOT_CONTAINS",
  "STARTS_WITH",
  "ENDS_WITH",
  "IS_EMPTY",
  "NOT_EMPTY",
])
export type Comparator = z.infer<typeof comparatorSchema>

export const COMPARATOR_LABELS: Record<Comparator, string> = {
  EQUALS: "é igual a",
  GT: "é maior que",
  LT: "é menor que",
  GTE: "é maior ou igual a",
  LTE: "é menor ou igual a",
  NOT_EQUALS: "é diferente de",
  CONTAINS: "contém",
  NOT_CONTAINS: "não contém",
  STARTS_WITH: "começa com",
  ENDS_WITH: "termina com",
  IS_EMPTY: "está vazio",
  NOT_EMPTY: "não está vazio",
}

/** Quais comparadores fazem sentido para cada tipo de campo tipado (Structured Output field ou
 * Workflow Variable) — mesma tabela do backend (graph-schema.ts), reaproveitada para restringir
 * o Select de comparadores da Condition ao que o motor realmente sabe avaliar para aquele tipo. */
export const COMPARATORS_BY_FIELD_TYPE: Record<"BOOLEAN" | "NUMBER" | "STRING" | "ARRAY", Comparator[]> = {
  BOOLEAN: ["EQUALS"],
  NUMBER: ["EQUALS", "NOT_EQUALS", "GT", "LT", "GTE", "LTE"],
  STRING: ["EQUALS", "NOT_EQUALS", "CONTAINS", "NOT_CONTAINS", "STARTS_WITH", "ENDS_WITH", "IS_EMPTY", "NOT_EMPTY"],
  ARRAY: ["CONTAINS", "NOT_CONTAINS", "IS_EMPTY", "NOT_EMPTY"],
}

export const periodWindowSchema = z.enum(["TODAY", "D1", "WEEK", "MONTH", "QUARTER"])
export type PeriodWindow = z.infer<typeof periodWindowSchema>

export const PERIOD_WINDOW_LABELS: Record<PeriodWindow, string> = {
  TODAY: "Hoje",
  D1: "Ontem (D-1)",
  WEEK: "Semana anterior",
  MONTH: "Mês anterior",
  QUARTER: "Trimestre anterior",
}

export const agentOutputContractSchema = z.enum(["FEEDBACK", "PROCESS_AUDIT", "PROCESS_ASSESSMENT", "INDICATOR_DIAGNOSIS", "PRV_CLOSING_DIAGNOSIS"])
export type AgentOutputContract = z.infer<typeof agentOutputContractSchema>
export const AGENT_OUTPUT_CONTRACT_LABELS: Record<AgentOutputContract, string> = {
  FEEDBACK: "Feedback de monitoria",
  PROCESS_AUDIT: "Conformidade de processo",
  PROCESS_ASSESSMENT: "Avaliação de processo (feedback com base)",
  INDICATOR_DIAGNOSIS: "Diagnóstico do indicador (feedback com base)",
  PRV_CLOSING_DIAGNOSIS: "Diagnóstico do fechamento do PRV (feedback com base)",
}
/** Indicator Diagnosis V1 — formatos com a fonte "Fechamentos oficiais" (gatilho por Agenda). */
export const PERFORMANCE_OUTPUT_CONTRACT_LABELS: Record<"FEEDBACK" | "PRV_CLOSING_DIAGNOSIS" | "INDICATOR_DIAGNOSIS", string> = {
  FEEDBACK: "Resumo dos fechamentos (sem diagnóstico)",
  PRV_CLOSING_DIAGNOSIS: "Diagnóstico do fechamento do PRV (feedback com base)",
  INDICATOR_DIAGNOSIS: "Diagnóstico de um indicador, sem PRV (feedback com base)",
}
/** Indicator Diagnosis V2 — diagnóstico DIRETO do fechamento oficial de UM indicador (sem ler o PRV). */
export const DIRECT_INDICATOR_DIAGNOSIS_HINT = "O sistema lê o fechamento oficial mais recente do indicador escolhido (sem PRV), aplica a estratégia dele (Indicadores › Diagnóstico com IA) e, quando a estratégia deixa, a IA escolhe entre os passos permitidos o que investigar. Os números, a comparação com grupo e a população são sempre do sistema; nunca afirma causa."
export const PRV_CLOSING_DIAGNOSIS_HINT = "O sistema lê o fechamento oficial mais recente, decide quais indicadores investigar pela estratégia de cada um (Indicadores › Diagnóstico com IA), escolhe a população e reaproveita as avaliações de processo já feitas. O agente só avalia as chamadas que ainda faltam (nenhuma = nenhuma chamada à IA). \"Gerar feedback\" conta os padrões, compara com o mês anterior e com o Subgrupo (só agregado) e nunca afirma que um comportamento ou o mix causou o resultado."
/** Formatos com transcrição (gatilho por Flag) × formatos a partir da medição (gatilho por Indicador — V1.6.1). */
export const FLAG_OUTPUT_CONTRACTS: readonly AgentOutputContract[] = ["FEEDBACK", "PROCESS_AUDIT", "PROCESS_ASSESSMENT"]
export const INDICATOR_OUTPUT_CONTRACT_LABELS: Record<"FEEDBACK" | "INDICATOR_DIAGNOSIS", string> = {
  FEEDBACK: "Feedback do indicador (só o resultado oficial)",
  INDICATOR_DIAGNOSIS: "Diagnóstico do indicador (feedback com base)",
}
export const INDICATOR_DIAGNOSIS_HINT = "O sistema localiza onde o resultado se concentra (motivo dos atendimentos no período da medição) e escolhe uma amostra reproduzível de chamadas desse motivo. O agente avalia os processos oficiais de cada chamada; \"Gerar feedback\" confere tudo, conta as etapas na amostra e compara com o grupo de referência só de forma agregada. Nunca diz que um comportamento causou o resultado; sem padrão ou sem regra da base, o feedback fica no fato do indicador."
/** V1.6.0 — formato pedido aos especialistas de um nó Orquestrador (com transcrição, só gatilho por Flag). */
export const specialistOutputContractSchema = z.enum(["FEEDBACK", "PROCESS_ASSESSMENT"])
export type SpecialistOutputContract = z.infer<typeof specialistOutputContractSchema>
export const SPECIALIST_OUTPUT_CONTRACT_LABELS: Record<SpecialistOutputContract, string> = {
  FEEDBACK: "Feedback de monitoria",
  PROCESS_ASSESSMENT: "Avaliação de processo (feedback com base)",
}
export const PROCESS_ASSESSMENT_HINT = "Cada especialista avalia os processos oficiais aplicáveis à chamada (documentos da base), etapa a etapa: seguido, não seguido, não observável ou não aplicável — com fala literal do operador e o trecho literal do documento. \"Gerar feedback\" confere tudo e cria pontos fortes e de desenvolvimento com a base citada e material de apoio; sem regra verificada, não há orientação."

export const scheduledDataSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("INDICATOR"), indicatorCode: z.string().nullable(), period: periodWindowSchema }),
  z.object({ kind: z.literal("MONITORING"), sampleSize: z.number().int().min(1).max(10), period: periodWindowSchema }),
  // Fechamentos oficiais (PRV + indicadores por competência), lidos prontos — nunca recalculados.
  // V2 — `indicatorCode` só com o formato "Diagnóstico de um indicador" (diagnóstico direto, sem PRV).
  z.object({ kind: z.literal("PERFORMANCE"), closures: z.number().int().min(1).max(3), indicatorCode: z.string().nullable().optional() }),
])
export type ScheduledDataSource = z.infer<typeof scheduledDataSourceSchema>

// "Analisar" — Quantidade de ocorrências (COUNT) conta medições que batem um filtro;
// Média/Mínimo/Máximo agregam o VALOR diretamente, sem filtro por medição — não fazem sentido
// misturados na mesma UI (Parte 13 do pedido).
// Camada operacional (backend graph-schema.ts / indicators/domain/operational-aggregation.ts):
// WEIGHTED_AVERAGE (Σ total ÷ Σ volume — TMA, taxas, notas ponderadas), SUM e LATEST (snapshot).
// Quais valem pra cada indicador vem de `operationalAggregation` do catálogo (ver
// allowedAggregationsFor abaixo) — o editor só oferece o permitido; o publish rejeita o resto.
export const historicalAggregationSchema = z.enum(["COUNT", "AVERAGE", "WEIGHTED_AVERAGE", "SUM", "LATEST", "MINIMUM", "MAXIMUM"])
export type HistoricalAggregation = z.infer<typeof historicalAggregationSchema>

export const HISTORICAL_AGGREGATION_LABELS: Record<HistoricalAggregation, string> = {
  COUNT: "Quantidade de ocorrências",
  AVERAGE: "Média",
  WEIGHTED_AVERAGE: "Média ponderada",
  SUM: "Soma",
  LATEST: "Último valor",
  MINIMUM: "Mínimo",
  MAXIMUM: "Máximo",
}

// Semântica (Parte 10/18 do pedido): ROLLING_DAYS = janela móvel de N dias terminando AGORA
// (inclui hoje parcial). CALENDAR = período de calendário — por padrão o ANTERIOR completo, ou
// o CORRENTE/parcial com `phase: "CURRENT"` (evolução de Unidade de Análise/Período — "Este mês"
// x "Mês passado"). Ausente = "PREVIOUS", comportamento de sempre.
// "Últimos N fechamentos" (Parte 3/4 do pedido de Meta/Fechamentos) — fechamentos reais
// (linhas distintas já persistidas), nunca aproximação por dias/mês corrido. `unit` fixo em
// "MONTH": a fonte não tem competência semanal real hoje — nunca inventamos uma.
export const historicalPeriodSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ROLLING_DAYS"), days: z.number().int().positive().max(186) }),
  z.object({
    kind: z.literal("CALENDAR"),
    unit: z.enum(["DAY", "WEEK", "MONTH", "TWO_MONTHS", "QUARTER", "FOUR_MONTHS", "SEMESTER"]),
    phase: z.enum(["CURRENT", "PREVIOUS"]).optional(),
  }),
  z.object({ kind: z.literal("CLOSURES"), unit: z.literal("MONTH"), count: z.number().int().min(2).max(24) }),
])
export type HistoricalPeriod = z.infer<typeof historicalPeriodSchema>
export type CalendarUnit = Extract<HistoricalPeriod, { kind: "CALENDAR" }>["unit"]
export type CalendarPhase = NonNullable<Extract<HistoricalPeriod, { kind: "CALENDAR" }>["phase"]>

export const CALENDAR_UNIT_LABELS: Record<CalendarUnit, string> = {
  DAY: "Dia",
  WEEK: "Semana",
  MONTH: "Mês",
  TWO_MONTHS: "Bimestre",
  QUARTER: "Trimestre",
  FOUR_MONTHS: "Quadrimestre",
  SEMESTER: "Semestre",
}

/** Rótulo completo já combinando unidade + fase — "Este mês" / "Mês passado" (Parte 18 do
 * pedido) — mesma função usada pelo Select e pelo resumo do card do Trigger/Condition. */
export function describeCalendarPeriod(unit: CalendarUnit, phase: CalendarPhase = "PREVIOUS"): string {
  // Gênero do substantivo: só "semana" é feminino — controla "Este/Esta" (concordância de "est-e")
  // e "passado/passada" (concordância de "passad-o"), que têm terminações DIFERENTES pro
  // masculino ("e" x "o") — nunca compartilha um único sufixo entre as duas frases.
  const FEMININE: Record<CalendarUnit, boolean> = { DAY: false, WEEK: true, MONTH: false, TWO_MONTHS: false, QUARTER: false, FOUR_MONTHS: false, SEMESTER: false }
  const NOUN: Record<CalendarUnit, string> = { DAY: "dia", WEEK: "semana", MONTH: "mês", TWO_MONTHS: "bimestre", QUARTER: "trimestre", FOUR_MONTHS: "quadrimestre", SEMESTER: "semestre" }
  if (phase === "CURRENT") return `Est${FEMININE[unit] ? "a" : "e"} ${NOUN[unit]}`
  return unit === "DAY" ? "Ontem" : `${NOUN[unit][0]!.toUpperCase()}${NOUN[unit].slice(1)} passad${FEMININE[unit] ? "a" : "o"}`
}

// Comparação (Parte 19 da evolução de Unidade de Análise): além do valor fixo (ausente —
// thresholdNumeric no config do node, comportamento de sempre), compara contra a Meta vigente ou
// contra o mesmo cálculo no período anterior — ambos reais, resolvidos no backend.
export const historicalCompareToSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("GOAL") }),
  // Ausente/"VALUE" = compara o valor atual contra o valor do período anterior diretamente
  // (GT/LT já respondem "aumentou"/"diminuiu"). "PERCENT" compara a VARIAÇÃO percentual —
  // "aumentou pelo menos 10%" vira comparator GTE + thresholdNumeric 10.
  z.object({ kind: z.literal("PREVIOUS_PERIOD"), changeMode: z.enum(["VALUE", "PERCENT"]).optional() }),
])
export type HistoricalCompareTo = z.infer<typeof historicalCompareToSchema>
export const HISTORICAL_COMPARE_TO_LABELS: Record<HistoricalCompareTo["kind"], string> = {
  GOAL: "Meta vigente",
  PREVIOUS_PERIOD: "Mesmo período anterior",
}
export type PreviousPeriodChangeMode = NonNullable<Extract<HistoricalCompareTo, { kind: "PREVIOUS_PERIOD" }>["changeMode"]>
export const CHANGE_MODE_LABELS: Record<PreviousPeriodChangeMode, string> = {
  VALUE: "Valor",
  PERCENT: "Variação percentual (%)",
}

// OPERATIONAL_QUARTILE (Condition): posição do colaborador na população do Workflow sobre
// medições de uma janela operacional — mesmo cálculo do Ranking por quartil; comparador
// É igual a/É diferente de + thresholdText "Q1".."Q4". Nunca é o quartil oficial do fechamento
// (esse é performanceQuery INDICATOR_QUARTILE). Espelha backend graph-schema.ts.
export const historicalSourceSchema = z.enum(["MEASUREMENT", "INDICATOR_ACHIEVEMENT", "PRV_ACHIEVEMENT", "OPERATIONAL_QUARTILE"])
export type HistoricalSource = z.infer<typeof historicalSourceSchema>
/** Fontes de um Ranking — o quartil operacional lá é uma seleção sobre MEASUREMENT, não uma fonte. */
export const rankingSourceSchema = z.enum(["MEASUREMENT", "INDICATOR_ACHIEVEMENT", "PRV_ACHIEVEMENT"])
export type RankingSource = z.infer<typeof rankingSourceSchema>

// Só relevante pra Média/Mínimo/Máximo (COUNT sempre agrega a medição bruta). Ausente = MEASUREMENT.
export const HISTORICAL_SOURCE_LABELS: Record<HistoricalSource, string> = {
  MEASUREMENT: "Valor bruto da medição",
  INDICATOR_ACHIEVEMENT: "Atingimento do indicador (%)",
  PRV_ACHIEVEMENT: "Atingimento do PRV (%)",
  OPERATIONAL_QUARTILE: "Quartil operacional (posição na população)",
}

export const historicalQuerySchema = z.object({
  kind: z.literal("INDICATOR_THRESHOLD_COUNT"),
  // Obrigatório pra MEASUREMENT/INDICATOR_ACHIEVEMENT, ausente/ignorado pra PRV_ACHIEVEMENT —
  // PRV é uma fonte própria (employee_prv_performance), nunca pertence a um indicador específico
  // (mesmo padrão de performanceQuerySchema.indicatorCode pra PRV_ACHIEVEMENT/PRV_QUARTILE logo
  // abaixo). Exigência condicional validada em workflow-validation.ts, espelhando o backend.
  indicatorCode: z.string().optional(),
  aggregation: historicalAggregationSchema.optional(),
  source: historicalSourceSchema.optional(),
  // Só usados quando aggregation === "COUNT" (ou ausente, que também significa COUNT).
  comparator: comparatorSchema.optional(),
  indicatorThreshold: z.number().optional(),
  // windowDays: formato legado, só lido; period é o formato atual, sempre escrito pela UI.
  windowDays: z.number().int().positive().optional(),
  period: historicalPeriodSchema.optional(),
  minimumSampleSize: z.number().int().positive().optional(),
  // Cobertura mínima (fração 0.01–1): dias com medição ÷ dias elegíveis na janela. Só camada
  // operacional (MEASUREMENT/OPERATIONAL_QUARTILE) com agregação de valor — abaixo = SEM DADOS.
  minimumCoverage: z.number().min(0.01).max(1).optional(),
  // Ausente = comparação fixa de sempre (thresholdNumeric). Só relevante pra AVERAGE/MINIMUM/MAXIMUM.
  compareTo: historicalCompareToSchema.optional(),
})
export type HistoricalQuery = z.infer<typeof historicalQuerySchema>

export const performanceMetricSchema = z.enum([
  "INDICATOR_VALUE",
  "INDICATOR_ACHIEVEMENT",
  "INDICATOR_QUARTILE",
  "INDICATOR_WEIGHT",
  "PRV_ACHIEVEMENT",
  "PRV_QUARTILE",
])
export type PerformanceMetric = z.infer<typeof performanceMetricSchema>

export const PERFORMANCE_METRIC_LABELS: Record<PerformanceMetric, string> = {
  INDICATOR_VALUE: "Valor atual do indicador",
  INDICATOR_ACHIEVEMENT: "Atingimento do indicador",
  INDICATOR_QUARTILE: "Quartil do indicador",
  INDICATOR_WEIGHT: "Peso do indicador",
  PRV_ACHIEVEMENT: "Atingimento consolidado do PRV",
  PRV_QUARTILE: "Quartil do PRV",
}

// "Últimos N fechamentos" — só pra *_QUARTILE: conta quantos dos últimos N snapshots mensais já
// persistidos batem o quartil-alvo, em vez do snapshot mais recente. comparator/thresholdNumeric
// do node comparam essa CONTAGEM (mesmo padrão de historicalQuery COUNT).
export const performanceRecurrenceSchema = z.object({
  periods: z.number().int().min(2).max(24),
  matchQuartile: quartileSchema,
})
export type PerformanceRecurrence = z.infer<typeof performanceRecurrenceSchema>

export const performanceQuerySchema = z.object({
  kind: z.literal("EMPLOYEE_PERFORMANCE"),
  metric: performanceMetricSchema,
  indicatorCode: z.string().optional(),
  recurrence: performanceRecurrenceSchema.optional(),
})
export type PerformanceQuery = z.infer<typeof performanceQuerySchema>

// COORDINATOR fica entre Operador e Supervisor na cadeia de reports_to_id — alvo real de Human
// Review/Escalate/Output, não só um rótulo.
export const escalationRoleSchema = z.enum(["COORDINATOR", "SUPERVISOR", "MANAGER", "SENIOR_MANAGER", "DIRECTOR"])
export type EscalationRole = z.infer<typeof escalationRoleSchema>

export const ESCALATION_ROLE_LABELS: Record<EscalationRole, string> = {
  COORDINATOR: "Coordenador",
  SUPERVISOR: "Supervisor",
  MANAGER: "Gerente",
  SENIOR_MANAGER: "Gerente sênior",
  DIRECTOR: "Diretor",
}

export const humanReviewDecisionSchema = z.enum(["approved", "rejected", "escalated"])
export type HumanReviewDecision = z.infer<typeof humanReviewDecisionSchema>

/**
 * Destino — resolução hierárquica extensível, reaproveitada tanto pela Revisão Humana
 * (`reviewTarget`) quanto pela Action Escalonar (`target`):
 * - ROLE_OF_OPERATOR: sobe a hierarquia a partir do operador da ocorrência.
 * - ROLE_OF_PREVIOUS_REVIEWER: sobe a hierarquia a partir de quem decidiu um Human Review
 *   ANTERIOR nesta mesma execução (`previousReviewNodeId` — precisa ser um node human_review
 *   ancestral no grafo).
 * - SPECIFIC_USER: pessoa fixa.
 */
export const hierarchicalTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ROLE_OF_OPERATOR"), role: escalationRoleSchema }),
  z.object({ type: z.literal("ROLE_OF_PREVIOUS_REVIEWER"), role: escalationRoleSchema, previousReviewNodeId: z.string() }),
  z.object({ type: z.literal("SPECIFIC_USER"), userId: z.string() }),
])
export type HierarchicalTarget = z.infer<typeof hierarchicalTargetSchema>
export type HierarchicalTargetType = HierarchicalTarget["type"]

export const humanReviewNodeConfigSchema = z.object({
  reviewTarget: hierarchicalTargetSchema,
  contentSource: z.string().optional(),
  instruction: z.string().optional(),
})
export type HumanReviewNodeConfig = z.infer<typeof humanReviewNodeConfigSchema>

/** V1.7.1 — roteamento do nó Orquestrador: ausente/MODEL = a IA escolhe; DOMAINS = domínios declarados deste disparo (sem IA). */
export const orchestratorRoutingSchema = z.discriminatedUnion("mode", [z.object({ mode: z.literal("MODEL") }), z.object({ mode: z.literal("DOMAINS"), businessDomainIds: z.array(z.string()) })])
export type OrchestratorRouting = z.infer<typeof orchestratorRoutingSchema>

export const orchestratorNodeConfigSchema = z.object({
  orchestratorId: z.string(),
  instruction: z.string(),
  specialistOutputContract: specialistOutputContractSchema.optional(),
  routing: orchestratorRoutingSchema.optional(),
})
export type OrchestratorNodeConfig = z.infer<typeof orchestratorNodeConfigSchema>

export const outputTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CURRENT_OPERATOR") }),
  z.object({ type: z.literal("SUPERVISOR_OF_OPERATOR") }),
  z.object({ type: z.literal("MANAGER_OF_OPERATOR") }),
  z.object({ type: z.literal("ROLE"), role: escalationRoleSchema }),
  z.object({ type: z.literal("USER"), userId: z.string() }),
])
export type OutputTarget = z.infer<typeof outputTargetSchema>
export type OutputTargetType = OutputTarget["type"]

export const OUTPUT_TARGET_LABELS: Record<OutputTargetType, string> = {
  CURRENT_OPERATOR: "O próprio operador",
  SUPERVISOR_OF_OPERATOR: "Supervisor do operador",
  MANAGER_OF_OPERATOR: "Gerente do operador",
  ROLE: "Cargo específico",
  USER: "Pessoa específica",
}

export const outputSurfaceSchema = z.enum(["FOLLOW_UP", "AVATAR", "CHAT", "INBOX", "NOTIFICATION", "CUSTOM_SURFACE"])
export type OutputSurface = z.infer<typeof outputSurfaceSchema>

export const OUTPUT_SURFACE_LABELS: Record<OutputSurface, string> = {
  FOLLOW_UP: "Acompanhamento",
  AVATAR: "Avatar",
  CHAT: "Chat",
  INBOX: "Pendências",
  NOTIFICATION: "Notificação",
  CUSTOM_SURFACE: "Superfície customizada",
}

// CUSTOM_SURFACE já existe no domínio (arquitetura pronta pra novas telas), mas ainda não há
// nenhum cadastro administrativo de superfícies customizadas — expô-la no builder deixaria o
// admin digitar um identificador técnico sem sentido nenhum de UI. Some da lista visível até
// esse cadastro existir; o enum/tipo continua completo.
export const VISIBLE_OUTPUT_SURFACES: OutputSurface[] = outputSurfaceSchema.options.filter((surface) => surface !== "CUSTOM_SURFACE")

export const CONVERSATIONAL_OUTPUT_SURFACES: OutputSurface[] = ["AVATAR", "CHAT"]

export const avatarInteractionModeSchema = z.enum(["PASSIVE", "PROMPT", "IMMEDIATE"])
export type AvatarInteractionMode = z.infer<typeof avatarInteractionModeSchema>

/** Workflow Outputs V1: nenhum modo faz o avatar falar sozinho — a fala só começa quando a pessoa aceita ouvir. PASSIVE
 * não avisa no sino (o recado/conversa aparece só no painel da INIA); PROMPT e IMMEDIATE avisam no sino. */
export const AVATAR_INTERACTION_MODE_LABELS: Record<AvatarInteractionMode, string> = {
  PASSIVE: "Discreto — aparece no painel da INIA, sem aviso no sino",
  PROMPT: "Avisar — aparece no painel da INIA e avisa no sino",
  IMMEDIATE: "Destacar — como Avisar (a voz só começa quando a pessoa aceitar)",
}

export const outputNodeConfigSchema = z.object({
  target: outputTargetSchema,
  surfaces: z.array(outputSurfaceSchema).min(1),
  interactionMode: avatarInteractionModeSchema.optional(),
  source: z.string(),
  /** "Esta entrega deve apresentar os materiais de apoio já recomendados pelo node de origem?"
   * Só em superfícies que renderizam a recomendação (Acompanhamento do próprio operador).
   * Ausente = false — Workflows existentes não mudam. Espelho de output-schema.ts (backend). */
  includeSupportMaterials: z.boolean().optional(),
})
export type OutputNodeConfig = z.infer<typeof outputNodeConfigSchema>

/**
 * V1.5.10 — origem das interações de "Gerar feedback de atendimento" (feedback INDIVIDUAL de UMA interação; nunca o
 * feedback de monitoria de "Chamar agente", nunca feedback de indicador). Espelho de graph-schema.ts (backend).
 */
export const interactionFeedbackSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TRIGGER_INTERACTION") }),
  z.object({
    kind: z.literal("COLLABORATOR_SAMPLE"),
    period: periodWindowSchema,
    sampleSize: z.number().int().min(1).max(10),
    strategy: z.enum(["MOST_RECENT", "DETERMINISTIC_SAMPLE"]),
  }),
])
export type InteractionFeedbackSource = z.infer<typeof interactionFeedbackSourceSchema>

/**
 * V1.5.12 — "Gerar feedback": feedback OFICIAL de monitoria/indicador pela camada de confiabilidade obrigatória. Recebe a
 * saída EXPLÍCITA de um "Chamar agente"/"Orquestrador" anterior (`sourceNodeId`). Espelho de graph-schema.ts (backend).
 */
export const feedbackDomainSelectionSchema = z.enum(["AUTO", "MONITORING", "INDICATOR"])
export type FeedbackDomainSelection = z.infer<typeof feedbackDomainSelectionSchema>
export const FEEDBACK_DOMAIN_LABELS: Record<FeedbackDomainSelection, string> = { AUTO: "Automático", MONITORING: "Monitoria", INDICATOR: "Indicador" }

export const actionConfigSchema = z.union([
  z.object({
    actionType: z.literal("CALL_AGENT"),
    agentId: z.string(),
    scheduledDataSource: scheduledDataSourceSchema.optional(),
    // "Formato da análise" — FEEDBACK (ausente = comportamento de sempre) ou PROCESS_AUDIT
    // (conformidade etapa a etapa contra o procedimento oficial da KB; só com gatilho por Flag).
    outputContract: agentOutputContractSchema.optional(),
    // Missão do Agent de síntese quando o node roda depois de "Consolidar resultados" (mesmo papel
    // da `instruction` do node Orquestrador). Ignorada no caminho individual.
    instruction: z.string().optional(),
    // "Ferramentas nesta execução": RESTRIÇÃO das capacidades de investigação do Agent (effective =
    // Agent ∩ allowed). Ausente = as do Agent. Nunca concede o que o Agent não tem.
    allowedCapabilities: z.array(investigationCapabilitySchema).optional(),
  }),
  z.object({
    actionType: z.literal("SET_CONFIG_VALUE"),
    configKey: z.string(),
    valueType: z.enum(["BOOLEAN", "NUMERIC", "TEXT"]),
    value: z.union([z.boolean(), z.number(), z.string()]),
  }),
  z.object({
    actionType: z.literal("ESCALATE"),
    target: hierarchicalTargetSchema,
    contentSource: z.string().trim().min(1).optional(),
    surfaces: z.array(outputSurfaceSchema).min(1),
    interactionMode: avatarInteractionModeSchema.optional(),
    reason: z.string().trim().optional(),
    continuation: z.enum(["CONTINUE", "END_BRANCH"]).optional(),
  }),
  // Valor fixo x dinâmico (evolução de Variáveis do Workflow): `value` presente = fixo (legado);
  // `sourcePath` presente = dinâmico — mesma convenção de condition.sourcePath ("nodeOutputs.trigger"
  // | "nodeOutputs.<nodeId>[.structuredResult.<path>]" | "variables.<variableId>").
  z.object({
    actionType: z.literal("GENERATE_FEEDBACK"),
    sourceNodeId: z.string(),
    feedbackDomain: feedbackDomainSelectionSchema,
  }),
  // V1.5.10 — feedback direto de atendimento (legado/interno): workflows publicados continuam executando.
  z.object({
    actionType: z.literal("GENERATE_INTERACTION_FEEDBACK"),
    interactionSource: interactionFeedbackSourceSchema,
  }),
  z.object({
    actionType: z.literal("SET_VARIABLE"),
    variableId: z.string(),
    value: z.union([z.boolean(), z.number(), z.string()]).optional(),
    sourcePath: z.string().min(1).optional(),
  }),
])
export type ActionConfig = z.infer<typeof actionConfigSchema>

/** O "corpo" de uma regra simples de Condition — usado tanto pela Condition simples quanto por
 * cada regra de um `ConditionGroup` (AND/OR — Parte 3 do pedido). historicalQuery não é
 * composável dentro de um grupo nesta versão (ver relatório). */
export const conditionRuleSchema = z.object({
  comparator: comparatorSchema,
  thresholdBoolean: z.boolean().nullable().optional(),
  thresholdNumeric: z.number().nullable().optional(),
  sourcePath: z.string().min(1).optional(),
  thresholdText: z.string().optional(),
})
export type ConditionRule = z.infer<typeof conditionRuleSchema>

export const conditionGroupSchema = z.object({
  operator: z.enum(["ALL", "ANY"]),
  rules: z.array(conditionRuleSchema).min(1),
})
export type ConditionGroup = z.infer<typeof conditionGroupSchema>

const positionSchema = z.object({ x: z.number(), y: z.number() })
const baseNodeFields = { id: z.string(), label: z.string(), position: positionSchema }

/** Critério de "Selecionar colaboradores" (EMPLOYEE_COLLECTION) — mesmo formato de uma Condition
 * "de dados", sem sourcePath/group (nunca fazem sentido avaliados candidato a candidato). Espelha
 * employeeSelectionCriterionSchema do backend (graph-schema.ts). */
export const employeeSelectionCriterionSchema = z.object({
  comparator: comparatorSchema,
  thresholdBoolean: z.boolean().nullable().optional(),
  thresholdNumeric: z.number().nullable().optional(),
  thresholdText: z.string().optional(),
  historicalQuery: historicalQuerySchema.optional(),
  performanceQuery: performanceQuerySchema.optional(),
})
export type EmployeeSelectionCriterion = z.infer<typeof employeeSelectionCriterionSchema>

// "Por ranking" (evolução de "Selecionar colaboradores") — espelha o backend (graph-schema.ts)
// 1:1. HIGHEST/LOWEST são matemáticos; BEST/WORST dependem de `indicator_definitions.desired_direction`
// (MEASUREMENT) ou são sempre HIGHER (Atingimento, já normalizado) — resolvido no backend, nunca
// no frontend. IMPROVED/DECLINED (evolução de Evolução/Queda) só existem em rankingBasis "CHANGE".
// OPERATIONAL_QUARTILE: quartil OPERACIONAL (calculado sobre a população candidata, o indicador,
// a janela e a agregação) — nunca o quartil oficial do fechamento.
export const employeeRankingSelectionSchema = z.enum(["HIGHEST", "LOWEST", "BEST", "WORST", "IMPROVED", "DECLINED", "OPERATIONAL_QUARTILE"])
export type EmployeeRankingSelection = z.infer<typeof employeeRankingSelectionSchema>

// COUNT deliberadamente excluído (ranking de performance por VALOR, nunca por quantidade de amostras).
export const employeeRankingAggregationSchema = z.enum(["AVERAGE", "WEIGHTED_AVERAGE", "SUM", "LATEST", "MINIMUM", "MAXIMUM"])
export type EmployeeRankingAggregation = z.infer<typeof employeeRankingAggregationSchema>

// "O que ranquear?" — ausente/"VALUE" = comportamento original; "CHANGE" = variação percentual
// entre o período atual e o período anterior equivalente (mesma infraestrutura de compareTo
// PREVIOUS_PERIOD da Condition, nunca um 2º calendário).
export const employeeRankingBasisSchema = z.enum(["VALUE", "CHANGE"])
export type EmployeeRankingBasis = z.infer<typeof employeeRankingBasisSchema>

// "Separar ranking por" — reaproveita Grupo (TEAM) e Subgrupo (SUBTEAM), os mesmos conceitos já
// usados em toda a Abrangência do Workflow. Ausente/"NONE" = sem separação (comportamento original).
export const employeeRankingPartitionBySchema = z.enum(["NONE", "TEAM", "SUBTEAM"])
export type EmployeeRankingPartitionBy = z.infer<typeof employeeRankingPartitionBySchema>

export const employeeRankingConfigSchema = z.object({
  source: rankingSourceSchema.optional(),
  indicatorCode: z.string().trim().min(1).optional(),
  aggregation: employeeRankingAggregationSchema.optional(),
  period: historicalPeriodSchema.optional(),
  selection: employeeRankingSelectionSchema.optional(),
  count: z.number().int().positive().optional(),
  rankingBasis: employeeRankingBasisSchema.optional(),
  partitionBy: employeeRankingPartitionBySchema.optional(),
  // Só com selection OPERATIONAL_QUARTILE: Q1 = melhor 25% … Q4 = pior 25% da população do
  // balde, pela direção oficial. `count` é ignorado nesse modo (entram todos do quartil).
  operationalQuartile: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional(),
  // Cobertura mínima (fração) — só source MEASUREMENT; quem fica abaixo sai do ranking como SEM DADOS.
  minimumCoverage: z.number().min(0.01).max(1).optional(),
})
export type EmployeeRankingConfig = z.infer<typeof employeeRankingConfigSchema>

/** Rótulos descritivos do EDITOR (o resumo do card continua usando HISTORICAL_AGGREGATION_LABELS, curto). */
export const MEASUREMENT_AGGREGATION_OPTION_LABELS: Record<HistoricalAggregation, string> = {
  COUNT: "Quantidade de ocorrências",
  AVERAGE: "Média simples dos períodos",
  WEIGHTED_AVERAGE: "Média ponderada pelo volume (Σ total ÷ Σ volume)",
  SUM: "Soma dos períodos",
  LATEST: "Último valor (snapshot)",
  MINIMUM: "Mínimo (pior/melhor período)",
  MAXIMUM: "Máximo (pior/melhor período)",
}

export type OperationalAggregationKind = "WEIGHTED_AVERAGE" | "RATE" | "AVERAGE" | "SUM" | "LATEST"

export const OPERATIONAL_AGGREGATION_LABELS: Record<OperationalAggregationKind, string> = {
  WEIGHTED_AVERAGE: "média ponderada (Σ total ÷ Σ volume)",
  RATE: "taxa (Σ ocorrências ÷ Σ elegíveis)",
  AVERAGE: "média simples dos períodos",
  SUM: "soma dos períodos",
  LATEST: "último valor (snapshot)",
}

/** Espelho de `allowedMeasurementAggregations` (backend) — o editor só oferece o que faz sentido pro indicador. */
export function allowedAggregationsFor(kind: OperationalAggregationKind | undefined): HistoricalAggregation[] {
  switch (kind) {
    case "WEIGHTED_AVERAGE":
    case "RATE":
      return ["WEIGHTED_AVERAGE", "MINIMUM", "MAXIMUM", "COUNT"]
    case "SUM":
      return ["SUM", "AVERAGE", "MINIMUM", "MAXIMUM", "COUNT"]
    case "LATEST":
      return ["LATEST", "MAXIMUM", "MINIMUM", "AVERAGE", "COUNT"]
    default:
      return ["AVERAGE", "MINIMUM", "MAXIMUM", "COUNT"]
  }
}

export function defaultAggregationFor(kind: OperationalAggregationKind | undefined): HistoricalAggregation {
  return allowedAggregationsFor(kind)[0]!
}

/** Agregações disponíveis pra fontes OFICIAIS (Atingimento/PRV): só entre fechamentos. */
export const OFFICIAL_AGGREGATIONS: HistoricalAggregation[] = ["AVERAGE", "MINIMUM", "MAXIMUM"]

export const OPERATIONAL_QUARTILE_LABELS: Record<"Q1" | "Q2" | "Q3" | "Q4", string> = {
  Q1: "Q1 operacional — melhores 25%",
  Q2: "Q2 operacional",
  Q3: "Q3 operacional",
  Q4: "Q4 operacional — piores 25%",
}

/**
 * "Avaliar política de acompanhamento" — nó PRÓPRIO: quais intervenções cabem segundo uma política PUBLICADA (critérios,
 * prazos, responsáveis e aprovações são da política). Espelho de `interventionPolicyNodeConfigSchema` do backend.
 */
export const interventionPolicyModeSchema = z.enum(["RECOMMEND_ONLY", "APPLY_POLICY"])
export const interventionPolicyNodeConfigSchema = z.object({ policyId: z.string(), mode: interventionPolicyModeSchema, analysisSourceNodeIds: z.array(z.string()) })
export type InterventionPolicyNodeConfig = z.infer<typeof interventionPolicyNodeConfigSchema>
export const INTERVENTION_POLICY_MODE_LABELS: Record<InterventionPolicyNodeConfig["mode"], string> = { RECOMMEND_ONLY: "Somente recomendar", APPLY_POLICY: "Abrir intervenções conforme a política" }

export const flowNodeSchema = z.discriminatedUnion("type", [
  z.object({ ...baseNodeFields, type: z.literal("trigger"), config: z.object({}) }),
  z.object({ ...baseNodeFields, type: z.literal("wait"), config: z.object({ durationMs: z.number() }) }),
  z.object({
    ...baseNodeFields,
    type: z.literal("condition"),
    config: z.object({
      comparator: comparatorSchema,
      thresholdBoolean: z.boolean().nullable().optional(),
      thresholdNumeric: z.number().nullable().optional(),
      // Presente = compara um valor do Execution Context (saída de um node anterior) em vez do
      // valor bruto do trigger. Ex.: "nodeOutputs.diagnostico.severity".
      sourcePath: z.string().min(1).optional(),
      thresholdText: z.string().optional(),
      // Prioridade: group > historicalQuery > performanceQuery > sourcePath > legado.
      historicalQuery: historicalQuerySchema.optional(),
      performanceQuery: performanceQuerySchema.optional(),
      group: conditionGroupSchema.optional(),
    }),
  }),
  // "Selecionar colaboradores" (EMPLOYEE_COLLECTION) — reduz a população ATUAL (Estrutura
  // Consolidada ou uma coleção anterior) a um subconjunto, reusando a MESMA engine determinística
  // das Conditions. Nunca pede Grupo/Time/Subgrupo de novo — vem do Workflow. Dois modos
  // (evolução de Ranking): `selectionMode` ausente/"CONDITION" = comportamento original
  // (`criterion`); "RANKING" = novo (`ranking`) — os dois continuam produzindo EMPLOYEE_COLLECTION.
  z.object({
    ...baseNodeFields,
    type: z.literal("select_employees"),
    config: z.object({
      selectionMode: z.enum(["CONDITION", "RANKING"]).optional(),
      criterion: employeeSelectionCriterionSchema.optional(),
      ranking: employeeRankingConfigSchema.optional(),
    }),
  }),
  // "Aplicar individualmente" — fan-out: 1 execução por colaborador da coleção mais próxima, sem
  // configuração própria. Opcionalmente pareado a um "consolidate_results" adiante (fan-in/JOIN).
  z.object({ ...baseNodeFields, type: z.literal("apply_individually"), config: z.object({}) }),
  // "Consolidar resultados" — fan-in/JOIN: espera TODAS as execuções nascidas de um "Aplicar
  // individualmente" chegarem a um estado terminal, então continua com um resultado consolidado.
  // Sem configuração própria (mesmo padrão de apply_individually) — origem resolvida da topologia.
  z.object({ ...baseNodeFields, type: z.literal("consolidate_results"), config: z.object({}) }),
  z.object({ ...baseNodeFields, type: z.literal("action"), config: actionConfigSchema }),
  z.object({ ...baseNodeFields, type: z.literal("orchestrator"), config: orchestratorNodeConfigSchema }),
  z.object({ ...baseNodeFields, type: z.literal("human_review"), config: humanReviewNodeConfigSchema }),
  z.object({ ...baseNodeFields, type: z.literal("output"), config: outputNodeConfigSchema }),
  z.object({ ...baseNodeFields, type: z.literal("intervention_policy"), config: interventionPolicyNodeConfigSchema }),
  z.object({ ...baseNodeFields, type: z.literal("end"), config: z.object({}) }),
])
export type FlowNode = z.infer<typeof flowNodeSchema>
export type FlowNodeType = FlowNode["type"]

export const flowEdgeSchema = z.object({ id: z.string(), source: z.string(), sourceHandle: z.string(), target: z.string() })
export type FlowEdge = z.infer<typeof flowEdgeSchema>

export const flowGraphSchema = z.object({ nodes: z.array(flowNodeSchema), edges: z.array(flowEdgeSchema) })
export type FlowGraph = z.infer<typeof flowGraphSchema>

export const NODE_TYPE_LABELS: Record<FlowNodeType, string> = {
  trigger: "Gatilho",
  wait: "Aguardar",
  condition: "Condição",
  select_employees: "Selecionar colaboradores",
  apply_individually: "Aplicar individualmente",
  consolidate_results: "Consolidar resultados",
  action: "Ação",
  orchestrator: "Orquestrador",
  human_review: "Revisão humana",
  output: "Output",
  intervention_policy: "Avaliar política de acompanhamento",
  end: "Fim",
}

export type FlowBranch = { id: string; label: string }

/** Média/Mínimo/Máximo (nunca COUNT) e performanceQuery podem não ter dado nenhum pro
 * período/pessoa — isso NUNCA equivale a FALSE (Parte 11 do pedido), por isso ganham uma 3ª
 * saída própria. COUNT nunca precisa disso (zero ocorrências é uma resposta válida). */
function conditionHasNoDataBranch(config: Extract<FlowNode, { type: "condition" }>["config"]): boolean {
  if (config.historicalQuery) {
    const aggregation = config.historicalQuery.aggregation
    return aggregation !== undefined && aggregation !== "COUNT"
  }
  return Boolean(config.performanceQuery)
}

export function nodeBranches(node: FlowNode): FlowBranch[] {
  switch (node.type) {
    case "trigger":
    case "wait":
    case "orchestrator":
    case "output":
    case "select_employees":
    case "apply_individually":
    case "consolidate_results":
    case "intervention_policy":
      return [{ id: "always", label: "Sempre" }]
    case "action":
      if (node.config.actionType === "ESCALATE" && node.config.continuation === "END_BRANCH") return []
      return [{ id: "always", label: "Sempre" }]
    case "condition": {
      const branches = [
        { id: "true", label: "Sim" },
        { id: "false", label: "Não" },
      ]
      if (conditionHasNoDataBranch(node.config)) branches.push({ id: "no_data", label: "Sem dados" })
      return branches
    }
    case "human_review":
      return [
        { id: "approved", label: "Aprovado" },
        { id: "rejected", label: "Reprovado" },
        { id: "escalated", label: "Escalar" },
      ]
    case "end":
      return []
  }
}

export function findNode(graph: FlowGraph, nodeId: string): FlowNode | undefined {
  return graph.nodes.find((node) => node.id === nodeId)
}

/**
 * Todo node alcançável andando pra trás a partir de `fromNodeId`, seguindo exclusivamente as
 * edges do grafo — nunca a posição visual do canvas, nunca "o node anterior na lista". Um node
 * com dois predecessores (ex.: dois braços de uma Condition convergindo) tem ambos os ramos
 * incluídos; um node "irmão" (outro branch da mesma Condition) nunca aparece, porque não há
 * edge alguma ligando os dois ramos entre si.
 */
export function findAncestorNodeIds(graph: FlowGraph, fromNodeId: string): Set<string> {
  const incomingByTarget = new Map<string, FlowEdge[]>()
  for (const edge of graph.edges) {
    const list = incomingByTarget.get(edge.target) ?? []
    list.push(edge)
    incomingByTarget.set(edge.target, list)
  }
  const visited = new Set<string>()
  let frontier = [fromNodeId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const nodeId of frontier) {
      for (const edge of incomingByTarget.get(nodeId) ?? []) {
        if (visited.has(edge.source)) continue
        visited.add(edge.source)
        next.push(edge.source)
      }
    }
    frontier = next
  }
  return visited
}

/**
 * Busca em largura PARA TRÁS a partir de `fromNodeId` (o próprio nó de partida nunca é testado):
 * devolve o predecessor mais próximo que `isMatch` aceita. `isBoundary` marca nós que a busca não
 * atravessa (paredes opacas, ex.: um JOIN entre duas fases). Ordem determinística: nível a nível,
 * arestas na ordem do grafo; cada nó é expandido uma vez.
 */
function findNearestPredecessor<T extends FlowNode>(
  graph: FlowGraph,
  fromNodeId: string,
  isMatch: (node: FlowNode | undefined) => node is T,
  isBoundary: (node: FlowNode | undefined) => boolean = () => false,
): T | undefined {
  const incomingByTarget = new Map<string, FlowEdge[]>()
  for (const edge of graph.edges) {
    const list = incomingByTarget.get(edge.target) ?? []
    list.push(edge)
    incomingByTarget.set(edge.target, list)
  }
  const visited = new Set<string>()
  let frontier = [fromNodeId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const nodeId of frontier) {
      if (visited.has(nodeId)) continue
      visited.add(nodeId)
      for (const edge of incomingByTarget.get(nodeId) ?? []) {
        const sourceNode = findNode(graph, edge.source)
        if (isMatch(sourceNode)) return sourceNode
        if (isBoundary(sourceNode)) continue
        next.push(edge.source)
      }
    }
    frontier = next
  }
  return undefined
}

/** Anda pra trás a partir de um node procurando o "select_employees" mais próximo — espelha
 * findPrecedingCollectionNode do backend (graph-schema.ts). Usado pro config panel de "Aplicar
 * individualmente" mostrar de qual seleção a coleção vem, e pela validação de contexto.
 *
 * PARA (não atravessa) qualquer "consolidate_results" encontrado — essencial pra fan-outs
 * sequenciais (`Apply A → Join A → Select B → Apply B → Join B`, fan-in/JOIN): sem isso, `Select
 * B` acharia `Select A` como "coleção anterior", misturando fases separadas pelo Join. */
export function findPrecedingCollectionNode(graph: FlowGraph, fromNodeId: string): Extract<FlowNode, { type: "select_employees" }> | undefined {
  return findNearestPredecessor(
    graph,
    fromNodeId,
    (node): node is Extract<FlowNode, { type: "select_employees" }> => node?.type === "select_employees",
    (node) => node?.type === "consolidate_results",
  )
}

/** Anda pra trás a partir de um "consolidate_results" (JOIN) procurando o "apply_individually"
 * que o alimenta — espelha findPrecedingFanOutNode do backend, incluindo o boundary (PARA em
 * qualquer OUTRO Join encontrado, nunca atravessa — fan-outs sequenciais). */
export function findPrecedingFanOutNode(graph: FlowGraph, fromNodeId: string): Extract<FlowNode, { type: "apply_individually" }> | undefined {
  return findNearestPredecessor(
    graph,
    fromNodeId,
    (node): node is Extract<FlowNode, { type: "apply_individually" }> => node?.type === "apply_individually",
    (node) => node?.type === "consolidate_results" && node.id !== fromNodeId,
  )
}

/** Anda pra FRENTE a partir de um "apply_individually" procurando o "consolidate_results" (JOIN)
 * pareado — espelha findPairedJoinNode do backend. `undefined` = sem Join (comportamento legado,
 * opcional). */
export function findPairedJoinNode(graph: FlowGraph, fromNodeId: string): Extract<FlowNode, { type: "consolidate_results" }> | undefined {
  const outgoingBySource = new Map<string, FlowEdge[]>()
  for (const edge of graph.edges) {
    const list = outgoingBySource.get(edge.source) ?? []
    list.push(edge)
    outgoingBySource.set(edge.source, list)
  }
  const visited = new Set<string>([fromNodeId])
  let frontier = [fromNodeId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const nodeId of frontier) {
      for (const edge of outgoingBySource.get(nodeId) ?? []) {
        if (visited.has(edge.target)) continue
        visited.add(edge.target)
        const targetNode = findNode(graph, edge.target)
        if (targetNode?.type === "consolidate_results") return targetNode
        if (targetNode?.type === "apply_individually" || targetNode?.type === "select_employees") continue
        next.push(edge.target)
      }
    }
    frontier = next
  }
  return undefined
}

/** Anda pra trás a partir de um node procurando o "consolidate_results" (JOIN) mais próximo —
 * espelha findPrecedingJoinNode do backend. Usado pelo painel do Orchestrator pós-JOIN. */
export function findPrecedingJoinNode(graph: FlowGraph, fromNodeId: string): Extract<FlowNode, { type: "consolidate_results" }> | undefined {
  return findNearestPredecessor(graph, fromNodeId, (node): node is Extract<FlowNode, { type: "consolidate_results" }> => node?.type === "consolidate_results")
}

export type NodeSubjectContext = "STRUCTURE" | "EMPLOYEE_COLLECTION" | "EMPLOYEE" | "CONSOLIDATED_RESULT"

/** Contexto de sujeito de CADA node — espelha resolveNodeContexts do backend (graph-schema.ts),
 * mesma semântica exata (BFS pra frente a partir do Trigger). Usado só pela validação do grafo
 * (workflow-validation.ts); em modo Individual o resultado nunca é consultado. */
export function resolveNodeContexts(graph: FlowGraph): Map<string, NodeSubjectContext> {
  const outgoingBySource = new Map<string, FlowEdge[]>()
  for (const edge of graph.edges) {
    const list = outgoingBySource.get(edge.source) ?? []
    list.push(edge)
    outgoingBySource.set(edge.source, list)
  }
  const contexts = new Map<string, NodeSubjectContext>()
  const triggerNode = graph.nodes.find((node) => node.type === "trigger")
  if (!triggerNode) return contexts
  contexts.set(triggerNode.id, "STRUCTURE")
  const visited = new Set<string>([triggerNode.id])
  let frontier = [triggerNode.id]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const nodeId of frontier) {
      const current = contexts.get(nodeId)!
      const node = findNode(graph, nodeId)
      const propagated: NodeSubjectContext =
        node?.type === "select_employees"
          ? "EMPLOYEE_COLLECTION"
          : node?.type === "apply_individually"
            ? "EMPLOYEE"
            : node?.type === "consolidate_results"
              ? "CONSOLIDATED_RESULT"
              : current
      for (const edge of outgoingBySource.get(nodeId) ?? []) {
        if (visited.has(edge.target)) continue
        visited.add(edge.target)
        contexts.set(edge.target, propagated)
        next.push(edge.target)
      }
    }
    frontier = next
  }
  return contexts
}

/** Origem aceita por "Gerar feedback" (V1.5.12): "Chamar agente" ou "Orquestrador". */
export function feedbackSourceTypeOf(node: FlowNode | undefined): "AGENT" | "ORCHESTRATOR" | null {
  if (!node) return null
  if (node.type === "orchestrator") return "ORCHESTRATOR"
  if (node.type === "action" && node.config.actionType === "CALL_AGENT") return "AGENT"
  return null
}

/** Domínio efetivo de "Gerar feedback" — espelho de resolveFeedbackDomain (backend). */
export function resolveFeedbackDomain(selection: FeedbackDomainSelection, triggerKind: string | null, sourceType: "AGENT" | "ORCHESTRATOR" | null, sourceContract: string | null = null): "MONITORING" | "INDICATOR" | null {
  if (selection !== "AUTO") return selection
  if (triggerKind === "channel_flag") return "MONITORING"
  if (triggerKind === "indicator" && sourceType === "AGENT") return "INDICATOR"
  // Indicator Diagnosis V1 — agenda + "Diagnóstico do fechamento do PRV" (espelho do backend).
  if (triggerKind === "schedule" && sourceType === "AGENT" && sourceContract === "PRV_CLOSING_DIAGNOSIS") return "INDICATOR"
  // Indicator Diagnosis V2 — agenda + "Diagnóstico de um indicador" (fechamento oficial, sem PRV).
  if (triggerKind === "schedule" && sourceType === "AGENT" && sourceContract === "INDICATOR_DIAGNOSIS") return "INDICATOR"
  return null
}

/** Espelho de isClosingDiagnosisSource (backend): diagnóstico a partir do fechamento oficial — do PRV (V1) ou de um indicador (V2). */
export function isClosingDiagnosisSource(node: FlowNode | undefined | null): boolean {
  if (!node || node.type !== "action" || node.config.actionType !== "CALL_AGENT") return false
  if (node.config.outputContract === "PRV_CLOSING_DIAGNOSIS") return true
  return node.config.outputContract === "INDICATOR_DIAGNOSIS" && node.config.scheduledDataSource?.kind === "PERFORMANCE" && Boolean(node.config.scheduledDataSource.indicatorCode)
}

/** Contrato de saída do nó de origem de "Gerar feedback" (só "Chamar agente" declara). */
export const sourceOutputContractOf = (node: FlowNode | undefined | null): string | null => (node && node.type === "action" && node.config.actionType === "CALL_AGENT" ? node.config.outputContract ?? null : null)

/** Superfícies com consumidor real para o feedback confiável — espelho de RELIABLE_FEEDBACK_SURFACES (Chat/Avatar desde os
 * Workflow Outputs V1). */
export const RELIABLE_FEEDBACK_SURFACES: OutputSurface[] = ["FOLLOW_UP", "NOTIFICATION", "CHAT", "AVATAR"]
/** Superfícies que hoje só gravam registro, sem tela que as leia. */
export const SURFACES_WITHOUT_CONSUMER: OutputSurface[] = ["INBOX", "CUSTOM_SURFACE"]
