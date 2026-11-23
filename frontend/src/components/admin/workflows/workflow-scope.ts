import { resourceScopePayloadOf, scopeValueFromResource, type ResourceScopePayload } from "@/lib/scope-links/scope-links"

type WorkflowScopeLike = { scopeType: string; scopeLinks?: readonly { teamId: string; subteamId: string | null }[] | null }

/**
 * Abrangência do Workflow (249) no formato da API (`scopeType` ALL_TEAMS | GROUPS + `scopeLinks`) — o que a prévia da agenda e o
 * filtro de Orquestradores do editor recebem.
 */
export function workflowScopePayload(workflow: WorkflowScopeLike): ResourceScopePayload {
  return resourceScopePayloadOf(scopeValueFromResource(workflow))
}

/**
 * Grupos da Abrangência (null = "Todos os Grupos e Subgrupos"). Um Subgrupo escolhido conta pelo Grupo-pai — o mesmo critério do
 * backend (`scopesAreCompatible`) para a âncora da Estrutura Consolidada e do Filtro Populacional.
 */
export function workflowScopeTeamIds(workflow: WorkflowScopeLike): ReadonlySet<string> | null {
  if (workflow.scopeType === "ALL_TEAMS") return null
  return new Set((workflow.scopeLinks ?? []).map((link) => link.teamId))
}
