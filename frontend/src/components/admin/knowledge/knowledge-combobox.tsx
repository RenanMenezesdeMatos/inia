"use client"

import { RemoteCombobox, RemoteComboboxTrigger, remoteListOf, useRemoteCombobox } from "@/components/ui/remote-combobox"
import type { OrgScopeFilter } from "@/lib/admin/list-query"
import { useKnowledgeOptionQuery, useKnowledgeOptionsInfiniteQuery, useRememberKnowledgeOption } from "@/queries/admin/use-knowledge-queries"
import type { KnowledgeDocument } from "@/schemas/admin/knowledge.schema"

/**
 * CAMPO DE UMA BASE DE CONHECIMENTO com busca no servidor (título ou arquivo) e carregamento em lotes: só as que cabem no universo e no
 * Grupo/Subgrupo (as globais e as ainda sem universo continuam). A escolhida aparece no gatilho mesmo fora do lote atual.
 */
export function KnowledgeCombobox({
  value,
  onChange,
  universe,
  scope,
  emptyLabel,
  current,
  variant = "filter",
  id,
  ariaLabel,
  className,
}: {
  value: string | null | undefined
  onChange: (document: KnowledgeDocument | null) => void
  universe?: string | null | undefined
  scope?: OrgScopeFilter
  emptyLabel: string
  /** A base do registro salvo (id e título), para quando quem edita não a enxerga. */
  current?: { id: string; title: string | null } | null
  variant?: "field" | "filter"
  id?: string
  ariaLabel?: string
  className?: string
}) {
  const state = useRemoteCombobox()
  const query = useKnowledgeOptionsInfiniteQuery({ search: state.term || undefined, universe, teamId: scope?.teamId, subteamId: scope?.subteamId }, state.open)
  const chosen = useKnowledgeOptionQuery(value)
  const remember = useRememberKnowledgeOption()
  const savedTitle = current && current.id === value ? current.title : null
  const label = !value ? null : (chosen.data?.title ?? savedTitle ?? (chosen.isPending ? "Carregando…" : chosen.isError ? "Base escolhida" : "Base fora do seu alcance"))
  return (
    <RemoteCombobox
      state={state}
      list={remoteListOf(query)}
      listLabel="Bases de conhecimento"
      searchLabel="Buscar base pelo título"
      searchPlaceholder="Buscar base pelo título"
      emptyText="Nenhuma base disponível."
      fixedOptions={[{ id: "none", label: emptyLabel, selected: !value, onSelect: () => onChange(null) }]}
      optionOf={(document) => ({ id: document.id, label: document.title, details: document.operatingUniverse ?? null, selected: document.id === value })}
      onSelect={(document) => { remember(document); onChange(document) }}
      trigger={<RemoteComboboxTrigger id={id} variant={variant} label={label} placeholder={emptyLabel} aria-label={ariaLabel} className={className} />}
    />
  )
}
