/**
 * PROVA contra o banco de TESTE real (migration 132): as consultas do sino e das Pendências.
 *  - recado de Chat liga ao aviso pelo id da entrega extraído da chave (não por concatenação) e abre a conversa certa;
 *  - não lidas = sem leitura e vivas; contagem de pendentes = execução esperando no nó COM aviso vivo (aviso resolvido não conta,
 *    mesmo com a execução ainda parada no nó);
 *  - a lista de revisões nunca carrega o Execution Context — só o que foi gravado no nó de revisão; o detalhe carrega;
 *  - o sino resolve a situação só dos avisos que mostra.
 * Dados commitados e apagados no fim, pelos ids criados.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run bell-queries-proof
 */
import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { PgPendingActionsRepository } from "../../pending-actions/application/pending-actions-repository.js"
import { buildNotificationSummary } from "../application/build-notification-summary.js"
import { PgNotificationsRepository } from "../application/notifications-repository.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
const created = { people: [] as string[], workflows: [] as string[], enrollments: [] as string[], conversations: [] as string[], outputs: [] as string[], alerts: [] as string[] }

describe.skipIf(!ENABLED)("Sino e Pendências — prova Postgres (migration 132)", () => {
  beforeAll(() => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 4 }) })
  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from alerts where id = any($1::uuid[])", [created.alerts])
    await pool.query("delete from workflow_outputs where id = any($1::uuid[])", [created.outputs])
    await pool.query("delete from assistant_conversations where id = any($1::uuid[])", [created.conversations])
    await pool.query("delete from workflow_enrollments where id = any($1::uuid[])", [created.enrollments])
    await pool.query("delete from workflow_versions where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflows where id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from people where id = any($1::uuid[])", [created.people])
    await pool.end()
  })

  it("sino, não lidas, pendentes e revisões: só o necessário, com a mesma definição de pendente", async () => {
    const team = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const person = async (name: string, role: string) => { const id = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, $2, $3, $4) returning id", [ORG, name, role, team])).rows[0]!.id; created.people.push(id); return id }
    const reviewer = await person("Proof Sino Gestora", "SUPERVISOR")
    const operator = await person("Proof Sino Operadora", "OPERATOR")
    const workflowId = (await pool.query<{ id: string }>(`insert into workflows (organization_id, name, trigger_config) values ($1, 'Proof Sino WF', '{"kind":"channel_flag"}') returning id`, [ORG])).rows[0]!.id
    created.workflows.push(workflowId)
    const versionId = (await pool.query<{ id: string }>("insert into workflow_versions (workflow_id, graph) values ($1, $2) returning id", [workflowId, JSON.stringify({ nodes: [], edges: [] })])).rows[0]!.id
    const enrollment = async (status: string, node: string, outputs: Record<string, unknown>) => {
      const id = (await pool.query<{ id: string }>(
        `insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, node_outputs, scheduled_subject_id, scheduled_for) values ($1, $2, $3, $4, $5, $6, $7, now() - random() * interval '1 day') returning id`,
        [ORG, workflowId, versionId, node, status, JSON.stringify(outputs), operator],
      )).rows[0]!.id
      created.enrollments.push(id)
      return id
    }
    const context = { agent: { text: "x".repeat(20_000) } }
    const waiting = await enrollment("waiting", "review", context)
    const resolvedButWaiting = await enrollment("waiting", "review", context)
    const decided = await enrollment("active", "end", { ...context, review: { decision: "approved", reviewerId: reviewer, decidedAt: "2026-10-13T12:00:00.000Z" } })
    const chatRun = await enrollment("completed", "end", {})
    const conversation = (await pool.query<{ id: string }>("insert into assistant_conversations (organization_id, owner_person_id, kind, status, started_at, last_activity_at, origin) values ($1, $2, 'CONVERSATION', 'ACTIVE', now(), now(), 'WORKFLOW') returning id", [ORG, reviewer])).rows[0]!.id
    created.conversations.push(conversation)
    const output = (await pool.query<{ id: string }>("insert into workflow_outputs (organization_id, enrollment_id, node_id, recipient_id, surface, conversation_id) values ($1, $2, 'out', $3, 'CHAT', $4) returning id", [ORG, chatRun, reviewer, conversation])).rows[0]!.id
    created.outputs.push(output)

    const alert = async (type: string, dedupeKey: string, minutesAgo: number, options: { status?: string; read?: boolean } = {}) => {
      const id = (await pool.query<{ id: string }>(
        `insert into alerts (organization_id, recipient_id, title, description, severity, alert_type, dedupe_key, status, read_at, created_at)
         values ($1, $2, $3, 'Proof', 'HIGH', $3, $4, $5::alert_status, case when $6 then now() end, now() - $7 * interval '1 minute') returning id`,
        [ORG, reviewer, type, dedupeKey, options.status ?? "OPEN", options.read ?? false, minutesAgo],
      )).rows[0]!.id
      created.alerts.push(id)
      return id
    }
    const pendingAlert = await alert("WORKFLOW_HUMAN_REVIEW", `workflow_human_review:${waiting}:review`, 1)
    const resolvedAlert = await alert("WORKFLOW_HUMAN_REVIEW", `workflow_human_review:${resolvedButWaiting}:review`, 2, { status: "RESOLVED", read: true })
    const decidedAlert = await alert("WORKFLOW_HUMAN_REVIEW", `workflow_human_review:${decided}:review`, 3)
    const chatAlert = await alert("WORKFLOW_CHAT_MESSAGE", `workflow_chat:${output}`, 4)
    const readOutput = await alert("WORKFLOW_OUTPUT", `workflow_output:${randomUUID()}`, 5, { status: "SEEN", read: true })

    const notifications = new PgNotificationsRepository(pool)
    const pendingActions = new PgPendingActionsRepository(pool)

    const recent = await notifications.loadRecentAlerts(reviewer, ORG, 20)
    expect(recent.map((row) => row.id)).toEqual([pendingAlert, resolvedAlert, decidedAlert, chatAlert, readOutput])
    expect(recent.find((row) => row.id === chatAlert)?.conversationId).toBe(conversation)
    expect(recent.filter((row) => row.id !== chatAlert).every((row) => row.conversationId === null)).toBe(true)

    // Não lidas: sem leitura E vivas (o resolvido já lido não conta; o lido não conta).
    expect(await notifications.countUnread(reviewer, ORG)).toBe(3)
    // Pendente: execução em `waiting` no nó COM aviso vivo — o aviso resolvido não conta, mesmo com a execução parada no nó.
    expect(await pendingActions.countPending(reviewer, ORG)).toBe(1)
    expect((await pendingActions.countPendingByOperator(reviewer, ORG, [operator])).get(operator)).toBe(1)

    // Lista: da execução, só o nó de revisão — nunca o Execution Context.
    const listed = await pendingActions.loadReviewAlerts(reviewer, ORG)
    expect(listed.map((row) => row.alertId).sort()).toEqual([pendingAlert, resolvedAlert, decidedAlert].sort())
    expect(listed.every((row) => row.enrollment !== null && !("nodeOutputs" in row.enrollment))).toBe(true)
    expect(listed.find((row) => row.alertId === decidedAlert)?.enrollment?.reviewOutput).toMatchObject({ decision: "approved", reviewerId: reviewer })
    expect(listed.find((row) => row.alertId === pendingAlert)?.enrollment?.reviewOutput).toBeNull()
    // Só os avisos pedidos.
    expect((await pendingActions.loadReviewAlerts(reviewer, ORG, { alertIds: [decidedAlert] })).map((row) => row.alertId)).toEqual([decidedAlert])
    expect(await pendingActions.loadReviewAlerts(reviewer, ORG, { alertIds: [] })).toEqual([])
    // Detalhe: o Execution Context inteiro.
    const detail = await pendingActions.loadReviewAlert(reviewer, ORG, waiting, "review")
    expect((detail?.enrollment?.nodeOutputs.agent as { text: string }).text).toHaveLength(20_000)

    // O sino montado sobre as consultas reais.
    const summary = await buildNotificationSummary(notifications, pendingActions, { personId: reviewer, organizationId: ORG })
    expect(summary).toMatchObject({ unreadCount: 3, pendingActionCount: 1 })
    const byId = new Map(summary.items.map((item) => [item.id, item]))
    expect(byId.get(pendingAlert)).toMatchObject({ actionable: true, description: "Aguardando sua decisão." })
    expect(byId.get(decidedAlert)).toMatchObject({ actionable: false, description: "Revisão já decidida." })
    // Lista e contagem dizem a mesma coisa sobre o aviso resolvido.
    expect(byId.get(resolvedAlert)).toMatchObject({ actionable: false, description: "Esta revisão não está mais disponível." })
    expect(byId.get(chatAlert)).toMatchObject({ target: { type: "INIA_CONVERSATION", conversationId: conversation } })
  })
})
