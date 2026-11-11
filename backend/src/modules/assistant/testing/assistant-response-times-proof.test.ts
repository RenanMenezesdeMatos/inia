/**
 * PROVA contra o banco de TESTE real: tempo de resposta da INIA no chat de texto (KPI de 2026-11-10, `monitoredResponseTimes`).
 * Tudo numa transação desfeita no fim (banco intacto). Nenhuma chamada de modelo.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run assistant-response-times-proof
 *
 * Prova: cada resposta conta o intervalo desde a mensagem do colaborador imediatamente anterior; voz, resposta depois de resposta e
 * conversa fora do alcance não entram; a pergunta feita antes da meia-noite conta para a resposta dada no dia; período e filtros da
 * lista valem; sem resposta, os tempos vêm nulos (nunca zero); a rota valida o período.
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { monitoredResponseTimes } from "../application/conversation-monitoring.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Tempo de resposta da INIA — prova Postgres", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
  })
  afterAll(async () => {
    if (client) {
      await client.query("rollback")
      client.release()
    }
    if (pool) await pool.end()
  })

  it("intervalo pergunta → resposta do chat de texto, no alcance e no período; voz e resposta seguida de resposta ficam de fora", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!.id
    const timezone = (await client.query<{ tz: string }>("select coalesce((select timezone from operations where organization_id = $1 order by created_at limit 1), 'America/Sao_Paulo') tz", [org])).rows[0]!.tz
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [org])).rows[0]!.id
    const team = async (name: string) => (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, $3) returning id", [org, operation, name])).rows[0]!.id
    const teamA = await team("Proof Tempo A")
    const teamB = await team("Proof Tempo B")
    const hash = await hashPassword("Proof@12345")
    const person = async (name: string, teamId: string) => {
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, $2, 'OPERATOR', $3) returning id", [org, name, teamId])).rows[0]!.id
      const email = `${name.toLowerCase().replaceAll(" ", "-")}@proof-tempo.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [org, id, email, hash])).rows[0]!.id
      return { id, accountId, email }
    }
    const leitora = await person("Proof Tempo Leitora", teamA)
    await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, 'LEITOR_DE_CONVERSAS_INIA', 'GROUP', $3, now())", [org, leitora.accountId, teamA])
    const larissa = await person("Proof Tempo Larissa", teamA)
    const bruno = await person("Proof Tempo Bruno", teamB)

    // Datas LOCAIS da organização: o dia medido é 2026-07-15; a pergunta das 23:59:50 do dia 14 é respondida às 00:00:05 do dia 15.
    const conversation = async (ownerId: string, origin = "USER") =>
      (await client.query<{ id: string }>("insert into assistant_conversations (organization_id, owner_person_id, started_at, last_activity_at, origin, status, closed_at, close_reason) values ($1, $2, now(), now(), $3, 'CLOSED', now(), 'MANUAL') returning id", [org, ownerId, origin])).rows[0]!.id
    const say = async (conversationId: string, ownerId: string, channel: "chat" | "voice", role: "user" | "assistant", local: string) =>
      client.query("insert into assistant_interactions (organization_id, operator_id, conversation_id, channel, role, content, occurred_at) values ($1, $2, $3, $4, $5, 'x', ($6::timestamp at time zone $7))", [org, ownerId, conversationId, channel, role, local, timezone])

    const free = await conversation(larissa.id)
    await say(free, larissa.id, "chat", "user", "2026-07-14 23:59:50")
    await say(free, larissa.id, "chat", "assistant", "2026-07-15 00:00:05") // 15 s, pergunta do dia anterior
    await say(free, larissa.id, "chat", "user", "2026-07-15 10:00:00")
    await say(free, larissa.id, "chat", "assistant", "2026-07-15 10:00:12") // 12 s
    await say(free, larissa.id, "chat", "assistant", "2026-07-15 10:00:20") // resposta depois de resposta: fora
    await say(free, larissa.id, "chat", "user", "2026-07-15 11:00:00")
    await say(free, larissa.id, "chat", "assistant", "2026-07-15 11:00:30") // 30 s
    await say(free, larissa.id, "voice", "user", "2026-07-15 12:00:00")
    await say(free, larissa.id, "voice", "assistant", "2026-07-15 12:00:00") // voz: fora
    await say(free, larissa.id, "chat", "user", "2026-07-16 09:00:00")
    await say(free, larissa.id, "chat", "assistant", "2026-07-16 09:00:40") // outro dia: fora do período
    const feedbackSession = await conversation(larissa.id, "FEEDBACK")
    await say(feedbackSession, larissa.id, "chat", "assistant", "2026-07-15 14:00:00") // a INIA abre a sessão: não é resposta
    await say(feedbackSession, larissa.id, "chat", "user", "2026-07-15 14:01:00")
    await say(feedbackSession, larissa.id, "chat", "assistant", "2026-07-15 14:01:09") // 9 s, sessão de feedback
    const otherTeam = await conversation(bruno.id)
    await say(otherTeam, bruno.id, "chat", "user", "2026-07-15 10:00:00")
    await say(otherTeam, bruno.id, "chat", "assistant", "2026-07-15 10:00:01") // fora do alcance da leitora

    const viewer = { organizationId: org, personId: leitora.id }
    const day = { from: "2026-07-15", to: "2026-07-15" }
    // [9, 12, 15, 30]: média 16,5; mediana por posição = 12; 90% = 30.
    expect(await monitoredResponseTimes(client, viewer, day)).toEqual({ ...day, replies: 4, averageSeconds: 16.5, medianSeconds: 12, p90Seconds: 30 })
    // Filtros da lista: só conversas livres; só a Larissa.
    expect(await monitoredResponseTimes(client, viewer, { ...day, origin: "USER" })).toMatchObject({ replies: 3, averageSeconds: 19, medianSeconds: 15, p90Seconds: 30 })
    expect(await monitoredResponseTimes(client, viewer, { ...day, ownerPersonId: larissa.id, origin: "FEEDBACK" })).toMatchObject({ replies: 1, averageSeconds: 9 })
    // Fora do alcance (Grupo B) nunca entra; dia sem resposta = nulos, nunca zero.
    expect(await monitoredResponseTimes(client, viewer, { ...day, teamId: teamB })).toEqual({ ...day, replies: 0, averageSeconds: null, medianSeconds: null, p90Seconds: null })
    expect(await monitoredResponseTimes(client, viewer, { from: "2026-07-01", to: "2026-07-14" })).toMatchObject({ replies: 0, medianSeconds: null })
    // Dois dias: entra também a resposta do dia 16 (o Bruno continua fora).
    expect(await monitoredResponseTimes(client, viewer, { from: "2026-07-15", to: "2026-07-16" })).toMatchObject({ replies: 5 })

    // Pela rota: o período é obrigatório e limitado a 366 dias; sem o papel, 403.
    const app = createApp(client as never, { rateLimits: false })
    const origin = env.allowedOrigins[0]!
    const agent = request.agent(app)
    expect((await agent.post("/api/v1/auth/login").set("Origin", origin).send({ email: leitora.email, password: "Proof@12345" })).status).toBe(200)
    const ok = await agent.get("/api/v1/admin/assistant-conversations/response-times?from=2026-07-15&to=2026-07-15&origin=USER")
    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ replies: 3, medianSeconds: 15 })
    expect((await agent.get("/api/v1/admin/assistant-conversations/response-times?from=2026-07-15")).status).toBe(400)
    expect((await agent.get("/api/v1/admin/assistant-conversations/response-times?from=2025-01-01&to=2026-07-15")).status).toBe(400)
    expect((await agent.get("/api/v1/admin/assistant-conversations/response-times?from=2026-07-16&to=2026-07-15")).status).toBe(400)
    const operator = request.agent(app)
    expect((await operator.post("/api/v1/auth/login").set("Origin", origin).send({ email: larissa.email, password: "Proof@12345" })).status).toBe(200)
    expect((await operator.get("/api/v1/admin/assistant-conversations/response-times?from=2026-07-15&to=2026-07-15")).status).toBe(403)
  })
})
