import type pg from "pg"
import { normalizePersonName } from "../../../people/domain/person-name.js"
import type { ApplyWarning, ValidRecord, WriteContext } from "./domain-writer.js"

/**
 * IDENTIDADE na carga de Colaboradores: a mesma pessoa não pode existir duas vezes — uma cadastrada à mão na INIA (sem
 * matrícula, com login e papéis) e outra vinda da base (com matrícula, hierarquia e indicadores).
 *
 *  - CHAVE FORTE: matrícula nova cujo registro traz um e-mail igual ao da conta de login de uma pessoa da organização SEM
 *    matrícula → a matrícula é gravada NESSA pessoa (antes do upsert), em vez de nascer outra. A base passa a mandar nos
 *    campos dela; login e papéis continuam. Rastro: `audit_logs` (PERSON_LINKED_TO_SOURCE), linhagem e aviso na quarentena.
 *    E-mail repetido dentro da mesma carga é ambíguo: não liga ninguém.
 *  - CHAVE FRACA: pessoa nova com o mesmo nome normalizado de uma pessoa ativa sem matrícula → entra normalmente e a carga
 *    registra um aviso de possível duplicado com os dois ids. NUNCA junta por nome: duas "Ana Souza" são duas pessoas.
 */
export type IdentityRow = ValidRecord & { matricula: string; name: string; email: string | null }

/** Passo 0: grava a matrícula na pessoa cadastrada à mão cuja conta tem o e-mail do registro. Devolve quem foi ligado. */
export async function linkByAccountEmail<T extends IdentityRow>(context: WriteContext, client: pg.PoolClient, batch: readonly T[]): Promise<{ personId: string; row: T }[]> {
  const withEmail = batch.filter((row) => row.email)
  if (withEmail.length === 0) return []
  const result = await client.query<{ id: string; matricula: string }>(
    `with input as (
       select matricula, lower(email) email from unnest($2::text[], $3::text[]) as t(matricula, email)
     ), unambiguous as (
       select email from input group by email having count(*) = 1
     ), candidates as (
       select person.id person_id, i.matricula
         from input i
         join unambiguous u on u.email = i.email
         join user_accounts account on account.organization_id = $1 and lower(account.email) = i.email
         join people person on person.id = account.person_id and person.organization_id = $1 and person.matricula is null
        where not exists (select 1 from people known where known.organization_id = $1 and known.matricula = i.matricula)
     )
     update people p set matricula = c.matricula
       from candidates c
      where p.id = c.person_id and p.matricula is null
      returning p.id, p.matricula`,
    [context.organizationId, withEmail.map((row) => row.matricula), withEmail.map((row) => row.email)],
  )
  if (result.rows.length === 0) return []
  await client.query(
    `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload)
     select $1, null, 'PERSON_LINKED_TO_SOURCE', 'people', t.person_id,
            jsonb_build_object('mode', 'ACCOUNT_EMAIL', 'personId', t.person_id, 'matricula', t.matricula, 'runId', $4::text, 'feedId', $5::text)
       from unnest($2::uuid[], $3::text[]) as t(person_id, matricula)`,
    [context.organizationId, result.rows.map((row) => row.id), result.rows.map((row) => row.matricula), context.runId, context.feed.id],
  )
  const byMatricula = new Map(withEmail.map((row) => [row.matricula, row]))
  return result.rows.map((row) => ({ personId: row.id, row: byMatricula.get(row.matricula)! }))
}

export function linkedWarnings(linked: readonly { personId: string; row: IdentityRow }[]): ApplyWarning[] {
  return linked.map(({ personId, row }) => ({
    recordNumber: row.recordNumber,
    sourceRecordKey: row.sourceRecordKey,
    error: {
      code: "DATA_PERSON_LINKED_BY_EMAIL",
      field: "email",
      message: `Matrícula ${row.matricula} ligada à pessoa ${personId}, já cadastrada na INIA sem matrícula e com a conta de login deste e-mail — nenhuma pessoa nova foi criada. A base passa a mandar nos dados dela; login e papéis continuam.`,
    },
  }))
}

/** Depois do upsert: pessoa recém-criada com o mesmo nome de uma pessoa ativa sem matrícula vira AVISO (nunca junção). */
export async function possibleDuplicateWarnings(context: WriteContext, client: pg.PoolClient, inserted: readonly { personId: string; row: IdentityRow }[]): Promise<ApplyWarning[]> {
  if (inserted.length === 0) return []
  const manual = await client.query<{ id: string; name: string }>(
    `select id, name from people where organization_id = $1 and matricula is null and active and id <> all($2::uuid[])`,
    [context.organizationId, inserted.map((entry) => entry.personId)],
  )
  const byName = new Map<string, string[]>()
  for (const person of manual.rows) {
    const key = normalizePersonName(person.name)
    byName.set(key, [...(byName.get(key) ?? []), person.id])
  }
  return inserted.flatMap(({ personId, row }) => {
    const same = byName.get(normalizePersonName(row.name))
    if (!same) return []
    return [{
      recordNumber: row.recordNumber,
      sourceRecordKey: row.sourceRecordKey,
      error: {
        code: "DATA_POSSIBLE_DUPLICATE_PERSON" as const,
        field: "name",
        message: `Pessoa nova ${personId} (matrícula ${row.matricula}) tem o mesmo nome de ${same.length > 1 ? "pessoas cadastradas" : "uma pessoa cadastrada"} na INIA sem matrícula (${same.join(", ")}). A INIA não junta por nome: se for a mesma pessoa, use "Vincular à pessoa da base" na ficha da pessoa cadastrada à mão (Usuários e acessos › Pessoas).`,
      },
    }]
  })
}
