import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createDataHubContext } from "./data-hub-context.js"
import { kickWorker } from "./run-service.js"

/**
 * Carga enfileirada pela tela/API Push: com o processamento em OUTRO processo (papel `api`), `kickWorker` só avisa — nada
 * da carga (exceljs, pipeline, gravação) roda no processo que atende as telas. Sem aviso configurado (papel `all`), processa
 * aqui mesmo, fora do request, como antes.
 */
function trackingDatabase() {
  const connect = vi.fn(async () => {
    throw new Error("não deveria processar neste processo")
  })
  return { db: { query: vi.fn(), connect } as unknown as Database, connect }
}

describe("kickWorker — onde a carga da Central de Dados roda", () => {
  it("papel `api`: só avisa o processamento; não toca na fila neste processo", async () => {
    const { db, connect } = trackingDatabase()
    const wakeWorker = vi.fn()
    kickWorker(createDataHubContext(db, { wakeWorker }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(wakeWorker).toHaveBeenCalledTimes(1)
    expect(connect).not.toHaveBeenCalled()
  })

  it("papel `all`: processa a fila aqui, fora do request", async () => {
    const { db, connect } = trackingDatabase()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    kickWorker(createDataHubContext(db, { logger }))
    expect(connect).not.toHaveBeenCalled()
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    expect(connect).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(expect.anything(), "data-hub worker kick failed")
  })
})
