import { z } from "zod"

import { investigationSchema } from "@/schemas/diagnostics/diagnostics-memory.schema"

/**
 * V1.6.2 — Estratégia de diagnóstico do indicador (espelho do contrato do backend: indicator-diagnosis/domain/diagnostic-strategy.ts).
 * A tela nunca inventa capacidade: dimensões, fontes configuráveis, limites e comportamentos vêm do CATÁLOGO que o backend
 * devolve para o indicador. Configuração tipada — nenhum prompt, nenhum texto livre.
 */
export const strategyConfigSchema = z.object({
  schemaVersion: z.literal(1),
  segmentation: z.object({ enabled: z.boolean(), dimensions: z.array(z.string()), minimumSegmentInteractions: z.number().int() }),
  /** V1.0.1 — `maxRepairInteractions`: limite de revisões da avaliação por diagnóstico (ausente em versões anteriores = até a amostra). */
  interactionInvestigation: z.object({ enabled: z.boolean(), maxInteractions: z.number().int(), minimumAnalyzed: z.number().int(), minimumCoveragePercent: z.number().int().nullable(), maxRepairInteractions: z.number().int().optional() }),
  /** V2 — `population`: QUAIS atendimentos têm o processo avaliado (ausente = os do motivo investigado). */
  processAssessment: z.object({ enabled: z.boolean(), population: z.enum(["SEGMENT_INTERACTIONS", "LINKED_PREVIOUS_OF_SIGNAL"]).optional() }),
  allowedBusinessDomainIds: z.array(z.string()),
  peerComparison: z.object({ enabled: z.boolean(), minimumPopulation: z.number().int(), minimumContributors: z.number().int(), minimumObservedInteractions: z.number().int() }),
  noDiagnosisBehavior: z.enum(["FACTUAL_ONLY", "HOLD_FOR_QA", "NO_FEEDBACK"]),
  /** Indicator Diagnosis V1 — quais FECHAMENTOS oficiais do PRV abrem investigação (Q1 = melhor, Q4 = pior). Ausente = não configurada. */
  closingTriage: z.object({ enabled: z.boolean(), developmentQuartiles: z.array(z.enum(["Q1", "Q2", "Q3", "Q4"])), belowTarget: z.boolean(), quartileWorsened: z.boolean(), recognitionQuartiles: z.array(z.enum(["Q1", "Q2", "Q3", "Q4"])) }).optional(),
  /**
   * Sinal da população (flag já calculada pela fonte). `POPULATION_SIGNAL_V2`: flag numérica usa `condition` (quais valores marcam a
   * chamada); `effect` declara o que a chamada sinalizada representa para o indicador (ausente só em versões anteriores).
   */
  populationSignal: z.object({
    kind: z.literal("INTERACTION_FLAG"),
    flagName: z.string(),
    condition: z.object({ operator: z.enum(["LTE", "LT", "GTE", "GT", "EQ"]), value: z.number() }).optional(),
    effect: z.enum(["ADVERSE", "FAVORABLE"]).optional(),
  }).optional(),
  /** Indicator Diagnosis V2 — investigação orientada pela IA (objetivo, instruções, passos permitidos, frases proibidas). Somente leitura aqui. */
  investigation: z.object({ mode: z.enum(["FIXED", "AGENT_SELECTED"]), objective: z.string(), instructions: z.string(), allowedSteps: z.array(z.string()), prohibitedClaims: z.array(z.string()) }).optional(),
})
export type StrategyConfig = z.infer<typeof strategyConfigSchema>
export type PopulationSignalConfig = NonNullable<StrategyConfig["populationSignal"]>
export type SignalOperator = NonNullable<PopulationSignalConfig["condition"]>["operator"]
export const SIGNAL_OPERATOR_LABELS: Record<SignalOperator, string> = { LTE: "menor ou igual a", LT: "menor que", GTE: "maior ou igual a", GT: "maior que", EQ: "igual a" }
export const SIGNAL_OPERATOR_SYMBOLS: Record<SignalOperator, string> = { LTE: "≤", LT: "<", GTE: "≥", GT: ">", EQ: "=" }
export const SIGNAL_EFFECT_LABELS: Record<NonNullable<PopulationSignalConfig["effect"]>, { label: string; description: string }> = {
  ADVERSE: { label: "Resultado ruim", description: "Quanto mais chamadas com o sinal, pior para o indicador (ex.: nota baixa, rechamada)." },
  FAVORABLE: { label: "Resultado bom", description: "Quanto mais chamadas com o sinal, melhor para o indicador." },
}
/** Como o sinal aparece para quem lê ("nota_ura ≤ 2", "rechamada") — o mesmo texto do backend. */
export function signalLabelOf(signal: { flagName: string; condition?: { operator: SignalOperator; value: number } }): string {
  if (!signal.condition) return signal.flagName
  return `${signal.flagName} ${SIGNAL_OPERATOR_SYMBOLS[signal.condition.operator]} ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(signal.condition.value)}`
}

