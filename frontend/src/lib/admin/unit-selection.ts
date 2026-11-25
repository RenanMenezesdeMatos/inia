/**
 * Vários Grupos e Subgrupos de um filtro, como vão para o servidor (chaves repetidas). Sem escolha = `undefined` (nunca lista vazia). A
 * regra é a do backend (`unit-filter.ts`): entra quem está num Subgrupo escolhido, ou num Grupo escolhido que não tenha Subgrupo
 * escolhido — o Subgrupo refina o Grupo dele.
 */
export type OrgUnitIds = { teamId?: string[] | undefined; subteamId?: string[] | undefined }

/** Grupo de cada Subgrupo escolhido (id do Subgrupo → id do Grupo). */
export type SubteamParents = ReadonlyMap<string, string>

/** Teto de escolhas de um filtro (Grupos + Subgrupos): a URL cabe no limite padrão do IIS. */
export const MAX_FILTER_UNITS = 30

export const hasOrgUnits = (value: OrgUnitIds): boolean => Boolean(value.teamId?.length || value.subteamId?.length)
export const idsOrUndefined = (ids: readonly string[]): string[] | undefined => (ids.length > 0 ? [...ids] : undefined)

/** Grupos escolhidos que nenhum Subgrupo escolhido refina. */
export function wholeTeams(value: OrgUnitIds, parents: SubteamParents): Set<string> {
  const refined = new Set((value.subteamId ?? []).map((id) => parents.get(id)))
  return new Set((value.teamId ?? []).filter((id) => !refined.has(id)))
}

/** O Grupo/Subgrupo cabe na escolha? Sem escolha, tudo cabe. */
export function coversUnit(value: OrgUnitIds, unit: { teamId: string | null; subteamId: string | null }, parents: SubteamParents): boolean {
  if (!hasOrgUnits(value)) return true
  return (unit.subteamId !== null && Boolean(value.subteamId?.includes(unit.subteamId))) || (unit.teamId !== null && wholeTeams(value, parents).has(unit.teamId))
}

/** A escolha estreitada a um Grupo (detalhar a linha dele): ele inteiro, ou só os Subgrupos dele que já estavam escolhidos. */
export function narrowToTeam(value: OrgUnitIds, teamId: string, parents: SubteamParents): OrgUnitIds {
  return { teamId: [teamId], subteamId: idsOrUndefined((value.subteamId ?? []).filter((id) => parents.get(id) === teamId)) }
}
