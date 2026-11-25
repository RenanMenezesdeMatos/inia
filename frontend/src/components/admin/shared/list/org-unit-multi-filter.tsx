"use client"

import { useState } from "react"

import { ActiveFilterChips } from "@/components/admin/shared/list/list-filters"
import { unitLabel } from "@/components/admin/shared/org-unit-combobox"
import { RemoteCombobox, RemoteComboboxTrigger, RemoteSelectionFooter, remoteListOf, useRemoteCombobox } from "@/components/ui/remote-combobox"
import { MAX_FILTER_UNITS, type SubteamParents } from "@/lib/admin/unit-selection"
import { useOrgUnitOptions, useOrgUnitsByIds, useRememberOrgUnits, type OrgUnit, type OrgUnitSource } from "@/queries/scope-units/use-org-units"
import type { ScopeUnitKind } from "@/schemas/scope-units/scope-units.schema"

export const UNIT_TEXT = {
  TEAM: { one: "grupo", many: "grupos", list: "Grupos", any: "Qualquer grupo", empty: "Nenhum Grupo no seu escopo.", search: "Buscar Grupo", missing: "Grupo fora do seu escopo ou removido", chosen: "Grupo escolhido" },
  SUBTEAM: { one: "subgrupo", many: "subgrupos", list: "Subgrupos", any: "Qualquer subgrupo", empty: "Nenhum Subgrupo no seu escopo.", search: "Buscar Subgrupo ou Grupo", missing: "Subgrupo fora do seu escopo ou removido", chosen: "Subgrupo escolhido" },
} as const

export const MAX_UNITS_REASON = `Até ${MAX_FILTER_UNITS} escolhas por filtro`

/** Grupos ou Subgrupos escolhidos, com nome e Grupo de origem mesmo fora do lote carregado. */
export function useSelectedOrgUnits(source: OrgUnitSource, kind: ScopeUnitKind, ids: readonly string[]) {
  const query = useOrgUnitsByIds(source, kind, ids, "filter")
  const byId = new Map((ids.length > 0 ? (query.data ?? []) : []).map((unit) => [unit.id, unit]))
  return {
    units: ids.flatMap((id) => byId.get(id) ?? []),
    unitOf: (id: string) => byId.get(id),
    /** Nome da escolha; enquanto não chega, "Carregando…"; fora do escopo ou removida, diz isso. */
    labelOf: (id: string, { withTeam = true }: { withTeam?: boolean } = {}) => {
      const unit = byId.get(id)
      if (unit) return withTeam ? unitLabel(unit) : unit.name
      return query.isError ? UNIT_TEXT[kind].chosen : query.isPending || query.isPlaceholderData ? "Carregando…" : UNIT_TEXT[kind].missing
    },
  }
}

/** Grupo de cada Subgrupo conhecido. */
export function parentsOf(subteams: readonly OrgUnit[]): SubteamParents {
  return new Map(subteams.flatMap((unit) => (unit.teamId ? [[unit.id, unit.teamId] as const] : [])))
}

/** No topo do seletor: o que já estava escolhido ao abrir e o que foi marcado depois e não está nos lotes carregados (ex.: pela busca). */
export function pinnedUnits(atOpen: readonly OrgUnit[], selected: readonly OrgUnit[], loaded: readonly OrgUnit[]): OrgUnit[] {
  const known = new Set([...atOpen, ...loaded].map((unit) => `${unit.kind}:${unit.id}`))
  return [...atOpen, ...selected.filter((unit) => !known.has(`${unit.kind}:${unit.id}`))]
}

/** "3 grupos" / "1 subgrupo" / "2 grupos e 1 subgrupo". */
export function countLabel(teams: number, subteams: number): string {
  const part = (count: number, text: { one: string; many: string }) => (count === 0 ? null : `${count} ${count === 1 ? text.one : text.many}`)
  return [part(teams, UNIT_TEXT.TEAM), part(subteams, UNIT_TEXT.SUBTEAM)].filter(Boolean).join(" e ")
}

/**
 * FILTRO DE VÁRIOS GRUPOS OU VÁRIOS SUBGRUPOS — caixas de marcação, busca no servidor e carregamento em lotes. Marcar não fecha nem tira
 * ninguém do lugar; ao abrir, os já escolhidos ficam no topo (mesmo fora do lote). Com `teamIds`, só os Subgrupos desses Grupos.
 */
