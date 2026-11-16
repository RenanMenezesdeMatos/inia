import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"

type Queryable = Pick<Database, "query">

/** Uma sessão conhecida (`jti` do JWT) e o instante a perguntar. */
export type SessionAt = { jti: string; accountId: string | null; expiresAt: Date | null; at: Date }

/**
 * A SESSÃO JÁ TINHA TERMINADO NESTE INSTANTE? Mesmas regras do guard de sessão (`require-auth.ts` / `decideSession`), lidas do banco:
 * prazo absoluto do login (`exp`) vencido, logout desta sessão (`auth_revoked_sessions`), parada além do limite de inatividade
 * (`auth_session_activity`) ou conta desligada. Devolve os `jti` que terminaram. Uso: o Apoio com Anjo separa "a conexão caiu" de
 * "a sessão terminou" quando a área do Anjo para de dar sinal (migration 191). Revogação de TODAS as sessões (`session_version`) não
 * é vista aqui — cai como queda de conexão.
 */
export async function endedSessions(db: Queryable, sessions: readonly SessionAt[], idleTimeoutMs: number = env.sessionIdleTimeoutMs): Promise<Set<string>> {
  if (sessions.length === 0) return new Set()
  const ended = new Set(sessions.filter((session) => session.expiresAt !== null && session.expiresAt.getTime() <= session.at.getTime()).map((session) => session.jti))
  const jtis = sessions.map((session) => session.jti)
  const [revoked, activity, accounts] = await Promise.all([
    db.query<{ jti: string }>(`select jti from auth_revoked_sessions where jti = any($1::text[])`, [jtis]),
    idleTimeoutMs > 0 ? db.query<{ jti: string; last_activity_at: Date }>(`select jti, last_activity_at from auth_session_activity where jti = any($1::text[])`, [jtis]) : Promise.resolve({ rows: [] as { jti: string; last_activity_at: Date }[] }),
    db.query<{ id: string }>(`select id from user_accounts where id = any($1::uuid[]) and (not active or access_disabled_at is not null)`, [sessions.flatMap((session) => (session.accountId ? [session.accountId] : []))]),
  ])
  for (const row of revoked.rows) ended.add(row.jti)
  const lastActivity = new Map(activity.rows.map((row) => [row.jti, row.last_activity_at.getTime()]))
  const disabled = new Set(accounts.rows.map((row) => row.id))
  for (const session of sessions) {
    const last = lastActivity.get(session.jti)
    if (last !== undefined && last + idleTimeoutMs <= session.at.getTime()) ended.add(session.jti)
    if (session.accountId && disabled.has(session.accountId)) ended.add(session.jti)
  }
  return ended
}
