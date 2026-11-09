import type { Database } from "../../../infrastructure/database/pool.js"
import { withAgentSnapshots } from "../../agents/application/agent-runtime-context.js"
import { resolveAgentVersionForRun } from "../../agents/application/agent-versions.js"
import type { AgentRuntimeSnapshot } from "../../agents/domain/agent-config.js"
import { assertExecutionAuthorized } from "../../agents/application/agent-execution-authorization.js"
import type { ScopedTarget } from "../../auth/application/manageable-scopes.js"
import { AgentInactiveError } from "../../agents/domain/agent-inactive-error.js"

/**
 * Versão do agente que uma etapa do Workflow executa — revisão aprovada da PEN-002/PEN-076 (03/11/2026): a VIGENTE no momento em
 * que a execução do agente vai começar, registrada na execução. O Workflow não fixa versão de agente (uma `agentVersionId` antiga
 * no grafo é ignorada). A autorização é conferida aqui, nesse momento (PEN-070: agente inativo; condição de segurança da revisão:
 * a versão vigente precisa estar autorizada para o alcance do Workflow, com as bases autorizadas).
 */
export async function resolveWorkflowAgentSnapshot(db: Database, organizationId: string, agentId: string, workflowScope: ScopedTarget | null): Promise<AgentRuntimeSnapshot> {
  const resolved = await resolveAgentVersionForRun(db, organizationId, agentId)
  if (!resolved.active) throw new AgentInactiveError(agentId, resolved.config.name, resolved.versionId, resolved.versionNumber)
  const snapshot = { agentId: resolved.agentId, organizationId: resolved.organizationId, versionId: resolved.versionId, versionNumber: resolved.versionNumber, config: resolved.config }
  await assertExecutionAuthorized(db, snapshot, workflowScope)
  return snapshot
}

export async function withWorkflowAgent<T>(db: Database, organizationId: string, agentId: string, workflowScope: ScopedTarget | null, run: (snapshot: AgentRuntimeSnapshot) => Promise<T>): Promise<T> {
  const snapshot = await resolveWorkflowAgentSnapshot(db, organizationId, agentId, workflowScope)
  return withAgentSnapshots([snapshot], () => run(snapshot))
}

/**
 * Publicar o Workflow fixa a versão do ORQUESTRADOR de cada etapa que ainda não tem uma (PEN-076: a configuração do Orquestrador
 * é versionada e o Workflow a referencia; os especialistas dela rodam sempre na versão vigente — revisão de 03/11/2026). Referência
 * já fixada não muda aqui. Agentes não são fixados: valem pela vigente.
 */
export async function pinGraphReferences<T extends { nodes: unknown[] }>(db: Pick<Database, "query">, organizationId: string, graph: T): Promise<T> {
  type PinnableNode = { type?: string; config?: { orchestratorId?: string; orchestratorVersionId?: string } }
  const nodes = graph.nodes as PinnableNode[]
  const orchestratorIds = [...new Set(nodes.flatMap((node) => (node.type === "orchestrator" && node.config?.orchestratorId && !node.config.orchestratorVersionId ? [node.config.orchestratorId] : [])))]
  const orchestratorPins = new Map(orchestratorIds.length === 0 ? [] : (await db.query<{ id: string; current_version_id: string | null }>(`select id, current_version_id from assistant_orchestrators where id = any($1::uuid[]) and organization_id = $2`, [orchestratorIds, organizationId])).rows.map((row) => [row.id, row.current_version_id]))
  return {
    ...graph,
    nodes: nodes.map((node) => {
      if (node.type === "orchestrator" && node.config?.orchestratorId && !node.config.orchestratorVersionId) {
        const pin = orchestratorPins.get(node.config.orchestratorId)
        return pin ? { ...node, config: { ...node.config, orchestratorVersionId: pin } } : node
      }
      return node
    }),
  }
}
