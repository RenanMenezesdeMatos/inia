/**
 * PROVA contra o banco de TESTE real — aplicação de feedback conversacional (migration 103). Zero modelo; fixture apagada no fim.
 *   INIA_DB_PROOF=1 npx vitest run feedback-application-proof
 *
 * Prova: uma aplicação por feedback (5 inícios CONCORRENTES = 1 aplicação, 1 conversa, 1 apresentação); feedback de outra pessoa
 * = 404; o contexto é o registro publicado (mudar a meta atual não muda nada); sair por agora e eventos do áudio não concluem;
 * concluir encerra a conversa (somente consulta) SEM confirmar ciência nem mexer no caso; iniciar de novo devolve a MESMA
 * aplicação concluída; convite: um por vez, "Depois" persiste, concluída/antiga nunca convida. Conversa COMPLEMENTAR (104):
 * abrir a concluída não cria nada; a primeira dúvida cria UMA (5 concorrentes = 1), com o MESMO registro; a aplicação, a
 * conversa original, a ciência e o caso continuam como estavam; conversa de outro contexto = 409.
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { loadOwnConversationSummary, resolveConversationForWrite } from "../../assistant/application/assistant-conversations.js"
import {
  completeApplication,
  getApplication,
  listApplications,
  loadApplicationInstructionByConversation,
  loadCurrentInvite,
  pauseApplication,
  recordInviteEvent,
  recordPresentationEvent,
  resolveApplicationConversation,
  loadApplicationVoiceInstruction,
  startOrResumeApplication,
} from "../application/feedback-application-service.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
const db = () => pool as unknown as Database

const VIEW = {
  version: "FEEDBACK_VIEW_V1",
  heading: { title: "Rechamada", subtitle: "Agosto de 2026" },
  card: "Rechamada de 14,6%, fora da meta em agosto de 2026.",
  greeting: "Olá, Joana!",
  narrative: ["Em agosto de 2026, o resultado oficial de Rechamada foi de 14,6%, fora da meta de 10%."],
  developments: [], maintain: null, attention: [], materials: [], context: null, kind: "INDICATOR",
  cycle: { title: "Resultado do período · agosto de 2026", indicators: [{ name: "Rechamada", lines: [{ label: "Resultado oficial", value: "14,6%" }, { label: "Meta oficial", value: "10%" }], notes: [] }] },
}

describe.skipIf(!ENABLED)("Aplicação de feedback — prova Postgres", () => {
  const created = { people: [] as string[], cases: [] as string[], feedbacks: [] as string[] }
  let teamId: string
  let joana: string
  let other: string
  let recent: string
  let old: string
  let othersFeedback: string

  async function publish(operatorId: string, input: { publishedAt: Date; snapshot: Record<string, unknown>; kind?: "INDICATOR" | "MONITORING" }) {
    const caseId = (await pool.query<{ id: string }>(
      `insert into supervision_cases (organization_id, operator_id, team_id, title, summary, priority, indicator_code, indicator_value, indicator_target) values ($1,$2,$3,'Rechamada','Rechamada de 14,6%.','P2','RECHAMADA','14,6%','10%') returning id`,
      [ORG, operatorId, teamId],
    )).rows[0]!.id
    created.cases.push(caseId)
    const id = (await pool.query<{ id: string }>(
      `insert into feedbacks (organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, context_snapshot, published_at, created_at, updated_at)
       values ($1,$2,$3,'PUBLISHED',$4,'Rechamada','7 de 48 interações marcadas.','—','—','Texto publicado.',$5,$6,$6,$6) returning id`,
      [ORG, caseId, operatorId, input.kind ?? "INDICATOR", JSON.stringify(input.snapshot), input.publishedAt],
    )).rows[0]!.id
    created.feedbacks.push(id)
    return id
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 })
    teamId = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    for (const name of ["Joana Prova Aplicação", "Outra Pessoa Prova Aplicação"]) {
      created.people.push((await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1,$2,'OPERATOR',$3) returning id", [ORG, name, teamId])).rows[0]!.id)
    }
    ;[joana, other] = created.people as [string, string]
    recent = await publish(joana, { publishedAt: new Date(Date.now() - 2 * 24 * 3_600_000), snapshot: { reliableFeedback: { feedbackView: VIEW } } })
    old = await publish(joana, { publishedAt: new Date(Date.now() - 40 * 24 * 3_600_000), snapshot: { periodSummary: { periodLabel: "Ontem (D-1)", periodStart: "2026-08-10T03:00:00.000Z", periodEnd: "2026-08-11T03:00:00.000Z" } } })
    othersFeedback = await publish(other, { publishedAt: new Date(), snapshot: {} })
  })

  afterAll(async () => {
    if (!pool) return
    const apps = (await pool.query<{ id: string; conversation_id: string | null }>("select id, conversation_id from feedback_applications where recipient_person_id = any($1)", [created.people])).rows
    await pool.query("delete from audit_logs where entity_type = 'feedback_application' and entity_id = any($1)", [apps.map((app) => app.id)])
    await pool.query("delete from feedback_applications where id = any($1)", [apps.map((app) => app.id)])
    await pool.query("delete from assistant_interactions where operator_id = any($1)", [created.people])
    await pool.query("delete from assistant_conversations where owner_person_id = any($1)", [created.people])
    await pool.query("delete from feedbacks where id = any($1)", [created.feedbacks])
    await pool.query("delete from supervision_cases where id = any($1)", [created.cases])
    await pool.query("delete from people where id = any($1)", [created.people])
    await pool.end()
  })

  it("convite: o feedback novo convida; o antigo nunca; 'Depois' persiste", async () => {
    const scope = { organizationId: ORG, personId: joana }
    const invite = await loadCurrentInvite(db(), scope, new Date())
    expect(invite).toMatchObject({ source: { kind: "PUBLISHED_FEEDBACK", id: recent }, subject: "Rechamada", periodLabel: "Agosto de 2026" })
    await recordInviteEvent(db(), scope, { kind: "PUBLISHED_FEEDBACK", id: recent }, "OFFER", new Date())
    await recordInviteEvent(db(), scope, { kind: "PUBLISHED_FEEDBACK", id: recent }, "SNOOZE", new Date())
    await recordInviteEvent(db(), scope, { kind: "PUBLISHED_FEEDBACK", id: recent }, "SNOOZE", new Date())
    expect(await loadCurrentInvite(db(), scope, new Date())).toBeNull()
    await expect(recordInviteEvent(db(), scope, { kind: "PUBLISHED_FEEDBACK", id: othersFeedback }, "OFFER", new Date())).rejects.toMatchObject({ statusCode: 404 })
  })

  it("5 inícios concorrentes = UMA aplicação, UMA conversa, UMA apresentação; outra pessoa = 404", async () => {
    const scope = { organizationId: ORG, personId: joana }
    const results = await Promise.all(Array.from({ length: 5 }, () => startOrResumeApplication(db(), scope, { kind: "PUBLISHED_FEEDBACK", id: recent }, new Date())))
    expect(new Set(results.map((result) => result.application.id)).size).toBe(1)
    expect(results.filter((result) => result.created)).toHaveLength(1)
    const application = results[0]!.application
    expect(application).toMatchObject({ status: "IN_PROGRESS", title: "Rechamada", periodLabel: "Agosto de 2026", historical: true })
    expect((await pool.query("select count(*)::int n from assistant_conversations where owner_person_id = $1 and origin = 'FEEDBACK'", [joana])).rows[0].n).toBe(1)
    expect((await pool.query("select count(*)::int n from assistant_interactions where conversation_id = $1", [application.conversationId])).rows[0].n).toBe(1)
    // O convite resolvido antes ("Depois") não é tocado ao iniciar pelo botão do feed.
    expect(application.invite.resolution).toBe("SNOOZED")
    await expect(startOrResumeApplication(db(), scope, { kind: "PUBLISHED_FEEDBACK", id: othersFeedback }, new Date())).rejects.toMatchObject({ statusCode: 404 })
    await expect(startOrResumeApplication(db(), { organizationId: ORG, personId: other }, { kind: "PUBLISHED_FEEDBACK", id: recent }, new Date())).rejects.toMatchObject({ statusCode: 404 })
  })

  it("contexto = registro publicado: mudar a meta atual não muda a explicação; rótulo relativo vira a data registrada", async () => {
    const scope = { organizationId: ORG, personId: joana }
    const [application] = (await listApplications(db(), scope)).filter((item) => item.source.id === recent)
    const before = await loadApplicationInstructionByConversation(db(), { organizationId: ORG, ownerPersonId: joana, conversationId: application!.conversationId!, now: new Date() })
    await pool.query("update supervision_cases set indicator_target = '2%' where id = any($1)", [created.cases])
    const after = await loadApplicationInstructionByConversation(db(), { organizationId: ORG, ownerPersonId: joana, conversationId: application!.conversationId!, now: new Date() })
    expect(after!.instruction).toBe(before!.instruction)
    expect(after!.instruction).toContain("Meta oficial = 10%")
    const legacy = await startOrResumeApplication(db(), scope, { kind: "PUBLISHED_FEEDBACK", id: old }, new Date())
    expect(legacy.application.periodLabel).toBe("10/08/2026")
    expect(legacy.application.limitations.join(" ")).toMatch(/não uma tabela estruturada de valores e metas/)
  })

  it("sair por agora e o áudio não concluem; concluir encerra a conversa sem ciência e sem mexer no caso; reiniciar = a mesma", async () => {
    const scope = { organizationId: ORG, personId: joana }
    const { application } = await startOrResumeApplication(db(), scope, { kind: "PUBLISHED_FEEDBACK", id: recent }, new Date())
    await recordPresentationEvent(db(), scope, application.id, "STARTED", new Date())
    await recordPresentationEvent(db(), scope, application.id, "COMPLETED", new Date())
    const paused = await pauseApplication(db(), scope, application.id, new Date())
    expect(paused.status).toBe("IN_PROGRESS")
    expect(paused.presentation.completedAt).not.toBeNull()

    const caseBefore = (await pool.query("select status, updated_at from supervision_cases where id = $1", [created.cases[0]])).rows[0]
    const completed = await completeApplication(db(), scope, application.id, new Date())
    expect(completed.status).toBe("COMPLETED")
    expect((await completeApplication(db(), scope, application.id, new Date())).completedAt).toBe(completed.completedAt)
    expect((await pool.query("select status, close_reason from assistant_conversations where id = $1", [application.conversationId])).rows[0]).toEqual({ status: "CLOSED", close_reason: "COMPLETED" })
    expect((await pool.query("select acknowledged_at from feedbacks where id = $1", [recent])).rows[0].acknowledged_at).toBeNull()
    expect((await pool.query("select status, updated_at from supervision_cases where id = $1", [created.cases[0]])).rows[0]).toEqual(caseBefore)

    // Pergunta nova depois de concluir: recusada; a resposta que já estava em processamento entra (janela curta) sem reabrir.
    await expect(resolveConversationForWrite(db(), { organizationId: ORG, ownerPersonId: joana }, application.conversationId, new Date())).rejects.toMatchObject({ statusCode: 409 })
    expect((await resolveConversationForWrite(db(), { organizationId: ORG, ownerPersonId: joana }, application.conversationId, new Date(), { allowClosed: true })).closed).toBe(true)
    await expect(resolveConversationForWrite(db(), { organizationId: ORG, ownerPersonId: joana }, application.conversationId, new Date(Date.now() + 10 * 60_000), { allowClosed: true })).rejects.toMatchObject({ statusCode: 409 })

    const again = await startOrResumeApplication(db(), scope, { kind: "PUBLISHED_FEEDBACK", id: recent }, new Date())
    expect(again).toMatchObject({ created: false, application: { id: application.id, status: "COMPLETED" } })
    await expect(recordPresentationEvent(db(), scope, application.id, "STARTED", new Date())).rejects.toMatchObject({ statusCode: 409 })
    expect(await loadCurrentInvite(db(), scope, new Date())).toBeNull()
  })

  it("conversa complementar: abrir não cria; a primeira dúvida cria UMA com o mesmo registro; nada da aplicação muda", async () => {
    const scope = { organizationId: ORG, personId: joana }
    const opened = await startOrResumeApplication(db(), scope, { kind: "PUBLISHED_FEEDBACK", id: recent }, new Date())
    const application = opened.application
    expect(application.status).toBe("COMPLETED")
    expect(application.followUpConversationId).toBeNull()
    // Conteúdo exibido = a apresentação publicada (mesma versão aplicada), sem dado atual.
    expect(application.content?.view?.narrative[0]).toMatch(/14,6%/)
    expect(application.content?.indicators[0]?.lines).toContainEqual({ label: "Meta oficial", value: "10%" })
    const appBefore = (await pool.query("select status, completed_at, updated_at, context from feedback_applications where id = $1", [application.id])).rows[0]
    const caseBefore = (await pool.query("select status, updated_at from supervision_cases where id = $1", [created.cases[0]])).rows[0]

    const results = await Promise.all(Array.from({ length: 5 }, () => resolveApplicationConversation(db(), scope, { applicationId: application.id, requestedConversationId: null, now: new Date() })))
    expect(new Set(results.map((result) => result.conversationId)).size).toBe(1)
    expect(results.filter((result) => result.created)).toHaveLength(1)
    const followUpId = results[0]!.conversationId
    expect(followUpId).not.toBe(application.conversationId)
    expect(results[0]!.role).toBe("FOLLOW_UP")
    expect((await pool.query("select status, origin from assistant_conversations where id = $1", [followUpId])).rows[0]).toEqual({ status: "ACTIVE", origin: "FEEDBACK" })
    expect((await loadOwnConversationSummary(db(), { organizationId: ORG, ownerPersonId: joana }, followUpId))?.feedbackFollowUp).toBe(true)
    expect((await getApplication(db(), scope, application.id)).followUpConversationId).toBe(followUpId)
    // Pergunta enviada com a conversa complementar: continua nela; a original segue encerrada.
    expect(await resolveApplicationConversation(db(), scope, { applicationId: application.id, requestedConversationId: followUpId, now: new Date() })).toEqual({ conversationId: followUpId, role: "FOLLOW_UP", created: false })
    expect((await resolveConversationForWrite(db(), { organizationId: ORG, ownerPersonId: joana }, followUpId, new Date())).conversationId).toBe(followUpId)
    expect((await pool.query("select status from assistant_conversations where id = $1", [application.conversationId])).rows[0].status).toBe("CLOSED")

    // Mesmo registro congelado + a conversa original como dado; nunca dado atual.
    const instruction = await loadApplicationInstructionByConversation(db(), { organizationId: ORG, ownerPersonId: joana, conversationId: followUpId, now: new Date() })
    expect(instruction).toMatchObject({ applicationId: application.id, role: "FOLLOW_UP" })
    expect(instruction!.instruction).toContain("Meta oficial = 10%")
    expect(instruction!.instruction).toContain("conversa COMPLEMENTAR")
    expect(instruction!.instruction).toContain("CONVERSA ORIGINAL DA APLICAÇÃO")
    expect(await loadApplicationVoiceInstruction(db(), scope, application.id, new Date())).toContain("conversa COMPLEMENTAR")

    // Nada da aplicação, da ciência ou do caso mudou.
    expect((await pool.query("select status, completed_at, updated_at, context from feedback_applications where id = $1", [application.id])).rows[0]).toEqual(appBefore)
    expect((await pool.query("select acknowledged_at from feedbacks where id = $1", [recent])).rows[0].acknowledged_at).toBeNull()
    expect((await pool.query("select status, updated_at from supervision_cases where id = $1", [created.cases[0]])).rows[0]).toEqual(caseBefore)

    // Conversa de OUTRO contexto pedida para esta aplicação = 409; outra pessoa = 404; em andamento = a conversa da aplicação.
    const legacy = (await listApplications(db(), scope)).find((item) => item.source.id === old)!
    await expect(resolveApplicationConversation(db(), scope, { applicationId: application.id, requestedConversationId: legacy.conversationId, now: new Date() })).rejects.toMatchObject({ statusCode: 409, code: "FEEDBACK_APPLICATION_CONVERSATION_MISMATCH" })
    await expect(resolveApplicationConversation(db(), { organizationId: ORG, personId: other }, { applicationId: application.id, requestedConversationId: null, now: new Date() })).rejects.toMatchObject({ statusCode: 404 })
    expect(await resolveApplicationConversation(db(), scope, { applicationId: legacy.id, requestedConversationId: null, now: new Date() })).toEqual({ conversationId: legacy.conversationId, role: "APPLICATION", created: false })
  })
})
