import type { Queryable } from "./locks.js"
import { enabledForPlace, loadPlace } from "./eligibility.js"

/**
 * SUGESTÃO ELEGÍVEL (design_draft.md seção 3; M7): o chat registra que a pessoa recebeu uma mensagem com sinal ou descurtiu com
 * "ainda preciso de ajuda" — só quando o apoio está ligado para ela, uma vez por mensagem e origem. Não cria pedido. Injetada no
 * `realtime-router` pelo `createApp` (o módulo `assistant` nunca importa este).
 */
export function createSuggestionRecorder(db: Queryable) {
  return async (input: { organizationId: string; personId: string; interactionId: string; origin: "SIGNAL" | "DISLIKE" }): Promise<void> => {
    const place = await loadPlace(db, input.organizationId, input.personId)
    if (!place || !place.active || !(await enabledForPlace(db, input.organizationId, place))) return
    await db.query(
      `insert into human_support_entry_events (organization_id, person_id, team_id, subteam_id, kind, origin, interaction_id, occurred_at)
       values ($1, $2, $3, $4, 'SUGGESTION_ELIGIBLE', $5, $6, statement_timestamp())
       on conflict (origin, interaction_id) where kind = 'SUGGESTION_ELIGIBLE' do nothing`,
      [input.organizationId, input.personId, place.teamId, place.subteamId, input.origin, input.interactionId],
    )
  }
}
