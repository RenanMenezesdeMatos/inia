"use client"

import { useState } from "react"

import { ActiveFilterChips } from "@/components/admin/shared/list/list-filters"
import { countLabel, MAX_UNITS_REASON, parentsOf, pinnedUnits, UNIT_TEXT, useSelectedOrgUnits } from "@/components/admin/shared/list/org-unit-multi-filter"
import { useUnitsAfterUniverse } from "@/components/admin/shared/list/team-subteam-filters"
import { unitLabel } from "@/components/admin/shared/org-unit-combobox"
import { RemoteCombobox, RemoteComboboxTrigger, RemoteSelectionFooter, remoteListOf, useRemoteCombobox } from "@/components/ui/remote-combobox"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { OrgScopeFilter } from "@/lib/admin/list-query"
import { idsOrUndefined, MAX_FILTER_UNITS, type SubteamParents } from "@/lib/admin/unit-selection"
import { unitFitsUniverse, type UniverseChoice } from "@/lib/operating-universe/hierarchy"
import { useOrgUnitOptions, useRememberOrgUnits, type OrgUnit } from "@/queries/scope-units/use-org-units"
import type { ScopePickerPermission, ScopeUnitKind } from "@/schemas/scope-units/scope-units.schema"
import { MAX_WITHIN_TEAM_IDS } from "@/services/scope-units/scope-units-service"

const ANY = "Qualquer grupo"

/** Universos escolhidos no filtro (sem o "Pendente", que não restringe os Grupos). */
export function universesOf(choice: UniverseChoice): string[] | undefined {
  const universes = typeof choice === "string" ? [choice] : (choice ?? []).filter((entry) => entry !== "PENDING")
  return universes.length ? universes : undefined
}

/** Grupos/Subgrupos da lista depois de trocar o universo do filtro ao lado: sai o que deixou de caber. */
export function useOrgScopeAfterUniverse(permission: ScopePickerPermission, scope: OrgScopeFilter) {
  const after = useUnitsAfterUniverse(permission, scope)
  return (universe: UniverseChoice): OrgScopeFilter => ({ scopeType: scope.scopeType, ...after(universe) })
}

/**
 * Filtro de Grupos e Subgrupos das listas, num campo só e com VÁRIAS escolhas (abas Grupos/Subgrupos, como o alcance do Workflow):
 * "Somente globais", Grupos (abrangem os Subgrupos deles) e Subgrupos, com o Grupo de origem. Marcar um Subgrupo tira o Grupo inteiro
 * dele, e marcar o Grupo inteiro tira os Subgrupos dele: a escolha nunca fica ambígua. Com `universe`, só o que cabe nele; o Grupo de
 * outro universo que tem Subgrupo deste aparece indisponível, apontando a aba Subgrupos. Quem troca o universo limpa a escolha com
 * `useOrgScopeAfterUniverse`.
 */
