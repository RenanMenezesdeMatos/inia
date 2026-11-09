import { z } from "zod"
import { comparatorSchema } from "./comparator-schema.js"
import { conditionGroupSchema } from "./condition-rule-schema.js"
import { escalationRoleSchema } from "./escalation-role-schema.js"
import { avatarInteractionModeSchema, outputNodeConfigSchema, outputSurfaceSchema } from "./output-schema.js"
import { quartileSchema } from "../../indicators/domain/employee-performance-schema.js"
import { investigationCapabilitySchema } from "../../investigation/domain/capabilities.js"

export { escalationRoleSchema, type EscalationRole } from "./escalation-role-schema.js"
export { comparatorSchema, COMPARATORS_BY_FIELD_TYPE, type Comparator } from "./comparator-schema.js"
export { conditionRuleSchema, conditionGroupSchema, type ConditionRule, type ConditionGroup } from "./condition-rule-schema.js"

export const periodWindowSchema = z.enum(["TODAY", "D1", "WEEK", "MONTH", "QUARTER"])

export const scheduledDataSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("INDICATOR"),
    // null = resumo geral (todo indicador com meta de time pro time do operador)
    indicatorCode: z.string().trim().min(1).nullable(),
    period: periodWindowSchema,
  }),
  z.object({
    kind: z.literal("MONITORING"),
    sampleSize: z.number().int().min(1).max(10),
    period: periodWindowSchema,
  }),
  // Fechamentos oficiais — PRV (employee_prv_performance) e indicadores (employee_indicator_
  // performance: valor, meta, atingimento, peso, quartil) dos últimos N fechamentos mensais,
  // lidos prontos da fonte oficial, nunca recalculados. É a fonte certa para especialistas de
  // PRV/Performance: sem ela, um Workflow "Q4 recorrente" (que decide pelo quartil oficial)
  // alimentava o agente com medições brutas de outra tabela — ou falhava quando não havia.
  z.object({
    kind: z.literal("PERFORMANCE"),
    closures: z.number().int().min(1).max(3),
    // INDICATOR DIAGNOSIS V2 — com o formato "Diagnóstico do indicador": o indicador cujo fechamento OFICIAL é diagnosticado
    // diretamente (sem PRV). Ausente = o comportamento de sempre (resumo/diagnóstico do fechamento inteiro).
    indicatorCode: z.string().trim().min(1).max(40).nullable().optional(),
  }),
])

// "Analisar" — o que fazer com as medições do indicador na janela. COUNT é a "reincidência" de
// sempre (conta medições que batem um filtro); AVERAGE/MINIMUM/MAXIMUM agregam o VALOR
// diretamente, sem filtro por medição — não fazem sentido misturados na mesma UI (ver Parte 13
// do pedido), por isso o motor trata os dois modos com campos praticamente disjuntos abaixo.
// Camada operacional (medições, migration 052): WEIGHTED_AVERAGE (Σ total ÷ Σ volume — TMA,
// taxas, notas ponderadas por respostas), SUM e LATEST (snapshot, ex.: backlog). Quais valem pra
// cada indicador vem de `indicator_definitions.operational_aggregation` (ver
// indicators/domain/operational-aggregation.ts) — o publish rejeita combinação sem sentido
// (ex.: média simples de TMA com volumes diferentes por dia). Atingimento/PRV (fonte oficial)
// continuam só com AVERAGE/MINIMUM/MAXIMUM.
export const historicalAggregationSchema = z.enum(["COUNT", "AVERAGE", "WEIGHTED_AVERAGE", "SUM", "LATEST", "MINIMUM", "MAXIMUM"])

// Semântica documentada (Parte 10 do pedido): ROLLING_DAYS = janela móvel de N dias terminando
// AGORA (inclui hoje parcial). CALENDAR = período de calendário — por padrão o ANTERIOR
// COMPLETO (semana civil anterior, mês civil anterior, etc.), ou o CORRENTE/parcial quando
// `phase: "CURRENT"` é explícito (Parte 18/B5 da evolução de Unidade de Análise — "Este mês",
// "Hoje" — sempre parcial, terminando agora, nunca fingindo que o período já fechou). Ausente =
// "PREVIOUS", comportamento de sempre, sem migração. `DAY` cobre Hoje/Ontem. Máximo de um
// semestre (não há caso de uso pra janela maior — ver Parte 19, anti-overengineering).
// "Últimos N fechamentos" (Atingimento/PRV/Quartil) ou "Últimos N meses fechados" (Valor bruto —
// correção pontual de PERÍODO) — contagem de competências reais, nunca aproximação por dias.
// `unit` fixo em "MONTH": a fonte não tem competência semanal real pra nenhuma origem hoje
// (achievement/PRV são sempre mensais — reference_period "AAAA-MM"; medição bruta usa mês civil
// fechado) — nunca inventamos granularidade semanal, documentado como limitação. Proveniência
// diferente por origem: Atingimento/PRV contam linhas de reference_period reais persistidas pela
// fonte (ver resolveClosuresAggregation em node-handlers.ts); Valor bruto conta MESES DE
// CALENDÁRIO civis completos, consecutivos, nunca o mês corrente, nunca substitui uma
// competência ausente por outra mais antiga (ver aggregateMeasurementClosedMonths em
// node-handlers.ts). Mínimo 2 (mesmo padrão de performanceRecurrenceSchema).
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

// Comparação (Parte 19 da evolução de Unidade de Análise): além do valor fixo (ausente — sempre
// foi assim, thresholdNumeric no config do node), a Condition histórica pode comparar contra a
// Meta vigente (tabela `goals`, resolvida no momento da avaliação — nunca hardcoded) ou contra o
// mesmo cálculo rodado no período imediatamente anterior equivalente. Nunca "simulado": os dois
// modos leem dado real já existente, reaproveitando a mesma agregação (ver
// resolveHistoricalResult em node-handlers.ts).
export const historicalCompareToSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("GOAL") }),
  z.object({
    kind: z.literal("PREVIOUS_PERIOD"),
    // Ausente/"VALUE" = compara o valor atual contra o valor do período anterior diretamente
    // (GT/LT já respondem "aumentou"/"diminuiu"). "PERCENT" compara a VARIAÇÃO percentual
    // ((atual - anterior) / anterior * 100) contra thresholdNumeric — "aumentou pelo menos 10%"
    // vira comparator GTE + thresholdNumeric 10 (ver resolveHistoricalResult em node-handlers.ts).
    changeMode: z.enum(["VALUE", "PERCENT"]).optional(),
  }),
])

