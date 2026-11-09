import { NO_REVIEWER_MESSAGES } from "../domain/execution-block.js"
import { resolveEnrollmentOperatorId } from "./enrollment-subject.js"
import { isAbsentContent } from "./execution-context.js"
import { resolveReviewers } from "./human-review-executor.js"
import { resolveSource } from "./output-executor.js"
import { createHash } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { flowGraphSchema, type FlowGraph } from "../domain/graph-schema.js"
import type { OutputTarget } from "../domain/output-schema.js"
import { loadUnavailableReferences, type ManualRunBlocker } from "./manual-run.js"

/**
 * NOVA TENTATIVA de uma execução bloqueada, por agente (PEN-073, PEN-074, PEN-075 — decididas em 03/11/2026) ou por revisão sem revisor
 * ou sem conteúdo (P5c, D2).
 * - Nunca automática: reativar o agente, corrigir a hierarquia, republicar ou religar o Workflow não cria tentativa; só a confirmação de alguém.
 * - Roda na versão PUBLICADA E VIGENTE do Workflow no momento da confirmação, com a versão do agente que ELA referencia
 *   (PEN-002); a original continua como estava, na versão em que começou.
 * - Mesmas condições do "Executar agora": Workflow ligado e publicado, agentes e orquestradores disponíveis.
 * - Antes de confirmar, a pessoa vê versão, agentes (com versão), destinos e aprovações; a confirmação leva a impressão digital
 *   do que foi visto e o servidor confere tudo de novo — mudou, nada começa e a tela pede nova confirmação.
 * - Critério de reaproveitamento (escolha técnica permitida pelo CA-WF101.16): mesma versão do Workflow = continua da etapa
 *   bloqueada com os resultados anteriores (são da MESMA versão); versão diferente = recomeça do Gatilho e reavalia tudo (filha de
 *   "Selecionar colaboradores": recomeça no nó seguinte ao envio, como uma filha nasce, ligada à mesma execução principal).
 * - Agentes: a prévia mostra a versão VIGENTE de cada agente aplicável e ela entra na impressão digital; na chamada efetiva, a
 *   vigente é resolvida e autorizada de novo e registrada na execução (revisão da PEN-002/PEN-076, 03/11/2026). Se alguém publicar
 *   entre a confirmação e a chamada, a execução registra a versão usada e `retry_confirmation` guarda a apresentada.
 * - Entregas nunca se repetem na cadeia original → tentativas (`priorChainDelivery`), e só uma tentativa por vez.
 */

export const WORKFLOW_OFF_RETRY_MESSAGE = "Este Workflow está desligado. Reative-o para solicitar uma nova tentativa."

const TARGET_LABELS: Record<OutputTarget["type"], string> = {
  CURRENT_OPERATOR: "o próprio colaborador",
  SUPERVISOR_OF_OPERATOR: "o supervisor do colaborador",
  MANAGER_OF_OPERATOR: "o gerente do colaborador",
  ROLE: "um cargo da hierarquia do colaborador",
  USER: "uma pessoa específica",
}
const SURFACE_LABELS: Record<string, string> = {
  FOLLOW_UP: "Acompanhamento",
  AVATAR: "Avatar",
  CHAT: "Chat",
  INBOX: "Caixa de entrada",
  NOTIFICATION: "Notificação",
  CUSTOM_SURFACE: "Superfície personalizada",
}
const ROLE_LABELS: Record<string, string> = { COORDINATOR: "coordenador", SUPERVISOR: "supervisor", MANAGER: "gerente", SENIOR_MANAGER: "gerente sênior", DIRECTOR: "diretor" }

