import { z } from "zod"

/**
 * Catálogo de COMPORTAMENTOS de indicador (espelho do domínio do backend —
 * `indicators/domain/indicator-definition.ts`). O frontend conhece unidades e estratégias;
 * nunca códigos de indicador. Labels/ajuda das estratégias e unidades vêm do backend
 * (`GET /admin/indicator-rules/catalog`); aqui ficam só o contrato de tipos e a formatação por
 * unidade, que precisa existir em tempo de build.
 */
export const indicatorUnitSchema = z.enum(["PERCENT", "SECONDS", "POINTS", "STARS", "COUNT", "CASES", "CASES_PER_DAY"])
export type IndicatorUnit = z.infer<typeof indicatorUnitSchema>

export const operationalAggregationKindSchema = z.enum(["WEIGHTED_AVERAGE", "RATE", "AVERAGE", "SUM", "LATEST"])
export type OperationalAggregationKind = z.infer<typeof operationalAggregationKindSchema>

export const measurementComponentSchema = z.enum(["value", "numerator", "denominator", "sampleCount"])
export type MeasurementComponent = z.infer<typeof measurementComponentSchema>

export const MEASUREMENT_COMPONENT_LABELS: Record<MeasurementComponent, string> = {
  value: "valor",
  numerator: "numerador",
  denominator: "denominador",
  sampleCount: "amostra",
}

export const indicatorCatalogSchema = z.object({
  units: z.array(z.object({ value: indicatorUnitSchema, label: z.string(), suffix: z.string(), decimals: z.number(), score: z.boolean() })),
  directions: z.array(z.enum(["HIGHER", "LOWER", "TARGET"])),
  granularities: z.array(z.enum(["DAILY"])),
  strategies: z.array(
    z.object({
      value: operationalAggregationKindSchema,
      label: z.string(),
      help: z.string(),
      requiredComponents: z.array(measurementComponentSchema),
      optionalComponents: z.array(measurementComponentSchema),
      allowedUnits: z.array(indicatorUnitSchema).nullable(),
    }),
  ),
})
export type IndicatorCatalog = z.infer<typeof indicatorCatalogSchema>
export type IndicatorStrategy = IndicatorCatalog["strategies"][number]

export const indicatorDependenciesSchema = z.object({
  measurements: z.number(),
  goals: z.number(),
  officialClosures: z.number(),
  workflows: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Workflows de Grupos que quem consulta não administra — só a contagem (o nome não vem do backend). */
  workflowsOutOfScope: z.number().catch(0),
  hasHistory: z.boolean(),
})
export type IndicatorDependencies = z.infer<typeof indicatorDependenciesSchema>

/** Motivo digitado na correção controlada: mesmo mínimo do backend (`indicators/domain/indicator-correction.ts`). */
export const INDICATOR_CORRECTION_REASON_MIN_LENGTH = 10

const correctionWorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  inFlightEnrollments: z.number(),
  uses: z.array(z.object({ nodeLabel: z.string(), problem: z.enum(["AGGREGATION", "DIRECTION"]), aggregationLabel: z.string().nullable(), message: z.string() })),
})

const correctableValuesSchema = z.object({ unit: indicatorUnitSchema, desiredDirection: z.enum(["HIGHER", "LOWER", "TARGET"]), operationalAggregation: operationalAggregationKindSchema })

const calculationTextSchema = z.object({ label: z.string(), description: z.string() })

/** Impacto da correção de unidade, direção ou estratégia. Calculado sempre no servidor: a tela só mostra. */
export const indicatorCorrectionImpactSchema = z.object({
  indicator: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  current: correctableValuesSchema,
  next: correctableValuesSchema,
  changes: z.array(z.object({ field: z.string(), label: z.string(), from: z.string(), to: z.string() })),
  calculation: z.object({ before: calculationTextSchema, after: calculationTextSchema }),
  history: z.object({ measurements: z.number(), goals: z.number(), officialClosures: z.number(), workflows: z.number() }),
  measurements: z.object({
    requiredComponents: z.array(measurementComponentSchema),
    missingComponents: z.number(),
    incoherentValues: z.number(),
    outOfUnitRange: z.number(),
    unusedComponents: z.number(),
    examples: z.array(
      z.object({
        issue: z.enum(["MISSING_COMPONENTS", "INCOHERENT_VALUE", "OUT_OF_UNIT_RANGE"]),
        employeeLabel: z.string(),
        date: z.string(),
        value: z.number(),
        numerator: z.number().nullable(),
        denominator: z.number().nullable(),
        expected: z.number().nullable(),
      }),
    ),
  }),
  allowedAggregations: z.array(z.string()),
  workflows: z.object({
    activePublished: z.array(correctionWorkflowSchema),
    pausedPublished: z.array(correctionWorkflowSchema),
    drafts: z.array(correctionWorkflowSchema),
    outOfScope: z.object({ activePublished: z.number(), pausedPublished: z.number(), drafts: z.number() }),
  }),
  zeroContributionReset: z.boolean(),
  blockers: z.array(z.object({ code: z.string(), message: z.string() })),
  notices: z.array(z.string()),
  canApply: z.boolean(),
})
export type IndicatorCorrectionImpact = z.infer<typeof indicatorCorrectionImpactSchema>
export type IndicatorCorrectionWorkflow = z.infer<typeof correctionWorkflowSchema>
export type IndicatorCorrectionFields = Partial<z.infer<typeof correctableValuesSchema>>

export const OPERATIONAL_GRANULARITY_LABELS: Record<"DAILY", string> = { DAILY: "Diária (por colaborador)" }

/** Padrão de código do catálogo (mesmo regex do backend). */
export const INDICATOR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/

export function normalizeIndicatorCode(code: string): string {
  return code.trim().toUpperCase()
}

/** Resumo curto da capacidade pra lista/cards — nunca 15 colunas. */
export function describeIndicatorCapability(indicator: { dailySupported: boolean; officialClosureSupported: boolean }): { label: string; tone: "operational" | "official" | "none" } {
  if (indicator.dailySupported) return { label: "Medição diária", tone: "operational" }
  if (indicator.officialClosureSupported) return { label: "Só fechamento oficial", tone: "official" }
  return { label: "Sem medição", tone: "none" }
}
