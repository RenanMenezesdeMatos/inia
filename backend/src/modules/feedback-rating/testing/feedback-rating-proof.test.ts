/**
 * PROVA contra o banco de TESTE real — avaliação do feedback pelo destinatário (migration 113). Fixture apagada no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run feedback-rating-proof
 *
 * Prova: curtir grava; repetir não grava de novo; descurtir encerra a anterior (histórico) com motivo + descrição; retirar some
 * da lista e fica no histórico; 5 avaliações CONCORRENTES = uma vigente; feedback de outra pessoa, oculto ou não publicado = 404.
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { listMyRatings, rateFeedback } from "../application/feedback-rating-service.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
const db = () => pool as unknown as Database

describe.skipIf(!ENABLED)("Avaliação do feedback — prova Postgres", () => {
  const created = { people: [] as string[], cases: [] as string[], feedbacks: [] as string[] }
  let teamId: string
  let joana: string
  let other: string
  let published: string
  let draft: string
  let othersFeedback: string

  async function feedbackOf(operatorId: string, status: "PUBLISHED" | "DRAFT") {
    const caseId = (await pool.query<{ id: string }>(
      `insert into supervision_cases (organization_id, operator_id, team_id, title, summary, priority, indicator_code, indicator_value, indicator_target) values ($1,$2,$3,'Prova avaliação','Resumo.','P3','TMA','400','380') returning id`,
      [ORG, operatorId, teamId],
    )).rows[0]!.id
    created.cases.push(caseId)
    const id = (await pool.query<{ id: string }>(
      `insert into feedbacks (organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, published_at)
       values ($1,$2,$3,$4::text::feedback_status,'MONITORING','—','—','—','—','Texto.',case when $4::text = 'PUBLISHED' then now() end) returning id`,
      [ORG, caseId, operatorId, status],
    )).rows[0]!.id
    created.feedbacks.push(id)
    return id
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 })
    teamId = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    for (const name of ["Joana Prova Avaliação", "Outra Pessoa Prova Avaliação"]) {
      created.people.push((await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1,$2,'OPERATOR',$3) returning id", [ORG, name, teamId])).rows[0]!.id)
    }
    ;[joana, other] = created.people as [string, string]
    published = await feedbackOf(joana, "PUBLISHED")
    draft = await feedbackOf(joana, "DRAFT")
    othersFeedback = await feedbackOf(other, "PUBLISHED")
  })

  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from feedback_ratings where person_id = any($1)", [created.people])
    await pool.query("delete from feedback_follow_up_hides where feedback_id = any($1)", [created.feedbacks])
    await pool.query("delete from feedbacks where id = any($1)", [created.feedbacks])
    await pool.query("delete from supervision_cases where id = any($1)", [created.cases])
    await pool.query("delete from people where id = any($1)", [created.people])
    await pool.end()
  })

  const scope = () => ({ organizationId: ORG, personId: joana })
  const source = () => ({ kind: "PUBLISHED_FEEDBACK" as const, id: published })
  const history = async () => (await pool.query<{ value: string; reason: string | null; superseded_at: Date | null }>("select value, reason, superseded_at from feedback_ratings where feedback_id = $1 order by created_at, id", [published])).rows

  it("curtir grava uma vez; repetir não duplica", async () => {
    const first = await rateFeedback(db(), scope(), { source: source(), value: "UP" }, new Date())
    expect(first).toMatchObject({ source: source(), value: "UP", reason: null, comment: null })
    await rateFeedback(db(), scope(), { source: source(), value: "UP" }, new Date())
    expect(await history()).toHaveLength(1)
    expect(await listMyRatings(db(), scope())).toEqual([expect.objectContaining({ value: "UP" })])
  })

  it("descurtir encerra a anterior e grava motivo + descrição", async () => {
    const down = await rateFeedback(db(), scope(), { source: source(), value: "DOWN", reason: "WRONG_PROCESS", comment: "O prazo certo é de 7 dias úteis." }, new Date())
    expect(down).toMatchObject({ value: "DOWN", reason: "WRONG_PROCESS", comment: "O prazo certo é de 7 dias úteis." })
    const rows = await history()
    expect(rows.map((row) => [row.value, row.superseded_at !== null])).toEqual([["UP", true], ["DOWN", false]])
  })

  it("retirar some da lista e fica no histórico", async () => {
    expect(await rateFeedback(db(), scope(), { source: source(), value: "NONE" }, new Date())).toBeNull()
    expect(await listMyRatings(db(), scope())).toEqual([])
    expect((await history()).map((row) => row.value)).toEqual(["UP", "DOWN", "NONE"])
  })

  it("5 avaliações concorrentes deixam exatamente uma vigente", async () => {
    await Promise.all([0, 1, 2, 3, 4].map((index) => rateFeedback(db(), scope(), index % 2 ? { source: source(), value: "UP" } : { source: source(), value: "DOWN", reason: "UNCLEAR", comment: `Tentativa ${index}` }, new Date())))
    const current = (await history()).filter((row) => row.superseded_at === null)
    expect(current).toHaveLength(1)
    expect(await listMyRatings(db(), scope())).toHaveLength(1)
  })

  it("feedback de outra pessoa, não publicado ou oculto do Acompanhamento = 404", async () => {
    await expect(rateFeedback(db(), scope(), { source: { kind: "PUBLISHED_FEEDBACK", id: othersFeedback }, value: "UP" }, new Date())).rejects.toMatchObject({ statusCode: 404 })
    await expect(rateFeedback(db(), scope(), { source: { kind: "PUBLISHED_FEEDBACK", id: draft }, value: "UP" }, new Date())).rejects.toMatchObject({ statusCode: 404 })
    await expect(rateFeedback(db(), scope(), { source: { kind: "INTERACTION_FEEDBACK_DELIVERY", id: published }, value: "UP" }, new Date())).rejects.toMatchObject({ statusCode: 404 })
    await pool.query(
      "insert into feedback_follow_up_hides (organization_id, feedback_id, reason_code, reason, selection_ref, hidden_at) values ($1,$2,'DEVELOPMENT_ARTIFACT','Prova','PROVA_AVALIACAO',now())",
      [ORG, published],
    )
    await expect(rateFeedback(db(), scope(), { source: source(), value: "UP" }, new Date())).rejects.toMatchObject({ statusCode: 404 })
  })
})
