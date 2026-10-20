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

/** Lugar da pessoa cadastrada à mão ANTES de a base mandar nela (Grupo e nível que quem a cadastrou definiu). */
export type ManualPlacement = { teamId: string | null; role: string | null }

/** Passo 0: grava a matrícula na pessoa cadastrada à mão cuja conta tem o e-mail do registro. Devolve quem foi ligado. */
export async function linkByAccountEmail<T extends IdentityRow>(context: WriteContext, client: pg.PoolClient, batch: readonly T[]): Promise<{ personId: string; row: T; prior: ManualPlacement }[]> {
  const withEmail = batch.filter((row) => row.email)
  if (withEmail.length === 0) return []
  const result = await client.query<{ id: string; matricula: string; prior_team_id: string | null; prior_role: string | null }>(
    `with input as (
       select matricula, lower(email) email from unnest($2::text[], $3::text[]) as t(matricula, email)
     ), unambiguous as (
       select email from input group by email having count(*) = 1
     ), candidates as (
       select person.id person_id, i.matricula, person.team_id prior_team_id, person.role prior_role
         from input i
         join unambiguous u on u.email = i.email
         join user_accounts account on account.organization_id = $1 and lower(account.email) = i.email
         join people person on person.id = account.person_id and person.organization_id = $1 and person.matricula is null
        where not exists (select 1 from people known where known.organization_id = $1 and known.matricula = i.matricula)
     )
     update people p set matricula = c.matricula
       from candidates c
      where p.id = c.person_id and p.matricula is null
      returning p.id, p.matricula, c.prior_team_id, c.prior_role`,
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
  return result.rows.map((row) => ({ personId: row.id, row: byMatricula.get(row.matricula)!, prior: { teamId: row.prior_team_id, role: row.prior_role } }))
}

/**
 * A base pôs a pessoa ligada num lugar que quem a cadastrou à mão não definiu — outro Grupo, ou um nível de liderança — e
 * quem a cadastrou tinha escopo de Grupo (a pessoa tinha Grupo). A credencial dessa conta foi entregue por quem não tem custódia
 * do lugar novo (achado AUTH-13 da auditoria de 17/10/2026: um administrador do Grupo A pré-cadastrava o e-mail de quem ia
 * chegar como Supervisor do Grupo B e ficava com a conta): ela é desabilitada e a liberação volta a quem tem custódia dele.
 */
export function credentialNeedsNewCustody(prior: ManualPlacement, incoming: { teamId: string | null; role: string | null }): boolean {
  if (!prior.teamId) return false
  if (incoming.teamId && incoming.teamId !== prior.teamId) return true
  return Boolean(incoming.role && incoming.role !== prior.role && incoming.role !== "OPERATOR")
}

/**
 * Desabilita a conta de login das pessoas (mesma instrução do "Desabilitar acesso" do cadastro: conta inativa, sessões
 * derrubadas, senha temporária apagada) e audita com o motivo. A conta de quem é Administrador geral nunca é desabilitada por
 * carga — só as sessões caem — para a organização não ficar sem quem libere acessos.
 */
export async function disableAccountsFromSource(context: WriteContext, client: pg.PoolClient, personIds: readonly string[], reason: "PERSON_DEACTIVATED_BY_SOURCE" | "LINKED_BY_SOURCE_NEW_PLACEMENT"): Promise<{ personId: string; disabled: boolean }[]> {
  if (personIds.length === 0) return []
  const result = await client.query<{ person_id: string; tenant_admin: boolean }>(
    `with target as (
       select ua.id, ua.person_id,
              exists (select 1 from access_role_assignments a where a.user_account_id = ua.id and a.revoked_at is null and a.role_code = 'ADMINISTRADOR_GERAL') tenant_admin
         from user_accounts ua
        where ua.organization_id = $1 and ua.person_id = any($2::uuid[]) and ua.active
     ), changed as (
       update user_accounts ua set
         active = case when t.tenant_admin then ua.active else false end,
         access_disabled_at = case when t.tenant_admin then ua.access_disabled_at else now() end,
         session_version = ua.session_version + 1,
         password_change_required = case when t.tenant_admin then ua.password_change_required else false end,
         temporary_password_issued_at = case when t.tenant_admin then ua.temporary_password_issued_at else null end,
         temporary_password_expires_at = case when t.tenant_admin then ua.temporary_password_expires_at else null end,
         updated_at = now()
        from target t where ua.id = t.id
       returning ua.id, t.person_id, t.tenant_admin
     ), audited as (
       insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload)
       select $1, null, case when tenant_admin then 'ACCESS_SESSIONS_REVOKED' else 'ACCESS_DISABLED' end, 'user_account', id,
              jsonb_build_object('personId', person_id, 'reason', $3::text, 'sessionsRevoked', true, 'runId', $4::text, 'feedId', $5::text)
         from changed
     )
     select person_id, tenant_admin from changed`,
    [context.organizationId, personIds, reason, context.runId, context.feed.id],
  )
  return result.rows.map((row) => ({ personId: row.person_id, disabled: !row.tenant_admin }))
}

export function linkedWarnings(linked: readonly { personId: string; row: IdentityRow }[], accessDisabled: ReadonlySet<string> = new Set()): ApplyWarning[] {
  return linked.flatMap(({ personId, row }) => [{
    recordNumber: row.recordNumber,
    sourceRecordKey: row.sourceRecordKey,
    error: {
      code: "DATA_PERSON_LINKED_BY_EMAIL",
      field: "email",
      message: `Matrícula ${row.matricula} ligada à pessoa ${personId}, já cadastrada na INIA sem matrícula e com a conta de login deste e-mail — nenhuma pessoa nova foi criada. A base passa a mandar nos dados dela; login e papéis continuam.`,
    },
  }, ...(accessDisabled.has(personId) ? [{
    recordNumber: row.recordNumber,
    sourceRecordKey: row.sourceRecordKey,
    error: {
      code: "DATA_PERSON_LINK_ACCESS_DISABLED" as const,
      field: "email",
      message: `A base pôs a pessoa ${personId} (matrícula ${row.matricula}) em outro Grupo ou num nível de liderança que o cadastro manual não tinha: o acesso dela foi desabilitado e as sessões caíram. Quem administra o lugar novo libera de novo em Usuários e acessos (Habilitar acesso), com uma senha temporária nova.`,
    },
  }] : [])])
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
