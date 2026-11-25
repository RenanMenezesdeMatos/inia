"use client"

import { ActiveFilterChips, type ActiveFilter } from "@/components/admin/shared/list/list-filters"
import { OrgUnitMultiFilter, parentsOf, useSelectedOrgUnits } from "@/components/admin/shared/list/org-unit-multi-filter"
import { idsOrUndefined, type OrgUnitIds, type SubteamParents } from "@/lib/admin/unit-selection"
import { unitFitsUniverse, type UniverseChoice } from "@/lib/operating-universe/hierarchy"
import type { OrgUnitSource } from "@/queries/scope-units/use-org-units"

/** Escolha completa (o que sumiu vem `undefined`, para o estado da tela não guardar o valor anterior) e o Grupo de cada Subgrupo dela. */
export type OrgUnitChange = (value: { teamId: string[] | undefined; subteamId: string[] | undefined }, parents: SubteamParents) => void

/**
 * Escolha de vários Grupos e Subgrupos: trocar os Grupos mantém os Subgrupos que continuam dentro deles (ou todos, sem Grupo escolhido) e
 * limpa os que deixaram de caber. Subgrupo cujo Grupo ainda não chegou fica: quem decide o resultado é o servidor.
 */
export function useUnitSelection(source: OrgUnitSource, value: OrgUnitIds, onChange: OrgUnitChange) {
  const teamIds = value.teamId ?? []
  const subteamIds = value.subteamId ?? []
  const teams = useSelectedOrgUnits(source, "TEAM", teamIds)
  const subteams = useSelectedOrgUnits(source, "SUBTEAM", subteamIds)
  const parents = parentsOf(subteams.units)
  function chooseTeams(next: readonly string[]) {
    const kept = next.length === 0 ? subteamIds : subteamIds.filter((id) => { const parent = parents.get(id); return !parent || next.includes(parent) })
    onChange({ teamId: idsOrUndefined(next), subteamId: idsOrUndefined(kept) }, parents)
  }
  function chooseSubteams(next: readonly string[], known: SubteamParents = parents) {
    onChange({ teamId: idsOrUndefined(teamIds), subteamId: idsOrUndefined(next) }, known)
  }
  const chips: ActiveFilter[] = [
    ...teamIds.map((id) => ({ key: `team:${id}`, label: `Grupo: ${teams.labelOf(id)}`, onClear: () => chooseTeams(teamIds.filter((entry) => entry !== id)) })),
    ...subteamIds.map((id) => ({ key: `subteam:${id}`, label: `Subgrupo: ${subteams.labelOf(id)}`, onClear: () => chooseSubteams(subteamIds.filter((entry) => entry !== id)) })),
  ]
  return { teamIds, subteamIds, teams, subteams, chooseTeams, chooseSubteams, chips }
}

/**
 * Filtros de Grupo e de Subgrupo, lado a lado, com VÁRIAS escolhas em cada um, busca no servidor e carregamento em lotes. Com Grupos
 * escolhidos, só os Subgrupos deles; sem Grupo, a busca de Subgrupo vale para tudo o que o alcance permite, com o Grupo de origem à
 * vista. Os selos dos escolhidos ficam embaixo dos filtros, um "x" em cada (`showChips={false}` quando a lista já os mostra).
 */
export function TeamSubteamFilters({
  source,
  value,
  onChange,
  universes,
  teamLabel = "Qualquer grupo",
  subteamLabel = "Qualquer subgrupo",
  showChips = true,
  disabled = false,
}: {
  source: OrgUnitSource
  value: OrgUnitIds
  onChange: OrgUnitChange
  universes?: readonly string[] | undefined
  teamLabel?: string
  subteamLabel?: string
  showChips?: boolean
  disabled?: boolean
}) {
  const { teamIds, subteamIds, chooseTeams, chooseSubteams, chips } = useUnitSelection(source, value, onChange)
  return (
    <>
      <OrgUnitMultiFilter kind="TEAM" source={source} universes={universes} value={teamIds} onChange={(ids) => chooseTeams(ids)} otherSelected={subteamIds.length} anyLabel={teamLabel} ariaLabel="Filtrar por grupo" disabled={disabled} />
      <OrgUnitMultiFilter kind="SUBTEAM" source={source} universes={universes} teamIds={teamIds} value={subteamIds} onChange={(ids, units) => chooseSubteams(ids, parentsOf(units))} otherSelected={teamIds.length} anyLabel={subteamLabel} ariaLabel="Filtrar por subgrupo" disabled={disabled} />
      {showChips ? <ActiveFilterChips filters={chips} label="Grupos e Subgrupos do filtro" className="order-last basis-full" /> : null}
    </>
  )
}

/** Um selo por Grupo e por Subgrupo em vigor, com o próprio "x" (listas que juntam todos os filtros ativos num lugar só). */
export function useTeamSubteamActiveFilters(source: OrgUnitSource, value: OrgUnitIds, onChange: OrgUnitChange): ActiveFilter[] {
  return useUnitSelection(source, value, onChange).chips
}

/**
 * Grupos e Subgrupos depois de trocar o universo do filtro ao lado: sai o que deixou de caber. O Grupo de outro universo fica enquanto um
 * Subgrupo escolhido dele cabe; a escolha cujo universo ainda não chegou fica (o servidor é quem filtra).
 */
export function useUnitsAfterUniverse(source: OrgUnitSource, value: OrgUnitIds) {
  const teams = useSelectedOrgUnits(source, "TEAM", value.teamId ?? [])
  const subteams = useSelectedOrgUnits(source, "SUBTEAM", value.subteamId ?? [])
  return (universe: UniverseChoice): { teamId: string[] | undefined; subteamId: string[] | undefined } => {
    const fits = (unit: { operatingUniverse: string | null } | undefined) => !unit || unitFitsUniverse(unit.operatingUniverse, universe)
    const keptSubteams = (value.subteamId ?? []).filter((id) => fits(subteams.unitOf(id)))
    const keptParents = new Set(keptSubteams.map((id) => subteams.unitOf(id)?.teamId))
    const keptTeams = (value.teamId ?? []).filter((id) => fits(teams.unitOf(id)) || keptParents.has(id))
    return { teamId: idsOrUndefined(keptTeams), subteamId: idsOrUndefined(keptSubteams) }
  }
}
