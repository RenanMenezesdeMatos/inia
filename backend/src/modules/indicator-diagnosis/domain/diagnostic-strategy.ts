import { z } from "zod"
import { DIAGNOSIS_MIN_ANALYZED, DIAGNOSIS_MIN_SEGMENT_INTERACTIONS, DIAGNOSIS_SAMPLE_SIZE, diagnosisMetricOf, type DiagnosisMetric } from "./indicator-diagnosis.js"
import { PEER_MINIMUM_OBSERVED_INTERACTIONS, PEER_MINIMUM_POPULATION } from "./peer-practice-evidence.js"
import { closingTriageIssues, closingTriageSchema, type ClosingTriageRule } from "./closing-triage.js"
import { INVESTIGATION_MODES, INVESTIGATION_STEPS, INVESTIGATION_STEP_CATALOG, PROCESS_POPULATIONS, type InvestigationMode, type InvestigationStep, type ProcessPopulation } from "./investigation-steps.js"

/**
 * V1.6.2 — ESTRATÉGIA DE DIAGNÓSTICO DO INDICADOR (domínio puro). A operação configura COMO a INIA investiga um indicador;
 * o runtime da V1.6.1 executa. Configuração do cliente = "onde investigar"; guardrails do produto = "o que pode ser afirmado".
 *
 *   CATÁLOGO DE CAPACIDADES  o que o runtime REALMENTE sabe fazer (fonte única — a tela só mostra o que está aqui). Dimensão
 *                            nova = entrada nova no catálogo + suporte no plano; a estratégia não é redesenhada.
 *   PISOS DO PRODUTO         amostra, cobertura de segmento e privacidade de pares têm mínimos do produto: o administrador
 *                            pode EXIGIR mais, nunca menos. Não existe campo para causa, "sempre orientar", "sempre elogiar"
 *                            ou para desligar verificação/privacidade/validadores — isso não é configuração.
 *   CONFIGURAÇÃO TIPADA      nenhum texto livre, nenhum prompt; todo campo tem efeito no runtime.
 */
export const DIAGNOSTIC_STRATEGY_SCHEMA_VERSION = 1 as const

/** Dimensões de segmentação implementadas no plano (V1.6.1: só o assunto/motivo da interação). */
export const SEGMENT_DIMENSIONS = ["SUBJECT"] as const
export type SegmentDimension = (typeof SEGMENT_DIMENSIONS)[number]

/**
 * SINAL DA POPULAÇÃO (06/10/2026, `POPULATION_SIGNAL_V2`): flag sim/não (a flag marca a chamada) OU flag NUMÉRICA com uma condição
 * declarada pelo admin (ex.: `nota_ura` ≤ 2 = chamada com nota baixa). `effect` = o que a chamada sinalizada representa para o
 * indicador, DECLARADO (nunca deduzido do nome da flag): ADVERSE = resultado ruim (quanto mais chamadas com o sinal, pior),
 * FAVORABLE = resultado bom. Ausente (versões anteriores) = o sentido do próprio indicador, exatamente como antes.
 */
export const SIGNAL_OPERATORS = ["LTE", "LT", "GTE", "GT", "EQ"] as const
export type SignalOperator = (typeof SIGNAL_OPERATORS)[number]
export const SIGNAL_OPERATOR_SYMBOLS: Record<SignalOperator, string> = { LTE: "≤", LT: "<", GTE: "≥", GT: ">", EQ: "=" }
export const SIGNAL_EFFECTS = ["ADVERSE", "FAVORABLE"] as const
export type SignalEffect = (typeof SIGNAL_EFFECTS)[number]
export type SignalCondition = { operator: SignalOperator; value: number }
export type PopulationSignal = { flagName: string; condition: SignalCondition | null; effect: SignalEffect | null }

/** Como o sinal aparece para quem lê ("nota_ura ≤ 2", "rechamada") — o mesmo texto na tela, na investigação e na auditoria. */
export function signalLabelOf(signal: { flagName: string; condition?: SignalCondition | null }): string {
  if (!signal.condition) return signal.flagName
  return `${signal.flagName} ${SIGNAL_OPERATOR_SYMBOLS[signal.condition.operator]} ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(signal.condition.value)}`
}

