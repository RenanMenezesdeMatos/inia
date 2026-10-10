import { z } from "zod"

export const calculationPeriodSchema = z.enum(["DAILY", "WEEKLY", "MONTHLY"])
export type CalculationPeriod = z.infer<typeof calculationPeriodSchema>

export const CALCULATION_PERIOD_LABELS: Record<CalculationPeriod, string> = {
  DAILY: "Diário",
  WEEKLY: "Semanal",
  MONTHLY: "Mensal",
}

export const desiredDirectionSchema = z.enum(["HIGHER", "LOWER", "TARGET"])
export type DesiredDirection = z.infer<typeof desiredDirectionSchema>

export const DESIRED_DIRECTION_LABELS: Record<DesiredDirection, string> = {
  HIGHER: "Maior é melhor",
  LOWER: "Menor é melhor",
  TARGET: "Bater uma meta específica",
}

const calculationRuleSchema = z.object({
  id: z.string(),
  scopeType: z.string(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamId: z.string().nullable(),
  subteamName: z.string().nullable(),
  calculationPeriod: calculationPeriodSchema,
  calculationMethod: z.string(),
  attainmentRule: z.string().nullable(),
  active: z.boolean(),
})

export const indicatorWithRulesSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  unit: z.string(),
  desiredDirection: z.string(),
  active: z.boolean(),
  // Camada operacional (migration 052): como as medições diárias se agregam e se o indicador
  // tem medição diária. Opcionais pra tolerar backend anterior à migration.
  operationalAggregation: z.enum(["WEIGHTED_AVERAGE", "RATE", "AVERAGE", "SUM", "LATEST"]).optional().default("AVERAGE"),
  dailySupported: z.boolean().optional().default(false),
  // Metadata do catálogo (migration 055): amostra/cobertura mínimas padrão (pré-preenchem
  // Condition/Ranking no editor), capacidade de fechamento oficial e o texto FUNCIONAL do
  // cálculo derivado de estratégia + unidade pelo backend (nunca por código de indicador).
  minimumSampleSize: z.number().int().positive().nullable().optional().default(null),
  minimumCoverage: z.number().min(0).max(1).nullable().optional().default(null),
  officialClosureSupported: z.boolean().optional().default(true),
  /** Evidência de produção (migration 068): medição diária deste indicador prova que houve trabalho no dia. */
  provesWorkActivity: z.boolean().optional().default(false),
  /** Falta injustificada (migration 069): NO_SAMPLE (sem amostra) × ZERO_CONTRIBUTION (contribuição lógica 0, nunca medição). */
  unjustifiedAbsencePolicy: z.enum(["NO_SAMPLE", "ZERO_CONTRIBUTION"]).optional().default("NO_SAMPLE"),
  /** Override de disponibilidade esperada (D-1/D-2 + horário) — só quando o feed mistura SLAs; null = herda do feed. */
  availabilityPolicy: z.object({ lagDays: z.number().int().min(0).max(14), availableByLocalTime: z.string() }).nullable().optional().default(null),
  /** Ícone no Acompanhamento (migration 115); null = padrão pela unidade. */
  iconKey: z.string().nullable().optional().default(null),
  calculation: z.object({ label: z.string(), description: z.string() }).optional(),
  glossaryDescription: z.string().nullable(),
  interpretation: z.string().nullable(),
  goodPractices: z.string().nullable(),
  feedbackGuidance: z.string().nullable(),
  calculationRules: z.array(calculationRuleSchema),
  /** V1.6.2 — status compacto da estratégia de diagnóstico com IA (opcional: tolera backend anterior). */
  diagnosticStrategyStatus: z.enum(["NOT_CONFIGURED", "DRAFT", "PUBLISHED", "INACTIVE"]).optional(),
  diagnosticStrategyDraftPending: z.boolean().optional(),
})
export type IndicatorWithRules = z.infer<typeof indicatorWithRulesSchema>
