/**
 * LEITOR ANALÍTICO da aplicação de feedback e da confirmação de ciência (Monitoria de usabilidade). Fontes oficiais:
 *   - `feedback_applications`: uma aplicação por fonte; ESTADO atual + marcos (início, última abertura, pausa, conclusão, último
 *     início/fim/interrupção da apresentação, quantidade de reproduções, convite). O histórico de retomadas/pausas vem dos fatos
 *     de servidor da monitoria (a tabela guarda só o último).
 *   - `feedback_read_confirmation_events`: uma linha por fato de cada TENTATIVA (OPENED → FAILED… → CONFIRMED | CANCELLED),
 *     com ponto de entrada, dispositivo, motivo da falha, idempotência (`already_confirmed`) e conclusão da aplicação.
 *
 * Colunas de `applicationsSql`: application_id, source_kind, source_id, recipient_person_id, status, started_at, last_opened_at,
 * paused_at, completed_at, presentation_started_at, presentation_completed_at, presentation_interrupted_at,
 * presentation_play_count, invite_offered_at, invite_resolved_at, invite_resolution, conversation_id.
 * Colunas de `readConfirmationEventsSql`: event_id, source_kind, source_id, person_id, entry_point, attempt_id, event,
 * failure_reason, already_confirmed, application_id, completed_application, device, elapsed_ms, occurred_at.
 */
export function applicationsSql(organizationParam: string): string {
  return `select a.id application_id, a.source_kind, coalesce(a.feedback_id, a.interaction_delivery_id) source_id, a.recipient_person_id, a.status,
      a.started_at, a.last_opened_at, a.paused_at, a.completed_at, a.presentation_started_at, a.presentation_completed_at,
      a.presentation_interrupted_at, a.presentation_play_count, a.invite_offered_at, a.invite_resolved_at, a.invite_resolution, a.conversation_id
    from feedback_applications a where a.organization_id = ${organizationParam}`
}

export function readConfirmationEventsSql(organizationParam: string): string {
  return `select r.id event_id, r.source_kind, coalesce(r.feedback_id, r.interaction_delivery_id) source_id, r.person_id, r.entry_point, r.attempt_id,
      r.event, r.failure_reason, r.already_confirmed, r.application_id, r.completed_application, r.device, r.elapsed_ms, r.occurred_at
    from feedback_read_confirmation_events r where r.organization_id = ${organizationParam}`
}

/** Conversas (complementares) ligadas a aplicações — colunas: application_id, conversation_id. */
export function applicationConversationsSql(organizationParam: string): string {
  return `select a.id application_id, a.conversation_id from feedback_applications a where a.organization_id = ${organizationParam} and a.conversation_id is not null
    union all select f.application_id, f.conversation_id from feedback_application_followups f where f.organization_id = ${organizationParam}`
}