export const NO_DIAGNOSIS_BEHAVIORS = ["FACTUAL_ONLY", "HOLD_FOR_QA", "NO_FEEDBACK"] as const
export type NoDiagnosisBehavior = (typeof NO_DIAGNOSIS_BEHAVIORS)[number]

export const STRATEGY_LIMITS = {
  minimumSegmentInteractions: { floor: DIAGNOSIS_MIN_SEGMENT_INTERACTIONS, max: 50 },
  maxInteractions: { min: DIAGNOSIS_MIN_ANALYZED, max: 10, productDefault: DIAGNOSIS_SAMPLE_SIZE },
  minimumAnalyzed: { floor: DIAGNOSIS_MIN_ANALYZED },
  /** V1.0.1 — quantas chamadas do diagnóstico podem receber o reparo único da cobertura (0 = nenhuma; nunca mais que a amostra). */
  maxRepairInteractions: { min: 0, max: 10 },
  minimumCoveragePercent: { min: 1, max: 100 },
  peerMinimumPopulation: { floor: PEER_MINIMUM_POPULATION, max: 100 },
  peerMinimumContributors: { floor: PEER_MINIMUM_POPULATION, max: 100 },
  peerMinimumObservedInteractions: { floor: PEER_MINIMUM_OBSERVED_INTERACTIONS, max: 500 },
} as const

const integer = z.number().int()
export const diagnosticStrategyConfigSchema = z
  .object({
    schemaVersion: z.literal(DIAGNOSTIC_STRATEGY_SCHEMA_VERSION),
    segmentation: z.object({ enabled: z.boolean(), dimensions: z.array(z.enum(SEGMENT_DIMENSIONS)).max(SEGMENT_DIMENSIONS.length), minimumSegmentInteractions: integer }).strict(),
    interactionInvestigation: z.object({
      enabled: z.boolean(),
      maxInteractions: integer,
      minimumAnalyzed: integer,
      minimumCoveragePercent: integer.nullable(),
      /** V1.0.1 — limite de reparos da cobertura por diagnóstico. Ausente (versões anteriores) = até o tamanho da amostra. */
      maxRepairInteractions: integer.optional(),
    }).strict(),
    /** V2 — `population` (ausente = SEGMENT_INTERACTIONS, o comportamento de sempre): QUAIS atendimentos têm o processo avaliado. */
    processAssessment: z.object({ enabled: z.boolean(), population: z.enum(PROCESS_POPULATIONS).optional() }).strict(),
    /** Universo de domínios cujos especialistas podem investigar; vazio = qualquer Agent (sem restrição). */
    allowedBusinessDomainIds: z.array(z.string().uuid()).max(50),
    peerComparison: z.object({ enabled: z.boolean(), minimumPopulation: integer, minimumContributors: integer, minimumObservedInteractions: integer }).strict(),
    noDiagnosisBehavior: z.enum(NO_DIAGNOSIS_BEHAVIORS),
    /** INDICATOR DIAGNOSIS V1 — triagem do FECHAMENTO oficial do PRV (quais fechamentos abrem investigação). Opcional:
     * versões anteriores não a têm (= sem triagem, o indicador não é investigado a partir do fechamento). */
    closingTriage: closingTriageSchema.optional(),
    /**
     * INDICATOR DIAGNOSIS V2 — SINAL DA POPULAÇÃO: o marcador canônico, JÁ CALCULADO pela fonte, que identifica nas interações do
     * colaborador o evento que o indicador conta (ex.: a flag booleana `rechamada`). A INIA nunca deriva o sinal de áudio/texto
     * nem define janela/regra: só lê a flag. Ausente = o indicador só se decompõe pela unidade (duração/volume).
     */
    populationSignal: z.object({
      kind: z.literal("INTERACTION_FLAG"),
      flagName: z.string().trim().min(1).max(64),
      /** Só para flag numérica: QUAIS valores marcam a chamada. */
      condition: z.object({ operator: z.enum(SIGNAL_OPERATORS), value: z.number().finite() }).strict().optional(),
      effect: z.enum(SIGNAL_EFFECTS).optional(),
    }).strict().optional(),
    /**
     * INDICATOR DIAGNOSIS V2 — INVESTIGAÇÃO ORIENTADA PELA ESTRATÉGIA. FIXED (ou ausente) = os passos saem das chaves acima, sem
     * nenhuma chamada nova ao modelo (o comportamento homologado do TMA). AGENT_SELECTED = a IA LÊ o objetivo e as instruções e
     * escolhe, entre os passos PERMITIDOS e DISPONÍVEIS, o que investigar; o sistema valida a escolha (nunca aceita passo fora da
     * lista, nunca recebe id de pessoa/equipe) e calcula todos os números. `prohibitedClaims` = frases que nenhum texto gerado
     * pode conter (aplicadas por código, não só pedidas).
     */
    investigation: z.object({
      mode: z.enum(INVESTIGATION_MODES),
      objective: z.string().trim().max(600),
      instructions: z.string().trim().max(2000),
      allowedSteps: z.array(z.enum(INVESTIGATION_STEPS)).max(INVESTIGATION_STEPS.length),
      prohibitedClaims: z.array(z.string().trim().min(3).max(160)).max(20),
    }).strict().optional(),
  })
  .strict()
