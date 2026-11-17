"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, FileText, Plus, X } from "lucide-react"

import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { InlineError } from "@/components/ui/states"
import { cn } from "@/lib/utils"
import { useProcessOptionsQuery } from "@/queries/operational-alignments/use-operational-alignment-queries"
import { PROCESS_TYPE_LABELS } from "@/schemas/operational-alignments/operational-alignment.schema"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

const ALL_TYPES = "__all__"
export type PickedProcess = { id: string; title: string; documentType: string | null; operatingUniverse?: OperatingUniverse | null | undefined }

const typeLabel = (type: string | null) => (type ? (PROCESS_TYPE_LABELS[type] ?? type) : "Base")

function useDebounced<T>(value: T, ms = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/**
 * Seletor de PROCESSOS para mais de mil bases: a busca, o tipo (PR, IT…) e o universo são filtrados NO SERVIDOR e o resultado vem em
 * páginas; cada processo entra com "Incluir" (ou todos da página), e os incluídos ficam numa lista própria, com busca e remoção. Nunca
 * carrega o catálogo inteiro no navegador.
 */
export function ProcessPicker({ value, onChange, universe, error }: { value: PickedProcess[]; onChange: (next: PickedProcess[]) => void; universe: OperatingUniverse | null; error?: string | undefined }) {
  const [search, setSearch] = useState("")
  const [type, setType] = useState<string>(ALL_TYPES)
  const [pageSize, setPageSize] = useState(10)
  const [selectedFilter, setSelectedFilter] = useState("")
  const debounced = useDebounced(search)
  // A página volta à primeira quando a busca, o tipo ou o universo mudam (a página guardada vale só para aquele filtro).
  const filterKey = `${debounced}|${type}|${universe ?? ""}`
  const [paging, setPaging] = useState({ key: filterKey, page: 1 })
  const page = paging.key === filterKey ? paging.page : 1
  const setPage = (next: number) => setPaging({ key: filterKey, page: next })
  const query = useProcessOptionsQuery({ search: debounced || undefined, documentType: type === ALL_TYPES ? undefined : type, operatingUniverse: universe ?? undefined, page, pageSize })
  const selectedIds = useMemo(() => new Set(value.map((process) => process.id)), [value])
  const items = query.data?.items ?? []
  const notYet = items.filter((item) => !selectedIds.has(item.id))
  const include = (entries: PickedProcess[]) => onChange([...value, ...entries.filter((entry) => !selectedIds.has(entry.id))])
  const remove = (id: string) => onChange(value.filter((process) => process.id !== id))
  const shownSelected = selectedFilter.trim() ? value.filter((process) => process.title.toLowerCase().includes(selectedFilter.trim().toLowerCase())) : value

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="grid min-w-0 content-start gap-3 rounded-xl border p-3">
        <div className="text-sm font-medium">Buscar processos</div>
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-0 flex-1 basis-56" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome do PR, IT ou fluxo" aria-label="Buscar processo" />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Tipo de processo"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TYPES}>Todos os tipos</SelectItem>
              {Object.entries(PROCESS_TYPE_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {query.isError ? <InlineError message="Não foi possível buscar os processos." onRetry={() => query.refetch()} /> : null}
        <ul className={cn("grid min-w-0 gap-1", query.isFetching && "opacity-70")} aria-label="Processos encontrados">
          {items.length === 0 && !query.isLoading ? <li className="px-2 py-6 text-center text-sm text-muted-foreground">Nenhum processo publicado corresponde à busca.</li> : null}
          {items.map((item) => {
            const picked = selectedIds.has(item.id)
            return (
              <li key={item.id} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{item.title}</div>
                  <div className="text-xs text-muted-foreground">{typeLabel(item.documentType)}{item.operatingUniverse ? ` · ${item.operatingUniverse}` : ""}</div>
                </div>
                {picked ? (
                  <Badge variant="secondary" className="shrink-0"><Check className="size-3" />Incluído</Badge>
                ) : (
                  <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => include([{ id: item.id, title: item.title, documentType: item.documentType, operatingUniverse: item.operatingUniverse }])} aria-label={`Incluir ${item.title}`}>
                    <Plus className="size-3.5" />Incluir
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={notYet.length === 0} onClick={() => include(notYet.map((item) => ({ id: item.id, title: item.title, documentType: item.documentType, operatingUniverse: item.operatingUniverse })))}>
            Incluir os {notYet.length} desta página
          </Button>
        </div>
        {query.data ? <ListPagination stacked page={query.data.page} pageSize={pageSize} total={query.data.total} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} itemLabel={["processo", "processos"]} isFetching={query.isFetching} /> : null}
      </div>

      <div className="grid min-w-0 content-start gap-3 rounded-xl border p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">Processos incluídos ({value.length})</div>
          {value.length > 0 ? <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>Remover todos</Button> : null}
        </div>
        {value.length > 8 ? <Input value={selectedFilter} onChange={(event) => setSelectedFilter(event.target.value)} placeholder="Filtrar os incluídos" aria-label="Filtrar processos incluídos" /> : null}
        {value.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nenhum processo incluído. O alinhamento vale sempre para ao menos um processo.</p>
        ) : (
          <ul className="grid max-h-96 gap-1 overflow-y-auto" aria-label="Processos incluídos">
            {shownSelected.map((process) => (
              <li key={process.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{process.title}</div>
                  <div className="text-xs text-muted-foreground">{typeLabel(process.documentType)}</div>
                </div>
                <Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => remove(process.id)} aria-label={`Remover ${process.title}`}>
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  )
}
