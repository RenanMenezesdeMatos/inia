import type { Database } from "../../../infrastructure/database/pool.js"
import type { PopulationFilter } from "../domain/population-filter-schema.js"
import { structureAnchorPersonId, type StructureAnchor } from "../domain/structure-anchor-schema.js"
import { workflowReachOf, workflowReachParams, workflowReachSql, type WorkflowScopeInput } from "../domain/workflow-scope.js"

/**
 * Peça que faltava no motor (achado da auditoria da evolução de Abrangência/Unidade de Análise):
 * `resolveByRoleChain` (enrollment-subject.ts) só anda pra CIMA na hierarquia (de um operador até
 * um cargo ancestral — pra Escalonar/Output/Human Review saberem "pra quem"). Estrutura
 * Consolidada e Filtro Populacional precisam do caminho INVERSO: de uma pessoa-âncora (Supervisor/
 * Coordenador/Gerente/Gerente Sênior/Diretor) até o CONJUNTO de operadores abaixo dela.
 */

/** Equipe direta de um Supervisor — só os operadores que reportam a ele, nunca a estrutura
 * inteira ("Equipe de Supervisor" = o time dele, não uma cadeia de gerência). */
export async function resolveDirectReportOperatorIds(db: Database, supervisorId: string): Promise<string[]> {
  const result = await db.query<{ id: string }>(`select id from people where reports_to_id = $1 and role = 'OPERATOR'`, [supervisorId])
  return result.rows.map((row) => row.id)
}

/** Estrutura inteira abaixo de uma pessoa (Coordenador/Gerente/Gerente Sênior/Diretor) — desce
 * `reports_to_id` recursivamente até as folhas com role OPERATOR. Uma CTE recursiva resolve isso
 * em uma única ida ao banco, independente de quantos níveis existirem entre a âncora e os
 * operadores ("Estrutura da Coordenadora Fátima" pode ter Supervisores no meio). */
export async function resolveStructureOperatorIds(db: Database, anchorId: string): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `with recursive subordinates as (
       select id, role, reports_to_id from people where reports_to_id = $1
       union all
       select p.id, p.role, p.reports_to_id from people p join subordinates s on p.reports_to_id = s.id
     )
     select id from subordinates where role = 'OPERATOR'`,
    [anchorId],
  )
  return result.rows.map((row) => row.id)
}

export async function resolveTeamOperatorIds(db: Database, teamId: string): Promise<string[]> {
  const result = await db.query<{ id: string }>(`select id from people where team_id = $1 and role = 'OPERATOR'`, [teamId])
  return result.rows.map((row) => row.id)
}

export async function resolveSubteamOperatorIds(db: Database, subteamId: string): Promise<string[]> {
  const result = await db.query<{ id: string }>(`select id from people where subteam_id = $1 and role = 'OPERATOR'`, [subteamId])
  return result.rows.map((row) => row.id)
}

/**
 * Despacha pro resolvedor certo conforme a Estrutura (Consolidada ou a parte "estrutura" do
 * Filtro Populacional) — usado pelo agendamento em modo Consolidado (schedule-check.ts), pela
 * agregação da Condition histórica (node-handlers.ts), e pelo Filtro Populacional em modo
 * Individual (`resolvePopulationFilterOperatorIds` abaixo). `anchorId` é a pessoa-âncora
 * (`consolidatedStructureAnchorId`/`populationFilterAnchorId`) pras estruturas baseadas em
 * pessoa; pra SUBTEAM/TEAM o próprio `structure` já carrega o id do subgrupo/grupo.
 */
export async function resolveStructureAnchorOperatorIds(db: Database, structure: StructureAnchor, anchorId: string | null): Promise<string[]> {
  switch (structure.kind) {
    case "SUPERVISOR_TEAM":
      return anchorId ? resolveDirectReportOperatorIds(db, anchorId) : []
    case "SUBTEAM":
      return resolveSubteamOperatorIds(db, structure.subteamId)
    case "TEAM":
      return resolveTeamOperatorIds(db, structure.teamId)
    case "COORDINATOR_STRUCTURE":
    case "MANAGER_STRUCTURE":
    case "SENIOR_MANAGER_STRUCTURE":
    case "DIRECTOR_STRUCTURE":
      return anchorId ? resolveStructureOperatorIds(db, anchorId) : []
  }
}

