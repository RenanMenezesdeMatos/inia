import { z } from "zod"

export const flagValueTypeSchema = z.enum(["BOOLEAN", "NUMERIC"])
export type FlagValueType = z.infer<typeof flagValueTypeSchema>

export const FLAG_VALUE_TYPE_LABELS: Record<FlagValueType, string> = {
  BOOLEAN: "Verdadeiro/falso",
  NUMERIC: "Numérico",
}

/** Chamada boa × ruim no sinal (migration 156) — o mesmo contrato do backend (`channel-flags/domain/call-outcome.ts`). */
export const SIGNAL_OPERATORS = ["GTE", "GT", "LTE", "LT", "EQ"] as const
export type SignalOperator = (typeof SIGNAL_OPERATORS)[number]
export const SIGNAL_OPERATOR_LABELS: Record<SignalOperator, string> = { GTE: "maior ou igual a", GT: "maior que", LTE: "menor ou igual a", LT: "menor que", EQ: "igual a" }
const signalConditionSchema = z.object({ operator: z.enum(SIGNAL_OPERATORS), value: z.number() })
export const callOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NUMERIC"), good: signalConditionSchema, bad: signalConditionSchema }),
  z.object({ kind: z.literal("BOOLEAN"), badValue: z.boolean() }),
])
export type CallOutcome = z.infer<typeof callOutcomeSchema>

export const channelFlagSchema = z.object({
  id: z.string(),
  channel: z.string(),
  flagName: z.string(),
  valueType: flagValueTypeSchema,
  description: z.string().nullable(),
  /** Nome de exibição e ícone (migration 115): como a flag aparece para o colaborador no motivo do feedback. */
  label: z.string().nullable().optional().default(null),
  iconKey: z.string().nullable().optional().default(null),
  active: z.boolean(),
  createdAt: z.coerce.string(),
  /** Boas práticas (migration 156): o que é chamada boa/ruim no sinal e o indicador relacionado. */
  callOutcome: callOutcomeSchema.nullable().optional().default(null),
  relatedIndicatorId: z.string().nullable().optional().default(null),
  relatedIndicatorName: z.string().nullable().optional().default(null),
})
export type ChannelFlag = z.infer<typeof channelFlagSchema>
