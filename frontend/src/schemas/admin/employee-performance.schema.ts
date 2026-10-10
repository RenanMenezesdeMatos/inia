import { z } from "zod"

/** Q1 = melhor quartil, Q4 = pior — sempre, independente do indicador ser "maior é melhor" ou
 * "menor é melhor". Vem pronto da fonte oficial; nunca inferido do valor bruto (Parte 27). */
export const quartileSchema = z.enum(["Q1", "Q2", "Q3", "Q4"])
export type Quartile = z.infer<typeof quartileSchema>
export const QUARTILE_VALUES: Quartile[] = ["Q1", "Q2", "Q3", "Q4"]