// De onde vem o valor agregado — MEASUREMENT (padrão, sempre foi assim) agrega
// indicator_measurements.value; INDICATOR_ACHIEVEMENT/PRV_ACHIEVEMENT agregam o percentual de
// atingimento já normalizado (employee_indicator_performance/employee_prv_performance — ver
// Parte 33 do pedido), nunca um valor calculado pela aplicação.
// OPERATIONAL_QUARTILE (Condition): "este colaborador está no Q4 OPERACIONAL de TMA nos últimos
// 7 dias?" — o quartil é calculado pela INIA sobre a POPULAÇÃO elegível do Workflow (Abrangência
// ∩ Filtro populacional, ou a coleção anterior), com a MESMA implementação do Ranking
// (indicators/domain/operational-quartile.ts). Usa indicatorCode + period (janela) + aggregation
// + comparator EQUALS/NOT_EQUALS + thresholdText "Q1".."Q4". Nunca o quartil oficial do fechamento.
export const historicalSourceSchema = z.enum(["MEASUREMENT", "INDICATOR_ACHIEVEMENT", "PRV_ACHIEVEMENT", "OPERATIONAL_QUARTILE"])
export type HistoricalSource = z.infer<typeof historicalSourceSchema>
/** Fontes de um Ranking: o quartil operacional lá é uma SELEÇÃO (`selection.kind = OPERATIONAL_QUARTILE`) sobre a fonte MEASUREMENT, não uma fonte. */
export const rankingSourceSchema = z.enum(["MEASUREMENT", "INDICATOR_ACHIEVEMENT", "PRV_ACHIEVEMENT"])

export const historicalQuerySchema = z.object({
  // Nome interno preservado por compatibilidade com Conditions já publicadas — a UI chama isso
  // de "Histórico do indicador" (não só reincidência) desde que aggregation deixou de ser
  // sempre COUNT.
  kind: z.literal("INDICATOR_THRESHOLD_COUNT"),
  // Obrigatório pra MEASUREMENT/INDICATOR_ACHIEVEMENT, ausente/ignorado pra PRV_ACHIEVEMENT —
  // PRV é uma fonte própria (employee_prv_performance), nunca pertence a um indicador específico
  // (mesmo padrão já usado por performanceQuerySchema.indicatorCode pra PRV_ACHIEVEMENT/
  // PRV_QUARTILE logo abaixo). A exigência condicional é validada no publish (workflow-router.ts)
  // e no runtime (condition-evaluator.ts), nunca só aqui.
  indicatorCode: z.string().trim().min(1).optional(),
  // Sem `.default()` de propósito (mesmo com "ausente = COUNT/MEASUREMENT" sendo o
  // comportamento pretendido) — `.default()` faz `z.infer` exigir o campo no tipo TS resultante
  // (só o parse aplicaria o default), o que quebraria a leitura de Conditions publicadas antes
  // deste campo existir. O fallback "ausente = COUNT/MEASUREMENT" é aplicado explicitamente em
  // node-handlers.ts, não aqui.
  aggregation: historicalAggregationSchema.optional(),
  source: historicalSourceSchema.optional(),
  // Só usados quando aggregation === "COUNT" — filtro por medição individual ("considerar
  // medições onde valor < 3"). O comparator/thresholdNumeric FORA deste objeto (no config do
  // node) compara a CONTAGEM resultante (COUNT) ou o VALOR agregado (AVERAGE/MIN/MAX).
  comparator: comparatorSchema.optional(),
  indicatorThreshold: z.number().optional(),
  // windowDays: formato legado (Conditions publicadas antes de `period` existir) — só lido,
  // nunca mais escrito pela UI. `period` é o formato atual; exatamente um dos dois precisa
  // estar presente (validado no publish, não aqui, mesmo padrão do resto do arquivo).
  windowDays: z.number().int().positive().optional(),
  period: historicalPeriodSchema.optional(),
  // Só relevante pra AVERAGE/MINIMUM/MAXIMUM — abaixo dessa quantidade de medições no período,
  // o resultado é SEM_DADOS mesmo havendo alguma medição (Parte 12 do pedido).
  minimumSampleSize: z.number().int().positive().optional(),
  // Cobertura mínima OPERACIONAL (fração 0–1): dias com medição ÷ dias elegíveis da janela (dias
  // úteis, a partir da admissão do colaborador). Abaixo disso o resultado é SEM DADOS — nunca
  // zero, nunca Q4. Só medições (Valor do indicador) com janela; configuração explícita do
  // Workflow (nunca regra silenciosa por indicador).
  minimumCoverage: z.number().min(0.01).max(1).optional(),
  // Ausente = comparação de sempre (thresholdNumeric fixo). Só relevante pra AVERAGE/MINIMUM/
  // MAXIMUM (COUNT compara contagem contra um número, não faz sentido comparar "contagem" com
  // uma meta ou com a contagem do período anterior — ver validação no publish).
  compareTo: historicalCompareToSchema.optional(),
})
export type HistoricalQuery = z.infer<typeof historicalQuerySchema>

// Métricas de performance de colaborador que vêm prontas da fonte externa (nunca calculadas
// aqui — ver employee-performance-schema.ts). *_QUARTILE são sempre "Q1".."Q4", nunca inferidas
// do valor bruto (Q1 = melhor, Q4 = pior, sempre — Parte 27 do pedido).
export const performanceMetricSchema = z.enum([
  "INDICATOR_VALUE",
  "INDICATOR_ACHIEVEMENT",
  "INDICATOR_QUARTILE",
  "INDICATOR_WEIGHT",
  "PRV_ACHIEVEMENT",
  "PRV_QUARTILE",
])

// "Últimos N fechamentos" — só faz sentido pra *_QUARTILE (validado no publish): em vez do
// snapshot mais recente, CONTA quantos dos últimos N snapshots mensais já persistidos
// (employee_indicator_performance/employee_prv_performance) têm quartile = matchQuartile. O
// comparator/thresholdNumeric do node comparam essa CONTAGEM (mesmo padrão de historicalQuery
// COUNT: filtro interno + comparação externa) — nunca calcula quartil, só conta valores prontos.
export const performanceRecurrenceSchema = z.object({
  periods: z.number().int().min(2).max(24),
  matchQuartile: quartileSchema,
})

export const performanceQuerySchema = z.object({
  kind: z.literal("EMPLOYEE_PERFORMANCE"),
  metric: performanceMetricSchema,
  // Obrigatório pra métricas INDICATOR_*, ausente/ignorado pra PRV_* (validado no publish).
  indicatorCode: z.string().trim().min(1).optional(),
  recurrence: performanceRecurrenceSchema.optional(),
})
export type PerformanceQuery = z.infer<typeof performanceQuerySchema>