export function OrgUnitMultiFilter({
  kind,
  source,
  value,
  onChange,
  universes,
  teamIds,
  otherSelected = 0,
  variant = "filter",
  showChips = false,
  anyLabel,
  ariaLabel,
  ariaDescribedBy,
  disabled = false,
  id,
  className,
}: {
  kind: ScopeUnitKind
  source: OrgUnitSource
  value: readonly string[]
  /** Nova escolha e o que se conhece de cada uma (Grupo de origem dos Subgrupos). */
  onChange: (ids: string[], units: OrgUnit[]) => void
  universes?: readonly string[] | undefined
  /** Só os Subgrupos destes Grupos. */
  teamIds?: readonly string[] | undefined
  /** Escolhas do campo ao lado (o teto vale para os dois juntos). */
  otherSelected?: number
  variant?: "field" | "filter"
  /** Selos dos escolhidos embaixo dos filtros (quando o campo aparece sozinho; o par Grupo/Subgrupo já traz os dele). */
  showChips?: boolean
  anyLabel?: string
  ariaLabel: string
  ariaDescribedBy?: string | undefined
  disabled?: boolean
  id?: string
  className?: string
}) {
  const text = UNIT_TEXT[kind]
  const state = useRemoteCombobox()
  const within = teamIds?.length ? teamIds : undefined
  const list = remoteListOf(useOrgUnitOptions(source, { kind, search: state.term, universes, purpose: "filter", withinTeamIds: within }, state.open))
  const selected = useSelectedOrgUnits(source, kind, value)
  const remember = useRememberOrgUnits(source)
  const [pinned, setPinned] = useState<readonly OrgUnit[]>([])
  const full = value.length + otherSelected >= MAX_FILTER_UNITS
  const placeholder = anyLabel ?? text.any
  function toggle(unit: OrgUnit) {
    const next = value.includes(unit.id) ? value.filter((entry) => entry !== unit.id) : [...value, unit.id]
    const units = [...selected.units.filter((entry) => entry.id !== unit.id), unit].filter((entry) => next.includes(entry.id))
    remember(kind, next, units)
    onChange(next, units)
  }
  const combobox = (
    <RemoteCombobox
      state={{ ...state, setOpen: (open) => { if (open) setPinned(selected.units); state.setOpen(open) } }}
      list={list}
      multiple
      pinned={pinnedUnits(pinned, selected.units, list.items)}
      listLabel={text.list}
      searchLabel={`Buscar ${text.one} pelo nome`}
      searchPlaceholder={kind === "SUBTEAM" && within?.length === 1 ? "Buscar Subgrupo" : text.search}
      emptyText={text.empty}
      optionOf={(unit) => ({
        id: unit.id,
        label: unit.name,
        accessibleLabel: unitLabel(unit),
        details: [unit.kind === "SUBTEAM" ? `Grupo ${unit.teamName}` : null, unit.operatingUniverse].filter(Boolean).join(" · ") || null,
        selected: value.includes(unit.id),
        disabledReason: full && !value.includes(unit.id) ? MAX_UNITS_REASON : null,
      })}
      onSelect={toggle}
      footer={<RemoteSelectionFooter count={value.length} summary={`${countLabel(kind === "TEAM" ? value.length : 0, kind === "SUBTEAM" ? value.length : 0)} no filtro`} emptyText={placeholder} onClear={() => onChange([], [])} onDone={() => state.setOpen(false)} />}
      trigger={<RemoteComboboxTrigger id={id} variant={variant} label={value.length === 0 ? null : value.length === 1 ? selected.labelOf(value[0]!, { withTeam: within?.length !== 1 }) : countLabel(kind === "TEAM" ? value.length : 0, kind === "SUBTEAM" ? value.length : 0)} placeholder={placeholder} disabled={disabled} aria-label={ariaLabel} aria-describedby={ariaDescribedBy} className={className} />}
    />
  )
  if (!showChips) return combobox
  const chips = value.map((unitId) => ({ key: unitId, label: `${kind === "TEAM" ? "Grupo" : "Subgrupo"}: ${selected.labelOf(unitId)}`, onClear: () => onChange(value.filter((entry) => entry !== unitId), selected.units.filter((unit) => unit.id !== unitId)) }))
  return (
    <>
      {combobox}
      <ActiveFilterChips filters={chips} label={`${text.list} do filtro`} className="order-last basis-full" />
    </>
  )
}
