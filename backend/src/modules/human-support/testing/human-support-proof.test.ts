/**
 * PROVA contra o banco de TESTE real: Apoio com Anjo, Parte B (migration 182; design_draft.md, Verification Plan). Cria uma
 * organização própria (Grupos, Subgrupos, operadores, Anjos, Coordenador, Administrador geral), CONFIRMA os dados (as provas de
 * concorrência precisam de duas transações de verdade) e apaga, no fim, só o que é dessa organização. Nenhuma chamada de modelo.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run human-support-proof
 * Se parar sem terminar: `select pid, mode, granted, query from pg_locks join pg_stat_activity using (pid) where not granted;`
 */
import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { exportSubjectData } from "../../data-lifecycle/application/subject-data-export.js"
import { classifyAttendance } from "../application/classification-service.js"
import { createHelpRouteResolver } from "../application/suggestions.js"
import { acknowledgeMessages, signalTyping } from "../application/conversation-marks.js"
import { anjosActivity, anjosNow, listRequests, queueWaiting, listUnavailableAttempts, requestDetail } from "../application/coordination-service.js"
import { dispatchOrganization } from "../application/dispatch.js"
import { evaluateAttendance } from "../application/evaluation-service.js"
import { anjoAttendanceHistory } from "../application/history-service.js"
import { listMessages, sendMessage } from "../application/message-service.js"
import { operationHistory } from "../application/operation-history.js"
import { supportDemand } from "../application/demand-service.js"
import { supportAbandonment, supportAbandonmentList } from "../application/abandonment-service.js"
import { transferAttendance, transferCandidates } from "../application/transfer-service.js"
import { supportFunnel } from "../application/metrics-service.js"
import { cancelRequest, closeRequest, createRequest, previewRequest } from "../application/request-service.js"
import { getResponseTimesPanel, updateGroupResponseTimes, updateOrganizationResponseTimes } from "../application/response-times-service.js"
import { listAnjos, listScopes, updateAnjoCapacity, updateScopeState, updateSettings } from "../application/settings-service.js"
import { cancelScheduledPresence, changePresence, loadAnjoView, loadOperatorView, loadState, renewAnjoLease } from "../application/state-service.js"
import { classificationInputSchema } from "../domain/classification.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
const ORG = randomUUID()
const SLUG = `proof-human-support-${ORG.slice(0, 8)}`
const ids: Record<string, string> = {}
const viewer = (key: string) => ({ organizationId: ORG, personId: ids[key]! })
// "Hoje" no fuso da organização (o painel conta em datas civis locais).
let localToday = ""
const today = () => localToday

