import type { Server } from "node:http"
import type { Readiness } from "./readiness.js"

/**
 * CICLO DE VIDA DO PROCESSO (server.ts) — o que vale para N APIs atrás da web farm do IIS:
 *
 *  - keep-alive: a API mantém a conexão ociosa por MAIS tempo que o proxy na frente (65 s, acima dos 60 s comuns), senão o
 *    proxy reaproveita uma conexão que a API acabou de fechar e o usuário vê um 502 esporádico; `headersTimeout` > keep-alive;
 *  - desligamento (sinal do serviço do Windows ou do `tsx watch`): deixa de estar pronto (`/ready` = 503), espera o
 *    balanceador perceber (`drainMs`), para de aceitar conexões, para o processamento e fecha o banco — com PRAZO MÁXIMO
 *    (`timeoutMs`): estourou, as conexões que sobraram (ex.: um chat em fluxo) são cortadas e o processo sai com código 1;
 *  - falhas fora de qualquer request: promessa rejeitada sem tratamento vai para o log e o processo segue; exceção não
 *    capturada deixa o processo em estado desconhecido → log + desligamento com código 1 (o serviço do Windows reinicia).
 */
export const HTTP_KEEP_ALIVE_TIMEOUT_MS = 65_000
export const HTTP_HEADERS_TIMEOUT_MS = 66_000

export function applyHttpTimeouts(server: Server): void {
  server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS
  server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS
}

export type LifecycleLog = {
  info(event: Record<string, unknown>): void
  error(event: Record<string, unknown>): void
}

/** Falhas fora de request desde a subida (expostas nas métricas internas). */
export const processFaults = { unhandledRejections: 0, uncaughtExceptions: 0 }

export type ShutdownOptions = {
  readiness: Readiness | null
  servers: () => (Server | null)[]
  stopProcessing: () => Promise<void>
  closeResources: () => Promise<void>
  /** Espera depois de sair da prontidão, antes de parar de aceitar conexões (o balanceador precisa de um ciclo do health check). */
  drainMs: number
  timeoutMs: number
  exit: (code: number) => void
  log: LifecycleLog
  sleep?: (ms: number) => Promise<void>
}

export function createShutdown(options: ShutdownOptions): (reason: string, exitCode?: number) => Promise<void> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let stopping = false
  return async (reason, exitCode = 0) => {
    if (stopping) return
    stopping = true
    const startedAt = Date.now()
    options.log.info({ event: "shutdown_started", reason, drainMs: options.drainMs, timeoutMs: options.timeoutMs })
    options.readiness?.startDraining()
    const deadline = setTimeout(() => {
      options.log.error({ event: "shutdown_timeout", reason, elapsedMs: Date.now() - startedAt })
      for (const server of options.servers()) server?.closeAllConnections()
      options.exit(1)
    }, options.timeoutMs)
    deadline.unref?.()
    try {
      const servers = options.servers().filter((server): server is Server => server !== null)
      if (servers.length > 0 && options.drainMs > 0) await sleep(options.drainMs)
      const closed = Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
      for (const server of servers) server.closeIdleConnections()
      await options.stopProcessing()
      await closed
      await options.closeResources()
      options.log.info({ event: "shutdown_finished", reason, elapsedMs: Date.now() - startedAt })
      clearTimeout(deadline)
      options.exit(exitCode)
    } catch (error) {
      options.log.error({ event: "shutdown_failed", reason, message: error instanceof Error ? error.message : String(error) })
      clearTimeout(deadline)
      options.exit(1)
    }
  }
}

function describeError(value: unknown): Record<string, unknown> {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
  return { value: String(value) }
}

/** Sinais do sistema (Ctrl+C do serviço do Windows = SIGINT; SIGBREAK no Windows) e falhas fora de request. */
export function installProcessHandlers(shutdown: (reason: string, exitCode?: number) => Promise<void>, log: LifecycleLog, target: NodeJS.Process = process): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) target.on(signal, () => void shutdown(signal))
  target.on("unhandledRejection", (reason) => {
    processFaults.unhandledRejections++
    log.error({ event: "unhandled_rejection", err: describeError(reason) })
  })
  target.on("uncaughtException", (error, origin) => {
    processFaults.uncaughtExceptions++
    log.error({ event: "uncaught_exception", origin, err: describeError(error) })
    void shutdown("uncaughtException", 1)
  })
}
