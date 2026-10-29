import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { startWorkerHealthServer } from "./worker-health.js"

/** /health do processamento: detalhe só com a trava de `/internal/metrics` (achado C10 da 4ª auditoria). */
let server: ReturnType<typeof startWorkerHealthServer> | null = null
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())))

async function start(token?: string) {
  server = startWorkerHealthServer({ port: 0, host: "127.0.0.1", token, snapshot: () => ({ workflowRunning: 3, jobs: [{ name: "x", lastError: "segredo operacional" }] }) })
  await new Promise<void>((resolve) => server!.once("listening", () => resolve()))
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/health`
}
const read = async (url: string, headers: Record<string, string> = {}) => {
  const response = await fetch(url, { headers })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe("/health do processamento (worker)", () => {
  it("sem token, com token errado ou com cabeçalho de proxy: só 'está de pé' (o instalador continua recebendo 200)", async () => {
    const url = await start("token-de-metricas")
    for (const headers of [{}, { authorization: "Bearer errado" }, { authorization: "Bearer token-de-metricas", "x-forwarded-for": "10.0.0.9" }]) {
      const { status, body } = await read(url, headers)
      expect(status).toBe(200)
      expect(Object.keys(body).sort()).toEqual(["role", "status", "uptimeSeconds"])
    }
  })

  it("com o token certo, numa conexão local: o detalhe de sempre", async () => {
    const url = await start("token-de-metricas")
    const { body } = await read(url, { authorization: "Bearer token-de-metricas" })
    expect(body).toMatchObject({ status: "ok", role: "worker", workflowRunning: 3 })
  })

  it("sem INIA_METRICS_TOKEN configurado: conexão local sem proxy vê o detalhe (o mesmo de /internal/metrics)", async () => {
    const url = await start(undefined)
    expect((await read(url)).body).toMatchObject({ workflowRunning: 3 })
    expect(Object.keys((await read(url, { "x-forwarded-for": "10.0.0.9" })).body).sort()).toEqual(["role", "status", "uptimeSeconds"])
  })
})
