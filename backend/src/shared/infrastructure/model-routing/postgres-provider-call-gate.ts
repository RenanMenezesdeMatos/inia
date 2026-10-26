import { randomUUID } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"
import { AiCallCancelledError } from "../../application/model-routing/ai-errors.js"
import { AiCapacityBusyError } from "../../application/model-routing/ai-call-limiter.js"
import { batchShareOf, cooldownMsOf, gateSignalOf, type ProviderCallGate, type ProviderGateCall, type ProviderGateStats } from "../../application/model-routing/provider-call-gate.js"
import { createAdaptiveBatchWindow, type AdaptiveBatchWindow } from "../../application/model-routing/adaptive-batch-window.js"

/**
 * PORTÃO POR CONEXÃO NO POSTGRESQL (migrations 127 e 137) — o mesmo estado para todas as instâncias:
 *
 *  - pausa: `ai_provider_cooldowns` (uma linha por chave, fim no relógio do BANCO, só estende); cada processo lê as pausas em
 *    vigor a cada `pollIntervalMs` e converte pelo relógio do banco (relógios diferentes entre máquinas não importam);
 *  - vagas: `ai_call_slot_leases` (UNLOGGED) — uma linha por vaga em uso, com prazo renovado enquanto a chamada roda. Pegar uma
 *    vaga é UMA instrução: conta as vagas vivas, respeita a parte do lote e grava na menor vaga livre; duas instâncias na
 *    mesma vaga → uma grava, a outra tenta de novo (nunca passam do teto). Processo que morre solta a vaga no fim do prazo.
 *
 * Banco fora: a chamada segue sem vaga compartilhada (aviso no log, no máximo um por minuto) — o portão nunca derruba a IA.
 */
const ACQUIRE_SQL = `
  with live as (
    select slot, priority from ai_call_slot_leases where key = $1 and expires_at > clock_timestamp()
  ), counts as (
    select count(*)::int as total, count(*) filter (where priority = 'BATCH')::int as batch from live
  ), free as (
    select s as slot from generate_series(1, $2::int) s where s not in (select slot from live) order by s limit 1
  )
  insert into ai_call_slot_leases as l (key, slot, priority, holder, expires_at)
  select $1, free.slot, $4, $5, clock_timestamp() + ($6::double precision * interval '1 millisecond')
    from free, counts
   where counts.total < $2::int and ($4 = 'INTERACTIVE' or counts.batch < $3::int)
  on conflict (key, slot) do update set priority = excluded.priority, holder = excluded.holder, expires_at = excluded.expires_at
    where l.expires_at <= clock_timestamp()
  returning slot`

export type PostgresProviderCallGateOptions = {
  /** Quem pede (papel, máquina, pid) — vai para as linhas, só para diagnóstico. */
  source: string
  /** Leitura das pausas em vigor. */
  pollIntervalMs?: number
  /** Prazo de uma vaga sem renovação (renovada a cada terço disso enquanto a chamada roda). */
  leaseMs?: number
  /** Intervalo (com variação) entre tentativas de pegar vaga. */
  slotPollMs?: number
  /** Quanto a interativa espera por vaga antes de AI_CAPACITY_BUSY. */
  interactiveWaitMs?: number
  /** Vazão adaptativa do lote por chave (testes injetam uma sem timer). */
  batchWindow?: AdaptiveBatchWindow
}

export type PostgresProviderCallGate = ProviderCallGate & {
  /** Lê as pausas em vigor agora (o timer faz isso sozinho; a prova usa direto). */
  refresh(): Promise<void>
  stop(): void
}

const WARNING_INTERVAL_MS = 60_000