export function ListOrgScopeFilter({
  permission,
  value,
  onChange,
  globalLabel = "Somente globais (todos os grupos)",
  universe,
  withinTeamIds,
}: {
  permission: ScopePickerPermission
  value: OrgScopeFilter
  onChange: (value: OrgScopeFilter, parents: SubteamParents) => void
  globalLabel?: string
  universe?: UniverseChoice
  /** Só estes Grupos e os Subgrupos deles (ex.: os Grupos do agente); nulo = sem recorte. */
  withinTeamIds?: ReadonlySet<string> | null
}) {
  const state = useRemoteCombobox()
  const teamIds = value.teamId ?? []
  const subteamIds = value.subteamId ?? []
  const [kind, setKind] = useState<ScopeUnitKind>(teamIds.length === 0 && subteamIds.length > 0 ? "SUBTEAM" : "TEAM")
  const [pinned, setPinned] = useState<readonly OrgUnit[]>([])
  const universes = universesOf(universe)
  // Recorte pequeno vai na consulta; acima do teto da rota, o que está fora aparece indisponível.
  const within = withinTeamIds && withinTeamIds.size <= MAX_WITHIN_TEAM_IDS ? [...withinTeamIds].sort() : undefined
  const list = remoteListOf(useOrgUnitOptions(permission, { kind, search: state.term, universes, purpose: "filter", withinTeamIds: within }, state.open))
  const teams = useSelectedOrgUnits(permission, "TEAM", teamIds)
  const subteams = useSelectedOrgUnits(permission, "SUBTEAM", subteamIds)
  const remember = useRememberOrgUnits(permission)
  const total = teamIds.length + subteamIds.length
  const isSelected = (unit: OrgUnit) => (unit.kind === "TEAM" ? teamIds : subteamIds).includes(unit.id)

  function apply(nextTeams: readonly OrgUnit[], nextSubteams: readonly OrgUnit[], nextTeamIds: readonly string[], nextSubteamIds: readonly string[]) {
    remember("TEAM", nextTeamIds, nextTeams)
    remember("SUBTEAM", nextSubteamIds, nextSubteams)
    onChange({ teamId: idsOrUndefined(nextTeamIds), subteamId: idsOrUndefined(nextSubteamIds) }, parentsOf(nextSubteams))
  }
  function remove(unitKind: ScopeUnitKind, id: string) {
    if (unitKind === "TEAM") apply(teams.units.filter((unit) => unit.id !== id), subteams.units, teamIds.filter((entry) => entry !== id), subteamIds)
    else apply(teams.units, subteams.units.filter((unit) => unit.id !== id), teamIds, subteamIds.filter((entry) => entry !== id))
  }
  function toggle(unit: OrgUnit) {
    if (isSelected(unit)) return remove(unit.kind, unit.id)
    if (unit.kind === "TEAM") {
      const within = new Set(subteams.units.filter((entry) => entry.teamId === unit.id).map((entry) => entry.id))
      return apply([...teams.units, unit], subteams.units.filter((entry) => !within.has(entry.id)), [...teamIds, unit.id], subteamIds.filter((entry) => !within.has(entry)))
    }
    apply(teams.units.filter((entry) => entry.id !== unit.teamId), [...subteams.units, unit], teamIds.filter((entry) => entry !== unit.teamId), [...subteamIds, unit.id])
  }
  function unavailable(unit: OrgUnit): string | null {
    if (isSelected(unit)) return null
    if (unit.kind === "TEAM" && universes && !unitFitsUniverse(unit.operatingUniverse, universes)) return "De outro universo: escolha um Subgrupo dele na outra aba"
    if (withinTeamIds && !within && !withinTeamIds.has(unit.kind === "TEAM" ? unit.id : (unit.teamId ?? ""))) return "Fora dos Grupos que cabem aqui"
    return total >= MAX_FILTER_UNITS ? MAX_UNITS_REASON : null
  }
  const chips = [
    ...teamIds.map((id) => ({ key: `team:${id}`, label: `Grupo: ${teams.labelOf(id)}`, onClear: () => remove("TEAM", id) })),
    ...subteamIds.map((id) => ({ key: `subteam:${id}`, label: `Subgrupo: ${subteams.labelOf(id)}`, onClear: () => remove("SUBTEAM", id) })),
  ]
  const single = total === 1 ? (teamIds[0] ? teams.labelOf(teamIds[0]) : subteams.labelOf(subteamIds[0]!)) : null
  return (
    <>
      <RemoteCombobox
        state={{ ...state, setOpen: (open) => { if (open) setPinned([...teams.units, ...subteams.units]); state.setOpen(open) } }}
        list={list}
        multiple
        pinned={pinnedUnits(pinned, [...teams.units, ...subteams.units], list.items).filter((unit) => unit.kind === kind)}
        listLabel={UNIT_TEXT[kind].list}
        searchLabel={`Buscar ${UNIT_TEXT[kind].one} pelo nome`}
        searchPlaceholder={UNIT_TEXT[kind].search}
        emptyText={`Nenhum ${kind === "TEAM" ? "Grupo" : "Subgrupo"}${universes ? ` em ${universes.join(", ")}` : ""} no seu escopo.`}
        fixedOptions={[{ id: "global", label: globalLabel, selected: total === 0 && value.scopeType === "ALL_TEAMS", onSelect: () => onChange(value.scopeType === "ALL_TEAMS" && total === 0 ? {} : { scopeType: "ALL_TEAMS" }, new Map()) }]}
        optionOf={(unit) => ({
          id: `${unit.kind}:${unit.id}`,
          label: unit.name,
          accessibleLabel: unit.kind === "TEAM" ? `${unit.name} (grupo inteiro)` : unitLabel(unit),
          details: [unit.kind === "SUBTEAM" ? `Grupo ${unit.teamName}` : null, unit.operatingUniverse].filter(Boolean).join(" · ") || null,
          selected: isSelected(unit),
          disabledReason: unavailable(unit),
        })}
        onSelect={toggle}
        header={
          <ToggleGroup type="single" value={kind} onValueChange={(next) => { if (next) setKind(next as ScopeUnitKind) }} aria-label="Tipo de unidade" className="w-full">
            <ToggleGroupItem value="TEAM" className="flex-1">Grupos{teamIds.length > 0 ? ` (${teamIds.length})` : ""}</ToggleGroupItem>
            <ToggleGroupItem value="SUBTEAM" className="flex-1">Subgrupos{subteamIds.length > 0 ? ` (${subteamIds.length})` : ""}</ToggleGroupItem>
          </ToggleGroup>
        }
        footer={<RemoteSelectionFooter count={total} summary={`${countLabel(teamIds.length, subteamIds.length)} no filtro`} emptyText={value.scopeType === "ALL_TEAMS" ? globalLabel : ANY} onClear={() => onChange({}, new Map())} onDone={() => state.setOpen(false)} />}
        trigger={<RemoteComboboxTrigger variant="filter" label={total > 0 ? (single ?? countLabel(teamIds.length, subteamIds.length)) : value.scopeType === "ALL_TEAMS" ? globalLabel : null} placeholder={ANY} aria-label="Filtrar por grupo" className="sm:min-w-40" />}
      />
      <ActiveFilterChips filters={chips} label="Grupos e Subgrupos do filtro" className="order-last basis-full" />
    </>
  )
}
