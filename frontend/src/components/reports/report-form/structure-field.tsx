"use client"

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"

import { RemoteCombobox, RemoteComboboxTrigger, remoteListOf, useRemoteCombobox } from "@/components/ui/remote-combobox"
import type { ReportDefinition, ReportStructureOption } from "@/schemas/reports/reports.schema"
import { fetchReportStructures } from "@/services/reports/reports-service"

/** Estrutura do report: a de quem recebe (acompanha a pessoa) ou uma fixa do escopo, buscada no servidor e carregada em lotes. */
export function StructureField({ value, onChange, ownStructure }: { value: ReportDefinition["structure"]; onChange: (structure: ReportDefinition["structure"]) => void; ownStructure: string | null }) {
  const state = useRemoteCombobox()
  const query = useInfiniteQuery({
    queryKey: ["reports", "structure-options", state.term],
    queryFn: ({ pageParam, signal }) => fetchReportStructures({ search: state.term, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    enabled: state.open,
    staleTime: 30_000,
  })
  const recipientLabel = ownStructure ? `Minha estrutura (${ownStructure}) — a de quem recebe` : "A estrutura de quem recebe"
  const fixed = value.mode === "FIXED" ? value : null
  const isFixed = (option: ReportStructureOption) => fixed !== null && fixed.subjectKind === option.subjectKind && fixed.subjectId === option.subjectId
  return (
    <RemoteCombobox
      state={state}
      list={remoteListOf(query)}
      listLabel="Estruturas"
      searchLabel="Buscar estrutura pelo nome"
      searchPlaceholder="Buscar líder, Grupo ou Subgrupo"
      emptyText="Nenhuma estrutura no seu escopo."
      fixedOptions={[{ id: "recipient", label: recipientLabel, selected: !fixed, onSelect: () => onChange({ mode: "RECIPIENT" }) }]}
      optionOf={(option) => ({ id: `${option.subjectKind}:${option.subjectId}`, label: option.label, details: option.description, accessibleLabel: `${option.label} — ${option.description}`, selected: isFixed(option) })}
      onSelect={(option) => onChange({ mode: "FIXED", subjectKind: option.subjectKind, subjectId: option.subjectId, label: option.label })}
      trigger={<RemoteComboboxTrigger label={fixed ? (fixed.label ?? "Estrutura escolhida") : recipientLabel} placeholder={recipientLabel} aria-label="Estrutura" />}
    />
  )
}