async function person(key: string, place: { team?: string; subteam?: string } = {}, account = false) {
  const row = (await pool.query<{ id: string }>(`insert into people (organization_id, name, role, team_id, subteam_id, active) values ($1, $2, 'OPERATOR', $3, $4, true) returning id`, [ORG, `Proof HS ${key}`, place.team ? ids[place.team] : null, place.subteam ? ids[place.subteam] : null])).rows[0]!
  ids[key] = row.id
  if (account) ids[`${key}:account`] = (await pool.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, 'proof-not-a-password') returning id`, [ORG, row.id, `${key.toLowerCase()}.${ORG.slice(0, 8)}@proof.inia.local`])).rows[0]!.id
  return row.id
}
async function grant(key: string, roleCode: string, scope: { type: "ORGANIZATION" } | { type: "GROUP"; team: string } | { type: "SUBGROUP"; subteam: string }) {
  await pool.query(
    `insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, subteam_id, granted_at) values ($1, $2, $3, $4, $5, $6, now())`,
    [ORG, ids[`${key}:account`], roleCode, scope.type, scope.type === "GROUP" ? ids[scope.team] : null, scope.type === "SUBGROUP" ? ids[scope.subteam] : null],
  )
}
const sql = (text: string, params: unknown[] = []) => pool.query(text, params)
/** Fecha tudo o que está aberto na organização da prova (isola um cenário do outro). */
async function resetOpen() {
  await sql(`update human_support_attendances set status = 'ENDED', end_cause = 'ANJO_CLOSED', ended_at = now() where organization_id = $1 and status = 'ACTIVE'`, [ORG])
  await sql(`update human_support_requests set status = 'CLOSED', end_cause = 'ANJO_CLOSED', ended_at = now(), awaiting_operator_since = null where organization_id = $1 and status in ('WAITING', 'IN_PROGRESS', 'AWAITING_OPERATOR')`, [ORG])
  await sql(`update human_support_agent_presence set status = 'OFFLINE', pause_reason = null, lease_until = null, connection_lost_at = null, connection_restored_at = null, scheduled_status = null, scheduled_pause_reason = null, scheduled_at = null where organization_id = $1`, [ORG])
}
async function available(key: string) {
  await renewAnjoLease(pool, viewer(key))
  return changePresence(pool, viewer(key), { status: "AVAILABLE" })
}
const request = (requestId: string) => sql(`select status, end_cause, queued_at, queue_expires_at, created_at, anjos_in_service_at_end from human_support_requests where id = $1`, [requestId]).then((result) => result.rows[0] as { status: string; end_cause: string | null; queued_at: Date; queue_expires_at: Date; created_at: Date; anjos_in_service_at_end: number | null })
const activeOf = (key: string) => sql(`select count(*)::int total from human_support_attendances where organization_id = $1 and anjo_person_id = $2 and status = 'ACTIVE'`, [ORG, ids[key]]).then((result) => (result.rows[0] as { total: number }).total)
const ask = (key: string, extra: Record<string, unknown> = {}) => createRequest(pool, viewer(key), { clientRequestId: randomUUID(), ...extra })

describe.skipIf(!ENABLED)("Apoio com Anjo — prova Postgres", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 24 })
    await sql(`insert into organizations (id, name, slug) values ($1, 'Proof Apoio com Anjo', $2)`, [ORG, SLUG])
    const operation = (await sql(`insert into operations (organization_id, name) values ($1, 'Proof HS') returning id`, [ORG])).rows[0] as { id: string }
    for (const team of ["G1", "G2"]) ids[team] = ((await sql(`insert into teams (organization_id, operation_id, name) values ($1, $2, $3) returning id`, [ORG, operation.id, `Proof ${team}`])).rows[0] as { id: string }).id
    for (const [subteam, team] of [["S1", "G1"], ["S2", "G1"], ["S3", "G2"]] as const) ids[subteam] = ((await sql(`insert into subteams (organization_id, team_id, name) values ($1, $2, $3) returning id`, [ORG, ids[team], `Proof ${subteam}`])).rows[0] as { id: string }).id
    localToday = ((await sql(`select to_char((now() at time zone analytics_org_timezone($1))::date, 'YYYY-MM-DD') as local_day`, [ORG])).rows[0] as { local_day: string }).local_day
    await person("ADMIN", {}, true)
    await grant("ADMIN", "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" })
    await person("COORD", { team: "G1" }, true)
    await grant("COORD", "COORDENADOR_DE_ANJOS", { type: "GROUP", team: "G1" })
    for (const key of ["A1", "A2", "A3"]) {
      await person(key, { team: "G1", subteam: "S1" }, true)
      await grant(key, "ANJO", { type: "GROUP", team: "G1" })
    }
    await person("A4", { team: "G2", subteam: "S3" }, true)
    await grant("A4", "ANJO", { type: "GROUP", team: "G2" })
    await person("A5", {}, true)
    await grant("A5", "ANJO", { type: "ORGANIZATION" })
    for (let index = 1; index <= 28; index += 1) await person(`O${index}`, { team: "G1", subteam: "S1" })
    await person("OS2", { team: "G1", subteam: "S2" })
    await person("OG2", { team: "G2", subteam: "S3" })
  }, 60_000)

  afterAll(async () => {
    if (!pool) return
    const byOrg = [
      "human_support_transfers", "human_support_inbox_versions", "human_support_conversation_marks", "human_support_entry_events", "human_support_evaluations", "human_support_classifications", "human_support_messages", "human_support_attendances",
      "human_support_request_events", "human_support_requests", "human_support_presence_events", "human_support_agent_presence", "human_support_setting_events", "human_support_group_response_times", "human_support_scope_settings",
      "human_support_settings", "assistant_conversations", "personal_data_access_log", "audit_logs", "access_role_assignments", "user_accounts", "analytics_operational_dirty", "people", "subteams", "teams", "operations",
    ]
    for (const table of byOrg) await sql(`delete from ${table} where organization_id = $1`, [ORG]).catch((error: unknown) => console.error(`limpeza ${table}:`, (error as Error).message))
    await sql(`delete from analytics_versions where organization_id = $1`, [ORG]).catch(() => undefined)
    await sql(`delete from organizations where id = $1`, [ORG]).catch((error: unknown) => console.error("limpeza organizations:", (error as Error).message))
    await pool.end()
  }, 60_000)

  it("tudo nasce desligado; o Administrador geral liga com versão otimista; a árvore mostra o efetivo e a origem", async () => {
    expect((await loadOperatorView(pool, viewer("O1"))).enabled).toBe(false)
    await expect(previewRequest(pool, viewer("O1"), {})).rejects.toMatchObject({ code: "HUMAN_SUPPORT_DISABLED", statusCode: 409 })
    const on = await updateSettings(pool, viewer("ADMIN"), { enabled: true, defaultCapacity: 2, version: 0 })
    await expect(updateSettings(pool, viewer("ADMIN"), { enabled: true, defaultCapacity: 3, version: 0 })).rejects.toMatchObject({ code: "HUMAN_SUPPORT_CONCURRENT_CHANGE", statusCode: 409 })
    await updateScopeState(pool, viewer("ADMIN"), { scopeType: "GROUP", id: ids.G1!, state: "ON" })
    await updateScopeState(pool, viewer("ADMIN"), { scopeType: "GROUP", id: ids.G2!, state: "ON" })
    const off = await updateScopeState(pool, viewer("ADMIN"), { scopeType: "SUBGROUP", id: ids.S2!, state: "OFF" })
    expect(off).toMatchObject({ type: "SUBGROUP", state: "OFF", effective: false, effectiveSource: "OWN" })
    const tree = await listScopes(pool, ORG)
    const g1 = tree.find((node) => node.id === ids.G1)!
    expect(g1).toMatchObject({ effective: true, effectiveSource: "OWN", anjoCount: 4 })
    expect(g1.children!.find((node) => node.id === ids.S1)).toMatchObject({ state: "INHERIT", effective: true, effectiveSource: "GROUP" })
    expect(on.version).toBe(1)
    expect((await loadOperatorView(pool, viewer("O1"))).enabled).toBe(true)
    expect((await loadOperatorView(pool, viewer("OS2"))).enabled).toBe(false)
    await expect(updateScopeState(pool, viewer("ADMIN"), { scopeType: "GROUP", id: randomUUID(), state: "ON" })).rejects.toMatchObject({ statusCode: 404 })
  })

  it("sem Anjo em serviço: a prévia registra a tentativa (uma a cada 10 min) e a criação responde 409; ficar disponível exige a área aberta", async () => {
    const preview = await previewRequest(pool, viewer("O1"), {})
    expect(preview).toMatchObject({ origin: "BUTTON", availability: { status: "NONE_IN_SERVICE" }, sharedContext: { question: null, answer: null, dislike: null, note: null } })
    await previewRequest(pool, viewer("O1"), {})
    expect(((await sql(`select count(*)::int total from human_support_entry_events where organization_id = $1 and person_id = $2 and kind = 'NO_ANJO_IN_SERVICE'`, [ORG, ids.O1])).rows[0] as { total: number }).total).toBe(1)
    await expect(ask("O1")).rejects.toMatchObject({ code: "HUMAN_SUPPORT_NO_ANJO_IN_SERVICE", statusCode: 409 })
    await expect(changePresence(pool, viewer("A1"), { status: "AVAILABLE" })).rejects.toMatchObject({ code: "HUMAN_SUPPORT_NOT_CONNECTED" })
    await expect(changePresence(pool, viewer("A1"), { status: "PAUSED", pauseReason: "LUNCH" })).rejects.toMatchObject({ code: "HUMAN_SUPPORT_PRESENCE_INVALID" })
    const attempts = await listUnavailableAttempts(pool, viewer("COORD"), { from: today(), to: today() })
    expect(attempts.items).toHaveLength(1)
    expect(attempts.items[0]).toMatchObject({ teamName: "Proof G1", subteamName: "Proof S1", origin: "BUTTON" })
  })

  it("criação idempotente e um pedido aberto por operador, mesmo com 10 chamadas em paralelo", async () => {
    await available("A1")
    const key = randomUUID()
    const same = await Promise.all(Array.from({ length: 10 }, () => createRequest(pool, viewer("O2"), { clientRequestId: key }).then((result) => result.request.id)))
    expect(new Set(same).size).toBe(1)
    const different = await Promise.allSettled(Array.from({ length: 10 }, () => createRequest(pool, viewer("O3"), { clientRequestId: randomUUID() })))
    expect(different.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(different.filter((result) => result.status === "rejected").every((result) => (result as PromiseRejectedResult).reason.code === "HUMAN_SUPPORT_REQUEST_ALREADY_OPEN")).toBe(true)
    await resetOpen()
  }, 60_000)

  it("20 pedidos e 3 Anjos com capacidade 2: 6 atendimentos e 14 na fila por ordem de chegada; menos atendimentos e quem recebeu há mais tempo primeiro; distribuições em paralelo nunca passam da capacidade", async () => {
    for (const key of ["A1", "A2", "A3"]) await available(key)
    const created: string[] = []
    for (let index = 4; index <= 23; index += 1) created.push((await ask(`O${index}`)).request.id)
    await Promise.all([dispatchOrganization(pool, ORG), dispatchOrganization(pool, ORG), dispatchOrganization(pool, ORG)])
    expect([await activeOf("A1"), await activeOf("A2"), await activeOf("A3")]).toEqual([2, 2, 2])
    const states = await Promise.all(created.map(request))
    expect(states.slice(0, 6).every((state) => state.status === "IN_PROGRESS")).toBe(true)
    expect(states.slice(6).every((state) => state.status === "WAITING")).toBe(true)
    // A ordem de distribuição das três primeiras: um para cada Anjo antes de qualquer um receber o segundo.
    const firstThree = (await sql(`select anjo_person_id from human_support_attendances where request_id = any($1::uuid[]) order by started_at`, [created.slice(0, 3)])).rows.map((row) => (row as { anjo_person_id: string }).anjo_person_id)
    expect(new Set(firstThree).size).toBe(3)
    // Cancelar e a distribuição ao mesmo tempo: ou cancela, ou atribui — nunca os dois.
    await sql(`update human_support_attendances set status = 'ENDED', end_cause = 'ANJO_CLOSED', ended_at = now() where request_id = $1`, [created[0]])
    await sql(`update human_support_requests set status = 'CLOSED', end_cause = 'ANJO_CLOSED', ended_at = now() where id = $1`, [created[0]])
    const [cancelled] = await Promise.allSettled([cancelRequest(pool, viewer("O10"), created[6]!), dispatchOrganization(pool, ORG)])
    const final = await request(created[6]!)
    const attended = ((await sql(`select count(*)::int total from human_support_attendances where request_id = $1`, [created[6]])).rows[0] as { total: number }).total
    expect(final.status === "CANCELLED" ? attended === 0 : final.status === "IN_PROGRESS" && attended === 1 && cancelled.status === "rejected").toBe(true)
    await resetOpen()
  }, 120_000)

  it("conversa: seq sem lacunas com 20 mensagens em paralelo, mesma chave = mesma mensagem, primeira resposta do Anjo uma vez, 409 depois de encerrar; sem deadlock com a distribuição", async () => {
    await available("A1")
    const { request: created } = await ask("O24")
    expect(created.status).toBe("IN_PROGRESS")
    expect(created.anjo).toMatchObject({ awaitingFirstResponse: true })
    const keyed = randomUUID()
    const sends = Array.from({ length: 20 }, (_, index) => sendMessage(pool, index % 2 ? viewer("A1") : viewer("O24"), created.id, { clientMessageId: index === 0 ? keyed : randomUUID(), body: `mensagem ${index}`, viewerIsAnjo: index % 2 === 1 }))
    const dispatches = Array.from({ length: 10 }, () => dispatchOrganization(pool, ORG))
    await Promise.all([...sends, ...dispatches])
    const repeated = await sendMessage(pool, viewer("O24"), created.id, { clientMessageId: keyed, body: "outra", viewerIsAnjo: false })
    expect(repeated.created).toBe(false)
    const seqs = (await sql(`select seq from human_support_messages where request_id = $1 order by seq`, [created.id])).rows.map((row) => Number((row as { seq: number }).seq))
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, index) => index + 1))
    const first = (await sql(`select first_anjo_message_at from human_support_attendances where request_id = $1`, [created.id])).rows[0] as { first_anjo_message_at: Date | null }
    expect(first.first_anjo_message_at).not.toBeNull()
    // O Anjo lê; a mensagem do sistema sai no texto de quem lê.
    const anjoPage = await listMessages(pool, viewer("A1"), created.id, { viewerIsAnjo: true })
    expect(anjoPage.messages.some((message) => message.body === "Você recebeu este pedido.")).toBe(true)
    // Outro Anjo e o Coordenador não leem por aqui.
    await expect(listMessages(pool, viewer("A2"), created.id, { viewerIsAnjo: true })).rejects.toMatchObject({ statusCode: 404 })
    await expect(sendMessage(pool, viewer("A2"), created.id, { clientMessageId: randomUUID(), body: "intrometido", viewerIsAnjo: true })).rejects.toMatchObject({ statusCode: 404 })
    await closeRequest(pool, viewer("O24"), created.id, { viewerIsAnjo: false })
    await expect(sendMessage(pool, viewer("O24"), created.id, { clientMessageId: randomUUID(), body: "depois", viewerIsAnjo: false })).rejects.toMatchObject({ code: "HUMAN_SUPPORT_REQUEST_ENDED", statusCode: 409 })
    await resetOpen()
  }, 120_000)

  it("fim do atendimento encerra a conversa com a INIA de onde o pedido saiu (HUMAN_SUPPORT); pedido cancelado na fila não mexe nela", async () => {
    // Conversa ativa do chat livre da operadora; o pedido aponta para ela (como a cópia da troca faz quando nasce de uma resposta).
    const conversation = async (key: string) => (await sql(`insert into assistant_conversations (organization_id, owner_person_id, kind, status, started_at, last_activity_at, origin) values ($1, $2, 'CONVERSATION', 'ACTIVE', now(), now(), 'USER') returning id`, [ORG, ids[key]])).rows[0] as { id: string }
    const conversationState = (id: string) => sql(`select status, close_reason from assistant_conversations where id = $1`, [id]).then((result) => result.rows[0] as { status: string; close_reason: string | null })

    const attended = await conversation("O22")
    await available("A1")
    const { request: inProgress } = await ask("O22")
    await sql(`update human_support_requests set source_conversation_id = $2 where id = $1`, [inProgress.id, attended.id])
    expect(inProgress.status).toBe("IN_PROGRESS")
    await closeRequest(pool, viewer("A1"), inProgress.id, { viewerIsAnjo: true })
    expect(await conversationState(attended.id)).toEqual({ status: "CLOSED", close_reason: "HUMAN_SUPPORT" })
    await resetOpen()

    // Sem Anjo que possa receber, o pedido fica na fila; cancelado ali, não houve chat com o Anjo — a conversa continua.
    const queuedConversation = await conversation("O23")
    await available("A1")
    await changePresence(pool, viewer("A1"), { status: "PAUSED", pauseReason: "LUNCH" })
    const { request: queued } = await ask("O23")
    await sql(`update human_support_requests set source_conversation_id = $2 where id = $1`, [queued.id, queuedConversation.id])
    expect(queued.status).toBe("WAITING")
    await cancelRequest(pool, viewer("O23"), queued.id)
    expect(await conversationState(queuedConversation.id)).toEqual({ status: "ACTIVE", close_reason: null })
    await resetOpen()
    // Os dois pedidos saem do histórico (atendimentos, mensagens e eventos vão em cascata): o prazo da fila dos cenários seguintes
    // é calculado pelo histórico e não pode mudar por causa deste.
    await sql(`delete from human_support_requests where id = any($1::uuid[])`, [[inProgress.id, queued.id]])
  }, 120_000)

  it("digitando, entregue e lido (184): só quem está na conversa marca; o recibo só avança, nunca passa da última mensagem e avisa a outra ponta; enviar tira o digitando", async () => {
    await person("O25", { team: "G1", subteam: "S1" })
    await available("A1")
    const { request: created } = await ask("O25")
    expect(created.status).toBe("IN_PROGRESS")
    expect(created.peerReceipts).toEqual({ deliveredSeq: 0, readSeq: 0 })
    const versionOf = (key: string) => sql(`select version::text v from human_support_inbox_versions where organization_id = $1 and person_id = $2`, [ORG, ids[key]]).then((result) => (result.rows[0] as { v: string } | undefined)?.v ?? "0")
    const anjoSees = async () => (await loadAnjoView(pool, viewer("A1"))).attendances.find((attendance) => attendance.requestId === created.id)!
    const operatorSees = async () => (await loadOperatorView(pool, viewer("O25"))).openRequest!

    // O operador escreve: a chamada longa do Anjo acorda e ele vê "digitando" por até 8 s; o próprio operador não vê o dele.
    const anjoBefore = await versionOf("A1")
    await signalTyping(pool, viewer("O25"), created.id, { typing: true, viewerIsAnjo: false })
    expect(await versionOf("A1")).not.toBe(anjoBefore)
    const typing = (await anjoSees()).peerTypingMs
    expect(typing).toBeGreaterThan(0)
    expect(typing).toBeLessThanOrEqual(8_000)
    expect((await operatorSees()).peerTypingMs).toBeNull()
    // Enviar tira o "digitando" de quem escreveu.
    const sent = (await sendMessage(pool, viewer("O25"), created.id, { clientMessageId: randomUUID(), body: "Oi, preciso de ajuda com a segunda via.", viewerIsAnjo: false })).message
    expect((await anjoSees()).peerTypingMs).toBeNull()
    // Mensagem nova para o Anjo, contada pelo servidor (vale fora da área e depois de recarregar) até a leitura dele.
    expect((await anjoSees()).unreadCount).toBe(1)

    // O Anjo começa e desiste sem enviar: o aviso some; parar de novo, sem aviso valendo, não acorda o operador.
    await signalTyping(pool, viewer("A1"), created.id, { typing: true, viewerIsAnjo: true })
    expect((await operatorSees()).peerTypingMs).toBeGreaterThan(0)
    await signalTyping(pool, viewer("A1"), created.id, { typing: false, viewerIsAnjo: true })
    expect((await operatorSees()).peerTypingMs).toBeNull()
    const quiet = await versionOf("O25")
    await signalTyping(pool, viewer("A1"), created.id, { typing: false, viewerIsAnjo: true })
    expect(await versionOf("O25")).toBe(quiet)
    // Prazo vencido = ninguém digitando, mesmo sem o "parei".
    await signalTyping(pool, viewer("A1"), created.id, { typing: true, viewerIsAnjo: true })
    await sql(`update human_support_conversation_marks set anjo_typing_until = now() - interval '1 second' where request_id = $1`, [created.id])
    expect((await operatorSees()).peerTypingMs).toBeNull()

    // O aplicativo do Anjo recebeu a mensagem: entregue (e o operador é avisado). Repetir não avisa de novo.
    const operatorBefore = await versionOf("O25")
    expect(await acknowledgeMessages(pool, viewer("A1"), created.id, { deliveredSeq: sent.seq, viewerIsAnjo: true })).toEqual({ deliveredSeq: sent.seq, readSeq: 0 })
    expect(await versionOf("O25")).not.toBe(operatorBefore)
    expect((await operatorSees()).peerReceipts).toEqual({ deliveredSeq: sent.seq, readSeq: 0 })
    const unchanged = await versionOf("O25")
    await acknowledgeMessages(pool, viewer("A1"), created.id, { deliveredSeq: sent.seq, viewerIsAnjo: true })
    expect(await versionOf("O25")).toBe(unchanged)
    // Entregue não é lida: a mensagem continua nova para o Anjo.
    expect((await anjoSees()).unreadCount).toBe(1)
    // Lida: um seq além da última mensagem fica na última; confirmação atrasada não volta. Ler avisa também a PRÓPRIA tela do Anjo
    // (o contador de mensagens novas dele zera na hora).
    const anjoBeforeRead = await versionOf("A1")
    expect(await acknowledgeMessages(pool, viewer("A1"), created.id, { readSeq: 9_999, viewerIsAnjo: true })).toEqual({ deliveredSeq: sent.seq, readSeq: sent.seq })
    expect(await versionOf("A1")).not.toBe(anjoBeforeRead)
    expect((await anjoSees()).unreadCount).toBe(0)
    expect(await acknowledgeMessages(pool, viewer("A1"), created.id, { deliveredSeq: 1, readSeq: 1, viewerIsAnjo: true })).toEqual({ deliveredSeq: sent.seq, readSeq: sent.seq })
    expect((await operatorSees()).peerReceipts).toEqual({ deliveredSeq: sent.seq, readSeq: sent.seq })

    // Do outro lado: o operador lê a resposta do Anjo e o Anjo vê os dois tiques azuis.
    const reply = (await sendMessage(pool, viewer("A1"), created.id, { clientMessageId: randomUUID(), body: "Claro! Me conta qual é o caso.", viewerIsAnjo: true })).message
    // A mensagem do PRÓPRIO Anjo nunca conta como nova para ele.
    expect((await anjoSees()).unreadCount).toBe(0)
    // Antes de ler, o estado do operador diz até onde ELE leu (a resposta do Anjo é mensagem nova, também depois de recarregar).
    expect((await operatorSees()).readSeq).toBeLessThan(reply.seq)
    await acknowledgeMessages(pool, viewer("O25"), created.id, { deliveredSeq: reply.seq, readSeq: reply.seq, viewerIsAnjo: false })
    expect((await anjoSees()).peerReceipts).toEqual({ deliveredSeq: reply.seq, readSeq: reply.seq })
    expect((await operatorSees()).readSeq).toBe(reply.seq)

    // Quem não está na conversa não marca nada (404, sem revelar o pedido).
    await expect(signalTyping(pool, viewer("A2"), created.id, { typing: true, viewerIsAnjo: true })).rejects.toMatchObject({ statusCode: 404 })
    await expect(acknowledgeMessages(pool, viewer("O1"), created.id, { readSeq: 1, viewerIsAnjo: false })).rejects.toMatchObject({ statusCode: 404 })

    // Encerrado: o "digitando" deixa de valer e o recibo para de mudar; o Anjo que saiu não marca mais.
    await signalTyping(pool, viewer("O25"), created.id, { typing: true, viewerIsAnjo: false })
    await closeRequest(pool, viewer("O25"), created.id, { viewerIsAnjo: false })
    const marks = (await sql(`select operator_typing_until > now() typing from human_support_conversation_marks where request_id = $1`, [created.id])).rows[0] as { typing: boolean }
    expect(marks.typing).toBe(true)
    await expect(signalTyping(pool, viewer("O25"), created.id, { typing: true, viewerIsAnjo: false })).resolves.toBeUndefined()
    expect(await acknowledgeMessages(pool, viewer("O25"), created.id, { readSeq: 9_999, viewerIsAnjo: false })).toEqual({ deliveredSeq: reply.seq, readSeq: reply.seq })
    await expect(acknowledgeMessages(pool, viewer("A1"), created.id, { readSeq: 9_999, viewerIsAnjo: true })).rejects.toMatchObject({ statusCode: 404 })
    await resetOpen()
    // Fora do histórico da fila (os prazos dos cenários seguintes saem dele); as marcas vão junto, em cascata.
    await sql(`delete from human_support_requests where id = $1`, [created.id])
    expect((await sql(`select count(*)::int total from human_support_conversation_marks where request_id = $1`, [created.id])).rows[0]).toEqual({ total: 0 })
  }, 120_000)

  it("situação dos Anjos agora: inativo à parte, disponível, em atendimento, em pausa com motivo, indisponível sem tempo; Coordenador só vê o próprio alcance", async () => {
    await resetOpen()
    const find = (view: Awaited<ReturnType<typeof anjosNow>>, key: string) => view.items.find((item) => item.personId === ids[key])
    await available("A1")
    const freshly = await anjosNow(pool, viewer("ADMIN"), {})
    expect(find(freshly, "A1")).toMatchObject({ active: true, status: "AVAILABLE", connected: true, attendances: { active: 0 } })
    expect(Date.parse(find(freshly, "A1")!.since!)).toBeLessThanOrEqual(Date.parse(freshly.serverTime))
    expect(find(freshly, "A2")).toMatchObject({ status: "UNAVAILABLE", since: null })

    const { request: created } = await ask("O9")
    expect(created.status).toBe("IN_PROGRESS")
    const busy = find(await anjosNow(pool, viewer("ADMIN"), {}), "A1")!
    expect(busy).toMatchObject({ status: "IN_ATTENDANCE", attendances: { active: 1 } })
    const started = ((await sql(`select started_at from human_support_attendances where request_id = $1`, [created.id])).rows[0] as { started_at: Date }).started_at
    expect(Date.parse(busy.since!)).toBe(started.getTime())

    // Com atendimento aberto a pausa é PROGRAMADA (188): continua "Em atendimento" e entra ao encerrar, contando dali.
    await changePresence(pool, viewer("A1"), { status: "PAUSED", pauseReason: "MEETING" })
    expect(find(await anjosNow(pool, viewer("ADMIN"), {}), "A1")).toMatchObject({ status: "IN_ATTENDANCE", attendances: { active: 1 } })
    await closeRequest(pool, viewer("A1"), created.id, { viewerIsAnjo: true })
    const paused = find(await anjosNow(pool, viewer("ADMIN"), {}), "A1")!
    expect(paused).toMatchObject({ status: "PAUSED", pauseReason: "MEETING", attendances: { active: 0 } })
    const endedAt = ((await sql(`select ended_at from human_support_attendances where request_id = $1`, [created.id])).rows[0] as { ended_at: Date }).ended_at
    expect(Date.parse(paused.since!)).toBe(endedAt.getTime())

    // Conta desativada: continua na lista, marcada como inativa (o papel não foi revogado).
    await sql(`update user_accounts set active = false where person_id = $1`, [ids.A3])
    const withInactive = await anjosNow(pool, viewer("ADMIN"), {})
    expect(find(withInactive, "A3")).toMatchObject({ active: false, status: "UNAVAILABLE" })
    await sql(`update user_accounts set active = true where person_id = $1`, [ids.A3])

    // Coordenador do Grupo 1: os Anjos do Grupo 1, nunca o do Grupo 2 nem o de organização; o filtro do painel recorta mais.
    const coordinator = await anjosNow(pool, viewer("COORD"), {})
    expect(coordinator.items.map((item) => item.personId).sort()).toEqual([ids.A1, ids.A2, ids.A3].sort())
    expect((await anjosNow(pool, viewer("ADMIN"), { teamId: ids.G2 })).items.map((item) => item.personId).sort()).toEqual([ids.A4, ids.A5].sort())
    const logged = Number(((await sql(`select count(*)::int total from personal_data_access_log where organization_id = $1 and viewer_person_id = $2 and subject_person_id = $3 and data_kind = 'HUMAN_SUPPORT_PRESENCE'`, [ORG, ids.COORD, ids.A1])).rows[0] as { total: number }).total)
    expect(logged).toBeGreaterThanOrEqual(1)

    await resetOpen()
    await sql(`delete from human_support_requests where id = $1`, [created.id])
  }, 120_000)

  it("conexão do Anjo: aviso ao operador, volta dentro da carência, e depois de 3 min o atendimento é Interrompido e o pedido volta à frente da fila", async () => {
    await available("A1")
    const { request: created } = await ask("O5")
    const queuedAt = (await request(created.id)).queued_at
    await sql(`update human_support_agent_presence set lease_until = now() - interval '1 second' where organization_id = $1 and person_id = $2`, [ORG, ids.A1])
    await dispatchOrganization(pool, ORG)
    await renewAnjoLease(pool, viewer("A1"))
    await dispatchOrganization(pool, ORG)
    const codes = (await sql(`select system_code from human_support_messages where request_id = $1 and author_kind = 'SYSTEM' order by seq`, [created.id])).rows.map((row) => (row as { system_code: string }).system_code)
    expect(codes).toEqual(["QUEUED", "ANJO_ASSIGNED", "ANJO_CONNECTION_LOST", "ANJO_CONNECTION_RESTORED"])
    const operatorView = await loadOperatorView(pool, viewer("O5"))
    expect(operatorView.openRequest!.messages.map((message) => message.body)).toContain("O Apoio voltou.")
    await sql(`update human_support_agent_presence set lease_until = now() - interval '4 minutes' where organization_id = $1 and person_id = $2`, [ORG, ids.A1])
    await dispatchOrganization(pool, ORG)
    const after = await request(created.id)
    expect(after.status).toBe("WAITING")
    expect(after.queued_at.getTime()).toBe(queuedAt.getTime())
    expect(after.queue_expires_at.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000)
    expect(((await sql(`select end_cause from human_support_attendances where request_id = $1`, [created.id])).rows[0] as { end_cause: string }).end_cause).toBe("ANJO_LOST")
    expect(((await sql(`select status from human_support_agent_presence where organization_id = $1 and person_id = $2`, [ORG, ids.A1])).rows[0] as { status: string }).status).toBe("OFFLINE")
    await resetOpen()
  }, 60_000)

  it("pausa e indisponibilidade programadas (188): com dois atendimentos, programar/alterar/cancelar, nenhuma atribuição nova, entra ao encerrar o último (operador, inatividade), carência preserva e queda além dela apaga", async () => {
    await resetOpen()
    const presenceOf = () => sql(`select status, pause_reason, status_since, scheduled_status, scheduled_pause_reason, scheduled_at from human_support_agent_presence where organization_id = $1 and person_id = $2`, [ORG, ids.A1]).then((result) => result.rows[0] as { status: string; pause_reason: string | null; status_since: Date; scheduled_status: string | null; scheduled_pause_reason: string | null; scheduled_at: Date | null })
    const attendanceOf = (requestId: string) => sql(`select id, anjo_person_id, status, end_cause, ended_at from human_support_attendances where request_id = $1 order by started_at desc limit 1`, [requestId]).then((result) => result.rows[0] as { id: string; anjo_person_id: string; status: string; end_cause: string | null; ended_at: Date | null } | undefined)
    const created: string[] = []
    const track = async (key: string) => {
      const { request: made } = await ask(key)
      created.push(made.id)
      return made
    }
    await updateAnjoCapacity(pool, viewer("ADMIN"), ids.A1!, 3)

    // Sem atendimento: pausa entra na hora (nada é programado).
    await available("A1")
    const immediate = await changePresence(pool, viewer("A1"), { status: "PAUSED", pauseReason: "LUNCH" })
    expect(immediate.presence).toMatchObject({ status: "PAUSED", pauseReason: "LUNCH", scheduled: null })
    await changePresence(pool, viewer("A1"), { status: "AVAILABLE" })

    // Dois atendimentos simultâneos com o A1 (capacidade 3: sobra vaga, e mesmo assim nada novo chega depois de programar).
    const first = await track("O25")
    const second = await track("O26")
    expect([first.status, second.status]).toEqual(["IN_PROGRESS", "IN_PROGRESS"])
    const sinceBefore = (await presenceOf()).status_since

    // Programar pausa: o estado atual fica (e o cronômetro não recomeça); alterar o motivo; trocar por Indisponível; cancelar.
    const scheduled = await changePresence(pool, viewer("A1"), { status: "PAUSED", pauseReason: "LUNCH" })
    expect(scheduled.presence).toMatchObject({ status: "AVAILABLE", pauseReason: null, scheduled: { status: "PAUSED", pauseReason: "LUNCH" } })
    expect(Date.parse(scheduled.presence.since)).toBe(sinceBefore.getTime())
    expect((await changePresence(pool, viewer("A1"), { status: "PAUSED", pauseReason: "PERSONAL" })).presence.scheduled).toMatchObject({ status: "PAUSED", pauseReason: "PERSONAL" })
    expect((await changePresence(pool, viewer("A1"), { status: "OFFLINE" })).presence.scheduled).toMatchObject({ status: "OFFLINE", pauseReason: null })
    expect((await cancelScheduledPresence(pool, viewer("A1"))).presence.scheduled).toBeNull()
    // Pedir o estado atual também desfaz a programação.
    await changePresence(pool, viewer("A1"), { status: "PAUSED", pauseReason: "MEETING" })
    expect((await changePresence(pool, viewer("A1"), { status: "AVAILABLE" })).presence).toMatchObject({ status: "AVAILABLE", scheduled: null })
    await changePresence(pool, viewer("A1"), { status: "PAUSED", pauseReason: "LUNCH" })
    // Programar e cancelar não geram evento de presença (as horas em pausa contam da transição efetiva).
    expect(((await sql(`select count(*)::int total from human_support_presence_events where organization_id = $1 and person_id = $2 and to_status = 'PAUSED' and occurred_at > $3`, [ORG, ids.A1, sinceBefore])).rows[0] as { total: number }).total).toBe(0)

    // Bloqueio: com vaga sobrando, o pedido novo fica na fila, mesmo com várias distribuições em paralelo.
    const waiting = await track("O27")
    expect(waiting.status).toBe("WAITING")
    await Promise.all(Array.from({ length: 5 }, () => dispatchOrganization(pool, ORG)))
    expect((await request(waiting.id)).status).toBe("WAITING")
    expect((await loadOperatorView(pool, viewer("O28"))).availability!.status).not.toBe("AVAILABLE_NOW")
    expect((await listAnjos(pool, ORG, { subteamId: ids.S1! })).find((row) => row.personId === ids.A1)).toMatchObject({ canReceiveAssignment: false, reasonNotEligible: "SCHEDULED_CHANGE" })

    // Recarregar a página (estado de novo) e cair dentro da carência: a programação continua, os atendimentos seguem com o A1.
    expect((await loadState(pool, viewer("A1"), { workspace: "anjo" })).anjo!.presence.scheduled).toMatchObject({ status: "PAUSED", pauseReason: "LUNCH" })
    await sql(`update human_support_agent_presence set lease_until = now() - interval '1 second' where organization_id = $1 and person_id = $2`, [ORG, ids.A1])
    await dispatchOrganization(pool, ORG)
    await renewAnjoLease(pool, viewer("A1"))
    await dispatchOrganization(pool, ORG)
    expect(await presenceOf()).toMatchObject({ status: "AVAILABLE", scheduled_status: "PAUSED", scheduled_pause_reason: "LUNCH" })
    expect([(await attendanceOf(first.id))!.status, (await attendanceOf(second.id))!.status]).toEqual(["ACTIVE", "ACTIVE"])
    expect((await request(waiting.id)).status).toBe("WAITING")

    // O operador encerra o primeiro: ainda há um atendimento, nada muda.
    await closeRequest(pool, viewer("O25"), first.id, { viewerIsAnjo: false })
    expect(await presenceOf()).toMatchObject({ status: "AVAILABLE", scheduled_status: "PAUSED" })
    expect(await activeOf("A1")).toBe(1)

    // O último termina pelo sistema — o operador ficou sem responder ao Anjo (193) — com distribuições correndo junto: a pausa entra no
    // mesmo instante do fim e a fila nunca recebe o A1 nesse meio-tempo.
    await sendMessage(pool, viewer("A1"), second.id, { clientMessageId: randomUUID(), body: "Conseguiu?", viewerIsAnjo: true })
    await sql(`update human_support_attendances set last_human_message_at = now() - interval '16 minutes' where request_id = $1`, [second.id])
    await Promise.all(Array.from({ length: 4 }, () => dispatchOrganization(pool, ORG)))
    const ended = (await attendanceOf(second.id))!
    expect(ended).toMatchObject({ status: "ENDED", end_cause: "OPERATOR_SILENT" })
    expect((await request(second.id)).status).toBe("AWAITING_OPERATOR")
    const applied = await presenceOf()
    expect(applied).toMatchObject({ status: "PAUSED", pause_reason: "LUNCH", scheduled_status: null, scheduled_at: null })
    expect(applied.status_since.getTime()).toBe(ended.ended_at!.getTime())
    // Instante idêntico no banco (microssegundos), não só no ms do JavaScript.
    expect(((await sql(`select p.status_since = a.ended_at same from human_support_agent_presence p, human_support_attendances a where p.organization_id = $1 and p.person_id = $2 and a.id = $3`, [ORG, ids.A1, ended.id])).rows[0] as { same: boolean }).same).toBe(true)
    expect(((await sql(`select e.occurred_at = p.status_since same from human_support_presence_events e join human_support_agent_presence p on p.organization_id = e.organization_id and p.person_id = e.person_id where e.organization_id = $1 and e.person_id = $2 and e.cause = 'ANJO_SCHEDULED' order by e.id desc limit 1`, [ORG, ids.A1])).rows[0] as { same: boolean }).same).toBe(true)
    expect(await attendanceOf(waiting.id)).toBeUndefined()
    expect((await request(waiting.id)).status).toBe("WAITING")
    const event = (await sql(`select from_status, to_status, pause_reason, cause, occurred_at from human_support_presence_events where organization_id = $1 and person_id = $2 order by id desc limit 1`, [ORG, ids.A1])).rows[0] as { from_status: string; to_status: string; pause_reason: string; cause: string; occurred_at: Date }
    expect(event).toMatchObject({ from_status: "AVAILABLE", to_status: "PAUSED", pause_reason: "LUNCH", cause: "ANJO_SCHEDULED" })
    expect(event.occurred_at.getTime()).toBe(applied.status_since.getTime())
    const anjoNow = (await anjosNow(pool, viewer("ADMIN"), {})).items.find((item) => item.personId === ids.A1)!
    expect(anjoNow).toMatchObject({ status: "PAUSED", pauseReason: "LUNCH" })
    expect(Date.parse(anjoNow.since!)).toBe(applied.status_since.getTime())
    // O motivo nunca chega ao operador.
    for (const key of ["O25", "O26", "O27"]) expect(JSON.stringify(await loadState(pool, viewer(key), { workspace: "anjo" }))).not.toMatch(/pause|presence|scheduled|MEETING|LUNCH|PERSONAL|PROCESS_ACTIVITY/i)

    // "Voltar" → recebe o que esperava; Indisponível programado entra quando o próprio Anjo encerra.
    await changePresence(pool, viewer("A1"), { status: "AVAILABLE" })
    expect((await request(waiting.id)).status).toBe("IN_PROGRESS")
    expect((await changePresence(pool, viewer("A1"), { status: "OFFLINE" })).presence).toMatchObject({ status: "AVAILABLE", scheduled: { status: "OFFLINE" } })
    await closeRequest(pool, viewer("A1"), waiting.id, { viewerIsAnjo: true })
    expect(await presenceOf()).toMatchObject({ status: "OFFLINE", pause_reason: null, scheduled_status: null })

    // Queda além da carência com pausa programada: atendimento Interrompido, pedido de volta à frente da fila (mesmo protocolo e
    // mensagens), o A1 Indisponível SEM a programação — ao voltar, não recebe nada até "Ficar disponível".
    await available("A1")
    const dropped = await track("O28")
    expect(dropped.status).toBe("IN_PROGRESS")
    await sendMessage(pool, viewer("O28"), dropped.id, { clientMessageId: randomUUID(), body: "Mensagem antes da queda", viewerIsAnjo: false })
    await changePresence(pool, viewer("A1"), { status: "PAUSED", pauseReason: "PROCESS_ACTIVITY" })
    const queuedAt = (await request(dropped.id)).queued_at
    await sql(`update human_support_agent_presence set lease_until = now() - interval '4 minutes' where organization_id = $1 and person_id = $2`, [ORG, ids.A1])
    await dispatchOrganization(pool, ORG)
    expect((await attendanceOf(dropped.id))!.end_cause).toBe("ANJO_LOST")
    expect((await request(dropped.id)).status).toBe("WAITING")
    expect((await request(dropped.id)).queued_at.getTime()).toBe(queuedAt.getTime())
    expect(await presenceOf()).toMatchObject({ status: "OFFLINE", scheduled_status: null, scheduled_at: null })
    const kept = (await loadOperatorView(pool, viewer("O28"))).openRequest!
    expect(kept.protocol).toBe(dropped.protocol)
    expect(kept.messages.map((message) => message.body)).toContain("Mensagem antes da queda")
    await renewAnjoLease(pool, viewer("A1"))
    await dispatchOrganization(pool, ORG)
    expect(await presenceOf()).toMatchObject({ status: "OFFLINE", scheduled_status: null })
    expect((await request(dropped.id)).status).toBe("WAITING")

    // Só ler o estado (o indicador da aba "Apoio" ao entrar) não conecta o Anjo; a área aberta conecta.
    await sql(`update human_support_agent_presence set lease_until = null where organization_id = $1 and person_id = $2`, [ORG, ids.A1])
    const peek = await loadState(pool, viewer("A1"), { workspace: "anjo-status" })
    expect(peek.anjo!.presence).toMatchObject({ status: "OFFLINE", connected: false })
    expect(((await sql(`select lease_until from human_support_agent_presence where organization_id = $1 and person_id = $2`, [ORG, ids.A1])).rows[0] as { lease_until: Date | null }).lease_until).toBeNull()
    expect((await loadState(pool, viewer("A1"), { workspace: "anjo" })).anjo!.presence.connected).toBe(true)

    await resetOpen()
    await updateAnjoCapacity(pool, viewer("ADMIN"), ids.A1!, null)
    await sql(`delete from human_support_requests where id = any($1::uuid[])`, [created])
  }, 120_000)

  it("prazos: operador sem chamar 2 min → Abandonado; prazo da fila vencido → Expirado; Anjo sem nenhuma resposta → volta à fila", async () => {
    await available("A1")
    await changePresence(pool, viewer("A1"), { status: "PAUSED", pauseReason: "LUNCH" })
    const abandoned = (await ask("O6")).request
    const expired = (await ask("O7")).request
    // Sem histórico, o prazo é 20 min.
    const deadline = await request(expired.id)
    expect(Math.round((deadline.queue_expires_at.getTime() - deadline.created_at.getTime()) / 60_000)).toBe(20)
    await sql(`update human_support_requests set operator_seen_at = now() - interval '3 minutes' where id = $1`, [abandoned.id])
    await sql(`update human_support_requests set queue_expires_at = now() - interval '1 second' where id = $1`, [expired.id])
    await dispatchOrganization(pool, ORG)
    expect((await request(abandoned.id)).status).toBe("ABANDONED")
    expect((await request(expired.id)).status).toBe("EXPIRED")
    await changePresence(pool, viewer("A1"), { status: "AVAILABLE" })
    const silent = (await ask("O8")).request
    expect(silent.status).toBe("IN_PROGRESS")
    await sql(`update human_support_attendances set last_human_message_at = now() - interval '16 minutes' where request_id = $1`, [silent.id])
    await dispatchOrganization(pool, ORG)
    // Sem resposta do Anjo: o atendimento termina como abandono do Anjo e o pedido volta à fila — e pode ir de novo a qualquer Anjo.
    expect((await sql(`select end_cause from human_support_attendances where request_id = $1 order by started_at limit 1`, [silent.id])).rows[0]).toEqual({ end_cause: "ANJO_SILENT" })
    expect((await request(silent.id)).status).toBe("IN_PROGRESS")
    await resetOpen()
  }, 60_000)

  it("tempos de resposta (193): operador sem responder → aguardando o operador (Anjo livre) → escrever = fim da fila; 2º tempo = abandono do operador; Anjo sem responder = perde e volta à frente; tempos configuráveis", async () => {
    const panel = await getResponseTimesPanel(pool, viewer("ADMIN"))
    expect(panel.organization).toMatchObject({ times: { operatorRequeueMinutes: 15, operatorCloseMinutes: 20, anjoRequeueMinutes: 15 }, canEdit: true })
    const attendanceOf = (requestId: string) => sql(`select id, anjo_person_id, status, end_cause from human_support_attendances where request_id = $1 order by started_at desc limit 1`, [requestId]).then((result) => result.rows[0] as { id: string; anjo_person_id: string; status: string; end_cause: string | null })
    const systemCodes = (requestId: string) => sql(`select system_code from human_support_messages where request_id = $1 and author_kind = 'SYSTEM' order by seq`, [requestId]).then((result) => result.rows.map((row) => (row as { system_code: string }).system_code))
    await available("A1")

    // 1. O Anjo respondeu e o operador sumiu por 16 min: o Anjo fica livre e o pedido aguarda o operador (até a mensagem do Anjo + 20 min).
    const { request: gone } = await ask("O4")
    expect(gone.status).toBe("IN_PROGRESS")
    await sendMessage(pool, viewer("O4"), gone.id, { clientMessageId: randomUUID(), body: "Como faço a segunda via?", viewerIsAnjo: false })
    await sendMessage(pool, viewer("A1"), gone.id, { clientMessageId: randomUUID(), body: "Me diga o protocolo, por favor.", viewerIsAnjo: true })
    await sql(`update human_support_attendances set last_human_message_at = now() - interval '16 minutes' where request_id = $1`, [gone.id])
    await dispatchOrganization(pool, ORG)
    expect(await attendanceOf(gone.id)).toMatchObject({ status: "ENDED", end_cause: "OPERATOR_SILENT" })
    expect(await activeOf("A1")).toBe(0)
    const parked = (await sql(`select status, awaiting_operator_since from human_support_requests where id = $1`, [gone.id])).rows[0] as { status: string; awaiting_operator_since: Date }
    expect(parked.status).toBe("AWAITING_OPERATOR")
    const operatorView = (await loadOperatorView(pool, viewer("O4"))).openRequest!
    expect(operatorView).toMatchObject({ status: "AWAITING_OPERATOR", canCancel: true, canClose: false, anjo: null })
    expect(Date.parse(operatorView.awaitingReturnUntil!)).toBe(parked.awaiting_operator_since.getTime() + 20 * 60_000)
    expect(operatorView.messages.at(-1)!.body).toMatch(/Você ficou sem responder e o Apoio foi liberado/)
    expect(JSON.stringify(operatorView)).not.toMatch(/Anjo/)
    // Um pedido aberto por operador continua valendo: aguardando o retorno conta como aberto.
    await expect(ask("O4")).rejects.toMatchObject({ code: "HUMAN_SUPPORT_REQUEST_ALREADY_OPEN" })

    // 2. Enquanto isso, o Anjo livre recebe outro pedido; o A1 entra em pausa e chega mais um, que fica na fila.
    const { request: other } = await ask("O16")
    expect(other.status).toBe("IN_PROGRESS")
    await changePresence(pool, viewer("A1"), { status: "PAUSED", pauseReason: "MEETING" })
    const { request: earlier } = await ask("O20")
    expect(earlier.status).toBe("WAITING")

    // 3. O operador volta e escreve: o pedido entra no FIM da fila (depois de quem já esperava), com prazo novo.
    await sendMessage(pool, viewer("O4"), gone.id, { clientMessageId: randomUUID(), body: "Voltei, o protocolo é 123.", viewerIsAnjo: false })
    const returned = await request(gone.id)
    expect(returned.status).toBe("WAITING")
    expect(returned.queued_at.getTime()).toBeGreaterThan((await request(earlier.id)).queued_at.getTime())
    expect(returned.queue_expires_at.getTime()).toBeGreaterThan(Date.now())
    expect((await sql(`select cause from human_support_request_events where request_id = $1 order by id desc limit 1`, [gone.id])).rows[0]).toEqual({ cause: "OPERATOR_RETURNED" })
    expect((await systemCodes(gone.id)).slice(-2)).toEqual(["AWAITING_OPERATOR", "OPERATOR_RETURNED"])
    // Na fila da coordenação, a espera conta da volta (fim da fila), não da criação.
    expect((await queueWaiting(pool, viewer("ADMIN"), {})).find((item) => item.requestId === gone.id)).toMatchObject({ waitingSince: returned.queued_at.toISOString(), requeued: true })
    // Quem esperava antes é atendido antes.
    await changePresence(pool, viewer("A1"), { status: "AVAILABLE" })
    expect((await request(earlier.id)).status).toBe("IN_PROGRESS")
    expect((await request(gone.id)).status).toBe("WAITING")

    // 4. O 2º tempo: o Anjo respondeu e o operador nunca voltou — 21 min depois o pedido é encerrado como abandono do operador.
    await sendMessage(pool, viewer("A1"), other.id, { clientMessageId: randomUUID(), body: "Pode testar agora?", viewerIsAnjo: true })
    await sql(`update human_support_attendances set last_human_message_at = now() - interval '21 minutes' where request_id = $1`, [other.id])
    await dispatchOrganization(pool, ORG)
    expect(await request(other.id)).toMatchObject({ status: "ABANDONED", end_cause: "OPERATOR_NO_RETURN" })
    expect((await systemCodes(other.id)).slice(-2)).toEqual(["AWAITING_OPERATOR", "ENDED_OPERATOR_NO_RETURN"])
    // Quem estava no fim da fila recebe a vaga liberada.
    expect((await request(gone.id)).status).toBe("IN_PROGRESS")

    // 5. O Anjo sem responder ao operador: perde o atendimento (abandono do Anjo, sem classificação nem avaliação) e o pedido volta à
    //    FRENTE da fila (mantém a entrada original) — e pode voltar a qualquer Anjo, também ao mesmo.
    const before = await request(earlier.id)
    await sendMessage(pool, viewer("O20"), earlier.id, { clientMessageId: randomUUID(), body: "Alguém pode me ajudar?", viewerIsAnjo: false })
    await sql(`update human_support_attendances set last_human_message_at = now() - interval '16 minutes' where request_id = $1 and status = 'ACTIVE'`, [earlier.id])
    const lostId = (await attendanceOf(earlier.id)).id
    await dispatchOrganization(pool, ORG)
    expect((await sql(`select end_cause from human_support_attendances where id = $1`, [lostId])).rows[0]).toEqual({ end_cause: "ANJO_SILENT" })
    expect((await request(earlier.id)).queued_at.getTime()).toBe(before.queued_at.getTime())
    expect(await attendanceOf(earlier.id)).toMatchObject({ status: "ACTIVE", anjo_person_id: ids.A1 })
    expect((await systemCodes(earlier.id))).toContain("ANJO_SILENT_REQUEUED")
    const anjoView = await loadAnjoView(pool, viewer("A1"))
    expect(anjoView.pendingClassifications.some((item) => item.attendanceId === lostId)).toBe(false)
    expect((await loadOperatorView(pool, viewer("O20"))).pendingEvaluations.some((item) => item.attendanceId === lostId)).toBe(false)
    const lostMessages = await listMessages(pool, viewer("A1"), earlier.id, { viewerIsAnjo: true })
    expect(lostMessages.messages.map((message) => message.body).join(" ")).toMatch(/perdeu este atendimento/)
    const gone2 = await supportAbandonment(pool, viewer("ADMIN"), { from: today(), to: today() })
    expect(gone2.attendance.byAnjo.noReply).toBeGreaterThanOrEqual(1)
    expect(gone2.attendance.byOperator.noReply).toBeGreaterThanOrEqual(2)

    // 6. Tempos por Grupo (194): o Coordenador de Anjos do G1 vê e muda só os do G1; o padrão da organização, só quem acompanha a
    //    organização. Versão, histórico e auditoria; regra entre os tempos.
    const coordPanel = await getResponseTimesPanel(pool, viewer("COORD"))
    expect(coordPanel.organization.canEdit).toBe(false)
    expect(coordPanel.groups).toEqual([{ teamId: ids.G1, teamName: "Proof G1", custom: false, times: { operatorRequeueMinutes: 15, operatorCloseMinutes: 20, anjoRequeueMinutes: 15 }, version: 0, canEdit: true }])
    await expect(updateOrganizationResponseTimes(pool, viewer("COORD"), { operatorRequeueMinutes: 10, operatorCloseMinutes: 12, anjoRequeueMinutes: 5, anjoUnresponsive: { pauseAfterMinutes: 20, offlineAfterMinutes: 10 }, version: panel.organization.version })).rejects.toMatchObject({ code: "HUMAN_SUPPORT_RESPONSE_TIMES_ORGANIZATION_ONLY", statusCode: 403 })
    await expect(updateGroupResponseTimes(pool, viewer("COORD"), ids.G2!, { times: { operatorRequeueMinutes: 10, operatorCloseMinutes: 12, anjoRequeueMinutes: 5 }, version: 0 })).rejects.toMatchObject({ statusCode: 404 })
    await expect(updateGroupResponseTimes(pool, viewer("COORD"), ids.G1!, { times: { operatorRequeueMinutes: 10, operatorCloseMinutes: 10, anjoRequeueMinutes: 5 }, version: 0 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    const saved = await updateGroupResponseTimes(pool, viewer("COORD"), ids.G1!, { times: { operatorRequeueMinutes: 10, operatorCloseMinutes: 12, anjoRequeueMinutes: 5 }, version: 0 })
    expect(saved.groups[0]).toMatchObject({ custom: true, times: { operatorRequeueMinutes: 10, operatorCloseMinutes: 12, anjoRequeueMinutes: 5 }, version: 1 })
    await expect(updateGroupResponseTimes(pool, viewer("ADMIN"), ids.G1!, { times: { operatorRequeueMinutes: 10, operatorCloseMinutes: 12, anjoRequeueMinutes: 7 }, version: 0 })).rejects.toMatchObject({ code: "HUMAN_SUPPORT_CONCURRENT_CHANGE" })
    expect((await sql(`select target_type, team_id, field, from_value, to_value from human_support_setting_events where organization_id = $1 and field like '%_MINUTES' order by id`, [ORG])).rows).toEqual([
      { target_type: "GROUP", team_id: ids.G1, field: "OPERATOR_REQUEUE_MINUTES", from_value: "15", to_value: "10" },
      { target_type: "GROUP", team_id: ids.G1, field: "OPERATOR_CLOSE_MINUTES", from_value: "20", to_value: "12" },
      { target_type: "GROUP", team_id: ids.G1, field: "ANJO_REQUEUE_MINUTES", from_value: "15", to_value: "5" },
    ])
    expect((await sql(`select count(*)::int total from audit_logs where organization_id = $1 and action = 'HUMAN_SUPPORT_RESPONSE_TIMES_CHANGED'`, [ORG])).rows[0]).toEqual({ total: 1 })
    // O padrão da organização muda pelo Administrador geral, mas o G1 continua com os próprios tempos.
    const orgSaved = await updateOrganizationResponseTimes(pool, viewer("ADMIN"), { operatorRequeueMinutes: 30, operatorCloseMinutes: 40, anjoRequeueMinutes: 30, anjoUnresponsive: { pauseAfterMinutes: 20, offlineAfterMinutes: 10 }, version: panel.organization.version })
    expect(orgSaved.groups.find((group) => group.teamId === ids.G2)).toMatchObject({ custom: false, times: { operatorRequeueMinutes: 30, operatorCloseMinutes: 40, anjoRequeueMinutes: 30 } })
    expect(orgSaved.groups.find((group) => group.teamId === ids.G1)).toMatchObject({ custom: true, times: { anjoRequeueMinutes: 5 } })
    // Com o tempo novo (5 min), 6 min sem resposta do Anjo já devolvem o pedido à fila.
    await sql(`update human_support_attendances set last_human_message_at = now() - interval '6 minutes' where request_id = $1 and status = 'ACTIVE'`, [gone.id])
    const goneAttendance = (await attendanceOf(gone.id)).id
    await dispatchOrganization(pool, ORG)
    expect((await sql(`select end_cause from human_support_attendances where id = $1`, [goneAttendance])).rows[0]).toEqual({ end_cause: "ANJO_SILENT" })
    // Cancelar aguardando o retorno: o operador desiste.
    await sendMessage(pool, viewer("A1"), earlier.id, { clientMessageId: randomUUID(), body: "Ainda está aí?", viewerIsAnjo: true })
    await sql(`update human_support_attendances set last_human_message_at = now() - interval '11 minutes' where request_id = $1 and status = 'ACTIVE'`, [earlier.id])
    await dispatchOrganization(pool, ORG)
    expect((await request(earlier.id)).status).toBe("AWAITING_OPERATOR")
    expect((await cancelRequest(pool, viewer("O20"), earlier.id)).status).toBe("CANCELLED")

    // 7. Ninguém do Apoio em serviço (194): o operador volta, mas não há quem atenda — vale a regra de "ninguém em serviço": o pedido é
    //    encerrado (não fica na fila), não conta como abandono do operador e a tentativa sem Anjo é registrada.
    const { request: lonely } = await ask("O21")
    expect(lonely.status).toBe("IN_PROGRESS")
    await sendMessage(pool, viewer("A1"), lonely.id, { clientMessageId: randomUUID(), body: "Me conte o que houve.", viewerIsAnjo: true })
    await sql(`update human_support_attendances set last_human_message_at = now() - interval '11 minutes' where request_id = $1 and status = 'ACTIVE'`, [lonely.id])
    await dispatchOrganization(pool, ORG)
    expect((await request(lonely.id)).status).toBe("AWAITING_OPERATOR")
    await sql(`update human_support_agent_presence set status = 'OFFLINE' where organization_id = $1`, [ORG])
    await sendMessage(pool, viewer("O21"), lonely.id, { clientMessageId: randomUUID(), body: "Voltei.", viewerIsAnjo: false })
    expect(await request(lonely.id)).toMatchObject({ status: "EXPIRED", end_cause: "NO_ANJO_IN_SERVICE", anjos_in_service_at_end: 0 })
    expect((await systemCodes(lonely.id)).at(-1)).toBe("ENDED_NO_ANJO_IN_SERVICE")
    expect((await sql(`select count(*)::int total from human_support_entry_events where organization_id = $1 and person_id = $2 and kind = 'NO_ANJO_IN_SERVICE'`, [ORG, ids.O21])).rows[0]).toEqual({ total: 1 })

    // Voltar ao padrão: o G1 deixa de ter tempos próprios — a linha fica e a versão sobe (203: nunca volta a 0).
    const restored = await updateGroupResponseTimes(pool, viewer("COORD"), ids.G1!, { times: null, version: 1 })
    expect(restored.groups[0]).toMatchObject({ custom: false, version: 2, times: { operatorRequeueMinutes: 30 } })
    await updateOrganizationResponseTimes(pool, viewer("ADMIN"), { operatorRequeueMinutes: 15, operatorCloseMinutes: 20, anjoRequeueMinutes: 15, anjoUnresponsive: { pauseAfterMinutes: 20, offlineAfterMinutes: 10 }, version: orgSaved.organization.version })
    await resetOpen()
  }, 60_000)

  it("Anjo sem responder ninguém (195): pausa Desconexão pelo sistema, fora de serviço, Indisponível ao vencer, motivo visível; voltar limpa", async () => {
    // Um Anjo novo, sem mensagens anteriores, que só atende o pedido deste cenário.
    await person("A9", { team: "G1", subteam: "S1" }, true)
    await grant("A9", "ANJO", { type: "GROUP", team: "G1" })
    await available("A9")
    const { request: owed } = await ask("O22")
    expect(owed.status).toBe("IN_PROGRESS")
    const attendance = (await sql(`select id, anjo_person_id from human_support_attendances where request_id = $1 and status = 'ACTIVE'`, [owed.id])).rows[0] as { id: string; anjo_person_id: string }
    expect(attendance.anjo_person_id).toBe(ids.A9)
    // 21 min devendo resposta, sem nenhum sinal de vida dele nesse tempo (a última mudança de estado dele foi há 30 min).
    await sql(`update human_support_attendances set last_human_message_at = now() - interval '21 minutes' where id = $1`, [attendance.id])
    await sql(`update human_support_presence_events set occurred_at = now() - interval '30 minutes' where organization_id = $1 and person_id = $2 and cause = 'ANJO'`, [ORG, ids.A9])
    const summary = await dispatchOrganization(pool, ORG)
    expect(summary.unresponsivePaused).toBe(1)
    // Perdeu o atendimento (abandono do Anjo) e, devendo há 21 min, foi posto em pausa "Desconexão" pelo sistema.
    expect((await sql(`select end_cause from human_support_attendances where id = $1`, [attendance.id])).rows[0]).toEqual({ end_cause: "ANJO_SILENT" })
    expect((await sql(`select status, pause_reason from human_support_agent_presence where organization_id = $1 and person_id = $2`, [ORG, ids.A9])).rows[0]).toEqual({ status: "PAUSED", pause_reason: "DISCONNECTION" })
    expect((await sql(`select cause, to_status, pause_reason from human_support_presence_events where organization_id = $1 and person_id = $2 order by id desc limit 1`, [ORG, ids.A9])).rows[0]).toEqual({ cause: "UNRESPONSIVE", to_status: "PAUSED", pause_reason: "DISCONNECTION" })
    // O pedido não volta para ele; com ele fora de serviço e mais ninguém, vale "ninguém em serviço" para quem pede.
    expect(await activeOf("A9")).toBe(0)
    expect((await loadOperatorView(pool, viewer("O23"))).availability!.status).toBe("NONE_IN_SERVICE")
    // O motivo aparece para o Anjo e para a coordenação, com até quando a pausa vale.
    const own = (await loadAnjoView(pool, viewer("A9"))).presence.unresponsive!
    expect(own.kind).toBe("PAUSED")
    expect(Date.parse(own.offlineAt!) - Date.parse(own.since)).toBe(10 * 60_000)
    expect((await anjosNow(pool, viewer("COORD"), {})).items.find((item) => item.personId === ids.A9)!.unresponsive).toMatchObject({ kind: "PAUSED" })

    // 11 min na pausa sem voltar → Indisponível, com o motivo registrado.
    await sql(`update human_support_agent_presence set status_since = now() - interval '11 minutes' where organization_id = $1 and person_id = $2`, [ORG, ids.A9])
    await renewAnjoLease(pool, viewer("A9"))
    await dispatchOrganization(pool, ORG)
    expect((await sql(`select status from human_support_agent_presence where organization_id = $1 and person_id = $2`, [ORG, ids.A9])).rows[0]).toEqual({ status: "OFFLINE" })
    expect((await sql(`select cause from human_support_presence_events where organization_id = $1 and person_id = $2 and to_status = 'OFFLINE' order by id desc limit 1`, [ORG, ids.A9])).rows[0]).toEqual({ cause: "UNRESPONSIVE_TIMEOUT" })
    expect((await anjosNow(pool, viewer("COORD"), {})).items.find((item) => item.personId === ids.A9)!.unresponsive).toMatchObject({ kind: "OFFLINE", offlineAt: null })

    // Ele volta (escolhe Disponível): o motivo some, a perda antiga não o põe em pausa de novo e ele recebe o pedido da fila.
    await changePresence(pool, viewer("A9"), { status: "AVAILABLE" })
    await dispatchOrganization(pool, ORG)
    expect((await sql(`select status, pause_reason from human_support_agent_presence where organization_id = $1 and person_id = $2`, [ORG, ids.A9])).rows[0]).toEqual({ status: "AVAILABLE", pause_reason: null })
    expect((await loadAnjoView(pool, viewer("A9"))).presence.unresponsive).toBeNull()
    await resetOpen()
    // O A9 é só deste cenário: sem o papel, não entra nas contagens dos outros.
    await sql(`update access_role_assignments set revoked_at = now() where organization_id = $1 and user_account_id = $2 and revoked_at is null`, [ORG, ids["A9:account"]])
  }, 60_000)

  it("a visão do operador nunca tem presença nem pausa de Anjo, nem com todos em pausa; o operador vê 'aguarde na fila'", async () => {
    await available("A1")
    await changePresence(pool, viewer("A1"), { status: "PAUSED", pauseReason: "MEETING" })
    const state = await loadState(pool, viewer("O9"), { workspace: "anjo" })
    expect(state.anjo).toBeNull()
    expect(state.operator!.availability!.status).toBe("NONE_AVAILABLE")
    const preview = await previewRequest(pool, viewer("O9"), {})
    for (const payload of [state, preview]) expect(JSON.stringify(payload)).not.toMatch(/pause|presence|MEETING|LUNCH|PERSONAL|PROCESS_ACTIVITY/i)
    await resetOpen()
  })

  it("desligar o Subgrupo com fila e atendimento: a fila é cancelada no mesmo comando e o atendimento segue", async () => {
    await available("A1")
    await updateAnjoCapacity(pool, viewer("ADMIN"), ids.A1!, 1)
    const attended = (await ask("O11")).request
    const queued = (await ask("O12")).request
    expect([attended.status, queued.status]).toEqual(["IN_PROGRESS", "WAITING"])
    await updateScopeState(pool, viewer("ADMIN"), { scopeType: "SUBGROUP", id: ids.S1!, state: "OFF" })
    expect(await request(queued.id)).toMatchObject({ status: "CANCELLED", end_cause: "SCOPE_DISABLED" })
    expect((await request(attended.id)).status).toBe("IN_PROGRESS")
    await expect(ask("O13")).rejects.toMatchObject({ code: "HUMAN_SUPPORT_DISABLED" })
    await updateScopeState(pool, viewer("ADMIN"), { scopeType: "SUBGROUP", id: ids.S1!, state: "INHERIT" })
    await updateAnjoCapacity(pool, viewer("ADMIN"), ids.A1!, null)
    await resetOpen()
  }, 60_000)

  it("escopos: o Anjo do Grupo 2 não recebe pedido do Grupo 1; o Coordenador do Grupo 1 não abre pedido do Grupo 2 nem vê o Anjo de organização; registro LGPD na atribuição e na leitura", async () => {
    await available("A4")
    // Só o Anjo do Grupo 2 disponível: ninguém do Grupo 1 em serviço, o pedido do Grupo 1 nem é criado.
    await expect(ask("O14")).rejects.toMatchObject({ code: "HUMAN_SUPPORT_NO_ANJO_IN_SERVICE" })
    await available("A2")
    await changePresence(pool, viewer("A2"), { status: "PAUSED", pauseReason: "PERSONAL" })
    const g1 = (await ask("O14")).request
    // Em pausa: em serviço, mas não recebe — o Anjo do Grupo 2 também não.
    expect(g1.status).toBe("WAITING")
    const g2 = (await ask("OG2")).request
    expect(g2.status).toBe("IN_PROGRESS")
    await expect(requestDetail(pool, viewer("COORD"), g2.id)).rejects.toMatchObject({ statusCode: 404 })
    await changePresence(pool, viewer("A2"), { status: "AVAILABLE" })
    const detail = await requestDetail(pool, viewer("COORD"), g1.id)
    expect(detail.anjoNames).toEqual(["Proof HS A2"])
    const logs = (await sql(`select viewer_person_id, subject_person_id, data_kind from personal_data_access_log where organization_id = $1 and resource_id = $2 order by viewer_person_id, subject_person_id`, [ORG, g1.id])).rows as { viewer_person_id: string; subject_person_id: string; data_kind: string }[]
    expect(logs).toEqual(expect.arrayContaining([
      { viewer_person_id: ids.A2, subject_person_id: ids.O14, data_kind: "HUMAN_SUPPORT_CONVERSATION" },
      { viewer_person_id: ids.COORD, subject_person_id: ids.O14, data_kind: "HUMAN_SUPPORT_CONVERSATION" },
      { viewer_person_id: ids.COORD, subject_person_id: ids.A2, data_kind: "HUMAN_SUPPORT_CONVERSATION" },
    ]))
    const reachable = (await anjosActivity(pool, viewer("COORD"), { from: today(), to: today() })).items.map((item) => item.name).sort()
    expect(reachable).toEqual(["Proof HS A1", "Proof HS A2", "Proof HS A3"])
    const listed = await listRequests(pool, viewer("COORD"), { from: today(), to: today() })
    expect(listed.items.some((item) => item.id === g2.id)).toBe(false)
    expect((await listAnjos(pool, ORG, { subteamId: ids.S3! })).map((row) => row.name).sort()).toEqual(["Proof HS A4", "Proof HS A5"])
    await resetOpen()
  }, 60_000)

  it("classificação, avaliação (24 h; Interrompido não avalia), funil M1–M17 e exportação do titular", async () => {
    await available("A3")
    const { request: created } = await ask("O15", { note: "  É sobre a fatura de outubro.  " })
    expect(created.sharedContext.note).toBe("É sobre a fatura de outubro.")
    await sendMessage(pool, viewer("A3"), created.id, { clientMessageId: randomUUID(), body: "Oi! Posso ajudar.", viewerIsAnjo: true })
    const closed = await closeRequest(pool, viewer("A3"), created.id, { viewerIsAnjo: true })
    expect(closed.request).toMatchObject({ status: "CLOSED", end_cause: "ANJO_CLOSED" })
    const attendanceId = ((await sql(`select id from human_support_attendances where request_id = $1`, [created.id])).rows[0] as { id: string }).id
    const classification = classificationInputSchema.parse({ reason: "FOUND_IN_PROCESS", referenceTitle: "Contestação de fatura", outcome: "RESOLVED", pertinence: "PERTINENT" })
    await classifyAttendance(pool, viewer("A3"), attendanceId, classification)
    await expect(classifyAttendance(pool, viewer("A3"), attendanceId, classification)).rejects.toMatchObject({ code: "HUMAN_SUPPORT_ALREADY_CLASSIFIED" })
    expect(await evaluateAttendance(pool, viewer("O15"), attendanceId, { resolved: "YES" })).toEqual({ resolved: "YES", stars: null })
    expect(await evaluateAttendance(pool, viewer("O15"), attendanceId, { stars: 5 })).toEqual({ resolved: "YES", stars: 5 })
    await expect(evaluateAttendance(pool, viewer("A3"), attendanceId, { stars: 1 })).rejects.toMatchObject({ statusCode: 404 })
    await sql(`update human_support_attendances set ended_at = now() - interval '25 hours' where id = $1`, [attendanceId])
    await expect(evaluateAttendance(pool, viewer("O15"), attendanceId, { stars: 4 })).rejects.toMatchObject({ code: "HUMAN_SUPPORT_EVALUATION_CLOSED" })
    const funnel = await supportFunnel(pool, viewer("ADMIN"), { from: today(), to: today() })
    expect(funnel.measures.map((measure) => measure.id)).toEqual(["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10", "M11", "M12", "M13", "M14", "M15", "M16", "M17"])
    // M9: a tentativa da prévia sem Anjo + o operador que voltou sem ninguém em serviço (194).
    expect(funnel.measures.find((measure) => measure.id === "M9")!.main.value).toBe(2)
    expect(funnel.measures.find((measure) => measure.id === "M14")!.extra).toEqual([{ key: "Contestação de fatura", label: "Contestação de fatura", count: 1 }])
    expect(funnel.cutoffs.disabledPeriods.every((period) => period.to !== null)).toBe(true)
    await expect(supportFunnel(pool, viewer("ADMIN"), { from: "2026-01-01", to: today() })).rejects.toMatchObject({ code: "PERIOD_TOO_LONG", statusCode: 422 })
    const operatorExport = await exportSubjectData(pool, { organizationId: ORG, personId: ids.O15!, actorPersonId: ids.ADMIN! })
    const operatorTables = new Set(operatorExport.sections.map((section) => section.table))
    for (const table of ["human_support_requests", "human_support_messages", "human_support_attendances", "human_support_classifications", "human_support_evaluations"]) expect(operatorTables.has(table)).toBe(true)
    expect(operatorTables.has("human_support_agent_presence")).toBe(false)
    const anjoExport = await exportSubjectData(pool, { organizationId: ORG, personId: ids.A3!, actorPersonId: ids.ADMIN! })
    const anjoTables = new Set(anjoExport.sections.map((section) => section.table))
    for (const table of ["human_support_attendances", "human_support_agent_presence", "human_support_presence_events", "human_support_classifications", "human_support_messages"]) expect(anjoTables.has(table)).toBe(true)
    expect(anjoTables.has("human_support_evaluations")).toBe(false)
    // Retenção: o pedido terminado sai com a conversa, os atendimentos, a classificação e a avaliação.
    await sql(`delete from personal_data_access_log where organization_id = $1 and resource_id = $2`, [ORG, created.id])
    await sql(`delete from human_support_requests where id = $1`, [created.id])
    for (const table of ["human_support_messages", "human_support_attendances", "human_support_request_events"]) expect(((await sql(`select count(*)::int total from ${table} where request_id = $1`, [created.id])).rows[0] as { total: number }).total).toBe(0)
    expect(((await sql(`select count(*)::int total from human_support_classifications where attendance_id = $1`, [attendanceId])).rows[0] as { total: number }).total).toBe(0)
    await resetOpen()
  }, 60_000)

  it("impedimentos operacionais (185): sem acesso e ferramenta indisponível gravam com a versão V2 e voltam no detalhe, no histórico do Anjo e no M14; motivo antigo segue legível", async () => {
    await available("A3")
    const startedAts: Record<string, string> = {}
    const classify = async (operator: string, body: Record<string, unknown>) => {
      const { request: created } = await ask(operator)
      await sendMessage(pool, viewer("A3"), created.id, { clientMessageId: randomUUID(), body: "Vamos ver isso.", viewerIsAnjo: true })
      await closeRequest(pool, viewer("A3"), created.id, { viewerIsAnjo: true })
      const attendance = (await sql(`select id, started_at, ended_at from human_support_attendances where request_id = $1`, [created.id])).rows[0] as { id: string; started_at: Date; ended_at: Date }
      // A pendência traz o início e o fim reais: a duração final, congelada.
      const pending = (await loadAnjoView(pool, viewer("A3"))).pendingClassifications.find((item) => item.attendanceId === attendance.id)!
      expect(pending).toMatchObject({ startedAt: attendance.started_at.toISOString(), endedAt: attendance.ended_at.toISOString() })
      startedAts[attendance.id] = pending.startedAt
      await classifyAttendance(pool, viewer("A3"), attendance.id, classificationInputSchema.parse(body))
      return { requestId: created.id, attendanceId: attendance.id }
    }
    const access = await classify("O17", { reason: "NO_TOOL_ACCESS", referenceTitle: "Siebel", otherDescription: "Perfil sem permissão de troca de titularidade.", outcome: "FORWARDED" })
    const down = await classify("O18", { reason: "TOOL_UNAVAILABLE", outcome: "GUIDED" })
    const legacy = await classify("O19", { reason: "NO_PROCESS", outcome: "NOT_RESOLVED" })
    // Registro gravado antes da V2: mesmo código, versão antiga — continua lido com o mesmo rótulo.
    await sql(`update human_support_classifications set catalog_version = 'CLASSIFICATION_CATALOG_V1' where attendance_id = $1`, [legacy.attendanceId])

    const rows = (await sql(`select attendance_id, reason, reference_title, other_description, outcome, catalog_version from human_support_classifications where attendance_id = any($1::uuid[]) order by reason`, [[access.attendanceId, down.attendanceId, legacy.attendanceId]])).rows
    expect(rows.map((row) => [row.reason, row.reference_title, row.other_description, row.outcome, row.catalog_version])).toEqual([
      ["NO_PROCESS", null, null, "NOT_RESOLVED", "CLASSIFICATION_CATALOG_V1"],
      ["NO_TOOL_ACCESS", "Siebel", "Perfil sem permissão de troca de titularidade.", "FORWARDED", "CLASSIFICATION_CATALOG_V2"],
      ["TOOL_UNAVAILABLE", null, null, "GUIDED", "CLASSIFICATION_CATALOG_V2"],
    ])
    // O motivo nunca vira resultado: o banco só aceita o que o Anjo escolheu.
    await expect(sql(`update human_support_classifications set reason = 'SEM_ACESSO' where attendance_id = $1`, [down.attendanceId])).rejects.toMatchObject({ code: "23514" })

    expect((await requestDetail(pool, viewer("ADMIN"), access.requestId)).classification).toEqual({ reason: "NO_TOOL_ACCESS", referenceTitle: "Siebel", referenceUrl: null, otherDescription: "Perfil sem permissão de troca de titularidade.", outcome: "FORWARDED" })
    const history = await anjoAttendanceHistory(pool, viewer("A3"), {})
    const byAttendance = new Map(history.items.map((item) => [item.attendanceId, item]))
    expect(byAttendance.get(access.attendanceId)).toMatchObject({ classified: true, classification: { reason: "NO_TOOL_ACCESS", outcome: "FORWARDED", referenceTitle: "Siebel" }, startedAt: startedAts[access.attendanceId] })
    expect(byAttendance.get(down.attendanceId)!.classification).toEqual({ reason: "TOOL_UNAVAILABLE", outcome: "GUIDED", referenceTitle: null })
    expect(byAttendance.get(legacy.attendanceId)!.classification).toEqual({ reason: "NO_PROCESS", outcome: "NOT_RESOLVED", referenceTitle: null })

    const listed = await listRequests(pool, viewer("ADMIN"), { from: today(), to: today() })
    expect(listed.items.find((item) => item.id === access.requestId)?.classificationReason).toBe("NO_TOOL_ACCESS")
    // Lista no formato de "Conversas com a INIA": total na primeira página, só a contagem das mensagens humanas (o conteúdo fica no
    // detalhe, que grava o registro LGPD) e busca pelo protocolo ou pelo nome do operador; `%` digitado é texto, não curinga.
    const target = listed.items.find((item) => item.id === access.requestId)!
    const allToday = (await sql(`select count(*)::int n from human_support_requests where organization_id = $1 and created_at >= ($2::date)::timestamp at time zone analytics_org_timezone($1) and created_at < ($2::date + 1)::timestamp at time zone analytics_org_timezone($1)`, [ORG, today()])).rows[0] as { n: number }
    expect(listed.total).toBe(allToday.n)
    if (listed.nextCursor) expect((await listRequests(pool, viewer("ADMIN"), { from: today(), to: today(), cursor: listed.nextCursor })).total).toBeNull()
    const humanMessages = (await sql(`select count(*)::int n from human_support_messages where request_id = $1 and author_kind <> 'SYSTEM'`, [access.requestId])).rows[0] as { n: number }
    expect(target.messageCount).toBe(humanMessages.n)
    const byProtocol = await listRequests(pool, viewer("ADMIN"), { from: today(), to: today(), search: target.protocol.toLowerCase() })
    expect(byProtocol).toMatchObject({ total: 1, items: [{ id: access.requestId }] })
    const byName = await listRequests(pool, viewer("ADMIN"), { from: today(), to: today(), search: target.operatorName })
    expect(byName.items.map((item) => item.id)).toContain(access.requestId)
    expect(byName.items.every((item) => item.operatorName.includes(target.operatorName))).toBe(true)
    expect((await listRequests(pool, viewer("ADMIN"), { from: today(), to: today(), search: "%" })).items).toEqual([])
    const m14 = (await supportFunnel(pool, viewer("ADMIN"), { from: today(), to: today() })).measures.find((measure) => measure.id === "M14")!
    const breakdown = new Map((m14.breakdown ?? []).map((entry) => [entry.key, entry]))
    expect(breakdown.get("NO_TOOL_ACCESS")).toMatchObject({ label: "Sem acesso à ferramenta ou ao sistema", count: 1 })
    expect(breakdown.get("TOOL_UNAVAILABLE")).toMatchObject({ label: "Ferramenta ou sistema indisponível", count: 1 })
    expect(breakdown.get("NO_PROCESS")).toMatchObject({ label: "Falta de processo cadastrado", count: 1 })
    expect(m14.extra).toEqual(expect.arrayContaining([{ key: "Siebel", label: "Siebel", count: 1 }]))

    // Os pedidos saem (não mudam o prazo da fila calculado pelo histórico nos outros cenários).
    for (const requestId of [access.requestId, down.requestId, legacy.requestId]) {
      await sql(`delete from personal_data_access_log where organization_id = $1 and resource_id = $2`, [ORG, requestId])
      await sql(`delete from human_support_requests where id = $1`, [requestId])
    }
    await resetOpen()
  }, 60_000)

  it("transferência pela coordenação (190): para um Anjo que pode receber, recusas, alcance, conversa contínua com leitura certa, sem classificação/avaliação do transferido e devolução à fila sem voltar ao mesmo Anjo", async () => {
    await resetOpen()
    await updateAnjoCapacity(pool, viewer("ADMIN"), ids.A1!, 2)
    await available("A1")
    const { request: made } = await ask("O24")
    expect(made.status).toBe("IN_PROGRESS")
    await sendMessage(pool, viewer("O24"), made.id, { clientMessageId: randomUUID(), body: "Preciso de ajuda com o estorno.", viewerIsAnjo: false })
    await sendMessage(pool, viewer("A1"), made.id, { clientMessageId: randomUUID(), body: "Vou verificar.", viewerIsAnjo: true })
    // O A1 programou uma pausa: a transferência encerra o atendimento dele, e a pausa entra.
    await changePresence(pool, viewer("A1"), { status: "PAUSED", pauseReason: "MEETING" })

    // Destinos: o A2 ainda não pode (Indisponível); o A1 é o atual; nada de Anjo de outro Grupo.
    const before = await transferCandidates(pool, viewer("COORD"), made.id)
    expect(before.currentAnjoName).toBe("Proof HS A1")
    expect(before.candidates.find((candidate) => candidate.personId === ids.A1)).toMatchObject({ canReceive: false, reason: "Atende este pedido agora" })
    expect(before.candidates.find((candidate) => candidate.personId === ids.A2)).toMatchObject({ canReceive: false, reason: "Indisponível" })
    expect(before.candidates.some((candidate) => candidate.personId === ids.A4)).toBe(false)
    await expect(transferAttendance(pool, viewer("COORD"), made.id, { target: { kind: "ANJO", anjoPersonId: ids.A2! }, reason: "Anjo precisou sair" })).rejects.toMatchObject({ code: "HUMAN_SUPPORT_TRANSFER_TARGET_UNAVAILABLE", statusCode: 409 })
    await expect(transferAttendance(pool, viewer("COORD"), made.id, { target: { kind: "ANJO", anjoPersonId: ids.A1! }, reason: "Anjo precisou sair" })).rejects.toMatchObject({ code: "HUMAN_SUPPORT_TRANSFER_SAME_ANJO" })
    // O Anjo do Grupo 2 não atende o Grupo 1: recusado como não Anjo deste pedido.
    await available("A4")
    await expect(transferAttendance(pool, viewer("COORD"), made.id, { target: { kind: "ANJO", anjoPersonId: ids.A4! }, reason: "Anjo precisou sair" })).rejects.toMatchObject({ code: "HUMAN_SUPPORT_TRANSFER_TARGET_UNAVAILABLE" })
    // Coordenador sem alcance (um "Anjo" só do Grupo 2 não coordena) — e quem não alcança o pedido recebe 404.
    await expect(transferCandidates(pool, viewer("A4"), made.id)).rejects.toMatchObject({ statusCode: 404 })

    // Transfere para o A2 (Disponível, conectado, com vaga).
    await available("A2")
    const detail = await transferAttendance(pool, viewer("COORD"), made.id, { target: { kind: "ANJO", anjoPersonId: ids.A2! }, reason: "  Anjo precisou sair  " })
    expect(detail.status).toBe("IN_PROGRESS")
    expect(detail.protocol).toBe(made.protocol)
    expect(detail.attendances.map((attendance) => [attendance.anjoName, attendance.endCause])).toEqual([["Proof HS A1", "TRANSFERRED"], ["Proof HS A2", null]])
    const transfer = (await sql(`select from_anjo_person_id, to_anjo_person_id, actor_person_id, reason from human_support_transfers where request_id = $1`, [made.id])).rows[0] as { from_anjo_person_id: string; to_anjo_person_id: string; actor_person_id: string; reason: string }
    expect(transfer).toEqual({ from_anjo_person_id: ids.A1, to_anjo_person_id: ids.A2, actor_person_id: ids.COORD, reason: "Anjo precisou sair" })
    expect(((await sql(`select count(*)::int total from audit_logs where organization_id = $1 and action = 'HUMAN_SUPPORT_ATTENDANCE_TRANSFERRED' and entity_id = $2`, [ORG, made.id])).rows[0] as { total: number }).total).toBe(1)
    expect(((await sql(`select count(*)::int total from personal_data_access_log where organization_id = $1 and viewer_person_id = $2 and resource_id = $3`, [ORG, ids.A2, made.id])).rows[0] as { total: number }).total).toBeGreaterThanOrEqual(1)
    // A pausa programada do A1 entrou (era o último atendimento dele).
    expect(((await sql(`select status, pause_reason from human_support_agent_presence where organization_id = $1 and person_id = $2`, [ORG, ids.A1])).rows[0] as { status: string; pause_reason: string })).toEqual({ status: "PAUSED", pause_reason: "MEETING" })

    // O operador: mesma conversa, com o aviso (sem o motivo); o A2 lê tudo, o que era do A1 em terceira pessoa; o A1 não tem o que
    // classificar nem o operador o que avaliar desse atendimento transferido.
    const operatorView = (await loadOperatorView(pool, viewer("O24"))).openRequest!
    expect(operatorView.anjo?.name).toBe("Proof HS A2")
    const operatorTexts = operatorView.messages.map((message) => message.body)
    expect(operatorTexts).toContain("Seu atendimento foi passado para Proof HS A2 (Apoio), que continua a conversa daqui.")
    expect(JSON.stringify(operatorView)).not.toContain("precisou sair")
    const a2 = (await listMessages(pool, viewer("A2"), made.id, { viewerIsAnjo: true })).messages.map((message) => message.body)
    expect(a2).toContain("Preciso de ajuda com o estorno.")
    expect(a2).toContain("Vou verificar.")
    expect(a2).toContain("Proof HS A1 recebeu o pedido.")
    expect(a2).not.toContain("Você recebeu este pedido.")
    expect(a2).toContain("Você recebeu este atendimento por transferência da coordenação. A conversa anterior está acima.")
    expect((await loadAnjoView(pool, viewer("A1"))).pendingClassifications.some((pending) => pending.protocol === made.protocol)).toBe(false)
    expect((await loadAnjoView(pool, viewer("A2"))).attendances.map((attendance) => attendance.protocol)).toContain(made.protocol)
    expect((await loadOperatorView(pool, viewer("O24"))).pendingEvaluations.some((evaluation) => evaluation.requestId === made.id)).toBe(false)

    // Devolver à frente da fila: volta com o mesmo queued_at, prazo novo, e a distribuição não o entrega ao A2 de novo — vai ao A3.
    const queuedAt = ((await sql(`select queued_at from human_support_requests where id = $1`, [made.id])).rows[0] as { queued_at: Date }).queued_at
    await available("A3")
    const requeued = await transferAttendance(pool, viewer("ADMIN"), made.id, { target: { kind: "QUEUE" }, reason: "Reorganizar a fila" })
    expect(requeued.attendances.at(-2)).toMatchObject({ anjoName: "Proof HS A2", endCause: "TRANSFERRED" })
    expect(requeued.attendances.at(-1)?.anjoName).toBe("Proof HS A3")
    expect(((await sql(`select queued_at from human_support_requests where id = $1`, [made.id])).rows[0] as { queued_at: Date }).queued_at.getTime()).toBe(queuedAt.getTime())
    expect((await loadOperatorView(pool, viewer("O24"))).openRequest!.messages.map((message) => message.body)).toContain("Seu atendimento voltou para a frente da fila: outra pessoa do Apoio vai continuar a conversa.")
    // Com o pedido de volta em atendimento, não dá para transferir um pedido na fila; encerrado, também não.
    await closeRequest(pool, viewer("O24"), made.id, { viewerIsAnjo: false })
    await expect(transferAttendance(pool, viewer("COORD"), made.id, { target: { kind: "QUEUE" }, reason: "Tarde demais" })).rejects.toMatchObject({ code: "HUMAN_SUPPORT_TRANSFER_NOT_IN_PROGRESS" })

    await resetOpen()
    await updateAnjoCapacity(pool, viewer("ADMIN"), ids.A1!, null)
    await sql(`delete from human_support_requests where id = $1`, [made.id])
  }, 60_000)

  it("histórico da operação (191): espera, tempo de atendimento, pertinência e foto; falta de retorno; abandono antes e depois; sem Anjo logado; programação; queda de rede e sessão encerrada; fila agora; jornada com meia-noite e cobertura; permissões", async () => {
    await resetOpen()
    for (const key of ["AW", "AH", "AS", "AJ"]) {
      await person(key, { team: "G1", subteam: "S1" }, true)
      await grant(key, "ANJO", { type: "GROUP", team: "G1" })
    }
    for (const key of ["H1", "H2", "H3", "H4", "H5", "H6"]) await person(key, { team: "G1", subteam: "S1" })
    const attendanceOf = (requestId: string) => sql(`select id, status, end_cause, lost_cause, started_at, ended_at from human_support_attendances where request_id = $1 order by started_at desc limit 1`, [requestId]).then((result) => result.rows[0] as { id: string; status: string; end_cause: string | null; lost_cause: string | null; started_at: Date; ended_at: Date | null })
    const history = (key: string, anjo: string) => operationHistory(pool, viewer(key), { from: today(), to: today(), anjoPersonId: ids[anjo] }, "COORDINATION")

    // 1. Atendimento direto com foto dos dois lados, 35 s de espera (da entrada ao acolhimento), 4 min de atendimento e pertinência.
    await sql(`update people set avatar_url = '/proof/h1.png' where id = $1`, [ids.H1])
    await sql(`update people set avatar_url = '/proof/aw.png' where id = $1`, [ids.AW])
    await available("AW")
    const { request: direct } = await ask("H1")
    expect(direct.status).toBe("IN_PROGRESS")
    expect((await loadAnjoView(pool, viewer("AW"))).attendances[0]).toMatchObject({ operatorName: "Proof HS H1", operatorAvatarUrl: "/proof/h1.png" })
    expect((await loadOperatorView(pool, viewer("H1"))).openRequest?.anjo).toMatchObject({ avatarUrl: "/proof/aw.png" })
    await sql(`update human_support_requests set created_at = now() - interval '300 seconds' where id = $1`, [direct.id])
    await sql(`update human_support_attendances a set started_at = r.created_at + interval '35 seconds' from human_support_requests r where r.id = a.request_id and a.request_id = $1`, [direct.id])
    await closeRequest(pool, viewer("AW"), direct.id, { viewerIsAnjo: true })
    await sql(`update human_support_attendances set ended_at = started_at + interval '240 seconds' where request_id = $1`, [direct.id])
    await classifyAttendance(pool, viewer("AW"), (await attendanceOf(direct.id)).id, classificationInputSchema.parse({ reason: "NO_PROCESS", outcome: "RESOLVED", pertinence: "NOT_PERTINENT" }))
    const aw = (await history("ADMIN", "AW")).anjos[0]!
    expect(aw.attendance).toMatchObject({ acolhimentos: 1, operatorWait: { averageSeconds: 35, count: 1 }, handling: { averageSeconds: 240, count: 1, normal: { count: 1 } }, pertinence: { pertinent: 0, notPertinent: 1, notEvaluated: 0 } })
    expect(aw.attendance.reasons.items).toEqual([expect.objectContaining({ key: "NO_PROCESS", count: 1 })])
    // Estrutura do Anjo para os filtros de "Por Anjo": Grupo/Subgrupo do cadastro e o líder mais próximo de cada cargo.
    await person("SUP", { team: "G1" })
    await person("MGR", { team: "G1" })
    await sql(`update people set role = 'MANAGER' where id = $1`, [ids.MGR])
    await sql(`update people set role = 'SUPERVISOR', reports_to_id = $2 where id = $1`, [ids.SUP, ids.MGR])
    await sql(`update people set reports_to_id = $2 where id = $1`, [ids.AW, ids.SUP])
    expect((await history("ADMIN", "AW")).anjos[0]!.structure).toMatchObject({
      team: { id: ids.G1 },
      subteam: { id: ids.S1 },
      leaders: { SUPERVISOR: { id: ids.SUP, name: "Proof HS SUP" }, COORDINATOR: null, MANAGER: { id: ids.MGR }, SENIOR_MANAGER: null },
    })
    await changePresence(pool, viewer("AW"), { status: "OFFLINE" })

    // 2. Falta de retorno: o operador escreveu, o Anjo nunca respondeu, 15 min sem mensagem → o Anjo perde o atendimento (193) e o
    //    pedido volta à fila; o operador já tinha fechado a INIA (não chama há 3 min), então sai da fila como abandono na espera.
    await updateAnjoCapacity(pool, viewer("ADMIN"), ids.AH!, 1)
    await renewAnjoLease(pool, viewer("AH"), { jti: randomUUID(), accountId: ids["AH:account"]!, expiresAt: new Date(Date.now() + 3_600_000) })
    await changePresence(pool, viewer("AH"), { status: "AVAILABLE" })
    const { request: silent } = await ask("H2")
    await sendMessage(pool, viewer("H2"), silent.id, { clientMessageId: randomUUID(), body: "Alguém aí?", viewerIsAnjo: false })
    await sql(`update human_support_attendances set last_human_message_at = now() - interval '16 minutes' where request_id = $1`, [silent.id])
    await sql(`update human_support_requests set operator_seen_at = now() - interval '3 minutes' where id = $1`, [silent.id])
    await dispatchOrganization(pool, ORG)
    expect(await attendanceOf(silent.id)).toMatchObject({ end_cause: "ANJO_SILENT" })
    expect((await request(silent.id)).status).toBe("ABANDONED")

    // 3. Fila sem outro Anjo elegível (o AH está cheio, capacidade 1) → o operador sai antes do acolhimento: abandono, com 1 Anjo em serviço.
    const { request: absent } = await ask("H3")
    const { request: queued } = await ask("H4")
    expect(queued.status).toBe("WAITING")
    await sql(`update human_support_requests set operator_seen_at = now() - interval '3 minutes' where id = $1`, [queued.id])
    await dispatchOrganization(pool, ORG)
    expect(await sql(`select status, anjos_in_service_at_end from human_support_requests where id = $1`, [queued.id]).then((result) => result.rows[0])).toEqual({ status: "ABANDONED", anjos_in_service_at_end: 1 })
    // 4. Abandono DEPOIS do acolhimento: o operador fechou a INIA no meio do atendimento (atribuído ao Anjo).
    await sql(`update human_support_requests set operator_seen_at = now() - interval '6 minutes' where id = $1`, [absent.id])
    await closeRequest(pool, viewer("AH"), absent.id, { cause: "OPERATOR_ABSENT", viewerIsAnjo: true })

    // 5. Pausa programada durante o atendimento: continua Em atendimento, com a mudança sinalizada; a fila agora mostra quem espera.
    const { request: busy } = await ask("H5")
    expect(busy.status).toBe("IN_PROGRESS")
    await changePresence(pool, viewer("AH"), { status: "PAUSED", pauseReason: "LUNCH" })
    const { request: last } = await ask("H6")
    expect(last.status).toBe("WAITING")
    const now = await anjosNow(pool, viewer("COORD"), {})
    expect(now.items.find((item) => item.personId === ids.AH)).toMatchObject({ status: "IN_ATTENDANCE", connection: "CONNECTED", scheduled: { status: "PAUSED", pauseReason: "LUNCH" } })
    expect(now.queue.waiting).toBeGreaterThanOrEqual(1)
    expect(now.queue.awaitingFirstResponse).toBeGreaterThanOrEqual(1)
    // Clicar na fila: quem aguarda e desde quando (entrada original), para o Coordenador e o Administrador geral.
    const waitingList = await queueWaiting(pool, viewer("COORD"), {})
    expect(waitingList.find((item) => item.requestId === last.id)).toMatchObject({ operatorName: "Proof HS H6", requeued: false, waitingSince: (await request(last.id)).queued_at.toISOString() })
    expect((await queueWaiting(pool, viewer("ADMIN"), {})).some((item) => item.requestId === last.id)).toBe(true)

    // 6. Queda de rede além da carência: atendimento interrompido (causa: rede), o Anjo sai; o pedido na fila que vence agora fica
    //    registrado SEM Anjo em serviço.
    await sql(`update human_support_agent_presence set lease_until = now() - interval '4 minutes' where person_id = $1`, [ids.AH])
    await sql(`update human_support_requests set queue_expires_at = now() - interval '1 second' where id = $1`, [last.id])
    await dispatchOrganization(pool, ORG)
    expect(await attendanceOf(busy.id)).toMatchObject({ end_cause: "ANJO_LOST", lost_cause: "CONNECTION" })
    expect(await sql(`select status, anjos_in_service_at_end from human_support_requests where id = $1`, [last.id]).then((result) => result.rows[0])).toEqual({ status: "EXPIRED", anjos_in_service_at_end: 0 })
    const lostEvent = (await sql(`select cause, occurred_at from human_support_presence_events where person_id = $1 and cause in ('CONNECTION_LOST', 'SESSION_ENDED') order by id desc limit 1`, [ids.AH])).rows[0] as { cause: string; occurred_at: Date }
    expect(lostEvent.cause).toBe("CONNECTION_LOST")
    // Reconexão: a volta é registrada no instante da renovação.
    await renewAnjoLease(pool, viewer("AH"))
    const restoredAt = ((await sql(`select connection_restored_at from human_support_agent_presence where person_id = $1`, [ids.AH])).rows[0] as { connection_restored_at: Date }).connection_restored_at
    await dispatchOrganization(pool, ORG)
    expect((await sql(`select occurred_at from human_support_presence_events where person_id = $1 and cause = 'CONNECTION_RESTORED' order by id desc limit 1`, [ids.AH])).rows[0]).toEqual({ occurred_at: restoredAt })
    const ah = (await history("ADMIN", "AH")).anjos[0]!.attendance
    expect(ah.noReply).toMatchObject({ rate: { numerator: 1, denominator: 3 }, anjoSide: 1, operatorSide: 0 })
    expect(ah.abandonedAfterAcolhimento).toBe(1)
    expect(ah.interruptedBySystem).toMatchObject({ connection: 1, session: 0 })
    // Abandonos de hoje (Monitoria Online) no alcance do Coordenador do G1: o operador que fechou a INIA na fila, o que saiu no meio do
    // atendimento, a falta de retorno do Anjo e a queda do Anjo — nunca os encerramentos normais.
    const gone = await supportAbandonment(pool, viewer("COORD"), { from: today(), to: today() })
    expect(gone.waiting.closedInia).toBeGreaterThanOrEqual(1)
    expect(gone.attendance.byOperator.leftInia).toBeGreaterThanOrEqual(1)
    expect(gone.attendance.byAnjo.noReply).toBeGreaterThanOrEqual(1)
    expect(gone.attendance.byAnjo.connection).toBeGreaterThanOrEqual(1)
    expect(gone.attendance.abandoned).toBe(gone.attendance.byOperator.total + gone.attendance.byAnjo.total)
    expect(gone.attendance.abandoned).toBeLessThan(gone.attendance.ended)

    // 7. Sessão encerrada (o prazo do login venceu 10 min atrás; a área parou de dar sinal 4 min atrás — a sessão acabou antes):
    //    evento e interrupção marcados como SESSÃO.
    await renewAnjoLease(pool, viewer("AS"), { jti: randomUUID(), accountId: ids["AS:account"]!, expiresAt: new Date(Date.now() - 10 * 60_000) })
    await changePresence(pool, viewer("AS"), { status: "AVAILABLE" })
    await dispatchOrganization(pool, ORG)
    expect((await attendanceOf(busy.id)).status).toBe("ACTIVE")
    await sql(`update human_support_agent_presence set lease_until = now() - interval '4 minutes' where person_id = $1`, [ids.AS])
    // O prazo recuado simula o tempo passando; a conexão da área (CONNECTION_RESTORED da renovação acima) recua junto, como seria
    // na vida real (a renovação vem sempre antes do prazo que ela dá). Sem isso a conexão ficaria DEPOIS do fim da sessão e a
    // distribuição — que lê a última causa pela ordem do tempo (occurred_at, id) — veria a área conectada.
    await sql(`update human_support_presence_events set occurred_at = now() - interval '5 minutes' where person_id = $1 and cause = 'CONNECTION_RESTORED' and occurred_at > now() - interval '4 minutes'`, [ids.AS])
    await dispatchOrganization(pool, ORG)
    expect((await sql(`select cause from human_support_presence_events where person_id = $1 and cause in ('CONNECTION_LOST', 'SESSION_ENDED') order by id desc limit 1`, [ids.AS])).rows[0]).toEqual({ cause: "SESSION_ENDED" })
    expect(await attendanceOf(busy.id)).toMatchObject({ end_cause: "ANJO_LOST", lost_cause: "SESSION" })
    expect((await history("ADMIN", "AS")).anjos[0]!.attendance.interruptedBySystem).toMatchObject({ session: 1, connection: 0 })
    expect((await anjosNow(pool, viewer("COORD"), {})).items.find((item) => item.personId === ids.AS)).toMatchObject({ connection: "SESSION_ENDED" })

    // 7b. A sessão encerrada deixou o AS Indisponível na hora. Ele entra de novo e abre a área: continua Indisponível e NÃO recebe
    //     o pedido que está na fila; só depois de escolher Disponível.
    expect((await sql(`select status from human_support_agent_presence where person_id = $1`, [ids.AS])).rows[0]).toEqual({ status: "OFFLINE" })
    await updateAnjoCapacity(pool, viewer("ADMIN"), ids.AS!, 1)
    await renewAnjoLease(pool, viewer("AS"), { jti: randomUUID(), accountId: ids["AS:account"]!, expiresAt: new Date(Date.now() + 3_600_000) })
    await dispatchOrganization(pool, ORG)
    expect((await request(busy.id)).status).toBe("WAITING")
    expect((await loadAnjoView(pool, viewer("AS"))).presence).toMatchObject({ status: "OFFLINE", connected: true })
    await changePresence(pool, viewer("AS"), { status: "AVAILABLE" })
    expect((await attendanceOf(busy.id))).toMatchObject({ status: "ACTIVE" })
    expect((await sql(`select anjo_person_id from human_support_attendances where request_id = $1 and status = 'ACTIVE'`, [busy.id])).rows[0]).toEqual({ anjo_person_id: ids.AS })
    // Ao concluir o atendimento, o cronômetro de "Disponível" recomeça do fim dele.
    await closeRequest(pool, viewer("AS"), busy.id, { viewerIsAnjo: true })
    const endedAt = (await attendanceOf(busy.id)).ended_at!
    expect((await loadAnjoView(pool, viewer("AS"))).presence).toMatchObject({ status: "AVAILABLE", since: endedAt.toISOString() })
    // 7c. Logout e login de novo ANTES de a conexão vencer: a sessão anterior foi revogada → Indisponível ao abrir a área.
    const oldJti = ((await sql(`select session_jti from human_support_agent_presence where person_id = $1`, [ids.AS])).rows[0] as { session_jti: string }).session_jti
    await sql(`insert into auth_revoked_sessions (jti, account_id, expires_at) values ($1, $2, now() + interval '1 hour')`, [oldJti, ids["AS:account"]])
    const fresh = { jti: randomUUID(), accountId: ids["AS:account"]!, expiresAt: new Date(Date.now() + 3_600_000) }
    const relogged = await loadState(pool, viewer("AS"), { workspace: "anjo", anjo: true, session: fresh })
    expect(relogged.anjo?.presence).toMatchObject({ status: "OFFLINE", connected: true })
    expect((await sql(`select cause, to_status from human_support_presence_events where person_id = $1 order by id desc limit 1`, [ids.AS])).rows[0]).toEqual({ cause: "SESSION_ENDED", to_status: "OFFLINE" })
    // Outra aba com a MESMA sessão (ou outra sessão válida) não derruba nada.
    await changePresence(pool, viewer("AS"), { status: "AVAILABLE" })
    await loadState(pool, viewer("AS"), { workspace: "anjo", anjo: true, session: { ...fresh, jti: randomUUID() } })
    expect((await loadAnjoView(pool, viewer("AS"))).presence.status).toBe("AVAILABLE")
    await sql(`delete from auth_revoked_sessions where jti = $1`, [oldJti])
    await changePresence(pool, viewer("AS"), { status: "OFFLINE" })
    await updateAnjoCapacity(pool, viewer("ADMIN"), ids.AS!, null)

    // 8. Jornada pelo banco: dois dias civis no fuso da organização, um atendimento que atravessa a meia-noite; Indisponível = offline.
    const at = async (dayOffset: number, time: string) => ((await sql(`select ((now() at time zone analytics_org_timezone($1))::date + $2::int + $3::time)::timestamp at time zone analytics_org_timezone($1) at`, [ORG, dayOffset, time])).rows[0] as { at: Date }).at
    const event = async (when: Date, cause: string, to: string, pause: string | null = null) =>
      sql(`insert into human_support_presence_events (organization_id, person_id, from_status, to_status, pause_reason, cause, occurred_at) values ($1, $2, null, $3, $4, $5, $6)`, [ORG, ids.AJ, to, pause, cause, when])
    const span = async (start: Date, end: Date) => {
      const { request: made } = await ask("H6")
      await sql(`insert into human_support_attendances (organization_id, request_id, anjo_person_id, operator_person_id, status, end_cause, started_at, last_human_message_at, ended_at) values ($1, $2, $3, $4, 'ENDED', 'ANJO_CLOSED', $5, $5, $6)`, [ORG, made.id, ids.AJ, ids.H6, start, end])
      await sql(`update human_support_requests set status = 'CLOSED', end_cause = 'ANJO_CLOSED', ended_at = $2 where id = $1`, [made.id, end])
    }
    await renewAnjoLease(pool, viewer("AW"))
    await changePresence(pool, viewer("AW"), { status: "AVAILABLE" })
    await event(await at(-2, "23:00"), "CONNECTION_RESTORED", "OFFLINE")
    await event(await at(-2, "23:00"), "ANJO", "AVAILABLE")
    await span(await at(-2, "23:30"), await at(-1, "00:30"))
    await event(await at(-1, "01:00"), "CONNECTION_LOST", "AVAILABLE")
    await event(await at(-1, "08:00"), "CONNECTION_RESTORED", "AVAILABLE")
    await span(await at(-1, "09:00"), await at(-1, "12:00"))
    await event(await at(-1, "12:00"), "ANJO", "PAUSED", "LUNCH")
    await event(await at(-1, "13:30"), "ANJO", "AVAILABLE")
    await event(await at(-1, "15:30"), "ANJO", "PAUSED", "PERSONAL")
    await event(await at(-1, "15:45"), "ANJO", "OFFLINE")
    await event(await at(-1, "16:00"), "CONNECTION_LOST", "OFFLINE")
    const two = (await sql(`select to_char((now() at time zone analytics_org_timezone($1))::date - 2, 'YYYY-MM-DD') d2, to_char((now() at time zone analytics_org_timezone($1))::date - 1, 'YYYY-MM-DD') d1`, [ORG])).rows[0] as { d2: string; d1: string }
    const journey = (await operationHistory(pool, viewer("AJ"), { from: two.d2, to: two.d1 }, "SELF"))
    expect(journey.consolidated).toBeNull()
    expect(journey.anjos.map((anjo) => anjo.personId)).toEqual([ids.AJ])
    const [d2, d1] = journey.anjos[0]!.journey.days
    const H = 3_600_000
    expect(d2).toMatchObject({ day: two.d2, availableMs: 0.5 * H, attendanceMs: 0.5 * H, baseMs: 1 * H })
    expect(d1).toMatchObject({ day: two.d1, availableMs: 3.5 * H, attendanceMs: 3.5 * H, baseMs: 8.75 * H })
    expect(d1!.pausedMs).toMatchObject({ LUNCH: 1.5 * H, PERSONAL: 0.25 * H })
    // Indisponível = offline (o declarado 15:45–16:00 e o sem conexão): o resto do dia, fora do tempo online.
    expect(d1!.unavailableMs).toBe(24 * H - 8.75 * H)
    expect(journey.anjos[0]!.journey.summary).toMatchObject({ daysWithOnline: 2, baseMs: 9.75 * H })
    expect(journey.coverage.connectionSince).not.toBeNull()

    // 9. Permissões: o Coordenador do Grupo 1 não lê o histórico do Anjo do Grupo 2; o Administrador geral lê.
    await expect(history("COORD", "A4")).rejects.toMatchObject({ statusCode: 404 })
    expect((await history("ADMIN", "A4")).anjos.map((anjo) => anjo.personId)).toEqual([ids.A4])
    const operation = (await operationHistory(pool, viewer("ADMIN"), { from: today(), to: today() }, "COORDINATION")).consolidated!.operation
    expect(operation.noAnjoLogged.count).toBeGreaterThanOrEqual(1)
    expect(operation.abandonedBeforeAcolhimento.abandoned).toBeGreaterThanOrEqual(1)
    // Indicadores › acionamentos: o pedido classificado Não pertinente entra em "não produtivos"; filtrar mostra só eles.
    const demand = await supportDemand(pool, viewer("ADMIN"), { from: today(), to: today(), productivity: "NOT_PRODUCTIVE" })
    expect(demand.productivity.NOT_PRODUCTIVE).toBeGreaterThanOrEqual(1)
    expect(demand.total).toBe(demand.productivity.NOT_PRODUCTIVE)
    expect(demand.top.operators.some((item) => item.label === "Proof HS H1")).toBe(true)
    expect(demand.byHour.reduce((sum, value) => sum + value, 0)).toBe(demand.total)
    await expect(supportDemand(pool, viewer("COORD"), { from: today(), to: today() })).resolves.toMatchObject({ period: { from: today() } })

    await resetOpen()
    await updateAnjoCapacity(pool, viewer("ADMIN"), ids.AH!, null)
  }, 90_000)

  it("quem abandonou (17/11): a lista de cada card tem o total do card, os motivos do card e só o alcance de quem lê; paginada no servidor", async () => {
    await resetOpen()
    // Abandonos no Grupo 2 (fora do alcance do Coordenador do G1): o operador sai no meio do atendimento e, depois, cancela na fila.
    await available("A4")
    const { request: left } = await ask("OG2")
    expect(left.status).toBe("IN_PROGRESS")
    await sql(`update human_support_requests set operator_seen_at = now() - interval '6 minutes' where id = $1`, [left.id])
    await closeRequest(pool, viewer("A4"), left.id, { cause: "OPERATOR_ABSENT", viewerIsAnjo: true })
    await changePresence(pool, viewer("A4"), { status: "PAUSED", pauseReason: "PERSONAL" })
    const { request: cancelled } = await ask("OG2")
    expect(cancelled.status).toBe("WAITING")
    await cancelRequest(pool, viewer("OG2"), cancelled.id)
    await resetOpen()

    const period = { from: today(), to: today() }
    const listAll = async (key: string, kind: "WAITING" | "ANJO" | "OPERATOR", filter: { teamId?: string } = {}) => {
      const pages = []
      for (let page = 1; ; page += 1) {
        const result = await supportAbandonmentList(pool, viewer(key), { ...period, ...filter, kind, page, pageSize: 10 })
        expect(result.items.length).toBeLessThanOrEqual(10)
        pages.push(result)
        if (page * 10 >= result.total) break
      }
      const items = pages.flatMap((result) => result.items)
      expect(new Set(items.map((item) => `${item.request.id}:${item.attendanceStartedAt}`)).size).toBe(items.length)
      expect(items.map((item) => item.at)).toEqual([...items.map((item) => item.at)].sort().reverse())
      return { total: pages[0]!.total, items }
    }
    const count = (items: { reason: string }[], reason: string) => items.filter((item) => item.reason === reason).length
    for (const [key, filter] of [["ADMIN", {}], ["COORD", {}], ["ADMIN", { teamId: ids.G2! }]] as const) {
      const numbers = await supportAbandonment(pool, viewer(key), { ...period, ...filter })
      const waiting = await listAll(key, "WAITING", filter)
      expect(waiting.total).toBe(numbers.waiting.abandoned)
      expect(waiting.items).toHaveLength(numbers.waiting.abandoned)
      expect([count(waiting.items, "CLOSED_INIA"), count(waiting.items, "CANCELLED")]).toEqual([numbers.waiting.closedInia, numbers.waiting.cancelled])
      expect(waiting.items.every((item) => item.counterpart === null && item.attendanceStartedAt === null)).toBe(true)
      const anjo = await listAll(key, "ANJO", filter)
      expect(anjo.items).toHaveLength(numbers.attendance.byAnjo.total)
      expect([count(anjo.items, "NO_REPLY"), count(anjo.items, "LOGGED_OUT")]).toEqual([numbers.attendance.byAnjo.noReply, numbers.attendance.byAnjo.session])
      const operator = await listAll(key, "OPERATOR", filter)
      expect(operator.items).toHaveLength(numbers.attendance.byOperator.total)
      expect([count(operator.items, "LEFT_INIA"), count(operator.items, "NO_REPLY")]).toEqual([numbers.attendance.byOperator.leftInia, numbers.attendance.byOperator.noReply])
      // Escopo: o Coordenador do G1 só vê pedidos do G1; o Administrador geral vê os do G2 (o operador OG2 nas duas listas dele).
      const teams = new Set([...waiting.items, ...anjo.items, ...operator.items].map((item) => item.request.teamName))
      if (key === "COORD") expect([...teams]).toEqual(["Proof G1"])
      else {
        expect(teams.has("Proof G2")).toBe(true)
        expect(waiting.items.some((item) => item.request.id === cancelled.id && item.person.personId === ids.OG2 && item.reason === "CANCELLED")).toBe(true)
        expect(operator.items.some((item) => item.request.id === left.id && item.person.personId === ids.OG2 && item.counterpart?.personId === ids.A4 && item.reason === "LEFT_INIA")).toBe(true)
      }
      if (key === "ADMIN" && "teamId" in filter) expect([...teams]).toEqual(["Proof G2"])
    }
    // O Coordenador do G1 não recebe nada do G2 nem pedindo o Grupo dele no filtro.
    expect((await supportAbandonmentList(pool, viewer("COORD"), { ...period, teamId: ids.G2!, kind: "OPERATOR" })).total).toBe(0)
    // Do Anjo: quem aparece é o Anjo; o outro lado é o operador; queda de rede não entra.
    const anjoSide = await supportAbandonmentList(pool, viewer("ADMIN"), { ...period, kind: "ANJO", pageSize: 50 })
    expect(anjoSide.total).toBeGreaterThanOrEqual(1)
    expect(anjoSide.items.every((item) => item.counterpart !== null && item.attendanceStartedAt !== null)).toBe(true)
    // Página além do fim: vazia, com o total certo.
    const beyond = await supportAbandonmentList(pool, viewer("ADMIN"), { ...period, kind: "WAITING", page: 999, pageSize: 10 })
    expect(beyond.items).toEqual([])
    expect(beyond.total).toBe((await supportAbandonment(pool, viewer("ADMIN"), period)).waiting.abandoned)
  }, 60_000)

  it("rota de ajuda do chat (HELP_ROUTE_V1, 19/11): Apoio só com alguém em serviço para a pessoa; desligado, sem ninguém, fora do escopo ou conexão vencida = liderança; nada registrado", async () => {
    await resetOpen()
    const route = createHelpRouteResolver(pool)
    const of = (key: string) => route({ organizationId: ORG, personId: ids[key]! })
    const entries = async () => ((await sql(`select count(*)::int total from human_support_entry_events where organization_id = $1`, [ORG])).rows[0] as { total: number }).total
    const before = await entries()
    // Ninguém em serviço (todos Indisponíveis depois do reset): liderança.
    expect(await of("O1")).toBe("LEADERSHIP")
    // Subgrupo desligado: liderança, mesmo com Anjo do Grupo em serviço.
    await available("A1")
    expect(await of("OS2")).toBe("LEADERSHIP")
    // Em serviço e cobrindo o Grupo da pessoa: Apoio. Outro Grupo (só o A5 de organização cobre, e está Indisponível): liderança.
    expect(await of("O1")).toBe("SUPPORT")
    expect(await of("OG2")).toBe("LEADERSHIP")
    // Em pausa ainda está em serviço (o pedido vai para a fila): Apoio. Pausa "Desconexão" (sistema, 195) não está: liderança.
    await changePresence(pool, viewer("A1"), { status: "PAUSED", pauseReason: "MEETING" })
    expect(await of("O1")).toBe("SUPPORT")
    await sql(`update human_support_agent_presence set pause_reason = 'DISCONNECTION' where organization_id = $1 and person_id = $2`, [ORG, ids.A1])
    expect(await of("O1")).toBe("LEADERSHIP")
    // Disponível com a conexão da área vencida (fechou a área): liderança.
    await sql(`update human_support_agent_presence set status = 'AVAILABLE', pause_reason = null, lease_until = now() - interval '1 second' where organization_id = $1 and person_id = $2`, [ORG, ids.A1])
    expect(await of("O1")).toBe("LEADERSHIP")
    // Pessoa desconhecida na organização: liderança. Só leitura: nenhuma tentativa nem sugestão registrada.
    expect(await route({ organizationId: ORG, personId: randomUUID() })).toBe("LEADERSHIP")
    expect(await entries()).toBe(before)
    await resetOpen()
  })
})
