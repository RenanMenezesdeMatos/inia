"use client"

import { useEffect } from "react"

import { RemoteCombobox, RemoteComboboxTrigger, remoteListOf, useRemoteCombobox } from "@/components/ui/remote-combobox"
import { getUsageTracker } from "@/lib/usage/usage-provider"
import { useRememberScopedOption, useScopedOptions, useScopedOptionsByIds } from "@/queries/scope-units/use-scoped-options"
import type { ScopedOption } from "@/schemas/scope-units/scoped-options.schema"
import type { ScopedOptionsSource } from "@/services/scope-units/scoped-options-service"

const placeOf = (person: ScopedOption) => [person.teamName, person.subteamName].filter(Boolean).join(" › ")

/** Nome da pessoa escolhida, mesmo fora do lote carregado. `currentName`: o que a tela já sabe, quando a opção não volta. */
export function usePersonLabel(source: ScopedOptionsSource, id: string | null | undefined, currentName?: string | null) {
  const query = useScopedOptionsByIds(source, "PERSON", id ? [id] : [])
  const person = id ? query.data?.find((item) => item.id === id) : undefined
  return { person: person ?? null, label: !id ? null : (person?.name ?? currentName ?? (query.isError ? "Pessoa escolhida" : query.isPending || query.isPlaceholderData ? "Carregando…" : "Pessoa fora do seu alcance")) }
}

/**
 * CAMPO DE UMA PESSOA com busca no servidor (nome; matrícula só onde a tela a mostra) e carregamento em lotes, no alcance da tela (`source`). A pessoa
 * escolhida aparece no gatilho mesmo fora do lote atual; Grupo e Subgrupo distinguem nomes iguais.
 */
export function PersonCombobox({
  source,
  value,
  onChange,
  teamId,
  subteamId,
  variant = "filter",
  emptyLabel = "Qualquer pessoa",
  emptyText = "Ninguém no seu alcance.",
  detailsOf,
  currentName,
  searchesMatricula = false,
  usageSurface,
  disabled = false,
  id,
  ariaLabel,
  ariaDescribedBy,
  className,
}: {
  source: ScopedOptionsSource
  value: string | null | undefined
  onChange: (person: ScopedOption | null) => void
  /** Só pessoas destes Grupos/Subgrupos. */
  teamId?: readonly string[] | undefined
  subteamId?: readonly string[] | undefined
  variant?: "field" | "filter"
  /** Texto sem escolha e da opção que limpa; `null` = escolha obrigatória. */
  emptyLabel?: string | null
  emptyText?: string
  detailsOf?: (person: ScopedOption) => string | null
  /** Nome que a tela já conhece da pessoa escolhida (ex.: a própria estrutura, que não é opção da lista). */
  currentName?: string | null | undefined
  /** A rota da tela busca e devolve a matrícula. */
  searchesMatricula?: boolean
  /** Superfície da coleta de uso que registra a busca (só a faixa do tamanho, nunca o termo). */
  usageSurface?: string
  disabled?: boolean
  id?: string
  ariaLabel?: string
  ariaDescribedBy?: string | undefined
  className?: string
}) {
  const state = useRemoteCombobox()
  const list = remoteListOf(useScopedOptions(source, { kind: "PERSON", search: state.term, teamId, subteamId }, state.open))
  const remember = useRememberScopedOption(source)
  const { label } = usePersonLabel(source, value, currentName)
  const searched = usageSurface && state.open && state.term && state.search.trim() === state.term && !list.isStale && !list.isPending && !list.isError ? state.term : null
  const found = list.items.length
  useEffect(() => {
    if (!usageSurface || !searched) return
    try {
      getUsageTracker()?.search(usageSurface, searched.length, found)
    } catch {
      // observacional
    }
    // Uma vez por busca concluída: o lote seguinte não é outra busca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usageSurface, searched])
  return (
    <RemoteCombobox
      state={state}
      list={list}
      listLabel="Pessoas"
      searchLabel={searchesMatricula ? "Buscar pessoa por nome ou matrícula" : "Buscar pessoa por nome"}
      searchPlaceholder={searchesMatricula ? "Buscar por nome ou matrícula" : "Buscar por nome"}
      searchUsageElement={usageSurface ? "list.search" : undefined}
      emptyText={emptyText}
      fixedOptions={emptyLabel === null ? [] : [{ id: "none", label: emptyLabel, selected: !value, onSelect: () => onChange(null) }]}
      optionOf={(person) => ({ id: person.id, label: person.name, details: detailsOf ? detailsOf(person) : [person.matricula, placeOf(person)].filter(Boolean).join(" · ") || null, selected: person.id === value })}
      onSelect={(person) => { remember(person); onChange(person) }}
      trigger={<RemoteComboboxTrigger id={id} variant={variant} label={label} placeholder={emptyLabel ?? "Selecione a pessoa"} disabled={disabled} aria-label={ariaLabel} aria-describedby={ariaDescribedBy} className={className} />}
    />
  )
}