/**
 * Quem recebe — resolução hierárquica extensível, não hardcoded por caso. Compartilhado por
 * Human Review (campo `reviewTarget`) e pela Action Escalonar (campo `target`) — mesma
 * hierarquia, mesmo resolvedor (`resolveHierarchicalTargetIds`), nunca duas implementações:
 * - ROLE_OF_OPERATOR: sobe reports_to_id a partir do OPERADOR da ocorrência procurando o cargo
 *   pedido (inclui Coordenador).
 * - ROLE_OF_PREVIOUS_REVIEWER: sobe reports_to_id a partir de quem decidiu um node Human Review
 *   ANTERIOR nesta mesma execução (`previousReviewNodeId` aponta pro id desse node — precisa
 *   ser um ancestral real no grafo, validado no publish). O reviewerId de origem já fica
 *   gravado em node_outputs[previousReviewNodeId].reviewerId pela rota de decisão.
 * - SPECIFIC_USER: pessoa fixa, escolhida pelo admin.
 */
export const hierarchicalTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ROLE_OF_OPERATOR"), role: escalationRoleSchema }),
  z.object({ type: z.literal("ROLE_OF_PREVIOUS_REVIEWER"), role: escalationRoleSchema, previousReviewNodeId: z.string().min(1) }),
  z.object({ type: z.literal("SPECIFIC_USER"), userId: z.string().uuid() }),
])
export type HierarchicalTarget = z.infer<typeof hierarchicalTargetSchema>

// "Formato da análise" de Chamar agente (Flag + transcrição) — FEEDBACK (ausente = comportamento
// de sempre) ou PROCESS_AUDIT (conformidade etapa a etapa contra o procedimento oficial da KB,
// ver agents/domain/process-audit.ts). Decisão do Workflow, nunca do Agent: o mesmo especialista
// serve aos dois contratos. Só faz sentido com gatilho por Flag (validado no publish).
// V1.6.0: PROCESS_ASSESSMENT = monitoria PROCESS-CENTRIC (processos aplicáveis × etapas × evidência × regra da base),
// verificada pela camada de confiabilidade ("Gerar feedback"); ver agents/domain/process-assessment-contract.ts.
// V1.6.1: INDICATOR_DIAGNOSIS = diagnóstico do indicador (só gatilho por Indicador): o sistema decompõe o resultado, escolhe
// o motivo e a amostra de atendimentos; o Agent avalia os processos de cada um (indicator-diagnosis-contract.ts).
// INDICATOR DIAGNOSIS V1: PRV_CLOSING_DIAGNOSIS = diagnóstico do FECHAMENTO oficial do PRV (gatilho por Agenda + fonte "Fechamentos
// oficiais"): o sistema lê o fechamento, faz a triagem pela estratégia de cada indicador, escolhe população/amostra e REAPROVEITA
// as observações de processo já verificadas; o Agent só avalia as chamadas que faltam (nenhuma = nenhuma chamada ao modelo).
// RECOGNITION = reconhecimento de quem um ranking escolheu (Agenda + "Fechamentos oficiais"): o sistema diz ao Agent a posição e como cada
// resultado ficou frente à meta, e ele só escreve. Ser o melhor basta, mesmo abaixo da meta (workflows/application/recognition-fact.ts).
export const agentOutputContractSchema = z.enum(["FEEDBACK", "PROCESS_AUDIT", "PROCESS_ASSESSMENT", "INDICATOR_DIAGNOSIS", "PRV_CLOSING_DIAGNOSIS", "RECOGNITION"])

/** Só "Melhores" e "Evolução" dão motivo para reconhecer. "Maiores/Menores valores" são pura matemática: num TMA, o maior valor é o pior resultado. */
export const isRecognitionRankingSelection = (selection: string | undefined): selection is "BEST" | "IMPROVED" => selection === "BEST" || selection === "IMPROVED"

/**
 * V1.5.10 — de onde vem a(s) interação(ões) de "Gerar feedback de atendimento" (feedback INDIVIDUAL de UMA interação;
 * InteractionFeedback V1 — nunca o feedback de monitoria legado de "Chamar agente", nunca feedback de indicador):
 * - TRIGGER_INTERACTION: a interação que disparou o Workflow (gatilho por Flag) — nunca sorteia outra;
 * - COLLABORATOR_SAMPLE: interações do colaborador da execução na janela (mesmo catálogo de períodos da agenda),
 *   as mais recentes ou uma amostra DETERMINÍSTICA (semente = execução + colaborador + janela; nunca Math.random).
 * Nada de prompt, modelo, validadores ou política de QA aqui: isso é política da INIA.
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

/**
 * V1.5.12 — "Gerar feedback" (feedback OFICIAL de monitoria/indicador pela camada de confiabilidade OBRIGATÓRIA). Nunca
 * investiga de novo: recebe EXPLICITAMENTE a saída de um nó "Chamar agente" ou "Orquestrador" anterior (`sourceNodeId`,
 * validado no publish como ancestral compatível) e produz um ReliableFeedbackArtifact (READY | HOLD_FOR_QA | BLOCKED) que
 * o Workflow leva adiante (Revisão humana opcional → Output). AUTO infere o domínio pelo contrato da origem quando é
 * inequívoco (gatilho por Flag → MONITORIA; gatilho por Indicador + Agent → INDICADOR). Nada de modelo/prompt/validadores
 * aqui: confiabilidade é obrigatória, não configurável.
 */
export const feedbackDomainSelectionSchema = z.enum(["AUTO", "MONITORING", "INDICATOR"])
export type FeedbackDomainSelection = z.infer<typeof feedbackDomainSelectionSchema>

