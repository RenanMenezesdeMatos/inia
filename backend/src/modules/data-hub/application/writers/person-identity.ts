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
 * Pessoa cadastrada à mão JÁ COM matrícula (o cadastro de Usuários aceita a matrícula) e com conta de login ativa, que nenhuma carga
 * de pessoas aplicou ainda (sem linhagem `people` — a mesma noção de "a base já aplicou a pessoa" do controle por campo): o upsert
 * por matrícula passa a mandar nela agora, como no vínculo pelo e-mail, e o lugar manual de antes vai para a mesma regra de custódia
 * (achado C09 da 4ª auditoria: este segundo caminho do AUTH-13 não passava por ela). Quem o vínculo pelo e-mail já ligou fica fora.
 */
export async function preRegisteredByMatricula<T extends IdentityRow>(context: WriteContext, client: pg.PoolClient, batch: readonly T[], alreadyLinked: ReadonlySet<string>): Promise<{ personId: string; row: T; prior: ManualPlacement }[]> {
  if (batch.length === 0) return []
  const result = await client.query<{ id: string; matricula: string; team_id: string | null; role: string | null }>(
    `select p.id, p.matricula, p.team_id, p.role from people p
      where p.organization_id = $1 and p.matricula = any($2::text[])
        and exists (select 1 from user_accounts ua where ua.organization_id = $1 and ua.person_id = p.id and ua.active)
        and not exists (select 1 from data_lineage l where l.organization_id = $1 and l.entity_type = 'people' and l.entity_id = p.id)`,
    [context.organizationId, batch.map((row) => row.matricula)],
  )
  const byMatricula = new Map(batch.map((row) => [row.matricula, row]))
  return result.rows.filter((row) => !alreadyLinked.has(row.id)).map((row) => ({ personId: row.id, row: byMatricula.get(row.matricula)!, prior: { teamId: row.team_id, role: row.role } }))
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
  }, ...accessDisabledWarnings([{ personId, row }], accessDisabled)])
}

/** Aviso de quarentena para cada pessoa cadastrada à mão cujo acesso a carga desabilitou por custódia (lugar novo). */
export function accessDisabledWarnings(entries: readonly { personId: string; row: IdentityRow }[], accessDisabled: ReadonlySet<string>): ApplyWarning[] {
  return entries.filter(({ personId }) => accessDisabled.has(personId)).map(({ personId, row }) => ({
    recordNumber: row.recordNumber,
    sourceRecordKey: row.sourceRecordKey,
    error: {
      code: "DATA_PERSON_LINK_ACCESS_DISABLED" as const,
      field: "email",
      message: `A base pôs a pessoa ${personId} (matrícula ${row.matricula}) em outro Grupo ou num nível de liderança que o cadastro manual não tinha: o acesso dela foi desabilitado e as sessões caíram. Quem administra o lugar novo libera de novo em Usuários e acessos (Habilitar acesso), com uma senha temporária nova.`,
    },
  }))
}

/** Lugar de cada pessoa da carga ANTES de a carga escrever (Grupo, nível e gestor), por id da pessoa. */
export type PlacementBefore = ReadonlyMap<string, { teamId: string | null; role: string; reportsToId: string | null; active: boolean }>

export async function placementBefore(context: WriteContext, client: pg.PoolClient, matriculas: readonly string[]): Promise<PlacementBefore> {
  const result = await client.query<{ id: string; team_id: string | null; role: string; reports_to_id: string | null; active: boolean }>(
    `select id, team_id, role, reports_to_id, active from people where organization_id = $1 and matricula = any($2::text[])`,
    [context.organizationId, matriculas],
  )
  return new Map(result.rows.map((row) => [row.id, { teamId: row.team_id, role: row.role, reportsToId: row.reports_to_id, active: row.active }]))
}

