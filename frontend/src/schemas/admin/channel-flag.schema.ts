import { z } from "zod"

export const flagValueTypeSchema = z.enum(["BOOLEAN", "NUMERIC"])
export type FlagValueType = z.infer<typeof flagValueTypeSchema>

export const FLAG_VALUE_TYPE_LABELS: Record<FlagValueType, string> = {
  BOOLEAN: "Verdadeiro/falso",
  NUMERIC: "Numérico",
}

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
})
export type ChannelFlag = z.infer<typeof channelFlagSchema>