export const actionConfigSchema = z.union([
  z.object({
    actionType: z.literal("CALL_AGENT"),
    agentId: z.string().uuid(),
    // Versão do agente que esta etapa executa (PEN-002, item 6). Fixada ao escolher o agente e mantida em toda republicação
    // até alguém trocá-la no rascunho; publicar o agente nunca a muda. Ausente só em versões publicadas antes do versionamento
    // (valem pela versão de origem da migração — workflow-agent-version.ts).
    agentVersionId: z.string().uuid().optional(),
    scheduledDataSource: scheduledDataSourceSchema.optional(),
    outputContract: agentOutputContractSchema.optional(),
    // Missão dada ao Agent quando o node roda DEPOIS de "Consolidar resultados" (Agent de síntese,
    // synthesis-agent-executor.ts) — o mesmo papel da `instruction` do node Orquestrador. Ignorada
    // no caminho individual (ali o contexto da execução já diz o que analisar).
    instruction: z.string().trim().min(1).optional(),
    // RESTRIÇÃO das capacidades de investigação NESTA execução: effective = Agent ∩ allowed
    // (investigation/domain/capabilities.ts). Ausente (nodes antigos) = as capacidades do Agent.
    // Nunca concede o que o Agent não tem.
    allowedCapabilities: z.array(investigationCapabilitySchema).optional(),
  }),
  z.object({
    actionType: z.literal("SET_CONFIG_VALUE"),
    configKey: z.string().trim().min(2),
    valueType: z.enum(["BOOLEAN", "NUMERIC", "TEXT"]),
    value: z.union([z.boolean(), z.number(), z.string()]),
  }),
  // Evolução do Escalonamento: composição de Target + Conteúdo + Surface, exatamente as mesmas
  // abstrações já usadas por Output/Human Review (ver hierarchicalTargetSchema/outputSurfaceSchema
  // mais abaixo) — "encaminhar/elevar responsabilidade", nunca "aguardar decisão" (isso continua
  // sendo só o Human Review). `continuation` decide se o fluxo segue pela edge "always" (padrão)
  // ou encerra o branch sem precisar de edge nenhuma (ver nodeBranches).
  z.object({
    actionType: z.literal("ESCALATE"),
    target: hierarchicalTargetSchema,
    contentSource: z.string().trim().min(1).optional(),
    surfaces: z.array(outputSurfaceSchema).min(1),
    interactionMode: avatarInteractionModeSchema.optional(),
    reason: z.string().trim().optional(),
    continuation: z.enum(["CONTINUE", "END_BRANCH"]).optional(),
  }),
  // Distinto de SET_CONFIG_VALUE: escreve no Execution Context da própria execução (via
  // enrollment.variables), nunca em org_config_values — nunca vaza entre execuções/operadores.
  // `variableId` referencia workflow_variables.id (imutável mesmo se o admin renomear a
  // variável depois); o tipo do valor é validado contra a definição da variável, não aqui.
  // Valor fixo x dinâmico (evolução de Variáveis do Workflow): `value` presente = fixo (legado,
  // sempre foi assim); `sourcePath` presente = dinâmico — mesma convenção já usada por
  // condition.sourcePath ("nodeOutputs.trigger" | "nodeOutputs.<nodeId>[.structuredResult.<path>]"
  // | "variables.<variableId>"), sem precisar de um campo "modo" redundante.
  z.object({
    actionType: z.literal("GENERATE_FEEDBACK"),
    sourceNodeId: z.string().trim().min(1),
    feedbackDomain: feedbackDomainSelectionSchema,
  }),
  // V1.5.10 — DIRECT_INTERACTION_FEEDBACK (compatibilidade/legado interno): analisa a interação de novo pelo núcleo
  // semântico direto. Workflows publicados continuam executando; não é o caminho de novos feedbacks de monitoria.
  z.object({
    actionType: z.literal("GENERATE_INTERACTION_FEEDBACK"),
    interactionSource: interactionFeedbackSourceSchema,
  }),
  z.object({
    actionType: z.literal("SET_VARIABLE"),
    variableId: z.string().uuid(),
    value: z.union([z.boolean(), z.number(), z.string()]).optional(),
    sourcePath: z.string().trim().min(1).optional(),
  }),
])
export type ActionConfig = z.infer<typeof actionConfigSchema>

export const humanReviewDecisionSchema = z.enum(["approved", "rejected", "escalated"])
export type HumanReviewDecision = z.infer<typeof humanReviewDecisionSchema>

export const humanReviewNodeConfigSchema = z.object({
  reviewTarget: hierarchicalTargetSchema,
  // O que mostrar pro revisor — mesma convenção de path de Condition/Output (ver
  // content-sources.ts no frontend, resolveSource no backend). Opcional: nem toda revisão
  // precisa mostrar um resultado estruturado (pode ser só a instrução).
  contentSource: z.string().trim().min(1).optional(),
  instruction: z.string().trim().optional(),
})
export type HumanReviewNodeConfig = z.infer<typeof humanReviewNodeConfigSchema>

export const orchestratorNodeConfigSchema = z.object({
  // Referência explícita — nunca implícita por escopo — a qual Orchestrator publicado este
  // node executa. Pode existir mais de um Orchestrator (Monitoria Geral, Retenção, etc.), cada
  // um com seus próprios especialistas; o Workflow decide qual usar aqui, não o motor sozinho.
  orchestratorId: z.string().uuid(),
  // Versão do Orquestrador (PEN-076): cada versão publicada fixa as versões dos agentes dela. Ausente só em versões do
  // Workflow publicadas antes do versionamento (valem pela versão de origem da migração).
  orchestratorVersionId: z.string().uuid().optional(),
  // Instrução fixa dada ao Orchestrator — não há um operador vivo perguntando nada aqui, o
  // Workflow está atribuindo uma missão. Reaproveita a mesma infraestrutura de mensagem/prompt
  // do caminho interativo (run-orchestrated-reply.ts), só que com uma única mensagem fixa.
  instruction: z.string().trim().min(1),
  // V1.6.0 — formato pedido aos ESPECIALISTAS com transcrição (Flag): FEEDBACK (ausente = comportamento de sempre) ou
  // PROCESS_ASSESSMENT (cada especialista avalia os processos do seu domínio, com o rastro da base que viu). Decisão do
  // Workflow, nunca do Orquestrador; só com gatilho por Flag (validado no publish).
  specialistOutputContract: z.enum(["FEEDBACK", "PROCESS_ASSESSMENT"]).optional(),
  // V1.7.1 — ROTEAMENTO. Ausente/MODEL = o Orquestrador escolhe os especialistas com IA (comportamento de sempre). DOMAINS = o
  // Workflow DECLARA os domínios de negócio deste disparo (ex.: Flag contestação → Faturamento): o runtime aciona o especialista
  // de cada domínio sem chamada de IA de roteamento — só quando cada domínio resolve para EXATAMENTE um especialista ativo do
  // Orquestrador (senão volta para o roteamento pela IA, registrado). Configuração declarativa, nunca "if flag" no código.
  routing: z
    .discriminatedUnion("mode", [z.object({ mode: z.literal("MODEL") }), z.object({ mode: z.literal("DOMAINS"), businessDomainIds: z.array(z.string().uuid()).min(1).max(5) })])
    .optional(),
})
export type OrchestratorNodeConfig = z.infer<typeof orchestratorNodeConfigSchema>

