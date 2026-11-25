import type { Database } from "../../../infrastructure/database/pool.js"
import type { NetworkLoginRepository } from "../application/network-login-settings.js"

type Queryable = Pick<Database, "query">

/** Quantas matrículas repetidas a tela lista (o PUT recusa com qualquer uma). */
const AMBIGUOUS_LIMIT = 50

/** SQL do interruptor do login pela rede (application/network-login-settings.ts). */
export function createPostgresNetworkLoginRepository(db: Queryable): NetworkLoginRepository {
  return {
    async anyOrganizationEnabled() {
      return (await db.query<{ on: boolean }>(`select exists (select 1 from organizations where network_login_enabled) "on"`)).rows[0]?.on === true
    },

    async credentialModeOf(accountId) {
      const result = await db.query<{ network: boolean }>(
        `select (o.network_login_enabled and not ua.emergency_local_access) network from user_accounts ua join organizations o on o.id = ua.organization_id where ua.id = $1`,
        [accountId],
      )
      return result.rows[0]?.network === true ? "NETWORK" : "LOCAL"
    },

    async organizationSwitch(organizationId) {
      const row = (
        await db.query<{ network_login_enabled: boolean; network_login_changed_at: Date | null; changed_by: string | null }>(
          `select o.network_login_enabled, o.network_login_changed_at, p.name changed_by from organizations o left join people p on p.id = o.network_login_changed_by where o.id = $1`,
          [organizationId],
        )
      ).rows[0]
      return row ? { enabled: row.network_login_enabled === true, changedAt: row.network_login_changed_at ? new Date(row.network_login_changed_at) : null, changedBy: row.changed_by ?? null } : null
    },

    async emergencyAccounts(organizationId) {
      const result = await db.query<{ account_id: string; name: string; email: string; active: boolean; last_login_at: Date | null }>(
        `select ua.id account_id, p.name, ua.email, (ua.active and p.active) active, ua.last_login_at
           from user_accounts ua join people p on p.id = ua.person_id
          where ua.organization_id = $1 and ua.emergency_local_access
          order by p.name`,
        [organizationId],
      )
      return result.rows.map((row) => ({ accountId: row.account_id, name: row.name, email: row.email, active: row.active, lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null }))
    },

    async ambiguousMatriculas(organizationId) {
      // A MESMA comparação do login (`findByNetworkLogin`: `upper(btrim(p.matricula))` e só contas que podem entrar — a repetida
      // desabilitada não tranca ninguém). O índice de expressão sobre `upper(btrim(matricula))` vem na migration 248.
      const result = await db.query<{ matricula: string; accounts: string | number }>(
        `select upper(btrim(p.matricula)) matricula, count(*) accounts
           from user_accounts ua join people p on p.id = ua.person_id
          where ua.organization_id = $1 and ua.active and p.active and p.matricula is not null and btrim(p.matricula) <> ''
          group by upper(btrim(p.matricula))
         having count(*) > 1
          order by 1
          limit ${AMBIGUOUS_LIMIT}`,
        [organizationId],
      )
      return result.rows.map((row) => ({ matricula: row.matricula, accounts: Number(row.accounts) }))
    },

    async setEnabled({ organizationId, enabled, at, actorPersonId }) {
      await db.query(
        `with changed as (
           update organizations set network_login_enabled = $2, network_login_changed_at = $3, network_login_changed_by = $4
            where id = $1 and network_login_enabled is distinct from $2 returning id
         )
         insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at)
         select $1, $4, 'ACCESS_NETWORK_LOGIN_CHANGED', 'organization', changed.id, jsonb_build_object('enabled', $2::boolean), $3 from changed`,
        [organizationId, enabled, at, actorPersonId],
      )
    },
  }
}
