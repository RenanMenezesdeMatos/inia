import { z } from "zod"

// EQUALS..LTE são os comparadores "legados" (valor do trigger/booleano/numérico — ver
// comparatorMatches em node-handlers.ts). Os demais só se aplicam ao caminho sourcePath/
// variável (string/array) — ver evaluateGenericComparator em node-handlers.ts. Aditivo: nenhum
// comparador existente foi removido/renomeado, então nenhuma Condition publicada quebra.
// Extraído de graph-schema.ts pra ser importável por condition-rule-schema.ts sem ciclo.
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

/** Quais comparadores fazem sentido para cada tipo de campo tipado (Structured Output field,
 * Workflow Variable, ou métrica de performance de indicador) — usado pela validação de publish
 * (workflow-router.ts) para nunca aceitar uma Condition com um operador que o motor não saiba
 * avaliar para aquele tipo. Um sourcePath sem tipo conhecido não passa por aqui — cai no modo
 * legado de validação, que já existia antes deste conceito. */
export const COMPARATORS_BY_FIELD_TYPE: Record<"BOOLEAN" | "NUMBER" | "STRING" | "ARRAY", Comparator[]> = {
  BOOLEAN: ["EQUALS"],
  NUMBER: ["EQUALS", "NOT_EQUALS", "GT", "LT", "GTE", "LTE"],
  STRING: ["EQUALS", "NOT_EQUALS", "CONTAINS", "NOT_CONTAINS", "STARTS_WITH", "ENDS_WITH", "IS_EMPTY", "NOT_EMPTY"],
  ARRAY: ["CONTAINS", "NOT_CONTAINS", "IS_EMPTY", "NOT_EMPTY"],
}
