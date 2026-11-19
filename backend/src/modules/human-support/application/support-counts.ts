import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * LEITURA DE CONTAGENS DO APOIO PARA FORA DO MÓDULO (ferramentas de dados da liderança): um registro por atendimento de apoio, só com
 * QUANDO começou, COMO terminou e os TEMPOS (até a primeira resposta do Anjo e duração). Nunca o conteúdo da sala de apoio, a pergunta do
 * operador, o Anjo que atendeu nem qualquer texto: quem chama não tem como pedir essas colunas. É a única porta de leitura das tabelas
 * do apoio fora do módulo (o teste de isolamento garante).
 *
 * Sempre pela organização e pelas pessoas já resolvidas por quem chama (o escopo é de quem chama); datas civis no fuso informado;
 * ordem estável e teto de linhas (`limit` + 1 para o chamador saber que cortou).
 */
export type SupportAttendanceCount = {
  id: string
  operatorPersonId: string
  /** Data local (AAAA-MM-DD) do início do atendimento de apoio. */
  localDay: string
  status: string
  endCause: string | null
  secondsToFirstAnswer: number | null
  durationSeconds: number | null
}

export const SUPPORT_END_CAUSE_LABELS: Record<string, string> = { ANJO_CLOSED: "Encerrado pelo Anjo", ANJO_LOST: "Perdido pelo Anjo", INACTIVITY: "Encerrado por inatividade", OPERATOR_CLOSED: "Encerrado pelo operador" }

export async function listSupportAttendanceCounts(
  db: Pick<Database, "query">,
  input: { organizationId: string; operatorPersonIds: readonly string[]; fromDate: string; toDateExclusive: string; timeZone: string; limit: number },
): Promise<SupportAttendanceCount[]> {
  if (input.operatorPersonIds.length === 0) return []
  const result = await db.query<{ id: string; person_id: string; end_cause: string | null; status: string; local_day: string; to_first: string | null; duration: string | null }>(
    `select id, operator_person_id as person_id, end_cause, status, (started_at at time zone $5)::date::text as local_day,
            extract(epoch from first_anjo_message_at - started_at)::text as to_first, extract(epoch from ended_at - started_at)::text as duration
       from human_support_attendances
      where organization_id = $1 and operator_person_id = any($2::uuid[])
        and started_at >= ($3::date)::timestamp at time zone $5 and started_at < ($4::date)::timestamp at time zone $5
      order by started_at, id
      limit $6`,
    [input.organizationId, [...input.operatorPersonIds], input.fromDate, input.toDateExclusive, input.timeZone, input.limit],
  )
  return result.rows.map((row) => ({
    id: row.id,
    operatorPersonId: row.person_id,
    localDay: row.local_day,
    status: row.status,
    endCause: row.end_cause,
    secondsToFirstAnswer: row.to_first === null ? null : Number(row.to_first),
    durationSeconds: row.duration === null ? null : Number(row.duration),
  }))
}
