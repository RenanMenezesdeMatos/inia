/**
 * PROVA contra o banco de TESTE real — Indicadores de sucesso da INIA. Cria DUAS organizações próprias (Grupos, Subgrupos, pessoas,
 * conversas, avaliações, feedbacks, contestações, pedidos ao Anjo e conferências), CONFIRMA os dados e apaga, no fim, só o que é delas.
 * Nenhuma chamada de modelo.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run inia-success-proof
 *
 * Prova: tempo de resposta pela chave pergunta → resposta (média = soma ÷ medidas, nunca média de médias; sem par, sem chave, sem
 * resposta e texto digitado na voz fora da média e contados na cobertura); avaliação VIGENTE (troca conta uma vez, retirada não conta);
 * a evolução por dia soma exatamente o funil oficial; rotas com várias por resposta e esclarecimento aguardando escolha fora;
 * contestação com a regra da fila (revisada continua contada; retirada sem resposta não), procedência sobre as revisadas, pendentes à
 * parte, o próprio leitor fora; classificações do Anjo pelo escopo congelado; conformidade só nas superfícies de conversa; treino fora;
 * cada bloco no alcance da sua permissão; outra organização nunca entra; 403 sem permissão do bloco; período acima de 92 dias = 422.
 */
import { randomUUID } from "node:crypto"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { complianceSummary } from "../application/compliance-reader.js"
import { feedbackSummary } from "../application/feedback-reader.js"
import { repliesSummary } from "../application/replies-reader.js"
import { responseTimeSummary } from "../application/response-time-reader.js"
import { routesSummary } from "../application/routes-reader.js"
import { supportSummary } from "../application/support-reader.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = randomUUID()
const ORG2 = randomUUID()
const PASSWORD = "Ipe-Amarelo-Prova-2026"
let pool: pg.Pool
const db = () => pool as unknown as Database
const ids: Record<string, string> = {}
const email: Record<string, string> = {}
const accounts: string[] = []
let period = { from: "", to: "" }
let base = { yesterday: new Date(), today: new Date() }

const sql = (text: string, values: unknown[] = []) => pool.query(text, values)
const at = (start: Date, seconds: number) => new Date(start.getTime() + seconds * 1000)
const viewer = (key: string, organizationId = ORG) => ({ organizationId, personId: ids[key]! })

