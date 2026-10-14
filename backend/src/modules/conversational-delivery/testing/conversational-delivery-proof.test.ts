/**
 * PROVA contra o banco de TESTE real (Workflow Outputs V1): o nó Output entrega o MESMO artefato confiável no Acompanhamento,
 * numa conversa NOVA da INIA (Chat) e num convite de voz (Avatar) — idempotente, sem invadir a conversa atual, com o ciclo de
 * vida da voz (aceitar ≠ entregar) e o sino. Motor de efeitos de PRODUÇÃO, ZERO modelo; fixture apagada no fim.
 *   INIA_DB_PROOF=1 npx vitest run conversational-delivery-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { productionEffects } from "../../workflows/application/effect-sink.js"
import { executeOutput } from "../../workflows/application/output-executor.js"
import type { OutputNodeConfig } from "../../workflows/domain/output-schema.js"
import { nodeOutputOf, type ReliableFeedbackArtifactV1 } from "../../reliable-feedback/domain/reliable-feedback-artifact.js"
import { appendConversationMessage, loadCurrentConversation, resolveConversationForWrite } from "../../assistant/application/assistant-conversations.js"
import { buildNotificationSummary } from "../../notifications/application/build-notification-summary.js"
import { PgNotificationsRepository } from "../../notifications/application/notifications-repository.js"
import { PgPendingActionsRepository } from "../../pending-actions/application/pending-actions-repository.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { applyAvatarDeliveryEvent, loadRecipientInbox, markWorkflowConversationSeen } from "../application/avatar-delivery-service.js"
import { loadWorkflowConversationContext } from "../application/workflow-conversation-context.js"
import { loadRecadoSpeechAudio } from "../application/recado-speech-audio.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool

function artifact(collaboratorId: string, interactionId: string): ReliableFeedbackArtifactV1 {
  return {
    contract: "RELIABLE_FEEDBACK_ARTIFACT_V1", domain: "MONITORING", sourceNodeId: "agent", sourceType: "AGENT",
    subject: { collaboratorId, interactionId, indicatorMeasurementId: null }, label: "Contestação de conta", uncertainties: [], blockedReason: null, policyVersion: "P",
    writer: { invoked: true, skippedReason: null, error: null, promptVersion: "V1" },
    items: [{
      index: 0, claimRef: "c0", domain: "MONITORING", section: "OPPORTUNITY", kind: "MONITORING_DEVELOPMENT_POINT", polarity: "NEGATIVE", ownership: "AGENT", safeMeaning: "ponto",
      guidanceSource: "COACHING_SUGGESTION", facts: [{ role: "OPERADOR", text: "É só aguardar.", truncated: false, masked: false }], withheldFacts: 0, analysisConflicts: [], structuralBlock: null,
      audit: { evidence: [], rejectedUnits: [] }, analysisUsed: false, slot: "ITEM_1",
      proposedWording: { observed: "Você disse ao cliente que era só aguardar, sem informar o prazo da análise.", whyItMatters: "", whatYouCanDo: "Informe o prazo exibido na ferramenta." }, wordingSource: "WRITER", writerViolations: [],
      decision: { disposition: "READY", structural: "STRUCTURALLY_EMITTABLE", reasons: ["AUTONOMY_CRITERIA_MET"], policyVersion: "P", autonomyEligible: null, autonomyBlockers: [] },
    }],
  } as unknown as ReliableFeedbackArtifactV1
}

describe.skipIf(!ENABLED)("Workflow Outputs V1 — Chat + Avatar: prova Postgres (efeitos de produção, zero modelo)", () => {
  const created = { people: [] as string[], workflows: [] as string[], interactions: [] as string[], enrollments: [] as string[] }
  let teamId: string
  let workflowId: string
  let versionId: string
  let larissa: string
  let other: string
  let conversationA: string

  const CONFIG: OutputNodeConfig = { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP", "CHAT", "AVATAR"], interactionMode: "PROMPT", source: "nodeOutputs.gen" }
  // Recado só de voz (sem Acompanhamento): é o convite que o inbox mostra. Com Acompanhamento no mesmo Output, quem convida
  // é a aplicação de feedback ("um convite só") e o recado sai do inbox.
  const VOICE_ONLY_CONFIG: OutputNodeConfig = { ...CONFIG, surfaces: ["AVATAR"] }

  async function readyEnrollment() {
    const interaction = (await pool.query<{ id: string }>("insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1,$2,'Contestação de conta',now() - interval '5 minutes',now(),$3) returning id", [ORG, larissa, `PROOF-CONV-${Date.now()}-${Math.random()}`])).rows[0]!.id
    created.interactions.push(interaction)
    const enrollment = (await pool.query<{ id: string }>(
      `insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, interaction_id) values ($1,$2,$3,'out','active',$4) returning id`,
      [ORG, workflowId, versionId, interaction],
    )).rows[0]!.id
    created.enrollments.push(enrollment)
    const art = artifact(larissa, interaction)
    const artifactId = (await pool.query<{ id: string }>(
      `insert into reliable_feedback_artifacts (organization_id, artifact_key, enrollment_id, workflow_id, workflow_version_id, node_id, source_node_id, source_type, domain, collaborator_id, interaction_id, contract_version, status, disposition, artifact, created_at, updated_at, completed_at)
       values ($1,$2,$3,$4,$5,'gen','agent','AGENT','MONITORING',$6,$7,'V1','COMPLETED','READY',$8,now(),now(),now()) returning id`,
      [ORG, `WORKFLOW_NODE:${enrollment}:gen:agent`, enrollment, workflowId, versionId, larissa, interaction, JSON.stringify(art)],
    )).rows[0]!.id
    const context = (db: Database) => ({
      db, organizationId: ORG, enrollmentId: enrollment, nodeId: "out", nodeLabel: "Enviar feedback",
      nodeOutputs: { gen: nodeOutputOf(artifactId, art, []) },
      enrollment: { interactionId: interaction, indicatorMeasurementId: null, scheduledSubjectId: null },
      effects: productionEffects,
    })
    return { enrollment, artifactId, context }
  }

  async function voiceOnlyDelivery(): Promise<string> {
    const { context } = await readyEnrollment()
    const result = await executeOutput(VOICE_ONLY_CONFIG, context(pool as unknown as Database))
    const [deliveryId] = result.nodeOutput.avatarDeliveryIds ?? []
    expect(deliveryId).toBeTruthy()
    return deliveryId!
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 6 })
    teamId = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    for (const name of ["Larissa Prova Conversa", "Outra Pessoa Prova"]) {
      created.people.push((await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1,$2,'OPERATOR',$3) returning id", [ORG, name, teamId])).rows[0]!.id)
    }
    ;[larissa, other] = created.people as [string, string]
    const graph = { nodes: [{ id: "out", type: "output", label: "Enviar feedback", position: { x: 0, y: 0 }, config: CONFIG }], edges: [] }
    workflowId = (await pool.query<{ id: string }>(`insert into workflows (organization_id, name, trigger_config) values ($1, 'Proof Conversational WF', '{"kind":"channel_flag"}') returning id`, [ORG])).rows[0]!.id
    created.workflows.push(workflowId)
    versionId = (await pool.query<{ id: string }>("insert into workflow_versions (workflow_id, graph) values ($1,$2) returning id", [workflowId, JSON.stringify(graph)])).rows[0]!.id
    // Conversa A: a Larissa está conversando com a INIA sobre outro assunto.
    const now = new Date()
    const resolved = await resolveConversationForWrite(pool as unknown as Database, { organizationId: ORG, ownerPersonId: larissa }, null, now)
    conversationA = resolved.conversationId
    await appendConversationMessage(pool, { conversationId: conversationA, organizationId: ORG, ownerPersonId: larissa, channel: "chat", role: "user", content: "Como faço troca de titularidade?", occurredAt: now, clientMessageId: "proof-conv-a-1" })
  })

  afterAll(async () => {
    if (!pool) return
    const outputs = (await pool.query<{ id: string }>("select id from workflow_outputs where enrollment_id = any($1::uuid[])", [created.enrollments])).rows.map((row) => row.id)
    const cases = (await pool.query<{ case_id: string }>("select case_id from workflow_output_emissions where enrollment_id = any($1::uuid[]) and case_id is not null", [created.enrollments])).rows.map((row) => row.case_id)
    const feedbacks = (await pool.query<{ id: string }>("select id from feedbacks where case_id = any($1::uuid[])", [cases])).rows.map((row) => row.id)
    await pool.query("delete from audit_logs where entity_id = any($1::uuid[])", [outputs])
    await pool.query("delete from alerts where recipient_id = any($1::uuid[])", [created.people])
    await pool.query("delete from workflow_output_emissions where enrollment_id = any($1::uuid[])", [created.enrollments])
    await pool.query("delete from feedback_support_materials where feedback_id = any($1::uuid[])", [feedbacks]).catch(() => undefined)
    await pool.query("delete from feedbacks where id = any($1::uuid[])", [feedbacks])
    await pool.query("delete from case_timeline_events where case_id = any($1::uuid[])", [cases])
    await pool.query("delete from evidences where case_id = any($1::uuid[])", [cases])
    await pool.query("delete from supervision_cases where id = any($1::uuid[])", [cases])
    await pool.query("delete from workflow_outputs where enrollment_id = any($1::uuid[])", [created.enrollments])
    await pool.query("delete from assistant_interactions where operator_id = any($1::uuid[])", [created.people])
    await pool.query("delete from assistant_conversations where owner_person_id = any($1::uuid[])", [created.people])
    await pool.query("delete from reliable_feedback_artifacts where enrollment_id = any($1::uuid[])", [created.enrollments])
    await pool.query("delete from workflow_enrollments where id = any($1::uuid[])", [created.enrollments])
    await pool.query("delete from interactions where id = any($1::uuid[])", [created.interactions])
    await pool.query("delete from workflow_versions where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflows where id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from people where id = any($1::uuid[])", [created.people])
    await pool.end()
  })

  let avatarId: string
  let conversationB: string

  it("um Output com Acompanhamento + Chat + Avatar: mesmo artefato, conversa NOVA, convite sem fala, conversa atual intacta", async () => {
    const { enrollment, artifactId, context } = await readyEnrollment()
    const result = await executeOutput(CONFIG, context(pool as unknown as Database))
    expect(result.nodeOutput.feedbackId).toBeTruthy()

    const rows = (await pool.query<{ id: string; surface: string; delivery_status: string; delivered_at: Date | null; accepted_at: Date | null; conversation_id: string | null; artifact_id: string; speech_text: string | null; title: string }>(
      "select id, surface, delivery_status, delivered_at, accepted_at, conversation_id, artifact_id, speech_text, title from workflow_outputs where enrollment_id = $1 order by surface", [enrollment],
    )).rows
    expect(rows.map((row) => row.surface)).toEqual(["AVATAR", "CHAT"])
    const [avatar, chat] = rows as [(typeof rows)[number], (typeof rows)[number]]
    // Mesmo artefato nas duas superfícies (e no Acompanhamento, pela emissão).
    expect(avatar.artifact_id).toBe(artifactId)
    expect(chat.artifact_id).toBe(artifactId)
    expect((await pool.query("select 1 from workflow_output_emissions where enrollment_id = $1 and surface = 'FOLLOW_UP' and artifact_id = $2", [enrollment, artifactId])).rowCount).toBe(1)
    // Chat: entregue = conversa + mensagem persistidas.
    expect(chat).toMatchObject({ delivery_status: "DELIVERED", title: "Retorno da monitoria · Contestação de conta" })
    expect(chat.delivered_at).not.toBeNull()
    conversationB = chat.conversation_id!
    const conversation = (await pool.query<{ origin: string; status: string; owner_person_id: string; owner_seen_at: Date | null; title: string }>("select origin, status, owner_person_id, owner_seen_at, title from assistant_conversations where id = $1", [conversationB])).rows[0]!
    expect(conversation).toMatchObject({ origin: "WORKFLOW", status: "ACTIVE", owner_person_id: larissa, owner_seen_at: null })
    const messages = (await pool.query<{ role: string; content: string; client_message_id: string }>("select role, content, client_message_id from assistant_interactions where conversation_id = $1", [conversationB])).rows
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: "assistant", client_message_id: `workflow-output:${chat.id}` })
    expect(messages[0]!.content).toContain("Você disse ao cliente que era só aguardar")
    // Avatar: convite com a fala PRONTA, nada aceito/entregue.
    avatarId = avatar.id
    expect(avatar).toMatchObject({ delivery_status: "PENDING", delivered_at: null, accepted_at: null })
    expect(avatar.speech_text).toMatch(/^Oi, Larissa\. Tenho um retorno sobre/)
    expect(avatar.speech_text).not.toMatch(/[#*[\]]/)
    // Um convite só: o MESMO Output também publicou no Acompanhamento, então quem convida é a aplicação de feedback — o recado
    // de voz continua registrado (e pode ser ouvido pelo id), mas não aparece no inbox nem ganha aviso no sino.
    expect((await loadRecipientInbox(pool, { organizationId: ORG, personId: larissa })).avatarDeliveries.map((delivery) => delivery.id)).not.toContain(avatarId)
    expect((await pool.query("select 1 from alerts where dedupe_key = $1", [`workflow_avatar:${avatarId}`])).rowCount).toBe(0)
    const created = (await pool.query<{ payload: { coveredByFollowUp?: boolean } }>("select payload from audit_logs where entity_id = $1 and action = 'WORKFLOW_AVATAR_DELIVERY_CREATED'", [avatarId])).rows[0]!
    expect(created.payload.coveredByFollowUp).toBe(true)
    // Conversa A intacta e continua sendo a conversa ATUAL da Larissa.
    expect((await pool.query("select 1 from assistant_interactions where conversation_id = $1", [conversationA])).rowCount).toBe(1)
    expect((await loadCurrentConversation(pool as unknown as Database, { organizationId: ORG, ownerPersonId: larissa }, new Date()))?.id).toBe(conversationA)
    // Contexto de origem para a IA vem da entrega (artefato), não da primeira mensagem.
    expect(await loadWorkflowConversationContext(pool, { organizationId: ORG, ownerPersonId: larissa, conversationId: conversationB })).toContain("Contestação de conta")
    expect(await loadWorkflowConversationContext(pool, { organizationId: ORG, ownerPersonId: other, conversationId: conversationB })).toBe("")

    // Reprocessar o MESMO Output: nenhuma conversa, mensagem, convite ou aviso a mais.
    const again = await executeOutput(CONFIG, context(pool as unknown as Database))
    expect(again.nodeOutput).toMatchObject({ conversationIds: [conversationB], avatarDeliveryIds: [avatarId], feedbackId: result.nodeOutput.feedbackId })
    expect((await pool.query("select 1 from assistant_conversations where owner_person_id = $1 and origin = 'WORKFLOW'", [larissa])).rowCount).toBe(1)
    expect((await pool.query("select 1 from workflow_outputs where enrollment_id = $1", [enrollment])).rowCount).toBe(2)
    // Só o aviso da conversa: o recado coberto pelo Acompanhamento não tem aviso próprio.
    expect((await pool.query<{ alert_type: string }>("select alert_type from alerts where recipient_id = $1 and alert_type in ('WORKFLOW_CHAT_MESSAGE', 'WORKFLOW_AVATAR_MESSAGE')", [larissa])).rows.map((row) => row.alert_type)).toEqual(["WORKFLOW_CHAT_MESSAGE"])
  })

  it("concorrência: dois processamentos simultâneos do mesmo Output criam UMA conversa e UM convite", async () => {
    const { enrollment, context } = await readyEnrollment()
    await Promise.all([executeOutput(CONFIG, context(pool as unknown as Database)), executeOutput(CONFIG, context(pool as unknown as Database))])
    expect((await pool.query("select surface from workflow_outputs where enrollment_id = $1", [enrollment])).rowCount).toBe(2)
    expect((await pool.query("select 1 from assistant_conversations c join workflow_outputs o on o.conversation_id = c.id where o.enrollment_id = $1", [enrollment])).rowCount).toBe(1)
    expect((await pool.query("select 1 from assistant_interactions i join workflow_outputs o on o.conversation_id = i.conversation_id where o.enrollment_id = $1", [enrollment])).rowCount).toBe(1)
  })

  it("sino: aviso de conversa e de recado apontam para o lugar certo; recado coberto pelo Acompanhamento nunca aparece (um convite só)", async () => {
    const pooled = pool as unknown as Database
    const scope = { organizationId: ORG, personId: larissa }
    const notifications = new PgNotificationsRepository(pooled)
    const bell = () => buildNotificationSummary(notifications, new PgPendingActionsRepository(pooled), { personId: larissa, organizationId: ORG })
    const avatarTargets = async () => (await bell()).items.flatMap((item) => (item.target.type === "INIA_AVATAR_DELIVERY" ? [item.target.deliveryId] : []))
    const inboxIds = async () => (await loadRecipientInbox(pool, scope)).avatarDeliveries.map((delivery) => delivery.id)

    // Recado só de voz: é convite do inbox e tem aviso no sino apontando para ele.
    const voiceOnly = await voiceOnlyDelivery()
    expect(await inboxIds()).toContain(voiceOnly)
    expect(await avatarTargets()).toEqual([voiceOnly])
    const inia = (await bell()).items.filter((item) => item.kind === "INIA_MESSAGE")
    expect(inia.filter((item) => item.target.type === "INIA_CONVERSATION")).toHaveLength(2)
    expect(inia.some((item) => item.target.type === "INIA_CONVERSATION" && item.target.conversationId === conversationB)).toBe(true)

    // Superfícies em outra ordem (Avatar antes do Acompanhamento): o aviso nasce antes da publicação, mas o sino lê pela mesma
    // regra do inbox — não lista, não conta.
    const unreadBefore = await notifications.countUnread(larissa, ORG)
    const avatarFirst = await readyEnrollment()
    const avatarFirstResult = await executeOutput({ ...CONFIG, surfaces: ["AVATAR", "FOLLOW_UP"] }, avatarFirst.context(pooled))
    const [avatarFirstId] = avatarFirstResult.nodeOutput.avatarDeliveryIds ?? []
    expect(avatarFirstResult.nodeOutput.feedbackId).toBeTruthy()
    expect((await pool.query("select 1 from alerts where dedupe_key = $1", [`workflow_avatar:${avatarFirstId}`])).rowCount).toBe(1)
    expect(await inboxIds()).not.toContain(avatarFirstId)
    expect(await avatarTargets()).toEqual([voiceOnly])
    expect(await notifications.countUnread(larissa, ORG)).toBe(unreadBefore)

    // Outro nó Output publica o MESMO artefato no Acompanhamento DEPOIS do recado: o recado sai do inbox e o aviso sai do sino
    // na mesma leitura (inclusive do feed da estrutura, que lista os avisos do próprio leitor).
    const laterCovered = await readyEnrollment()
    const [laterId] = (await executeOutput({ ...CONFIG, surfaces: ["AVATAR"] }, laterCovered.context(pooled))).nodeOutput.avatarDeliveryIds ?? []
    expect(await inboxIds()).toContain(laterId)
    expect((await avatarTargets()).sort()).toEqual([voiceOnly, laterId].sort())
    expect(await notifications.countUnread(larissa, ORG)).toBe(unreadBefore + 1)
    const feedAlerts = async () => (await new PgAnalyticsReadRepository(pooled).loadFollowUpFeed({ organizationId: ORG, viewerId: larissa, operatorIds: [], includeViewerAlerts: true, unacknowledgedOnly: false, limit: 50, before: null })).items.map((item) => item.id)
    const laterAlertId = (await pool.query<{ id: string }>("select id from alerts where dedupe_key = $1", [`workflow_avatar:${laterId}`])).rows[0]!.id
    expect(await feedAlerts()).toContain(laterAlertId)
    const published = await executeOutput({ ...CONFIG, surfaces: ["FOLLOW_UP"] }, { ...laterCovered.context(pooled), nodeId: "out-follow-up" })
    expect(published.nodeOutput.feedbackId).toBeTruthy()
    expect(await inboxIds()).not.toContain(laterId)
    expect(await avatarTargets()).toEqual([voiceOnly])
    expect(await notifications.countUnread(larissa, ORG)).toBe(unreadBefore)
    expect(await feedAlerts()).not.toContain(laterAlertId)

    // Invariante: todo aviso de recado ainda aberto no sino aponta para um convite que o inbox mostra.
    const open = (await bell()).items.filter((item) => item.target.type === "INIA_AVATAR_DELIVERY" && !item.resolved)
    const inbox = await inboxIds()
    expect(open.every((item) => item.target.type === "INIA_AVATAR_DELIVERY" && inbox.includes(item.target.deliveryId))).toBe(true)
  })

  it("voz: aceitar ≠ entregar; falha e interrupção nunca entregam; só a fala concluída entrega (e resolve o aviso)", async () => {
    const pooled = pool as unknown as Database
    const scope = { organizationId: ORG, personId: larissa }
    const voiceId = await voiceOnlyDelivery()
    const inbox = await loadRecipientInbox(pool, scope)
    expect(inbox.avatarDeliveries.map((delivery) => delivery.id)).toContain(voiceId)
    expect(inbox.avatarDeliveries.map((delivery) => delivery.id)).not.toContain(avatarId)
    expect(inbox.unreadConversations.map((conversation) => conversation.id)).toContain(conversationB)
    // Outra pessoa não enxerga nem mexe no recado da Larissa.
    await expect(applyAvatarDeliveryEvent(pooled, { organizationId: ORG, personId: other }, voiceId, "ACCEPT", { now: new Date() })).rejects.toMatchObject({ code: "AVATAR_DELIVERY_NOT_FOUND" })
    expect((await applyAvatarDeliveryEvent(pooled, scope, voiceId, "OFFER", { now: new Date() })).status).toBe("OFFERED")
    await expect(applyAvatarDeliveryEvent(pooled, scope, voiceId, "PLAYBACK_COMPLETED", { now: new Date() })).rejects.toMatchObject({ code: "AVATAR_DELIVERY_NOT_PLAYING" })
    const accepted = await applyAvatarDeliveryEvent(pooled, scope, voiceId, "ACCEPT", { now: new Date() })
    expect(accepted).toMatchObject({ status: "ACCEPTED", deliveredAt: null, attemptCount: 1 })
    expect(accepted.acceptedAt).not.toBeNull()
    expect((await applyAvatarDeliveryEvent(pooled, scope, voiceId, "PLAYBACK_STARTED", { now: new Date() })).status).toBe("PLAYING")
    const failed = await applyAvatarDeliveryEvent(pooled, scope, voiceId, "PLAYBACK_FAILED", { now: new Date(), failureReason: "SPEECH_ERROR" })
    expect(failed).toMatchObject({ status: "FAILED", deliveredAt: null, failureReason: "SPEECH_ERROR" })
    await applyAvatarDeliveryEvent(pooled, scope, voiceId, "ACCEPT", { now: new Date() })
    await applyAvatarDeliveryEvent(pooled, scope, voiceId, "PLAYBACK_STARTED", { now: new Date() })
    expect((await applyAvatarDeliveryEvent(pooled, scope, voiceId, "PLAYBACK_INTERRUPTED", { now: new Date() })).status).toBe("INTERRUPTED")
    await applyAvatarDeliveryEvent(pooled, scope, voiceId, "ACCEPT", { now: new Date() })
    await applyAvatarDeliveryEvent(pooled, scope, voiceId, "PLAYBACK_STARTED", { now: new Date() })
    const delivered = await applyAvatarDeliveryEvent(pooled, scope, voiceId, "PLAYBACK_COMPLETED", { now: new Date() })
    expect(delivered).toMatchObject({ status: "DELIVERED", attemptCount: 3 })
    expect(delivered.deliveredAt).not.toBeNull()
    expect((await pool.query<{ status: string }>("select status::text from alerts where dedupe_key = $1", [`workflow_avatar:${voiceId}`])).rows[0]!.status).toBe("RESOLVED")
    expect((await loadRecipientInbox(pool, scope)).avatarDeliveries.map((delivery) => delivery.id)).not.toContain(voiceId)
    await expect(applyAvatarDeliveryEvent(pooled, scope, voiceId, "ACCEPT", { now: new Date() })).rejects.toMatchObject({ code: "AVATAR_DELIVERY_ALREADY_DELIVERED" })
    // Auditoria sem o conteúdo do recado.
    const audit = (await pool.query<{ action: string; payload: Record<string, unknown> }>("select action, payload from audit_logs where entity_id = $1 order by created_at", [voiceId])).rows
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(["WORKFLOW_AVATAR_DELIVERY_CREATED", "WORKFLOW_AVATAR_DELIVERY_ACCEPTED", "WORKFLOW_AVATAR_DELIVERY_PLAY_STARTED", "WORKFLOW_AVATAR_DELIVERY_FAILED", "WORKFLOW_AVATAR_DELIVERY_INTERRUPTED", "WORKFLOW_AVATAR_DELIVERY_DELIVERED"]))
    expect(JSON.stringify(audit)).not.toContain("Larissa")
  })

  it("voz do Gemini: o texto EXATO do recado é sintetizado UMA vez e reaproveitado; só o destinatário ouve", async () => {
    const pending = (await pool.query<{ id: string; speech_text: string }>("select id, speech_text from workflow_outputs where surface = 'AVATAR' and recipient_id = $1 and delivery_status <> 'DELIVERED' limit 1", [larissa])).rows[0]!
    const synthesize = vi.fn(async (request: { text: string }) => ({ pcm16: Buffer.alloc(48_000), sampleRate: 24_000, model: "tts-test", voice: "Puck", usage: null, text: request.text }))
    const expected = { voice: "Puck", models: ["tts-test"] }
    const scope = { organizationId: ORG, personId: larissa }
    const [first, concurrent] = await Promise.all([loadRecadoSpeechAudio(pool, scope, pending.id, synthesize, expected), loadRecadoSpeechAudio(pool, scope, pending.id, synthesize, expected)])
    expect(synthesize).toHaveBeenCalledTimes(1)
    expect(synthesize.mock.calls[0]![0]).toEqual({ text: pending.speech_text })
    expect(first).toMatchObject({ sampleRate: 24_000, durationMs: 1000, cached: false })
    expect(concurrent.durationMs).toBe(1000)
    const again = await loadRecadoSpeechAudio(pool, scope, pending.id, synthesize, expected)
    expect(again).toMatchObject({ cached: true, durationMs: 1000 })
    expect(again.pcm16.length).toBe(48_000)
    expect(synthesize).toHaveBeenCalledTimes(1)
    // Outra voz configurada = áudio novo (nunca a voz antiga servida como se fosse a atual).
    await loadRecadoSpeechAudio(pool, scope, pending.id, async () => ({ pcm16: Buffer.alloc(24_000), sampleRate: 24_000, model: "tts-test", voice: "Kore" }), { voice: "Kore", models: ["tts-test"] })
    expect((await pool.query<{ voice_name: string }>("select voice_name from workflow_output_speech_audio where output_id = $1", [pending.id])).rows[0]!.voice_name).toBe("Kore")
    // Nada da entrega muda por preparar a voz.
    expect((await pool.query<{ delivery_status: string }>("select delivery_status from workflow_outputs where id = $1", [pending.id])).rows[0]!.delivery_status).not.toBe("DELIVERED")
    await expect(loadRecadoSpeechAudio(pool, { organizationId: ORG, personId: other }, pending.id, synthesize, expected)).rejects.toMatchObject({ code: "AVATAR_DELIVERY_NOT_FOUND" })
  })

  it("banco garante: voz nunca vira DELIVERED sem aceite e sem ter começado a tocar", async () => {
    const pending = await voiceOnlyDelivery()
    await expect(pool.query("update workflow_outputs set delivery_status = 'DELIVERED', delivered_at = now() where id = $1", [pending])).rejects.toThrow(/workflow_outputs_avatar_delivered_after_play/)
    // "Depois" mantém o recado disponível, sem entregar.
    const snoozed = await applyAvatarDeliveryEvent(pool as unknown as Database, { organizationId: ORG, personId: larissa }, pending, "SNOOZE", { now: new Date() })
    expect(snoozed).toMatchObject({ status: "SNOOZED", deliveredAt: null })
    expect((await loadRecipientInbox(pool, { organizationId: ORG, personId: larissa })).avatarDeliveries.map((delivery) => delivery.id)).toContain(pending)
  })

  it("abrir a conversa de Workflow: deixa de ser nova e o aviso fica lido (só para o dono)", async () => {
    expect(await markWorkflowConversationSeen(pool, { organizationId: ORG, personId: other }, conversationB, new Date())).toEqual({ seen: false })
    expect(await markWorkflowConversationSeen(pool, { organizationId: ORG, personId: larissa }, conversationB, new Date())).toEqual({ seen: true })
    const chatOutput = (await pool.query<{ id: string }>("select id from workflow_outputs where conversation_id = $1", [conversationB])).rows[0]!.id
    expect((await pool.query<{ read_at: Date | null }>("select read_at from alerts where dedupe_key = $1", [`workflow_chat:${chatOutput}`])).rows[0]!.read_at).not.toBeNull()
    expect((await loadRecipientInbox(pool, { organizationId: ORG, personId: larissa })).unreadConversations.map((conversation) => conversation.id)).not.toContain(conversationB)
  })
})
