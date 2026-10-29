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