async function person(key: string, organizationId: string, place: { team?: string; subteam?: string } = {}) {
  ids[key] = (await sql(`insert into people (organization_id, name, role, team_id, subteam_id, active) values ($1, $2, 'OPERATOR', $3, $4, true) returning id`, [organizationId, `Prova Sucesso ${key}`, place.team ? ids[place.team] : null, place.subteam ? ids[place.subteam] : null])).rows[0].id
  return ids[key]!
}
async function account(key: string, organizationId: string, roles: { role: string; scope: "ORGANIZATION" | "GROUP"; team?: string }[] = []) {
  email[key] = `${key.toLowerCase()}.${ids[key]!.slice(0, 8)}@prova-sucesso.inia.local`
  const id = (await sql(`insert into user_accounts (organization_id, person_id, email, password_hash, active, password_change_required) values ($1, $2, $3, $4, true, false) returning id`, [organizationId, ids[key], email[key], await hashPassword(PASSWORD)])).rows[0].id as string
  accounts.push(id)
  for (const grant of roles) await sql(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())`, [organizationId, id, grant.role, grant.scope, grant.team ? ids[grant.team] : null])
}
async function conversation(key: string, owner: string, origin = "USER", organizationId = ORG) {
  ids[key] = (await sql(`insert into assistant_conversations (organization_id, owner_person_id, origin, started_at, last_activity_at) values ($1, $2, $3, $4, $4) returning id`, [organizationId, ids[owner], origin, base.yesterday])).rows[0].id
  return ids[key]!
}
async function message(conversationKey: string, input: { role: "user" | "assistant"; channel?: "chat" | "voice"; key?: string | null; at: Date; toolCalls?: unknown; organizationId?: string }) {
  const owner = (await sql(`select owner_person_id from assistant_conversations where id = $1`, [ids[conversationKey]])).rows[0].owner_person_id
  return (await sql(`insert into assistant_interactions (organization_id, operator_id, conversation_id, channel, role, content, client_message_id, occurred_at, tool_calls) values ($1, $2, $3, $4, $5, 'texto da prova', $6, $7, $8) returning id`, [input.organizationId ?? ORG, owner, ids[conversationKey], input.channel ?? "chat", input.role, input.key ?? null, input.at, input.toolCalls ? JSON.stringify(input.toolCalls) : null])).rows[0].id as string
}
async function rating(interactionId: string, owner: string, conversationKey: string, value: "UP" | "DOWN" | "NONE", created: Date, superseded: Date | null = null) {
  return (await sql(`insert into assistant_interaction_ratings (organization_id, person_id, conversation_id, interaction_id, value, created_at, superseded_at) values ($1, $2, $3, $4, $5, $6, $7) returning id`, [ORG, ids[owner], ids[conversationKey], interactionId, value, created, superseded])).rows[0].id as string
}

describe.skipIf(!ENABLED)("Indicadores de sucesso da INIA — prova Postgres", () => {
  const replies: string[] = []
  let trainingOrigin = false

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 })
    for (const [organizationId, name] of [[ORG, "Prova Sucesso INIA"], [ORG2, "Prova Sucesso INIA 2"]] as const) {
      await sql(`insert into organizations (id, name, slug) values ($1, $2, $3)`, [organizationId, name, `prova-sucesso-${organizationId.slice(0, 8)}`])
    }
    const operation = (await sql(`insert into operations (organization_id, name) values ($1, 'Prova Sucesso') returning id`, [ORG])).rows[0].id
    await sql(`insert into operations (organization_id, name) values ($1, 'Prova Sucesso 2')`, [ORG2])
    for (const team of ["G1", "G2"]) ids[team] = (await sql(`insert into teams (organization_id, operation_id, name) values ($1, $2, $3) returning id`, [ORG, operation, `Prova ${team}`])).rows[0].id
    for (const [subteam, team] of [["S1", "G1"], ["S2", "G2"]] as const) ids[subteam] = (await sql(`insert into subteams (organization_id, team_id, name) values ($1, $2, $3) returning id`, [ORG, ids[team], `Prova ${subteam}`])).rows[0].id
    const local = (await sql(`select to_char((now() at time zone analytics_org_timezone($1))::date - 1, 'YYYY-MM-DD') y, to_char((now() at time zone analytics_org_timezone($1))::date, 'YYYY-MM-DD') t,
        (((now() at time zone analytics_org_timezone($1))::date - 1) + time '10:00') at time zone analytics_org_timezone($1) yesterday,
        (((now() at time zone analytics_org_timezone($1))::date) + time '00:30') at time zone analytics_org_timezone($1) today`, [ORG])).rows[0]
    period = { from: local.y, to: local.t }
    base = { yesterday: local.yesterday, today: local.today }

    await person("ADMIN", ORG)
    await account("ADMIN", ORG, [{ role: "ADMINISTRADOR_GERAL", scope: "ORGANIZATION" }])
    await person("VIEW", ORG, { team: "G1" })
    await account("VIEW", ORG, [
      { role: "LEITOR_DE_CONVERSAS_INIA", scope: "GROUP", team: "G1" },
      { role: "COORDENADOR_DE_ANJOS", scope: "GROUP", team: "G1" },
      { role: "REVISOR_DE_CONTESTACOES", scope: "GROUP", team: "G1" },
    ])
    await person("REV", ORG, { team: "G1" })
    await account("REV", ORG, [{ role: "REVISOR_DE_CONTESTACOES", scope: "GROUP", team: "G1" }])
    await person("PLAIN", ORG, { team: "G1" })
    await account("PLAIN", ORG)
    await person("O1", ORG, { team: "G1", subteam: "S1" })
    await person("OUT", ORG, { team: "G2", subteam: "S2" })
    await person("ANJO", ORG, { team: "G1" })
    await person("X1", ORG2)

    // ---------------- Conversas: tempo de resposta, avaliações, sinais e rotas ----------------
    await conversation("C1", "O1")
    const ask = async (key: string | null, when: Date, replyAfter: number | null, extra: { toolCalls?: unknown } = {}) => {
      const question = await message("C1", { role: "user", key, at: when })
      if (replyAfter !== null) replies.push(await message("C1", { role: "assistant", key: `${key}:reply`, at: at(when, replyAfter), toolCalls: extra.toolCalls }))
      return question
    }
    const agent = (await sql(`insert into agents_all (organization_id, name, agent_type, objective, description, context_prompt) values ($1, 'Especialista Prova', 'CUSTOM', 'o', 'd', 'c') returning id`, [ORG])).rows[0].id
    // Ontem: 1 resposta de 100 s. Hoje: 10, 20, 30 e 40 s. Média certa = 200/5 = 40 s (a média das médias diárias daria 62,5 s).
    await ask("k1", base.yesterday, 100, { toolCalls: [{ toolName: "my_results" }] })
    await ask("k2", base.today, 10, { toolCalls: [{ toolName: "my_results" }, { toolName: "leadership_people" }] })
    await ask("k3", at(base.today, 300), 20, { toolCalls: [{ toolName: "response_check", outcome: "ALLOWED" }] })
    await ask("k4", at(base.today, 600), 30, { toolCalls: [{ toolName: "agent_0123456789abcdef0123456789abcdef" }] })
    await ask("k5", at(base.today, 900), 40)
    await sql(`insert into assistant_interaction_agents (organization_id, interaction_id, agent_id, role, outcome) values ($1, $2, $3, 'SPECIALIST', 'EXECUTED')`, [ORG, replies[0], agent])
    const noReply = await ask("k6", at(base.today, 1200), null)
    await sql(`insert into assistant_reply_signals (interaction_id, organization_id, person_id, signals, signal_version) values ($1, $2, $3, array['NO_REPLY'], 'SUPPORT_SIGNALS_V1')`, [noReply, ORG, ids.O1])
    await ask("k7", at(base.today, 1500), null)
    await message("C1", { role: "user", key: null, at: at(base.today, 1800) })
    // Texto digitado com a voz ligada (turno da voz) e a resposta falada.
    await message("C1", { role: "user", key: "t9:user", at: at(base.today, 2100) })
    const voiceReply = await message("C1", { role: "assistant", channel: "voice", key: "t9:assistant", at: at(base.today, 2130) })
    // Esclarecimento ainda aguardando escolha: pergunta da INIA, não resposta.
    await message("C1", { role: "assistant", key: "k10:reply", at: at(base.today, 2400), toolCalls: [{ toolName: "knowledge_clarification", state: { status: "OPEN" } }] })
    for (const [index, reply] of replies.entries()) {
      await sql(`insert into assistant_reply_signals (interaction_id, organization_id, person_id, signals, signal_version) values ($1, $2, $3, $4, 'SUPPORT_SIGNALS_V1')`, [reply, ORG, ids.O1, index === 3 ? ["KNOWLEDGE_NOT_FOUND"] : []])
    }
    // Avaliações: r1 útil; r2 não útil → útil (conta uma vez, útil); r3 útil → retirada; r4 não útil com motivo; r5 sem avaliação; voz não útil.
    const t = (seconds: number) => at(base.today, 3000 + seconds)
    await rating(replies[0]!, "O1", "C1", "UP", t(1))
    await rating(replies[1]!, "O1", "C1", "DOWN", t(1), t(2))
    await rating(replies[1]!, "O1", "C1", "UP", t(2))
    await rating(replies[2]!, "O1", "C1", "UP", t(1), t(3))
    await rating(replies[2]!, "O1", "C1", "NONE", t(3))
    const down = await rating(replies[3]!, "O1", "C1", "DOWN", t(1))
    await sql(`insert into assistant_interaction_rating_details (rating_id, organization_id, person_id, reason, still_needs_help, catalog_version) values ($1, $2, $3, 'INCOMPLETE', true, 'CHAT_DISLIKE_REASONS_V1')`, [down, ORG, ids.O1])
    await rating(voiceReply, "O1", "C1", "DOWN", t(1))
    // Treino: nunca entra. A origem TRAINING só existe onde a migration do Treino com a INIA foi aplicada (ainda fora do tronco):
    // a prova monta a conversa de treino só quando o banco a aceita — as contagens esperadas são as mesmas nos dois casos.
    trainingOrigin = (await sql(`select pg_get_constraintdef(oid) def from pg_constraint where conname = 'assistant_conversations_origin_check'`)).rows.some((row) => String(row.def).includes("'TRAINING'"))
    if (trainingOrigin) {
      await conversation("CT", "O1", "TRAINING")
      await message("CT", { role: "user", key: "tr1", at: base.today })
      await message("CT", { role: "assistant", key: "tr1:reply", at: at(base.today, 5) })
    }
    // Fora do Grupo do leitor (G2): só o Administrador geral vê.
    await conversation("CO", "OUT")
    await message("CO", { role: "user", key: "o1", at: base.today })
    await message("CO", { role: "assistant", key: "o1:reply", at: at(base.today, 500) })
    // Outra organização: nunca entra.
    await conversation("CX", "X1", "USER", ORG2)
    await message("CX", { role: "user", key: "x1", at: base.today, organizationId: ORG2 })
    await message("CX", { role: "assistant", key: "x1:reply", at: at(base.today, 7), organizationId: ORG2 })

    // ---------------- Feedbacks, avaliações e contestações ----------------
    const caseOf = async (operator: string) => (await sql(`insert into supervision_cases (organization_id, operator_id, team_id, title, summary, priority, indicator_code, indicator_value, indicator_target) values ($1, $2, $3, 'Prova sucesso', 'Resumo.', 'P3', 'TMA', '400', '380') returning id`, [ORG, ids[operator], ids.G1])).rows[0].id
    const feedback = async (key: string, operator: string, kind: "INDICATOR" | "MONITORING", acknowledged = false) => {
      ids[key] = (await sql(`insert into feedbacks (organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, published_at, acknowledged_at)
          values ($1, $2, $3, 'PUBLISHED', $4, 'TMA', '“trecho”', 'Comportamento.', 'Procedimento 1', 'Recomendação.', $5, $6) returning id`, [ORG, await caseOf(operator), ids[operator], kind, base.today, acknowledged ? at(base.today, 60) : null])).rows[0].id
    }
    const rate = async (key: string, operator: string, value: "UP" | "DOWN" | "NONE", created: Date, superseded: Date | null = null, reason: string | null = null, decision: string | null = null) => {
      const id = (await sql(`insert into feedback_ratings (organization_id, person_id, source_kind, feedback_id, value, reason, comment, created_at, superseded_at) values ($1, $2, 'PUBLISHED_FEEDBACK', $3, $4, $5, $6, $7, $8) returning id`, [ORG, ids[operator], ids[key], value, reason, value === "DOWN" ? "Descrição da prova." : null, created, superseded])).rows[0].id
      if (decision) await sql(`insert into feedback_rating_reviews (organization_id, rating_id, reviewer_person_id, decision, response) values ($1, $2, $3, $4, 'Resposta da revisão.')`, [ORG, id, ids.ADMIN, decision])
    }
    for (const [key, kind, ack] of [["F1", "INDICATOR", true], ["F2", "MONITORING", false], ["F3", "MONITORING", false], ["F4", "INDICATOR", false], ["F5", "MONITORING", false], ["F6", "INDICATOR", false], ["F7", "MONITORING", false], ["F10", "INDICATOR", false]] as const) await feedback(key, "O1", kind, ack)
    await feedback("F8", "OUT", "MONITORING")
    await feedback("F9", "VIEW", "MONITORING")
    await rate("F1", "O1", "UP", t(1))
    await rate("F2", "O1", "DOWN", t(1), null, "INACCURATE", "ACCEPTED")
    await rate("F3", "O1", "DOWN", t(1), t(2), "UNCLEAR")
    await rate("F3", "O1", "UP", t(2))
    await rate("F4", "O1", "DOWN", t(1), t(3), "WRONG_PROCESS", "REJECTED")
    await rate("F4", "O1", "UP", t(3))
    await rate("F5", "O1", "DOWN", t(1), null, "UNCLEAR")
    await rate("F7", "O1", "DOWN", t(1), null, "NOT_HELPFUL", "PARTIALLY_ACCEPTED")
    await rate("F10", "O1", "UP", t(1), t(2))
    await rate("F10", "O1", "NONE", t(2))
    await rate("F8", "OUT", "DOWN", t(1), null, "OTHER")
    await rate("F9", "VIEW", "DOWN", t(1), null, "OTHER")

    // ---------------- Apoio com Anjo (escopo congelado no pedido) ----------------
    const support = async (code: string, operator: string, team: string, origin: string, reason: string, outcome: string, title: string | null) => {
      const requestId = (await sql(`insert into human_support_requests (organization_id, protocol, operator_person_id, team_id, origin, shared_context, context_version, client_request_id, status, end_cause, queued_at, queue_expires_at, queue_deadline_basis, created_at, ended_at)
          values ($1, $2, $3, $4, $5, '{}', 'SUPPORT_CONTEXT_V1', $6, 'CLOSED', 'ANJO_CLOSED', $7, $8, 'DEFAULT', $7, $9) returning id`, [ORG, code, ids[operator], ids[team], origin, randomUUID(), base.today, at(base.today, 1200), at(base.today, 900)])).rows[0].id
      const attendance = (await sql(`insert into human_support_attendances (organization_id, request_id, anjo_person_id, operator_person_id, status, end_cause, started_at, first_anjo_message_at, ended_at) values ($1, $2, $3, $4, 'ENDED', 'ANJO_CLOSED', $5, $6, $7) returning id`, [ORG, requestId, ids.ANJO, ids[operator], at(base.today, 60), at(base.today, 90), at(base.today, 900)])).rows[0].id
      await sql(`insert into human_support_classifications (attendance_id, organization_id, anjo_person_id, operator_person_id, reason, reference_title, outcome, catalog_version) values ($1, $2, $3, $4, $5, $6, $7, 'CLASSIFICATION_CATALOG_V2')`, [attendance, ORG, ids.ANJO, ids[operator], reason, title, outcome])
    }
    await support("AP-PRVA22", "O1", "G1", "SIGNAL", "FOUND_IN_PROCESS", "RESOLVED", "Processo de prova")
    await support("AP-PRVA23", "O1", "G1", "DISLIKE", "NO_PROCESS", "NOT_RESOLVED", null)
    await support("AP-PRVA24", "OUT", "G2", "SIGNAL", "QUESTION_UNCLEAR", "GUIDED", null)

    // ---------------- Conferência das respostas ----------------
    const check = async (conversationKey: string | null, surface: string, outcome: string, action: string, organizationId = ORG) =>
      sql(`insert into response_compliance_checks (organization_id, surface, control, outcome, action, flagged_content, conversation_id, prompt_version) values ($1, $2, 'PREVENTIVE', $3, $4, $5, $6, 'PROVA')`, [organizationId, surface, outcome, action, outcome === "ALLOWED" ? null : "texto", conversationKey ? ids[conversationKey] : null])
    for (let index = 0; index < 5; index += 1) await check("C1", "CHAT", "ALLOWED", "DELIVERED")
    await check("C1", "VOICE_SPOKEN", "VIOLATION", "RECORDED")
    await check("C1", "CHAT", "CHECK_FAILED", "BLOCKED")
    await check(null, "AGENT_RUN", "VIOLATION", "BLOCKED")
    if (trainingOrigin) await check("CT", "CHAT", "ALLOWED", "DELIVERED")
    await check("CO", "CHAT", "ALLOWED", "DELIVERED")
    await check("CX", "CHAT", "VIOLATION", "BLOCKED", ORG2)
  }, 120_000)

  afterAll(async () => {
    if (!pool) return
    await sql(`delete from auth_login_attempts where account_id = any($1)`, [accounts]).catch(() => undefined)
    const tables = (await sql(`select c.table_name from information_schema.columns c join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
        where c.table_schema = 'public' and c.column_name = 'organization_id' and t.table_type = 'BASE TABLE' and c.table_name <> 'organizations'`)).rows.map((row) => row.table_name as string)
    // Várias passadas: a ordem das chaves estrangeiras se resolve sozinha; só linhas destas duas organizações.
    for (let pass = 0; pass < 6; pass += 1) {
      let failed = 0
      for (const table of tables) await sql(`delete from ${table} where organization_id = any($1)`, [[ORG, ORG2]]).catch(() => (failed += 1))
      if (failed === 0) break
    }
    for (const organizationId of [ORG, ORG2]) await sql(`delete from organizations where id = $1`, [organizationId]).catch((error: unknown) => console.error("limpeza organizations:", (error as Error).message))
    await pool.end()
  }, 120_000)

  it("tempo de resposta: pareado pela chave, média ponderada, ausentes fora da média e na cobertura; treino e outro Grupo fora", async () => {
    const summary = await responseTimeSummary(db(), viewer("VIEW"), period)
    expect(summary.text).toMatchObject({ questions: 8, measured: 5, noReply: 1, noKey: 1, unpaired: 1, invalid: 0, medianSeconds: 30, p90Seconds: 100 })
    expect(summary.text.average).toMatchObject({ sum: 200, count: 5, status: "OK" })
    expect(summary.text.average.value).toBeCloseTo(40)
    expect(summary.text.coverage).toMatchObject({ numerator: 5, denominator: 8, status: "OK" })
    expect(summary.voice).toEqual({ status: "NOT_MEASURED", answers: 1, typedQuestions: 1 })
    expect(summary.series.map((point) => [point.bucket.key, point.measured, point.average.sum])).toEqual([
      [period.from, 1, 100],
      [period.to, 4, 100],
    ])
    // Um dia com 1 medida: amostra pequena, nunca uma média frágil.
    expect(summary.series[0]!.average).toMatchObject({ value: null, status: "SMALL_SAMPLE" })
    const admin = await responseTimeSummary(db(), viewer("ADMIN"), period)
    expect(admin.text).toMatchObject({ questions: 9, measured: 6 })
    expect(admin.text.average.sum).toBeCloseTo(700)
    expect((await responseTimeSummary(db(), viewer("ADMIN"), { ...period, teamId: ids.G2 })).text).toMatchObject({ questions: 1, measured: 1 })
  })

  it("avaliação das respostas: vigente conta uma vez, retirada não conta, evolução por dia = funil oficial", async () => {
    const summary = await repliesSummary(db(), viewer("VIEW"), period)
    const measure = (id: string) => summary.funnel.measures.find((entry) => entry.id === id)!
    expect(measure("M1").main.value).toBe(6)
    expect(measure("M2").main).toMatchObject({ numerator: 4, denominator: 6 })
    expect(measure("M3").main).toMatchObject({ numerator: 2, denominator: 4, status: "SMALL_SAMPLE" })
    expect(measure("M6").main).toMatchObject({ numerator: 1, denominator: 5 })
    const sum = (key: "answers" | "up" | "down" | "withSignalRow" | "withSignal") => summary.series.reduce((total, point) => total + point[key], 0)
    expect([sum("answers"), sum("up") + sum("down"), sum("up"), sum("withSignalRow"), sum("withSignal")]).toEqual([6, 4, 2, 5, 1])
    expect(summary.byChannel).toEqual([
      expect.objectContaining({ channel: "chat", answers: 5, up: 2, down: 1 }),
      expect.objectContaining({ channel: "voice", answers: 1, up: 0, down: 1 }),
    ])
    expect((await repliesSummary(db(), viewer("ADMIN"), period)).funnel.measures.find((entry) => entry.id === "M1")!.main.value).toBe(7)
  })

  it("motivos de procura pela rota: várias rotas por resposta, ferramentas que não são rota e esclarecimento aguardando ficam fora", async () => {
    const summary = await routesSummary(db(), viewer("VIEW"), period)
    expect(summary.answers).toBe(6)
    expect(summary.routes.map((route) => [route.kind, route.label, route.answers])).toEqual([
      ["DIRECT", "Consulta aos próprios resultados", 2],
      ["SPECIALIST", "Especialista Prova", 1],
      ["DIRECT", "Liderança · pessoas", 1],
    ])
    expect(summary.withoutRoute.answers).toBe(4)
    expect(summary.multiRoute).toBe(2)
    expect(summary.byChannel).toEqual({ chat: 5, voice: 1 })
  })

  it("feedbacks: contestação pela regra da fila, procedência sobre as revisadas, pendentes à parte, o próprio leitor fora", async () => {
    const summary = await feedbackSummary(db(), viewer("VIEW"), period)
    expect(summary.counts).toEqual({ delivered: 8, acknowledged: 1, up: 3, down: 3, withdrawn: 1, changed: 3, contested: 4, pending: 1, accepted: 1, partial: 1, rejected: 1 })
    expect(summary.positive).toMatchObject({ numerator: 3, denominator: 6, value: 0.5 })
    expect(summary.negative).toMatchObject({ numerator: 3, denominator: 6, value: 0.5 })
    expect(summary.ratingRate).toMatchObject({ numerator: 6, denominator: 8, value: 0.75 })
    expect(summary.contestation).toMatchObject({ numerator: 4, denominator: 8, value: 0.5 })
    expect(summary.acknowledgement).toMatchObject({ numerator: 1, denominator: 8 })
    expect(summary.reviewed).toBe(3)
    expect(summary.procedence.accepted).toMatchObject({ numerator: 1, denominator: 3, status: "SMALL_SAMPLE" })
    expect(summary.reasons.map((reason) => [reason.reason, reason.count]).sort()).toEqual([["INACCURATE", 1], ["NOT_HELPFUL", 1], ["UNCLEAR", 1], ["WRONG_PROCESS", 1]])
    expect(summary.byKind.map((kind) => [kind.kind, kind.counts.delivered, kind.counts.contested])).toEqual([["INDICATOR", 4, 1], ["MONITORING", 4, 3]])
    expect(summary.agreement).toEqual({ status: "NOT_COLLECTED" })
    const admin = await feedbackSummary(db(), viewer("ADMIN"), period)
    expect(admin.counts).toMatchObject({ delivered: 10, contested: 6, pending: 3 })
  })

  it("Apoio com Anjo: classificações pelo escopo congelado e a evolução soma o funil do apoio", async () => {
    const summary = await supportSummary(db(), viewer("VIEW"), period)
    const reasons = summary.measures.find((measure) => measure.id === "M14")!.breakdown!
    expect(reasons.filter((item) => item.count > 0).map((item) => [item.key, item.count])).toEqual([["NO_PROCESS", 1], ["FOUND_IN_PROCESS", 1]])
    expect(summary.series.reduce((total, point) => total + point.classified, 0)).toBe(2)
    expect(summary.series.reduce((total, point) => total + point.requests, 0)).toBe(2)
    expect(summary.measures.some((measure) => measure.id === "M1")).toBe(false)
    expect((await supportSummary(db(), viewer("ADMIN"), period)).series.reduce((total, point) => total + point.classified, 0)).toBe(3)
  })

  it("conformidade: só superfícies de conversa, treino e outra organização fora, inconclusiva à parte", async () => {
    const summary = await complianceSummary(db(), viewer("ADMIN"), period)
    expect(summary.counts).toEqual({ checks: 8, allowed: 6, violations: 1, blocked: 0, recorded: 1, failed: 1 })
    expect(summary.conformity).toMatchObject({ numerator: 6, denominator: 7 })
    expect(summary.inconclusive).toMatchObject({ numerator: 1, denominator: 8 })
    expect((await complianceSummary(db(), viewer("ADMIN"), { ...period, teamId: ids.G2 })).counts.checks).toBe(1)
  })

  it("pela API: cada bloco exige a própria permissão; sem nenhuma = 403; período acima de 92 dias = 422", async () => {
    const app = createApp(pool, { rateLimits: false })
    const origin = env.allowedOrigins[0]!
    const login = async (key: string) => {
      const agent = request.agent(app)
      expect((await agent.post("/api/v1/auth/login").set("Origin", origin).send({ email: email[key], password: PASSWORD })).status).toBe(200)
      return agent
    }
    const query = `from=${period.from}&to=${period.to}`
    const plain = await login("PLAIN")
    expect((await plain.get("/api/v1/auth/me")).body.data.access.capabilities.canViewIniaSuccess).toBe(false)
    expect((await plain.get("/api/v1/admin/inia-success/context")).status).toBe(403)
    const reviewer = await login("REV")
    expect((await reviewer.get("/api/v1/auth/me")).body.data.access.capabilities.canViewIniaSuccess).toBe(true)
    const context = await reviewer.get("/api/v1/admin/inia-success/context")
    expect(context.status).toBe(200)
    expect(context.body.data.sections).toEqual({ responseTime: false, routes: false, replies: false, support: false, feedback: true, compliance: false })
    expect(context.body.data.teams.map((team: { id: string }) => team.id)).toEqual([ids.G1])
    expect((await reviewer.get(`/api/v1/admin/inia-success/replies?${query}`)).status).toBe(403)
    const feedback = await reviewer.get(`/api/v1/admin/inia-success/feedback?${query}`)
    expect(feedback.status).toBe(200)
    // O revisor alcança o Grupo inteiro (inclusive o feedback de VIEW), menos os próprios.
    expect(feedback.body.data.counts.delivered).toBe(9)
    expect(feedback.body.data.period).toMatchObject({ from: period.from, to: period.to, days: 2, granularity: "DAY" })
    const admin = await login("ADMIN")
    expect((await admin.get("/api/v1/admin/inia-success/context")).body.data.sections).toEqual({ responseTime: true, routes: true, replies: true, support: true, feedback: true, compliance: true })
    expect((await admin.get(`/api/v1/admin/inia-success/compliance?${query}`)).body.data.counts.checks).toBe(8)
    expect((await admin.get(`/api/v1/admin/inia-success/response-time?from=2026-01-01&to=2026-06-30`)).status).toBe(422)
  })
})
