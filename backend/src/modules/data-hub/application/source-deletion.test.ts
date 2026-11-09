import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createDataHubContext } from "./data-hub-context.js"
import { deleteSource } from "./source-service.js"

/**
 * Achado 3 da homologação na Azure (15/10/2026): remover a fonte deixava a credencial ativa em `data_secrets` (cifrada e
 * inalcançável). Agora a remoção revoga feeds, tokens de push E credenciais numa transação só.
 */
const SOURCE_ID = "6f1c2a8e-1111-4c5e-9d1a-000000000001"

function trackingDatabase(options: { failOn?: string } = {}) {
  const statements: { via: "pool" | "client"; sql: string; params: unknown[] }[] = []
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ via: "client", sql, params })
      if (options.failOn && sql.includes(options.failOn)) throw new Error("falha simulada")
      if (sql.includes("update data_secrets")) return { rows: [{ purpose: "DATABASE_PASSWORD" }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }),
    release: vi.fn(),
  }
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ via: "pool", sql, params })
      if (sql.includes("from data_sources s")) return { rows: [{ id: SOURCE_ID, organizationId: "org-1", name: "RH", kind: "FILE_UPLOAD", status: "ACTIVE", config: { kind: "FILE_UPLOAD" } }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }),
    connect: vi.fn(async () => client),
  }
  return { db: db as unknown as Database, client, statements }
}

describe("remover fonte", () => {
  it("revoga as credenciais da fonte na mesma transação que remove fonte, feeds e tokens", async () => {
    const { db, client, statements } = trackingDatabase()
    await deleteSource(createDataHubContext(db), "org-1", "actor-1", SOURCE_ID)

    const inTransaction = statements.filter((entry) => entry.via === "client").map((entry) => entry.sql.trim().split(/\s+/).slice(0, 2).join(" "))
    expect(inTransaction).toEqual(["begin", "update data_feeds", "update data_sources", "update data_push_tokens", "update data_ingestion_runs", "update data_secrets", "update data_source_config_unlocks", "insert into", "commit"])
    // Cargas ainda na fila da fonte terminam na mesma transação (achado C07 da 4ª auditoria).
    const orphans = statements.find((entry) => entry.sql.includes("update data_ingestion_runs"))!
    expect(orphans.sql).toMatch(/status = 'CANCELLED'.*error_code = 'DATA_FEED_INACTIVE'.*where organization_id = \$1 and source_id = \$2 and status = 'QUEUED'/s)
    expect(orphans.params).toEqual(["org-1", SOURCE_ID])
    const secrets = statements.find((entry) => entry.sql.includes("update data_secrets"))!
    expect(secrets.sql).toMatch(/set revoked_at = now\(\) where source_id = \$1 and revoked_at is null/)
    expect(secrets.params).toEqual([SOURCE_ID])
    const audit = statements.find((entry) => entry.sql.includes("insert into audit_logs"))!
    expect(JSON.parse(String(audit.params[5]))).toEqual({ sourceId: SOURCE_ID, name: "RH", kind: "FILE_UPLOAD", target: {}, secretsRevoked: ["DATABASE_PASSWORD"] })
    // Fora da transação, só a leitura que confere se a fonte existe.
    expect(statements.filter((entry) => entry.via === "pool").every((entry) => entry.sql.trimStart().startsWith("select"))).toBe(true)
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it("se qualquer passo falhar, nada fica pela metade: rollback, sem commit", async () => {
    const { db, client, statements } = trackingDatabase({ failOn: "update data_secrets" })
    await expect(deleteSource(createDataHubContext(db), "org-1", "actor-1", SOURCE_ID)).rejects.toThrow("falha simulada")
    const sqls = statements.filter((entry) => entry.via === "client").map((entry) => entry.sql)
    expect(sqls.at(-1)).toBe("rollback")
    expect(sqls).not.toContain("commit")
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})
