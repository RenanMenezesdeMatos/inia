import { DomainError } from "../../../../shared/domain/domain-error.js"
import { findAncestorNodeIds, type FlowNode } from "../../domain/graph-schema.js"
import type { PublishCatalogContext, PublishGraphContext } from "./context.js"

// Família POLÍTICA DE ACOMPANHAMENTO: o nó "Avaliar política de acompanhamento". O que o editor checa sem banco (referências
// de análise ancestrais) é espelhado em frontend/src/schemas/admin/workflow-validation/intervention-policy.ts; o resto (política
// existe, está ativa, tem versão publicada, escopo compatível) só o backend sabe.

type PolicyNode = Extract<FlowNode, { type: "intervention_policy" }>
const policyNodes = (context: PublishGraphContext) => context.graph.nodes.filter((node): node is PolicyNode => node.type === "intervention_policy")

/** As referências de análise precisam ser nós ANTERIORES no caminho (o resultado delas existe quando o nó roda). */
export function validateInterventionPolicySources(context: PublishGraphContext): void {
  for (const node of policyNodes(context)) {
    const ancestors = findAncestorNodeIds(context.graph, node.id)
    for (const sourceId of node.config.analysisSourceNodeIds) {
      if (!ancestors.has(sourceId)) {
        throw new DomainError(`O nó "${node.label}" usa como referência de análise um nó que não vem antes dele no fluxo.`, "WORKFLOW_INTERVENTION_POLICY_SOURCE_NOT_ANCESTOR", 422, { nodeId: node.id })
      }
    }
  }
}

/** Política existe nesta organização, está ativa, tem versão publicada e alcança alguém da abrangência do Workflow. */
export async function validateInterventionPolicyReferences(context: PublishCatalogContext): Promise<void> {
  const nodes = policyNodes(context)
  if (nodes.length === 0) return
  const rows = await context.db.query<{ id: string; name: string; active: boolean; scope_type: string; team_id: string | null; subteam_id: string | null; subteam_team_id: string | null; published: number }>(
    `select p.id, p.name, p.active, p.scope_type, p.team_id, p.subteam_id, s.team_id subteam_team_id,
            (select count(*)::int from intervention_policy_versions v where v.policy_id = p.id and v.status = 'PUBLISHED') published
       from intervention_policies p left join subteams s on s.id = p.subteam_id
      where p.organization_id = $1 and p.id = any($2::uuid[])`,
    [context.organizationId, nodes.map((node) => node.config.policyId)],
  )
  const byId = new Map(rows.rows.map((row) => [row.id, row]))
  for (const node of nodes) {
    const policy = byId.get(node.config.policyId)
    if (!policy) throw new DomainError(`O nó "${node.label}" usa uma política de acompanhamento que não existe mais.`, "WORKFLOW_INTERVENTION_POLICY_NOT_FOUND", 422, { nodeId: node.id })
    if (!policy.active) throw new DomainError(`O nó "${node.label}" usa a política "${policy.name}", que está inativa.`, "WORKFLOW_INTERVENTION_POLICY_INACTIVE", 422, { nodeId: node.id })
    if (policy.published === 0) throw new DomainError(`A política "${policy.name}" ainda não tem versão publicada: publique a política antes do Workflow.`, "WORKFLOW_INTERVENTION_POLICY_UNPUBLISHED", 422, { nodeId: node.id })
    // Abrangência do Workflow × escopo da política: se NINGUÉM do Workflow pode estar no escopo, a política nunca se aplicaria.
    const { scopeType, teamId, subteamId } = context.row
    const disjoint =
      (policy.scope_type === "GROUP" && ((scopeType === "TEAM" && teamId !== policy.team_id) || (scopeType === "SUBTEAM" && teamId !== null && teamId !== policy.team_id))) ||
      (policy.scope_type === "SUBGROUP" && ((scopeType === "TEAM" && teamId !== policy.subteam_team_id) || (scopeType === "SUBTEAM" && subteamId !== policy.subteam_id)))
    if (disjoint) throw new DomainError(`A política "${policy.name}" vale para outro Grupo/Subgrupo: nenhum colaborador deste Workflow estaria no escopo dela.`, "WORKFLOW_INTERVENTION_POLICY_SCOPE_MISMATCH", 422, { nodeId: node.id })
  }
}
