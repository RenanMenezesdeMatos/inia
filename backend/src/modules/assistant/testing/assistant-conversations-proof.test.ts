/**
 * PROVA contra o banco de TESTE real: Conversas com a INIA (migration 094) — persistência Postgres (lock por dono,
 * idempotência, ordem estável, paginação), rotas do próprio operador e o monitoramento da gestão por permissão + escopo
 * (papel "Leitor de conversas da INIA", concessão aos gestores, 404 fora do alcance, nenhum outro módulo liberado).
 * Tudo numa transação desfeita no fim (banco intacto). Nenhuma chamada de modelo.
 *   INIA_DB_PROOF=1 npx vitest run assistant-conversations-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { createPostgresConversationStore } from "../application/assistant-conversations.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Conversas com a INIA — prova Postgres", () => {
  beforeAll(async () => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL }); client = await pool.connect(); await client.query("begin") })
  afterAll(async () => { if (client) { await client.query("rollback"); client.release() } if (pool) await pool.end() })

  it("persistência, rotas do operador e monitoramento por escopo", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [org.id])).rows[0]!.id
    const teamA = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Conversas A') returning id", [org.id, operation])).rows[0]!.id
    const teamB = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Conversas B') returning id", [org.id, operation])).rows[0]!.id
    const hash = await hashPassword("Proof@12345")
    const person = async (name: string, level: string, teamId: string | null, reportsTo: string | null = null) => {
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, job_title, team_id, reports_to_id) values ($1, $2, $3, $4, $5, $6) returning id", [org.id, name, level, level, teamId, reportsTo])).rows[0]!.id
      const email = `${name.toLowerCase().replaceAll(" ", "-")}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [org.id, id, email, hash])).rows[0]!.id
      return { id, accountId, email }
    }
    const geral = await person("Proof Conv Geral", "OPERATOR", null)
    await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, 'ADMINISTRADOR_GERAL', 'ORGANIZATION', now())", [org.id, geral.accountId])
    const supervisor = await person("Proof Conv Supervisora", "SUPERVISOR", teamA)
    const larissa = await person("Proof Conv Larissa", "OPERATOR", teamA, supervisor.id)
    const bruno = await person("Proof Conv Bruno", "OPERATOR", teamB)

    // --- Persistência Postgres (store real) --------------------------------------------------------------------
    const store = createPostgresConversationStore(client as never)
    const scopeL = { organizationId: org.id, ownerPersonId: larissa.id }
    const t0 = new Date("2026-09-29T12:00:00.000Z")
    const first = await store.resolveForWrite(scopeL, null, t0)
    expect(first.created).toBe(true)
    expect((await store.resolveForWrite(scopeL, null, t0)).conversationId).toBe(first.conversationId) // não cria segunda
    // O banco garante no máximo UMA conversa ativa por dono.
    await client.query("savepoint dup")
    await expect(client.query("insert into assistant_conversations (organization_id, owner_person_id, started_at, last_activity_at) values ($1, $2, now(), now())", [org.id, larissa.id])).rejects.toThrow(/uq_assistant_conversations_one_active/)
    await client.query("rollback to savepoint dup")

    const base = { conversationId: first.conversationId, organizationId: org.id, ownerPersonId: larissa.id }
    const a = await store.append({ ...base, channel: "chat", role: "user", content: "Como faço a mudança de endereço?", occurredAt: t0, clientMessageId: "11111111-aaaa-4aaa-8aaa-000000000001" })
    const again = await store.append({ ...base, channel: "chat", role: "user", content: "Como faço a mudança de endereço?", occurredAt: t0, clientMessageId: "11111111-aaaa-4aaa-8aaa-000000000001" })
    expect(again).toEqual({ id: a.id, duplicate: true })
    // Resposta do especialista gravada ANTES da pergunta falada, que carrega o instante real: a leitura segue o acontecimento.
    await store.append({ ...base, channel: "voice", role: "assistant", content: "**Mudança de endereço**: acesse o app.", occurredAt: new Date("2026-09-29T12:01:10.000Z"), clientMessageId: "voice-t1:specialist:c1" })
    await store.append({ ...base, channel: "voice", role: "user", content: "E pelo telefone?", occurredAt: new Date("2026-09-29T12:01:05.000Z"), clientMessageId: "voice-t1:user" })
    const page = await store.loadMessages({ organizationId: org.id, conversationId: first.conversationId, limit: 2 })
    expect(page.messages.map((m) => m.content)).toEqual(["E pelo telefone?", "**Mudança de endereço**: acesse o app."])
    expect(page.hasMore).toBe(true)
    const older = await store.loadMessages({ organizationId: org.id, conversationId: first.conversationId, limit: 2, before: { occurredAt: page.messages[0]!.occurredAt, seq: Buffer.from(page.messages[0]!.cursor, "base64url").toString().split("|")[1]! } })
    expect(older.messages.map((m) => m.content)).toEqual(["Como faço a mudança de endereço?"])
    // Com a dona pedida (leitura do esclarecimento — 4ª auditoria): conversa de outra pessoa não devolve nada, nem com cursor.
    expect((await store.loadMessages({ organizationId: org.id, ownerPersonId: larissa.id, conversationId: first.conversationId, limit: 2 })).messages).toHaveLength(2)
    expect(await store.loadMessages({ organizationId: org.id, ownerPersonId: bruno.id, conversationId: first.conversationId, limit: 40 })).toEqual({ messages: [], hasMore: false })
    expect((await store.loadMessages({ organizationId: org.id, ownerPersonId: bruno.id, conversationId: first.conversationId, limit: 2, before: { occurredAt: page.messages[0]!.occurredAt, seq: "999999999" } })).messages).toEqual([])
    expect(await store.contextTurns({ organizationId: org.id, conversationId: first.conversationId })).toHaveLength(3)

    // Inatividade: a próxima mensagem abre outra; a antiga fica encerrada com as mensagens.
    const later = await store.resolveForWrite(scopeL, first.conversationId, new Date(t0.getTime() + 25 * 3_600_000))
    expect(later).toMatchObject({ created: true, rotatedFrom: first.conversationId })
    expect((await client.query("select status, close_reason from assistant_conversations where id = $1", [first.conversationId])).rows[0]).toEqual({ status: "CLOSED", close_reason: "INACTIVITY" })
    await store.append({ conversationId: later.conversationId, organizationId: org.id, ownerPersonId: larissa.id, channel: "chat", role: "user", content: "Nova dúvida", occurredAt: new Date(), clientMessageId: "11111111-aaaa-4aaa-8aaa-000000000002" })
    expect(await store.contextTurns({ organizationId: org.id, conversationId: later.conversationId })).toEqual([{ role: "user", text: "Nova dúvida" }])

    const brunoConv = await store.resolveForWrite({ organizationId: org.id, ownerPersonId: bruno.id }, null, new Date())
    await store.append({ conversationId: brunoConv.conversationId, organizationId: org.id, ownerPersonId: bruno.id, channel: "chat", role: "user", content: "Pergunta do Bruno", occurredAt: new Date(), clientMessageId: "22222222-aaaa-4aaa-8aaa-000000000001" })

    // --- Rotas do próprio operador ------------------------------------------------------------------------------
    const app = createApp(client as never)
    const login = async (email: string) => { const agent = request.agent(app); expect((await agent.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200); return agent }
    const opL = await login(larissa.email)
    const current = await opL.get("/api/v1/realtime/conversations/current")
    expect(current.body.data.conversation.id).toBe(later.conversationId)
    const own = await opL.get("/api/v1/realtime/conversations")
    expect(own.body.data.items.map((item: { id: string }) => item.id)).toEqual([later.conversationId, first.conversationId])
    expect((await opL.get(`/api/v1/realtime/conversations/${brunoConv.conversationId}/messages`)).status).toBe(404)
    const voice = await opL.post("/api/v1/realtime/voice-turn").send({ conversationId: later.conversationId, turnId: "voice-turn-proof", userText: "Obrigada", assistantText: "Por nada!" })
    expect(voice.body.data).toMatchObject({ conversationId: later.conversationId, closed: false })
    // O operador não enxerga o monitoramento.
    expect((await opL.get("/api/v1/admin/assistant-conversations")).status).toBe(403)

    // --- Monitoramento da gestão --------------------------------------------------------------------------------
    const sup = await login(supervisor.email)
    expect((await sup.get("/api/v1/auth/me")).body.data.access.capabilities).toMatchObject({ canViewAssistantConversations: false, canAccessAdministration: false })
    expect((await sup.get("/api/v1/admin/assistant-conversations")).status).toBe(403)

    // Administrador geral concede aos gestores (Minha estrutura), em lote e de forma idempotente.
    const adm = await login(geral.email)
    const grant = await adm.post("/api/v1/admin/access/roles/LEITOR_DE_CONVERSAS_INIA/grant-to-leaders")
    expect(grant.status).toBe(200)
    expect(grant.body.data.granted).toBeGreaterThanOrEqual(1)
    const supGrant = (await client.query("select scope_type from access_role_assignments where user_account_id = $1 and role_code = 'LEITOR_DE_CONVERSAS_INIA' and revoked_at is null", [supervisor.accountId])).rows
    expect(supGrant).toEqual([{ scope_type: "MY_STRUCTURE" }])
    expect((await client.query("select count(*)::int n from access_role_assignments where user_account_id = $1 and role_code = 'LEITOR_DE_CONVERSAS_INIA'", [larissa.accountId])).rows[0].n).toBe(0) // não lidera ninguém
    const audit = await client.query("select payload from audit_logs where action = 'ACCESS_ROLE_GRANTED' and payload->>'recipientAccountId' = $1", [supervisor.accountId])
    expect(audit.rows[0]?.payload).toMatchObject({ roleCode: "LEITOR_DE_CONVERSAS_INIA", scope: { type: "MY_STRUCTURE" } })
    expect((await adm.post("/api/v1/admin/access/roles/LEITOR_DE_CONVERSAS_INIA/grant-to-leaders")).body.data.granted).toBe(0)

    // Supervisora: vê a Larissa (estrutura), não o Bruno; nenhum outro módulo administrativo.
    expect((await sup.get("/api/v1/auth/me")).body.data.access.capabilities).toMatchObject({ canViewAssistantConversations: true, canAccessAdministration: false })
    const list = await sup.get("/api/v1/admin/assistant-conversations?pageSize=50")
    expect(list.status).toBe(200)
    const owners = new Set(list.body.data.items.map((item: { owner: { personId: string } }) => item.owner.personId))
    expect(owners).toEqual(new Set([larissa.id]))
    expect(list.body.data.filterOptions.operators.map((o: { id: string }) => o.id)).toEqual([larissa.id])
    expect((await sup.get(`/api/v1/admin/assistant-conversations/${brunoConv.conversationId}`)).status).toBe(404)
    expect((await sup.get(`/api/v1/admin/assistant-conversations/${brunoConv.conversationId}/messages`)).status).toBe(404)
    expect((await sup.get(`/api/v1/admin/assistant-conversations?ownerPersonId=${bruno.id}`)).body.data.total).toBe(0)
    for (const path of ["/api/v1/admin/agents", "/api/v1/admin/workflows", "/api/v1/admin/access/accounts", "/api/v1/admin/knowledge"]) expect((await sup.get(path)).status, path).toBe(403)
    const messages = await sup.get(`/api/v1/admin/assistant-conversations/${later.conversationId}/messages`)
    expect(messages.body.data.messages.map((m: { role: string; content: string; channel: string }) => [m.role, m.channel, m.content])).toEqual([["user", "chat", "Nova dúvida"], ["user", "voice", "Obrigada"], ["assistant", "voice", "Por nada!"]])
    const filtered = await sup.get(`/api/v1/admin/assistant-conversations?status=CLOSED`)
    expect(filtered.body.data.items.map((item: { id: string }) => item.id)).toEqual([first.conversationId])
    // Contagem de mensagens por voz (só o número) para a lista e o cabeçalho.
    expect(filtered.body.data.items[0].voiceMessageCount).toBe(2)
    // Tipo da conversa (livre × sessão de feedback × recado) e busca também pelo ASSUNTO (título) da conversa.
    const feedbackConversation = (await client.query<{ id: string }>("insert into assistant_conversations (organization_id, owner_person_id, started_at, last_activity_at, origin, title) values ($1, $2, now(), now(), 'FEEDBACK', 'Troca de titularidade') returning id", [org.id, larissa.id])).rows[0]!.id
    const byOrigin = await sup.get(`/api/v1/admin/assistant-conversations?origin=FEEDBACK`)
    expect(byOrigin.body.data.items.map((item: { id: string }) => item.id)).toEqual([feedbackConversation])
    expect((await sup.get(`/api/v1/admin/assistant-conversations?origin=USER&pageSize=50`)).body.data.items.map((item: { id: string }) => item.id)).not.toContain(feedbackConversation)
    expect((await sup.get(`/api/v1/admin/assistant-conversations?search=titularidade`)).body.data.items.map((item: { id: string }) => item.id)).toEqual([feedbackConversation])
    expect((await sup.get(`/api/v1/admin/assistant-conversations?search=Larissa&pageSize=50`)).body.data.total).toBe(3)
    expect((await sup.get(`/api/v1/admin/assistant-conversations?origin=OUTRO`)).status).toBe(400)
    // Somente leitura: não existe rota de escrita.
    expect([403, 404]).toContain((await sup.post(`/api/v1/admin/assistant-conversations/${later.conversationId}/messages`).send({ text: "x" })).status)

    // Administrador geral: organização inteira (Larissa e Bruno), com filtro por grupo.
    const all = await adm.get(`/api/v1/admin/assistant-conversations?pageSize=50&teamId=${teamB}`)
    expect(all.body.data.items.map((item: { id: string }) => item.id)).toEqual([brunoConv.conversationId])
  })
})
