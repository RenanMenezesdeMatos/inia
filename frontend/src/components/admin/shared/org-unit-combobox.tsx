"use client"

import { RemoteCombobox, RemoteComboboxTrigger, remoteListOf, useRemoteCombobox, type RemoteFixedOption } from "@/components/ui/remote-combobox"
import { useOrgUnitOptions, useOrgUnitsByIds, useRememberOrgUnit, type OrgUnit, type OrgUnitSource } from "@/queries/scope-units/use-org-units"
import type { ScopeUnitKind, ScopeUnitPurpose } from "@/schemas/scope-units/scope-units.schema"

const KIND = {
  TEAM: { one: "Grupo", list: "Grupos", any: "Qualquer grupo", empty: "Nenhum Grupo no seu escopo.", search: "Buscar Grupo", missing: "Grupo fora do seu escopo ou removido" },
  SUBTEAM: { one: "Subgrupo", list: "Subgrupos", any: "Qualquer subgrupo", empty: "Nenhum Subgrupo no seu escopo.", search: "Buscar Subgrupo ou Grupo", missing: "Subgrupo fora do seu escopo ou removido" },
} as const

/** Nome de uma unidade: o Subgrupo com o Grupo de origem, que distingue nomes iguais. */
export const unitLabel = (unit: Pick<OrgUnit, "kind" | "name" | "teamName">) => (unit.kind === "SUBTEAM" && unit.teamName ? `${unit.teamName} › ${unit.name}` : unit.name)

/**
 * Nome do Grupo/Subgrupo escolhido, mesmo fora do lote carregado no seletor. `null` = nada escolhido; enquanto o nome não chega,
 * "Carregando…"; fora do escopo ou removido, diz isso (nunca um campo em branco).
 */
export function useOrgUnitLabel(kind: ScopeUnitKind, source: OrgUnitSource, id: string | null | undefined, purpose: ScopeUnitPurpose = "filter", { withTeam = true }: { withTeam?: boolean } = {}) {
  const query = useOrgUnitsByIds(source, kind, id ? [id] : [], purpose)
  const unit = id ? query.data?.find((item) => item.id === id) : undefined
  const label = !id ? null : unit ? (withTeam ? unitLabel(unit) : unit.name) : query.isError ? `${KIND[kind].one} escolhido` : query.isPending || query.isPlaceholderData ? "Carregando…" : KIND[kind].missing
  return { unit: unit ?? null, label }
}

/**
 * CAMPO DE UM GRUPO OU DE UM SUBGRUPO com busca no servidor e carregamento em lotes (filtros e formulários de escolha única). As opções
 * vêm restritas ao alcance da tela (`source`); com `teamId`, só os Subgrupos daquele Grupo. O escolhido aparece no gatilho mesmo quando
 * não está no lote atual nem no resultado da busca.
 */
export function OrgUnitCombobox({
  kind,
  source,
  value,
  onChange,
  purpose = "filter",
  eligibility,
  universes,
  teamId,
  withinTeamIds,
  variant = "filter",
  emptyLabel,
  fixedOptions,
  disabledReason,
  disabled = false,
  id,
  ariaLabel,
  ariaDescribedBy,
  className,
}: {
  kind: ScopeUnitKind
  /** Permissão da tela (Administração) ou a rota de opções dela. */
  source: OrgUnitSource
  value: string | null | undefined
  /** Opção escolhida (com o Grupo-pai, no Subgrupo); `null` = a opção vazia. */
  onChange: (option: OrgUnit | null) => void
  purpose?: ScopeUnitPurpose
  eligibility?: "production" | "all"
  universes?: readonly string[] | undefined
  teamId?: string | undefined
  /** Só estes Grupos e os Subgrupos deles (até `MAX_WITHIN_TEAM_IDS`); acima disso use `disabledReason`. */
  withinTeamIds?: readonly string[] | undefined
  variant?: "field" | "filter"
  /** Texto sem escolha e da opção que limpa ("Qualquer grupo", "Sem grupo"). `null` = escolha obrigatória, sem opção vazia. */
  emptyLabel?: string | null
  fixedOptions?: readonly RemoteFixedOption[]
  disabledReason?: (option: OrgUnit) => string | null
  disabled?: boolean
  id?: string
  ariaLabel?: string
  ariaDescribedBy?: string | undefined
  className?: string
}) {
  const text = KIND[kind]
  const state = useRemoteCombobox()
  const list = remoteListOf(useOrgUnitOptions(source, { kind, search: state.term, universes, purpose, eligibility, teamId: kind === "SUBTEAM" ? teamId : undefined, withinTeamIds }, state.open))
  const remember = useRememberOrgUnit(source, "filter")
  // O nome do escolhido usa sempre a visão de filtro (o Grupo-pai de um Subgrupo administrado também tem nome).
  const { label } = useOrgUnitLabel(kind, source, value, "filter", { withTeam: !teamId })
  const clearLabel = emptyLabel === undefined ? text.any : emptyLabel
  return (
    <RemoteCombobox
      state={state}
      list={list}
      listLabel={text.list}
      searchLabel={`Buscar ${text.one.toLocaleLowerCase("pt-BR")} pelo nome`}
      searchPlaceholder={kind === "SUBTEAM" && teamId ? "Buscar Subgrupo" : text.search}
      emptyText={text.empty}
      fixedOptions={fixedOptions ?? (clearLabel === null ? [] : [{ id: "none", label: clearLabel, selected: !value, onSelect: () => onChange(null) }])}
      optionOf={(option) => ({
        id: option.id,
        label: option.name,
        accessibleLabel: unitLabel(option),
        details: [option.kind === "SUBTEAM" && !teamId ? `Grupo ${option.teamName}` : null, option.operatingUniverse].filter(Boolean).join(" · ") || null,
        selected: option.id === value,
        disabledReason: disabledReason?.(option) ?? null,
      })}
      onSelect={(option) => { remember(option); onChange(option) }}
      trigger={<RemoteComboboxTrigger id={id} variant={variant} label={label} placeholder={clearLabel ?? `Selecione o ${text.one.toLocaleLowerCase("pt-BR")}`} disabled={disabled} aria-label={ariaLabel} aria-describedby={ariaDescribedBy} className={className} />}
    />
  )
}
