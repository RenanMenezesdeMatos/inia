"use client"

import { useRef } from "react"
import { Plus, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { RemoteCombobox, RemoteComboboxTrigger, RemoteSelectionFooter, remoteListOf, useRemoteCombobox } from "@/components/ui/remote-combobox"
import { useFocusAfterRemoval } from "@/hooks/use-focus-after-removal"
import { useRememberScopedOption, useScopedOptions, useScopedOptionsByIds } from "@/queries/scope-units/use-scoped-options"
import type { ScopedOption, ScopedOptionKind } from "@/schemas/scope-units/scoped-options.schema"
import type { ScopedOptionsSource } from "@/services/scope-units/scoped-options-service"

const LABELS: Record<ScopedOptionKind, { list: string; search: string; add: string; empty: string; missing: string }> = {
  TEAM: { list: "Grupos", search: "Buscar grupo pelo nome", add: "Adicionar Grupo", empty: "Nenhum Grupo no seu escopo.", missing: "Grupo fora do seu escopo ou removido" },
  SUBTEAM: { list: "Subgrupos", search: "Buscar subgrupo ou grupo pelo nome", add: "Adicionar Subgrupo", empty: "Nenhum Subgrupo no seu escopo.", missing: "Subgrupo fora do seu escopo ou removido" },
  PERSON: { list: "Pessoas", search: "Buscar pessoa por nome", add: "Adicionar pessoa", empty: "Ninguém no seu escopo.", missing: "Pessoa fora do seu escopo ou sem conta ativa" },
}
const nameOf = (option: ScopedOption) => (option.kind === "SUBTEAM" && option.teamName ? `${option.teamName} › ${option.name}` : option.name)
const detailsOf = (option: ScopedOption) =>
  (option.kind === "PERSON" ? [option.jobTitle, [option.teamName, option.subteamName].filter(Boolean).join(" › ")] : [option.kind === "SUBTEAM" ? `Grupo ${option.teamName}` : null, option.operatingUniverse]).filter(Boolean).join(" · ") || null

/**
 * VÁRIOS Grupos, Subgrupos ou pessoas num campo: seletor pesquisável (servidor, em lotes) e os escolhidos em selos removíveis, com o nome
 * resolvido pelo id — nenhum some por estar fora do lote ou da busca.
 */
export function ScopedMultiCombobox({ kind, source, value, onChange }: { kind: ScopedOptionKind; source: ScopedOptionsSource; value: readonly string[]; onChange: (ids: string[]) => void }) {
  const text = LABELS[kind]
  const state = useRemoteCombobox()
  const list = remoteListOf(useScopedOptions(source, { kind, search: state.term }, state.open))
  const remember = useRememberScopedOption(source)
  const selected = useScopedOptionsByIds(source, kind, value)
  const listRef = useRef<HTMLUListElement>(null)
  const removing = useFocusAfterRemoval(listRef, value.length)
  const toggle = (option: ScopedOption) => {
    remember(option)
    onChange(value.includes(option.id) ? value.filter((id) => id !== option.id) : [...value, option.id])
  }
  return (
    <div className="space-y-2">
      <RemoteCombobox
        state={state}
        list={list}
        multiple
        listLabel={text.list}
        searchLabel={text.search}
        searchPlaceholder={text.search}
        emptyText={text.empty}
        optionOf={(option) => ({ id: option.id, label: option.name, accessibleLabel: nameOf(option), details: detailsOf(option), selected: value.includes(option.id) })}
        onSelect={toggle}
        footer={<RemoteSelectionFooter count={value.length} summary={value.length === 1 ? "1 escolha" : `${value.length} escolhas`} emptyText="Nenhuma escolha" onClear={() => onChange([])} onDone={() => state.setOpen(false)} />}
        trigger={<RemoteComboboxTrigger label={null} placeholder={text.add} aria-label={text.list} className="max-w-96" icon={<Plus className="size-4" aria-hidden />} />}
      />
      {value.length > 0 ? (
        <ul ref={listRef} className="flex flex-wrap gap-1.5" aria-label={`${text.list} escolhidos`}>
          {value.map((id, index) => {
            const option = selected.data?.find((item) => item.id === id)
            const label = option ? nameOf(option) : selected.isPending || selected.isPlaceholderData ? "Carregando…" : selected.isError ? "Item escolhido" : text.missing
            return (
              <li key={id}>
                <Badge variant="secondary" className="gap-1 py-1 pr-1 font-normal">
                  <span>{label}</span>
                  <button type="button" data-removable className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Remover ${label}`} onClick={() => { removing(index); onChange(value.filter((entry) => entry !== id)) }}>
                    <X className="size-3" aria-hidden />
                  </button>
                </Badge>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
