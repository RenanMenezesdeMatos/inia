import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"

/**
 * VINCULAR À PESSOA DA BASE — corrige um duplicado que já existe: a pessoa cadastrada à mão na INIA (sem matrícula, com login
 * e papéis) e a mesma pessoa vinda da base (com matrícula, hierarquia e indicadores). Numa transação: a conta de login vai
 * para a pessoa da base (os papéis são da conta e vão junto), as sessões abertas caem (o token carrega a pessoa — novo
 * login), a pessoa avulsa fica inativa e o vínculo vai para `audit_logs` (PERSON_LINKED_TO_SOURCE, modo MANUAL) — é dali que
 * a ficha lê "vinculada a". Histórico da pessoa avulsa (conversas, avisos, feedbacks, perfil) fica com ela.
 *
 * A autorização (escopo das duas pessoas, custódia da credencial, nunca a própria conta) é do chamador; aqui ficam as
 * pré-condições do dado, conferidas de novo dentro da transação com as linhas travadas.
 */
export const PERSON_LINK_ACTION = "PERSON_LINKED_TO_SOURCE"

export type PersonSourceLinkInput = { organizationId: string; fromPersonId: string; toPersonId: string; actorPersonId: string; actorAccountId: string }
export type PersonSourceLinkResult = { fromPersonId: string; toPersonId: string; matricula: string; accountId: string | null; sessionsRevoked: boolean }

export async function linkPersonToSourcePerson(db: Database, input: PersonSourceLinkInput): Promise<PersonSourceLinkResult> {
  if (input.fromPersonId === input.toPersonId) throw new DomainError("Escolha outra pessoa: não dá para vincular alguém a si mesmo.", "PERSON_LINK_SAME_PERSON", 422)
  const client = await db.connect()
  try {
    await client.query("begin")
    const people = await client.query<{ id: string; matricula: string | null; active: boolean; account_id: string | null }>(
      `select person.id, person.matricula, person.active, (select account.id from user_accounts account where account.person_id = person.id) account_id
         from people person
        where person.organization_id = $1 and person.id = any($2::uuid[])
        order by person.id
        for update`,
      [input.organizationId, [input.fromPersonId, input.toPersonId]],
    )
    const from = people.rows.find((row) => row.id === input.fromPersonId)
    const to = people.rows.find((row) => row.id === input.toPersonId)
    if (!from || !to) throw new DomainError("Pessoa não encontrada.", "USER_NOT_FOUND", 404)
    if (from.matricula !== null) throw new DomainError("Esta pessoa já veio da base (tem matrícula) — o vínculo é feito a partir da pessoa cadastrada à mão.", "PERSON_LINK_SOURCE_HAS_MATRICULA", 409)
    const alreadyLinked = await client.query(`select 1 from audit_logs where organization_id = $1 and entity_type = 'people' and entity_id = $2 and action = $3 limit 1`, [input.organizationId, from.id, PERSON_LINK_ACTION])
    if (alreadyLinked.rows.length > 0) throw new DomainError("Esta pessoa já foi vinculada a uma pessoa da base.", "PERSON_ALREADY_LINKED", 409)
    if (to.matricula === null) throw new DomainError("Escolha uma pessoa que veio da base (com matrícula).", "PERSON_LINK_TARGET_NOT_FROM_SOURCE", 422)
    if (!to.active) throw new DomainError("A pessoa da base está inativa: os papéis da conta não valeriam para ela. Confira a base antes de vincular.", "PERSON_LINK_TARGET_INACTIVE", 409)
    if (to.account_id !== null) throw new DomainError("A pessoa da base já tem conta de login. Decida qual conta fica (desabilite a outra em Acessos) antes de vincular.", "PERSON_LINK_TARGET_HAS_ACCOUNT", 409)

    // Mesma conta, outra pessoa: papéis (por conta) acompanham; a versão de sessão sobe e derruba os tokens com a pessoa antiga.
    const moved = await client.query<{ id: string }>(
      `update user_accounts set person_id = $3, session_version = session_version + 1, updated_at = now()
        where organization_id = $1 and person_id = $2
        returning id`,
      [input.organizationId, from.id, to.id],
    )
    const accountId = moved.rows[0]?.id ?? null
    await client.query(`update people set active = false where id = $1 and organization_id = $2`, [from.id, input.organizationId])
    await client.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'people', $4, $5::jsonb)`,
      [input.organizationId, input.actorPersonId, PERSON_LINK_ACTION, from.id, JSON.stringify({ mode: "MANUAL", fromPersonId: from.id, toPersonId: to.id, matricula: to.matricula, accountId, actorAccountId: input.actorAccountId, sessionsRevoked: accountId !== null })],
    )
    await client.query("commit")
    return { fromPersonId: from.id, toPersonId: to.id, matricula: to.matricula, accountId, sessionsRevoked: accountId !== null }
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

/** "Vinculada a": o último vínculo manual da pessoa avulsa (pessoa da base e quando), lido do `audit_logs`. */
export async function loadPersonLink(db: Pick<Database, "query">, organizationId: string, personId: string): Promise<{ id: string; name: string; matricula: string | null; at: string } | null> {
  const result = await db.query<{ id: string; name: string; matricula: string | null; created_at: Date }>(
    `select target.id, target.name, target.matricula, link.created_at
       from audit_logs link
       join people target on target.organization_id = link.organization_id and target.id::text = link.payload->>'toPersonId'
      where link.organization_id = $1 and link.entity_type = 'people' and link.entity_id = $2 and link.action = $3
      order by link.created_at desc
      limit 1`,
    [organizationId, personId, PERSON_LINK_ACTION],
  )
  const row = result.rows[0]
  return row ? { id: row.id, name: row.name, matricula: row.matricula, at: new Date(row.created_at).toISOString() } : null
}