/**
 * "Avaliar política de acompanhamento" — nó PRÓPRIO (não é uma ação de "Ação" nem parte do Escalar): QUAIS intervenções cabem,
 * segundo uma política PUBLICADA (módulo interventions). Os critérios, prazos, responsáveis e aprovações são da política; o
 * nó só escolhe a política, o modo e quais nós anteriores entram como referência de análise. Gatilho continua dizendo QUANDO
 * começa; Escalar continua encaminhando responsabilidade; Revisão humana continua esperando uma decisão.
 */
export const interventionPolicyModeSchema = z.enum(["RECOMMEND_ONLY", "APPLY_POLICY"])
export const interventionPolicyNodeConfigSchema = z.object({
  policyId: z.string().uuid(),
  /** RECOMMEND_ONLY = toda intervenção nasce proposta (o responsável aceita); APPLY_POLICY = abre conforme a política. */
  mode: interventionPolicyModeSchema,
  /** Nós anteriores cujos registros (feedback publicado, caso, atendimento) entram como referência de análise do relatório. */
  analysisSourceNodeIds: z.array(z.string().min(1)).max(5),
})
export type InterventionPolicyNodeConfig = z.infer<typeof interventionPolicyNodeConfigSchema>

const positionSchema = z.object({ x: z.number(), y: z.number() })

const baseNodeFields = { id: z.string().min(1), label: z.string(), position: positionSchema }

/**
 * Critério de "Selecionar colaboradores" — EXATAMENTE o mesmo formato que uma Condition "de
 * dados" já usa (comparator/thresholds + historicalQuery/performanceQuery), sem `sourcePath`/
 * `group` (que dependem do Execution Context de UMA execução específica, nunca fazem sentido
 * avaliados candidato a candidato sobre uma estrutura). Isso é o que permite reaproveitar
 * `evaluateDataCondition` (condition-evaluator.ts) sem nenhum adaptador — o objeto já É o
 * `DataConditionConfig` que a função espera (estruturalmente compatível, `sourcePath`/`group`
 * são opcionais nela também).
 */
export const employeeSelectionCriterionSchema = z.object({
  comparator: comparatorSchema,
  thresholdBoolean: z.boolean().nullable().optional(),
  thresholdNumeric: z.number().nullable().optional(),
  thresholdText: z.string().optional(),
  historicalQuery: historicalQuerySchema.optional(),
  performanceQuery: performanceQuerySchema.optional(),
})
export type EmployeeSelectionCriterion = z.infer<typeof employeeSelectionCriterionSchema>

// "Por ranking" (evolução de "Selecionar colaboradores", Parte 65/66 do pedido) — HIGHEST/LOWEST
// são puramente matemáticos (maior/menor valor bruto, nunca dependem de metadado); BEST/WORST têm
// significado de NEGÓCIO ("melhor desempenho") e são resolvidos em runtime contra
// `indicator_definitions.desired_direction` pra MEASUREMENT, ou tratados como sempre-HIGHER pra
// INDICATOR_ACHIEVEMENT/PRV_ACHIEVEMENT (atingimento já vem normalizado da fonte — maior é sempre
// melhor, mesma convenção já usada por Quartil "Q1=melhor, Q4=pior, sempre") — ver
// select-employees-executor.ts. Nunca inferido do nome do indicador.
//
// IMPROVED/DECLINED (evolução de Evolução/Queda — Parte 1/13/14 do pedido) — nunca "maior/menor
// current-previous" cru: filtram por `performanceChange` (a variação já normalizada pela direção
// do indicador, positivo=melhorou/negativo=piorou) ser estritamente >0/<0, ordenando pela maior
// melhora/piora. Só existem em modo `rankingBasis: "CHANGE"` — validado no publish, nunca junto
// de HIGHEST/LOWEST/BEST/WORST (que só existem em "VALUE").
// OPERATIONAL_QUARTILE: seleciona quem está num quartil OPERACIONAL (calculado pela INIA sobre
// a população candidata, o indicador, a janela e a agregação — ver
// indicators/domain/operational-quartile.ts), nunca o quartil oficial do fechamento.
export const employeeRankingSelectionSchema = z.enum(["HIGHEST", "LOWEST", "BEST", "WORST", "IMPROVED", "DECLINED", "OPERATIONAL_QUARTILE"])

// COUNT deliberadamente EXCLUÍDO (Parte 16 do pedido — ranking de performance por VALOR, nunca por
// quantidade de amostras) — só existe no enum de Condition (historicalAggregationSchema).
export const employeeRankingAggregationSchema = z.enum(["AVERAGE", "WEIGHTED_AVERAGE", "SUM", "LATEST", "MINIMUM", "MAXIMUM"])

// "O que ranquear?" (evolução de Evolução/Queda) — ausente/"VALUE" = comportamento original
// (ranqueia o valor agregado do período); "CHANGE" = ranqueia a VARIAÇÃO percentual entre o
// período atual (`period`) e o período anterior equivalente, resolvida pela MESMA infraestrutura
// de `compareTo: PREVIOUS_PERIOD` que a Condition histórica já usa (Parte 6/8/52/53 do pedido) —
// nunca um 2º calendário/fórmula. Nome interno "rankingBasis" (Parte 1: sugestão VALUE/CHANGE
// preservada, adaptada ao padrão de nomes já usado no arquivo, ex.: `historicalSourceSchema`).
export const employeeRankingBasisSchema = z.enum(["VALUE", "CHANGE"])

// "Separar ranking por" (Parte 24/25 do pedido) — reaproveita os MESMOS conceitos de Grupo/Time
// (TEAM) e Subgrupo (SUBTEAM) já usados em toda a Abrangência/estrutura do Workflow, nunca uma
// hierarquia nova. Ausente/"NONE" = comportamento original (um ranking só, sem partição).
export const employeeRankingPartitionBySchema = z.enum(["NONE", "TEAM", "SUBTEAM"])
export type EmployeeRankingPartitionBy = z.infer<typeof employeeRankingPartitionBySchema>

