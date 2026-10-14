import { describe, expect, it } from "vitest"
import { databaseSessionSettings } from "./session-limits.js"

const config = { DATABASE_CONNECTION_TIMEOUT_MS: 10_000, DATABASE_STATEMENT_TIMEOUT_MS: 30_000, DATABASE_WORKER_STATEMENT_TIMEOUT_MS: 300_000, DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: 60_000 }

describe("Limites de sessão do banco por processo", () => {
  it("servidor: API com comando curto; worker e processo único com o limite das tarefas; todos com transação ociosa e espera por conexão", () => {
    expect(databaseSessionSettings({ server: true, role: "api", entryScript: "/app/dist/main/server.js", config })).toEqual({ kind: "server", applicationName: "inia-api", statementTimeoutMs: 30_000, idleInTransactionTimeoutMs: 60_000, connectionTimeoutMs: 10_000, batchStatementTimeoutMs: 300_000 })
    expect(databaseSessionSettings({ server: true, role: "worker", entryScript: "/app/dist/main/server.js", config })).toMatchObject({ applicationName: "inia-worker", statementTimeoutMs: 300_000, batchStatementTimeoutMs: 300_000 })
    expect(databaseSessionSettings({ server: true, role: "all", entryScript: "/app/src/main/server.ts", config })).toMatchObject({ applicationName: "inia-all", statementTimeoutMs: 300_000 })
  })

  it("migrations, seeds, scripts e testes: sem limite nenhum, identificados pelo arquivo de entrada", () => {
    expect(databaseSessionSettings({ server: false, role: "all", entryScript: "/app/src/infrastructure/database/migrate.ts", config })).toEqual({ kind: "maintenance", applicationName: "inia-script:migrate", statementTimeoutMs: 0, idleInTransactionTimeoutMs: 0, connectionTimeoutMs: 0, batchStatementTimeoutMs: 0 })
    // O papel configurado não vale fora do servidor (o .env compartilhado pode dizer `api`).
    expect(databaseSessionSettings({ server: false, role: "api", entryScript: undefined, config })).toMatchObject({ applicationName: "inia-script:node", statementTimeoutMs: 0 })
  })

  it("server.ts marca o processo ANTES de qualquer import que crie o pool", async () => {
    const { readFile } = await import("node:fs/promises")
    const source = await readFile(new URL("../../main/server.ts", import.meta.url), "utf8")
    const firstImport = source.split("\n").find((line) => line.startsWith("import "))
    expect(firstImport).toBe('import "./server-database-session.js"')
  })
})
