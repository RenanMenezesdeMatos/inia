import { format } from "node:util"
import pino from "pino"
import { env } from "../../../config/env.js"
import { currentRequestId } from "../../application/observability/request-context.js"

/**
 * LOGS ESTRUTURADOS SEM ESCRITA SÍNCRONA. No Windows o serviço (WinSW) lê a saída do Node por um PIPE — e no Windows o Node
 * escreve em pipe de forma SÍNCRONA (`process.stdout`): cada linha de log segurava o event loop até o WinSW ler. Aqui todo
 * log — os loggers pino (`createLogger`) e o `console.*` (ponte ligada pelo server.ts) — vai para UM destino assíncrono
 * (sonic-boom: a escrita acontece fora do event loop), em blocos de até 4 KB gravados pelo menos a cada segundo (menos
 * chamadas ao sistema). O buffer tem teto: se a saída travar, as linhas acima dele são DESCARTADAS e contadas
 * (`droppedLogLines`, nas métricas internas) — a API nunca para por causa de log.
 *
 * Nos testes os loggers ficam desligados e nada disto é criado.
 */
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024
/** Bloco mínimo por escrita e prazo máximo de uma linha no buffer. Com `minLength` 0 o `flush(cb)` do sonic-boom responde na
 * hora sem esperar nada — e o `flushSync` que o pino roda na saída grava a fila ANTES da escrita em andamento (linhas fora de
 * ordem na saída do processo, visto em 3 de 24 processos sob carga). */
const MIN_WRITE_BYTES = 4 * 1024
const FLUSH_INTERVAL_MS = 1_000

let destination: pino.DestinationStream & { flush?: (callback?: (error?: Error) => void) => void; on?: (event: string, listener: (...args: unknown[]) => void) => void } | null = null
let root: pino.Logger | null = null
let dropped = 0

function sharedDestination() {
  if (!destination) {
    const created = pino.destination({ dest: 1, sync: false, minLength: MIN_WRITE_BYTES, maxLength: MAX_BUFFERED_BYTES })
    created.on("drop", () => {
      dropped += 1
    })
    const timer = setInterval(() => {
      try {
        created.flush()
      } catch {
        // Saída indisponível: a próxima rodada tenta de novo.
      }
    }, FLUSH_INTERVAL_MS)
    timer.unref?.()
    destination = created
  }
  return destination
}

function rootLogger(): pino.Logger {
  root ??= env.NODE_ENV === "test" ? pino({ enabled: false }) : pino({ level: env.LOG_LEVEL, base: { pid: process.pid }, mixin: requestIdField }, sharedDestination())
  return root
}

/** Dentro de uma requisição HTTP, toda linha leva o id dela (o mesmo devolvido em `x-request-id` e no 500 genérico). */
function requestIdField(): Record<string, unknown> {
  const requestId = currentRequestId()
  return requestId ? { requestId } : {}
}

/** Logger estruturado de um componente (`name` vira campo de cada linha). */
export function createLogger(name: string, options: { enabled?: boolean } = {}): pino.Logger {
  if (options.enabled === false) return pino({ enabled: false })
  return rootLogger().child({ name })
}

/** Linhas descartadas porque a saída não acompanhou (buffer acima do teto). */
export function droppedLogLines(): number {
  return dropped
}

/**
 * Antes de sair do processo: espera o buffer esvaziar de verdade (evento de fim de escrita; no máximo `timeoutMs`). Não usa
 * `flushSync`: com uma escrita assíncrona em andamento ele grava a fila ANTES dela.
 */
export function flushLogs(timeoutMs = 1_000): Promise<void> {
  const flush = destination?.flush?.bind(destination)
  if (!flush) return Promise.resolve()
  return new Promise<void>((resolve) => {
    // Sem unref: o prazo segura o processo vivo até a saída pedida (código de saída certo mesmo sem resposta do destino).
    const timer = setTimeout(resolve, timeoutMs)
    try {
      flush(() => {
        clearTimeout(timer)
        resolve()
      })
    } catch {
      // Saída indisponível: nada a fazer na saída do processo.
      clearTimeout(timer)
      resolve()
    }
  })
}

type ConsoleLevel = "debug" | "info" | "warn" | "error"

/**
 * `console.*` do código (≈ 65 chamadas, muitas já com uma linha JSON) passa pelo mesmo destino assíncrono: uma linha JSON vira
 * os campos do log; o resto vira `msg` (formatado como o console faria, com a pilha de um erro).
 */
export function routeConsoleToLog(): void {
  const logger = createLogger("console")
  const write = (level: ConsoleLevel, args: unknown[]) => {
    if (args.length === 1 && typeof args[0] === "string" && args[0].startsWith("{")) {
      try {
        const parsed = JSON.parse(args[0]) as unknown
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          logger[level](parsed as Record<string, unknown>)
          return
        }
      } catch {
        // Não era JSON: segue como texto.
      }
    }
    logger[level](format(...args))
  }
  console.log = (...args: unknown[]) => write("info", args)
  console.info = (...args: unknown[]) => write("info", args)
  console.debug = (...args: unknown[]) => write("debug", args)
  console.warn = (...args: unknown[]) => write("warn", args)
  console.error = (...args: unknown[]) => write("error", args)
}
