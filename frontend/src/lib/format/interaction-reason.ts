/**
 * Motivo e submotivo de uma interação numa linha só: "Fatura › Segunda via". O motivo é a categoria genérica
 * (`interactions.reason`); o submotivo, o recorte específico dentro dele (`interactions.sub_reason`). Sem submotivo
 * (a fonte não informou, cargas antigas) mostra só o motivo — nunca "sem submotivo".
 */
export function formatInteractionReason(reason: string, subReason?: string | null): string {
  const detail = subReason?.trim()
  return detail ? `${reason} › ${detail}` : reason
}
