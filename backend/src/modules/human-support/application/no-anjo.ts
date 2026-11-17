import { HUMAN_SUPPORT_LIMITS, type RequestOrigin, type RequestStatus } from "../domain/catalogs.js"
import { anjosInServiceCount } from "./eligibility.js"
import type { Queryable } from "./locks.js"
import { endRequest } from "./transitions.js"

/**
 * NINGUÉM DO APOIO EM SERVIÇO (D4; migration 194). A mesma regra vale para quem pede e para o pedido que VOLTARIA à fila:
 *  - pedir sem ninguém em serviço: o botão fica desabilitado e a tentativa é registrada (`human_support_entry_events`, no máximo uma
 *    por pessoa a cada 10 min);
 *  - voltar à fila sem ninguém em serviço (Anjo sem responder; operador voltou depois de "Aguardando o operador"): o pedido não fica
 *    esperando — é encerrado (`NO_ANJO_IN_SERVICE`, estado Expirado, `anjos_in_service_at_end = 0`) e a tentativa é registrada.
 * O Anjo que CAIU (rede, sessão) continua como antes: o pedido volta à frente da fila e espera dentro do prazo, porque ele pode voltar.
 * "Em serviço" = a definição única de `anjosInServiceCount` (estado ≠ Indisponível, conexão viva, papel cobrindo o Grupo/Subgrupo).
 * Chamado sempre sob a trava da organização.
 */
export async function insertNoAnjoAttempt(client: Queryable, input: { organizationId: string; personId: string; teamId: string | null; subteamId: string | null; origin: RequestOrigin; interactionId: string | null }): Promise<void> {
  await client.query(
    `insert into human_support_entry_events (organization_id, person_id, team_id, subteam_id, kind, origin, interaction_id, occurred_at)
     select $1, $2, $3, $4, 'NO_ANJO_IN_SERVICE', $5, $6, statement_timestamp()
      where not exists (
        select 1 from human_support_entry_events e
         where e.organization_id = $1 and e.person_id = $2 and e.kind = 'NO_ANJO_IN_SERVICE' and e.occurred_at > statement_timestamp() - make_interval(secs => $7::int)
      )`,
    [input.organizationId, input.personId, input.teamId, input.subteamId, input.origin, input.interactionId, HUMAN_SUPPORT_LIMITS.noAnjoAttemptWindowMs / 1000],
  )
}

/**
 * O pedido ia voltar à fila: sem ninguém em serviço no escopo dele, encerra pela regra acima e devolve true; senão, false (quem chamou
 * segue com a volta à fila). `from` = o estado em que o pedido está agora.
 */
export async function endIfNoAnjoInService(
  client: Queryable,
  request: { id: string; organizationId: string; operatorPersonId: string; teamId: string | null; subteamId: string | null },
  input: { from: RequestStatus; attendanceId?: string | null; actorPersonId: string | null },
): Promise<boolean> {
  if ((await anjosInServiceCount(client, request.organizationId, { teamId: request.teamId, subteamId: request.subteamId }, request.operatorPersonId)) > 0) return false
  const source = (await client.query<{ origin: RequestOrigin; source_interaction_id: string | null }>(`select origin, source_interaction_id from human_support_requests where id = $1`, [request.id])).rows[0]!
  await endRequest(client, { id: request.id, organizationId: request.organizationId, operatorPersonId: request.operatorPersonId }, { from: input.from, cause: "NO_ANJO_IN_SERVICE", actorPersonId: input.actorPersonId, attendanceId: input.attendanceId ?? null })
  await client.query(`update human_support_requests set anjos_in_service_at_end = 0 where id = $1`, [request.id])
  await insertNoAnjoAttempt(client, { organizationId: request.organizationId, personId: request.operatorPersonId, teamId: request.teamId, subteamId: request.subteamId, origin: source.origin, interactionId: source.source_interaction_id })
  return true
}