export type DiagnosticStrategyConfig = z.infer<typeof diagnosticStrategyConfigSchema>

/** Ponto de partida de um RASCUNHO novo: tudo desligado, pisos do produto (nunca uma estratégia "pronta" por indicador). */
export function emptyStrategyConfig(): DiagnosticStrategyConfig {
  return {
    schemaVersion: DIAGNOSTIC_STRATEGY_SCHEMA_VERSION,
    segmentation: { enabled: false, dimensions: [], minimumSegmentInteractions: STRATEGY_LIMITS.minimumSegmentInteractions.floor },
    interactionInvestigation: { enabled: false, maxInteractions: STRATEGY_LIMITS.maxInteractions.productDefault, minimumAnalyzed: STRATEGY_LIMITS.minimumAnalyzed.floor, minimumCoveragePercent: null },
    processAssessment: { enabled: false },
    allowedBusinessDomainIds: [],
    peerComparison: { enabled: false, minimumPopulation: STRATEGY_LIMITS.peerMinimumPopulation.floor, minimumContributors: STRATEGY_LIMITS.peerMinimumContributors.floor, minimumObservedInteractions: STRATEGY_LIMITS.peerMinimumObservedInteractions.floor },
    noDiagnosisBehavior: "FACTUAL_ONLY",
  }
}

// ---------------------------------------------------------------------------------------------
// CATÁLOGO DE CAPACIDADES (o que a tela pode oferecer)
// ---------------------------------------------------------------------------------------------

export type StrategyCapabilityCatalog = {
  schemaVersion: number
  /** O indicador tem métrica por atendimento para localizar onde o resultado se concentra? (por UNIDADE, nunca por código) */
  indicator: { decomposable: boolean; metric: DiagnosisMetric | null }
  dimensions: { code: SegmentDimension; label: string; description: string }[]
  mandatorySources: { code: string; label: string }[]
  configurableSources: { code: "INTERACTIONS" | "PROCESS_ASSESSMENT" | "KNOWLEDGE" | "PEER_COMPARISON"; label: string; description: string; requires: string[]; lockedOnWith: string | null }[]
  sampling: { selection: "DETERMINISTIC"; limits: typeof STRATEGY_LIMITS }
  peerRules: string[]
  noDiagnosisBehaviors: { code: NoDiagnosisBehavior; label: string; description: string }[]
  guardrails: string[]
  /** V2 — passos que uma investigação orientada pela IA pode escolher (a disponibilidade real é decidida em runtime). */
  investigationSteps: { code: InvestigationStep; label: string; description: string }[]
  investigationModes: InvestigationMode[]
  processPopulations: { code: ProcessPopulation; label: string; description: string }[]
}

