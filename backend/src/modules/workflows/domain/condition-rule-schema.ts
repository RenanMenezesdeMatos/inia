import { z } from "zod"
import { comparatorSchema } from "./comparator-schema.js"

/**
 * O "corpo" de uma regra simples de Condition — tudo que uma Condition hoje já suporta, MENOS
 * `historicalQuery` (histórico não é composável dentro de um grupo AND/OR nesta versão: uma
 * regra "sem dados" dentro de uma combinação lógica é ambígua demais pra valer a complexidade
 * agora — ver relatório). Extraído como tipo próprio pra ser reaproveitado tanto pela Condition
 * simples quanto por `ConditionGroup`, sem duplicar a validação.
 */
export const conditionRuleSchema = z.object({
  comparator: comparatorSchema,
  thresholdBoolean: z.boolean().nullable().optional(),
  thresholdNumeric: z.number().nullable().optional(),
  sourcePath: z.string().trim().min(1).optional(),
  thresholdText: z.string().optional(),
})
export type ConditionRule = z.infer<typeof conditionRuleSchema>

/**
 * ALL = "todas as regras abaixo" (AND) · ANY = "qualquer regra abaixo" (OR). `rules` é uma lista
 * plana de hoje (não `(ConditionRule | ConditionGroup)[]`) de propósito — não há pedido de UI de
 * grupos aninhados ainda, mas nada aqui impede evoluir pra isso depois de forma aditiva.
 */
export const conditionGroupSchema = z.object({
  operator: z.enum(["ALL", "ANY"]),
  rules: z.array(conditionRuleSchema).min(1),
})
export type ConditionGroup = z.infer<typeof conditionGroupSchema>
