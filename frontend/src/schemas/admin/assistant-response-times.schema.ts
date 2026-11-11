import { z } from "zod"

/**
 * Espelho de `monitoredResponseTimes` (backend `assistant/application/conversation-monitoring.ts`): tempo entre a pergunta do
 * colaborador e a resposta completa da INIA no chat de TEXTO, no período (data local da resposta) e nos filtros da lista. Sem
 * nenhuma resposta, os tempos vêm `null` (nunca zero).
 */
export const responseTimeSummarySchema = z.object({
  from: z.string(),
  to: z.string(),
  replies: z.number(),
  averageSeconds: z.number().nullable(),
  medianSeconds: z.number().nullable(),
  p90Seconds: z.number().nullable(),
})
export type ResponseTimeSummary = z.infer<typeof responseTimeSummarySchema>
