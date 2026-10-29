import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { getManageableScopes } from "../../auth/application/manageable-scopes.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import type { CaseOwnership, CaseVisibility } from "./case-repository.js"

/**
 * QUEM VÊ UM CASO DE SUPERVISÃO. O caso traz diagnóstico, evidências (trechos de atendimento) e feedbacks — inclusive os ainda
 * não publicados — sobre UM colaborador. Vê quem:
 *   1. alcança o colaborador pela MESMA autoridade de Indicadores/Equipe (subárvore real de reports_to ∪ escopo de
 *      `indicators.view`) — o líder dele e quem tem a visão ampliada;
 *   2. administra Agents (`agents.manage`) num escopo que cobre o Grupo/Subgrupo do colaborador — o detalhe da execução de
 *      um Agent leva ao caso que ela gerou.
 * O próprio colaborador não abre o caso (recebe o feedback publicado no Acompanhamento) — nem quando também administra Agents
 * no Grupo dele ou na organização (achado C17 da 4ª auditoria). Organização = a da sessão.
 */
export async function loadCaseVisibility(db: Database, user: AuthTokenPayload): Promise<CaseVisibility> {
  // Conta sem pessoa no cadastro: nenhuma estrutura visível (falha fechada — lista vazia, detalhe 404), nunca um erro.
  const viewerScope = loadViewerScope(new PgAnalyticsReadRepository(db), user, "indicators.view").catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "PERSON_NOT_FOUND") return null
    throw error
  })
  const [scope, agentScopes] = await Promise.all([viewerScope, getManageableScopes(db, user, "agents.manage")])
  const organizationWide = agentScopes.unrestricted || agentScopes.allTeams
  return {
    organizationId: user.organizationId,
    viewerPersonId: user.personId,
    operatorIds: scope ? [...scope.nodes.keys()] : [],
    organizationWide,
    teamIds: agentScopes.unrestricted ? [] : [...agentScopes.teamIds],
    subteamIds: agentScopes.unrestricted ? [] : [...agentScopes.subteamIds],
  }
}

export function caseVisibleTo(visibility: CaseVisibility, owner: CaseOwnership): boolean {
  if (owner.operatorId === visibility.viewerPersonId) return false
  if (visibility.organizationWide) return true
  if (visibility.operatorIds.includes(owner.operatorId)) return true
  if (owner.teamId !== null && visibility.teamIds.includes(owner.teamId)) return true
  return owner.subteamId !== null && visibility.subteamIds.includes(owner.subteamId)
}