/**
 * PRIMEIRA APLICAÇÃO DA BASE a uma pessoa cadastrada à mão (com Grupo e conta ativa; sem linhagem de `people`): a custódia da
 * credencial fica PENDENTE, com o lugar do cadastro manual guardado, até a carga que definir o lugar (`enforceSourceCustody`).
 * Vale para quem a carga liga ou assume E para quem ela só cita como gestor — de Colaboradores ou de Estrutura (h19 da 4ª
 * auditoria; a Estrutura como primeira carga ficava de fora — retestado pela preparação AppSec). Chamar ANTES de a carga escrever:
 * o lugar guardado é o de antes. Pendência que já existe não é trocada. Sem Grupo, quem cadastrou tinha a organização inteira.
 */
export async function markFirstApplicationCustody(context: WriteContext, client: pg.PoolClient, matriculas: readonly string[]): Promise<void> {
  if (matriculas.length === 0) return
  await client.query(
    `update people p set pending_custody_team_id = p.team_id, pending_custody_role = p.role
      where p.organization_id = $1 and p.matricula = any($2::text[]) and p.team_id is not null and p.pending_custody_team_id is null
        and exists (select 1 from user_accounts ua where ua.organization_id = $1 and ua.person_id = p.id and ua.active)
        and not exists (select 1 from data_lineage l where l.organization_id = $1 and l.entity_type = 'people' and l.entity_id = p.id)`,
    [context.organizationId, [...new Set(matriculas)]],
  )
}

const becomesLeader = (role: string, previous: string | null) => role !== "OPERATOR" && role !== previous

/**
 * CUSTÓDIA DEPOIS DE UMA CARGA QUE MEXE NO LUGAR DAS PESSOAS (Colaboradores e Estrutura organizacional; item h19 da 4ª auditoria).
 * A regra do AUTH-13 valia só no registro que ligava a pessoa, e só na carga de Colaboradores — Grupo é opcional nela, e a Estrutura
 * muda Grupo e gestor sem conferir nada. Depois que a carga escreveu:
 *  1. CUSTÓDIA PENDENTE (`markFirstApplicationCustody`): outro Grupo que o do cadastro manual, nível de liderança ou subordinado de outro
 *     Grupo = acesso desabilitado (como no AUTH-13) até quem administra o lugar novo liberar; a carga que define o MESMO Grupo
 *     confirma a custódia. Nos dois casos a pendência acaba.
 *  2. SENHA TEMPORÁRIA AINDA NÃO USADA, de qualquer pessoa: quem a gerou a conhece e a custódia dele era a do lugar antigo. Mudou de
 *     Grupo, virou liderança ou ganhou subordinado de outro Grupo = a senha temporária expira na hora e as sessões caem; quem
 *     administra o lugar novo gera outra. Transferência de quem já usa a própria senha não muda nada.
 */
export type SourceCustodyOutcome = { accessDisabled: Set<string>; temporaryRevoked: Set<string>; /** pessoa → matrícula do registro que mudou o lugar */ causes: Map<string, string> }

