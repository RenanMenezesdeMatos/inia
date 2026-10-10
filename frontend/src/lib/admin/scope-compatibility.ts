import type { Team } from "@/schemas/admin/org-structure.schema"

/** Rótulo amigável da Abrangência (Parte 8/29 do pedido) — mesmo texto usado na listagem de
 * Workflows/Orchestrators, reaproveitado no cabeçalho do editor (herança visual, nunca uma
 * segunda pergunta "qual grupo?"). */
export function formatScopeLabel(scope: { scopeType: string; teamName: string | null; subteamName: string | null }): string {
  if (scope.scopeType === "ALL_TEAMS") return "Todos os grupos"
  return scope.subteamName ?? scope.teamName ?? "—"
}

export type ScopedLike = { scopeType: string; teamId?: string | null; subteamId?: string | null }

function effectiveTeamId(teams: Team[], target: ScopedLike): string | null {
  if (target.scopeType === "TEAM") return target.teamId ?? null
  if (target.scopeType === "SUBTEAM") {
    const team = teams.find((candidate) => candidate.subteams.some((subteam) => subteam.id === target.subteamId))
    return team?.id ?? null
  }
  return null
}

/**
 * Espelha scopesAreCompatible do backend (manageable-scopes.ts) — mesma regra, só que
 * calculada a partir da árvore de times/subgrupos já carregada no cliente (sem round-trip),
 * pra filtrar pickers (Parte 24 do pedido: nunca oferecer uma referência cross-group). O
 * backend continua sendo quem decide de verdade — este filtro é só UX, nunca a autorização em
 * si.
 */
export function scopesAreCompatible(teams: Team[], referencer: ScopedLike, referenced: ScopedLike): boolean {
  if (referenced.scopeType === "ALL_TEAMS") return true
  if (referencer.scopeType === "ALL_TEAMS") return false
  const referencerTeam = effectiveTeamId(teams, referencer)
  const referencedTeam = effectiveTeamId(teams, referenced)
  return referencerTeam !== null && referencerTeam === referencedTeam
}
