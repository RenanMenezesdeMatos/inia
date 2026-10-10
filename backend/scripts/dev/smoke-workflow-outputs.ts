/**
 * SMOKE REAL — Workflow Outputs V1 (Chat + Avatar), ZERO chamada de modelo.
 *
 * Monta um Workflow de smoke (sem versão ativa: nenhum gatilho o dispara) cujo nó Output entrega em CHAT + AVATAR um artefato
 * confiável REAL e READY já existente no banco (o feedback de uma colaboradora de smoke). A matrícula nasce parada no nó Output
 * com o Execution Context do nó "Gerar feedback" (a mesma saída que ele grava) e é processada pelo MOTOR do servidor em
 * execução (runWorkflowTick) — os nós de IA a montante não rodam de novo (sem custo).
 *
 *   npx tsx scripts/dev/smoke-workflow-outputs.ts check <artifactId>     (só lê: o artefato passa nas defesas da emissão?)
 *   npx tsx scripts/dev/smoke-workflow-outputs.ts setup <artifactId>
 *   npx tsx scripts/dev/smoke-workflow-outputs.ts report <enrollmentId>
 *   npx tsx scripts/dev/smoke-workflow-outputs.ts reprocess <enrollmentId>   (mesmo Output de novo → nada duplicado)
 *   npx tsx scripts/dev/smoke-workflow-outputs.ts cleanup <enrollmentId>
 *
 * Recusa NODE_ENV=production.
 */
import pg from "pg"
import { env } from "../../src/config/env.js"
import type { Database } from "../../src/infrastructure/database/pool.js"
import { createPostgresReliableFeedbackStore } from "../../src/modules/reliable-feedback/infrastructure/postgres-reliable-feedback-store.js"
import { nodeOutputOf } from "../../src/modules/reliable-feedback/domain/reliable-feedback-artifact.js"
import { reliableProjectionSourceFrom } from "../../src/modules/conversational-delivery/application/conversational-effects.js"

if (process.env.NODE_ENV === "production") throw new Error("Smoke recusado em produção.")
const [mode, id] = process.argv.slice(2)
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 })
const db = pool as unknown as Database
const WORKFLOW_NAME = "SMOKE · Workflow Outputs V1 (Chat + Avatar)"

async function setup(artifactId: string) {
  const record = (await pool.query<{ organization_id: string; collaborator_id: string }>("select organization_id, collaborator_id from reliable_feedback_artifacts where id = $1", [artifactId])).rows[0]
  if (!record) throw new Error("Artefato não encontrado.")
  const store = createPostgresReliableFeedbackStore(db)
  const artifact = await store.get(record.organization_id, artifactId)
  if (!artifact?.artifact) throw new Error("Artefato sem conteúdo.")
  const reviews = (await store.listReviews(record.organization_id, artifactId)).map((review) => ({ itemIndex: review.itemIndex, status: review.reviewStatus, finalWording: review.finalWording }))
  const output = nodeOutputOf(artifactId, artifact.artifact, reviews)
  if (output.disposition !== "READY") throw new Error(`Artefato não está READY (${output.disposition}).`)
  const graph = {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "out", type: "output", label: "Recado da INIA (smoke)", position: { x: 0, y: 160 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["CHAT", "AVATAR"], interactionMode: "PROMPT", source: "nodeOutputs.gen" } },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 320 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "out" },
      { id: "e2", source: "out", sourceHandle: "always", target: "end" },
    ],
  }
  const workflowId = (await pool.query<{ id: string }>(`insert into workflows (organization_id, name, trigger_config) values ($1, $2, '{"kind":"schedule"}') returning id`, [record.organization_id, WORKFLOW_NAME])).rows[0]!.id
  const versionId = (await pool.query<{ id: string }>("insert into workflow_versions (workflow_id, graph) values ($1, $2) returning id", [workflowId, JSON.stringify(graph)])).rows[0]!.id
  const enrollmentId = (await pool.query<{ id: string }>(
    `insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, scheduled_subject_id, node_outputs, next_eval_at)
     values ($1, $2, $3, 'out', 'active', $4, $5, now()) returning id`,
    [record.organization_id, workflowId, versionId, record.collaborator_id, JSON.stringify({ gen: output })],
  )).rows[0]!.id
  console.log(JSON.stringify({ workflowId, versionId, enrollmentId, collaboratorId: record.collaborator_id, artifactId }, null, 2))
}

async function check(artifactId: string) {
  const row = (await pool.query<{ organization_id: string; collaborator_id: string }>("select organization_id, collaborator_id from reliable_feedback_artifacts where id = $1", [artifactId])).rows[0]
  if (!row) throw new Error("Artefato não encontrado.")
  try {
    const source = await reliableProjectionSourceFrom(createPostgresReliableFeedbackStore(db), { organizationId: row.organization_id, recipientId: row.collaborator_id, artifactId })
    console.log(JSON.stringify({ artifactId, ok: true, sourceKind: source.kind }))
  } catch (error) {
    console.log(JSON.stringify({ artifactId, ok: false, reason: (error as Error).message }))
  }
}