export const DIMENSION_LABELS: Record<SegmentDimension, { label: string; description: string }> = {
  SUBJECT: { label: "Motivo / assunto do atendimento", description: "Agrupa os atendimentos do período pelo motivo (assunto canônico ou, sem ele, o assunto registrado na origem)." },
}
export const NO_DIAGNOSIS_LABELS: Record<NoDiagnosisBehavior, { label: string; description: string }> = {
  FACTUAL_ONLY: { label: "Gerar somente feedback factual", description: "O colaborador recebe o resultado oficial e a informação de que não houve evidência para uma orientação específica." },
  HOLD_FOR_QA: { label: "Encaminhar para QA", description: "O feedback factual fica retido no QA de feedback antes de seguir no Workflow." },
  NO_FEEDBACK: { label: "Não gerar feedback", description: "Sem diagnóstico acionável, nada é enviado ao colaborador (o registro fica na auditoria)." },
}

/** V2 — com sinal de população declarado, um indicador de taxa (ex.: percentual) passa a ter métrica por atendimento. */
export function strategyCapabilities(indicator: { unit: string }, options: { populationSignal?: { flagName: string } | null } = {}): StrategyCapabilityCatalog {
  const metric = diagnosisMetricOf(indicator.unit, options.populationSignal ?? null)
  return {
    schemaVersion: DIAGNOSTIC_STRATEGY_SCHEMA_VERSION,
    indicator: { decomposable: metric !== null, metric },
    dimensions: metric ? SEGMENT_DIMENSIONS.map((code) => ({ code, ...DIMENSION_LABELS[code] })) : [],
    mandatorySources: [
      { code: "OFFICIAL_RESULT", label: "Resultado oficial do indicador (valor, meta, período)" },
      { code: "CANONICAL_CONTEXT", label: "Comparação oficial com a meta, calculada pelo sistema" },
    ],
    configurableSources: metric
      ? [
          { code: "INTERACTIONS", label: "Investigar atendimentos do motivo", description: "Seleciona de forma reproduzível atendimentos do motivo investigado, no período da medição.", requires: ["SEGMENTATION"], lockedOnWith: null },
          { code: "PROCESS_ASSESSMENT", label: "Avaliar processos nos atendimentos", description: "A INIA compara etapas observáveis do atendimento com processos aplicáveis da Base de Conhecimento.", requires: ["INTERACTIONS"], lockedOnWith: null },
          { code: "KNOWLEDGE", label: "Consultar Base de Conhecimento", description: "Usada sempre que processos são avaliados: toda etapa e toda orientação precisam de um trecho literal da versão publicada.", requires: ["PROCESS_ASSESSMENT"], lockedOnWith: "PROCESS_ASSESSMENT" },
          { code: "PEER_COMPARISON", label: "Comparação agregada com grupo de referência", description: "Frequência da mesma etapa no grupo de melhor resultado, só como agregado.", requires: ["PROCESS_ASSESSMENT"], lockedOnWith: null },
        ]
      : [],
    sampling: { selection: "DETERMINISTIC", limits: STRATEGY_LIMITS },
    peerRules: [
      "Mesmo indicador e mesmo período",
      "Mesmo Grupo do colaborador",
      "Quartil de melhor resultado oficial",
      "Mesma etapa verificada da base e mesmo motivo",
      `Pelo menos ${PEER_MINIMUM_POPULATION} pessoas no grupo e ${PEER_MINIMUM_POPULATION} contribuindo, e ${PEER_MINIMUM_OBSERVED_INTERACTIONS} atendimentos`,
      "Só agregado: nunca nome, resultado individual ou fala de colega",
    ],
    noDiagnosisBehaviors: NO_DIAGNOSIS_BEHAVIORS.map((code) => ({ code, ...NO_DIAGNOSIS_LABELS[code] })),
    guardrails: [
      "Os números vêm sempre do sistema (resultado, meta, contagens)",
      "Toda fala e toda regra citadas são conferidas literalmente",
      "Indicador + comportamento observado nunca é tratado como causa",
      "Sem regra oficial verificada, o feedback não traz 'o que fazer'",
      "Pontos fortes só quando a investigação os sustenta",
      "Privacidade e populações mínimas não podem ser reduzidas",
      "Comparação com grupo sempre resolvida pelo sistema (grupo do colaborador no período, só agregado) — nunca escolhida pela IA",
      "Sinal de população é lido da fonte (flag já calculada) — a INIA nunca define janela nem vincula atendimentos por semelhança",
    ],
    investigationSteps: INVESTIGATION_STEPS.map((code) => ({ code, label: INVESTIGATION_STEP_CATALOG[code].label, description: INVESTIGATION_STEP_CATALOG[code].description })),
    investigationModes: [...INVESTIGATION_MODES],
    processPopulations: [
      { code: "SEGMENT_INTERACTIONS", label: "Atendimentos do motivo investigado", description: "Chamadas do próprio colaborador no motivo escolhido pelo sistema (o comportamento de sempre)." },
      { code: "LINKED_PREVIOUS_OF_SIGNAL", label: "Atendimentos anteriores vinculados ao sinal", description: "O atendimento que precedeu cada interação sinalizada — só com vínculo explícito entre interações na fonte de dados." },
    ],
  }
}

