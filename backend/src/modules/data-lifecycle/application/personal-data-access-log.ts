import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * REGISTRO DE LEITURA de dados pessoais de OUTRA pessoa (migration 151, LGPD): quem abriu a transcrição de uma chamada, uma
 * conversa com a INIA, a ficha do colaborador, uma conversa de apoio com Anjo ou a presença de um Anjo (migration 182). É chamado DEPOIS de a rota autorizar e carregar o dado — nunca decide acesso.
 * Ler os próprios dados não é registrado. Reabrir o mesmo registro em até 10 minutos não grava de novo.
 *
 * Falha ao registrar não derruba a tela (o dado já foi autorizado): vai para o log com o evento `personal_data_access_log_failed`.
 */
export type PersonalDataKind = "CALL_TRANSCRIPT" | "ASSISTANT_CONVERSATION" | "EMPLOYEE_PROFILE" | "HUMAN_SUPPORT_CONVERSATION" | "HUMAN_SUPPORT_PRESENCE"

export type PersonalDataAccess = {
  organizationId: string
  viewerPersonId: string
  subjectPersonId: string
  dataKind: PersonalDataKind
  /** O registro aberto (interação, conversa, avaliação…), quando houver. */
  resourceId?: string | null
  at?: Date
}

export const ACCESS_LOG_DEDUPE_MINUTES = 10

/** `false` = a gravação falhou (já foi para o log); quem conta falhas para as métricas usa o retorno. Ler os próprios dados = `true`. */
export async function recordPersonalDataAccess(db: Pick<Database, "query">, access: PersonalDataAccess): Promise<boolean> {
  if (access.viewerPersonId === access.subjectPersonId) return true
  const at = access.at ?? new Date()
  try {
    await db.query(
      `insert into personal_data_access_log (organization_id, viewer_person_id, subject_person_id, data_kind, resource_id, accessed_at)
       select $1, $2, $3, $4, $5, $6
        where not exists (
          select 1 from personal_data_access_log l
           where l.organization_id = $1 and l.subject_person_id = $3 and l.viewer_person_id = $2 and l.data_kind = $4
             and l.resource_id is not distinct from $5 and l.accessed_at > $6::timestamptz - make_interval(mins => $7::int)
        )`,
      [access.organizationId, access.viewerPersonId, access.subjectPersonId, access.dataKind, access.resourceId ?? null, at, ACCESS_LOG_DEDUPE_MINUTES],
    )
    return true
  } catch (error) {
    console.error(JSON.stringify({ event: "personal_data_access_log_failed", dataKind: access.dataKind, message: (error as Error).message }))
    return false
  }
}

export type PersonalDataAccessEntry = { viewerPersonId: string; viewerName: string; dataKind: PersonalDataKind; resourceId: string | null; accessedAt: string }

/** Quem viu os dados desta pessoa (mais recente primeiro) — base para responder a um pedido do titular ou a uma investigação. */
export async function personalDataAccessesOf(db: Pick<Database, "query">, organizationId: string, subjectPersonId: string, options: { limit?: number } = {}): Promise<PersonalDataAccessEntry[]> {
  const result = await db.query<{ viewer_person_id: string; viewer_name: string; data_kind: PersonalDataKind; resource_id: string | null; accessed_at: Date }>(
    `select l.viewer_person_id, p.name viewer_name, l.data_kind, l.resource_id, l.accessed_at
       from personal_data_access_log l join people p on p.id = l.viewer_person_id
      where l.organization_id = $1 and l.subject_person_id = $2
      order by l.accessed_at desc, l.id desc
      limit $3`,
    [organizationId, subjectPersonId, Math.min(Math.max(options.limit ?? 500, 1), 5_000)],
  )
  return result.rows.map((row) => ({ viewerPersonId: row.viewer_person_id, viewerName: row.viewer_name, dataKind: row.data_kind, resourceId: row.resource_id, accessedAt: new Date(row.accessed_at).toISOString() }))
}
