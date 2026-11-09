import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { canManageScope, getManageableScopes } from "../../auth/application/manageable-scopes.js"

/**
 * Exclusão lógica de agente (PEN-001, migration 177, decisão de 06/11/2026). Excluir não apaga nada, então histórico de uso não barra mais: execuções, conversas e análises continuam
 * guardadas e mostram o nome dele, porque as leituras de histórico usam `agents_all`.
 * - Barra o que ainda depende dele: execução em andamento, Workflow (rascunho, versão publicada vigente ou versão de uma execução em andamento — ativo, inativo ou nunca publicado) e
 *   orquestrador (especialista ou agente orquestrador — ativo ou inativo). Bases vinculadas nunca bloqueiam nem são apagadas.
 * - Referência fora do alcance de quem pede só aparece como "existem dependências que você não pode consultar", sem dados.
 * A exclusão confirma tudo de novo com a linha do agente travada (`for update`): o registro de uma execução nova trava a mesma linha em modo compartilhado (effect-sink.ts), então ou a
 * execução fica registrada e a exclusão é bloqueada, ou o agente é excluído e a execução não começa (PEN-069).
 */

type Queryable = Pick<Database, "query">

export type AgentReferenceStatus = "ACTIVE" | "INACTIVE" | "DRAFT"

export type AgentReference = {
  kind: "WORKFLOW" | "ORCHESTRATOR"
  id: string
  name: string
  status: AgentReferenceStatus
  /** Onde o agente é usado: etapas do Workflow ou papel no orquestrador. */
  usages: string[]
  link: string
}

/** `runningRuns`: execução registrada há menos de um dia e ainda sem resultado. Execução mais antiga que isso ficou presa e não impede excluir. */
export type AgentUsage = { runs: number; runningRuns: number; conversations: number; feedbackAnalyses: number }

export type AgentDeletionAssessment = {
  deletable: boolean
  hasUsage: boolean
  usage: AgentUsage
  references: AgentReference[]
  /** Há referência que a pessoa não pode consultar — nenhum dado dela é devolvido. */
  hasRestrictedReferences: boolean
}

type ScopedRow = { scope_type: string; team_id: string | null; subteam_id: string | null }

async function loadUsage(db: Queryable, organizationId: string, agentId: string): Promise<AgentUsage> {
  const result = await db.query<AgentUsage>(
    `select (select count(*) from agent_runs where agent_id = $1 and organization_id = $2)::int "runs",
            (select count(*) from agent_runs where agent_id = $1 and organization_id = $2 and status = 'PENDING' and created_at > now() - interval '1 day')::int "runningRuns",
            (select count(distinct i.conversation_id) from assistant_interactions i
              where i.organization_id = $2 and (i.agent_id = $1 or exists (select 1 from assistant_interaction_agents ia where ia.interaction_id = i.id and ia.agent_id = $1)))::int "conversations",
            (select count(*) from feedback_analysis_runs where agent_id = $1 and organization_id = $2)::int "feedbackAnalyses"`,
    [agentId, organizationId],
  )
  return result.rows[0]!
}

async function loadWorkflowReferences(db: Queryable, organizationId: string, agentId: string) {
  return (
    await db.query<ScopedRow & { id: string; name: string; status: AgentReferenceStatus; labels: string[] }>(
      `with graphs as (
         select w.id, w.draft_graph graph from workflows w where w.organization_id = $1
         union all
         select w.id, v.graph from workflows w join workflow_versions v on v.id = w.active_version_id where w.organization_id = $1
         union all
         select distinct w.id, v.graph from workflow_enrollments e join workflow_versions v on v.id = e.version_id join workflows w on w.id = v.workflow_id
          where w.organization_id = $1 and e.status in ('active', 'waiting')
       ), hits as (
         select g.id, coalesce(nullif(n->>'label', ''), 'Chamar agente') label
           from graphs g cross join lateral jsonb_array_elements(coalesce(g.graph->'nodes', '[]'::jsonb)) n
          where n->'config'->>'agentId' = $2
       )
       select w.id, w.name, w.scope_type, w.team_id, w.subteam_id,
              case when w.active then 'ACTIVE' when w.active_version_id is null then 'DRAFT' else 'INACTIVE' end "status",
              array_agg(distinct h.label order by h.label) "labels"
         from hits h join workflows w on w.id = h.id
        group by w.id, w.name, w.scope_type, w.team_id, w.subteam_id, w.active, w.active_version_id
        order by w.name`,
      [organizationId, agentId],
    )
  ).rows
}

async function loadOrchestratorReferences(db: Queryable, organizationId: string, agentId: string) {
  return (
    await db.query<ScopedRow & { id: string; name: string; active: boolean; roles: string[] }>(
      `select o.id, o.name, o.scope_type, o.team_id, o.subteam_id, o.active,
              array_remove(array[
                case when o.orchestrator_agent_id = $2 then 'Agente orquestrador' end,
                case when exists (select 1 from assistant_orchestrator_specialists s where s.orchestrator_id = o.id and s.agent_id = $2) then 'Especialista' end
              ], null) "roles"
         from assistant_orchestrators o
        where o.organization_id = $1
          and (o.orchestrator_agent_id = $2 or exists (select 1 from assistant_orchestrator_specialists s where s.orchestrator_id = o.id and s.agent_id = $2))
        order by o.name`,
      [organizationId, agentId],
    )
  ).rows
}