/**
 * Configuração de "Selecionar colaboradores" em modo Ranking (Parte 66 do pedido original, Parte
 * 76 desta evolução) — todos os campos opcionais no schema pra permitir DRAFT incompleto (mesmo
 * padrão de historicalQuerySchema logo acima); publish (workflow-router.ts) exige presença
 * condicional a `rankingBasis`. `source`/`indicatorCode`/`aggregation`/`period` são EXATAMENTE os
 * mesmos campos de `historicalQuerySchema` (mesma semântica, mesmo resolvedor —
 * `resolveHistoricalResult` em condition-evaluator.ts, nunca uma segunda implementação) — só sem
 * `comparator`/`windowDays` legado, que não fazem sentido pra ranking. Não é um
 * `z.discriminatedUnion` por `rankingBasis`/`partitionBy` de propósito: um Ranking VALUE
 * publicado ANTES desta evolução nunca teve esses dois campos — um discriminated union exigiria
 * o campo presente, quebrando a leitura de configs antigas (mesmo motivo documentado em
 * `historicalQuerySchema` pra não usar `.default()`). Ausência = VALUE/NONE, sempre (Parte 2/25/75).
 */
export const employeeRankingConfigSchema = z.object({
  source: rankingSourceSchema.optional(),
  indicatorCode: z.string().trim().min(1).optional(),
  aggregation: employeeRankingAggregationSchema.optional(),
  period: historicalPeriodSchema.optional(),
  selection: employeeRankingSelectionSchema.optional(),
  count: z.number().int().positive().optional(),
  rankingBasis: employeeRankingBasisSchema.optional(),
  partitionBy: employeeRankingPartitionBySchema.optional(),
  // Só com selection OPERATIONAL_QUARTILE: qual quartil operacional selecionar (Q1 = melhor 25%
  // … Q4 = pior 25% da população do balde, pela direção oficial do indicador). `count` é
  // ignorado nesse modo — entram TODOS os colaboradores do quartil.
  operationalQuartile: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional(),
  // Cobertura mínima operacional (fração 0–1) — mesma semântica de historicalQuery.minimumCoverage:
  // quem tem cobertura abaixo fica FORA do ranking/quartil como SEM DADOS (nunca "pior" por omissão).
  minimumCoverage: z.number().min(0.01).max(1).optional(),
})
export type EmployeeRankingConfig = z.infer<typeof employeeRankingConfigSchema>

export const flowNodeSchema = z.discriminatedUnion("type", [
  z.object({ ...baseNodeFields, type: z.literal("trigger"), config: z.object({}) }),
  z.object({ ...baseNodeFields, type: z.literal("wait"), config: z.object({ durationMs: z.number().int().positive() }) }),
  z.object({
    ...baseNodeFields,
    type: z.literal("condition"),
    config: z.object({
      // Continua obrigatório mesmo em modo `group`/`historicalQuery` avançado por simplicidade
      // de schema (evita transformar o objeto inteiro numa union) — nesses modos o motor ignora
      // este campo e usa o de dentro de cada regra/consulta; a UI escreve um valor inofensivo.
      comparator: comparatorSchema,
      thresholdBoolean: z.boolean().nullable().optional(),
      thresholdNumeric: z.number().nullable().optional(),
      // Quando presente, o valor comparado vem do Execution Context (ex.:
      // "nodeOutputs.diagnostico.severity") em vez do valor bruto do trigger que disparou o
      // enrollment — permite condicionar em cima do resultado de um Agent/Orchestrator node
      // anterior. Ausente = comportamento legado (valor do trigger).
      sourcePath: z.string().trim().min(1).optional(),
      // Só usado quando sourcePath resolve pra uma string não-numérica (ex.: "HIGH",
      // "CRITICAL") — únicos casos em que EQUALS compara texto em vez de número/booleano.
      thresholdText: z.string().optional(),
      // Prioridade quando mais de um estiver presente: group > historicalQuery > performanceQuery
      // > sourcePath > legado (valor bruto do trigger) — ver o case "condition" em
      // node-handlers.ts.
      historicalQuery: historicalQuerySchema.optional(),
      performanceQuery: performanceQuerySchema.optional(),
      group: conditionGroupSchema.optional(),
    }),
  }),
  // "Selecionar colaboradores" (EMPLOYEE_COLLECTION) — reduz a população ATUAL (Estrutura
  // Consolidada ou uma coleção anterior, nunca reexpande) a um subconjunto, reusando a MESMA
  // engine determinística das Conditions — nunca IA (ver select-employees-executor.ts). Nunca
  // pede Grupo/Time/Subgrupo/Supervisor de novo — a Abrangência já vem do Workflow. Dois modos
  // (Parte 1/65 da evolução de Ranking): `selectionMode` AUSENTE ou `"CONDITION"` = comportamento
  // original ("quais atendem a esta condição?", usa `criterion`); `"RANKING"` = novo ("quais são
  // os N primeiros depois de ordenar?", usa `ranking`) — nunca um 3º subject/contexto, os dois
  // continuam produzindo EMPLOYEE_COLLECTION.
  z.object({
    ...baseNodeFields,
    type: z.literal("select_employees"),
    config: z.object({
      selectionMode: z.enum(["CONDITION", "RANKING"]).optional(),
      criterion: employeeSelectionCriterionSchema.optional(),
      ranking: employeeRankingConfigSchema.optional(),
    }),
  }),
  // "Aplicar individualmente" — fan-out: cria uma execução (workflow_enrollments) de verdade por
  // colaborador da coleção mais próxima, cada uma seguindo o resto do grafo independente, nunca
  // reiniciando no Trigger. Sem configuração própria (Parte 40 do pedido). Opcionalmente pareado a
  // um "consolidate_results" mais adiante no grafo (fan-in/JOIN) — ver findPairedJoinNode.
  z.object({ ...baseNodeFields, type: z.literal("apply_individually"), config: z.object({}) }),
  // "Consolidar resultados" — fan-in/JOIN: espera TODAS as execuções individuais nascidas de um
  // "Aplicar individualmente" específico chegarem a um estado terminal, então continua o PAI uma
  // única vez com um resultado consolidado (EmployeeFanInOutput). Sem configuração própria (mesmo
  // padrão de apply_individually) — a origem é resolvida da topologia, nunca escolhida à mão (ver
  // findPrecedingFanOutNode). Opcional: um "Aplicar individualmente" sem Join correspondente
  // continua funcionando exatamente como antes (cada filho termina sozinho).
  z.object({ ...baseNodeFields, type: z.literal("consolidate_results"), config: z.object({}) }),
  z.object({ ...baseNodeFields, type: z.literal("action"), config: actionConfigSchema }),
  // Chama o Orchestrator (módulo assistant) como um passo do grafo — mesma resolução/execução
  // do caminho interativo do chat, só que sem pergunta de operador nenhuma (usa `question` fixo
  // do config) e o Workflow continua no controle da navegação depois. O Orchestrator nunca
  // decide o próximo node, só devolve dados pro Execution Context.
  z.object({ ...baseNodeFields, type: z.literal("orchestrator"), config: orchestratorNodeConfigSchema }),
  // Pausa o enrollment indefinidamente (sem timer) até uma pessoa aprovar/reprovar/escalar via
  // a rota de decisão — nunca uma chamada síncrona bloqueada, o motor só reagenda quando a
  // decisão grava `node_outputs[nodeId].decision` e libera o próximo tick.
  z.object({ ...baseNodeFields, type: z.literal("human_review"), config: humanReviewNodeConfigSchema }),
  // Publica o conteúdo do Execution Context para um destinatário + superfície(s) — é o único
  // node que tem permissão de gerar efeito visível pro operador/gestor. Nenhum outro node
  // (Agent, Orchestrator) publica nada por conta própria.
  z.object({ ...baseNodeFields, type: z.literal("output"), config: outputNodeConfigSchema }),
  z.object({ ...baseNodeFields, type: z.literal("intervention_policy"), config: interventionPolicyNodeConfigSchema }),
  z.object({ ...baseNodeFields, type: z.literal("end"), config: z.object({}) }),
])
export type FlowNode = z.infer<typeof flowNodeSchema>

