"use client"

import { useState } from "react"
import { ChevronDown, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { RemoteCombobox, RemoteSelectionFooter, remoteListOf, useRemoteCombobox } from "@/components/ui/remote-combobox"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useScopeUnitOptions } from "@/queries/scope-units/use-scope-units"
import type { ScopePickerPermission, ScopeUnitKind, ScopeUnitOption } from "@/schemas/scope-units/scope-units.schema"

const KIND_LABEL: Record<ScopeUnitKind, { tab: string; one: string; empty: string }> = {
  TEAM: { tab: "Grupos", one: "Grupo", empty: "Nenhum Grupo com operadores em produção" },
  SUBTEAM: { tab: "Subgrupos", one: "Subgrupo", empty: "Nenhum Subgrupo com operadores em produção" },
}

/**
 * SELETOR PESQUISÁVEL DE GRUPOS E SUBGRUPOS (23/11/2026) — o mesmo em todos os cadastros de alcance. Busca no servidor (sem maiúsculas
 * nem acentos; o Subgrupo também pelo nome do Grupo-pai), universo, escopo de quem edita e elegibilidade (só Grupo/Subgrupo com ao menos
 * um operador "Em produção") aplicados ANTES da paginação. As escolhas ficam com quem usa o seletor (`isSelected`/`onToggle`), então
 * buscar de novo, rolar ou trocar de aba nunca perde o que já foi marcado. Comportamento (lotes, teclado, erro) em `ui/remote-combobox`.
 */
export function ScopeUnitPicker({
  permission,
  universes,
  kinds = ["TEAM", "SUBTEAM"],
  isSelected,
  disabledReason,
  onToggle,
  multiple = true,
  triggerLabel = "Adicionar Grupo ou Subgrupo",
  disabled = false,
}: {
  permission: ScopePickerPermission
  universes?: readonly string[] | undefined
  kinds?: readonly ScopeUnitKind[]
  isSelected: (option: ScopeUnitOption) => boolean
  /** Opção que não pode ser marcada agora (ex.: Subgrupo de um Grupo já escolhido inteiro): o motivo aparece na linha. */
  disabledReason?: (option: ScopeUnitOption) => string | null
  onToggle: (option: ScopeUnitOption) => void
  multiple?: boolean
  triggerLabel?: string
  disabled?: boolean
}) {
  const state = useRemoteCombobox()
  const [kind, setKind] = useState<ScopeUnitKind>(kinds[0] ?? "TEAM")
  const list = remoteListOf(useScopeUnitOptions({ kind, permission, search: state.term, universes }, state.open))
  const labels = KIND_LABEL[kind]
  return (
    <RemoteCombobox
      key={kinds.join()}
      state={state}
      list={list}
      multiple={multiple}
      contentClassName="w-[min(28rem,calc(100vw-2rem))]"
      listLabel={labels.tab}
      searchLabel={`Buscar ${labels.one.toLocaleLowerCase("pt-BR")} pelo nome`}
      searchPlaceholder={kind === "SUBTEAM" ? "Buscar Subgrupo ou Grupo-pai" : "Buscar Grupo"}
      emptyText={`${labels.empty}${universes?.length ? ` em ${universes.join(", ")}` : ""} no seu escopo.`}
      optionOf={(option) => ({
        id: `${option.kind}:${option.id}`,
        label: option.name,
        accessibleLabel: option.kind === "SUBTEAM" ? `${option.teamName ?? "Grupo"} › ${option.name}` : option.name,
        details: [option.kind === "SUBTEAM" ? `Grupo ${option.teamName}` : null, option.operatingUniverse, `${option.productionOperators.toLocaleString("pt-BR")} em produção`].filter(Boolean).join(" · "),
        selected: isSelected(option),
        disabledReason: disabledReason?.(option) ?? null,
      })}
      onSelect={onToggle}
      footer={multiple ? <RemoteSelectionFooter count={0} summary="" emptyText="Pode marcar vários" onDone={() => state.setOpen(false)} /> : undefined}
      header={
        kinds.length > 1 ? (
          <ToggleGroup type="single" value={kind} onValueChange={(next) => { if (next) setKind(next as ScopeUnitKind) }} aria-label="Tipo de unidade" className="w-full">
            {kinds.map((entry) => <ToggleGroupItem key={entry} value={entry} className="flex-1">{KIND_LABEL[entry].tab}</ToggleGroupItem>)}
          </ToggleGroup>
        ) : null
      }
      trigger={
        <Button type="button" variant="outline" className="w-full max-w-96 justify-between font-normal" disabled={disabled}>
          <span className="flex items-center gap-2 truncate"><Plus className="size-4" aria-hidden />{triggerLabel}</span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      }
    />
  )
}
