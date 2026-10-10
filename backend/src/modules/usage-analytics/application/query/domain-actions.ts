import { conversationMessagesSql } from "../../../assistant/application/usage-analytics-reader.js"
import { applicationsSql, readConfirmationEventsSql } from "../../../feedback-application/application/usage-analytics-reader.js"
import { ratingsHistorySql } from "../../../feedback-rating/application/usage-analytics-reader.js"
import { manualRunsSql } from "../../../workflows/application/usage-analytics-reader.js"

/**
 * AÇÕES DE DOMÍNIO confirmadas no servidor (base de "pessoa engajada") — lidas das fontes oficiais, nunca de clique:
 * mensagem de texto ou turno de voz da pessoa, avaliação de feedback (criar/alterar/retirar), ciência NOVA (repetição
 * idempotente não conta), início de aplicação com a INIA e execução manual de workflow aceita.
 * Colunas: person_id, occurred_at, action.
 */
export const DOMAIN_ACTION_LABELS: Record<string, string> = {
  MESSAGE_TEXT: "Mensagem de texto à INIA",
  MESSAGE_VOICE: "Turno de voz com a INIA",
  RATING: "Avaliação de feedback",
  ACK: "Ciência confirmada",
  APPLICATION_STARTED: "Aplicação com a INIA iniciada",
  MANUAL_RUN: "Execução manual de workflow",
}

export function domainActionsSql(org: string): string {
  return `select m.owner_person_id person_id, m.occurred_at, case when m.channel = 'voice' then 'MESSAGE_VOICE' else 'MESSAGE_TEXT' end action
      from (${conversationMessagesSql(org)}) m where m.role = 'user'
    union all select r.person_id, r.created_at, 'RATING' from (${ratingsHistorySql(org)}) r
    union all select c.person_id, c.occurred_at, 'ACK' from (${readConfirmationEventsSql(org)}) c where c.event = 'CONFIRMED' and c.already_confirmed is false
    union all select a.recipient_person_id, a.started_at, 'APPLICATION_STARTED' from (${applicationsSql(org)}) a where a.started_at is not null
    union all select mr.requested_by, mr.requested_at, 'MANUAL_RUN' from (${manualRunsSql(org)}) mr`
}
