import express from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createIngestionRouter, INGESTION_CLOCK_SKEW_MS } from "./ingestion-router.js"

/**
 * Período da chamada na ingestão em tempo real: fim antes do início e fim NO FUTURO (além da tolerância de relógio) são
 * recusados antes de gravar qualquer coisa. Chamada no futuro disparava Workflows como se já tivesse acontecido (validação
 * funcional de 20/10/2026, D12). Zero banco: a conexão só é aberta para gravar.
 */
function app() {
  const writes: string[] = []
  const client = {
    query: async (sql: string) => {
      writes.push(sql)
      return { rows: sql.includes("insert into interactions") ? [{ id: "interaction-1" }] : [] }
    },
    release: () => {},
  }
  const db = { query: async () => ({ rows: [{ "?column?": 1 }] }), connect: async () => client } as unknown as Database
  const server = express()
  server.use(express.json())
  server.use((req, _res, next) => { req.user = { sub: "account-1", personId: "admin-1", organizationId: "org-1", role: "ADMIN", name: "Admin", email: "admin@inia.local", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }; next() })
  server.use("/ingestion", createIngestionRouter(db))
  return { server, writes }
}

const call = (startedAt: Date, endedAt: Date) => ({
  externalId: "CALL-1", operatorId: "0a7a0000-0000-4000-8000-0000000000a1", reason: "Cobrança", channel: "VOICE",
  startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), transcript: { content: "Operador: bom dia. Cliente: bom dia." }, flags: {},
})

describe("Ingestão de interação — período da chamada", () => {
  it("fim no futuro além da tolerância: 422 INTERACTION_ENDS_IN_FUTURE e nada gravado", async () => {
    const { server, writes } = app()
    const end = new Date(Date.now() + INGESTION_CLOCK_SKEW_MS + 60_000)
    const response = await request(server).post("/ingestion/interactions").send(call(new Date(end.getTime() - 300_000), end))
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("INTERACTION_ENDS_IN_FUTURE")
    expect(writes).toEqual([])
  })

  it("fim um pouco à frente (dentro da tolerância de relógio): grava normalmente", async () => {
    const { server, writes } = app()
    const end = new Date(Date.now() + 60_000)
    const response = await request(server).post("/ingestion/interactions").send(call(new Date(end.getTime() - 300_000), end))
    expect(response.status).toBe(202)
    expect(writes.some((sql) => sql.includes("insert into interactions"))).toBe(true)
  })

  it("fim antes do início continua 422 INVALID_PERIOD", async () => {
    const { server } = app()
    const start = new Date(Date.now() - 60_000)
    const response = await request(server).post("/ingestion/interactions").send(call(start, new Date(start.getTime() - 1_000)))
    expect([response.status, response.body.error.code]).toEqual([422, "INVALID_PERIOD"])
  })
})