export function createPostgresProviderCallGate(db: Pick<Database, "query">, options: PostgresProviderCallGateOptions): PostgresProviderCallGate {
  const pollIntervalMs = options.pollIntervalMs ?? 2_000
  const leaseMs = options.leaseMs ?? 60_000
  const slotPollMs = options.slotPollMs ?? 250
  const interactiveWaitMs = options.interactiveWaitMs ?? 20_000
  /** Fim de cada pausa no relógio LOCAL (convertido a partir do restante no relógio do banco). */
  const cooldowns = new Map<string, number>()
  const held = new Map<string, number>()
  const waiting = new Map<string, number>()
  const lastWarning = new Map<string, number>()

  const warn = (event: string, error: unknown) => {
    const now = Date.now()
    if ((lastWarning.get(event) ?? 0) > now - WARNING_INTERVAL_MS) return
    lastWarning.set(event, now)
    console.warn(JSON.stringify({ event, message: error instanceof Error ? error.message : String(error) }))
  }
  const bump = (map: Map<string, number>, key: string, delta: number) => {
    const next = (map.get(key) ?? 0) + delta
    if (next <= 0) map.delete(key)
    else map.set(key, next)
  }
  const extendCooldown = (key: string, remainingMs: number) => {
    const until = Date.now() + remainingMs
    if (until > (cooldowns.get(key) ?? 0)) cooldowns.set(key, until)
  }
  const cooldownRemainingMs = (key: string) => Math.max(0, (cooldowns.get(key) ?? 0) - Date.now())
  // Saturação de uma conexão (429/503 aqui ou em outra instância) reduz o lote DESTE processo nela; a calma o devolve aos poucos.
  const batchWindow = options.batchWindow ?? createAdaptiveBatchWindow()

  async function refresh(): Promise<void> {
    const result = await db.query<{ scope: string; remainingMs: number; interactive: boolean }>(
      `select scope, (extract(epoch from (paused_until - clock_timestamp())) * 1000)::float8 as "remainingMs", coalesce(source like '%· INTERACTIVE', false) as interactive from ai_provider_cooldowns where paused_until > clock_timestamp()`,
    )
    for (const row of result.rows) {
      // Pausa nova ou estendida por OUTRA instância = a conexão saturou de novo: o lote daqui também desacelera (mais, se foi o chat).
      const before = cooldowns.get(row.scope) ?? 0
      extendCooldown(row.scope, Number(row.remainingMs))
      if ((cooldowns.get(row.scope) ?? 0) > before + 500) batchWindow.congestion(row.scope, { interactive: row.interactive })
    }
    for (const [key, until] of cooldowns) if (until <= Date.now()) cooldowns.delete(key)
  }
  const timer = setInterval(() => {
    refresh().catch((error: unknown) => warn("ai_provider_cooldown_read_failed", error))
  }, pollIntervalMs)
  timer.unref?.()

  /** Grava a pausa antes de o erro voltar a quem chamou: quando o 429 aparece aqui, as outras instâncias já podem vê-la. */
  async function publish(key: string, pauseMs: number, kind: string, priority: string): Promise<void> {
    extendCooldown(key, pauseMs)
    await db.query(
      `insert into ai_provider_cooldowns (scope, paused_until, reason, source, updated_at)
       values ($1, clock_timestamp() + ($2::double precision * interval '1 millisecond'), $3, $4, now())
       on conflict (scope) do update set paused_until = excluded.paused_until, reason = excluded.reason, source = excluded.source, updated_at = excluded.updated_at
        where ai_provider_cooldowns.paused_until < excluded.paused_until`,
      [key, Math.round(pauseMs), kind, `${options.source} · ${priority}`],
    ).catch((error: unknown) => warn("ai_provider_cooldown_publish_failed", error))
  }

  const sleep = (ms: number, signal: AbortSignal | undefined) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new AiCallCancelledError())
      const onAbort = () => {
        clearTimeout(handle)
        reject(new AiCallCancelledError())
      }
      const handle = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort)
        resolve()
      }, ms)
      signal?.addEventListener("abort", onAbort, { once: true })
    })

  /** Lote espera a pausa da chave acabar (ela pode ser estendida enquanto espera); interativa nunca espera. */
  async function waitCooldown(call: ProviderGateCall): Promise<void> {
    if (call.priority !== "BATCH") return
    for (let remaining = cooldownRemainingMs(call.key); remaining > 0; remaining = cooldownRemainingMs(call.key)) await sleep(Math.min(remaining, 1_000), call.signal)
  }

  async function acquire(call: ProviderGateCall, max: number): Promise<{ slot: number; holder: string } | null> {
    const holder = `${options.source}:${randomUUID()}`
    const startedAt = Date.now()
    for (;;) {
      if (call.signal?.aborted) throw new AiCallCancelledError()
      let slot: number | null
      try {
        const result = await db.query<{ slot: number }>(ACQUIRE_SQL, [call.key, max, batchShareOf(max), call.priority, holder, leaseMs])
        slot = result.rows[0]?.slot ?? null
      } catch (error) {
        // Banco fora: segue sem vaga compartilhada (o limitador do processo continua valendo).
        warn("ai_call_slot_unavailable", error)
        return null
      }
      if (slot !== null) {
        const waitedMs = Date.now() - startedAt
        if (waitedMs >= 250) console.info(JSON.stringify({ event: "ai_call_slot_waited", key: call.key, priority: call.priority, waitedMs }))
        return { slot, holder }
      }
      const waitedMs = Date.now() - startedAt
      if (call.priority === "INTERACTIVE" && waitedMs >= interactiveWaitMs) throw new AiCapacityBusyError(waitedMs)
      await sleep(Math.round(slotPollMs * (0.5 + Math.random())), call.signal)
    }
  }

  return {
    cooldownRemainingMs,
    refresh,
    stop() {
      clearInterval(timer)
      batchWindow.stop()
    },
    stats(): ProviderGateStats {
      const now = Date.now()
      return {
        held: Object.fromEntries(held),
        waiting: Object.fromEntries(waiting),
        cooldowns: Object.fromEntries([...cooldowns].filter(([, until]) => until > now).map(([key, until]) => [key, new Date(until).toISOString()])),
        batchWindows: batchWindow.stats(),
      }
    },
    async run<T>(call: ProviderGateCall, fn: () => Promise<T>): Promise<T> {
      let lease: { slot: number; holder: string } | null = null
      bump(waiting, call.key, 1)
      try {
        await waitCooldown(call)
        // Lote: a vez dele na vazão adaptativa da conexão (tokens de entrada estimados por minuto).
        if (call.priority === "BATCH") await batchWindow.admit(call.key, call.estimatedTokens, call.signal)
        if (call.maxConcurrent !== null) lease = await acquire(call, call.maxConcurrent)
      } finally {
        bump(waiting, call.key, -1)
      }
      let renew: ReturnType<typeof setInterval> | null = null
      if (lease) {
        const current = lease
        bump(held, call.key, 1)
        renew = setInterval(() => {
          db.query(`update ai_call_slot_leases set expires_at = clock_timestamp() + ($4::double precision * interval '1 millisecond') where key = $1 and slot = $2 and holder = $3`, [call.key, current.slot, current.holder, leaseMs]).catch((error: unknown) => warn("ai_call_slot_renew_failed", error))
        }, Math.max(1_000, Math.floor(leaseMs / 3)))
        renew.unref?.()
      }
      try {
        return await fn()
      } catch (error) {
        // 429/503 desta conexão: os lotes de TODAS as instâncias esperam (a interativa, nunca); 429 do chat = pausa mais longa.
        const signal = gateSignalOf(error)
        const pauseMs = cooldownMsOf(signal, call.priority)
        if (signal) batchWindow.congestion(call.key, { interactive: call.priority === "INTERACTIVE" })
        if (signal && pauseMs > 0) await publish(call.key, pauseMs, signal.kind, call.priority)
        throw error
      } finally {
        if (renew) clearInterval(renew)
        if (lease) {
          bump(held, call.key, -1)
          db.query(`delete from ai_call_slot_leases where key = $1 and slot = $2 and holder = $3`, [call.key, lease.slot, lease.holder]).catch((error: unknown) => warn("ai_call_slot_release_failed", error))
        }
      }
    },
  }
}
