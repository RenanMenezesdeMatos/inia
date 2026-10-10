import { createServer, type Server } from "node:http"

/**
 * /health do processo de PROCESSAMENTO (INIA_PROCESS_ROLE=worker) — sem Express, sem sessão, sem dado de negócio: só se o
 * processo está de pé, quantas matrículas estão rodando, a fila de chamadas de IA e a última rodada de cada tarefa periódica.
 * Escuta em 127.0.0.1 por padrão (monitoramento local / serviço do Windows); nunca é publicado pelo IIS.
 */
export function startWorkerHealthServer(options: { port: number; host: string; snapshot: () => Record<string, unknown> }): Server {
  const startedAt = Date.now()
  const server = createServer((request, response) => {
    const path = (request.url ?? "").split("?")[0]
    if (request.method !== "GET" || path !== "/health") {
      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Recurso não encontrado." } }))
      return
    }
    let body: Record<string, unknown>
    try {
      body = { status: "ok", role: "worker", uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), ...options.snapshot() }
    } catch (error) {
      response.writeHead(503, { "content-type": "application/json" })
      response.end(JSON.stringify({ status: "error", role: "worker", message: error instanceof Error ? error.message : "erro" }))
      return
    }
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
    response.end(JSON.stringify(body))
  })
  // Porta ocupada não derruba o processamento: o /health é conveniência de monitoramento.
  server.on("error", (error) => console.error(`/health do processamento indisponível em ${options.host}:${options.port}:`, error.message))
  server.listen(options.port, options.host, () => process.stdout.write(`INIA processamento — /health em http://${options.host}:${options.port}/health\n`))
  return server
}
