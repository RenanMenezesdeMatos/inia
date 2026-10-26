/**
 * PROVA contra o banco de TESTE real: curtir/descurtir das respostas da INIA no chat (migration 158) — store Postgres (dona da
 * conversa, só respostas da INIA, histórico com `superseded_at`, no máximo uma vigente por pessoa × resposta, idempotência e
 * cascata quando a resposta é apagada). Tudo numa transação desfeita no fim (banco intacto). Nenhuma chamada de modelo.
 *   INIA_DB_PROOF=1 npx vitest run assistant-interaction-ratings-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createPostgresConversationStore } from "../application/assistant-conversations.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Curtir/descurtir no chat — prova Postgres", () => {
  beforeAll(async () => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL }); client = await pool.connect(); await client.query("begin") })
  afterAll(async () => { if (client) { await client.query("rollback"); client.release() } if (pool) await pool.end() })

  it("histórico, vigente única, dona da conversa, só respostas da INIA e cascata", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!.id
    const person = async (name: string) => (await client.query<{ id: string }>("insert into people (organization_id, name, role, job_title) values ($1, $2, 'OPERATOR', 'OPERATOR') returning id", [org, name])).rows[0]!.id
    const larissa = await person("Proof Avaliação Larissa")
    const bruno = await person("Proof Avaliação Bruno")
    const store = createPostgresConversationStore(client as never)
    const scope = { organizationId: org, ownerPersonId: larissa }
    const t0 = new Date("2026-10-22T12:00:00.000Z")
    const { conversationId } = await store.resolveForWrite(scope, null, t0)
    const base = { conversationId, organizationId: org, ownerPersonId: larissa }
    const question = await store.append({ ...base, channel: "chat", role: "user", content: "Qual é o prazo da contestação?", occurredAt: t0, clientMessageId: "33333333-aaaa-4aaa-8aaa-000000000001" })
    const answer = await store.append({ ...base, channel: "chat", role: "assistant", content: "Até 5 dias úteis.", occurredAt: new Date("2026-10-22T12:00:05.000Z"), clientMessageId: "33333333-aaaa-4aaa-8aaa-000000000001:assistant" })
    const rows = async () => (await client.query<{ value: string; superseded: boolean }>("select value, superseded_at is not null superseded from assistant_interaction_ratings where interaction_id = $1 order by created_at", [answer.id])).rows

    expect(await store.rate(scope, { conversationId, interactionId: answer.id, value: "UP" }, new Date("2026-10-22T12:01:00.000Z"))).toBe("up")
    expect(await store.rate(scope, { conversationId, interactionId: answer.id, value: "UP" }, new Date("2026-10-22T12:01:01.000Z"))).toBe("up")
    expect(await rows()).toEqual([{ value: "UP", superseded: false }])
    expect(await store.ratingsOf(scope, [answer.id, question.id])).toEqual(new Map([[answer.id, "up"]]))

    expect(await store.rate(scope, { conversationId, interactionId: answer.id, value: "DOWN" }, new Date("2026-10-22T12:02:00.000Z"))).toBe("down")
    expect(await store.rate(scope, { conversationId, interactionId: answer.id, value: "NONE" }, new Date("2026-10-22T12:03:00.000Z"))).toBeNull()
    expect(await rows()).toEqual([{ value: "UP", superseded: true }, { value: "DOWN", superseded: true }, { value: "NONE", superseded: false }])
    expect(await store.ratingsOf(scope, [answer.id])).toEqual(new Map())

    // O banco garante no máximo UMA avaliação vigente por pessoa × resposta.
    await client.query("savepoint dup")
    await expect(client.query("insert into assistant_interaction_ratings (organization_id, person_id, conversation_id, interaction_id, value) values ($1, $2, $3, $4, 'UP')", [org, larissa, conversationId, answer.id])).rejects.toThrow(/assistant_interaction_ratings_current/)
    await client.query("rollback to savepoint dup")

    // Fora da dona, mensagem da pessoa ou conversa errada: 404, nada gravado.
    const reject = (promise: Promise<unknown>) => expect(promise).rejects.toMatchObject({ code: "ASSISTANT_MESSAGE_NOT_FOUND", statusCode: 404 })
    await reject(store.rate({ organizationId: org, ownerPersonId: bruno }, { conversationId, interactionId: answer.id, value: "UP" }, t0))
    await reject(store.rate(scope, { conversationId, interactionId: question.id, value: "UP" }, t0))
    const other = await store.resolveForWrite({ organizationId: org, ownerPersonId: bruno }, null, t0)
    await reject(store.rate(scope, { conversationId: other.conversationId, interactionId: answer.id, value: "UP" }, t0))
    expect(await rows()).toHaveLength(3)

    // A resposta apagada (retenção) leva a avaliação junto.
    await client.query("delete from assistant_interactions where id = $1", [answer.id])
    expect(await rows()).toHaveLength(0)
  })
})