export { outputTargetSchema, outputSurfaceSchema, avatarInteractionModeSchema, type OutputTarget, type OutputSurface, type AvatarInteractionMode } from "./output-schema.js"

export const flowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sourceHandle: z.string().min(1),
  target: z.string().min(1),
})
export type FlowEdge = z.infer<typeof flowEdgeSchema>

export const flowGraphSchema = z.object({
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
})
export type FlowGraph = z.infer<typeof flowGraphSchema>

export type FlowBranch = { id: string; label: string }

/** Uma Condition histórica com agregação AVERAGE/MINIMUM/MAXIMUM, ou uma consulta de
 * performance (Parte 8), pode não ter dado nenhum pro período/pessoa — isso NUNCA equivale a
 * FALSE (ver Parte 11 do pedido), por isso ganha uma 3ª saída própria. COUNT nunca precisa disso
 * (zero ocorrências que batem o filtro é uma resposta válida, não ausência de dado) — mantém as
 * Conditions de reincidência já publicadas com exatamente 2 saídas, sem qualquer migração. */
function conditionHasNoDataBranch(config: Extract<FlowNode, { type: "condition" }>["config"]): boolean {
  if (config.historicalQuery) {
    const aggregation = config.historicalQuery.aggregation
    return aggregation !== undefined && aggregation !== "COUNT"
  }
  return Boolean(config.performanceQuery)
}

/**
 * Enumera as saídas possíveis de um nó — dono da verdade sobre os ids de branch,
 * nunca a aresta. É o que alimenta os Handles de saída no canvas.
 */
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
      // Escalonar "Encerrar branch" (Parte 12/13 do pedido) conclui a execução sem precisar de
      // edge de saída nenhuma — mesmo tratamento visual/de motor que o node `end` já tem (zero
      // Handle no canvas, zero "always" exigido no motor). Mesmo padrão condicional já usado
      // por conditionHasNoDataBranch logo abaixo.
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

