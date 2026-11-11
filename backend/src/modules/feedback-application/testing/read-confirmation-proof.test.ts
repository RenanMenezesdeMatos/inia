/**
 * PROVA contra o banco de TESTE real — confirmação de ciência com login e senha (migration 114). Zero modelo; fixture apagada no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run read-confirmation-proof
 *
 * Prova: login de outra conta ou senha errada não confirmam (422, evento FAILED com o motivo, ciência intacta); a trava bloqueia
 * depois de 5 falhas (429, evento TOO_MANY_ATTEMPTS) e libera fora da janela; confirmar grava a ciência, conclui a aplicação em
 * andamento (conversa encerrada) e grava o evento CONFIRMED; 5 confirmações concorrentes = 1 ciência, 1 conclusão, as demais
 * `alreadyConfirmed`; feedback de outra pessoa = 404; abrir/fechar o elemento vira evento sem mudar nada; nenhuma linha guarda
 * o login digitado nem a senha; as rotas antigas sem credencial não existem mais.
 *
 * Concordância (migration 186): a escolha é obrigatória e vai na MESMA transação da ciência — concordar e discordar confirmam;
 * discordar vira contestação (aviso ao revisor do escopo, item na fila); corpo inválido = 400 antes das credenciais; senha errada
 * não grava nada; 5 discordâncias concorrentes = 1 ciência, 1 escolha, 1 aviso por revisor; reenvio devolve a escolha registrada
 * (evento e auditoria como antes); ciência anterior sem escolha registra uma vez; escolha que já existisse para fonte sem ciência
 * = 409 e TUDO desfeito; o feed do próprio colaborador traz a avaliação (e o de outra pessoa, não).
 */
import express from "express"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { createFeedbackRouter } from "../../feedbacks/presentation/feedback-router.js"
import { startOrResumeApplication } from "../application/feedback-application-service.js"
import { confirmFeedbackReading, recordReadConfirmationEvent } from "../application/read-confirmation-service.js"
import { verifyPassword } from "../../auth/infrastructure/password-hasher.js"
import { createFeedbackApplicationsRouter } from "../presentation/feedback-applications-router.js"
import { createFeedbackReadConfirmationsRouter } from "../presentation/feedback-read-confirmations-router.js"
import { createOperatorRouter } from "../../reporting/presentation/operator-router.js"
import { frontendSchema } from "../../../shared/presentation/testing/frontend-schema.js"
import { listContestations } from "../../feedback-rating/application/contestation-review-service.js"
import { fetchOperatorFeedbackPage } from "../../reporting/application/fetch-operator-overview.js"
import { ZodError } from "zod"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
// Credencial de TESTE criada por esta prova e apagada no fim — nunca uma senha real.
const TEST_PASSWORD = "prova-ciencia-2026"
let pool: pg.Pool
const db = () => pool as unknown as Database
const AGREE = { value: "AGREE" as const }
const disagree = (justification: string, reason: "INACCURATE" | "WRONG_PROCESS" | "UNCLEAR" = "INACCURATE") => ({ value: "DISAGREE" as const, reason, justification })

const VIEW = {
  version: "FEEDBACK_VIEW_V1",
  heading: { title: "Rechamada", subtitle: "Agosto de 2026" },
  card: "Rechamada de 14,6%, fora da meta em agosto de 2026.",
  greeting: "Olá, Joana!",
  narrative: ["Em agosto de 2026, o resultado oficial de Rechamada foi de 14,6%, fora da meta de 10%."],
  developments: [], maintain: null, attention: [], materials: [], context: null, kind: "INDICATOR",
  cycle: { title: "Resultado do período · agosto de 2026", indicators: [{ name: "Rechamada", lines: [{ label: "Resultado oficial", value: "14,6%" }, { label: "Meta oficial", value: "10%" }], notes: [] }] },
}

