import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../infrastructure/database/pool.js"
import { hashPassword } from "../modules/auth/infrastructure/password-hasher.js"
import { env, envSchema } from "../config/env.js"
import { createApp } from "./app.js"
import { legacyAccessQuery } from "../modules/access/testing/legacy-admin-fixture.js"

const emptyDatabase = {
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async () => {
    throw new Error("not needed")
  },
} as unknown as Database

describe("app", () => {
  it("QA de feedback (V1.5.5): com a flag OFF as rotas nem existem (404 genérico); com ON exigem sessão / administrador global", async () => {
    for (const path of ["/api/v1/feedback-quality-reviews", "/api/v1/feedback-quality-reviews/access", "/api/v1/feedback-deliveries/mine"]) {
      const off = await request(createApp(emptyDatabase, { interactionFeedbackReview: false })).get(path)
      expect(off.status).toBe(404)
      expect(off.body).toEqual({ error: { code: "NOT_FOUND", message: "Recurso não encontrado." } })
      // Padrão = a flag do AMBIENTE (o `.env` local de dev pode ligá-la; o default do código continua OFF — checado abaixo).
      expect((await request(createApp(emptyDatabase)).get(path)).status).toBe(env.INIA_INTERACTION_FEEDBACK_PIPELINE === "ON" ? 401 : 404)
      expect((await request(createApp(emptyDatabase, { interactionFeedbackReview: true })).get(path)).status).toBe(401)
    }
    // Sem a variável, o código assume OFF: produção nunca liga o módulo por omissão.
    expect(envSchema.shape.INIA_INTERACTION_FEEDBACK_PIPELINE.parse(undefined)).toBe("OFF")
    expect((await request(createApp(emptyDatabase, { interactionFeedbackReview: false })).post("/api/v1/feedback-quality-reviews/00000000-0000-4000-8000-000000000001/decision").send({ decision: "APPROVED_UNCHANGED" })).status).toBe(404)
    // A rota antiga (aba do perfil) não existe mais.
    expect((await request(createApp(emptyDatabase, { interactionFeedbackReview: true })).get("/api/v1/feedback-reviews")).status).toBe(404)
    // V1.5.7: a antiga concessão isolada de QA saiu — QA de feedback é um PAPEL atribuído em /admin/access (modelo geral).
    // Mesmo um Administrador geral autenticado não encontra a rota antiga, com a flag ON ou OFF.
    const adminAgent = async (enabled: boolean) => {
      const passwordHash = await hashPassword("Inia@123")
      const database = {
        query: async (sql: string) => legacyAccessQuery(sql, "ADMIN", []) ?? (sql.includes("from user_accounts ua") ? { rows: [{ id: "acc-1", organization_id: "org-1", person_id: "person-1", name: "Teste", role: "ADMIN", email: "teste@inia.com", password_hash: passwordHash, active: true, avatar_url: null, job_title: null, team_id: null, team_name: null }], rowCount: 1 } : { rows: [], rowCount: 0 }),
        connect: async () => { throw new Error("not needed") },
      } as unknown as Database
      const agent = request.agent(createApp(database, { interactionFeedbackReview: enabled }))
      await agent.post("/api/v1/auth/login").send({ email: "teste@inia.com", password: "Inia@123" })
      return agent
    }
    for (const enabled of [false, true]) expect((await (await adminAgent(enabled)).get("/api/v1/admin/feedback-quality-reviewers")).status).toBe(404)
  })

  it("reports health without database access", async () => {
    const response = await request(createApp(emptyDatabase)).get("/health")
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: "ok" })
  })

  it("returns an empty case collection for an authenticated user", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = {
      query: async (sql: string) => {
        if (sql.includes("from user_accounts ua")) {
          return {
            rows: [
              {
                id: "acc-1",
                organization_id: "org-1",
                person_id: "person-1",
                name: "Teste",
                role: "ADMIN",
                email: "teste@inia.com",
                password_hash: passwordHash,
                active: true,
                avatar_url: null,
                job_title: null,
                team_id: null,
                team_name: null,
              },
            ],
            rowCount: 1,
          }
        }
        return { rows: [], rowCount: 0 }
      },
      connect: async () => {
        throw new Error("not needed")
      },
    } as unknown as Database

    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: "teste@inia.com", password: "Inia@123" })
    const response = await agent.get("/api/v1/supervision-cases")
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ data: [] })
  })

  it("blocks the case collection without a session", async () => {
    const response = await request(createApp(emptyDatabase)).get("/api/v1/supervision-cases")
    expect(response.status).toBe(401)
  })

  it("500 genérico devolve o id da requisição (o mesmo do cabeçalho x-request-id e das linhas de log), sem detalhe interno", async () => {
    const brokenDatabase = {
      query: async () => {
        throw new Error("conexão recusada: segredo-do-banco")
      },
      connect: async () => {
        throw new Error("not needed")
      },
    } as unknown as Database
    const response = await request(createApp(brokenDatabase, { rateLimits: false })).post("/api/v1/auth/login").set("x-request-id", "suporte-ticket-4242").send({ email: "alguem@inia.com", password: "x" })
    expect(response.status).toBe(500)
    expect(response.headers["x-request-id"]).toBe("suporte-ticket-4242")
    expect(response.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Erro interno.", requestId: "suporte-ticket-4242" } })
  })
})
