import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { canManageScope, getManageableScopes } from "../../auth/application/manageable-scopes.js"
import { loadWorkflowsCitingNode, type WorkflowCitationStatus } from "../../workflows/application/workflow-node-references.js"

const CODE = "ORCHESTRATOR_DELETE_BLOCKED"
const VISIBLE_NAMES_IN_MESSAGE = 3

export type OrchestratorWorkflowReference = { kind: "WORKFLOW"; id: string; name: string; status: WorkflowCitationStatus; usages: string[]; link: string }

export type OrchestratorDeletionBlock = {
  references: OrchestratorWorkflowReference[]
  /** Há Workflow fora do alcance de quem pede: nenhum dado dele é devolvido. */
  hasRestrictedReferences: boolean
}

async function assessOrchestratorDeletion(db: Database, viewer: { organizationId: string; sub: string }, orchestratorId: string): Promise<OrchestratorDeletionBlock> {
  const citations = await loadWorkflowsCitingNode(db, viewer.organizationId, { configKey: "orchestratorId", id: orchestratorId, defaultLabel: "Orquestrador" })
  const scopes = citations.length > 0 ? await getManageableScopes(db, viewer, "workflows.manage") : null
  const references: OrchestratorWorkflowReference[] = []
  let hasRestrictedReferences = false
  for (const workflow of citations) {
    if (!scopes || !canManageScope(scopes, { scopeType: workflow.scope_type, teamId: workflow.team_id, subteamId: workflow.subteam_id })) {
      hasRestrictedReferences = true
      continue
    }
    references.push({ kind: "WORKFLOW", id: workflow.id, name: workflow.name, status: workflow.status, usages: workflow.labels, link: `/admin/workflows/${workflow.id}` })
  }
  return { references, hasRestrictedReferences }
}

function describeBlock({ references, hasRestrictedReferences }: OrchestratorDeletionBlock): string {
  const names = references.slice(0, VISIBLE_NAMES_IN_MESSAGE).map((reference) => reference.name)
  const others = references.length - names.length
  const list = [names.join(", "), others > 0 ? `mais ${others}` : null, hasRestrictedReferences ? "outros que você não pode consultar" : null].filter(Boolean).join(" e ")
  return `Este Orquestrador não pode ser excluído porque é usado pelo(s) Workflow(s) ${list}. Troque-o nas etapas desses Workflows e publique; execuções em andamento precisam terminar antes de excluir.`
}

/**
 * Exclusão lógica (migration 177): versões, vínculos e o histórico das conversas continuam guardados, e o Orquestrador volta pela Central de Dados, desativado.
 * Barra só o que ainda depende dele: Workflow no rascunho, na versão publicada vigente ou na versão de uma execução em andamento. A citação fica no grafo, sem chave estrangeira.
 * Workflow fora do alcance de quem pede só aparece como aviso, sem dados. Quem chama já conferiu o alcance sobre o Orquestrador.
 */
export async function deleteOrchestratorIfUnreferenced(db: Database, viewer: { organizationId: string; sub: string; personId?: string | null | undefined }, orchestratorId: string): Promise<void> {
  const block = await assessOrchestratorDeletion(db, viewer, orchestratorId)
  if (block.references.length > 0 || block.hasRestrictedReferences) throw new DomainError(describeBlock(block), CODE, 409, block)
  await db.query(
    `with deleted as (update assistant_orchestrators_all set active = false, deleted_at = now(), deleted_by_person_id = $3, updated_at = now() where id = $1 and organization_id = $2 and deleted_at is null returning id, name)
     insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) select $2, $3, 'ORCHESTRATOR_DELETED', 'assistant_orchestrator', id, jsonb_build_object('name', name) from deleted`,
    [orchestratorId, viewer.organizationId, viewer.personId ?? null],
  )
}