describe.skipIf(!ENABLED)("Confirmação de ciência com login e senha — prova Postgres", () => {
  const created = { people: [] as string[], accounts: [] as string[], cases: [] as string[], feedbacks: [] as string[] }
  let teamId: string
  let joana: string
  let other: string
  let joanaAccount: string
  let otherAccount: string
  let reviewer: string
  let reviewerAccount: string
  const joanaEmail = `prova.ciencia.${Date.now()}@inia.local`
  const otherEmail = `prova.ciencia.outra.${Date.now()}@inia.local`

  async function publish(operatorId: string) {
    const caseId = (await pool.query<{ id: string }>(
      `insert into supervision_cases (organization_id, operator_id, team_id, title, summary, priority, indicator_code, indicator_value, indicator_target) values ($1,$2,$3,'Rechamada','Rechamada de 14,6%.','P2','RECHAMADA','14,6%','10%') returning id`,
      [ORG, operatorId, teamId],
    )).rows[0]!.id
    created.cases.push(caseId)
    const at = new Date(Date.now() - 24 * 3_600_000)
    const id = (await pool.query<{ id: string }>(
      `insert into feedbacks (organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, context_snapshot, published_at, created_at, updated_at)
       values ($1,$2,$3,'PUBLISHED','INDICATOR','Rechamada','7 de 48 interações marcadas.','—','—','Texto publicado.',$4,$5,$5,$5) returning id`,
      [ORG, caseId, operatorId, JSON.stringify({ reliableFeedback: { feedbackView: VIEW } }), at],
    )).rows[0]!.id
    created.feedbacks.push(id)
    return id
  }

  const scopeOf = (personId: string, accountId: string) => ({ organizationId: ORG, personId, accountId })
  const attempt = (feedbackId: string, overrides: Partial<{ entryPoint: "FOLLOW_UP_FEED" | "FEEDBACK_SESSION"; attemptId: string }> = {}) => ({
    source: { kind: "PUBLISHED_FEEDBACK" as const, id: feedbackId },
    entryPoint: overrides.entryPoint ?? ("FEEDBACK_SESSION" as const),
    attemptId: overrides.attemptId ?? crypto.randomUUID(),
    device: "DESKTOP" as const,
    elapsedMs: 4200,
  })
  const deps = { verifyPassword }
  const events = async (feedbackId: string) =>
    (await pool.query<{ event: string; failure_reason: string | null; entry_point: string; already_confirmed: boolean | null; completed_application: boolean | null; application_status: string | null }>(
      "select event, failure_reason, entry_point, already_confirmed, completed_application, application_status from feedback_read_confirmation_events where feedback_id = $1 order by occurred_at, id",
      [feedbackId],
    )).rows

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 10 })
    teamId = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    for (const name of ["Joana Prova Ciência", "Outra Pessoa Prova Ciência"]) {
      created.people.push((await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1,$2,'OPERATOR',$3) returning id", [ORG, name, teamId])).rows[0]!.id)
    }
    ;[joana, other] = created.people as [string, string]
    const hash = await hashPassword(TEST_PASSWORD)
    joanaAccount = (await pool.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,$4) returning id", [ORG, joana, joanaEmail, hash])).rows[0]!.id
    otherAccount = (await pool.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,$4) returning id", [ORG, other, otherEmail, hash])).rows[0]!.id
    created.accounts.push(joanaAccount, otherAccount)
    // Quem revisa as contestações do Grupo da Joana (recebe o aviso da discordância).
    reviewer = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1,'Revisora Prova Ciência','OPERATOR',$2) returning id", [ORG, teamId])).rows[0]!.id
    created.people.push(reviewer)
    reviewerAccount = (await pool.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,$4) returning id", [ORG, reviewer, `prova.ciencia.revisora.${Date.now()}@inia.local`, hash])).rows[0]!.id
    created.accounts.push(reviewerAccount)
    await pool.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1,$2,'REVISOR_DE_CONTESTACOES','GROUP',$3,now())", [ORG, reviewerAccount, teamId])
  })

  afterAll(async () => {
    if (!pool) return
    const apps = (await pool.query<{ id: string }>("select id from feedback_applications where recipient_person_id = any($1)", [created.people])).rows.map((row) => row.id)
    await pool.query("delete from feedback_read_confirmation_events where person_id = any($1)", [created.people])
    const agreements = (await pool.query<{ id: string }>("select id from feedback_read_agreements where person_id = any($1)", [created.people])).rows.map((row) => row.id)
    await pool.query("delete from alerts where alert_type like 'FEEDBACK_CONTESTATION_%' and split_part(dedupe_key, ':', 2) = any($1::text[])", [agreements])
    await pool.query("delete from audit_logs where entity_type = 'feedback_read_agreement' and entity_id = any($1)", [agreements])
    await pool.query("delete from feedback_read_agreements where id = any($1)", [agreements])
    await pool.query("delete from access_role_assignments where user_account_id = any($1)", [created.accounts])
    await pool.query("delete from audit_logs where (entity_type = 'feedback_application' and entity_id = any($1)) or (entity_type = 'feedback' and entity_id = any($2))", [apps, created.feedbacks])
    await pool.query("delete from feedback_applications where id = any($1)", [apps])
    await pool.query("delete from assistant_interactions where operator_id = any($1)", [created.people])
    await pool.query("delete from assistant_conversations where owner_person_id = any($1)", [created.people])
    await pool.query("delete from feedbacks where id = any($1)", [created.feedbacks])
    await pool.query("delete from supervision_cases where id = any($1)", [created.cases])
    await pool.query("delete from user_accounts where id = any($1)", [created.accounts])
    await pool.query("delete from people where id = any($1)", [created.people])
    await pool.end()
  })

  it("login de outra conta e senha errada não confirmam; confirmar grava a ciência, conclui a aplicação e registra o funil", async () => {
    const feedbackId = await publish(joana)
    const scope = scopeOf(joana, joanaAccount)
    const { application } = await startOrResumeApplication(db(), scope, { kind: "PUBLISHED_FEEDBACK", id: feedbackId }, new Date())
    expect(application).toMatchObject({ status: "IN_PROGRESS", acknowledgedAt: null })

    const tentative = attempt(feedbackId)
    // Instantes crescentes: a ordem do funil no banco é a ordem dos fatos.
    const t0 = Date.now()
    const at = (step: number) => new Date(t0 + step * 1000)
    await recordReadConfirmationEvent(db(), scope, tentative, "OPENED", at(0))
    // As credenciais da OUTRA pessoa (corretas para ela) não confirmam a ciência da Joana.
    await expect(confirmFeedbackReading(db(), scope, { ...tentative, login: otherEmail, password: TEST_PASSWORD, agreement: AGREE }, at(1), deps)).rejects.toMatchObject({ statusCode: 422, code: "READ_CONFIRMATION_INVALID_CREDENTIALS", details: { remainingAttempts: 4 } })
    await expect(confirmFeedbackReading(db(), scope, { ...tentative, login: joanaEmail, password: "senha-errada", agreement: AGREE }, at(2), deps)).rejects.toMatchObject({ statusCode: 422, details: { remainingAttempts: 3 } })
    expect((await pool.query("select acknowledged_at from feedbacks where id = $1", [feedbackId])).rows[0].acknowledged_at).toBeNull()

    const result = await confirmFeedbackReading(db(), scope, { ...tentative, login: `  ${joanaEmail.toUpperCase()} `, password: TEST_PASSWORD, agreement: AGREE }, at(3), deps)
    expect(result).toMatchObject({ alreadyConfirmed: false, application: { id: application.id, status: "COMPLETED" } })
    expect(result.application?.acknowledgedAt).toBe(result.acknowledgedAt)
    expect((await pool.query("select acknowledged_at, status from feedbacks where id = $1", [feedbackId])).rows[0]).toMatchObject({ status: "PUBLISHED" })
    expect((await pool.query("select status, close_reason from assistant_conversations where id = $1", [application.conversationId])).rows[0]).toEqual({ status: "CLOSED", close_reason: "COMPLETED" })
    expect(await events(feedbackId)).toEqual([
      { event: "OPENED", failure_reason: null, entry_point: "FEEDBACK_SESSION", already_confirmed: null, completed_application: null, application_status: "IN_PROGRESS" },
      { event: "FAILED", failure_reason: "WRONG_LOGIN", entry_point: "FEEDBACK_SESSION", already_confirmed: null, completed_application: null, application_status: "IN_PROGRESS" },
      { event: "FAILED", failure_reason: "WRONG_PASSWORD", entry_point: "FEEDBACK_SESSION", already_confirmed: null, completed_application: null, application_status: "IN_PROGRESS" },
      { event: "CONFIRMED", failure_reason: null, entry_point: "FEEDBACK_SESSION", already_confirmed: false, completed_application: true, application_status: "IN_PROGRESS" },
    ])
    const audit = (await pool.query("select payload from audit_logs where action = 'FEEDBACK_APPLICATION_COMPLETED' and entity_id = $1", [application.id])).rows[0]
    expect(audit.payload).toMatchObject({ via: "READ_CONFIRMATION", entryPoint: "FEEDBACK_SESSION" })
    // Nada do que foi digitado fica gravado.
    const dump = JSON.stringify((await pool.query("select * from feedback_read_confirmation_events where feedback_id = $1", [feedbackId])).rows) + JSON.stringify((await pool.query("select payload from audit_logs where entity_id = $1", [feedbackId])).rows)
    expect(dump).not.toContain(TEST_PASSWORD)
    expect(dump).not.toContain("senha-errada")
    expect(dump.toLowerCase()).not.toContain(otherEmail)
  })

  it("trava: 5 falhas na janela = 429 com horário de liberação, mesmo com a senha certa; fora da janela libera", async () => {
    const feedbackId = await publish(other)
    const scope = scopeOf(other, otherAccount)
    const now = new Date()
    for (let index = 0; index < 5; index += 1) await expect(confirmFeedbackReading(db(), scope, { ...attempt(feedbackId), login: otherEmail, password: `errada-${index}`, agreement: AGREE }, now, deps)).rejects.toMatchObject({ statusCode: 422 })
    await expect(confirmFeedbackReading(db(), scope, { ...attempt(feedbackId), login: otherEmail, password: TEST_PASSWORD, agreement: AGREE }, now, deps)).rejects.toMatchObject({ statusCode: 429, code: "READ_CONFIRMATION_TOO_MANY_ATTEMPTS" })
    const failures = (await events(feedbackId)).map((row) => row.failure_reason)
    expect(failures.filter((reason) => reason === "WRONG_PASSWORD")).toHaveLength(5)
    expect(failures.filter((reason) => reason === "TOO_MANY_ATTEMPTS")).toHaveLength(1)
    const later = new Date(now.getTime() + 16 * 60_000)
    const result = await confirmFeedbackReading(db(), scope, { ...attempt(feedbackId, { entryPoint: "FOLLOW_UP_FEED" }), login: otherEmail, password: TEST_PASSWORD, agreement: AGREE }, later, deps)
    // Sem aplicação iniciada: a ciência é gravada e nenhuma aplicação nasce.
    expect(result).toMatchObject({ alreadyConfirmed: false, application: null })
    expect(new Date((await pool.query("select acknowledged_at from feedbacks where id = $1", [feedbackId])).rows[0].acknowledged_at).toISOString()).toBe(later.toISOString())
  })

  it("trava sob concorrência: 10 senhas erradas em paralelo nunca passam de 5 conferências (achado I-F9)", async () => {
    const feedbackId = await publish(joana)
    const scope = scopeOf(joana, joanaAccount)
    // No passado (fora da janela das provas seguintes da mesma conta).
    const past = new Date(Date.now() - 2 * 3_600_000)
    // Falhas desta conta que já contam na janela (provas anteriores): o teto de 5 vale para o total.
    const credentialFailures = async () => Number((await pool.query<{ count: string }>(
      `select count(*) count from feedback_read_confirmation_events where person_id = $1 and event = 'FAILED' and failure_reason in ('WRONG_PASSWORD', 'WRONG_LOGIN', 'ACCOUNT_INACTIVE') and occurred_at > $2`,
      [joana, new Date(past.getTime() - 15 * 60_000)],
    )).rows[0]!.count)
    const before = await credentialFailures()
    expect(before).toBeLessThan(5)
    const outcomes = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => confirmFeedbackReading(db(), scope, { ...attempt(feedbackId), login: joanaEmail, password: `paralela-${index}`, agreement: AGREE }, past, deps)))
    const statuses = outcomes.map((outcome) => (outcome.status === "rejected" ? (outcome.reason as { statusCode?: number }).statusCode : 200))
    expect(statuses.filter((status) => status === 422)).toHaveLength(5 - before)
    expect(statuses.filter((status) => status === 429)).toHaveLength(5 + before)
    expect(await credentialFailures()).toBe(5)
  })

  it("5 confirmações concorrentes = 1 ciência e 1 conclusão; as demais alreadyConfirmed; outra pessoa = 404", async () => {
    const feedbackId = await publish(joana)
    const scope = scopeOf(joana, joanaAccount)
    await startOrResumeApplication(db(), scope, { kind: "PUBLISHED_FEEDBACK", id: feedbackId }, new Date())
    const results = await Promise.all(Array.from({ length: 5 }, () => confirmFeedbackReading(db(), scope, { ...attempt(feedbackId, { entryPoint: "FOLLOW_UP_FEED" }), login: joanaEmail, password: TEST_PASSWORD, agreement: AGREE }, new Date(), deps)))
    expect(results.filter((result) => !result.alreadyConfirmed)).toHaveLength(1)
    expect(new Set(results.map((result) => result.acknowledgedAt)).size).toBe(1)
    expect(results.every((result) => result.application?.status === "COMPLETED")).toBe(true)
    const confirmed = (await events(feedbackId)).filter((row) => row.event === "CONFIRMED")
    expect(confirmed.filter((row) => row.completed_application)).toHaveLength(1)
    expect(confirmed.filter((row) => row.already_confirmed)).toHaveLength(4)
    // Feedback da Joana com a sessão (e as credenciais certas) da outra pessoa: 404, sem evento.
    await expect(confirmFeedbackReading(db(), scopeOf(other, otherAccount), { ...attempt(feedbackId), login: otherEmail, password: TEST_PASSWORD, agreement: AGREE }, new Date(), deps)).rejects.toMatchObject({ statusCode: 404 })
    await expect(recordReadConfirmationEvent(db(), scopeOf(other, otherAccount), attempt(feedbackId), "OPENED", new Date())).rejects.toMatchObject({ statusCode: 404 })
  })

  it("HTTP: confirmar responde sem ecoar credenciais; as rotas antigas sem credencial não existem", async () => {
    const feedbackId = await publish(joana)
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => { req.user = { sub: joanaAccount, personId: joana, organizationId: ORG, role: "OPERATOR", name: "Joana", email: joanaEmail, avatarUrl: null, jobTitle: null, teamId: null, teamName: null }; next() })
    app.use("/feedbacks", createFeedbackRouter(db()))
    app.use("/feedback-applications", createFeedbackApplicationsRouter(db()))
    app.use("/feedback-read-confirmations", createFeedbackReadConfirmationsRouter(db()))
    app.use((_req, res) => res.status(404).json({}))
    app.use((error: { statusCode?: number; code?: string; message: string; details?: unknown }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void _next
      res.status(error.statusCode ?? 400).json({ error: { code: error.code, message: error.message, details: error.details } })
    })
    const body = { ...attempt(feedbackId, { entryPoint: "FOLLOW_UP_FEED" }) }
    expect((await request(app).post("/feedback-read-confirmations/events").send({ ...body, event: "OPENED" })).status).toBe(204)
    const wrong = await request(app).post("/feedback-read-confirmations").send({ ...body, login: joanaEmail, password: "nao-e-essa", agreement: AGREE })
    expect(wrong.status).toBe(422)
    expect(JSON.stringify(wrong.body)).not.toContain("nao-e-essa")
    const ok = await request(app).post("/feedback-read-confirmations").send({ ...body, login: joanaEmail, password: TEST_PASSWORD, agreement: AGREE })
    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ source: { kind: "PUBLISHED_FEEDBACK", id: feedbackId }, alreadyConfirmed: false, application: null })
    expect((await request(app).post(`/feedbacks/${feedbackId}/acknowledge`)).status).toBe(404)
    const { application } = await startOrResumeApplication(db(), scopeOf(joana, joanaAccount), { kind: "PUBLISHED_FEEDBACK", id: await publish(joana) }, new Date())
    expect((await request(app).post(`/feedback-applications/${application.id}/complete`)).status).toBe(404)
  })

  it("contrato com a tela: o Acompanhamento (perfil, feed e próxima página) e a resposta da ciência passam pelos schemas zod do frontend", async () => {
    const feedbackId = await publish(joana)
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => { req.user = { sub: joanaAccount, personId: joana, organizationId: ORG, role: "OPERATOR", name: "Joana", email: joanaEmail, avatarUrl: null, jobTitle: null, teamId: null, teamName: null }; next() })
    app.use("/operator", createOperatorRouter(db()))
    app.use("/feedback-read-confirmations", createFeedbackReadConfirmationsRouter(db()))
    const [overviewSchema, pageSchema, confirmationSchema] = await Promise.all([
      frontendSchema("schemas/operator/operator-overview.schema.ts", "operatorOverviewSchema"),
      frontendSchema("schemas/operator/operator-overview.schema.ts", "operatorFeedbackPageSchema"),
      frontendSchema("schemas/feedback-read-confirmations/feedback-read-confirmation.schema.ts", "readConfirmationResultSchema"),
    ])

    const overview = await request(app).get("/operator/overview")
    expect(overview.status, JSON.stringify(overview.body).slice(0, 400)).toBe(200)
    const screen = overviewSchema.parse(overview.body.data) as { feedbacks: { id: string }[] }
    // O feedback publicado agora está no que a tela leu — o schema validou um item real, não uma lista vazia.
    expect(screen.feedbacks.map((item) => item.id)).toContain(feedbackId)

    const page = await request(app).get("/operator/feedbacks?limit=1")
    expect(page.status).toBe(200)
    pageSchema.parse(page.body.data)

    const confirmed = await request(app).post("/feedback-read-confirmations").send({ ...attempt(feedbackId, { entryPoint: "FOLLOW_UP_FEED" }), login: joanaEmail, password: TEST_PASSWORD, agreement: AGREE })
    expect(confirmed.status).toBe(200)
    confirmationSchema.parse(confirmed.body.data)
  })

  // ---------------------------------------------------------------------------------------------------------------------------
  // Concordância na ciência (migration 186)
  // ---------------------------------------------------------------------------------------------------------------------------
  const agreementsOf = async (feedbackId: string) =>
    (await pool.query<{ id: string; agreement: string; reason: string | null; justification: string | null; person_id: string; account_id: string; created_at: Date }>(
      "select id, agreement, reason, justification, person_id, account_id, created_at from feedback_read_agreements where feedback_id = $1",
      [feedbackId],
    )).rows
  const reviewerAlerts = async (agreementId: string) =>
    (await pool.query<{ recipient_id: string; alert_type: string; description: string }>("select recipient_id, alert_type, description from alerts where dedupe_key like $1", [`feedback_contestation:${agreementId}:%`])).rows
  const acknowledgedAtOf = async (feedbackId: string) => (await pool.query<{ acknowledged_at: Date | null }>("select acknowledged_at from feedbacks where id = $1", [feedbackId])).rows[0]!.acknowledged_at
  function httpApp(personId: string, accountId: string, email: string) {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => { req.user = { sub: accountId, personId, organizationId: ORG, role: "OPERATOR", name: "Prova", email, avatarUrl: null, jobTitle: null, teamId: null, teamName: null }; next() })
    app.use("/operator", createOperatorRouter(db()))
    app.use("/feedback-read-confirmations", createFeedbackReadConfirmationsRouter(db()))
    app.use((error: { statusCode?: number; code?: string; message: string; details?: unknown }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void _next
      if (error instanceof ZodError) return res.status(400).json({ error: { code: "VALIDATION_ERROR" } })
      return res.status(error.statusCode ?? 500).json({ error: { code: error.code, message: error.message, details: error.details } })
    })
    return app
  }

  it("concordar: ciência e escolha gravadas juntas, no mesmo instante, com pessoa e conta da sessão; nenhum aviso", async () => {
    const feedbackId = await publish(joana)
    const result = await confirmFeedbackReading(db(), scopeOf(joana, joanaAccount), { ...attempt(feedbackId, { entryPoint: "FOLLOW_UP_FEED" }), login: joanaEmail, password: TEST_PASSWORD, agreement: AGREE }, new Date(), deps)
    expect(result).toMatchObject({ alreadyConfirmed: false, agreementDiffered: false, agreement: { value: "AGREE", reason: null, justification: null, review: null } })
    const [row] = await agreementsOf(feedbackId)
    expect(row).toMatchObject({ agreement: "AGREE", reason: null, justification: null, person_id: joana, account_id: joanaAccount })
    expect(new Date(row!.created_at).toISOString()).toBe(new Date((await acknowledgedAtOf(feedbackId))!).toISOString())
    expect(result.agreement?.recordedAt).toBe(result.acknowledgedAt)
    expect(await reviewerAlerts(row!.id)).toEqual([])
    const audit = (await pool.query("select payload from audit_logs where action = 'FEEDBACK_READ_CONFIRMED' and entity_id = $1", [feedbackId])).rows
    expect(audit).toHaveLength(1)
    expect(audit[0].payload).toMatchObject({ agreement: "AGREE", agreementId: row!.id, agreementRecorded: true, agreementDiffered: false })
  })

  it("discordar: a ciência é registrada mesmo assim; motivo e justificativa gravados; aviso ao revisor; entra na fila de contestações", async () => {
    const feedbackId = await publish(joana)
    // Senha errada antes: nada gravado (nem ciência, nem escolha).
    await expect(confirmFeedbackReading(db(), scopeOf(joana, joanaAccount), { ...attempt(feedbackId), login: joanaEmail, password: "errada-de-novo", agreement: disagree("Eu informei o protocolo.") }, new Date(), deps)).rejects.toMatchObject({ statusCode: 422 })
    expect(await acknowledgedAtOf(feedbackId)).toBeNull()
    expect(await agreementsOf(feedbackId)).toEqual([])

    const result = await confirmFeedbackReading(db(), scopeOf(joana, joanaAccount), { ...attempt(feedbackId), login: joanaEmail, password: TEST_PASSWORD, agreement: disagree("  Eu informei o protocolo aos 6 minutos.  ", "WRONG_PROCESS") }, new Date(), deps)
    expect(result).toMatchObject({ alreadyConfirmed: false, agreement: { value: "DISAGREE", reason: "WRONG_PROCESS", justification: "Eu informei o protocolo aos 6 minutos.", review: null } })
    expect(await acknowledgedAtOf(feedbackId)).not.toBeNull()
    const [row] = await agreementsOf(feedbackId)
    // Avisa quem revisa o Grupo dela (e quem mais revisar a organização no banco de teste), uma vez cada; nunca ela mesma.
    const alerts = await reviewerAlerts(row!.id)
    expect(alerts.filter((alert) => alert.recipient_id === reviewer).map((alert) => alert.alert_type)).toEqual(["FEEDBACK_CONTESTATION_RECEIVED"])
    expect(new Set(alerts.map((alert) => alert.recipient_id)).size).toBe(alerts.length)
    expect(alerts.map((alert) => alert.recipient_id)).not.toContain(joana)
    expect(alerts.find((alert) => alert.recipient_id === reviewer)!.description).toContain("não concordou com um feedback")
    const queue = await listContestations(db(), { organizationId: ORG, personId: reviewer }, { origin: "READ_AGREEMENT", page: 1, pageSize: 100 })
    expect(queue.items.find((item) => item.id === row!.id)).toMatchObject({ origin: "READ_AGREEMENT", status: "PENDING", reason: "WRONG_PROCESS", comment: "Eu informei o protocolo aos 6 minutos.", feedback: { kind: "PUBLISHED_FEEDBACK", id: feedbackId } })
  })

  it("corpo inválido = 400 antes das credenciais: sem escolha, discordar sem justificativa, motivo inventado, valor desconhecido, campo extra", async () => {
    const feedbackId = await publish(joana)
    const app = httpApp(joana, joanaAccount, joanaEmail)
    const base = { ...attempt(feedbackId, { entryPoint: "FOLLOW_UP_FEED" }), login: joanaEmail, password: TEST_PASSWORD }
    const invalid = [
      base,
      { ...base, agreement: null },
      { ...base, agreement: { value: "DISAGREE", reason: "INACCURATE" } },
      { ...base, agreement: { value: "DISAGREE", reason: "INACCURATE", justification: "  " } },
      { ...base, agreement: { value: "DISAGREE", reason: "MADE_UP", justification: "Texto qualquer." } },
      { ...base, agreement: { value: "UP" } },
      { ...base, agreement: { value: "AGREE", reason: "UNCLEAR" } },
      { ...base, agreement: AGREE, personId: other },
    ]
    for (const body of invalid) {
      const response = await request(app).post("/feedback-read-confirmations").send(body)
      expect(response.status, JSON.stringify(body).slice(0, 200)).toBe(400)
      expect(response.body.error.code).toBe("VALIDATION_ERROR")
    }
    expect(await acknowledgedAtOf(feedbackId)).toBeNull()
    expect(await agreementsOf(feedbackId)).toEqual([])
    expect((await events(feedbackId)).filter((row) => row.event === "FAILED")).toEqual([])
  })

  it("5 discordâncias concorrentes (motivos diferentes) = 1 ciência, 1 escolha, 1 aviso; as demais devolvem a registrada", async () => {
    const feedbackId = await publish(joana)
    const reasons = ["INACCURATE", "WRONG_PROCESS", "UNCLEAR", "INACCURATE", "WRONG_PROCESS"] as const
    const results = await Promise.all(reasons.map((reason, index) => confirmFeedbackReading(db(), scopeOf(joana, joanaAccount), { ...attempt(feedbackId, { entryPoint: "FOLLOW_UP_FEED" }), login: joanaEmail, password: TEST_PASSWORD, agreement: disagree(`Motivo da aba ${index}.`, reason) }, new Date(), deps)))
    expect(results.filter((result) => !result.alreadyConfirmed)).toHaveLength(1)
    const rows = await agreementsOf(feedbackId)
    expect(rows).toHaveLength(1)
    expect(new Set(results.map((result) => JSON.stringify(result.agreement)))).toEqual(new Set([JSON.stringify(results.find((result) => !result.alreadyConfirmed)!.agreement)]))
    expect(results.filter((result) => result.alreadyConfirmed).every((result) => result.agreementDiffered)).toBe(true)
    const alerts = await reviewerAlerts(rows[0]!.id)
    expect(alerts.filter((alert) => alert.recipient_id === reviewer)).toHaveLength(1)
    expect(new Set(alerts.map((alert) => alert.recipient_id)).size).toBe(alerts.length)
    const confirmed = (await events(feedbackId)).filter((row) => row.event === "CONFIRMED")
    expect(confirmed).toHaveLength(5)
    expect(confirmed.filter((row) => row.already_confirmed)).toHaveLength(4)
  })

  it("reenvio com outra escolha (resposta perdida, outra aba): nada muda, devolve a registrada; evento e auditoria como antes", async () => {
    const feedbackId = await publish(joana)
    const scope = scopeOf(joana, joanaAccount)
    await confirmFeedbackReading(db(), scope, { ...attempt(feedbackId), login: joanaEmail, password: TEST_PASSWORD, agreement: AGREE }, new Date(), deps)
    const again = await confirmFeedbackReading(db(), scope, { ...attempt(feedbackId), login: joanaEmail, password: TEST_PASSWORD, agreement: disagree("Mudei de ideia.") }, new Date(), deps)
    expect(again).toMatchObject({ alreadyConfirmed: true, agreementDiffered: true, agreement: { value: "AGREE" } })
    const same = await confirmFeedbackReading(db(), scope, { ...attempt(feedbackId), login: joanaEmail, password: TEST_PASSWORD, agreement: AGREE }, new Date(), deps)
    expect(same).toMatchObject({ alreadyConfirmed: true, agreementDiffered: false, agreement: { value: "AGREE" } })
    expect(await agreementsOf(feedbackId)).toHaveLength(1)
    const audits = (await pool.query("select payload from audit_logs where action = 'FEEDBACK_READ_CONFIRMED' and entity_id = $1 order by created_at", [feedbackId])).rows.map((row) => row.payload)
    expect(audits.map((payload) => [payload.alreadyConfirmed, payload.agreementRecorded, payload.agreementDiffered])).toEqual([[false, true, false], [true, false, true], [true, false, false]])
    // A escolha é imutável também no banco.
    await expect(pool.query("update feedback_read_agreements set agreement = 'DISAGREE', reason = 'OTHER', justification = 'x' where feedback_id = $1", [feedbackId])).rejects.toMatchObject({ code: "P0001" })
  })

  it("ciência anterior à escolha: nada é presumido; o colaborador registra a escolha UMA vez, com login e senha", async () => {
    const feedbackId = await publish(joana)
    const before = new Date(Date.now() - 6 * 3_600_000)
    await pool.query("update feedbacks set acknowledged_at = $2 where id = $1", [feedbackId, before])
    const page = await fetchOperatorFeedbackPage(db(), ORG, joana, { personId: joana }, { publishedOnly: true, limit: 50 })
    expect(page.items.find((item) => item.id === feedbackId)?.evaluation).toEqual({ agreement: null, legacyContestation: null })
    const now = new Date()
    const registered = await confirmFeedbackReading(db(), scopeOf(joana, joanaAccount), { ...attempt(feedbackId), login: joanaEmail, password: TEST_PASSWORD, agreement: disagree("Na chamada eu ofereci a segunda via.") }, now, deps)
    expect(registered).toMatchObject({ alreadyConfirmed: true, agreement: { value: "DISAGREE", reason: "INACCURATE" } })
    // A ciência continua a de antes; a escolha tem o instante dela.
    expect(new Date((await acknowledgedAtOf(feedbackId))!).toISOString()).toBe(before.toISOString())
    expect(registered.agreement?.recordedAt).toBe(now.toISOString())
    expect((await reviewerAlerts((await agreementsOf(feedbackId))[0]!.id)).filter((alert) => alert.recipient_id === reviewer)).toHaveLength(1)
    const again = await confirmFeedbackReading(db(), scopeOf(joana, joanaAccount), { ...attempt(feedbackId), login: joanaEmail, password: TEST_PASSWORD, agreement: AGREE }, new Date(), deps)
    expect(again).toMatchObject({ alreadyConfirmed: true, agreementDiffered: true, agreement: { value: "DISAGREE" } })
    expect(await agreementsOf(feedbackId)).toHaveLength(1)
  })

  it("falha ao gravar a escolha desfaz TUDO: ciência, evento, auditoria, conclusão da aplicação e aviso", async () => {
    const feedbackId = await publish(joana)
    const scope = scopeOf(joana, joanaAccount)
    const { application } = await startOrResumeApplication(db(), scope, { kind: "PUBLISHED_FEEDBACK", id: feedbackId }, new Date())
    // Estado impossível pelo código (escolha sem ciência), criado à mão: o índice único recusa a escolha da confirmação.
    await pool.query("insert into feedback_read_agreements (organization_id, person_id, account_id, source_kind, feedback_id, agreement) values ($1,$2,$3,'PUBLISHED_FEEDBACK',$4,'AGREE')", [ORG, joana, joanaAccount, feedbackId])
    await expect(confirmFeedbackReading(db(), scope, { ...attempt(feedbackId), login: joanaEmail, password: TEST_PASSWORD, agreement: disagree("Não condiz com a chamada.") }, new Date(), deps)).rejects.toMatchObject({ statusCode: 409, code: "FEEDBACK_READ_AGREEMENT_CONFLICT" })
    expect(await acknowledgedAtOf(feedbackId)).toBeNull()
    expect((await events(feedbackId)).filter((row) => row.event === "CONFIRMED")).toEqual([])
    expect((await pool.query("select 1 from audit_logs where action = 'FEEDBACK_READ_CONFIRMED' and entity_id = $1", [feedbackId])).rowCount).toBe(0)
    expect((await pool.query<{ status: string }>("select status from feedback_applications where id = $1", [application.id])).rows[0]!.status).toBe("IN_PROGRESS")
    expect((await agreementsOf(feedbackId)).map((row) => row.agreement)).toEqual(["AGREE"])
    expect((await pool.query("select 1 from alerts where recipient_id = $1 and alert_type = 'FEEDBACK_CONTESTATION_RECEIVED' and description like '%Não condiz com a chamada%'", [reviewer])).rowCount).toBe(0)
    await pool.query("delete from feedback_read_agreements where feedback_id = $1", [feedbackId])
  })

  it("contrato com a tela: o feed do próprio colaborador traz a avaliação (schemas zod do frontend); o de outra pessoa, não", async () => {
    const feedbackId = await publish(joana)
    const app = httpApp(joana, joanaAccount, joanaEmail)
    const [pageSchema, confirmationSchema] = await Promise.all([
      frontendSchema("schemas/operator/operator-overview.schema.ts", "operatorFeedbackPageSchema"),
      frontendSchema("schemas/feedback-read-confirmations/feedback-read-confirmation.schema.ts", "readConfirmationResultSchema"),
    ])
    const confirmed = await request(app).post("/feedback-read-confirmations").send({ ...attempt(feedbackId, { entryPoint: "FOLLOW_UP_FEED" }), login: joanaEmail, password: TEST_PASSWORD, agreement: disagree("O indicador do período está errado.") })
    expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 300)).toBe(200)
    expect(confirmationSchema.parse(confirmed.body.data)).toMatchObject({ agreement: { value: "DISAGREE", reason: "INACCURATE" } })
    const page = await request(app).get("/operator/feedbacks?limit=50")
    expect(page.status).toBe(200)
    const parsed = pageSchema.parse(page.body.data) as { items: { id: string; evaluation: unknown }[] }
    expect(parsed.items.find((item) => item.id === feedbackId)?.evaluation).toMatchObject({ agreement: { value: "DISAGREE", justification: "O indicador do período está errado.", review: null }, legacyContestation: null })
    // Quem lê não é o destinatário: nenhuma avaliação (a justificativa nunca vai para outra pessoa por este caminho).
    const othersView = await fetchOperatorFeedbackPage(db(), ORG, joana, { personId: other }, { publishedOnly: true, limit: 50 })
    expect(othersView.items.find((item) => item.id === feedbackId)?.evaluation).toBeNull()
  })
})