/** Referência visível + o alcance dela (para a prévia de impacto da publicação conferir quem deixaria de ser atendido). */
export type ScopedAgentReference = AgentReference & { scope: { scopeType: string; teamId: string | null; subteamId: string | null } }

/**
 * Workflows e orquestradores que usam o agente, só os que a pessoa pode consultar (com link), mais o aviso de que existem outros
 * fora do alcance dela — sem nenhum dado deles. Usada pela exclusão (PEN-066) e pela prévia de publicação (revisão de 03/11/2026).
 */
export async function loadVisibleAgentReferences(db: Database, viewer: { organizationId: string; sub: string }, agentId: string, client: Queryable = db): Promise<{ references: ScopedAgentReference[]; hasRestrictedReferences: boolean }> {
  const [workflows, orchestrators] = await Promise.all([loadWorkflowReferences(client, viewer.organizationId, agentId), loadOrchestratorReferences(client, viewer.organizationId, agentId)])
  const [workflowScopes, agentScopes] = await Promise.all([getManageableScopes(db, viewer, "workflows.manage"), getManageableScopes(db, viewer, "agents.manage")])
  const references: ScopedAgentReference[] = []
  let hasRestrictedReferences = false
  const scopeOf = (row: ScopedRow) => ({ scopeType: row.scope_type, teamId: row.team_id, subteamId: row.subteam_id })
  for (const workflow of workflows) {
    if (!canManageScope(workflowScopes, scopeOf(workflow))) {
      hasRestrictedReferences = true
      continue
    }
    references.push({ kind: "WORKFLOW", id: workflow.id, name: workflow.name, status: workflow.status, usages: workflow.labels, link: `/admin/workflows/${workflow.id}`, scope: scopeOf(workflow) })
  }
  for (const orchestrator of orchestrators) {
    if (!canManageScope(agentScopes, scopeOf(orchestrator))) {
      hasRestrictedReferences = true
      continue
    }
    references.push({ kind: "ORCHESTRATOR", id: orchestrator.id, name: orchestrator.name, status: orchestrator.active ? "ACTIVE" : "INACTIVE", usages: orchestrator.roles, link: `/admin/assistant/${orchestrator.id}`, scope: scopeOf(orchestrator) })
  }
  return { references, hasRestrictedReferences }
}

export async function assessAgentDeletion(db: Database, viewer: { organizationId: string; sub: string }, agentId: string, client: Queryable = db): Promise<AgentDeletionAssessment> {
  const [usage, visible] = await Promise.all([loadUsage(client, viewer.organizationId, agentId), loadVisibleAgentReferences(db, viewer, agentId, client)])
  const references: AgentReference[] = visible.references.map(({ scope: _scope, ...reference }) => { void _scope; return reference })
  const hasRestrictedReferences = visible.hasRestrictedReferences
  const hasUsage = usage.runs + usage.conversations + usage.feedbackAnalyses > 0
  return { deletable: usage.runningRuns === 0 && references.length === 0 && !hasRestrictedReferences, hasUsage, usage, references, hasRestrictedReferences }
}

/** Explicação única do bloqueio (tela e resposta do servidor). */
export function describeDeletionBlock(assessment: AgentDeletionAssessment): string {
  const reasons: string[] = []
  if (assessment.usage.runningRuns > 0) reasons.push("tem execução em andamento")
  if (assessment.references.length > 0 || assessment.hasRestrictedReferences) reasons.push("é usado por Workflows de automação ou orquestradores")
  return `Este agente não pode ser excluído porque ${reasons.join(" e ")}. Para que ele não seja mais usado, desative-o.`
}

/**
 * Exclui só se, com a linha travada, continuar sem uso e sem dependências. Exclusão lógica (migration 177): o Agent sai das telas e da execução, com versões, histórico e
 * bases vinculadas guardados, e volta pela Central de Dados, desativado.
 */
export async function deleteAgentIfUnused(db: Database, client: Queryable, viewer: { organizationId: string; sub: string; personId?: string | null | undefined }, agentId: string): Promise<void> {
  const locked = await client.query<{ name: string }>(`select name from agents where id = $1 and organization_id = $2 for update`, [agentId, viewer.organizationId])
  const agent = locked.rows[0]
  if (!agent) throw new DomainError("Agente não encontrado.", "AGENT_NOT_FOUND", 404)
  const assessment = await assessAgentDeletion(db, viewer, agentId, client)
  if (!assessment.deletable) throw new DomainError(describeDeletionBlock(assessment), "AGENT_DELETE_BLOCKED", 409, assessment)
  const personId = viewer.personId ?? null
  await client.query(`update agents_all set active = false, deleted_at = now(), deleted_by_person_id = $3, updated_at = now() where id = $1 and organization_id = $2`, [agentId, viewer.organizationId, personId])
  await client.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'AGENT_DELETED', 'agent', $3, $4)`, [viewer.organizationId, personId, agentId, JSON.stringify({ name: agent.name })])
}
