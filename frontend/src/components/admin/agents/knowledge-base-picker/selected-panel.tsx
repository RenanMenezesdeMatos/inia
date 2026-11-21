"use client"

import { useMemo, useState } from "react"
import { Link2Off } from "lucide-react"

import { ListSearchInput } from "@/components/admin/shared/list/list-filters"
import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { EmptyState } from "@/components/ui/states"
import { Skeleton } from "@/components/ui/skeleton"
import type { KnownKnowledgeOptions } from "@/queries/admin/use-agent-knowledge-options-queries"
import type { AgentKnowledgeScope, KnowledgeOption } from "@/schemas/admin/agent-knowledge-options.schema"
import type { Team } from "@/schemas/admin/org-structure.schema"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

import { ConfirmButton } from "./confirm-button"
import { KnowledgeOptionRow, UnavailableOptionRow } from "./knowledge-option-row"
import { foldText, matchesLocalSearch, optionProblems } from "./picker-rules"

type Entry = { id: string; option: KnowledgeOption | null; title: string; unavailable: boolean }

/**
 * Aba "Ligadas": só as bases escolhidas, com busca local (a lista já está toda conhecida) e paginação. Inativas e de outro universo
 * continuam aqui, marcadas, com o selo do problema — nunca somem. Desmarcar desliga; "Desligar as listadas" pede confirmação.
 */
export function SelectedPanel({ selectedIds, onChange, known, fallbackTitles, universe, agentScope, teams }: { selectedIds: string[]; onChange: (ids: string[]) => void; known: KnownKnowledgeOptions; fallbackTitles: ReadonlyMap<string, string>; universe: OperatingUniverse | null; agentScope: AgentKnowledgeScope | undefined; teams: readonly Team[] | undefined }) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const entries = useMemo<Entry[]>(() => {
    const all = selectedIds.map((id) => {
      const option = known.byId.get(id) ?? null
      return { id, option, title: option?.title ?? fallbackTitles.get(id) ?? "", unavailable: known.unavailable.has(id) }
    })
    // As que impedem salvar vêm primeiro; depois, ordem de título.
    const rank = (entry: Entry) => (entry.option && optionProblems(entry.option, universe, agentScope, teams).length ? 0 : 1)
    return all.sort((a, b) => rank(a) - rank(b) || foldText(a.title).localeCompare(foldText(b.title), "pt-BR"))
  }, [selectedIds, known, fallbackTitles, universe, agentScope, teams])
  const listed = search.trim() ? entries.filter((entry) => (entry.option ? matchesLocalSearch(entry.option, search) : foldText(entry.title).includes(foldText(search.trim())))) : entries
  const current = Math.min(page, Math.max(1, Math.ceil(listed.length / pageSize)))
  const visible = listed.slice((current - 1) * pageSize, current * pageSize)
  const remove = (ids: readonly string[]) => {
    const drop = new Set(ids)
    onChange(selectedIds.filter((id) => !drop.has(id)))
  }

  if (selectedIds.length === 0) {
    return <EmptyState icon={Link2Off} title="Nenhuma base ligada" description="Abra “Disponíveis” para buscar e ligar as bases que este agente deve consultar." />
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex-1">
          <ListSearchInput value={search} onChange={(value) => { setSearch(value); setPage(1) }} placeholder="Buscar nas ligadas por nome, Grupo, assunto ou produto" ariaLabel="Buscar nas bases ligadas" />
        </div>
        <ConfirmButton
          variant="ghost"
          icon={<Link2Off data-icon="inline-start" />}
          label={search.trim() ? `Desligar as ${listed.length} listadas` : "Desligar todas"}
          disabled={listed.length === 0}
          title={search.trim() ? `Desligar ${listed.length} ${listed.length === 1 ? "base" : "bases"}?` : `Desligar todas as ${listed.length} bases?`}
          description={search.trim() ? `As ${listed.length} bases que aparecem na busca deixam de ser consultadas por este agente. As outras ${selectedIds.length - listed.length} continuam ligadas. Nada é gravado até você salvar o agente.` : "O agente fica sem nenhuma base de conhecimento. Nada é gravado até você salvar o agente."}
          confirmLabel="Desligar"
          onConfirm={() => remove(listed.map((entry) => entry.id))}
        />
      </div>
      {listed.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">Nenhuma base ligada combina com a busca.</p>
      ) : (
        <ul className="space-y-1.5" aria-label="Bases ligadas">
          {visible.map((entry) =>
            entry.option ? (
              <KnowledgeOptionRow key={entry.id} option={entry.option} checked onToggle={() => remove([entry.id])} problems={optionProblems(entry.option, universe, agentScope, teams)} />
            ) : entry.unavailable ? (
              <UnavailableOptionRow key={entry.id} id={entry.id} title={entry.title} onRemove={() => remove([entry.id])} />
            ) : (
              <li key={entry.id} className="rounded-xl border bg-card px-3 py-2.5" aria-busy="true">
                <span className="text-sm font-medium">{entry.title}</span>
                <Skeleton className="mt-1 h-3 w-48" />
              </li>
            ),
          )}
        </ul>
      )}
      <ListPagination page={current} pageSize={pageSize} total={listed.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} itemLabel={["base ligada", "bases ligadas"]} />
    </div>
  )
}
