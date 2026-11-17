import type { OrgScopeFilter } from "@/lib/admin/list-query"
import type { Team } from "@/schemas/admin/org-structure.schema"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

/**
 * HIERARQUIA DOS SELETORES — organização → universo de atuação → Grupo → Subgrupo → pessoa/recurso. Escolhido um nível, os de baixo
 * só oferecem o que é compatível com ele; trocar um nível de cima limpa a escolha de baixo que deixou de caber. É só UX: o backend
 * continua recusando o vínculo entre universos (`OPERATING_UNIVERSE_LINK_CONFLICT`) e o alcance fora do escopo.
 *
 * Regra do universo (a mesma do backend, `resource-universe.ts`): universos são separados; RECURSO pendente (nulo) não conflita — é
 * pendência a classificar, então continua oferecido. Grupo/Subgrupo sem universo, ao contrário, some quando há universo escolhido
 * (`unitFitsUniverse`). O Grupo tem o próprio universo; o Subgrupo traz o EFETIVO
 * (o dele ou, sem ele, o do Grupo-pai) — `GET /admin/org-structure/teams`.
 */

/** Valor do filtro "Universo" das listas (`?operatingUniverse=`): um universo ou `PENDING` (sem classificação). */
export type UniverseFilterValue = OperatingUniverse | "PENDING"

/** Universos escolhidos num filtro/campo: um, vários (filtro múltiplo) ou nenhum (= sem restrição). */
export type UniverseChoice = OperatingUniverse | readonly string[] | null | undefined

function chosenUniverses(choice: UniverseChoice): readonly string[] | null {
  if (!choice) return null
  if (typeof choice === "string") return [choice]
  // "PENDING" no filtro de lista = "sem universo": sozinho não restringe as opções de baixo (pendente cabe em qualquer um); junto com
  // universos, valem esses universos (e os pendentes, que sempre cabem).
  const universes = choice.filter((value) => value !== "PENDING")
  return universes.length ? universes : null
}

/** O item (com o universo dele) cabe na escolha de universo? Nulo/indefinido no item = pendente = cabe. */
export function fitsUniverse(itemUniverse: string | null | undefined, choice: UniverseChoice): boolean {
  const universes = chosenUniverses(choice)
  if (!universes || !itemUniverse) return true
  return universes.includes(itemUniverse)
}

/**
 * Grupo/Subgrupo cabe na escolha de universo? Regra decidida (17/11, sessão de Alinhamentos): escolhido um universo, Grupo/Subgrupo
 * ainda SEM universo classificado não aparece — só os classificados naquele universo. Sem escolha, tudo cabe.
 */
export function unitFitsUniverse(unitUniverse: string | null | undefined, choice: UniverseChoice): boolean {
  const universes = chosenUniverses(choice)
  if (!universes) return true
  return Boolean(unitUniverse) && universes.includes(unitUniverse!)
}

/** Só os itens compatíveis com o universo escolhido — mantém `keep` (o valor já salvo) visível, para nunca sumir em silêncio. */
export function filterByUniverse<T extends { operatingUniverse?: string | null }>(items: readonly T[], choice: UniverseChoice, keep?: (item: T) => boolean): T[] {
  return items.filter((item) => fitsUniverse(item.operatingUniverse, choice) || Boolean(keep?.(item)))
}

export type UniverseTeam = Team & { /** O Grupo inteiro cabe no universo (e não só algum Subgrupo dele). */ selectable: boolean }

/**
 * Grupos e Subgrupos do universo escolhido. Um Grupo de outro universo ainda aparece (não selecionável como "grupo inteiro") se tiver
 * Subgrupo do universo escolhido — o Subgrupo pode ter universo próprio diferente do Grupo-pai (migration 204).
 */
