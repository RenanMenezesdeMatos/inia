import { flushLogs, routeConsoleToLog } from "../logger.js"

// Processo filho do logger.test.ts: liga a ponte como o server.ts e escreve os formatos que o código usa.
routeConsoleToLog()
console.info(JSON.stringify({ event: "ai_call_queued", useCase: "CHAT", waitedMs: 320 }))
console.warn("Aviso à Central de Dados não enviado:", "conexão recusada")
console.error("Falha no tick:", new Error("quebrou"))
await flushLogs()
process.exit(0)