export type RetryAgentReference = { nodeId: string; nodeLabel: string; agentId: string; agentName: string | null; agentVersionId: string | null; agentVersionNumber: number | null; active: boolean | null }
export type RetryOrchestratorReference = {
  nodeId: string
  nodeLabel: string
  orchestratorId: string
  orchestratorName: string | null
  orchestratorVersionId: string | null
  orchestratorVersionNumber: number | null
  /** Agentes do Orquestrador nesta etapa (agente orquestrador e especialistas), cada um na versão VIGENTE de agora. */
  agents: { agentId: string; agentName: string | null; role: "ORCHESTRATOR_AGENT" | "SPECIALIST"; agentVersionId: string | null; agentVersionNumber: number | null; active: boolean | null }[]
}

export type RetryPreview = {
  enrollmentId: string
  workflowId: string
  workflowName: string
  workflowActive: boolean
  blockers: ManualRunBlocker[]
  /** Versão publicada e vigente que a nova tentativa usará (a da confirmação). */
  workflowVersion: { id: string; number: number } | null
  originalVersion: { id: string; number: number }
  blockedNode: { id: string | null; label: string | null; agentName: string | null; cause: string | null }
  agents: RetryAgentReference[]
  orchestrators: RetryOrchestratorReference[]
  destinations: { nodeId: string; nodeLabel: string; description: string }[]
  approvals: { nodeId: string; nodeLabel: string; description: string }[]
  startsAt: "BLOCKED_STEP" | "TRIGGER" | "AFTER_FAN_OUT"
  /** Execução de UM colaborador de "Selecionar colaboradores": a tentativa fica ligada à mesma execução principal. */
  fanOut: { parentEnrollmentId: string; parentStatus: string; joinsConsolidation: boolean } | null
  fingerprint: string
}

type OriginalRow = {
  id: string
  organization_id: string
  workflow_id: string
  version_id: string
  status: string
  parent_enrollment_id: string | null
  fan_out_node_id: string | null
  parent_status: string | null
  parent_node_id: string | null
  blocked_node_id: string | null
  blocked_reason: string | null
  blocked_details: { agentName?: string; cause?: string } | null
  interaction_id: string | null
  indicator_measurement_id: string | null
  scheduled_subject_id: string | null
  scheduled_for: string | null
  matched_flag_name: string | null
  matched_value_boolean: boolean | null
  matched_value_numeric: string | null
  node_outputs: Record<string, unknown>
  variables: Record<string, unknown>
  indicator_diagnostic_strategy_version_id: string | null
  workflow_name: string
  workflow_active: boolean
  active_version_id: string | null
}

type Queryable = Pick<Database, "query">

async function loadOriginal(db: Queryable, organizationId: string, enrollmentId: string, lock: boolean): Promise<OriginalRow | null> {
  return (await db.query<OriginalRow>(
    `select e.id, e.organization_id, e.workflow_id, e.version_id, e.status, e.parent_enrollment_id, e.fan_out_node_id, p.status parent_status, p.current_node_id parent_node_id, e.blocked_node_id, e.blocked_reason, e.blocked_details,
            e.interaction_id, e.indicator_measurement_id, e.scheduled_subject_id, e.scheduled_for, e.matched_flag_name, e.matched_value_boolean,
            e.matched_value_numeric, e.node_outputs, e.variables, e.indicator_diagnostic_strategy_version_id,
            w.name workflow_name, w.active workflow_active, w.active_version_id
       from workflow_enrollments e join workflows w on w.id = e.workflow_id left join workflow_enrollments p on p.id = e.parent_enrollment_id
      where e.id = $1 and e.organization_id = $2 ${lock ? "for update of e" : ""}`,
    [enrollmentId, organizationId],
  )).rows[0] ?? null
}

