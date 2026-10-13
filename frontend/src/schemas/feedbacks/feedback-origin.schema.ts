import { z } from "zod"

/**
 * MOTIVO do feedback (backend feedbacks/domain/feedback-origin.ts): tipo (monitoria/indicador), por que veio (flag que disparou,
 * rotina, avulsa, indicador), o nome configurado e a chave do ícone (catálogo `@/lib/display-icons`).
 */
export const feedbackOriginSchema = z.object({
  family: z.enum(["MONITORING", "INDICATOR"]),
  reason: z.enum(["FLAG", "SCHEDULE", "MANUAL", "INDICATOR", "UNKNOWN"]),
  label: z.string().nullable(),
  iconKey: z.string(),
})
export type FeedbackOrigin = z.infer<typeof feedbackOriginSchema>