/** Abrangência (ALL_TEAMS ou GROUPS + `scopeLinks`; o legado TEAM/SUBTEAM + ids continua entendido — workflow-scope.ts). */
export type WorkflowScopeRef = WorkflowScopeInput & {
  /** Universo do Workflow — obrigatório para nenhum chamador esquecer o filtro. */
  operatingUniverse: string | null
  /**
   * "Somente quem tem acesso ativo à INIA" (migration 225) — obrigatório para cada chamador DECIDIR: `true` só para quem está
   * resolvendo QUEM ENTRA numa execução; população de comparação (quartil, ranking) passa sempre `false`.
   */
  requireActiveAccess: boolean
}

/** Conta de acesso ativa da pessoa `alias` — a ÚNICA definição de "acesso ativo" para Workflows (senha temporária pendente conta: liberar o acesso é o ato). */
export function activeAccessSql(alias: string): string {
  return `exists (select 1 from user_accounts ua where ua.person_id = ${alias}.id and ua.organization_id = ${alias}.organization_id and ua.active)`
}

/** Todo operador ativo elegível pela Abrangência do Workflow — o mesmo universo que hoje
 * matricula um-por-operador quando não existe filtro nenhum (`ALL`, ausente = sempre foi assim).
 * Reaproveitado por `resolvePopulationFilterOperatorIds` e por workflow-eligibility.ts.
 * ALL_TEAMS = todos os Grupos (do universo), inclusive os criados depois da publicação: a população é resolvida AGORA, a cada execução.
 * Vínculo de Grupo inteiro casa por `team_id`; de Subgrupo, só por `subteam_id` (nunca os irmãos). Uma condição sobre a linha da
 * pessoa — cada operador uma vez, por mais vínculos que o alcancem. GROUPS sem vínculo e `scope_type` desconhecido não elegem ninguém. */
export async function resolveScopeOperatorIds(db: Database, organizationId: string, scope: WorkflowScopeRef): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `select id from people where organization_id = $1 and role = 'OPERATOR' and active
       and ${workflowReachSql("people", { all: "$2", wholeTeamIds: "$3", subteamIds: "$4" })}
       -- Universo: com a exigência ativa, só operadores do universo do Workflow (Workflow pendente não elege ninguém).
       and (not exists (select 1 from organizations o where o.id = $1 and o.operating_universe_enforced_at is not null) or operating_universe = $5::text)
       -- "Somente quem tem acesso ativo à INIA": só quem tem conta de acesso ativa.
       and (not $6::boolean or ${activeAccessSql("people")})`,
    [organizationId, ...workflowReachParams(workflowReachOf(scope)), scope.operatingUniverse, scope.requireActiveAccess],
  )
  return result.rows.map((row) => row.id)
}

/**
 * Resolve o Filtro Populacional (modo Individual) pro conjunto de operadores elegíveis — NUNCA
 * uma análise agregada, é só quem participa: cada um continua tendo sua própria matrícula
 * individual (ver schedule-check.ts). `ALL` (ausente) = todo operador ativo da Abrangência;
 * `EMPLOYEE` = só aquela pessoa; as demais reaproveitam exatamente a mesma resolução de estrutura
 * usada pelo modo Consolidado.
 */
export async function resolvePopulationFilterOperatorIds(
  db: Database,
  organizationId: string,
  filter: PopulationFilter | null,
  scope: WorkflowScopeRef,
): Promise<string[]> {
  if (!filter || filter.kind === "ALL") return resolveScopeOperatorIds(db, organizationId, scope)
  // Abrangência E Filtro (nunca alternativas): um filtro por pessoa/estrutura só elege quem também
  // está na Abrangência — mesma regra da decisão pontual (workflow-eligibility.ts).
  const inScope = new Set(await resolveScopeOperatorIds(db, organizationId, scope))
  if (filter.kind === "EMPLOYEE") return inScope.has(filter.employeeId) ? [filter.employeeId] : []
  const members = await resolveStructureAnchorOperatorIds(db, filter, structureAnchorPersonId(filter))
  return members.filter((id) => inScope.has(id))
}
