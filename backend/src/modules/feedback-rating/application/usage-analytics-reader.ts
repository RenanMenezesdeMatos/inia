/**
 * LEITOR ANALÍTICO das avaliações de feedback (Monitoria de usabilidade). Fonte oficial: `feedback_ratings`, HISTÓRICO (uma
 * linha por mudança; a anterior é encerrada por `superseded_at`). A avaliação VIGENTE numa data D é a linha com
 * created_at ≤ D e (superseded_at é nula ou > D); hoje = a linha sem superseded_at. `NONE` = avaliação retirada.
 * O comentário só sai deste leitor quando pedido explicitamente (`withComment`) — quem chama decide a permissão.
 *
 * Colunas de `ratingsHistorySql`: rating_id, source_kind, source_id, person_id, value, reason, created_at, superseded_at[, comment].
 */
export const DISLIKE_REASON_LABELS: Record<string, string> = {
  POOR_WRITING: "Texto mal escrito",
  WRONG_PROCESS: "Processo errado",
  UNCLEAR: "Pouco claro",
  INIA_COULD_NOT_ANSWER: "A INIA não soube responder",
  INACCURATE: "Informação incorreta",
  NOT_HELPFUL: "Não ajudou",
  OTHER: "Outro motivo",
}

export function ratingsHistorySql(organizationParam: string, options: { withComment?: boolean } = {}): string {
  return `select r.id rating_id, r.source_kind, coalesce(r.feedback_id, r.interaction_delivery_id) source_id, r.person_id, r.value, r.reason,
      r.created_at, r.superseded_at${options.withComment ? ", r.comment" : ""}
    from feedback_ratings r where r.organization_id = ${organizationParam}`
}
