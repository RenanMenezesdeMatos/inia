import { z } from "zod"

/** Q1 = melhor quartil, Q4 = pior — sempre, independente do indicador ser "maior é melhor" ou
 * "menor é melhor". O dado chega assim já normalizado da fonte oficial; a aplicação nunca infere
 * quartil a partir do valor bruto (ver Parte 27 do pedido). */
export const quartileSchema = z.enum(["Q1", "Q2", "Q3", "Q4"])
export type Quartile = z.infer<typeof quartileSchema>
export const QUARTILE_VALUES: Quartile[] = ["Q1", "Q2", "Q3", "Q4"]

/**
 * Uma linha de `employee_indicator_performance` — atingimento%, peso e quartil vêm prontos da
 * fonte/base oficial de indicadores; a aplicação só recebe, persiste e consulta (nunca calcula
 * a fórmula oficial de atingimento). `referencePeriod` é sempre "AAAA-MM" (cadência mensal, a
 * mesma do PRV).
 */
export const employeeIndicatorPerformanceSchema = z.object({
  id: z.string(),
  personId: z.string(),
  indicatorDefinitionId: z.string(),
  indicatorCode: z.string(),
  subteamId: z.string().nullable(),
  referencePeriod: z.string(),
  value: z.coerce.number(),
  targetValue: z.coerce.number().nullable(),
  achievementPercent: z.coerce.number().nullable(),
  weightPercent: z.coerce.number().nullable(),
  quartile: quartileSchema.nullable(),
  source: z.string(),
})
export type EmployeeIndicatorPerformance = z.infer<typeof employeeIndicatorPerformanceSchema>

/** Uma linha de `employee_prv_performance` — Programa de Remuneração Variável consolidado,
 * também sempre recebido pronto (nunca calculado). */
export const employeePrvPerformanceSchema = z.object({
  id: z.string(),
  personId: z.string(),
  subteamId: z.string().nullable(),
  referencePeriod: z.string(),
  achievementPercent: z.coerce.number(),
  quartile: quartileSchema,
  source: z.string(),
})
export type EmployeePrvPerformance = z.infer<typeof employeePrvPerformanceSchema>
