/**
 * ESCOPO de uma atribuição — sobre QUAIS recursos organizacionais ela vale. Estruturado (nunca string livre), reaproveitando
 * a taxonomia que o produto já tem: organização (antes ALL_TEAMS), Grupo (TEAM), Subgrupo (SUBTEAM) e "Minha estrutura" (a
 * subárvore por reports_to_id da pessoa que RECEBE o papel — a mesma CTE de `loadDescendants`). Escopo ≠ hierarquia: um papel
 * no Subgrupo Contas vale para Contas independentemente de a pessoa ser gestora de alguém.
 */
export const ACCESS_SCOPE_TYPES = ["ORGANIZATION", "GROUP", "SUBGROUP", "MY_STRUCTURE"] as const
export type AccessScopeType = (typeof ACCESS_SCOPE_TYPES)[number]
export type AccessScope =
  | { type: "ORGANIZATION" }
  | { type: "GROUP"; teamId: string }
  | { type: "SUBGROUP"; subteamId: string; teamId: string }
  | { type: "MY_STRUCTURE" }

/** Um colaborador como RECURSO de uma checagem de escopo (estrutura atual da pessoa). */
export type CollaboratorResource = { personId: string; teamId: string | null; subteamId: string | null }

/**
 * `outer` cobre `inner`? ORGANIZATION cobre tudo; GROUP cobre o próprio Grupo e os Subgrupos dele; SUBGROUP só a si mesmo;
 * MY_STRUCTURE (relativo a quem recebe) só é coberto por ORGANIZATION — nenhum outro escopo pode provar que a estrutura de
 * alguém cabe nele.
 */
export function scopeCovers(outer: AccessScope, inner: AccessScope): boolean {
  if (outer.type === "ORGANIZATION") return true
  if (inner.type === "ORGANIZATION" || inner.type === "MY_STRUCTURE" || outer.type === "MY_STRUCTURE") return false
  if (outer.type === "GROUP") return inner.teamId === outer.teamId
  return inner.type === "SUBGROUP" && inner.subteamId === outer.subteamId
}

/** O escopo alcança este colaborador? `inStructure` = o colaborador está na estrutura (reports_to) de quem tem o papel. */
export function scopeReachesCollaborator(scope: AccessScope, collaborator: CollaboratorResource, inStructure: boolean): boolean {
  switch (scope.type) {
    case "ORGANIZATION":
      return true
    case "GROUP":
      return collaborator.teamId === scope.teamId
    case "SUBGROUP":
      return collaborator.subteamId === scope.subteamId
    case "MY_STRUCTURE":
      return inStructure
  }
}
