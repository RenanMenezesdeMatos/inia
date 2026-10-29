/**
 * PROVA contra o banco de TESTE real: recado de Workflow (Chat) no monitoramento de conversas (achado C01 da 4ª auditoria).
 * A entrega é a de produção (`executeOutput` → `deliverChatConversation`); quem lê é o leitor de conversas com escopo de Grupo.
 * Ler a conversa de um gestor não amplia o acesso: recado sobre colaborador fora do alcance do leitor sai sem o texto (lista e
 * mensagens, inclusive as respostas seguintes); o recado do próprio dono e o leitor da organização inteira veem tudo.
 * Tudo numa transação desfeita no fim (banco intacto). Nenhuma chamada de modelo.
 *   INIA_DB_PROOF=1 npx vitest run workflow-recado-monitoring-proof
 */
import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { productionEffects } from "../../workflows/application/effect-sink.js"
import { executeOutput } from "../../workflows/application/output-executor.js"
import type { OutputNodeConfig } from "../../workflows/domain/output-schema.js"
import { listMonitoredConversations, loadMonitoredMessages, MONITORING_DATA_PREVIEW, OUT_OF_READER_SCOPE_RECADO_NOTICE } from "../application/conversation-monitoring.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Recado de Workflow no monitoramento — prova Postgres", () => {
  beforeAll(async () => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL }); client = await pool.connect(); await client.query("begin") })
  afterAll(async () => { if (client) { await client.query("rollback"); client.release() } if (pool) await pool.end() })

  it("recado sobre colaborador fora do alcance do leitor sai sem texto; o do próprio dono e o da organização inteira, completos", async () => {
    const one = async (sql: string, params: unknown[]) => (await client.query<{ id: string }>(sql, params)).rows[0]!.id
    const tag = randomUUID().slice(0, 8)
    const org = await one("insert into organizations (name, slug) values ($1, $2) returning id", [`Proof Recado ${tag}`, `proof-recado-${tag}`])
    const operation = await one("insert into operations (organization_id, name) values ($1, 'Proof Recado') returning id", [org])
    const teamA = await one("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Recado A') returning id", [org, operation])
    const teamB = await one("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Recado B') returning id", [org, operation])
    const person = (name: string, role: string, teamId: string, reportsTo: string | null) =>
      one("insert into people (organization_id, name, role, job_title, team_id, reports_to_id) values ($1, $2, $3, $3, $4, $5) returning id", [org, name, role, teamId, reportsTo])
    const manager = await person("Proof Recado Marta", "MANAGER", teamA, null)
    const supervisorB = await person("Proof Recado Sara", "SUPERVISOR", teamB, manager)
    const bruno = await person("Proof Recado Bruno", "OPERATOR", teamB, supervisorB)
    const larissa = await person("Proof Recado Larissa", "OPERATOR", teamA, manager)
    const reader = async (name: string, scope: { type: string; teamId: string | null }) => {
      const id = await person(name, "OPERATOR", teamA, null)
      const account = await one("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, 'x') returning id", [org, id, `${name.toLowerCase().replaceAll(" ", "-")}-${tag}@proof.inia.local`])
      await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, 'LEITOR_DE_CONVERSAS_INIA', $3, $4, now())", [org, account, scope.type, scope.teamId])
      return { organizationId: org, personId: id }
    }
    const readerA = await reader("Proof Recado Leitora A", { type: "GROUP", teamId: teamA })
    const readerOrg = await reader("Proof Recado Leitora Org", { type: "ORGANIZATION", teamId: null })

    // Recado de uma análise de chamada, entregue no Chat pelo caminho de produção.
    const workflowId = await one(`insert into workflows (organization_id, name, trigger_config) values ($1, 'Proof Recado WF', '{"kind":"channel_flag"}') returning id`, [org])
    const deliver = async (operatorId: string, target: OutputNodeConfig["target"], text: string) => {
      const config: OutputNodeConfig = { target, surfaces: ["CHAT"], interactionMode: "PASSIVE", source: "nodeOutputs.analysis" }
      const versionId = await one("insert into workflow_versions (workflow_id, graph) values ($1, $2) returning id", [workflowId, JSON.stringify({ nodes: [{ id: "out", type: "output", label: "Análise da chamada", position: { x: 0, y: 0 }, config }], edges: [] })])
      const interaction = await one("insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1, $2, 'Contestação', now() - interval '5 minutes', now(), $3) returning id", [org, operatorId, `PROOF-RECADO-${randomUUID()}`])
      const enrollment = await one("insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, interaction_id) values ($1, $2, $3, 'out', 'active', $4) returning id", [org, workflowId, versionId, interaction])
      const analysis = { kind: "FEEDBACK_ENGINE_CALL_ANALYSIS", analysisRunId: randomUUID(), callAssessmentId: null, interactionId: interaction, personId: operatorId, agentId: null, outcome: "ANALYZED", reused: false, summary: { procedure: null, pathAssessment: "PARTIAL", met: 2, notMet: 3, partial: 0, notObservable: 0, coverage: "COMPLETE" }, text }
      const executed = await executeOutput(config, { db: client as never, organizationId: org, enrollmentId: enrollment, nodeId: "out", nodeLabel: "Análise da chamada", nodeOutputs: { analysis }, enrollment: { interactionId: interaction, indicatorMeasurementId: null, scheduledSubjectId: null }, effects: productionEffects })
      return executed.nodeOutput.conversationIds![0]!
    }
    const BRUNO_TEXT = `PROOF-RECADO-BRUNO-${tag}: cumpriu 2 de 5 passos`
    const LARISSA_TEXT = `PROOF-RECADO-LARISSA-${tag}: cumpriu 4 de 5 passos`
    const aboutBruno = await deliver(bruno, { type: "MANAGER_OF_OPERATOR" }, BRUNO_TEXT) // dona: Marta (Grupo A); sujeito: Bruno (Grupo B)
    const ownRecado = await deliver(larissa, { type: "CURRENT_OPERATOR" }, LARISSA_TEXT) // dona e sujeito: Larissa (Grupo A)
    // Resposta seguinte da INIA na conversa do recado (nasce do mesmo contexto).
    await client.query("insert into assistant_interactions (organization_id, operator_id, conversation_id, channel, role, content, occurred_at) values ($1, $2, $3, 'chat', 'user', 'E o que eu faço?', now() + interval '1 minute'), ($1, $2, $3, 'chat', 'assistant', $4, now() + interval '2 minutes')", [org, manager, aboutBruno, `Converse com o Bruno sobre ${BRUNO_TEXT}`])

    const page = { page: 1, pageSize: 50 }
    const preview = async (viewer: typeof readerA, conversationId: string) => (await listMonitoredConversations(client as never, viewer, page)).items.find((item) => item.id === conversationId)
    const contents = async (viewer: typeof readerA, conversationId: string) => (await loadMonitoredMessages(client as never, viewer, conversationId, { limit: 50 })).messages

    // Leitora do Grupo A: vê a conversa da Marta (Grupo A), mas o recado fala do Bruno (Grupo B) — nada dele na lista nem nas mensagens.
    const listed = await preview(readerA, aboutBruno)
    expect(listed?.origin).toBe("WORKFLOW")
    expect(JSON.stringify(listed)).not.toContain(`PROOF-RECADO-BRUNO-${tag}`)
    expect(JSON.stringify(listed)).toContain(MONITORING_DATA_PREVIEW)
    const hidden = await contents(readerA, aboutBruno)
    expect(JSON.stringify(hidden)).not.toContain(`PROOF-RECADO-BRUNO-${tag}`)
    expect(hidden.map((message) => [message.role, message.content, "outOfReaderScope" in message && message.outOfReaderScope === true])).toEqual([
      ["assistant", OUT_OF_READER_SCOPE_RECADO_NOTICE, true],
      ["user", "E o que eu faço?", false],
      ["assistant", OUT_OF_READER_SCOPE_RECADO_NOTICE, true],
    ])

    // Recado da própria Larissa (Grupo A): completo para a mesma leitora.
    expect(JSON.stringify(await preview(readerA, ownRecado))).toContain(`PROOF-RECADO-LARISSA-${tag}`)
    expect((await contents(readerA, ownRecado)).some((message) => message.content.includes(LARISSA_TEXT))).toBe(true)

    // Leitora da organização inteira: o recado sobre o Bruno, completo.
    expect(JSON.stringify(await preview(readerOrg, aboutBruno))).toContain(`PROOF-RECADO-BRUNO-${tag}`)
    expect((await contents(readerOrg, aboutBruno)).filter((message) => message.content.includes(BRUNO_TEXT))).toHaveLength(2)
  }, 60_000)
})
