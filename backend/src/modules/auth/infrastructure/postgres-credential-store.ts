import { createHmac } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { CredentialStore, LoginAccount, PasswordState } from "../application/credential-store.js"
import type { SessionAccountState } from "../domain/session-state.js"
import { derivedKey } from "./derived-keys.js"
import type { PlatformRole } from "./jwt.js"

type Queryable = Pick<Database, "query">

/** Identificador de login normalizado sob HMAC (chave derivada, fora do banco): a trava funciona sem guardar o que foi digitado. */
export function loginIdentifierHash(login: string): string {
  return createHmac("sha256", derivedKey("login-identifier")).update(`login:${login.trim().toLowerCase()}`).digest("hex")
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
      const result = await db.query<SessionRow & { session_revoked?: boolean | null; person_role?: PlatformRole | null; last_activity_at?: Date | string | null }>(
        `select ${SESSION_COLUMNS}, (select pr.role from people pr where pr.id = ua.person_id) person_role,
                exists (select 1 from auth_revoked_sessions r where r.jti = $3 and r.account_id = ua.id) session_revoked,
                (select a.last_activity_at from auth_session_activity a where a.jti = $3 and a.account_id = ua.id) last_activity_at
         from user_accounts ua where ua.id = $1 and ua.organization_id = $2`,
        [accountId, organizationId, sessionId ?? null],
      )
      const row = result.rows[0]
      if (!row) return null
      // Nível hierárquico ATUAL (não o do login): promoção/rebaixamento vale na próxima request (achado U-F2).
      const state = { ...toSessionState(row), lastActivityAt: toDate(row.last_activity_at), ...(row.person_role ? { role: row.person_role } : {}) }
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
      await db.query(`delete from auth_session_activity where jti = $1 and account_id = $2`, [sessionId, accountId])
    },

    async recordSessionActivity({ accountId, sessionId, expiresAt, at }) {
      // Nunca volta no tempo (duas requisições fora de ordem) e nunca recria a sessão de uma conta que não existe mais.
      await db.query(
        `insert into auth_session_activity (jti, account_id, last_activity_at, expires_at)
         select $1, ua.id, $3, $4 from user_accounts ua where ua.id = $2
         on conflict (jti) do update set last_activity_at = greatest(auth_session_activity.last_activity_at, excluded.last_activity_at)
         where auth_session_activity.account_id = excluded.account_id`,
        [sessionId, accountId, at, expiresAt],
      )
    },

    async endAllSessions({ organizationId, accountId, actorPersonId, at }) {
      const result = await db.query(
        `with ended as (
           update user_accounts set session_version = session_version + 1, updated_at = $3
            where id = $1 and organization_id = $2
            returning id
         ), audited as (
           insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at)
           select $2, $4, 'ACCESS_SESSIONS_ENDED_BY_OWNER', 'user_account', ended.id, jsonb_build_object('reason', 'SIGN_OUT_EVERYWHERE'), $3 from ended
         )
         select id from ended`,
        [accountId, organizationId, at, actorPersonId],
      )
      if ((result.rowCount ?? 0) === 0) return false
      await db.query(`delete from auth_session_activity where account_id = $1`, [accountId])
      return true
    },

    // Reserva = linha já gravada (autocommit) como falha: quem contar depois a enxerga. Para N tentativas simultâneas, a última a
    // contar vê as reservas de todas — no máximo LOGIN_MAX_FAILURES chegam ao bcrypt, sem trava nem transação.
    async reserveAttempt({ identifierHash, at }) {
      const result = await db.query<{ id: string | number }>(
        `insert into auth_login_attempts (identifier_hash, account_id, outcome, attempted_at) values ($1, null, 'INVALID_CREDENTIALS', $2) returning id`,
        [identifierHash, at],
      )
      const id = result.rows[0]?.id
      return id === undefined || id === null ? null : String(id)
    },

    async recentFailures(identifierHash, since, excludeAttemptId = null) {
      const result = await db.query<{ attempted_at: Date }>(
        `select attempted_at from auth_login_attempts
         where identifier_hash = $1 and outcome = 'INVALID_CREDENTIALS' and attempted_at > $2
           and ($3::bigint is null or id <> $3::bigint)
           and attempted_at > coalesce((select max(attempted_at) from auth_login_attempts where identifier_hash = $1 and outcome = 'SUCCEEDED'), '-infinity'::timestamptz)
         order by attempted_at`,
        [identifierHash, since, excludeAttemptId],
      )
      return result.rows.map((row) => toDate(row.attempted_at)!)
    },

    async resolveAttempt({ attemptId, identifierHash, accountId, outcome, at }) {
      if (attemptId !== null) {
        const updated = await db.query(`update auth_login_attempts set outcome = $2, account_id = $3 where id = $1::bigint and identifier_hash = $4`, [attemptId, outcome, accountId, identifierHash])
        if ((updated.rowCount ?? 0) > 0) return
      }
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

/**
 * Retenção das tentativas de login: a trava olha 15 minutos; o histórico de 30 dias serve à auditoria (achado AUTH-15). Na
 * mesma rodada saem as atividades de sessão de tokens já vencidos (migration 149) — elas só importam até o `exp`.
 */
export async function purgeOldLoginAttempts(db: Queryable, retentionDays = 30): Promise<number> {
  const result = await db.query(`delete from auth_login_attempts where attempted_at < now() - make_interval(days => $1::int)`, [retentionDays])
  const sessions = await db.query(`delete from auth_session_activity where expires_at < now()`)
  return (result.rowCount ?? 0) + (sessions.rowCount ?? 0)
}
