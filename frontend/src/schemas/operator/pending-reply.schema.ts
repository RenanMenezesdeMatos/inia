import { z } from "zod"

/**
 * Resposta da INIA ainda sendo gerada para uma pergunta da conversa (backend `assistant-reply-runs.ts`): a pessoa saiu da tela
 * (trocou de aba ou de área, recarregou) e voltou antes do fim. `label` = a etapa real agora; `clientMessageId` = a chave do "Parar".
 */
export const pendingReplySchema = z.object({
  questionInteractionId: z.string(),
  clientMessageId: z.string(),
  label: z.string().nullable(),
  startedAt: z.string(),
})
export type PendingReply = z.infer<typeof pendingReplySchema>

/** Leitura tolerante: ausente ou fora do formato = nada em andamento (a conversa continua abrindo normalmente). */
export function parsePendingReply(value: unknown): PendingReply | null {
  const parsed = pendingReplySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
