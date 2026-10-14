import pg from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * ACORDAR OUTRO PROCESSO pelo PostgreSQL (`NOTIFY` / `LISTEN`) — sem broker. A API (papel `api`) avisa; o processamento (papel
 * `worker`) escuta numa conexão PRÓPRIA (fora do pool: `LISTEN` prende a sessão) e reage na hora. O aviso é só um atalho de
 * latência: a tarefa periódica continua sendo a garantia (aviso perdido = a próxima rodada pega o trabalho).
 *
 * Nome do canal: identificador fixo em código (nunca vem de fora). A conexão de escuta cai (banco reiniciado, rede): reconecta
 * sozinha com espera crescente, até 30 s.
 */
export const DATA_HUB_WAKE_CHANNEL = "inia_data_hub_wake"

const CHANNEL_NAME = /^[a-z_][a-z0-9_]{0,62}$/

/** Avisa quem escuta o canal (fire-and-forget para quem chama: falha vai para o log, nunca para a resposta HTTP). */
export async function notifyWake(db: Pick<Database, "query">, channel: string): Promise<void> {
  await db.query("select pg_notify($1, '')", [channel])
}

export type WakeListener = { stop(): Promise<void>; readonly connected: boolean }

export function listenForWake(options: { connectionString: string; channel: string; onWake: () => void; log?: (message: string, error?: unknown) => void }): WakeListener {
  if (!CHANNEL_NAME.test(options.channel)) throw new Error(`Canal de aviso inválido: ${options.channel}`)
  const log = options.log ?? ((message: string, error?: unknown) => console.warn(message, error instanceof Error ? error.message : (error ?? "")))
  let client: pg.Client | null = null
  let stopped = false
  let connected = false
  let retryMs = 1_000
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const scheduleReconnect = () => {
    if (stopped || retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      void connect()
    }, retryMs)
    retryTimer.unref?.()
    retryMs = Math.min(30_000, retryMs * 2)
  }

  async function connect(): Promise<void> {
    if (stopped) return
    const next = new pg.Client({ connectionString: options.connectionString })
    client = next
    next.on("notification", (message) => {
      if (message.channel === options.channel) options.onWake()
    })
    next.on("error", (error) => {
      connected = false
      log(`Escuta do canal ${options.channel} caiu; reconectando.`, error)
      next.end().catch(() => undefined)
      scheduleReconnect()
    })
    next.on("end", () => {
      connected = false
      scheduleReconnect()
    })
    try {
      await next.connect()
      await next.query(`listen ${options.channel}`)
      connected = true
      retryMs = 1_000
      // Pode ter chegado trabalho enquanto a escuta estava fora: uma rodada na volta.
      options.onWake()
    } catch (error) {
      connected = false
      log(`Não foi possível escutar o canal ${options.channel}; nova tentativa em instantes.`, error)
      next.end().catch(() => undefined)
      scheduleReconnect()
    }
  }

  void connect()
  return {
    get connected() {
      return connected
    },
    async stop() {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      const current = client
      client = null
      connected = false
      await current?.end().catch(() => undefined)
    },
  }
}
