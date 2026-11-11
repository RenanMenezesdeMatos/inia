import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { ManageableScopes } from "../../auth/application/manageable-scopes.js"

/**
 * Quem vê (e age sobre) uma EXECUÇÃO de Workflow — a mesma regra por pessoa da aba Resultados (workflow-results-reader.ts):
 * o Workflow já foi autorizado pela rota (`workflows.manage` na Abrangência publicada), mas cada execução só aparece se a
 * PESSOA de quem ela trata está hoje no escopo de gestão de quem pergunta (Organização → todas; Grupo → o Grupo e seus
 * Subgrupos; Subgrupo → só ele). A Abrangência atual do Workflow não decide isso: depois de mover o Workflow de Grupo
 * (rascunho + Publicar) ou de a pessoa trocar de Grupo, as execuções antigas continuam sendo sobre quem eram.
 *
 * Pessoa da execução = agenda individual, operador da interação ou sujeito PERSON da medição (a mesma ordem da aba
 * Resultados). Execução sem pessoa (raiz de um Consolidado ou de um fan-out) vale pela Abrangência gravada na VERSÃO que
 * a executou; versão sem Abrangência gravada (anterior à migration 144) ou de toda a organização só para quem alcança a
 * organização — falha fechada.
 */
export type EnrollmentSubjectScope = { allTeams: boolean; teamIds: string[]; subteamIds: string[] }

export function enrollmentSubjectScopeOf(scopes: ManageableScopes): EnrollmentSubjectScope {
  return scopes.unrestricted ? { allTeams: true, teamIds: [], subteamIds: [] } : { allTeams: scopes.allTeams, teamIds: [...scopes.teamIds], subteamIds: [...scopes.subteamIds] }
}

/** Parâmetros na ordem que `visibleEnrollmentSql`/`personInScopeSql` esperam (allTeams, Grupos, Subgrupos). */
export function enrollmentSubjectScopeParams(scope: EnrollmentSubjectScope): [boolean, string[], string[]] {
  return [scope.allTeams, scope.teamIds, scope.subteamIds]
}

type Placeholders = { allTeams: string; teamIds: string; subteamIds: string }

/** Pessoa (alias de `people`) no escopo. */
export function personInScopeSql(person: string, p: Placeholders): string {
  return `(${p.allTeams}::boolean or coalesce(${person}.team_id = any(${p.teamIds}::uuid[]) or ${person}.subteam_id = any(${p.subteamIds}::uuid[]), false))`
}

/** Pessoa de quem a execução (alias de `workflow_enrollments`) trata; null = execução sem pessoa. */
function enrollmentSubjectSql(we: string): string {
  return `coalesce(
    ${we}.scheduled_subject_id,
    (select i.operator_id from interactions i where i.id = ${we}.interaction_id and i.organization_id = ${we}.organization_id),
    (select m.subject_id from indicator_measurements_all m where m.id = ${we}.indicator_measurement_id and m.subject_type = 'PERSON'))`
}

/** Predicado SQL: a execução `we` é visível para o escopo dos placeholders. */
export function visibleEnrollmentSql(we: string, p: Placeholders): string {
  return `(${p.allTeams}::boolean or coalesce(
    (select ${personInScopeSql("vp", p)} from people vp where vp.id = ${enrollmentSubjectSql(we)} and vp.organization_id = ${we}.organization_id),
    (select (vv.scope_type = 'TEAM' and vv.team_id = any(${p.teamIds}::uuid[])) or (vv.scope_type = 'SUBTEAM' and vv.subteam_id = any(${p.subteamIds}::uuid[]))
       from workflow_versions vv where vv.id = ${we}.version_id and ${enrollmentSubjectSql(we)} is null),
    false))`
}

/** A execução precisa ser deste Workflow e da organização, e a pessoa dela estar no escopo; fora disso é 404 (nunca 403). */
export async function assertEnrollmentVisible(db: Pick<Database, "query">, organizationId: string, workflowId: string, enrollmentId: string, scope: EnrollmentSubjectScope, code = "WORKFLOW_ENROLLMENT_NOT_FOUND"): Promise<void> {
  const found = await db.query(
    `select 1 from workflow_enrollments we
      where we.id = $1 and we.workflow_id = $2 and we.organization_id = $3
        and ${visibleEnrollmentSql("we", { allTeams: "$4", teamIds: "$5", subteamIds: "$6" })}`,
    [enrollmentId, workflowId, organizationId, ...enrollmentSubjectScopeParams(scope)],
  )
  if (!found.rows[0]) throw new DomainError("Execução não encontrada.", code, 404)
}