export async function enforceSourceCustody(context: WriteContext, client: pg.PoolClient, input: { matriculas: readonly string[]; groupDefined: ReadonlySet<string>; before: PlacementBefore }): Promise<SourceCustodyOutcome> {
  const org = context.organizationId
  const after = await client.query<{ id: string; matricula: string; team_id: string | null; role: string; reports_to_id: string | null; pending_custody_team_id: string | null; pending_custody_role: string | null }>(
    `select id, matricula, team_id, role, reports_to_id, pending_custody_team_id, pending_custody_role from people where organization_id = $1 and matricula = any($2::text[])`,
    [org, input.matriculas],
  )
  const managerIds = [...new Set(after.rows.flatMap((row) => (row.reports_to_id ? [row.reports_to_id] : [])))]
  const managers = managerIds.length > 0
    ? (await client.query<{ id: string; team_id: string | null; pending_custody_team_id: string | null }>(`select id, team_id, pending_custody_team_id from people where organization_id = $1 and id = any($2::uuid[])`, [org, managerIds])).rows
    : []
  const managerById = new Map(managers.map((manager) => [manager.id, manager]))

  const custody = new Set<string>()
  const confirmed = new Set<string>()
  const moved = new Set<string>()
  const causes = new Map<string, string>()
  const flag = (target: Set<string>, personId: string, matricula: string) => {
    target.add(personId)
    if (!causes.has(personId)) causes.set(personId, matricula)
  }
  for (const person of after.rows) {
    const manager = person.reports_to_id ? managerById.get(person.reports_to_id) : undefined
    const fromOtherGroup = (teamId: string | null) => Boolean(person.team_id && person.team_id !== teamId)
    if (person.pending_custody_team_id) {
      if (person.team_id !== person.pending_custody_team_id || becomesLeader(person.role, person.pending_custody_role)) flag(custody, person.id, person.matricula)
      else if (input.groupDefined.has(person.matricula)) confirmed.add(person.id)
    }
    if (manager?.pending_custody_team_id && fromOtherGroup(manager.pending_custody_team_id)) flag(custody, manager.id, person.matricula)
    const before = input.before.get(person.id)
    if (before && (before.teamId !== person.team_id || becomesLeader(person.role, before.role))) flag(moved, person.id, person.matricula)
    if (manager && (before?.reportsToId ?? null) !== person.reports_to_id && fromOtherGroup(manager.team_id)) flag(moved, manager.id, person.matricula)
  }

  const accessDisabled = new Set((await disableAccountsFromSource(context, client, [...custody], "LINKED_BY_SOURCE_NEW_PLACEMENT")).filter((entry) => entry.disabled).map((entry) => entry.personId))
  const settled = [...custody, ...confirmed]
  if (settled.length > 0) await client.query(`update people set pending_custody_team_id = null, pending_custody_role = null where organization_id = $1 and id = any($2::uuid[])`, [org, settled])

  const toRevoke = [...moved].filter((id) => !custody.has(id))
  const revoked = toRevoke.length > 0
    ? await client.query<{ person_id: string }>(
        `with revoked as (
           update user_accounts set temporary_password_expires_at = now(), session_version = session_version + 1, updated_at = now()
            where organization_id = $1 and person_id = any($2::uuid[]) and active and password_change_required and temporary_password_expires_at > now()
           returning id, person_id
         ), audited as (
           insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload)
           select $1, null, 'ACCESS_TEMPORARY_PASSWORD_REVOKED', 'user_account', id,
                  jsonb_build_object('personId', person_id, 'reason', 'PLACEMENT_CHANGED_BY_SOURCE', 'sessionsRevoked', true, 'runId', $3::text, 'feedId', $4::text)
             from revoked
         )
         select person_id from revoked`,
        [org, toRevoke, context.runId, context.feed.id],
      )
    : { rows: [] }
  return { accessDisabled, temporaryRevoked: new Set(revoked.rows.map((row) => row.person_id)), causes }
}

/** Aviso de quarentena, no registro que mudou o lugar, para cada pessoa cujo acesso a custódia pendente desabilitou. */
export function pendingCustodyWarnings(batch: readonly (ValidRecord & { matricula: string })[], outcome: SourceCustodyOutcome): ApplyWarning[] {
  const byMatricula = new Map(batch.map((row) => [row.matricula, row]))
  return [...outcome.accessDisabled].flatMap((personId) => {
    const row = byMatricula.get(outcome.causes.get(personId) ?? "")
    if (!row) return []
    return [{
      recordNumber: row.recordNumber,
      sourceRecordKey: row.sourceRecordKey,
      error: {
        code: "DATA_PERSON_LINK_ACCESS_DISABLED" as const,
        field: "groupExternalCode",
        message: `A base definiu para a pessoa ${personId}, cadastrada à mão, um lugar que o cadastro dela não tinha — outro Grupo, um nível de liderança ou subordinados de outro Grupo (registro da matrícula ${row.matricula}): o acesso dela foi desabilitado e as sessões caíram. Quem administra o lugar novo libera de novo em Usuários.`,
      },
    }]
  })
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
