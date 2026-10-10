import type { Database } from "../../../infrastructure/database/pool.js"
import { eligibleObservationSql, isComparablePracticeKey } from "../domain/observation-readiness.js"
import { canonicalSubjectSql } from "../../interactions/domain/interaction-subject.js"
import type { PeerObservationRow } from "../domain/peer-practice-evidence.js"

/**
 * V1.6.1 — DADOS BRUTOS PARA A EVIDÊNCIA DE PARES (só leitura, ZERO modelo). Duas consultas fixas por diagnóstico:
 *   1) população elegível: colaboradores ATIVOS do MESMO Grupo do colaborador, com medição (pessoa) do MESMO indicador no
 *      MESMO período (mesmo início e fim) — o próprio colaborador fica de fora; uma medição por pessoa (a mais recente);
 *   2) observações VERIFICADAS dessas pessoas para as práticas pedidas, dentro da janela da medição, com o motivo do
 *      atendimento (mesma expressão canônica/bruta do plano).
 * Quem é "grupo de referência" e se há privacidade suficiente é decidido pelo domínio puro (peer-practice-evidence.ts);
 * nada daqui é exibido por pessoa.
 */
export type PeerPracticeData = { peers: { personId: string; value: number }[]; observations: PeerObservationRow[] }

export async function loadPeerPracticeData(db: Database, input: { organizationId: string; measurementId: string; collaboratorId: string; practiceKeys: readonly string[] }): Promise<PeerPracticeData> {
  const peers = (await db.query<{ person_id: string; value: string }>(
    `with measurement as (
       select indicator_definition_id, period_start, period_end from indicator_measurements where id = $1 and organization_id = $2 and subject_type = 'PERSON'
     ), subject as (
       select team_id from people where id = $3 and organization_id = $2
     )
     select distinct on (m.subject_id) m.subject_id person_id, m.value
     from indicator_measurements m
     join measurement x on x.indicator_definition_id = m.indicator_definition_id and x.period_start = m.period_start and x.period_end = m.period_end
     join people p on p.id = m.subject_id and p.organization_id = $2 and p.active and p.team_id is not null and p.team_id = (select team_id from subject)
     where m.organization_id = $2 and m.subject_type = 'PERSON' and m.subject_id <> $3
     order by m.subject_id, m.created_at desc`,
    [input.measurementId, input.organizationId, input.collaboratorId],
  )).rows.map((row) => ({ personId: row.person_id, value: Number(row.value) }))
  const keys = [...new Set(input.practiceKeys.filter(isComparablePracticeKey))]
  if (peers.length === 0 || keys.length === 0) return { peers, observations: [] }
  const observations = (await db.query<{ person_id: string; interaction_id: string; practice_key: string; status: "FOLLOWED" | "NOT_FOLLOWED"; segment_key: string | null }>(
    `select o.person_id, o.interaction_id, o.practice_key, o.status, coalesce(${canonicalSubjectSql("i")}, nullif(btrim(i.reason), '')) segment_key
     from process_checkpoint_observations o
     join interactions i on i.id = o.interaction_id and i.organization_id = o.organization_id
     join indicator_measurements x on x.id = $1 and x.organization_id = $2
     where o.organization_id = $2 and o.person_id = any($3::uuid[]) and o.practice_key = any($4::text[])
       -- V1.7.1j — só observação ELEGÍVEL para agregação (a mesma regra de isObservationEligibleForAnalytics).
       and ${eligibleObservationSql("o")}
       and o.occurred_at >= x.period_start and o.occurred_at < (case when x.period_end > x.period_start then x.period_end else x.period_start + interval '1 day' end)`,
    [input.measurementId, input.organizationId, peers.map((peer) => peer.personId), keys],
  )).rows
  return { peers, observations: observations.map((row) => ({ personId: row.person_id, interactionId: row.interaction_id, practiceKey: row.practice_key, status: row.status, segmentKey: row.segment_key })) }
}
