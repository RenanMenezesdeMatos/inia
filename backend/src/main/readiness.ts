import type { QueryConfig } from "pg"
import type { Database } from "../infrastructure/database/pool.js"

/**
 * PRONTIDÃO do processo de API (`GET /ready`) — o que o balanceador (web farm do ARR no IIS) consulta para decidir se manda
 * tráfego para esta instância. `/health` continua sendo só "o processo está de pé" (sempre ok); `/ready` responde 503 quando:
 *
 *   - o processo está DESLIGANDO (recebeu o sinal de parada): o balanceador tira a instância antes de ela fechar a porta;
 *   - o BANCO não responde a um `select 1` dentro de `timeoutMs` (banco fora, rede, ou o pool desta instância esgotado).
 *
 * O resultado do banco fica `cacheMs` em cache: uma enxurrada de consultas ao /ready nunca vira uma enxurrada no banco.
 */
export type ReadinessReason = "DRAINING" | "DATABASE_UNAVAILABLE"
export type ReadinessResult = { ready: boolean; reason: ReadinessReason | null }

export type Readiness = {
  check(): Promise<ReadinessResult>
  /** Deixa de estar pronto (desligamento). Irreversível. */
  startDraining(): void
  readonly draining: boolean
}

export function createReadiness(db: Pick<Database, "query">, options: { cacheMs?: number; timeoutMs?: number; now?: () => number } = {}): Readiness {
  const cacheMs = options.cacheMs ?? 1_000
  const timeoutMs = options.timeoutMs ?? 3_000
  const now = options.now ?? Date.now
  let draining = false
  let cached: { at: number; ok: boolean } | null = null
  let inFlight: Promise<boolean> | null = null

  const probeDatabase = (): Promise<boolean> => {
    if (cached && now() - cached.at < cacheMs) return Promise.resolve(cached.ok)
    // Uma consulta por vez: quem chega durante a conferência espera a mesma resposta.
    inFlight ??= new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs)
      timer.unref?.()
      // O mesmo prazo vale para o comando: com o banco travado, a conferência solta a conexão em vez de prendê-la até a rede
      // desistir (uma conferência presa por segundo esgotaria o pool). `query_timeout` por comando existe no driver, mas não
      // nos tipos dele.
      const probe: QueryConfig & { query_timeout: number } = { text: "select 1", query_timeout: timeoutMs }
      db.query(probe).then(
        () => {
          clearTimeout(timer)
          resolve(true)
        },
        () => {
          clearTimeout(timer)
          resolve(false)
        },
      )
    }).then((ok) => {
      cached = { at: now(), ok }
      inFlight = null
      return ok
    })
    return inFlight
  }

  return {
    async check() {
      if (draining) return { ready: false, reason: "DRAINING" }
      const ok = await probeDatabase()
      if (draining) return { ready: false, reason: "DRAINING" }
      return ok ? { ready: true, reason: null } : { ready: false, reason: "DATABASE_UNAVAILABLE" }
    },
    startDraining() {
      draining = true
    },
    get draining() {
      return draining
    },
  }
}