// ---------------------------------------------------------------------------------------------
// VALIDAÇÃO PARA PUBLICAR (combinação impossível falha aqui, nunca em runtime)
// ---------------------------------------------------------------------------------------------

export type StrategyIssue = { code: string; field: string; message: string }

export function validateStrategyForPublish(config: DiagnosticStrategyConfig, context: { indicatorUnit: string; domains: readonly { id: string; active: boolean; exists: boolean }[]; /** V2 — flags do catálogo de canal da organização (sinal de população). */ flags?: readonly { name: string; valueType: string; active: boolean }[] }): StrategyIssue[] {
  const issues: StrategyIssue[] = []
  const issue = (code: string, field: string, message: string) => issues.push({ code, field, message })
  const capabilities = strategyCapabilities({ unit: context.indicatorUnit }, { populationSignal: config.populationSignal ?? null })
  const { segmentation, interactionInvestigation: interactions, processAssessment, peerComparison: peer } = config
  const limits = STRATEGY_LIMITS

  if (segmentation.enabled) {
    if (!capabilities.indicator.decomposable) issue("STRATEGY_CAPABILITY_UNAVAILABLE", "segmentation", "Este indicador ainda não possui uma dimensão operacional disponível para diagnóstico aprofundado.")
    if (segmentation.dimensions.length === 0) issue("STRATEGY_DIMENSION_REQUIRED", "segmentation.dimensions", "Escolha ao menos uma dimensão de análise.")
    for (const dimension of segmentation.dimensions) if (!capabilities.dimensions.some((entry) => entry.code === dimension)) issue("STRATEGY_CAPABILITY_UNAVAILABLE", "segmentation.dimensions", "Dimensão de análise não disponível para este indicador.")
  }
  if (segmentation.minimumSegmentInteractions < limits.minimumSegmentInteractions.floor || segmentation.minimumSegmentInteractions > limits.minimumSegmentInteractions.max) issue("STRATEGY_LIMIT_OUT_OF_RANGE", "segmentation.minimumSegmentInteractions", `O mínimo de atendimentos por motivo deve ficar entre ${limits.minimumSegmentInteractions.floor} e ${limits.minimumSegmentInteractions.max}.`)

  if (interactions.enabled && !segmentation.enabled) issue("STRATEGY_REQUIRES_SEGMENTATION", "interactionInvestigation", "Investigar atendimentos exige segmentar o resultado: a amostra é escolhida dentro do motivo investigado.")
  if (interactions.enabled && !processAssessment.enabled) issue("STRATEGY_INTERACTIONS_WITHOUT_ANALYSIS", "interactionInvestigation", "Nesta versão, os atendimentos investigados são avaliados pelos processos da base — ative \"Avaliar processos nos atendimentos\".")
  if (processAssessment.enabled && !interactions.enabled) issue("STRATEGY_PROCESS_WITHOUT_INTERACTIONS", "processAssessment", "Avaliar processos exige investigar atendimentos.")
  if (interactions.maxInteractions < limits.maxInteractions.min || interactions.maxInteractions > limits.maxInteractions.max) issue("STRATEGY_LIMIT_OUT_OF_RANGE", "interactionInvestigation.maxInteractions", `O máximo de atendimentos analisados deve ficar entre ${limits.maxInteractions.min} e ${limits.maxInteractions.max}.`)
  if (interactions.minimumAnalyzed < limits.minimumAnalyzed.floor) issue("STRATEGY_BELOW_PRODUCT_MINIMUM", "interactionInvestigation.minimumAnalyzed", `A amostra mínima não pode ser menor que ${limits.minimumAnalyzed.floor} atendimentos.`)
  if (interactions.minimumAnalyzed > interactions.maxInteractions) issue("STRATEGY_LIMIT_OUT_OF_RANGE", "interactionInvestigation.minimumAnalyzed", "A amostra mínima não pode ser maior que o máximo de atendimentos analisados.")
  if (interactions.maxRepairInteractions !== undefined && (interactions.maxRepairInteractions < limits.maxRepairInteractions.min || interactions.maxRepairInteractions > limits.maxRepairInteractions.max)) issue("STRATEGY_LIMIT_OUT_OF_RANGE", "interactionInvestigation.maxRepairInteractions", `O limite de reparos deve ficar entre ${limits.maxRepairInteractions.min} e ${limits.maxRepairInteractions.max} chamadas.`)
  if (interactions.minimumCoveragePercent !== null && (interactions.minimumCoveragePercent < limits.minimumCoveragePercent.min || interactions.minimumCoveragePercent > limits.minimumCoveragePercent.max)) issue("STRATEGY_LIMIT_OUT_OF_RANGE", "interactionInvestigation.minimumCoveragePercent", "A cobertura mínima deve ficar entre 1% e 100%.")

  if (peer.enabled && !processAssessment.enabled) issue("STRATEGY_PEER_WITHOUT_PROCESS", "peerComparison", "A comparação com o grupo de referência compara etapas verificadas da base — ative \"Avaliar processos nos atendimentos\".")
  if (peer.minimumPopulation < limits.peerMinimumPopulation.floor || peer.minimumPopulation > limits.peerMinimumPopulation.max) issue("STRATEGY_BELOW_PRODUCT_MINIMUM", "peerComparison.minimumPopulation", `O grupo de referência precisa de pelo menos ${limits.peerMinimumPopulation.floor} pessoas.`)
  if (peer.minimumContributors < limits.peerMinimumContributors.floor || peer.minimumContributors > limits.peerMinimumContributors.max) issue("STRATEGY_BELOW_PRODUCT_MINIMUM", "peerComparison.minimumContributors", `A comparação precisa de pelo menos ${limits.peerMinimumContributors.floor} pessoas contribuindo.`)
  if (peer.minimumObservedInteractions < limits.peerMinimumObservedInteractions.floor || peer.minimumObservedInteractions > limits.peerMinimumObservedInteractions.max) issue("STRATEGY_BELOW_PRODUCT_MINIMUM", "peerComparison.minimumObservedInteractions", `A comparação precisa de pelo menos ${limits.peerMinimumObservedInteractions.floor} atendimentos observados.`)

  issues.push(...closingTriageIssues(config.closingTriage))

  // V2 — sinal de população: uma flag ATIVA do catálogo (já calculada pela fonte). Sim/não marca a chamada sozinha; numérica exige a
  // condição declarada (`POPULATION_SIGNAL_V2`) — nunca um limiar inventado pelo sistema.
  if (config.populationSignal) {
    const signal = config.populationSignal
    const flag = context.flags?.find((entry) => entry.name === signal.flagName)
    if (!flag) issue("STRATEGY_SIGNAL_FLAG_NOT_FOUND", "populationSignal.flagName", "A flag escolhida como sinal da população não existe no catálogo de flags.")
    else if (!flag.active) issue("STRATEGY_SIGNAL_FLAG_INACTIVE", "populationSignal.flagName", "A flag escolhida como sinal da população está desativada.")
    else if (flag.valueType === "BOOLEAN" && signal.condition) issue("STRATEGY_SIGNAL_CONDITION_NOT_ALLOWED", "populationSignal.condition", "Uma flag de sim/não já marca a chamada: ela não usa condição de valor.")
    else if (flag.valueType === "NUMERIC" && !signal.condition) issue("STRATEGY_SIGNAL_CONDITION_REQUIRED", "populationSignal.condition", `Defina quais valores de "${signal.flagName}" marcam a chamada (ex.: menor ou igual a 2).`)
    else if (flag.valueType !== "BOOLEAN" && flag.valueType !== "NUMERIC") issue("STRATEGY_SIGNAL_FLAG_UNSUPPORTED", "populationSignal.flagName", "O sinal da população precisa ser uma flag de sim/não ou numérica.")
    if (!signal.effect) issue("STRATEGY_SIGNAL_EFFECT_REQUIRED", "populationSignal.effect", "Diga o que a chamada com o sinal representa para o indicador: resultado ruim ou resultado bom.")
  }
  if (config.processAssessment.population === "LINKED_PREVIOUS_OF_SIGNAL" && !config.populationSignal) issue("STRATEGY_LINKED_POPULATION_WITHOUT_SIGNAL", "processAssessment.population", "Avaliar os atendimentos anteriores vinculados exige um sinal de população.")
  const investigation = config.investigation
  if (investigation?.mode === "AGENT_SELECTED") {
    if (!investigation.objective.trim()) issue("STRATEGY_INVESTIGATION_OBJECTIVE_REQUIRED", "investigation.objective", "Descreva o objetivo da investigação.")
    if (!investigation.instructions.trim()) issue("STRATEGY_INVESTIGATION_INSTRUCTIONS_REQUIRED", "investigation.instructions", "Escreva as instruções de investigação que a IA vai ler.")
    if (investigation.allowedSteps.length === 0) issue("STRATEGY_INVESTIGATION_STEPS_REQUIRED", "investigation.allowedSteps", "Permita ao menos um passo de investigação.")
    if (new Set(investigation.allowedSteps).size !== investigation.allowedSteps.length) issue("STRATEGY_INVESTIGATION_STEP_DUPLICATED", "investigation.allowedSteps", "Passo de investigação repetido.")
    for (const step of investigation.allowedSteps) {
      const requirement = INVESTIGATION_STEP_CATALOG[step].requires
      if (requirement === "SIGNAL" && !config.populationSignal) issue("STRATEGY_STEP_REQUIRES_SIGNAL", "investigation.allowedSteps", `O passo "${INVESTIGATION_STEP_CATALOG[step].label}" exige um sinal de população.`)
      if (requirement === "SEGMENTATION" && !segmentation.enabled) issue("STRATEGY_STEP_REQUIRES_SEGMENTATION", "investigation.allowedSteps", `O passo "${INVESTIGATION_STEP_CATALOG[step].label}" exige a segmentação por motivo.`)
      if (requirement === "PROCESS" && !processAssessment.enabled) issue("STRATEGY_STEP_REQUIRES_PROCESS", "investigation.allowedSteps", `O passo "${INVESTIGATION_STEP_CATALOG[step].label}" exige "Avaliar processos nos atendimentos".`)
    }
  }

  const seen = new Set<string>()
  for (const id of config.allowedBusinessDomainIds) {
    if (seen.has(id)) issue("STRATEGY_DOMAIN_DUPLICATED", "allowedBusinessDomainIds", "Domínio repetido.")
    seen.add(id)
    const domain = context.domains.find((entry) => entry.id === id)
    if (!domain || !domain.exists) issue("BUSINESS_DOMAIN_NOT_FOUND", "allowedBusinessDomainIds", "Um dos domínios selecionados não existe mais.")
    else if (!domain.active) issue("BUSINESS_DOMAIN_INACTIVE", "allowedBusinessDomainIds", "Um dos domínios selecionados está desativado.")
  }
  return issues
}