const versionSchema = z.object({ id: z.string(), version: z.number(), status: z.enum(["DRAFT", "PUBLISHED", "SUPERSEDED"]), config: strategyConfigSchema, createdAt: z.string(), createdByName: z.string().nullable(), publishedAt: z.string().nullable(), publishedByName: z.string().nullable() })
const limitSchema = z.record(z.string(), z.record(z.string(), z.number()))

export const strategyStatusSchema = z.enum(["NOT_CONFIGURED", "DRAFT", "PUBLISHED", "INACTIVE"])
export type StrategyStatus = z.infer<typeof strategyStatusSchema>
export const STRATEGY_STATUS_LABELS: Record<StrategyStatus, string> = { NOT_CONFIGURED: "Não configurado", DRAFT: "Rascunho", PUBLISHED: "Configurado", INACTIVE: "Inativo" }

export const strategyOverviewSchema = z.object({
  indicator: z.object({ id: z.string(), code: z.string(), name: z.string(), unit: z.string(), active: z.boolean() }),
  status: strategyStatusSchema,
  active: z.boolean(),
  published: versionSchema.nullable(),
  draft: versionSchema.nullable(),
  history: z.array(z.object({ id: z.string(), version: z.number(), status: z.string(), publishedAt: z.string().nullable(), publishedByName: z.string().nullable() })),
  draftIssues: z.array(z.object({ code: z.string(), field: z.string(), message: z.string() })),
  capabilities: z.object({
    indicator: z.object({ decomposable: z.boolean(), metric: z.string().nullable() }),
    dimensions: z.array(z.object({ code: z.string(), label: z.string(), description: z.string() })),
    mandatorySources: z.array(z.object({ code: z.string(), label: z.string() })),
    configurableSources: z.array(z.object({ code: z.enum(["INTERACTIONS", "PROCESS_ASSESSMENT", "KNOWLEDGE", "PEER_COMPARISON"]), label: z.string(), description: z.string(), requires: z.array(z.string()), lockedOnWith: z.string().nullable() })),
    sampling: z.object({ selection: z.literal("DETERMINISTIC"), limits: limitSchema }),
    peerRules: z.array(z.string()),
    noDiagnosisBehaviors: z.array(z.object({ code: z.enum(["FACTUAL_ONLY", "HOLD_FOR_QA", "NO_FEEDBACK"]), label: z.string(), description: z.string() })),
    guardrails: z.array(z.string()),
    investigationSteps: z.array(z.object({ code: z.string(), label: z.string(), description: z.string() })).optional(),
  }),
  domains: z.array(z.object({ id: z.string(), name: z.string(), active: z.boolean() })),
  /** Ponto de partida de um novo rascunho (a vigente ou tudo desligado) — editado localmente, gravado só ao salvar. */
  newDraftTemplate: strategyConfigSchema,
})
export type StrategyIssue = StrategyOverview["draftIssues"][number]
export type StrategyOverview = z.infer<typeof strategyOverviewSchema>

export const simulationOptionsSchema = z.object({
  collaborators: z.array(z.object({ id: z.string(), name: z.string(), measurements: z.array(z.object({ id: z.string(), periodLabel: z.string(), interactions: z.number().int().nonnegative().optional() })) })),
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
})
export type SimulationOptions = z.infer<typeof simulationOptionsSchema>

export const simulationResultSchema = z.object({
  strategy: z.object({ versionId: z.string(), version: z.number(), status: z.enum(["DRAFT", "PUBLISHED"]) }),
  officialResult: z.object({ indicatorName: z.string(), value: z.string(), target: z.string().nullable(), comparison: z.string().nullable(), period: z.string() }),
  /** A investigação do MOTOR de feedback (o mesmo do Workflow) — null quando nem a parte determinística rodou. */
  investigation: investigationSchema.nullable(),
  aiExecuted: z.boolean(),
  aiStoppedReason: z.string().nullable(),
  /** O que o colaborador receberia: mensagem (READY) ou abstenção com motivo (ABSTAINED) — nunca espera de aprovação. */
  feedback: z.object({ disposition: z.enum(["READY", "ABSTAINED"]), text: z.string(), reason: z.string().nullable(), supportMaterials: z.array(z.object({ title: z.string(), reason: z.string() })) }).nullable(),
  usage: z.object({ requests: z.number(), promptTokens: z.number().nullable(), outputTokens: z.number().nullable(), totalTokens: z.number().nullable(), models: z.array(z.string()) }),
  error: z.string().nullable(),
})
export type SimulationResult = z.infer<typeof simulationResultSchema>
