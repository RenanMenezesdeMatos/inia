import type { Database } from "../../../infrastructure/database/pool.js"
import type { RateLimitDecision, RateLimitStore } from "../../application/rate-limit/rate-limit-store.js"

/**
 * LIMITES DE REQUISIÇÃO NO POSTGRESQL (migration 126) — o mesmo contador para todos os processos de API. Cada decisão é UMA
 * instrução: o relógio é o do BANCO (`clock_timestamp()`, igual para todas as máquinas), a janela anterior entra ponderada e o
 * incremento só acontece se ainda couber — a condição do `on conflict … where` é avaliada com a linha travada, então duas
 * requisições simultâneas na última vaga nunca passam as duas.
 *
 * Linhas vencidas (`expires_at` = fim da janela seguinte, quando ela deixa de ser "anterior") saem por `purgeExpiredRateLimitHits`,
 * chamada pela tarefa periódica do processamento.
 */
const WINDOW = `
  with w as (
    select now_ms, floor(now_ms / $2::float8)::bigint as idx
    from (select (extract(epoch from clock_timestamp()) * 1000)::float8 as now_ms) c
  ), prev as (
    select w.now_ms, w.idx,
      coalesce((select h.hits from rate_limit_hits h where h.bucket = $1 and h.window_index = w.idx - 1), 0)
        * greatest(0, 1 - (w.now_ms - w.idx * $2::float8) / $2::float8) as weighted
    from w
  )`

const CONSUME_SQL = `${WINDOW}, bumped as (
    insert into rate_limit_hits as h (bucket, window_index, hits, expires_at)
    select $1, prev.idx, 1, to_timestamp((prev.idx + 2) * $2::float8 / 1000) from prev where prev.weighted < $3::float8
    on conflict (bucket, window_index) do update set hits = h.hits + 1
      where h.hits + (select weighted from prev) < $3::float8
    returning h.hits
  )
  select (select count(*) from bumped) > 0 as allowed, ((prev.idx + 1) * $2::float8 - prev.now_ms)::float8 as "retryAfterMs" from prev`

const CHECK_SQL = `${WINDOW}
  select coalesce((select h.hits from rate_limit_hits h where h.bucket = $1 and h.window_index = prev.idx), 0) + prev.weighted < $3::float8 as allowed,
    ((prev.idx + 1) * $2::float8 - prev.now_ms)::float8 as "retryAfterMs"
  from prev`

const RECORD_SQL = `
  insert into rate_limit_hits as h (bucket, window_index, hits, expires_at)
  select $1, w.idx, 1, to_timestamp((w.idx + 2) * $2::float8 / 1000)
  from (select floor((extract(epoch from clock_timestamp()) * 1000)::float8 / $2::float8)::bigint as idx) w
  on conflict (bucket, window_index) do update set hits = h.hits + 1`

export function createPostgresRateLimitStore(db: Pick<Database, "query">): RateLimitStore {
  const decide = async (sql: string, bucket: string, windowMs: number, max: number): Promise<RateLimitDecision> => {
    const result = await db.query<{ allowed: boolean; retryAfterMs: number }>(sql, [bucket, windowMs, max])
    const row = result.rows[0]
    return { allowed: row?.allowed === true, retryAfterMs: Math.max(0, Number(row?.retryAfterMs ?? windowMs)) }
  }
  return {
    consume: (bucket, windowMs, max) => decide(CONSUME_SQL, bucket, windowMs, max),
    check: (bucket, windowMs, max) => decide(CHECK_SQL, bucket, windowMs, max),
    async record(bucket, windowMs) {
      await db.query(RECORD_SQL, [bucket, windowMs])
    },
  }
}

/** Apaga as janelas que já não contam para nada (tarefa periódica do processamento). */
export async function purgeExpiredRateLimitHits(db: Pick<Database, "query">): Promise<number> {
  const result = await db.query(`delete from rate_limit_hits where expires_at < now()`)
  return result.rowCount ?? 0
}
