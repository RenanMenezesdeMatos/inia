import type { Database } from "../../../infrastructure/database/pool.js"
import { workflowLiveScopeLinksSql } from "../../workflows/domain/workflow-scope.js"

/**
 * Políticas de acompanhamento ativas cuja versão publicada mais recente cita o indicador ou a flag. Sem o objeto, a condição viraria "dado insuficiente" para sempre, sem ninguém ver o motivo.
 * A citação fica na definição versionada, sem chave estrangeira.
 */
export async function loadPoliciesCiting(db: Pick<Database, "query">, organizationId: string, citation: { key: "indicatorCode" | "flagName"; value: string }): Promise<string[]> {
  const path = citation.key === "indicatorCode" ? "$.** ? (@.indicatorCode == $value)" : "$.** ? (@.flagName == $value)"
  const rows = await db.query<{ name: string }>(
    `select p.name from intervention_policies p
       join lateral (select v.definition from intervention_policy_versions v where v.policy_id = p.id and v.status = 'PUBLISHED' order by v.version desc limit 1) current on true
      where p.organization_id = $1 and p.active and jsonb_path_exists(current.definition, $2::jsonpath, jsonb_build_object('value', $3::text))
      order by p.name`,
    [organizationId, path, citation.value],
  )
  return rows.rows.map((row) => row.name)
}

/**
 * ONDE A POLÍTICA RODA: uma política só é avaliada quando um Workflow passa pelo nó "Avaliar política de acompanhamento" que a
 * cita — publicada e sem Workflow, ela não faz nada. `published` = o nó está na versão ATIVA; `inDraft` = está no rascunho do
 * editor (ainda não vale). A citação fica no grafo versionado, sem chave estrangeira.
 */
/** Abrangência PUBLICADA do Workflow (249): ALL_TEAMS ou GROUPS + `scopeLinks` (TEAM/SUBTEAM só em dado anterior à 249). */
export type PolicyWorkflowUsage = { id: string; name: string; active: boolean; published: boolean; inDraft: boolean; scopeType: "ALL_TEAMS" | "GROUPS" | "TEAM" | "SUBTEAM"; scopeLinks: { teamId: string; subteamId: string | null }[]; teamId: string | null; subteamId: string | null }

export async function loadPolicyWorkflowUsage(db: Pick<Database, "query">, organizationId: string, policyId: string): Promise<PolicyWorkflowUsage[]> {
  const rows = await db.query<{ id: string; name: string; active: boolean; published: boolean; in_draft: boolean; scope_type: PolicyWorkflowUsage["scopeType"]; scope_links: PolicyWorkflowUsage["scopeLinks"] | null; team_id: string | null; subteam_id: string | null }>(
    `select * from (
       select w.id, w.name, w.active, w.scope_type, ${workflowLiveScopeLinksSql("w.id")} scope_links, w.team_id, w.subteam_id,
              exists (select 1 from workflow_versions v where v.id = w.active_version_id and jsonb_path_exists(v.graph, '$.** ? (@.policyId == $id)', jsonb_build_object('id', $2::text))) published,
              (w.draft_graph is not null and jsonb_path_exists(w.draft_graph, '$.** ? (@.policyId == $id)', jsonb_build_object('id', $2::text))) in_draft
         from workflows w where w.organization_id = $1) usage
      where usage.published or usage.in_draft
      order by usage.name`,
    [organizationId, policyId],
  )
  return rows.rows.map((row) => ({ id: row.id, name: row.name, active: row.active, published: row.published, inDraft: row.in_draft, scopeType: row.scope_type, scopeLinks: row.scope_links ?? [], teamId: row.team_id, subteamId: row.subteam_id }))
}
