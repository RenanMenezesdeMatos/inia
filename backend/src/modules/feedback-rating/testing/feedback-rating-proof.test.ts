/**
 * PROVA contra o banco de TESTE real — avaliação no item do Acompanhamento (migrations 113 e 186). Fixture apagada no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run feedback-rating-proof
 *
 * Prova: o histórico do "Este conteúdo foi útil?" (que a tela não grava mais) fica como está e NUNCA vira concordância —
 * curtir antigo não aparece; "não foi útil" vigente aparece como contestação antiga (com ou sem ciência); "não foi útil" trocado
 * ou retirado não aparece; a escolha registrada na ciência aparece à parte; só para a própria pessoa (fonte de outra = nada).
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { loadFeedbackEvaluations } from "../application/feedback-evaluation-reader.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
const db = () => pool as unknown as Database

describe.skipIf(!ENABLED)("Avaliação no item do Acompanhamento — prova Postgres", () => {
  const created = { people: [] as string[], cases: [] as string[], feedbacks: [] as string[], accounts: [] as string[] }
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
    // "Não foi útil" avisa quem revisa contestações na organização (migration 150): os avisos destas avaliações saem junto.
    await pool.query("delete from alerts where alert_type like 'FEEDBACK_CONTESTATION_%' and split_part(dedupe_key, ':', 2) in (select id::text from feedback_ratings where person_id = any($1))", [created.people])
    await pool.query("delete from feedback_ratings where person_id = any($1)", [created.people])
    await pool.query("delete from feedback_read_agreements where person_id = any($1)", [created.people])
    await pool.query("delete from user_accounts where id = any($1)", [created.accounts])
    await pool.query("delete from feedback_follow_up_hides where feedback_id = any($1)", [created.feedbacks])
    await pool.query("delete from feedbacks where id = any($1)", [created.feedbacks])
    await pool.query("delete from supervision_cases where id = any($1)", [created.cases])
    await pool.query("delete from people where id = any($1)", [created.people])
    await pool.end()
  })

  const key = (id: string) => `PUBLISHED_FEEDBACK:${id}`
  const rating = (feedbackId: string, personId: string, value: "UP" | "DOWN" | "NONE", superseded = false) =>
    pool.query(
      `insert into feedback_ratings (organization_id, person_id, source_kind, feedback_id, value, reason, comment, created_at, superseded_at)
       values ($1,$2,'PUBLISHED_FEEDBACK',$3,$4,$5,$6, now() - interval '1 hour', case when $7::boolean then now() end)`,
      [ORG, personId, feedbackId, value, value === "DOWN" ? "UNCLEAR" : null, value === "DOWN" ? "Não entendi o segundo ponto." : null, superseded],
    )

  it("curtir antigo não aparece; 'não foi útil' vigente aparece como contestação antiga, com ou sem ciência; trocado ou retirado, não", async () => {
    const liked = await feedbackOf(joana, "PUBLISHED")
    const withdrawn = await feedbackOf(joana, "PUBLISHED")
    await rating(liked, joana, "UP")
    await rating(published, joana, "DOWN")
    await rating(withdrawn, joana, "DOWN", true)
    await rating(withdrawn, joana, "NONE")
    const evaluations = await loadFeedbackEvaluations(db(), { organizationId: ORG, personId: joana }, [liked, published, withdrawn].map((id) => ({ kind: "PUBLISHED_FEEDBACK" as const, id })))
    expect(evaluations.get(key(liked))).toBeUndefined()
    expect(evaluations.get(key(withdrawn))).toBeUndefined()
    expect(evaluations.get(key(published))).toEqual({ agreement: null, legacyContestation: { reason: "UNCLEAR", comment: "Não entendi o segundo ponto.", contestedAt: expect.any(String), review: null } })
    // Nenhuma avaliação antiga virou concordância.
    expect((await pool.query("select count(*)::int n from feedback_read_agreements where person_id = $1", [joana])).rows[0].n).toBe(0)
  })

  it("a escolha da ciência aparece à parte da avaliação antiga; só para a própria pessoa", async () => {
    const account = (await pool.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,'x') returning id", [ORG, joana, `prova.avaliacao.${Date.now()}@inia.local`])).rows[0]!.id
    created.accounts.push(account)
    await pool.query("update feedbacks set acknowledged_at = now() where id = $1", [published])
    await pool.query("insert into feedback_read_agreements (organization_id, person_id, account_id, source_kind, feedback_id, agreement) values ($1,$2,$3,'PUBLISHED_FEEDBACK',$4,'AGREE')", [ORG, joana, account, published])
    const mine = await loadFeedbackEvaluations(db(), { organizationId: ORG, personId: joana }, [{ kind: "PUBLISHED_FEEDBACK", id: published }, { kind: "PUBLISHED_FEEDBACK", id: othersFeedback }, { kind: "PUBLISHED_FEEDBACK", id: draft }])
    expect(mine.get(key(published))).toMatchObject({ agreement: { value: "AGREE", reason: null, justification: null, review: null }, legacyContestation: { reason: "UNCLEAR" } })
    expect(mine.get(key(othersFeedback))).toBeUndefined()
    // A outra pessoa pedindo a fonte da Joana: nada.
    expect((await loadFeedbackEvaluations(db(), { organizationId: ORG, personId: other }, [{ kind: "PUBLISHED_FEEDBACK", id: published }])).size).toBe(0)
    // Sem fontes = nenhuma consulta e nada a devolver.
    expect((await loadFeedbackEvaluations(db(), { organizationId: ORG, personId: joana }, [])).size).toBe(0)
  })
})
