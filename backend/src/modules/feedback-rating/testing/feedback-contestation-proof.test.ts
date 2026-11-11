/**
 * PROVA contra o banco de TESTE real — revisão das contestações de feedback (migration 150, LGPD art. 20). Fixture apagada no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run feedback-contestation-proof
 *
 * Prova: "não foi útil" avisa no sino quem revisa o colaborador (Grupo dele e "Minha estrutura" do líder), nunca quem revisa
 * outro Grupo nem o próprio colaborador; a fila mostra só o escopo de cada revisor; responder grava, audita, avisa o colaborador
 * (que vê a resposta junto da avaliação) e encerra os avisos; responder de novo = 409; contestação retirada sai da fila; a taxa de
 * contestação do período conta cada feedback disponibilizado uma vez, com a contestação vigente ou respondida (retirada sem resposta
 * não conta), no escopo de quem revisa, e só mostra porcentagem com 5 ou mais feedbacks.
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { listContestations, reviewContestation } from "../application/contestation-review-service.js"
import { contestationSummary } from "../application/contestation-summary.js"
import { listMyRatings, rateFeedback } from "../application/feedback-rating-service.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const PASSWORD = "Cajueiro-Prova-2026"
let pool: pg.Pool
const db = () => pool as unknown as Database

describe.skipIf(!ENABLED)("Contestações de feedback — prova Postgres", () => {
  const created = { people: [] as string[], accounts: [] as string[], cases: [] as string[], feedbacks: [] as string[] }
  let teamA: string
  let teamB: string
  const person: Record<string, string> = {}
  const email: Record<string, string> = {}
  let feedbackId: string

  async function addPerson(key: string, teamId: string, reportsTo: string | null, role = "OPERATOR") {
    const id = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id, reports_to_id) values ($1,$2,$3,$4,$5) returning id", [ORG, `${key} Prova Contestação`, role, teamId, reportsTo])).rows[0]!.id
    created.people.push(id)
    person[key] = id
    return id
  }
  async function addAccount(key: string, roleCode?: string, scope?: { type: "ORGANIZATION" | "GROUP" | "MY_STRUCTURE"; teamId?: string }) {
    email[key] = `${key.toLowerCase()}-${person[key]!.slice(0, 8)}@prova-contestacao.inia.local`
    const account = (await pool.query<{ id: string }>(
      "insert into user_accounts (organization_id, person_id, email, password_hash, active, password_change_required) values ($1,$2,$3,$4,true,false) returning id",
      [ORG, person[key], email[key], await hashPassword(PASSWORD)],
    )).rows[0]!.id
    created.accounts.push(account)
    if (roleCode && scope) {
      await pool.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1,$2,$3,$4,$5,now())", [ORG, account, roleCode, scope.type, scope.teamId ?? null])
    }
  }
  const alertsOf = async (recipient: string) => (await pool.query<{ alert_type: string; status: string; dedupe_key: string }>("select alert_type, status::text, dedupe_key from alerts where recipient_id = $1 and alert_type like 'FEEDBACK_CONTESTATION_%' order by created_at", [recipient])).rows

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 })
    const teams = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 order by created_at, id limit 2", [ORG])).rows
    teamA = teams[0]!.id
    teamB = teams[1]!.id
    const leader = await addPerson("Lider", teamA, null, "SUPERVISOR")
    await addPerson("Joana", teamA, leader)
    await addPerson("RevisorGrupo", teamA, null)
    await addPerson("RevisorOutroGrupo", teamB, null)
    await addAccount("Joana")
    await addAccount("Lider", "REVISOR_DE_CONTESTACOES", { type: "MY_STRUCTURE" })
    await addAccount("RevisorGrupo", "REVISOR_DE_CONTESTACOES", { type: "GROUP", teamId: teamA })
    await addAccount("RevisorOutroGrupo", "REVISOR_DE_CONTESTACOES", { type: "GROUP", teamId: teamB })
    const caseId = (await pool.query<{ id: string }>(
      `insert into supervision_cases (organization_id, operator_id, team_id, title, summary, priority, indicator_code, indicator_value, indicator_target) values ($1,$2,$3,'Prova contestação','Resumo.','P3','TMA','400','380') returning id`,
      [ORG, person.Joana, teamA],
    )).rows[0]!.id
    created.cases.push(caseId)
    feedbackId = (await pool.query<{ id: string }>(
      `insert into feedbacks (organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, published_at)
       values ($1,$2,$3,'PUBLISHED','MONITORING','TMA','“vou verificar aqui”','Não confirmou o protocolo.','Procedimento 35','Informe o protocolo.',now()) returning id`,
      [ORG, caseId, person.Joana],
    )).rows[0]!.id
    created.feedbacks.push(feedbackId)
  })

  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from alerts where alert_type like 'FEEDBACK_CONTESTATION_%' and split_part(dedupe_key, ':', 2) in (select id::text from feedback_ratings where person_id = any($1))", [created.people])
    await pool.query("delete from audit_logs where action = 'FEEDBACK_CONTESTATION_REVIEWED' and entity_id in (select id from feedback_ratings where person_id = any($1))", [created.people])
    await pool.query("delete from feedback_ratings where person_id = any($1)", [created.people])
    await pool.query("delete from feedbacks where id = any($1)", [created.feedbacks])
    await pool.query("delete from supervision_cases where id = any($1)", [created.cases])
    await pool.query("delete from access_role_assignments where user_account_id = any($1)", [created.accounts])
    await pool.query("delete from auth_login_attempts where account_id = any($1)", [created.accounts])
    await pool.query("delete from user_accounts where id = any($1)", [created.accounts])
    await pool.query("update people set reports_to_id = null where id = any($1)", [created.people])
    await pool.query("delete from people where id = any($1)", [created.people])
    await pool.end()
  })

  const joana = () => ({ organizationId: ORG, personId: person.Joana! })
  const reviewer = (key: string) => ({ organizationId: ORG, personId: person[key]! })
  let ratingId: string

  it("'não foi útil' avisa quem revisa o colaborador (Grupo e Minha estrutura), nunca outro Grupo nem ele mesmo", async () => {
    await rateFeedback(db(), joana(), { source: { kind: "PUBLISHED_FEEDBACK", id: feedbackId }, value: "DOWN", reason: "INACCURATE", comment: "Eu informei o protocolo no fim da ligação." }, new Date())
    ratingId = (await pool.query<{ id: string }>("select id from feedback_ratings where person_id = $1 and superseded_at is null", [person.Joana])).rows[0]!.id
    expect((await alertsOf(person.Lider!)).map((alert) => alert.alert_type)).toEqual(["FEEDBACK_CONTESTATION_RECEIVED"])
    expect((await alertsOf(person.RevisorGrupo!)).map((alert) => alert.alert_type)).toEqual(["FEEDBACK_CONTESTATION_RECEIVED"])
    expect(await alertsOf(person.RevisorOutroGrupo!)).toEqual([])
    expect(await alertsOf(person.Joana!)).toEqual([])
  })

  it("a fila mostra só o escopo de cada revisor", async () => {
    const group = await listContestations(db(), reviewer("RevisorGrupo"), { page: 1, pageSize: 50 })
    expect(group.items.map((item) => item.id)).toContain(ratingId)
    expect(group.items.find((item) => item.id === ratingId)).toMatchObject({ status: "PENDING", reason: "INACCURATE", collaborator: { personId: person.Joana }, feedback: { id: feedbackId } })
    expect(group.pendingCount).toBeGreaterThanOrEqual(1)
    expect((await listContestations(db(), reviewer("Lider"), { page: 1, pageSize: 50 })).items.map((item) => item.id)).toContain(ratingId)
    expect((await listContestations(db(), reviewer("RevisorOutroGrupo"), { page: 1, pageSize: 50 })).items.map((item) => item.id)).not.toContain(ratingId)
    await expect(reviewContestation(db(), reviewer("RevisorOutroGrupo"), ratingId, { decision: "REJECTED", response: "Mantido." }, new Date())).rejects.toMatchObject({ code: "FEEDBACK_CONTESTATION_NOT_FOUND" })
  })

  it("pela API: sem o papel = 403; com o papel, responder grava, audita, avisa o colaborador e encerra os avisos; de novo = 409", async () => {
    const app = createApp(pool, { rateLimits: false })
    const origin = env.allowedOrigins[0]!
    const login = async (key: string) => {
      const agent = request.agent(app)
      expect((await agent.post("/api/v1/auth/login").set("Origin", origin).send({ email: email[key], password: PASSWORD })).status).toBe(200)
      return agent
    }
    const collaborator = await login("Joana")
    expect((await collaborator.get("/api/v1/admin/feedback-contestations")).status).toBe(403)
    expect((await collaborator.get("/api/v1/auth/me")).body.data.access.capabilities.canReviewFeedbackContestations).toBe(false)

    const group = await login("RevisorGrupo")
    expect((await group.get("/api/v1/auth/me")).body.data.access.capabilities).toMatchObject({ canReviewFeedbackContestations: true, canAccessAdministration: false })
    const detail = await group.get(`/api/v1/admin/feedback-contestations/${ratingId}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.content).toMatchObject({ observedBehavior: "Não confirmou o protocolo.", recommendation: "Informe o protocolo." })

    const answered = await group.post(`/api/v1/admin/feedback-contestations/${ratingId}/review`).set("Origin", origin).send({ decision: "ACCEPTED", response: "Você tem razão: o protocolo foi informado aos 6 minutos." })
    expect(answered.status).toBe(200)
    expect(answered.body.data).toMatchObject({ status: "ANSWERED", review: { decision: "ACCEPTED" } })
    expect((await group.post(`/api/v1/admin/feedback-contestations/${ratingId}/review`).set("Origin", origin).send({ decision: "REJECTED", response: "Mudei de ideia." })).status).toBe(409)

    expect((await pool.query("select 1 from audit_logs where action = 'FEEDBACK_CONTESTATION_REVIEWED' and entity_id = $1 and actor_id = $2", [ratingId, person.RevisorGrupo])).rowCount).toBe(1)
    expect((await alertsOf(person.Joana!)).map((alert) => [alert.alert_type, alert.dedupe_key])).toEqual([["FEEDBACK_CONTESTATION_ANSWERED", `feedback_contestation_answer:${ratingId}:${feedbackId}`]])
    for (const key of ["Lider", "RevisorGrupo"]) expect((await alertsOf(person[key]!)).map((alert) => alert.status)).toEqual(["RESOLVED"])

    // O colaborador vê a resposta junto da avaliação.
    const mine = await listMyRatings(db(), joana())
    expect(mine[0]).toMatchObject({ value: "DOWN", review: { decision: "ACCEPTED", response: "Você tem razão: o protocolo foi informado aos 6 minutos." } })
    // O sino do colaborador leva ao feedback no Acompanhamento; o do revisor, à contestação.
    const bell = await collaborator.get("/api/v1/notifications")
    expect(bell.body.data.items.find((item: { kind: string }) => item.kind === "FEEDBACK_CONTESTATION")?.target).toEqual({ type: "FOLLOW_UP", itemId: feedbackId, operatorId: null })
    const reviewerBell = await (await login("Lider")).get("/api/v1/notifications")
    expect(reviewerBell.body.data.items.find((item: { kind: string }) => item.kind === "FEEDBACK_CONTESTATION")?.target).toEqual({ type: "ADMIN_FEEDBACK_CONTESTATION", contestationId: ratingId })
  })

  it("contestação retirada pelo colaborador sai da fila de quem não respondeu e o aviso deixa de pedir ação", async () => {
    // Nova contestação (troca a avaliação respondida por outra "não foi útil") e depois retirada.
    await rateFeedback(db(), joana(), { source: { kind: "PUBLISHED_FEEDBACK", id: feedbackId }, value: "DOWN", reason: "UNCLEAR", comment: "Não entendi a recomendação." }, new Date())
    const second = (await pool.query<{ id: string }>("select id from feedback_ratings where person_id = $1 and superseded_at is null", [person.Joana])).rows[0]!.id
    expect((await listContestations(db(), reviewer("RevisorGrupo"), { status: "PENDING", page: 1, pageSize: 50 })).items.map((item) => item.id)).toContain(second)
    await rateFeedback(db(), joana(), { source: { kind: "PUBLISHED_FEEDBACK", id: feedbackId }, value: "NONE" }, new Date())
    const queue = await listContestations(db(), reviewer("RevisorGrupo"), { page: 1, pageSize: 50 })
    expect(queue.items.map((item) => item.id)).not.toContain(second)
    // A respondida continua na fila (histórico das respostas), mesmo com a avaliação trocada depois.
    expect(queue.items.find((item) => item.id === ratingId)).toMatchObject({ status: "ANSWERED" })
    const secondAlerts = (await alertsOf(person.RevisorGrupo!)).filter((alert) => alert.dedupe_key.includes(second))
    expect(secondAlerts.map((alert) => alert.status)).toEqual(["RESOLVED"])
    await expect(reviewContestation(db(), reviewer("RevisorGrupo"), second, { decision: "REJECTED", response: "Mantido." }, new Date())).rejects.toMatchObject({ code: "FEEDBACK_CONTESTATION_NOT_FOUND" })
  })

  it("taxa de contestação: cada feedback disponibilizado no período conta uma vez; retirada sem resposta não conta; porcentagem só com 5 ou mais", async () => {
    const today = (await pool.query<{ day: string }>("select to_char((now() at time zone analytics_org_timezone($1))::date, 'YYYY-MM-DD') as day", [ORG])).rows[0]!.day
    const period = { from: today, to: today }
    // Até aqui: 1 feedback da Joana (o original), contestado e respondido como procedente; a segunda contestação foi retirada.
    const one = await contestationSummary(db(), reviewer("Lider"), period)
    expect(one).toMatchObject({ delivered: 1, contested: 1, rate: null, byStatus: { pending: 0, ACCEPTED: 1, PARTIALLY_ACCEPTED: 0, REJECTED: 0 } })
    expect(one.byReason).toEqual([{ reason: "INACCURATE", label: "Impreciso", count: 1 }])

    // Mais 4 feedbacks para a Joana; ela contesta 1 (fica sem resposta) e contesta e retira outro.
    const more: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const id = (await pool.query<{ id: string }>(
        `insert into feedbacks (organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, published_at)
         values ($1,$2,$3,'PUBLISHED','MONITORING','TMA','“trecho”','Comportamento.','Procedimento 35','Recomendação.',now()) returning id`,
        [ORG, created.cases[0], person.Joana],
      )).rows[0]!.id
      created.feedbacks.push(id)
      more.push(id)
    }
    await rateFeedback(db(), joana(), { source: { kind: "PUBLISHED_FEEDBACK", id: more[0]! }, value: "DOWN", reason: "WRONG_PROCESS", comment: "O procedimento citado não é o do meu produto." }, new Date())
    await rateFeedback(db(), joana(), { source: { kind: "PUBLISHED_FEEDBACK", id: more[1]! }, value: "DOWN", reason: "UNCLEAR", comment: "Não entendi." }, new Date())
    await rateFeedback(db(), joana(), { source: { kind: "PUBLISHED_FEEDBACK", id: more[1]! }, value: "NONE" }, new Date())
    await rateFeedback(db(), joana(), { source: { kind: "PUBLISHED_FEEDBACK", id: more[2]! }, value: "UP" }, new Date())

    const five = await contestationSummary(db(), reviewer("Lider"), period)
    expect(five).toMatchObject({ delivered: 5, contested: 2, rate: 0.4, byStatus: { pending: 1, ACCEPTED: 1, PARTIALLY_ACCEPTED: 0, REJECTED: 0 } })
    // Empate: ordem do catálogo (processo errado vem antes de impreciso).
    expect(five.byReason.map((entry) => [entry.reason, entry.count])).toEqual([["WRONG_PROCESS", 1], ["INACCURATE", 1]])
    // A própria colaboradora (sem o papel) não alcança ninguém; outro dia não tem nada.
    expect(await contestationSummary(db(), { organizationId: ORG, personId: person.Joana! }, period)).toMatchObject({ delivered: 0, contested: 0, rate: null, byReason: [] })
    expect(await contestationSummary(db(), reviewer("Lider"), { from: "2020-01-01", to: "2020-01-31" })).toMatchObject({ delivered: 0, contested: 0, rate: null })

    // Pela rota: período obrigatório e de até 366 dias.
    const app = createApp(pool, { rateLimits: false })
    const origin = env.allowedOrigins[0]!
    const agent = request.agent(app)
    expect((await agent.post("/api/v1/auth/login").set("Origin", origin).send({ email: email.Lider, password: PASSWORD })).status).toBe(200)
    const viaApi = await agent.get(`/api/v1/admin/feedback-contestations/summary?from=${today}&to=${today}`)
    expect(viaApi.status).toBe(200)
    expect(viaApi.body.data).toMatchObject({ delivered: 5, contested: 2, rate: 0.4 })
    expect((await agent.get("/api/v1/admin/feedback-contestations/summary?from=2026-01-01")).status).toBe(400)
    expect((await agent.get("/api/v1/admin/feedback-contestations/summary?from=2024-01-01&to=2026-01-01")).status).toBe(400)
  })
})
