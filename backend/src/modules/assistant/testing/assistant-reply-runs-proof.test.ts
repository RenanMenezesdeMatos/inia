/**
 * Resposta do chat em andamento (`assistant-reply-runs.ts`, migration 245) — prova contra o PostgreSQL de teste:
 * a linha nasce com a pergunta, a etapa fica visível para quem volta (`pending`), o "Parar" feito em OUTRA instância da API chega à
 * que gera pelo batimento, outra pessoa nunca cancela nem enxerga a resposta, e a linha sai no fim.
 *
 *   INIA_DB_PROOF=1 npx vitest run assistant-reply-runs-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createPostgresConversationStore } from "../application/assistant-conversations.js"
import { createPostgresReplyRunRegistry } from "../application/assistant-reply-runs.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(!ENABLED)("Resposta do chat em andamento — prova Postgres", () => {
  beforeAll(async () => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL }); client = await pool.connect(); await client.query("begin") })
  afterAll(async () => { if (client) { await client.query("rollback"); client.release() } if (pool) await pool.end() })

  it("em andamento visível para quem volta, Parar entre instâncias, dono único e limpeza no fim", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!.id
    const person = async (name: string) => (await client.query<{ id: string }>("insert into people (organization_id, name, role, job_title) values ($1, $2, 'OPERATOR', 'OPERATOR') returning id", [org, name])).rows[0]!.id
    const larissa = await person("Proof Resposta Larissa")
    const bruno = await person("Proof Resposta Bruno")
    const store = createPostgresConversationStore(client as never)
    const scope = { organizationId: org, ownerPersonId: larissa }
    const { conversationId } = await store.resolveForWrite(scope, null, new Date())
    const key = "44444444-aaaa-4aaa-8aaa-000000000001"
    const question = await store.append({ conversationId, organizationId: org, ownerPersonId: larissa, channel: "chat", role: "user", content: "Como abro uma contestação?", occurredAt: new Date(), clientMessageId: key })

    // Duas instâncias da API: a que gera e a que recebe o "Parar" (o ARR distribui as requests).
    const generating = createPostgresReplyRunRegistry(client as never, { heartbeatMs: 30 })
    const other = createPostgresReplyRunRegistry(client as never, { heartbeatMs: 30 })
    const run = await generating.start({ organizationId: org, ownerPersonId: larissa, clientMessageId: key, conversationId, questionInteractionId: question.id })
    run.stage("Consultando a base de conhecimento…")
    await sleep(60)

    // Quem volta (em qualquer instância) vê a resposta em andamento com a etapa real; outra pessoa não.
    expect(await other.pending({ organizationId: org, ownerPersonId: larissa, conversationId })).toMatchObject({ questionInteractionId: question.id, clientMessageId: key, label: "Consultando a base de conhecimento…" })
    expect(await other.pending({ organizationId: org, ownerPersonId: bruno, conversationId })).toBeNull()

    // Outra pessoa não cancela a resposta de ninguém.
    expect(await other.requestCancel({ organizationId: org, ownerPersonId: bruno, clientMessageId: key })).toBe(false)
    await sleep(90)
    expect(run.signal.aborted).toBe(false)

    // O "Parar" da dona, recebido pela OUTRA instância, chega à que gera pelo batimento.
    expect(await other.requestCancel({ organizationId: org, ownerPersonId: larissa, clientMessageId: key })).toBe(true)
    for (let index = 0; index < 50 && !run.signal.aborted; index += 1) await sleep(20)
    expect(run.signal.aborted).toBe(true)
    // Cancelada não conta mais como "ainda respondendo".
    expect(await other.pending({ organizationId: org, ownerPersonId: larissa, conversationId })).toBeNull()

    await run.finish()
    expect((await client.query("select 1 from assistant_reply_runs where conversation_id = $1", [conversationId])).rowCount).toBe(0)

    // Uma resposta que termina normalmente também sai, sem nunca ser cancelada.
    const second = await generating.start({ organizationId: org, ownerPersonId: larissa, clientMessageId: `${key}-2`, conversationId, questionInteractionId: question.id })
    await sleep(60)
    expect(second.signal.aborted).toBe(false)
    await second.finish()
    expect(await other.pending({ organizationId: org, ownerPersonId: larissa, conversationId })).toBeNull()
  })
})
