import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import { applyHttpTimeouts, createShutdown, HTTP_HEADERS_TIMEOUT_MS, HTTP_KEEP_ALIVE_TIMEOUT_MS, installProcessHandlers, processFaults } from "./process-lifecycle.js"
import type { Database } from "../infrastructure/database/pool.js"
import { createReadiness } from "./readiness.js"

/**
 * Desligamento de uma API atrás da web farm: sai da prontidão NA HORA, espera o balanceador, para de aceitar conexões, para o
 * processamento, fecha o banco — e nunca passa do prazo (conexão longa = cortada, código 1).
 */
const okDatabase = { query: async () => ({ rows: [], rowCount: 1 }) } as unknown as Pick<Database, "query">
const servers: Server[] = []

async function listening(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` }
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    server.close()
  }
})

describe("ciclo de vida do processo de API", () => {
  it("keep-alive acima do proxy (65 s) e headersTimeout acima do keep-alive", async () => {
    const { server } = await listening((_request, response) => response.end("ok"))
    applyHttpTimeouts(server)
    expect(server.keepAliveTimeout).toBe(HTTP_KEEP_ALIVE_TIMEOUT_MS)
    expect(server.headersTimeout).toBe(HTTP_HEADERS_TIMEOUT_MS)
    expect(HTTP_HEADERS_TIMEOUT_MS).toBeGreaterThan(HTTP_KEEP_ALIVE_TIMEOUT_MS)
  })

  it("ordem: deixa de estar pronto → espera o balanceador → para de aceitar → para o processamento → fecha o banco → sai com 0", async () => {
    const { server, url } = await listening((_request, response) => response.end("ok"))
    const readiness = createReadiness(okDatabase)
    const steps: string[] = []
    const exit = vi.fn((code: number) => steps.push(`exit:${code}`))
    const shutdown = createShutdown({
      readiness,
      servers: () => [server, null],
      stopProcessing: async () => {
        steps.push("processing")
      },
      closeResources: async () => {
        steps.push("resources")
      },
      // Folga para a máquina ocupada (suíte inteira em paralelo): a requisição abaixo precisa cair DENTRO da drenagem.
      drainMs: 1_000,
      timeoutMs: 5_000,
      exit,
      log: { info: () => {}, error: () => {} },
    })
    const done = shutdown("SIGTERM")
    expect(readiness.draining).toBe(true)
    // Durante a drenagem a porta ainda atende (o balanceador ainda pode mandar a última requisição).
    expect((await fetch(url, { headers: { connection: "close" } })).status).toBe(200)
    expect(await readiness.check()).toEqual({ ready: false, reason: "DRAINING" })
    await done
    expect(steps).toEqual(["processing", "resources", "exit:0"])
    await expect(fetch(url)).rejects.toThrow()
    // Chamado de novo (dois sinais): nada acontece duas vezes.
    await shutdown("SIGINT")
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it("prazo máximo: um chat em fluxo que não termina é cortado e o processo sai com código 1", async () => {
    let cut = false
    const { server, url } = await listening((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write(": ping\n\n")
      response.on("close", () => (cut = true))
    })
    const exited = new Promise<number>((resolve) => {
      const shutdown = createShutdown({ readiness: null, servers: () => [server], stopProcessing: async () => {}, closeResources: async () => {}, drainMs: 0, timeoutMs: 150, exit: resolve, log: { info: () => {}, error: () => {} } })
      void fetch(url).then(async (response) => {
        await response.body!.getReader().read()
        void shutdown("SIGTERM")
      })
    })
    expect(await exited).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(cut).toBe(true)
  })

  it("promessa rejeitada sem tratamento: só log (o processo segue); exceção não capturada: log + desligamento com código 1", () => {
    const target = new EventEmitter()
    const shutdown = vi.fn(async () => {})
    const errors: Record<string, unknown>[] = []
    installProcessHandlers(shutdown, { info: () => {}, error: (event) => errors.push(event) }, target as unknown as NodeJS.Process)
    const before = { ...processFaults }
    target.emit("unhandledRejection", new Error("esquecida"), Promise.resolve())
    expect(shutdown).not.toHaveBeenCalled()
    target.emit("uncaughtException", new Error("quebrou"), "uncaughtException")
    expect(shutdown).toHaveBeenCalledWith("uncaughtException", 1)
    target.emit("SIGTERM")
    expect(shutdown).toHaveBeenCalledWith("SIGTERM")
    expect(errors.map((event) => event.event)).toEqual(["unhandled_rejection", "uncaught_exception"])
    expect(processFaults).toEqual({ unhandledRejections: before.unhandledRejections + 1, uncaughtExceptions: before.uncaughtExceptions + 1 })
  })
})