async function versionNumber(db: Queryable, workflowId: string, versionId: string): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int n from workflow_versions where workflow_id = $1 and created_at <= (select created_at from workflow_versions where id = $2)`, [workflowId, versionId])).rows[0]?.n ?? 0
}

function describeTarget(target: OutputTarget): string {
  return target.type === "ROLE" ? `o ${ROLE_LABELS[target.role] ?? target.role} do colaborador` : TARGET_LABELS[target.type]
}

/**
 * O que a nova tentativa vai usar, conferido agora: a versão publicada e vigente do Workflow (etapas, destinos, aprovações) e a
 * versão VIGENTE de cada agente aplicável (revisão aprovada da PEN-002/PEN-076 de 03/11/2026 — agentes não ficam fixados; na
 * chamada efetiva, a versão vigente é resolvida e autorizada de novo e fica registrada na execução).
 */
async function describeGraph(db: Queryable, organizationId: string, graph: FlowGraph) {
  const agentNodes = graph.nodes.flatMap((node) => (node.type === "action" && node.config.actionType === "CALL_AGENT" ? [{ node, agentId: node.config.agentId }] : []))
  const orchestratorNodes = graph.nodes.flatMap((node) => (node.type === "orchestrator" ? [{ node, orchestratorId: node.config.orchestratorId, versionId: node.config.orchestratorVersionId ?? null }] : []))
  const orchestrators = new Map((await db.query<{ id: string; name: string; orchestrator_agent_id: string; current_version_id: string | null }>(`select id, name, orchestrator_agent_id, current_version_id from assistant_orchestrators where organization_id = $1 and id = any($2::uuid[])`, [organizationId, orchestratorNodes.map((entry) => entry.orchestratorId)])).rows.map((row) => [row.id, row]))
  const orchestratorVersions = new Map((await db.query<{ id: string; version_number: number; config: { specialists?: { agentId: string }[] } }>(
    `select id, version_number, config from assistant_orchestrator_versions where id = any($1::uuid[])`,
    [orchestratorNodes.flatMap((entry) => { const id = entry.versionId ?? orchestrators.get(entry.orchestratorId)?.current_version_id; return id ? [id] : [] })],
  )).rows.map((row) => [row.id, row]))
  const orchestratorAgentIds = orchestratorNodes.flatMap((entry) => {
    const orchestrator = orchestrators.get(entry.orchestratorId)
    const version = orchestratorVersions.get(entry.versionId ?? orchestrator?.current_version_id ?? "")
    return [...(orchestrator ? [orchestrator.orchestrator_agent_id] : []), ...(version?.config.specialists ?? []).map((specialist) => specialist.agentId)]
  })
  const agentIds = [...new Set([...agentNodes.map((entry) => entry.agentId), ...orchestratorAgentIds])]
  const agents = new Map((await db.query<{ id: string; name: string; active: boolean; current_version_id: string | null; version_number: number | null }>(
    `select a.id, a.name, a.active, a.current_version_id, v.version_number from agents a left join agent_versions v on v.id = a.current_version_id where a.organization_id = $1 and a.id = any($2::uuid[])`,
    [organizationId, agentIds],
  )).rows.map((row) => [row.id, row]))
  const vigente = (agentId: string) => ({ agentName: agents.get(agentId)?.name ?? null, agentVersionId: agents.get(agentId)?.current_version_id ?? null, agentVersionNumber: agents.get(agentId)?.version_number ?? null, active: agents.get(agentId)?.active ?? null })
  return {
    agents: agentNodes.map(({ node, agentId }): RetryAgentReference => ({ nodeId: node.id, nodeLabel: node.label, agentId, ...vigente(agentId) })),
    orchestrators: orchestratorNodes.map(({ node, orchestratorId, versionId }): RetryOrchestratorReference => {
      const orchestrator = orchestrators.get(orchestratorId)
      const version = orchestratorVersions.get(versionId ?? orchestrator?.current_version_id ?? "")
      return {
        nodeId: node.id,
        nodeLabel: node.label,
        orchestratorId,
        orchestratorName: orchestrator?.name ?? null,
        orchestratorVersionId: version?.id ?? null,
        orchestratorVersionNumber: version?.version_number ?? null,
        agents: [
          ...(orchestrator ? [{ agentId: orchestrator.orchestrator_agent_id, role: "ORCHESTRATOR_AGENT" as const, ...vigente(orchestrator.orchestrator_agent_id) }] : []),
          ...(version?.config.specialists ?? []).map((specialist) => ({ agentId: specialist.agentId, role: "SPECIALIST" as const, ...vigente(specialist.agentId) })),
        ],
      }
    }),
    destinations: graph.nodes.flatMap((node) => (node.type === "output" ? [{ nodeId: node.id, nodeLabel: node.label, description: `Para ${describeTarget(node.config.target)}, em ${node.config.surfaces.map((surface) => SURFACE_LABELS[surface] ?? surface).join(", ")}` }] : [])),
    approvals: graph.nodes.flatMap((node) => (node.type === "human_review" ? [{ nodeId: node.id, nodeLabel: node.label, description: node.config.reviewTarget.type === "SPECIFIC_USER" ? "Revisão de uma pessoa específica" : `Revisão do ${ROLE_LABELS[node.config.reviewTarget.role] ?? node.config.reviewTarget.role}` }] : [])),
  }
}

async function buildPreview(db: Database, client: Queryable, original: OriginalRow): Promise<RetryPreview> {
  const originalVersion = { id: original.version_id, number: await versionNumber(client, original.workflow_id, original.version_id) }
  const originalGraph = flowGraphSchema.safeParse((await client.query<{ graph: unknown }>(`select graph from workflow_versions where id = $1`, [original.version_id])).rows[0]?.graph)
  const blockedLabel = originalGraph.success ? (originalGraph.data.nodes.find((node) => node.id === original.blocked_node_id)?.label ?? null) : null
  const blockers: ManualRunBlocker[] = []
  // PEN-075: Workflow desligado não aceita nova tentativa, mesmo com versão publicada — mensagem decidida.
  if (!original.workflow_active) blockers.push({ code: "WORKFLOW_RETRY_WORKFLOW_INACTIVE", message: WORKFLOW_OFF_RETRY_MESSAGE })
  if (!original.active_version_id) blockers.push({ code: "WORKFLOW_MANUAL_RUN_NOT_PUBLISHED", message: "O workflow não tem versão publicada." })
  if (original.indicator_measurement_id) {
    const cancelled = await client.query(`select 1 from indicator_measurements_all where id = $1 and cancelled_at is not null`, [original.indicator_measurement_id])
    if ((cancelled.rowCount ?? 0) > 0) blockers.push({ code: "WORKFLOW_RETRY_RECORD_CANCELLED", message: "A medição desta execução foi cancelada na Central de Dados. Ela precisa voltar a valer, por uma carga ou por Reativar, antes de uma nova tentativa." })
  }
  if (original.active_version_id) blockers.push(...(await loadUnavailableReferences(db, original.organization_id, original.active_version_id)))
  const currentGraph = original.active_version_id ? flowGraphSchema.safeParse((await client.query<{ graph: unknown }>(`select graph from workflow_versions where id = $1`, [original.active_version_id])).rows[0]?.graph) : null
  const described = currentGraph?.success ? await describeGraph(client, original.organization_id, currentGraph.data) : { agents: [], orchestrators: [], destinations: [], approvals: [] }
  const workflowVersion = original.active_version_id ? { id: original.active_version_id, number: await versionNumber(client, original.workflow_id, original.active_version_id) } : null
  const sameVersion = original.active_version_id === original.version_id && Boolean(original.blocked_node_id)
  const startsAt: RetryPreview["startsAt"] = sameVersion ? "BLOCKED_STEP" : original.parent_enrollment_id ? "AFTER_FAN_OUT" : "TRIGGER"
  if (currentGraph?.success) blockers.push(...(await reviewRetryBlockers(client as Database, original, currentGraph.data, sameVersion)))
  // Filha de "Selecionar colaboradores" numa versão nova: recomeça como uma filha nasce — no nó seguinte ao envio, que precisa
  // continuar existindo na versão vigente.
  if (!sameVersion && original.parent_enrollment_id && currentGraph?.success && !fanOutNextNode(currentGraph.data, original.fan_out_node_id)) {
    blockers.push({ code: "WORKFLOW_RETRY_FAN_OUT_MISSING", message: "A versão vigente do Workflow não tem mais a etapa de envio para vários colaboradores desta execução. Publique uma versão com essa etapa ou execute o Workflow de novo." })
  }
  // A tentativa da filha entra no consolidado só se a execução principal ainda estiver esperando no "Consolidar resultados".
  const fanOut = original.parent_enrollment_id
    ? { parentEnrollmentId: original.parent_enrollment_id, parentStatus: original.parent_status ?? "unknown", joinsConsolidation: (original.parent_status === "active" || original.parent_status === "waiting") && originalGraphHasJoin(originalGraph.success ? originalGraph.data : null, original.parent_node_id) }
    : null
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ workflowActive: original.workflow_active, version: workflowVersion?.id ?? null, agents: described.agents.map((agent) => [agent.nodeId, agent.agentId, agent.agentVersionId, agent.active]), orchestrators: described.orchestrators.map((item) => [item.nodeId, item.orchestratorId, item.orchestratorVersionId, item.agents.map((agent) => [agent.agentId, agent.agentVersionId, agent.active])]), destinations: described.destinations, approvals: described.approvals, startsAt, blockers: blockers.map((blocker) => blocker.code) }))
    .digest("hex")
    .slice(0, 32)
  return {
    enrollmentId: original.id,
    workflowId: original.workflow_id,
    workflowName: original.workflow_name,
    workflowActive: original.workflow_active,
    blockers,
    workflowVersion,
    originalVersion,
    blockedNode: { id: original.blocked_node_id, label: blockedLabel, agentName: original.blocked_details?.agentName ?? null, cause: original.blocked_details?.cause ?? null },
    ...described,
    startsAt,
    fanOut,
    fingerprint,
  }
}

/**
 * Bloqueio de revisão (P5c, D2): a nova tentativa só é oferecida se a causa foi corrigida; senão, bloquearia de novo. Em versão
 * diferente a tentativa recomeça do início, e o que a etapa vai ler ainda não existe: só o revisor fixo ou por cargo dá para conferir.
 */
async function reviewRetryBlockers(db: Database, original: OriginalRow, graph: FlowGraph, sameVersion: boolean): Promise<ManualRunBlocker[]> {
  if (original.blocked_reason !== "HUMAN_REVIEW_NO_REVIEWER" && original.blocked_reason !== "HUMAN_REVIEW_CONTENT_MISSING") return []
  const node = graph.nodes.find((candidate) => candidate.id === original.blocked_node_id)
  if (node?.type !== "human_review") return []
  if (original.blocked_reason === "HUMAN_REVIEW_CONTENT_MISSING") {
    if (!sameVersion || !node.config.contentSource || !isAbsentContent(resolveSource(original.node_outputs, node.config.contentSource, original.variables))) return []
    return [{ code: "WORKFLOW_RETRY_CONTENT_MISSING", message: "O conteúdo a revisar continua ausente nesta versão. Publique uma versão que corrija a origem do conteúdo." }]
  }
  if (!sameVersion && node.config.reviewTarget.type === "ROLE_OF_PREVIOUS_REVIEWER") return []
  const operatorId = await resolveEnrollmentOperatorId({ db, enrollment: { interactionId: original.interaction_id, indicatorMeasurementId: original.indicator_measurement_id, scheduledSubjectId: original.scheduled_subject_id } })
  if (!operatorId) return []
  const { cause } = await resolveReviewers({ db, nodeOutputs: sameVersion ? original.node_outputs : {} }, operatorId, node.config.reviewTarget)
  return cause ? [{ code: "WORKFLOW_RETRY_REVIEWER_MISSING", message: `${NO_REVIEWER_MESSAGES[cause]} Ajuste a hierarquia ou o revisor da etapa antes de tentar de novo.` }] : []
}

/** Nó em que uma filha nasce: o destino da saída do envio ("Selecionar colaboradores") na versão dada. */
function fanOutNextNode(graph: FlowGraph, fanOutNodeId: string | null): string | null {
  if (!fanOutNodeId || !graph.nodes.some((node) => node.id === fanOutNodeId)) return null
  return graph.edges.find((edge) => edge.source === fanOutNodeId)?.target ?? null
}

/** A execução principal está parada num "Consolidar resultados"? (só então a tentativa da filha entra no consolidado.) */
function originalGraphHasJoin(graph: FlowGraph | null, nodeId: string | null): boolean {
  return Boolean(graph && nodeId && graph.nodes.some((node) => node.id === nodeId && node.type === "consolidate_results"))
}

function assertRetryable(original: OriginalRow | null): asserts original is OriginalRow {
  if (!original) throw new DomainError("Execução não encontrada.", "WORKFLOW_ENROLLMENT_NOT_FOUND", 404)
  if (original.status !== "blocked") throw new DomainError("Só uma execução bloqueada aceita nova tentativa.", "WORKFLOW_RETRY_NOT_BLOCKED", 409)
}

export async function previewWorkflowRetry(db: Database, organizationId: string, enrollmentId: string): Promise<RetryPreview> {
  const original = await loadOriginal(db, organizationId, enrollmentId, false)
  assertRetryable(original)
  return buildPreview(db, db, original)
}

/** Raiz da cadeia (a execução original) — uma tentativa pode, ela mesma, ter sido bloqueada e tentada de novo. */
const CHAIN_SQL = `with recursive up as (
    select id, retry_of_enrollment_id from workflow_enrollments where id = $1
    union all select e.id, e.retry_of_enrollment_id from workflow_enrollments e join up on e.id = up.retry_of_enrollment_id
  ), root as (select id from up where retry_of_enrollment_id is null),
  chain as (
    select id from root
    union all select e.id from workflow_enrollments e join chain c on e.retry_of_enrollment_id = c.id
  )`

export type RetryConfirmation = { fingerprint: string }

export async function confirmWorkflowRetry(db: Database, organizationId: string, enrollmentId: string, confirmation: RetryConfirmation, actor: { personId: string | null; name: string }): Promise<{ enrollmentId: string; preview: RetryPreview }> {
  return inTransaction(db, async (client) => {
    // Trava a original: duas confirmações simultâneas nunca criam duas tentativas.
    const original = await loadOriginal(client, organizationId, enrollmentId, true)
    assertRetryable(original)
    const preview = await buildPreview(db, client, original)
    const [blocker] = preview.blockers
    if (blocker) throw new DomainError(blocker.message, blocker.code, 409, { preview })
    if (preview.fingerprint !== confirmation.fingerprint) {
      throw new DomainError("O que será usado na nova tentativa mudou desde que você abriu a confirmação. Confira os dados atualizados e confirme de novo.", "WORKFLOW_RETRY_RECONFIRM", 409, { preview })
    }
    const running = await client.query(`${CHAIN_SQL} select 1 from workflow_enrollments where id in (select id from chain) and id <> $1 and status in ('active', 'waiting') limit 1`, [enrollmentId])
    if (running.rows[0]) throw new DomainError("Já existe uma nova tentativa desta execução em andamento. Aguarde ela terminar.", "WORKFLOW_RETRY_IN_PROGRESS", 409)
    const version = preview.workflowVersion!
    const graph = flowGraphSchema.parse((await client.query<{ graph: unknown }>(`select graph from workflow_versions where id = $1`, [version.id])).rows[0]?.graph)
    const trigger = graph.nodes.find((node) => node.type === "trigger")
    if (!trigger) throw new DomainError("A versão publicada não tem nó Gatilho.", "WORKFLOW_INVALID_GRAPH", 422)
    const sameVersion = preview.startsAt === "BLOCKED_STEP"
    const startNode = sameVersion ? original.blocked_node_id! : preview.startsAt === "AFTER_FAN_OUT" ? fanOutNextNode(graph, original.fan_out_node_id)! : trigger.id
    // Filha de "Selecionar colaboradores": continua filha da MESMA execução principal (destinatários pela cadeia do colaborador,
    // barreira do consolidado) — o índice único do envio deixa de fora as tentativas (migration 166).
    const created = await client.query<{ id: string }>(
      `insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, interaction_id, indicator_measurement_id, scheduled_subject_id, scheduled_for,
                                         matched_flag_name, matched_value_boolean, matched_value_numeric, node_outputs, variables, indicator_diagnostic_strategy_version_id,
                                         retry_of_enrollment_id, retry_requested_by_person_id, retry_requested_by_name, retry_requested_at, retry_confirmation,
                                         parent_enrollment_id, fan_out_node_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now(), $18, $19, $20)
       returning id`,
      [
        organizationId, original.workflow_id, version.id, startNode,
        original.interaction_id, original.indicator_measurement_id, original.scheduled_subject_id, original.scheduled_for,
        original.matched_flag_name, original.matched_value_boolean, original.matched_value_numeric,
        JSON.stringify(sameVersion ? original.node_outputs : {}), JSON.stringify(sameVersion ? original.variables : {}), original.indicator_diagnostic_strategy_version_id,
        enrollmentId, actor.personId, actor.name, JSON.stringify({ ...preview, confirmedAt: new Date().toISOString() }),
        original.parent_enrollment_id, original.fan_out_node_id,
      ],
    )
    const retryId = created.rows[0]!.id
    const payload = { retryEnrollmentId: retryId, originalEnrollmentId: enrollmentId, requestedBy: actor.name, workflowVersionId: version.id, workflowVersionNumber: version.number, agents: preview.agents.map((agent) => ({ nodeLabel: agent.nodeLabel, agentName: agent.agentName, agentVersionNumber: agent.agentVersionNumber })), startsAt: preview.startsAt }
    await client.query(
      `insert into workflow_enrollment_events (enrollment_id, node_id, event_type, payload, idempotency_key) values ($1, $2, 'retry_requested', $3, $4), ($5, $6, 'retry_started', $3, $7)`,
      [enrollmentId, original.blocked_node_id ?? trigger.id, JSON.stringify(payload), `retry:${retryId}`, retryId, startNode, `retry-start:${retryId}`],
    )
    return { enrollmentId: retryId, preview }
  })
}

/**
 * Entrega já feita por outra execução da MESMA cadeia (original ou tentativa anterior), no mesmo nó Output: a nova tentativa não
 * entrega de novo (CA-WF101.9, CA-WF101.17) e segue com o resultado registrado. Só é chamada para uma tentativa
 * (`retry_of_enrollment_id`, carregado com a matrícula) — fora dela, nem consulta.
 */
export async function priorChainDelivery(db: Queryable, enrollmentId: string, nodeId: string): Promise<{ enrollmentId: string; nodeOutput: unknown } | null> {
  const found = await db.query<{ enrollment_id: string; node_output: unknown }>(
    `${CHAIN_SQL}
     select ev.enrollment_id, e.node_outputs -> $2 node_output
       from workflow_enrollment_events ev join workflow_enrollments e on e.id = ev.enrollment_id
      where ev.enrollment_id in (select id from chain) and ev.enrollment_id <> $1 and ev.node_id = $2 and ev.event_type = 'output_dispatched'
      order by ev.created_at limit 1`,
    [enrollmentId, nodeId],
  )
  const row = found.rows[0]
  return row ? { enrollmentId: row.enrollment_id, nodeOutput: row.node_output } : null
}
