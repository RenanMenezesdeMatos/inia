import type { Database } from "../../../infrastructure/database/pool.js"
import { networkIdentifier } from "../application/authenticate-network.js"
import { directoryAccountIdentifier } from "../application/directory-gate.js"
import type { LoginAttemptOutcome } from "../application/credential-store.js"
import type { NetworkAttemptsReader } from "../application/network-attempts.js"
import { isLoginAttemptReason, UNREACHED_DIRECTORY_REASONS } from "../domain/login-attempt.js"
import { env } from "../../../config/env.js"
import { directoryLimits, fullLoginsBehind, NETWORK_LOGIN_LOOKBACK_HOURS, NETWORK_LOGIN_LOOKBACK_LIMIT, NETWORK_LOGIN_MAX_FAILURES, networkLoginThrottle, parseShortLoginFormats, shortNetworkLoginOf } from "../domain/network-login.js"
import { loginIdentifierHash } from "./postgres-credential-store.js"

type Queryable = Pick<Database, "query">
type SummaryRow = { identifier_hash: string; failures: (Date | string)[] | null; last_at: Date | null; last_outcome: LoginAttemptOutcome | null; last_reason: string | null; last_code: string | null }

/**
 * Reserva sem conta e sem motivo mais nova que isto pode estar EM ANDAMENTO e não é mexida por `releaseUnreached`. Um envio lento (dois
 * logins, leitura da ID, vários servidores) pode passar deste prazo, sem efeito: o resultado regrava a própria reserva (`resolveAttempt`).
 */
const IN_FLIGHT_SECONDS = 60

export function createPostgresNetworkAttempts(db: Queryable, shortLoginFormats = parseShortLoginFormats(env.AD_LOGIN_WITHOUT_LAST_DIGIT)): NetworkAttemptsReader {
  const hashOf = (normalized: string) => loginIdentifierHash(networkIdentifier(normalized))
  /** Limites que barram este login — os MESMOS do portão: a trava da matrícula e os da conta do AD (`directoryLimits`). */
  const countersOf = (normalized: string, provenLogin: string | null) => {
    const { whole, cut } = directoryLimits({ networkLogin: normalized, shortLogin: shortNetworkLoginOf(normalized, shortLoginFormats), fullLogins: fullLoginsBehind(normalized, shortLoginFormats), provenLogin })
    return [
      { hashes: [hashOf(normalized)], max: NETWORK_LOGIN_MAX_FAILURES },
      ...[...(whole ?? []), ...(cut ?? [])].map((limit) => ({ hashes: limit.logins.map((login) => loginIdentifierHash(directoryAccountIdentifier(login))), max: limit.max })),
    ]
  }
  /** Por qual login do AD cada matrícula do formato da instalação já entrou: só a conta que o login usaria, e só um valor desta matrícula. */
  const provenLogins = async (logins: readonly string[]) => {
    const asked = logins.filter((login) => shortNetworkLoginOf(login, shortLoginFormats) !== null)
    if (asked.length === 0) return new Map<string, string>()
    const result = await db.query<{ matricula: string; directory_login: string }>(
      `select upper(btrim(p.matricula)) matricula, ua.directory_login from people p
         join user_accounts ua on ua.person_id = p.id and ua.active
         join organizations o on o.id = ua.organization_id and o.network_login_enabled
        where p.active and p.matricula is not null and upper(btrim(p.matricula)) = any($1::text[]) and ua.directory_login is not null`,
      [asked],
    )
    return new Map(result.rows.filter((row) => row.directory_login === row.matricula || row.directory_login === shortNetworkLoginOf(row.matricula, shortLoginFormats)).map((row) => [row.matricula, row.directory_login]))
  }
  return {
    async summaries(normalized, now) {
      const logins = [...new Set(normalized)]
      if (logins.length === 0) return new Map()
      const proven = await provenLogins(logins)
      const hashes = [...new Set(logins.flatMap((login) => countersOf(login, proven.get(login) ?? null).flatMap((counter) => counter.hashes)))]
      const since = new Date(now.getTime() - NETWORK_LOGIN_LOOKBACK_HOURS * 3_600_000)
      const result = await db.query<SummaryRow>(
        `select h.identifier_hash, failed.failures, last.attempted_at last_at, last.outcome last_outcome, last.reason last_reason, last.directory_code last_code
           from unnest($1::text[]) h(identifier_hash)
           left join lateral (
             select array_agg(recent.attempted_at) failures from (
               select a.attempted_at from auth_login_attempts a
                where a.identifier_hash = h.identifier_hash and a.outcome = 'INVALID_CREDENTIALS' and a.attempted_at > $2
                  and a.attempted_at > coalesce((select max(s.attempted_at) from auth_login_attempts s where s.identifier_hash = h.identifier_hash and s.outcome = 'SUCCEEDED'), '-infinity'::timestamptz)
                order by a.attempted_at desc limit $3
             ) recent
           ) failed on true
           left join lateral (
             select a.attempted_at, a.outcome, a.reason, a.directory_code from auth_login_attempts a
              where a.identifier_hash = h.identifier_hash and (a.outcome <> 'LOCKED' or a.reason in ('NETWORK_UNAVAILABLE', 'NETWORK_IDENTITY_UNREADABLE'))
              order by a.attempted_at desc, a.id desc limit 1
           ) last on true`,
        [hashes, since, NETWORK_LOGIN_LOOKBACK_LIMIT],
      )
      const byHash = new Map(result.rows.map((row) => [row.identifier_hash, row]))
      return new Map(
        logins.flatMap((login) => {
          const row = byHash.get(hashOf(login))
          const locks = countersOf(login, proven.get(login) ?? null).flatMap((counter) => {
            const throttle = networkLoginThrottle(counter.hashes.flatMap((hash) => byHash.get(hash)?.failures ?? []).map((at) => new Date(at)), now, counter.max)
            return throttle.locked ? [throttle.retryAt.getTime()] : []
          })
          if (!row?.last_at && locks.length === 0) return []
          return [[
            login,
            {
              lockedUntil: locks.length > 0 ? new Date(Math.max(...locks)) : null,
              last: row?.last_at ? { at: new Date(row.last_at), outcome: row.last_outcome!, reason: isLoginAttemptReason(row.last_reason) ? row.last_reason : null, directoryCode: row.last_code } : null,
            },
          ] as const]
        }),
      )
    },

    async releaseUnreached(normalized, now) {
      const hashes = [...new Set(normalized)].map(hashOf)
      if (hashes.length === 0) return
      await db.query(
        `update auth_login_attempts set outcome = 'ACCESS_DISABLED'
          where identifier_hash = any($1::text[]) and outcome = 'INVALID_CREDENTIALS' and account_id is null and attempted_at > $2
            and (reason = any($3::text[]) or (reason is null and attempted_at < $4))`,
        [hashes, new Date(now.getTime() - NETWORK_LOGIN_LOOKBACK_HOURS * 3_600_000), UNREACHED_DIRECTORY_REASONS, new Date(now.getTime() - IN_FLIGHT_SECONDS * 1000)],
      )
    },
  }
}
