/**
 * PROVA contra o banco de TESTE real: curtir/descurtir das respostas da INIA no chat (migration 158) — store Postgres (dona da
 * conversa, só respostas da INIA, histórico com `superseded_at`, no máximo uma vigente por pessoa × resposta, idempotência e
 * cascata quando a resposta é apagada) — e, desde a migration 181 (Apoio com Anjo, Parte A), o motivo da descurtida (versões,
 * catálogo, só no chat livre) e os sinais da resposta (linha para toda mensagem da INIA do chat livre, `NO_REPLY` na pergunta,
 * exportação do titular e retenção). Tudo numa transação desfeita no fim (banco intacto). Nenhuma chamada de modelo.
 *   INIA_DB_PROOF=1 npx vitest run assistant-interaction-ratings-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { exportSubjectData } from "../../data-lifecycle/application/subject-data-export.js"
import { createPostgresConversationStore } from "../application/assistant-conversations.js"
import { replyFunnel } from "../application/reply-funnel.js"
import { buildSupportContext } from "../application/support-context.js"

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

    const liked = await store.rate(scope, { conversationId, interactionId: answer.id, value: "UP" }, new Date("2026-10-22T12:01:00.000Z"))
    expect(liked).toMatchObject({ rating: "up", details: null, conversationOrigin: "USER", written: true })
    expect(await store.rate(scope, { conversationId, interactionId: answer.id, value: "UP" }, new Date("2026-10-22T12:01:01.000Z"))).toMatchObject({ rating: "up", ratingId: liked.ratingId, written: false })
    expect(await rows()).toEqual([{ value: "UP", superseded: false }])
    expect(await store.ratingsOf(scope, [answer.id, question.id])).toEqual(new Map([[answer.id, { rating: "up", ratingId: liked.ratingId, details: null }]]))

    expect((await store.rate(scope, { conversationId, interactionId: answer.id, value: "DOWN" }, new Date("2026-10-22T12:02:00.000Z"))).rating).toBe("down")
    expect(await store.rate(scope, { conversationId, interactionId: answer.id, value: "NONE" }, new Date("2026-10-22T12:03:00.000Z"))).toMatchObject({ rating: null, ratingId: null, written: true })
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

  it("migration 181: motivo da descurtida com versões e catálogo, só no chat livre; sinais em toda resposta do chat livre; NO_REPLY; exportação e retenção", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!.id
    const person = async (name: string) => (await client.query<{ id: string }>("insert into people (organization_id, name, role, job_title) values ($1, $2, 'OPERATOR', 'OPERATOR') returning id", [org, name])).rows[0]!.id
    const joana = await person("Proof Apoio Joana")
    const caio = await person("Proof Apoio Caio")
    const store = createPostgresConversationStore(client as never)
    const scope = { organizationId: org, ownerPersonId: joana }
    const t0 = new Date("2026-11-09T12:00:00.000Z")
    const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000)
    const { conversationId } = await store.resolveForWrite(scope, null, t0)
    const base = { conversationId, organizationId: org, ownerPersonId: joana }
    const question = await store.append({ ...base, channel: "chat", role: "user", content: "Como cancelo a linha?", occurredAt: t0, clientMessageId: "44444444-aaaa-4aaa-8aaa-000000000001" })
    const answer = await store.append({ ...base, channel: "chat", role: "assistant", content: "Não encontrei nas bases.", occurredAt: at(5), clientMessageId: "44444444-aaaa-4aaa-8aaa-000000000001:reply", signals: ["KNOWLEDGE_NOT_FOUND"] })
    const plain = await store.append({ ...base, channel: "voice", role: "assistant", content: "Olá!", occurredAt: at(6), clientMessageId: "voice-turn-x:assistant" })
    const signalRows = async (id: string) => (await client.query<{ signals: string[]; signal_version: string; person_id: string }>("select signals, signal_version, person_id from assistant_reply_signals where interaction_id = $1", [id])).rows

    // Toda mensagem da INIA do chat livre tem linha (vazia quando não houve sinal); a pergunta, não.
    expect(await signalRows(answer.id)).toEqual([{ signals: ["KNOWLEDGE_NOT_FOUND"], signal_version: "SUPPORT_SIGNALS_V1", person_id: joana }])
    expect(await signalRows(plain.id)).toEqual([{ signals: [], signal_version: "SUPPORT_SIGNALS_V1", person_id: joana }])
    expect(await signalRows(question.id)).toEqual([])
    // Retentativa com a mesma chave: nada é gravado de novo.
    const again = await store.append({ ...base, channel: "chat", role: "assistant", content: "Não encontrei nas bases.", occurredAt: at(7), clientMessageId: "44444444-aaaa-4aaa-8aaa-000000000001:reply", signals: ["KNOWLEDGE_NOT_FOUND"] })
    expect(again).toMatchObject({ id: answer.id, duplicate: true })
    expect(await signalRows(answer.id)).toHaveLength(1)
    // O banco recusa código fora do catálogo.
    await client.query("savepoint bad_signal")
    await expect(client.query("update assistant_reply_signals set signals = array['PHRASE_MATCH'] where interaction_id = $1", [plain.id])).rejects.toThrow(/check/)
    await client.query("rollback to savepoint bad_signal")

    // NO_REPLY: na pergunta da própria dona, uma vez; de outra pessoa ou numa resposta da INIA, nada.
    expect(await store.markNoReply({ organizationId: org, ownerPersonId: caio }, question.id)).toBe(false)
    expect(await store.markNoReply(scope, answer.id)).toBe(false)
    expect(await store.markNoReply(scope, question.id)).toBe(true)
    expect(await store.markNoReply(scope, question.id)).toBe(false)
    expect(await signalRows(question.id)).toEqual([{ signals: ["NO_REPLY"], signal_version: "SUPPORT_SIGNALS_V1", person_id: joana }])
    const page = await store.loadMessages({ organizationId: org, conversationId, limit: 50 })
    expect(page.messages.map((message) => [message.id, message.signals])).toEqual([[question.id, ["NO_REPLY"]], [answer.id, ["KNOWLEDGE_NOT_FOUND"]], [plain.id, []]])

    // Motivo da descurtida: versão com catálogo; sem motivo por cima não grava; motivo diferente = versão nova.
    const details = { reason: "NOT_FOUND" as const, comment: "Faltou o passo do cancelamento.", stillNeedsHelp: true }
    const first = await store.rate(scope, { conversationId, interactionId: answer.id, value: "DOWN", details }, at(10))
    expect(first).toMatchObject({ rating: "down", details, conversationOrigin: "USER", written: true })
    expect(await store.rate(scope, { conversationId, interactionId: answer.id, value: "DOWN" }, at(11))).toMatchObject({ ratingId: first.ratingId, details, written: false })
    const second = await store.rate(scope, { conversationId, interactionId: answer.id, value: "DOWN", details: { ...details, stillNeedsHelp: false } }, at(12))
    expect(second.written).toBe(true)
    const detailRows = (await client.query<{ rating_id: string; reason: string; still_needs_help: boolean; catalog_version: string; person_id: string; superseded: boolean }>(
      `select d.rating_id, d.reason, d.still_needs_help, d.catalog_version, d.person_id, r.superseded_at is not null superseded
         from assistant_interaction_rating_details d join assistant_interaction_ratings r on r.id = d.rating_id where r.interaction_id = $1 order by r.created_at`, [answer.id])).rows
    expect(detailRows).toEqual([
      { rating_id: first.ratingId, reason: "NOT_FOUND", still_needs_help: true, catalog_version: "CHAT_DISLIKE_REASONS_V1", person_id: joana, superseded: true },
      { rating_id: second.ratingId, reason: "NOT_FOUND", still_needs_help: false, catalog_version: "CHAT_DISLIKE_REASONS_V1", person_id: joana, superseded: false },
    ])
    expect((await store.ratingsOf(scope, [answer.id])).get(answer.id)).toEqual({ rating: "down", ratingId: second.ratingId, details: { ...details, stillNeedsHelp: false } })
    // "Outro" sem comentário é recusado pelo banco também.
    await client.query("savepoint other_without_comment")
    await expect(client.query("insert into assistant_interaction_rating_details (rating_id, organization_id, person_id, reason, comment, still_needs_help, catalog_version) values ($1, $2, $3, 'OTHER', null, false, 'CHAT_DISLIKE_REASONS_V1')", [first.ratingId, org, joana])).rejects.toThrow()
    await client.query("rollback to savepoint other_without_comment")

    // Conversa de Workflow: o motivo é 422 e nenhuma resposta ganha linha de sinais.
    const workflow = (await client.query<{ id: string }>(`insert into assistant_conversations (organization_id, owner_person_id, kind, status, origin, title, started_at, last_activity_at) values ($1, $2, 'CONVERSATION', 'ACTIVE', 'WORKFLOW', 'Recado', $3, $3) returning id`, [org, joana, t0])).rows[0]!.id
    const recado = await store.append({ conversationId: workflow, organizationId: org, ownerPersonId: joana, channel: "chat", role: "assistant", content: "Recado.", occurredAt: t0, clientMessageId: `workflow-output:${workflow}`, signals: ["KNOWLEDGE_NOT_FOUND"] })
    expect(await signalRows(recado.id)).toEqual([])
    await expect(store.rate(scope, { conversationId: workflow, interactionId: recado.id, value: "DOWN", details }, at(20))).rejects.toMatchObject({ code: "RATING_DETAILS_NOT_ALLOWED", statusCode: 422 })
    expect((await store.rate(scope, { conversationId: workflow, interactionId: recado.id, value: "DOWN" }, at(21))).rating).toBe("down")
    const recadoQuestion = await store.append({ conversationId: workflow, organizationId: org, ownerPersonId: joana, channel: "chat", role: "user", content: "E agora?", occurredAt: at(22), clientMessageId: "44444444-aaaa-4aaa-8aaa-000000000009" })
    expect(await store.markNoReply(scope, recadoQuestion.id)).toBe(false)

    // Cópia da troca (prévia/criação do pedido de apoio), lida das linhas reais.
    expect(await buildSupportContext(client as never, { organizationId: org, ownerPersonId: joana, interactionId: answer.id, ratingId: first.ratingId })).toEqual({
      conversationId,
      facts: { dislikeNeedsHelp: true, signals: ["KNOWLEDGE_NOT_FOUND"] },
      sharedContext: { question: "Como cancelo a linha?", answer: "Não encontrei nas bases.", dislike: { reason: "NOT_FOUND", reasonLabel: "Não encontrou a informação", comment: "Faltou o passo do cancelamento." } },
    })
    expect((await buildSupportContext(client as never, { organizationId: org, ownerPersonId: joana, interactionId: answer.id, ratingId: second.ratingId }))!.facts.dislikeNeedsHelp).toBe(false)
    expect((await buildSupportContext(client as never, { organizationId: org, ownerPersonId: joana, interactionId: plain.id }))!.sharedContext.question).toBe("Como cancelo a linha?")
    expect(await buildSupportContext(client as never, { organizationId: org, ownerPersonId: joana, interactionId: question.id })).toEqual({ conversationId, facts: { dislikeNeedsHelp: false, signals: ["NO_REPLY"] }, sharedContext: { question: "Como cancelo a linha?", answer: null, dislike: null } })
    expect(await buildSupportContext(client as never, { organizationId: org, ownerPersonId: caio, interactionId: answer.id })).toBeNull()
    expect(await buildSupportContext(client as never, { organizationId: org, ownerPersonId: joana, interactionId: recado.id })).toBeNull()

    // Funil M1–M6 sobre o Grupo ATUAL da dona (um Grupo criado aqui isola os números do resto do banco de teste). A etapa de
    // esclarecimento aguardando escolha não é resposta; a conversa de Workflow não entra.
    await store.append({ ...base, channel: "chat", role: "assistant", content: "Qual é o seu plano?", occurredAt: at(8), clientMessageId: "44444444-aaaa-4aaa-8aaa-000000000002:reply", toolCalls: [{ toolName: "knowledge_clarification", state: { status: "OPEN" } }] })
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 order by created_at limit 1", [org])).rows[0]!.id
    const team = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Funil Apoio') returning id", [org, operation])).rows[0]!.id
    await client.query("update people set team_id = $1, subteam_id = null where id = $2", [team, joana])
    const funnel = await replyFunnel(client as never, org, { from: "2026-11-09", to: "2026-11-09" }, { kind: "UNITS", teamIds: [team], subteamIds: [] })
    const byId = new Map(funnel.measures.map((item) => [item.id, item]))
    expect(byId.get("M1")!.main.value).toBe(2)
    expect(byId.get("M2")!.main).toEqual({ numerator: 1, denominator: 2, value: null, status: "SMALL_SAMPLE" })
    expect(byId.get("M4")!.breakdown!.filter((item) => item.count > 0).map((item) => [item.key, item.count])).toEqual([["NOT_FOUND", 1]])
    expect(byId.get("M5")!.main).toMatchObject({ numerator: 0, denominator: 1 })
    expect(byId.get("M6")!.main).toMatchObject({ numerator: 1, denominator: 2 })
    expect(byId.get("M6")!.breakdown!.filter((item) => item.count > 0).map((item) => [item.key, item.count])).toEqual([["KNOWLEDGE_NOT_FOUND", 1], ["NO_REPLY", 1]])
    expect(funnel.cutoffs.dislikeDetailsSince).not.toBeNull()
    expect(funnel.cutoffs.signalsSince).not.toBeNull()
    // Fora do recorte (outro dia, ou Subgrupo que não é o da pessoa): nada.
    expect((await replyFunnel(client as never, org, { from: "2026-11-08", to: "2026-11-08" }, { kind: "UNITS", teamIds: [team], subteamIds: [] })).measures[0]!.main.value).toBe(0)
    expect((await replyFunnel(client as never, org, { from: "2026-11-09", to: "2026-11-09" }, { kind: "UNITS", teamIds: [team], subteamIds: [] }, { subteamId: "00000000-0000-4000-8000-0000000000aa" })).measures[0]!.main.value).toBe(0)

    // Exportação do titular: o motivo e os sinais vão junto (seguem `person_id` → people).
    const exported = await exportSubjectData(client as never, { organizationId: org, personId: joana, actorPersonId: joana, at: at(30) })
    const section = (table: string) => exported.sections.find((item) => item.table === table)
    expect(section("assistant_interaction_rating_details")!.rows.map((row) => row.rating_id).sort()).toEqual([first.ratingId, second.ratingId].sort())
    expect(section("assistant_reply_signals")!.rows.map((row) => row.interaction_id)).toEqual(expect.arrayContaining([question.id, answer.id, plain.id]))

    // Retenção (a resposta apagada): sinais, avaliações e motivos saem junto.
    await client.query("delete from assistant_interactions where id = $1", [answer.id])
    expect(await signalRows(answer.id)).toEqual([])
    expect((await client.query("select 1 from assistant_interaction_rating_details where rating_id = any($1::uuid[])", [[first.ratingId, second.ratingId]])).rowCount).toBe(0)
  })
})
