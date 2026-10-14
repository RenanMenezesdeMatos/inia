/**
 * PROVA contra o banco de TESTE real (migration 130): feed do Acompanhamento da estrutura, paginado por cursor (keyset).
 *  - as páginas pelo cursor somam a lista ordenada sem repetir nem pular — inclusive itens no MESMO microssegundo (desempate
 *    por id), com o cursor caindo no meio do empate e entre feedback e aviso; a última página vem sem cursor;
 *  - um item novo publicado entre uma página e outra não desloca a paginação (com OFFSET, o último da página 1 se repetia);
 *  - feedbacks dos liderados e avisos endereçados ao líder no mesmo feed, cada um com os campos da própria origem;
 *  - o conteúdo (view/JSON) só vem para feedback; "aguardando ciência" tira os avisos e os já confirmados; oculto fica fora.
 * Dados commitados e apagados no fim, pelos ids criados.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run follow-up-feed-proof
 */
import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { decodeFollowUpCursor } from "../../feedbacks/domain/follow-up-cursor.js"
import { PgAnalyticsReadRepository } from "../application/analytics-read-repository.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
const created = { people: [] as string[], cases: [] as string[], feedbacks: [] as string[], alerts: [] as string[] }

describe.skipIf(!ENABLED)("Feed da estrutura — prova Postgres (migration 130, keyset)", () => {
  beforeAll(() => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 4 }) })
  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from alerts where id = any($1::uuid[])", [created.alerts])
    await pool.query("delete from feedback_follow_up_hides where feedback_id = any($1::uuid[])", [created.feedbacks])
    await pool.query("delete from feedbacks where id = any($1::uuid[])", [created.feedbacks])
    await pool.query("delete from supervision_cases where id = any($1::uuid[])", [created.cases])
    await pool.query("delete from people where id = any($1::uuid[])", [created.people])
    await pool.end()
  })

  it("páginas sem repetir nem pular, feedbacks e avisos com os campos da origem, filtro de ciência", async () => {
    const team = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const person = async (name: string, role: string) => { const id = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, $2, $3, $4) returning id", [ORG, name, role, team])).rows[0]!.id; created.people.push(id); return id }
    const leader = await person("Proof Feed Líder", "SUPERVISOR")
    const ana = await person("Proof Feed Ana", "OPERATOR")
    const bruno = await person("Proof Feed Bruno", "OPERATOR")
    const newCase = async (operatorId: string) => {
      const id = (await pool.query<{ id: string }>(`insert into supervision_cases (organization_id, operator_id, team_id, title, summary, priority, indicator_code, indicator_value, indicator_target) values ($1, $2, $3, 'Proof', 'Proof', 'P3', 'X', '-', '-') returning id`, [ORG, operatorId, team])).rows[0]!.id
      created.cases.push(id)
      return id
    }
    const feedback = async (operatorId: string, at: string, options: { id?: string; acknowledged?: boolean; title?: string } = {}) => {
      const id = options.id ?? randomUUID()
      const snapshot = options.title ? { feedbackEngine: { feedbackView: { heading: { title: options.title }, card: `Cartão ${options.title}` } } } : {}
      await pool.query(
        `insert into feedbacks (id, organization_id, case_id, operator_id, status, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, feedback_kind, published_at, created_at, acknowledged_at, context_snapshot)
         values ($1, $2, $3, $4, 'PUBLISHED', 'Indicador X', 'evidência', 'comportamento', 'procedimento', 'recomendação', 'MONITORING', $5, $5, case when $6 then $5::timestamptz + interval '1 hour' end, $7)`,
        [id, ORG, await newCase(operatorId), operatorId, at, options.acknowledged ?? false, JSON.stringify(snapshot)],
      )
      created.feedbacks.push(id)
      return id
    }
    const same = "2026-09-20T10:00:00.123456Z"
    const prefix = randomUUID().slice(0, 23)
    const ties = [await feedback(ana, same, { id: `${prefix}-0000000000b1` }), await feedback(bruno, same, { id: `${prefix}-0000000000b3` }), await feedback(ana, same, { id: `${prefix}-0000000000b2` })]
    const withView = await feedback(bruno, "2026-09-25T09:00:00Z", { title: "Título da narrativa" })
    const acknowledged = await feedback(ana, "2026-09-18T09:00:00Z", { acknowledged: true })
    const hidden = await feedback(bruno, "2026-09-26T09:00:00Z")
    await pool.query("insert into feedback_follow_up_hides (organization_id, feedback_id, reason_code, reason, selection_ref, hidden_at) values ($1, $2, 'DEVELOPMENT_ARTIFACT', 'prova', 'PROOF', now())", [ORG, hidden])
    const alertCase = await newCase(ana)
    const alert = (await pool.query<{ id: string }>(
      `insert into alerts (organization_id, case_id, recipient_id, title, description, severity, alert_type, dedupe_key, created_at) values ($1, $2, $3, 'Saída do workflow', 'Descrição do aviso', 'MEDIUM', 'WORKFLOW_OUTPUT', $4, '2026-09-22T09:00:00Z') returning id`,
      [ORG, alertCase, leader, `proof_feed:${randomUUID()}`],
    )).rows[0]!.id
    created.alerts.push(alert)

    const repository = new PgAnalyticsReadRepository(pool)
    const base = { organizationId: ORG, viewerId: leader, operatorIds: [ana, bruno], includeViewerAlerts: true, unacknowledgedOnly: false }
    const expected = [withView, alert, ...[...ties].sort().reverse(), acknowledged]
    const pages = async (limit: number, between?: () => Promise<unknown>) => {
      const collected: string[][] = []
      let cursor: string | null = null
      do {
        const result = await repository.loadFollowUpFeed({ ...base, limit, before: decodeFollowUpCursor(cursor) })
        collected.push(result.items.map((item) => item.id))
        cursor = result.nextCursor
        if (collected.length === 1) await between?.()
      } while (cursor && collected.length < 10)
      return collected
    }
    // Páginas de 2: o cursor da 2ª cai entre o aviso e o empate; o da 3ª, no MEIO do empate (mesmo microssegundo).
    expect(await pages(2)).toEqual([[withView, alert], expected.slice(2, 4), expected.slice(4, 6)])
    // Páginas de 1 e de 4 (a última incompleta): sempre a mesma lista, e a última página vem sem cursor.
    expect((await pages(1)).flat()).toEqual(expected)
    expect(await pages(4)).toEqual([expected.slice(0, 4), expected.slice(4)])
    // Feed exato: a página que fecha o feed não aponta para uma página vazia.
    expect(await pages(6)).toEqual([expected])

    const all = await repository.loadFollowUpFeed({ ...base, limit: 50, before: null })
    const byId = new Map(all.items.map((item) => [item.id, item]))
    expect(byId.get(withView)).toMatchObject({ kind: "FEEDBACK", category: "MONITORING", title: "Título da narrativa", summary: "Cartão Título da narrativa", detail: "recomendação", severity: null, operator: { personId: bruno, name: "Proof Feed Bruno" }, acknowledgedAt: null })
    expect(byId.get(withView)?.feedback).toMatchObject({ evidenceFound: "evidência", observedBehavior: "comportamento", recommendation: "recomendação" })
    expect(byId.get(alert)).toMatchObject({ kind: "ALERT", title: "Saída do workflow", subtitle: null, summary: "Descrição do aviso", detail: null, severity: "MEDIUM", operator: { personId: ana, name: "Proof Feed Ana" }, caseId: alertCase, acknowledgedAt: null, feedback: null })
    expect(byId.get(acknowledged)?.acknowledgedAt).not.toBeNull()
    expect(byId.has(hidden)).toBe(false)

    // "Aguardando ciência": nem aviso, nem feedback já confirmado.
    const pending = await repository.loadFollowUpFeed({ ...base, unacknowledgedOnly: true, limit: 50, before: null })
    expect(pending.items.map((item) => item.id)).toEqual([withView, ...[...ties].sort().reverse()])
    expect(pending.nextCursor).toBeNull()
    // Cursor no último item: página vazia, sem cursor.
    expect(await repository.loadFollowUpFeed({ ...base, limit: 2, before: { at: "2026-09-18T09:00:00.000000Z", id: acknowledged } })).toEqual({ items: [], nextCursor: null })

    // Um feedback publicado depois da 1ª página não desloca as seguintes: nada repete, nada some (com OFFSET, o último item da
    // página 1 voltava no topo da página 2).
    const late = await pages(2, () => feedback(ana, "2026-09-27T09:00:00Z"))
    expect(late.flat()).toEqual(expected)
  })
})
