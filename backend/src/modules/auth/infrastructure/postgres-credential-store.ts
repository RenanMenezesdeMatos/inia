import { createHmac } from "node:crypto"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { CredentialStore, LoginAccount, PasswordState } from "../application/credential-store.js"
import type { SessionAccountState } from "../domain/session-state.js"
import type { PlatformRole } from "./jwt.js"

type Queryable = Pick<Database, "query">

/** Identificador de login normalizado sob HMAC (chave fora do banco): a trava funciona sem guardar o que foi digitado. */
export function loginIdentifierHash(login: string): string {
  return createHmac("sha256", env.JWT_SECRET).update(`login:${login.trim().toLowerCase()}`).digest("hex")
}

type SessionRow = { active: boolean; person_active?: boolean | null; session_version?: number | null; password_change_required?: boolean | null; temporary_password_expires_at?: Date | string | null }
const toDate = (value: Date | string | null | undefined) => (value === null || value === undefined ? null : value instanceof Date ? value : new Date(value))
// Conta habilitada E pessoa ativa no cadastro (achado U-F9): quem foi desligado pela Central de Dados perde o acesso na hora,
// mesmo antes de alguém desabilitar a conta.
const toSessionState = (row: SessionRow): SessionAccountState => ({
  active: row.active === true && row.person_active !== false,
  sessionVersion: row.session_version ?? 0,
  passwordChangeRequired: row.password_change_required === true,
  temporaryPasswordExpiresAt: toDate(row.temporary_password_expires_at),
})
const SESSION_COLUMNS = "ua.active, ua.session_version, ua.password_change_required, ua.temporary_password_expires_at, (select pa.active from people pa where pa.id = ua.person_id) person_active"

type LoginRow = SessionRow & { id: string; organization_id: string; person_id: string; name: string; role: PlatformRole; email: string; password_hash: string; avatar_url: string | null; job_title: string | null; team_id: string | null; team_name: string | null }

export function createPostgresCredentialStore(db: Queryable): CredentialStore {
  return {
    async findByLogin(login) {
      const result = await db.query<LoginRow>(
        `select ua.id, ua.organization_id, p.id person_id, p.name, p.role, ua.email, ua.password_hash, ${SESSION_COLUMNS},
                p.avatar_url, p.job_title, p.team_id, t.name team_name
         from user_accounts ua
         join people p on p.id = ua.person_id
         left join teams t on t.id = p.team_id
         where lower(ua.email) = lower($1)`,
        [login.trim()],
      )
      const row = result.rows[0]
      if (!row) return null
      const account: LoginAccount = {
        ...toSessionState(row),
        id: row.id, organizationId: row.organization_id, personId: row.person_id, name: row.name, role: row.role, email: row.email, passwordHash: row.password_hash,
        avatarUrl: row.avatar_url ?? null, jobTitle: row.job_title ?? null, teamId: row.team_id ?? null, teamName: row.team_name ?? null,
      }
      return account
    },

    async sessionState(organizationId, accountId, sessionId) {
      const result = await db.query<SessionRow & { session_revoked?: boolean | null; person_role?: PlatformRole | null }>(
        `select ${SESSION_COLUMNS}, (select pr.role from people pr where pr.id = ua.person_id) person_role,
                exists (select 1 from auth_revoked_sessions r where r.jti = $3 and r.account_id = ua.id) session_revoked
         from user_accounts ua where ua.id = $1 and ua.organization_id = $2`,
        [accountId, organizationId, sessionId ?? null],
      )
      const row = result.rows[0]
      if (!row) return null
      // Nível hierárquico ATUAL (não o do login): promoção/rebaixamento vale na próxima request (achado U-F2).
      const state = { ...toSessionState(row), ...(row.person_role ? { role: row.person_role } : {}) }
      // Sessão encerrada no logout = mesma resposta de conta sem sessão válida (o guard derruba e apaga o cookie).
      return row.session_revoked === true ? { ...state, active: false } : state
    },

    async revokeSession({ organizationId, accountId, sessionId, expiresAt, at }) {
      await db.query(
        `insert into auth_revoked_sessions (jti, account_id, expires_at, revoked_at)
         select $1, ua.id, $3, $4 from user_accounts ua where ua.id = $2 and ua.organization_id = $5
         on conflict (jti) do nothing`,
        [sessionId, accountId, expiresAt, at, organizationId],
      )
      await db.query(`delete from auth_revoked_sessions where expires_at < $1`, [at])
    },

    async recentFailures(identifierHash, since) {
      const result = await db.query<{ attempted_at: Date }>(
        `select attempted_at from auth_login_attempts
         where identifier_hash = $1 and outcome = 'INVALID_CREDENTIALS' and attempted_at > $2
           and attempted_at > coalesce((select max(attempted_at) from auth_login_attempts where identifier_hash = $1 and outcome = 'SUCCEEDED'), '-infinity'::timestamptz)
         order by attempted_at`,
        [identifierHash, since],
      )
      return result.rows.map((row) => toDate(row.attempted_at)!)
    },

    async recordAttempt({ identifierHash, accountId, outcome, at }) {
      await db.query(`insert into auth_login_attempts (identifier_hash, account_id, outcome, attempted_at) values ($1, $2, $3, $4)`, [identifierHash, accountId, outcome, at])
    },

    async markLoggedIn({ accountId, identifierHash, at }) {
      await db.query(`update user_accounts set last_login_at = $2 where id = $1`, [accountId, at])
      // Tentativas antigas não servem mais à trava (janela de minutos): o histórico fica 30 dias.
      await db.query(`delete from auth_login_attempts where identifier_hash = $1 and attempted_at < $2::timestamptz - interval '30 days'`, [identifierHash, at])
    },

    async passwordState(organizationId, accountId) {
      const result = await db.query<SessionRow & { email: string; password_hash: string }>(
        `select ua.email, ua.password_hash, ${SESSION_COLUMNS} from user_accounts ua where ua.id = $1 and ua.organization_id = $2`,
        [accountId, organizationId],
      )
      const row = result.rows[0]
      if (!row) return null
      const state: PasswordState = { ...toSessionState(row), email: row.email, passwordHash: row.password_hash }
      return state
    },

    async completePasswordChange({ organizationId, accountId, actorPersonId, expectedSessionVersion, passwordHash, at }) {
      const result = await db.query<{ session_version: number }>(
        `with changed as (
           update user_accounts
              set password_hash = $4, password_change_required = false, temporary_password_issued_at = null, temporary_password_expires_at = null,
                  password_changed_at = $5, session_version = session_version + 1, updated_at = $5
            where id = $1 and organization_id = $2 and active and password_change_required and session_version = $3
            returning id, session_version
         ), audited as (
           insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at)
           select $2, $6, 'ACCESS_PASSWORD_DEFINED', 'user_account', changed.id, jsonb_build_object('reason', 'FIRST_ACCESS', 'sessionsRevoked', true), $5 from changed
         )
         select session_version from changed`,
        [accountId, organizationId, expectedSessionVersion, passwordHash, at, actorPersonId],
      )
      const row = result.rows[0]
      return row ? { sessionVersion: row.session_version } : null
    },
  }
}