export function findEdge(graph: FlowGraph, sourceNodeId: string, sourceHandle: string): FlowEdge | undefined {
  return graph.edges.find((edge) => edge.source === sourceNodeId && edge.sourceHandle === sourceHandle)
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

/**
 * Anda para trás a partir de um nó procurando o "condition" mais próximo —
 * usado para remontar o contexto textual (flag/comparador/threshold) que o nó
 * Ação precisa quando chama um agente, sem precisar carregar isso antecipadamente.
 */
export function findPrecedingCondition(graph: FlowGraph, fromNodeId: string): Extract<FlowNode, { type: "condition" }> | undefined {
  return findNearestPredecessor(graph, fromNodeId, (node): node is Extract<FlowNode, { type: "condition" }> => node?.type === "condition")
}

/**
 * Todo node alcançável andando pra trás a partir de `fromNodeId`, seguindo exclusivamente as
 * edges do grafo — mesma navegação de `findAncestorNodeIds` no frontend (content-sources.ts).
 * Usado pra restringir o picker de "revisor anterior" (Human Review) a nodes human_review que
 * são de fato ancestrais, e validar isso no publish.
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
 * Anda para trás a partir de um nó procurando o "select_employees" mais próximo — mesmo padrão
 * de `findPrecedingCondition` acima. Usado em runtime (node-handlers.ts) pra saber de qual
 * `node_outputs[nodeId]` ler a coleção ATUAL (a mais próxima, nunca a estrutura original quando
 * há refinamento — Parte 3/82 do pedido). `undefined` = não achou nenhum select_employees
 * ancestral, então o contexto é a Estrutura Consolidada inteira.
 *
 * A caminhada PARA em qualquer "consolidate_results" encontrado (trata como parede opaca, nunca
 * atravessa) — essencial pra fan-outs sequenciais (`Apply A → Join A → Select B → Apply B →
 * Join B`, fan-in/JOIN): sem isso, `Select B` acharia `Select A` como "coleção anterior" e
 * tentaria refinar a partir dela, misturando duas fases separadas pelo Join. Com o boundary,
 * `Select B` não acha coleção nenhuma e deriva sua população do zero (estrutura ∩ elegibilidade),
 * exatamente como um select_employees logo após o Trigger faria.
 */
export function findPrecedingCollectionNode(graph: FlowGraph, fromNodeId: string): Extract<FlowNode, { type: "select_employees" }> | undefined {
  return findNearestPredecessor(
    graph,
    fromNodeId,
    (node): node is Extract<FlowNode, { type: "select_employees" }> => node?.type === "select_employees",
    (node) => node?.type === "consolidate_results",
  )
}

/**
 * Anda para trás a partir de um "consolidate_results" (JOIN) procurando o "apply_individually"
 * que o alimenta — mesmo padrão de `findPrecedingCollectionNode` acima, incluindo o boundary: PARA
 * em qualquer OUTRO "consolidate_results" encontrado no caminho (nunca atravessa, essencial pra
 * fan-outs sequenciais — Join B nunca deve enxergar o Apply A através do Join A). `undefined` =
 * Join sem origem (bloqueado no publish — WORKFLOW_CONSOLIDATE_RESULTS_MISSING_ORIGIN).
 */
export function findPrecedingFanOutNode(graph: FlowGraph, fromNodeId: string): Extract<FlowNode, { type: "apply_individually" }> | undefined {
  return findNearestPredecessor(
    graph,
    fromNodeId,
    (node): node is Extract<FlowNode, { type: "apply_individually" }> => node?.type === "apply_individually",
    (node) => node?.type === "consolidate_results" && node.id !== fromNodeId,
  )
}

/**
 * Anda para FRENTE a partir de um "apply_individually" procurando o "consolidate_results" (JOIN)
 * pareado — para (não atravessa) qualquer OUTRO "apply_individually"/"select_employees"
 * encontrado no caminho (nested fan-out já é inválido pela matriz de contexto, mas a caminhada
 * nunca precisa cruzar um pra achar o Join certo). `undefined` = este fan-out não tem Join
 * (comportamento legado intacto — Parte 35/36 do pedido, JOIN é opcional).
 */
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

/**
 * Anda para trás a partir de um nó procurando o "consolidate_results" (JOIN) mais próximo — mesmo
 * padrão de `findPrecedingCondition`. Usado pelo Orchestrator pós-JOIN pra achar de qual
 * `node_outputs[nodeId]` ler o `EmployeeFanInOutput` consolidado. Nunca precisa de boundary
 * especial: a caminhada pra trás encontra o Join mais próximo primeiro por construção (entre dois
 * Joins sequenciais sempre existe um Select/Apply completo no meio).
 */
export function findPrecedingJoinNode(graph: FlowGraph, fromNodeId: string): Extract<FlowNode, { type: "consolidate_results" }> | undefined {
  return findNearestPredecessor(graph, fromNodeId, (node): node is Extract<FlowNode, { type: "consolidate_results" }> => node?.type === "consolidate_results")
}

export type NodeSubjectContext = "STRUCTURE" | "EMPLOYEE_COLLECTION" | "EMPLOYEE" | "CONSOLIDATED_RESULT"

/**
 * Contexto de sujeito (STRUCTURE/EMPLOYEE_COLLECTION/EMPLOYEE/CONSOLIDATED_RESULT) de CADA node
 * do grafo, inferido só da posição — nunca configurado à mão (a Abrangência/Estrutura já vem do
 * Workflow, Parte 10 do pedido de EMPLOYEE_COLLECTION). BFS pra FRENTE a partir do Trigger (uma
 * passada só), propagando o contexto por aresta: `select_employees` recebe o contexto de entrada
 * mas propaga EMPLOYEE_COLLECTION adiante; `apply_individually` recebe EMPLOYEE_COLLECTION mas
 * propaga EMPLOYEE adiante; `consolidate_results` recebe EMPLOYEE (mesma exigência de
 * apply_individually pra EMPLOYEE_COLLECTION) mas propaga CONSOLIDATED_RESULT adiante — o que
 * permite um novo `select_employees` (refinamento do zero) ou um Orchestrator (síntese) logo
 * depois de um Join. Só faz sentido pra um Workflow em modo Consolidado (STRUCTURE é o ponto de
 * partida) — quem chama decide se aplica (workflow-router.ts só usa isto quando
 * `consolidated_structure` não é null).
 * Assume grafos lineares nos caminhos que envolvem Collection/EMPLOYEE; um mesmo node alcançado
 * por dois caminhos com contextos diferentes fica com o primeiro contexto visitado, não detecta a
 * inconsistência aqui — é por isso que a convergência de um fan-out (todo caminho a partir de um
 * apply_individually chega ao MESMO consolidate_results, com o MESMO contexto EMPLOYEE em toda
 * ramificação) é validada à parte no publish (validateFanOutConvergence, workflow-router.ts),
 * nunca só por este mapa.
 */
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

/** Origem investigativa aceita por "Gerar feedback": "Chamar agente" (fora do caminho de síntese) ou "Orquestrador". */
export function feedbackSourceTypeOf(node: FlowNode | undefined): "AGENT" | "ORCHESTRATOR" | null {
  if (!node) return null
  if (node.type === "orchestrator") return "ORCHESTRATOR"
  if (node.type === "action" && node.config.actionType === "CALL_AGENT") return "AGENT"
  return null
}

/**
 * Domínio EFETIVO de "Gerar feedback" (V1.5.12): explícito vence; AUTO só quando o contrato da origem é inequívoco —
 * gatilho por Flag (há interação) → MONITORING; gatilho por Indicador (há medição) com Agent → INDICATOR. Qualquer outra
 * combinação = null (a publicação recusa; o runtime falha fechado).
 */
export function resolveFeedbackDomain(selection: FeedbackDomainSelection, triggerKind: "channel_flag" | "indicator" | "schedule" | null, sourceType: "AGENT" | "ORCHESTRATOR" | null, sourceContract: string | null = null): "MONITORING" | "INDICATOR" | null {
  if (selection !== "AUTO") return selection
  if (triggerKind === "channel_flag") return "MONITORING"
  if (triggerKind === "indicator" && sourceType === "AGENT") return "INDICATOR"
  // INDICATOR DIAGNOSIS V1 — agenda + "Diagnóstico do fechamento do PRV" = feedback de indicador (o fechamento é o dado oficial).
  if (triggerKind === "schedule" && sourceType === "AGENT" && sourceContract === "PRV_CLOSING_DIAGNOSIS") return "INDICATOR"
  // INDICATOR DIAGNOSIS V2 — agenda + "Diagnóstico do indicador" (fechamento oficial de UM indicador, sem PRV) = feedback de indicador.
  if (triggerKind === "schedule" && sourceType === "AGENT" && sourceContract === "INDICATOR_DIAGNOSIS") return "INDICATOR"
  return null
}

/**
 * INDICATOR DIAGNOSIS V2 — o nó de origem diagnostica um indicador a partir do FECHAMENTO OFICIAL (agenda): o do PRV inteiro (V1) ou
 * o de UM indicador, direto (V2 — "Diagnóstico do indicador" + fonte "Fechamentos oficiais" com indicador). É o que "Gerar feedback"
 * precisa saber para não exigir a medição do gatilho por Indicador.
 */
export function isClosingDiagnosisSource(node: FlowNode | undefined | null): boolean {
  if (!node || node.type !== "action" || node.config.actionType !== "CALL_AGENT") return false
  if (node.config.outputContract === "PRV_CLOSING_DIAGNOSIS") return true
  return node.config.outputContract === "INDICATOR_DIAGNOSIS" && node.config.scheduledDataSource?.kind === "PERFORMANCE" && Boolean(node.config.scheduledDataSource.indicatorCode)
}

/** Contrato de saída do nó de origem de "Gerar feedback" (só "Chamar agente" declara). */
export const sourceOutputContractOf = (node: FlowNode | undefined | null): string | null => (node && node.type === "action" && node.config.actionType === "CALL_AGENT" ? node.config.outputContract ?? null : null)
