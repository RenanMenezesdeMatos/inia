import type { Queryable } from "./locks.js"

/**
 * VERSÃO POR PESSOA (`human_support_inbox_versions`, design_draft.md seção 11): sobe na mesma transação de toda mudança que a pessoa
 * vê (pedido, atribuição, atendimento, mensagem, avaliação, classificação, presença do próprio Anjo, avisos de conexão). Renovações
 * (conexão do Anjo, presença do operador) não sobem; a disponibilidade também não (é recalculada a cada resposta). Sempre a última
 * trava da transação, em ordem de `person_id` (evita impasse entre duas transações que avisam as mesmas pessoas).
 */
export async function bumpInboxVersions(client: Queryable, organizationId: string, personIds: Iterable<string | null | undefined>): Promise<void> {
  const ids = [...new Set([...personIds].filter((id): id is string => Boolean(id)))].sort()
  if (ids.length === 0) return
  await client.query(
    `insert into human_support_inbox_versions (organization_id, person_id, version)
     select $1, person_id, 1 from unnest($2::uuid[]) as person_id order by person_id
     on conflict (organization_id, person_id) do update set version = human_support_inbox_versions.version + 1`,
    [organizationId, ids],
  )
}

export const versionKey = (organizationId: string, personId: string) => `${organizationId}:${personId}`

/** Versões de várias pessoas numa consulta só (o laço de releitura das chamadas longas). Pessoa sem linha = "0". */
export async function readInboxVersions(db: Queryable, keys: readonly { organizationId: string; personId: string }[]): Promise<Map<string, string>> {
  const versions = new Map<string, string>()
  if (keys.length === 0) return versions
  for (const key of keys) versions.set(versionKey(key.organizationId, key.personId), "0")
  const result = await db.query<{ organization_id: string; person_id: string; version: string }>(
    `select v.organization_id, v.person_id, v.version::text version
       from human_support_inbox_versions v
       join unnest($1::uuid[], $2::uuid[]) as k(organization_id, person_id) on k.organization_id = v.organization_id and k.person_id = v.person_id`,
    [keys.map((key) => key.organizationId), keys.map((key) => key.personId)],
  )
  for (const row of result.rows) versions.set(versionKey(row.organization_id, row.person_id), row.version)
  return versions
}

export async function readInboxVersion(db: Queryable, organizationId: string, personId: string): Promise<string> {
  return (await readInboxVersions(db, [{ organizationId, personId }])).get(versionKey(organizationId, personId)) ?? "0"
}