// ---------------------------------------------------------------------------------------------
// RUNTIME: estratégia → parâmetros do plano/diagnóstico (a única tradução)
// ---------------------------------------------------------------------------------------------

export type DiagnosisRuntimeParameters = {
  strategyVersionId: string | null
  strategyVersion: number | null
  /** false = sem estratégia publicada/ativa: o diagnóstico não roda (feedback factual). */
  configured: boolean
  segmentation: { enabled: boolean; dimensions: SegmentDimension[]; minimumSegmentInteractions: number }
  sample: { enabled: boolean; maxInteractions: number; minimumAnalyzed: number; minimumCoveragePercent: number | null; /** V1.0.1 — reparos da cobertura permitidos neste diagnóstico (≤ amostra). */ maxRepairInteractions: number }
  processAssessment: boolean
  allowedBusinessDomainIds: string[]
  peer: { enabled: boolean; minimumPopulation: number; minimumContributors: number; minimumObservedInteractions: number }
  noDiagnosisBehavior: NoDiagnosisBehavior
  /** INDICATOR DIAGNOSIS V1 — regra de triagem do fechamento (null = não configurada). */
  closingTriage: ClosingTriageRule | null
  /** V2 — sinal da população (flag já calculada pela fonte) e QUAIS atendimentos têm o processo avaliado. */
  populationSignal: PopulationSignal | null
  processPopulation: ProcessPopulation
  /** V2 — FIXED = passos das chaves (sem IA nova); AGENT_SELECTED = a IA escolhe entre os permitidos. */
  investigation: { mode: InvestigationMode; objective: string; instructions: string; allowedSteps: InvestigationStep[]; prohibitedClaims: string[]; /** true = o bloco `investigation` existe na versão (modo escolhido pelo admin); false = estratégia anterior a ele. */ declared?: boolean }
}

