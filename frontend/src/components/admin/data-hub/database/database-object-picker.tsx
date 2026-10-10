"use client"

import { useEffect, useMemo, useState } from "react"
import { Eye, KeyRound, Loader2, Search, Table2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { AdminApiError } from "@/lib/admin/admin-api"
import { cn } from "@/lib/utils"
import { useDatabaseColumnsQuery, useDatabaseObjectsQuery } from "@/queries/admin/use-data-hub-queries"
import { COLUMN_CATEGORY_LABELS, type DatabaseObjectDescription, type DatabaseObjectSummary } from "@/schemas/admin/data-hub.schema"

/**
 * Escolha da tabela ou visão no banco externo — a lista vem do catálogo do próprio banco e só traz o que o usuário
 * da conexão PODE ler. Ao escolher, mostra as colunas (tipo, chave primária) para a pessoa confirmar o que está
 * selecionando. Nada é lido além do catálogo nesta etapa.
 */
export type DatabaseObjectRef = { schema: string; name: string; kind: "TABLE" | "VIEW" }

function useDebounced<T>(value: T, delay = 300): T {
  const [current, setCurrent] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return current
}

function formatRows(rows: number | null): string | null {
  if (rows === null || rows < 0) return null
  return `~${new Intl.NumberFormat("pt-BR").format(rows)} linha(s)`
}

export function DatabaseObjectPicker({ sourceId, value, onChange, onDescribed }: { sourceId: string; value: DatabaseObjectRef | null; onChange: (next: DatabaseObjectRef) => void; onDescribed?: (description: DatabaseObjectDescription | null) => void }) {
  const [search, setSearch] = useState("")
  const debounced = useDebounced(search)
  const objects = useDatabaseObjectsQuery(sourceId, debounced)
  const columns = useDatabaseColumnsQuery(sourceId, value ? { schema: value.schema, name: value.name } : null)

  useEffect(() => {
    onDescribed?.(columns.data ?? null)
  }, [columns.data, onDescribed])

  const grouped = useMemo(() => {
    const groups = new Map<string, DatabaseObjectSummary[]>()
    for (const object of objects.data?.objects ?? []) {
      if (!groups.has(object.schema)) groups.set(object.schema, [])
      groups.get(object.schema)!.push(object)
    }
    return [...groups.entries()]
  }, [objects.data])

  const errorMessage = (error: unknown) => (error instanceof AdminApiError ? error.message : "Não foi possível consultar o banco.")

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar tabela ou visão" className="pl-8" aria-label="Buscar tabela ou visão" />
          {objects.isFetching ? <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden /> : null}
        </div>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-border" role="listbox" aria-label="Tabelas e visões">
          {objects.isLoading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-6" />
              <Skeleton className="h-6" />
              <Skeleton className="h-6" />
            </div>
          ) : objects.isError ? (
            <p className="p-3 text-sm text-destructive" role="alert">
              {errorMessage(objects.error)}
            </p>
          ) : grouped.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{debounced ? "Nada encontrado com essa busca." : "Este usuário não tem permissão de leitura em nenhuma tabela ou visão deste banco."}</p>
          ) : (
            grouped.map(([schema, items]) => (
              <div key={schema}>
                <p className="sticky top-0 bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">{schema}</p>
                {items.map((object) => {
                  const selected = value?.schema === object.schema && value.name === object.name
                  return (
                    <button
                      key={`${object.schema}.${object.name}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => onChange({ schema: object.schema, name: object.name, kind: object.kind })}
                      className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60", selected && "bg-primary/10 font-medium text-primary")}
                    >
                      {object.kind === "VIEW" ? <Eye className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <Table2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                      <span className="min-w-0 flex-1 truncate">{object.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground" title={object.kind === "VIEW" || object.estimatedRows === null ? undefined : "Estimativa do próprio banco — pode diferir do total real."}>{object.kind === "VIEW" ? "Visão" : formatRows(object.estimatedRows) ?? "Tabela"}</span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
        {objects.data?.truncated ? <p className="text-xs text-muted-foreground">Mostrando os primeiros 2.000 objetos — use a busca para encontrar outros.</p> : null}
      </div>

      <div className="space-y-2" aria-live="polite">
        {!value ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Escolha uma tabela ou visão para ver as colunas.</p>
        ) : columns.isLoading ? (
          <Skeleton className="h-48 rounded-lg" />
        ) : columns.isError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200" role="alert">
            {errorMessage(columns.error)}
          </p>
        ) : columns.data ? (
          <div className="rounded-lg border border-border">
            <p className="border-b border-border px-3 py-2 text-sm font-medium">
              {columns.data.kind === "VIEW" ? "Visão" : "Tabela"} {columns.data.schema}.{columns.data.name} · {columns.data.columns.length} coluna(s)
            </p>
            <ul className="max-h-72 divide-y divide-border overflow-y-auto text-sm">
              {columns.data.columns.map((column) => (
                <li key={column.name} className={cn("flex items-center gap-2 px-3 py-1.5", !column.supported && "text-muted-foreground")}>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{column.name}</span>
                  {column.primaryKeyPosition ? (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <KeyRound className="size-3" aria-hidden /> chave
                    </Badge>
                  ) : null}
                  <span className="shrink-0 text-xs text-muted-foreground">{COLUMN_CATEGORY_LABELS[column.category] ?? column.nativeType}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}
