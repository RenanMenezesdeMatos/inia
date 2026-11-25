import type { OrgScopeFilter } from "@/lib/admin/list-query"
import { hasOrgUnits, wholeTeams, type SubteamParents } from "@/lib/admin/unit-selection"
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

/** Campos do filtro de Grupo/Subgrupo explícitos (para `patchFilters` limpar o que sumiu, em vez de manter o valor anterior). */
export function orgScopePatch(scope: OrgScopeFilter): { scopeType: OrgScopeFilter["scopeType"] | undefined; teamId: string[] | undefined; subteamId: string[] | undefined } {
  return { scopeType: scope.scopeType, teamId: scope.teamId, subteamId: scope.subteamId }
}

type ScopedEntry = { scopeType: string; teamId?: string | null; subteamId?: string | null }

/**
 * Um recurso com alcances (ex.: base de conhecimento com N Grupos/Subgrupos) vale em algum Grupo/Subgrupo escolhido? Vale se algum
 * alcance for "todos os grupos", um Grupo escolhido inteiro (ou Subgrupo dele), um Subgrupo escolhido ou o Grupo-pai de um. Sem
 * Grupo/Subgrupo escolhido (ou "só globais"), tudo cabe. `parents`: o Grupo de cada Subgrupo escolhido.
 */
export function scopesFitOrgScope(entries: readonly ScopedEntry[], scope: OrgScopeFilter, parents: SubteamParents): boolean {
  if (!hasOrgUnits(scope)) return true
  const teams = wholeTeams(scope, parents)
  const refinedTeams = new Set((scope.subteamId ?? []).map((id) => parents.get(id)))
  return entries.some((entry) => {
    if (entry.scopeType === "ALL_TEAMS") return true
    if (entry.scopeType === "TEAM") return Boolean(entry.teamId) && (teams.has(entry.teamId!) || refinedTeams.has(entry.teamId!))
    return (Boolean(entry.subteamId) && Boolean(scope.subteamId?.includes(entry.subteamId!))) || (Boolean(entry.teamId) && teams.has(entry.teamId!))
  })
}
