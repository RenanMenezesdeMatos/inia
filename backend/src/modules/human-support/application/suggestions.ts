import type { Queryable } from "./locks.js"
import { anjosInServiceCount, enabledForPlace, loadPlace } from "./eligibility.js"

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

/**
 * ROTA DE AJUDA DO CHAT (`HELP_ROUTE_V1`, `docs/dev/apoio-ou-lideranca.md`): quando a INIA diz que as bases não sustentam a resposta,
 * ela aponta o Apoio só se a pessoa pode pedir agora — apoio ligado no Grupo/Subgrupo dela e ALGUÉM EM SERVIÇO no escopo (a mesma
 * contagem da regra "sem Anjo em serviço": área aberta, fora de Indisponível e da pausa "Desconexão", do universo do operador quando
 * exigido). Em serviço sem vaga ou em pausa ainda vale: o pedido vai para a fila com o prazo de sempre. Só leitura (não registra a
 * tentativa, D4 — isso é da prévia do pedido). Injetada no `realtime-router` pelo `createApp`.
 */
export function createHelpRouteResolver(db: Queryable) {
  return async (input: { organizationId: string; personId: string }): Promise<"SUPPORT" | "LEADERSHIP"> => {
    const place = await loadPlace(db, input.organizationId, input.personId)
    if (!place || !place.active || !(await enabledForPlace(db, input.organizationId, place))) return "LEADERSHIP"
    return (await anjosInServiceCount(db, input.organizationId, place, input.personId)) > 0 ? "SUPPORT" : "LEADERSHIP"
  }
}
