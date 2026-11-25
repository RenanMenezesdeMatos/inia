import { resourceScopeLabel } from "@/lib/scope-links/scope-links"
import type { Team } from "@/schemas/admin/org-structure.schema"

type ScopeLinkLike = { teamId: string; teamName?: string | null; subteamId: string | null; subteamName?: string | null }

/** Rótulo amigável da Abrangência (Parte 8/29 do pedido) — mesmo texto usado na listagem de
 * Workflows/Orchestrators, reaproveitado no cabeçalho do editor (herança visual, nunca uma
 * segunda pergunta "qual grupo?"). Com vários Grupos (249): "Grupo A · Grupo B › B1". */
export function formatScopeLabel(scope: { scopeType: string; scopeLinks?: readonly ScopeLinkLike[] | null; teamName?: string | null; subteamName?: string | null }): string {
  return resourceScopeLabel(scope, "Todos os grupos")
}

export type ScopedLike = { scopeType: string; teamId?: string | null; subteamId?: string | null; scopeLinks?: readonly { teamId: string; subteamId: string | null }[] | null }

/** Grupos efetivos do alcance (Subgrupo → Grupo-pai). ALL_TEAMS não tem Grupo efetivo (tratado à parte). */
function effectiveTeamIds(teams: Team[], target: ScopedLike): string[] {
  if (target.scopeType === "GROUPS") return [...new Set((target.scopeLinks ?? []).map((link) => link.teamId))]
  if (target.scopeType === "TEAM") return target.teamId ? [target.teamId] : []
  if (target.scopeType === "SUBTEAM") {
    const teamId = target.teamId ?? teams.find((candidate) => candidate.subteams.some((subteam) => subteam.id === target.subteamId))?.id
    return teamId ? [teamId] : []
  }
  return []
}

/**
 * Espelha scopesAreCompatible do backend (manageable-scopes.ts) — mesma regra, só que
 * calculada no cliente (sem round-trip); `teams` só resolve o Grupo-pai do formato antigo (Subgrupo sem `teamId`),
 * pra filtrar pickers (Parte 24 do pedido: nunca oferecer uma referência cross-group). O
 * backend continua sendo quem decide de verdade — este filtro é só UX, nunca a autorização em
 * si.
 */
export function scopesAreCompatible(teams: Team[], referencer: ScopedLike, referenced: ScopedLike): boolean {
  if (referenced.scopeType === "ALL_TEAMS") return true
  if (referencer.scopeType === "ALL_TEAMS") return false
  // Com vários vínculos (249): cada Grupo efetivo de quem referencia precisa estar entre os do referenciado.
  const referencerTeams = effectiveTeamIds(teams, referencer)
  const referencedTeams = effectiveTeamIds(teams, referenced)
  return referencerTeams.length > 0 && referencerTeams.every((teamId) => referencedTeams.includes(teamId))
}