async function report(enrollmentId: string) {
  const enrollment = (await pool.query("select status, current_node_id, attempts, node_outputs -> 'out' out from workflow_enrollments where id = $1", [enrollmentId])).rows[0]
  const events = (await pool.query("select event_type, node_id, payload ->> 'message' message, created_at from workflow_enrollment_events where enrollment_id = $1 order by created_at", [enrollmentId])).rows
  const outputs = (await pool.query(
    `select id, surface, recipient_id, delivery_status, artifact_id, conversation_id, title, interaction_mode, offered_at, accepted_at, playing_at, delivered_at, attempt_count, speech_text, created_at
       from workflow_outputs where enrollment_id = $1 order by surface`,
    [enrollmentId],
  )).rows
  const conversationIds = outputs.flatMap((row) => (row.conversation_id ? [row.conversation_id as string] : []))
  const conversations = (await pool.query("select id, owner_person_id, origin, status, title, owner_seen_at, started_at from assistant_conversations where id = any($1::uuid[])", [conversationIds])).rows
  const messages = (await pool.query("select conversation_id, role, channel, client_message_id, left(content, 400) content from assistant_interactions where conversation_id = any($1::uuid[]) order by occurred_at, seq", [conversationIds])).rows
  const alerts = (await pool.query("select alert_type, title, description, status::text, read_at, dedupe_key from alerts where dedupe_key = any($1::text[])", [outputs.map((row) => (row.surface === "CHAT" ? `workflow_chat:${row.id}` : `workflow_avatar:${row.id}`))])).rows
  const audit = (await pool.query("select action, payload, created_at from audit_logs where entity_id = any($1::uuid[]) order by created_at", [outputs.map((row) => row.id)])).rows
  const userConversations = outputs[0] ? (await pool.query("select origin, status, count(*)::int n from assistant_conversations where owner_person_id = $1 group by 1, 2 order by 1, 2", [outputs[0].recipient_id])).rows : []
  console.log(JSON.stringify({ enrollment, events, outputs, conversations, messages, alerts, audit, userConversations }, null, 2))
}

async function reprocess(enrollmentId: string) {
  await pool.query("update workflow_enrollments set current_node_id = 'out', status = 'active', next_eval_at = now(), claimed_until = null, revision = revision + 1, updated_at = now() where id = $1", [enrollmentId])
  console.log("Matrícula devolvida ao nó Output — o motor do servidor processa no próximo tick.")
}

async function cleanup(enrollmentId: string) {
  const enrollment = (await pool.query<{ workflow_id: string }>("select workflow_id from workflow_enrollments where id = $1", [enrollmentId])).rows[0]
  if (!enrollment) return console.log("Nada a limpar.")
  const workflow = (await pool.query<{ name: string }>("select name from workflows where id = $1", [enrollment.workflow_id])).rows[0]
  if (workflow?.name !== WORKFLOW_NAME) throw new Error("Recusado: a matrícula não é do Workflow de smoke.")
  const outputs = (await pool.query<{ id: string; conversation_id: string | null }>("select id, conversation_id from workflow_outputs where enrollment_id = $1", [enrollmentId])).rows
  const conversationIds = outputs.flatMap((row) => (row.conversation_id ? [row.conversation_id] : []))
  await pool.query("delete from alerts where dedupe_key = any($1::text[])", [outputs.flatMap((row) => [`workflow_chat:${row.id}`, `workflow_avatar:${row.id}`])])
  await pool.query("delete from audit_logs where entity_id = any($1::uuid[])", [outputs.map((row) => row.id)])
  await pool.query("delete from workflow_outputs where enrollment_id = $1", [enrollmentId])
  await pool.query("delete from assistant_support_materials where interaction_id in (select id from assistant_interactions where conversation_id = any($1::uuid[]))", [conversationIds]).catch(() => undefined)
  await pool.query("delete from assistant_interactions where conversation_id = any($1::uuid[])", [conversationIds])
  await pool.query("delete from assistant_conversations where id = any($1::uuid[])", [conversationIds])
  await pool.query("delete from workflow_enrollment_events where enrollment_id = $1", [enrollmentId])
  await pool.query("delete from workflow_enrollments where id = $1", [enrollmentId])
  await pool.query("delete from workflow_versions where workflow_id = $1", [enrollment.workflow_id])
  await pool.query("delete from workflows where id = $1", [enrollment.workflow_id])
  console.log("Smoke removido (workflow, matrícula, entregas, conversa, avisos e auditoria).")
}

try {
  if (!id) throw new Error("Informe o id.")
  if (mode === "check") await check(id)
  else if (mode === "setup") await setup(id)
  else if (mode === "report") await report(id)
  else if (mode === "reprocess") await reprocess(id)
  else if (mode === "cleanup") await cleanup(id)
  else throw new Error("Modo: setup | report | reprocess | cleanup")
} finally {
  await pool.end()
}
