"use client"

import { useEffect, useMemo, useState } from "react"
import { ListChecks, SearchX } from "lucide-react"
import { toast } from "sonner"

import { ListSearchInput, ListSelectFilter, ListSubjectScopeFilter, ListToolbar, type FilterOption } from "@/components/admin/shared/list/list-filters"
import { ListOrgScopeFilter } from "@/components/admin/shared/list/org-scope-filter"
import { CursorPagination } from "@/components/admin/shared/list/list-pagination"
import { UniverseBadge } from "@/components/operating-universe/universe-badge"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState, InlineError, LoadingState } from "@/components/ui/states"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import type { OrgScopeFilter, SubjectScopeFilter } from "@/lib/admin/list-query"
import type { UniverseFilterValue } from "@/lib/operating-universe/hierarchy"
import { cn } from "@/lib/utils"
import { useKnowledgeOptionFacetsQuery, useKnowledgeOptionsQuery, type KnownKnowledgeOptions } from "@/queries/admin/use-agent-knowledge-options-queries"
import type { AgentKnowledgeScope, KnowledgeOptionFacets, KnowledgeOptionState, KnowledgeOptionsFilter } from "@/schemas/admin/agent-knowledge-options.schema"
import type { Team } from "@/schemas/admin/org-structure.schema"
import { OPERATING_UNIVERSES, type OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"
import { fetchKnowledgeOptionIds } from "@/services/admin/agent-knowledge-options-service"
import { hasOrgUnits } from "@/lib/admin/unit-selection"

import { ConfirmButton } from "./confirm-button"
import { KnowledgeOptionRow } from "./knowledge-option-row"
import { agentTeamIds } from "./picker-rules"

const ALL = "__all__"
const STATE_OPTIONS: FilterOption<KnowledgeOptionState>[] = [
  { value: "IN_USE", label: "Em uso" },
  { value: "NO_VERSION", label: "Sem versão disponível" },
  { value: "ARCHIVED", label: "Arquivadas" },
]

/** Produto: famílias (inclui os produtos dela) e produtos, agrupados pela família — só os que aparecem em alguma base. */
function ProductFilter({ value, onChange, facets }: { value: string | undefined; onChange: (value: string | undefined) => void; facets: KnowledgeOptionFacets | undefined }) {
  const groups = useMemo(() => {
    // Uma entrada por família (chave = id da família): a família ligada direto a uma base e os produtos dela caem no mesmo grupo.
    const byFamily = new Map<string, { id: string; name: string; products: { id: string; name: string }[] }>()
    for (const product of facets?.products ?? []) {
      const key = product.parentId ?? product.id
      const group = byFamily.get(key) ?? { id: key, name: product.parentName ?? product.name, products: [] }
      if (product.parentId) group.products.push({ id: product.id, name: product.name })
      byFamily.set(key, group)
    }
    return [...byFamily.values()]
  }, [facets])
  return (
    <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? undefined : next)} disabled={!facets}>
      <SelectTrigger className={cn("w-full sm:w-auto sm:min-w-40", value && "border-primary/50")} aria-label="Filtrar por produto">
        <SelectValue placeholder="Qualquer produto" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Qualquer produto</SelectItem>
        {groups.map((group) => (
          <SelectGroup key={group.id}>
            <SelectLabel>{group.name}</SelectLabel>
            <SelectItem value={group.id}>{group.products.length ? `${group.name} (família inteira)` : group.name}</SelectItem>
            {group.products.map((product) => (
              <SelectItem key={product.id} value={product.id}>
                {group.name} › {product.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Aba "Disponíveis": busca e filtros no servidor (universo → Grupo → Subgrupo, produto, assunto, situação), página por posição e
 * "Ligar as filtradas" com confirmação. Só oferece o que o agente pode salvar (universo dele e, sendo de Grupo, bases globais ou do
 * Grupo). As já ligadas no momento em que a lista foi montada ficam de fora; as que você liga agora continuam visíveis, marcadas,
 * até mudar o filtro — a lista não pula enquanto você marca.
 */
export function AvailablePanel({ selectedIds, onChange, known, universe, agentScope, teams }: { selectedIds: string[]; onChange: (ids: string[]) => void; known: KnownKnowledgeOptions; universe: OperatingUniverse | null; agentScope: AgentKnowledgeScope | undefined; teams: readonly Team[] | undefined }) {
  const [search, setSearch] = useState("")
  const [universeFilter, setUniverseFilter] = useState<UniverseFilterValue | undefined>(undefined)
  const [orgScope, setOrgScope] = useState<OrgScopeFilter>({})
  const [productId, setProductId] = useState<string | undefined>(undefined)
  const [subjectScope, setSubjectScope] = useState<SubjectScopeFilter>({})
  const [state, setState] = useState<KnowledgeOptionState | undefined>(undefined)
  const [pageSize, setPageSize] = useState(20)
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [excluded, setExcluded] = useState<string[]>(selectedIds)
  const [bulkPending, setBulkPending] = useState(false)
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const facetsQuery = useKnowledgeOptionFacetsQuery(universe ?? undefined)

  const filter = useMemo<KnowledgeOptionsFilter>(() => ({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(universe ? { agentUniverse: universe } : {}),
    ...(universeFilter ? { universe: universeFilter } : {}),
    ...(agentScope ? { agentScope } : {}),
    ...(hasOrgUnits(orgScope) ? { teamId: orgScope.teamId, subteamId: orgScope.subteamId } : orgScope.scopeType === "ALL_TEAMS" ? { scopeType: "ALL_TEAMS" as const } : {}),
    ...(productId ? { productId } : {}),
    ...(subjectScope.subjectId ? { subjectId: subjectScope.subjectId } : subjectScope.subjectScopeType ? { subjectScopeType: "ALL_SUBJECTS" as const } : {}),
    ...(state ? { state } : {}),
  }), [debouncedSearch, universe, universeFilter, agentScope, orgScope, productId, subjectScope, state])
  const filterKey = JSON.stringify(filter)

  // Filtro novo: volta à primeira página e refaz a lista sem as que estão ligadas agora (ajuste na renderização, sem render extra).
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey)
    setCursors([undefined])
    setExcluded(selectedIds)
  }

  // Escolha mudada POR FORA (pré-seleção do Grupo, troca de universo, aba Ligadas): refaz a lista sem as ligadas. As mudanças feitas
  // aqui (marcar, "Ligar as filtradas") não refazem — a linha marcada fica visível até mudar o filtro.
  const [emitted, setEmitted] = useState<string[] | null>(null)
  const [seenIds, setSeenIds] = useState(selectedIds)
  if (seenIds !== selectedIds) {
    setSeenIds(selectedIds)
    if (selectedIds !== emitted) {
      setCursors([undefined])
      setExcluded(selectedIds)
    }
  }
  const emit = (next: string[]) => {
    setEmitted(next)
    onChange(next)
  }

  const page = cursors.length
  const cursor = cursors[cursors.length - 1]
  const query = useKnowledgeOptionsQuery({ ...filter, ...(excluded.length ? { excludeIds: excluded } : {}) }, { cursor, limit: pageSize })
  const items = query.data?.items ?? []
  const { remember } = known
  useEffect(() => {
    if (query.data) remember(query.data.items)
  }, [query.data, remember])

  // Total do filtro: vem na primeira página; nas seguintes, o da primeira continua valendo.
  const [total, setTotal] = useState<number | null>(null)
  if (query.data && query.data.total !== null && query.data.total !== total && !query.isPlaceholderData) setTotal(query.data.total)

  const selected = new Set(selectedIds)
  const toggle = (id: string) => emit(selected.has(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id])
  const hasFilters = Boolean(debouncedSearch || universeFilter || hasOrgUnits(orgScope) || orgScope.scopeType || productId || subjectScope.subjectId || subjectScope.subjectScopeType || state)
  const clearFilters = () => {
    setSearch("")
    setUniverseFilter(undefined)
    setOrgScope({})
    setProductId(undefined)
    setSubjectScope({})
    setState(undefined)
  }

  async function linkFiltered() {
    setBulkPending(true)
    try {
      const result = await fetchKnowledgeOptionIds(filter)
      const next = [...new Set([...selectedIds, ...result.ids])]
      const added = next.length - selectedIds.length
      emit(next)
      toast.success(added ? `${added} ${added === 1 ? "base ligada" : "bases ligadas"} ao agente. Salve para gravar.` : "As bases filtradas já estavam ligadas.")
      if (result.truncated) toast.warning(`Só as primeiras ${result.ids.length} de ${result.total} bases foram ligadas. Refine o filtro para ligar as demais.`)
    } catch {
      toast.error("Não foi possível ligar as bases filtradas. Tente de novo.")
    } finally {
      setBulkPending(false)
    }
  }
  const filteredCount = total ?? 0
  const notYetLinkedHint = selectedIds.length ? ` As ${selectedIds.length} bases já ligadas continuam ligadas.` : ""

  return (
    <div className="space-y-3">
      <ListToolbar
        search={<ListSearchInput value={search} onChange={setSearch} placeholder="Buscar por nome da base, assunto ou produto" ariaLabel="Buscar bases disponíveis" pending={query.isFetching} />}
        hasActiveFilters={hasFilters}
        onClearFilters={clearFilters}
      >
        {universe ? (
          // Universo do agente fixo: só bases dele ou ainda pendentes (outro universo seria recusado ao salvar).
          <ListSelectFilter<UniverseFilterValue>
            value={universeFilter}
            onChange={setUniverseFilter}
            options={[{ value: universe, label: `Só ${universe}` }, { value: "PENDING", label: "Só pendentes (sem universo)" }]}
            allLabel={`${universe} e pendentes`}
            ariaLabel="Filtrar por universo de atuação"
          />
        ) : (
          <ListSelectFilter<UniverseFilterValue>
            value={universeFilter}
            onChange={(next) => {
              setUniverseFilter(next)
              setOrgScope({})
            }}
            options={[...OPERATING_UNIVERSES.map((value) => ({ value, label: value })), { value: "PENDING", label: "Pendente (sem universo)" }]}
            allLabel="Qualquer universo"
            ariaLabel="Filtrar por universo de atuação"
          />
        )}
        <ListOrgScopeFilter permission="agents.manage" value={orgScope} onChange={setOrgScope} withinTeamIds={agentTeamIds(agentScope, teams)} universe={universe ?? (universeFilter !== "PENDING" ? universeFilter : undefined)} />
        <ProductFilter value={productId} onChange={setProductId} facets={facetsQuery.data} />
        <ListSubjectScopeFilter value={subjectScope} onChange={setSubjectScope} subjects={facetsQuery.data?.subjects} />
        <ListSelectFilter<KnowledgeOptionState> value={state} onChange={setState} options={STATE_OPTIONS} allLabel="Qualquer situação" ariaLabel="Filtrar por situação" />
      </ListToolbar>

      <div className="flex flex-col gap-2 rounded-xl border bg-muted/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {total === null ? "Contando bases…" : `${total} ${total === 1 ? "base disponível" : "bases disponíveis"}${hasFilters ? " neste filtro" : ""}`}
          {universe ? <> · só <UniverseBadge universe={universe} className="align-middle" /> e pendentes</> : null}
          {agentScope && agentScope.scopeType !== "ALL_TEAMS" ? " · globais e dos Grupos do agente" : null}
        </p>
        <ConfirmButton
          icon={<ListChecks data-icon="inline-start" />}
          label={bulkPending ? "Ligando…" : hasFilters ? `Ligar as ${filteredCount} filtradas` : `Ligar todas as ${filteredCount}`}
          disabled={bulkPending || filteredCount === 0}
          title={hasFilters ? `Ligar ${filteredCount} ${filteredCount === 1 ? "base filtrada" : "bases filtradas"}?` : `Ligar todas as ${filteredCount} bases disponíveis?`}
          description={
            hasFilters
              ? `Todas as ${filteredCount} bases deste filtro passam a ser consultadas pelo agente — não só as desta página.${notYetLinkedHint} Confira o filtro antes; nada é gravado até você salvar o agente.`
              : `Nenhum filtro está aplicado: TODAS as ${filteredCount} bases que este agente pode usar serão ligadas.${notYetLinkedHint} Agente com bases demais responde com trechos menos relevantes — prefira filtrar por Grupo, produto ou assunto.`
          }
          confirmLabel={hasFilters ? "Ligar as filtradas" : "Ligar todas"}
          onConfirm={() => void linkFiltered()}
        />
      </div>

      {query.isError ? (
        <InlineError message="Não foi possível carregar as bases." onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <LoadingState label="Carregando bases…" />
      ) : items.length === 0 ? (
        <EmptyState icon={SearchX} title={hasFilters ? "Nenhuma base neste filtro" : "Nenhuma base disponível"} description={hasFilters ? "Mude a busca ou limpe os filtros." : excluded.length ? "Todas as bases que este agente pode usar já estão ligadas." : "Não há bases que este agente possa usar."} />
      ) : (
        <ul className={cn("space-y-1.5", query.isPlaceholderData && "opacity-60")} aria-label="Bases disponíveis">
          {items.map((option) => (
            <KnowledgeOptionRow key={option.id} option={option} checked={selected.has(option.id)} onToggle={() => toggle(option.id)} />
          ))}
        </ul>
      )}
      <CursorPagination
        page={page}
        pageSize={pageSize}
        shownCount={items.length}
        total={total}
        hasNext={Boolean(query.data?.nextCursor) && !query.isPlaceholderData}
        onPrevious={() => setCursors((current) => (current.length > 1 ? current.slice(0, -1) : current))}
        onNext={() => {
          const next = query.data?.nextCursor
          if (next) setCursors((current) => [...current, next])
        }}
        onPageSizeChange={(size) => {
          setPageSize(size)
          setCursors([undefined])
        }}
        itemLabel={["base", "bases"]}
        isFetching={query.isFetching}
      />
    </div>
  )
}
