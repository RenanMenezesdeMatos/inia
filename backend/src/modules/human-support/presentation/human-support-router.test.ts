import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createHumanSupportRouter } from "./human-support-router.js"

/** Rotas do operador e do Anjo: corpo `.strict()` (campo a mais = 400) e rotas do Anjo só para quem tem o papel (sem ele = 403). */
const emptyDb = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => { throw new Error("not needed") } } as unknown as Database
const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  void next
  if (error instanceof DomainError) return void response.status(error.statusCode).json({ error: { code: error.code } })
  if (error instanceof ZodError) return void response.status(400).json({ error: { code: "VALIDATION_ERROR" } })
  response.status(500).json({ error: { message: (error as Error).message } })
}
function app() {
  const server = express()
  server.use(express.json())
  server.use((req, _res, next) => {
    req.user = { sub: "acc", personId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222", role: "OPERATOR", name: "Op", email: "op@inia.local", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
    next()
  })
  server.use("/api/v1/human-support", createHumanSupportRouter(emptyDb))
  server.use(errorHandler)
  return server
}
const ID = "33333333-3333-4333-8333-333333333333"

describe("rotas do Apoio com Anjo — entrada e guarda do Anjo", () => {
  it("campo a mais, chave que não é uuid, mensagem vazia ou longa demais: 400 antes de qualquer gravação", async () => {
    const server = app()
    expect((await request(server).post("/api/v1/human-support/requests").send({ clientRequestId: ID, extra: true })).status).toBe(400)
    expect((await request(server).post("/api/v1/human-support/requests").send({ clientRequestId: "nao-e-uuid" })).status).toBe(400)
    expect((await request(server).post(`/api/v1/human-support/requests/${ID}/messages`).send({ clientMessageId: ID, body: "   " })).status).toBe(400)
    expect((await request(server).post(`/api/v1/human-support/requests/${ID}/messages`).send({ clientMessageId: ID, body: "x".repeat(4001) })).status).toBe(400)
    expect((await request(server).post(`/api/v1/human-support/requests/${ID}/close`).send({ cause: "ANJO_CLOSED" })).status).toBe(400)
    expect((await request(server).get("/api/v1/human-support/me/state?wait=60")).status).toBe(400)
  })

  it("digitando e recibos: corpo estrito, seq inteiro e ao menos um recibo; pedido inexistente é 404 (não revela nada)", async () => {
    const server = app()
    expect((await request(server).post(`/api/v1/human-support/requests/${ID}/typing`).send({ typing: "sim" })).status).toBe(400)
    expect((await request(server).post(`/api/v1/human-support/requests/${ID}/typing`).send({ typing: true, text: "o que estou escrevendo" })).status).toBe(400)
    expect((await request(server).post(`/api/v1/human-support/requests/${ID}/receipts`).send({})).status).toBe(400)
    expect((await request(server).post(`/api/v1/human-support/requests/${ID}/receipts`).send({ readSeq: -1 })).status).toBe(400)
    expect((await request(server).post(`/api/v1/human-support/requests/${ID}/receipts`).send({ readSeq: 1.5 })).status).toBe(400)
    expect((await request(server).post(`/api/v1/human-support/requests/${ID}/typing`).send({ typing: true })).status).toBe(404)
    expect((await request(server).post(`/api/v1/human-support/requests/${ID}/receipts`).send({ deliveredSeq: 3 })).status).toBe(404)
  })

  it("sem o papel de Anjo: presença, histórico e classificação são 403", async () => {
    const server = app()
    expect((await request(server).put("/api/v1/human-support/anjo/presence").send({ status: "AVAILABLE" })).status).toBe(403)
    expect((await request(server).get("/api/v1/human-support/anjo/attendances")).status).toBe(403)
    expect((await request(server).post(`/api/v1/human-support/attendances/${ID}/classification`).send({ reason: "NO_PROCESS", outcome: "RESOLVED" })).status).toBe(403)
  })
})