/** Tradução ÚNICA (usada pelo plano, pelo nó "Chamar agente", por "Gerar feedback" e pela simulação). Pisos reaplicados. */
export function runtimeParametersOf(strategy: { id: string; version: number; config: DiagnosticStrategyConfig } | null): DiagnosisRuntimeParameters {
  const config = strategy?.config ?? emptyStrategyConfig()
  const limits = STRATEGY_LIMITS
  const maxInteractions = Math.min(Math.max(config.interactionInvestigation.maxInteractions, limits.maxInteractions.min), limits.maxInteractions.max)
  return {
    strategyVersionId: strategy?.id ?? null,
    strategyVersion: strategy?.version ?? null,
    configured: strategy !== null,
    segmentation: { enabled: config.segmentation.enabled, dimensions: [...config.segmentation.dimensions], minimumSegmentInteractions: Math.max(config.segmentation.minimumSegmentInteractions, limits.minimumSegmentInteractions.floor) },
    sample: { enabled: config.interactionInvestigation.enabled, maxInteractions, minimumAnalyzed: Math.min(Math.max(config.interactionInvestigation.minimumAnalyzed, limits.minimumAnalyzed.floor), maxInteractions), minimumCoveragePercent: config.interactionInvestigation.minimumCoveragePercent, maxRepairInteractions: Math.min(Math.max(config.interactionInvestigation.maxRepairInteractions ?? maxInteractions, limits.maxRepairInteractions.min), maxInteractions) },
    processAssessment: config.processAssessment.enabled,
    allowedBusinessDomainIds: [...config.allowedBusinessDomainIds],
    peer: {
      enabled: config.peerComparison.enabled,
      minimumPopulation: Math.max(config.peerComparison.minimumPopulation, limits.peerMinimumPopulation.floor),
      minimumContributors: Math.max(config.peerComparison.minimumContributors, limits.peerMinimumContributors.floor),
      minimumObservedInteractions: Math.max(config.peerComparison.minimumObservedInteractions, limits.peerMinimumObservedInteractions.floor),
    },
    noDiagnosisBehavior: config.noDiagnosisBehavior,
    closingTriage: config.closingTriage ?? null,
    populationSignal: config.populationSignal ? { flagName: config.populationSignal.flagName, condition: config.populationSignal.condition ?? null, effect: config.populationSignal.effect ?? null } : null,
    processPopulation: config.processAssessment.population ?? "SEGMENT_INTERACTIONS",
    investigation: config.investigation
      ? { mode: config.investigation.mode, objective: config.investigation.objective, instructions: config.investigation.instructions, allowedSteps: [...config.investigation.allowedSteps], prohibitedClaims: [...config.investigation.prohibitedClaims], declared: true }
      : { mode: "FIXED", objective: "", instructions: "", allowedSteps: [], prohibitedClaims: [], declared: false },
  }
}