export function teamsForUniverse(teams: readonly Team[], choice: UniverseChoice): UniverseTeam[] {
  return teams.flatMap((team) => {
    const selectable = unitFitsUniverse(team.operatingUniverse, choice)
    // `?? []`: Grupo sem a lista de Subgrupos (resposta parcial) continua um Grupo válido.
    const subteams = (team.subteams ?? []).filter((subteam) => unitFitsUniverse(subteam.operatingUniverse ?? team.operatingUniverse, choice))
    if (!selectable && subteams.length === 0) return []
    return [{ ...team, subteams, selectable }]
  })
}

/** O Grupo/Subgrupo escolhido continua cabendo no universo? Sem Grupo/Subgrupo (ou "todos os grupos") = cabe. */
export function teamScopeFitsUniverse(teams: readonly Team[], scope: { teamId?: string | null; subteamId?: string | null }, choice: UniverseChoice): boolean {
  if (scope.subteamId) {
    const team = teams.find((candidate) => (candidate.subteams ?? []).some((subteam) => subteam.id === scope.subteamId))
    const subteam = team?.subteams.find((candidate) => candidate.id === scope.subteamId)
    return !team || unitFitsUniverse(subteam?.operatingUniverse ?? team.operatingUniverse, choice)
  }
  if (scope.teamId) {
    const team = teams.find((candidate) => candidate.id === scope.teamId)
    return !team || unitFitsUniverse(team.operatingUniverse, choice)
  }
  return true
}

/** Filtro de Grupo/Subgrupo depois de trocar o universo: limpa se deixou de caber. */
export function orgScopeAfterUniverseChange(scope: OrgScopeFilter, teams: readonly Team[] | undefined, choice: UniverseChoice): OrgScopeFilter {
  if (!teams) return scope
  return teamScopeFitsUniverse(teams, scope, choice) ? scope : {}
}

/** Um Grupo (id) depois de trocar o universo: o mesmo id se ainda cabe, senão vazio. */
export function teamIdAfterUniverseChange<T extends string | undefined | null>(teamId: T, teams: readonly Team[] | undefined, choice: UniverseChoice): T | undefined {
  if (!teamId || !teams) return teamId
  return teamScopeFitsUniverse(teams, { teamId }, choice) ? teamId : undefined
}

/** Campos do filtro de Grupo/Subgrupo explícitos (para `patchFilters` limpar o que sumiu, em vez de manter o valor anterior). */
export function orgScopePatch(scope: OrgScopeFilter): { scopeType: OrgScopeFilter["scopeType"] | undefined; teamId: string | undefined; subteamId: string | undefined } {
  return { scopeType: scope.scopeType, teamId: scope.teamId, subteamId: scope.subteamId }
}

type ScopedEntry = { scopeType: string; teamId?: string | null; subteamId?: string | null }

/**
 * Um recurso com alcances (ex.: base de conhecimento com N Grupos/Subgrupos) vale no Grupo/Subgrupo escolhido? Vale se algum alcance
 * for "todos os grupos", o próprio Grupo, ou — com Grupo escolhido — um Subgrupo dele; com Subgrupo escolhido, o Subgrupo ou o Grupo-pai.
 * Sem Grupo/Subgrupo escolhido (ou "só globais"), tudo cabe.
 */
export function scopesFitOrgScope(entries: readonly ScopedEntry[], scope: OrgScopeFilter, teams: readonly Team[] | undefined): boolean {
  if (!scope.teamId && !scope.subteamId) return true
  const teamOfSubteam = (subteamId: string | null | undefined) => teams?.find((team) => (team.subteams ?? []).some((subteam) => subteam.id === subteamId))?.id
  const teamId = scope.teamId ?? teamOfSubteam(scope.subteamId)
  return entries.some((entry) => {
    if (entry.scopeType === "ALL_TEAMS") return true
    if (entry.scopeType === "TEAM") return Boolean(entry.teamId) && entry.teamId === teamId
    if (scope.subteamId) return entry.subteamId === scope.subteamId
    return Boolean(entry.subteamId) && (entry.teamId === teamId || teamOfSubteam(entry.subteamId) === teamId)
  })
}
