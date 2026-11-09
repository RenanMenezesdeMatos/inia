"use client"

import { useMemo, useState } from "react"
import { Ban, ChevronLeft, ChevronRight, Download, FilterX, Hash, Lock, Search, ShieldAlert, TableProperties } from "lucide-react"
import { toast } from "sonner"

import { ListEmptyState, ListErrorState, ListSkeleton } from "@/components/admin/shared/list/list-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AdminApiError } from "@/lib/admin/admin-api"
import { useExplorerCatalogQuery, useExplorerDatasetQuery, useExplorerPageQuery } from "@/queries/admin/use-data-explorer-queries"
import type { CancellationScope, ExplorerCount, ExplorerDataset, ExplorerGroupRequest, ExplorerLimits, ExplorerRecordStatus, ExplorerRequest, ExplorerSort } from "@/schemas/admin/data-explorer.schema"
import { exportExplorerCsv, runExplorerCount } from "@/services/admin/data-explorer-service"

import { formatCount } from "../data-hub-format"
import { CancelRecordsDialog } from "./cancel-records-dialog"
import { CancellationsPanel } from "./cancellations-panel"
import { ColumnPicker } from "./column-picker"
import { DeletedItemsPanel } from "./deleted-items-panel"
import { countConditions, describeFilter, draftProblem, emptyGroup, toFilterRequest, type DraftGroup } from "./explorer-filter-model"
import { FilterBuilder } from "./filter-builder"
import { ResultsTable } from "./results-table"

const errorMessage = (error: unknown, fallback: string) => (error instanceof AdminApiError ? error.message : fallback)

/** Fica na mesma lista dos conjuntos, mas não é um deles: nunca vai para o servidor como código de conjunto. */
const DELETED_ITEMS_VIEW = "__deleted_items__"

/**
 * Consultar dados: escolhe um conjunto aprovado, monta filtros e exporta. O servidor decide o que é permitido; aqui só se evita gastar uma consulta com um pedido incompleto.
 * A consulta só lê. Cancelar registro é uma ação à parte, com permissão própria, que o servidor libera por conjunto (`canCancel`).
 */
export function DataExplorerTab() {
  const catalog = useExplorerCatalogQuery()
  const [selection, setSelection] = useState<string | null>(null)
  const showingDeleted = selection === DELETED_ITEMS_VIEW
  const datasetCode = showingDeleted ? null : selection
  const dataset = useExplorerDatasetQuery(datasetCode)

  if (catalog.isLoading) return <ListSkeleton view="list" rows={4} />
  if (catalog.isError || !catalog.data) return <ListErrorState message={errorMessage(catalog.error, "Não foi possível carregar os conjuntos de dados.")} onRetry={() => void catalog.refetch()} />

  const imported = catalog.data.datasets.filter((entry) => entry.origin === "IMPORTED")
  const generated = catalog.data.datasets.filter((entry) => entry.origin === "GENERATED")

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>Consultar e exportar não alteram nenhum dado: só os conjuntos e colunas aprovados, sempre da sua organização. Cada consulta e exportação fica no Registro, sem os valores dos filtros.</span>
      </p>

      <div className="max-w-md space-y-1">
        <label htmlFor="explorer-dataset" className="text-sm font-medium">
          Conjunto de dados
        </label>
        <Select value={selection ?? ""} onValueChange={setSelection}>
          <SelectTrigger id="explorer-dataset" className="w-full">
            <SelectValue placeholder="Escolha um conjunto" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Importados</SelectLabel>
              {imported.map((entry) => (
                <SelectItem key={entry.code} value={entry.code}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Gerados pela INIA</SelectLabel>
              {generated.map((entry) => (
                <SelectItem key={entry.code} value={entry.code}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectGroup>
            {catalog.data.deletedItemTypes.length > 0 ? (
              <SelectGroup>
                <SelectLabel>Excluídos</SelectLabel>
                <SelectItem value={DELETED_ITEMS_VIEW}>Itens excluídos</SelectItem>
              </SelectGroup>
            ) : null}
          </SelectContent>
        </Select>
        {dataset.data ? <p className="text-sm text-muted-foreground">{dataset.data.description}</p> : null}
        {showingDeleted ? <p className="text-sm text-muted-foreground">O que foi excluído continua guardado e aparece aqui, se você administra aquele tipo de objeto. Restaurar traz de volta desligado: quem restaura liga na tela dele.</p> : null}
      </div>

      {showingDeleted ? <DeletedItemsPanel types={catalog.data.deletedItemTypes} /> : null}
      {selection === null ? <ListEmptyState icon={TableProperties} title="Escolha um conjunto de dados" description="Os registros aparecem aqui, em páginas. Depois você pode escolher as colunas, ordenar, filtrar e exportar." /> : null}
      {dataset.isError ? <ListErrorState message={errorMessage(dataset.error, "Não foi possível abrir este conjunto.")} onRetry={() => void dataset.refetch()} /> : null}
      {/* A chave recomeça tudo por conjunto: colunas, ordem e filtros de um nunca chegam ao outro. */}
      {dataset.data ? <DatasetExplorer key={dataset.data.code} dataset={dataset.data} limits={catalog.data.limits} /> : null}
    </div>
  )
}

/** A consulta só sai quando a pessoa pede ("Aplicar", trocar de página, ordenar), porque cada uma conta no limite por minuto e fica no registro. */
function DatasetExplorer({ dataset, limits }: { dataset: ExplorerDataset; limits: ExplorerLimits }) {
  const [selectedColumns, setSelectedColumns] = useState<string[]>(() => dataset.columns.filter((column) => column.defaultVisible).map((column) => column.key))
  const [sort, setSort] = useState<ExplorerSort>(dataset.defaultSort)
  const [pageSize, setPageSize] = useState<number>(limits.defaultPageSize)
  const [draft, setDraft] = useState<DraftGroup>(() => emptyGroup())
  const [appliedFilter, setAppliedFilter] = useState<ExplorerGroupRequest | undefined>(undefined)
  const [searchDraft, setSearchDraft] = useState("")
  const [appliedSearch, setAppliedSearch] = useState("")
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [problem, setProblem] = useState<string | null>(null)
  const [count, setCount] = useState<ExplorerCount | null>(null)
  const [counting, setCounting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [recordStatus, setRecordStatus] = useState<ExplorerRecordStatus>("ALL")
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [cancelScope, setCancelScope] = useState<CancellationScope | null>(null)

  const columnsByKey = useMemo(() => new Map(dataset.columns.map((column) => [column.key, column])), [dataset])
  const searchableLabels = dataset.columns.filter((column) => column.searchable).map((column) => column.label)
  const hasPersonal = selectedColumns.some((key) => columnsByKey.get(key)?.personal)

  const cursor = cursors[cursors.length - 1]
  const baseRequest: ExplorerRequest = { dataset: dataset.code, columns: selectedColumns, sort, ...(appliedFilter ? { filter: appliedFilter } : {}), ...(appliedSearch ? { search: appliedSearch } : {}), ...(dataset.cancellable ? { recordStatus } : {}) }
  const page = useExplorerPageQuery({ ...baseRequest, pageSize, ...(cursor ? { cursor } : {}) })

  /** Qualquer mudança no que é consultado volta para a primeira página e invalida a contagem. */
  function resetPosition() {
    setCursors([undefined])
    setCount(null)
    setActionError(null)
    setSelectedKeys(new Set())
  }

  /** Muda a página: o que estava marcado sai de vista, então a marcação não fica valendo escondida. */
  function changePage(update: (current: (string | undefined)[]) => (string | undefined)[]) {
    setCursors(update)
    setSelectedKeys(new Set())
  }

  function applyFilters() {
    const issue = draftProblem(draft, columnsByKey, limits)
    if (issue) {
      setProblem(issue)
      return
    }
    const term = searchDraft.trim()
    if (term.length > 0 && (term.length < limits.minSearchLength || term.length > limits.maxSearchLength)) {
      setProblem(`A busca precisa ter de ${limits.minSearchLength} a ${limits.maxSearchLength} caracteres.`)
      return
    }
    setProblem(null)
    setAppliedFilter(toFilterRequest(draft, columnsByKey))
    setAppliedSearch(term)
    resetPosition()
  }

  function clearFilters() {
    setDraft(emptyGroup())
    setAppliedFilter(undefined)
    setSearchDraft("")
    setAppliedSearch("")
    setProblem(null)
    resetPosition()
  }

  async function handleCount() {
    setCounting(true)
    setActionError(null)
    try {
      setCount(await runExplorerCount(baseRequest))
    } catch (error) {
      setActionError(errorMessage(error, "Não foi possível contar os registros."))
    } finally {
      setCounting(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    setActionError(null)
    try {
      const { blob, filename } = await exportExplorerCsv(baseRequest)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename ?? `consulta-${dataset.code}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success("Exportação concluída.")
    } catch (error) {
      setActionError(errorMessage(error, "Não foi possível exportar."))
    } finally {
      setExporting(false)
    }
  }

  const appliedConditions = describeFilter(appliedFilter, columnsByKey)
  const hasApplied = appliedConditions.length > 0 || appliedSearch.length > 0
  const hasDraft = countConditions(draft) > 0 || searchDraft.trim().length > 0
  const pageNumber = cursors.length

  return (
    <>
      <section className="space-y-3 rounded-xl border border-border p-4" aria-label="Filtros">
        {searchableLabels.length > 0 ? (
          <div className="relative max-w-xl">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input
              aria-label="Buscar"
              className="pl-8"
              placeholder={`Buscar em ${searchableLabels.join(", ")}`}
              value={searchDraft}
              maxLength={limits.maxSearchLength}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyFilters()
              }}
            />
          </div>
        ) : null}
        <FilterBuilder draft={draft} columns={dataset.columns} limits={limits} onChange={setDraft} />
        {problem ? (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={applyFilters}>
            Aplicar
          </Button>
          {hasApplied || hasDraft ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              <FilterX data-icon="inline-start" /> Limpar filtros
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {countConditions(draft)} de {limits.maxFilterConditions} condições
          </span>
        </div>
        {hasApplied ? (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="explorer-applied">
            <span className="text-xs font-medium text-muted-foreground">Valendo:</span>
            {appliedSearch ? <Badge variant="secondary">Busca: {appliedSearch}</Badge> : null}
            {appliedConditions.map((text, index) => (
              <Badge key={index} variant="secondary" className="max-w-full whitespace-normal text-left">
                {text}
              </Badge>
            ))}
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <ColumnPicker
          columns={dataset.columns}
          selected={selectedColumns}
          maxSelected={limits.maxSelectedColumns}
          onApply={(keys) => {
            setSelectedColumns(keys)
            setActionError(null)
          }}
        />
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            setPageSize(Number(value))
            resetPosition()
          }}
        >
          <SelectTrigger size="sm" className="w-32" aria-label="Registros por página">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[25, 50, limits.maxPageSize]
              .filter((size, index, all) => size <= limits.maxPageSize && all.indexOf(size) === index)
              .map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} por página
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {dataset.cancellable ? (
          <Select
            value={recordStatus}
            onValueChange={(value) => {
              setRecordStatus(value as ExplorerRecordStatus)
              resetPosition()
            }}
          >
            <SelectTrigger size="sm" className="w-44" aria-label="Situação do registro">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os registros</SelectItem>
              <SelectItem value="ACTIVE">Só os ativos</SelectItem>
              <SelectItem value="CANCELLED">Só os cancelados</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        <Button type="button" variant="outline" size="sm" disabled={counting} onClick={() => void handleCount()}>
          <Hash data-icon="inline-start" /> {counting ? "Contando…" : "Contar registros"}
        </Button>
        {count ? (
          <span className="text-sm" data-testid="explorer-count">
            {count.capped ? `Mais de ${formatCount(limits.countCap)} registros` : `${formatCount(count.count)} ${count.count === 1 ? "registro" : "registros"}`}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Até {formatCount(limits.exportMaxRows)} linhas ou {Math.round(limits.exportMaxBytes / 1_048_576)} MB
          </span>
          <Button type="button" variant="outline" size="sm" disabled={exporting} onClick={() => void handleExport()}>
            <Download data-icon="inline-start" /> {exporting ? "Exportando…" : "Exportar CSV"}
          </Button>
        </div>
      </div>

      {hasPersonal ? (
        <p className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
          <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
          Esta consulta mostra dados pessoais. Use só o necessário e não compartilhe o arquivo fora das regras da empresa.
        </p>
      ) : null}

      {dataset.canCancel ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="explorer-cancel-actions">
          <Button type="button" variant="outline" size="sm" disabled={selectedKeys.size === 0} onClick={() => setCancelScope({ dataset: dataset.code, keys: [...selectedKeys] })}>
            <Ban data-icon="inline-start" /> Cancelar selecionados{selectedKeys.size > 0 ? ` (${selectedKeys.size})` : ""}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!hasApplied || recordStatus === "CANCELLED"} onClick={() => setCancelScope({ dataset: dataset.code, ...(appliedFilter ? { filter: appliedFilter } : {}), ...(appliedSearch ? { search: appliedSearch } : {}) })}>
            <Ban data-icon="inline-start" /> Cancelar todos do filtro
          </Button>
          <span className="text-xs text-muted-foreground">Marque registros na tabela ou aplique um filtro. O dado fica guardado e sai dos cálculos.</span>
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      {page.isError ? <ListErrorState message={errorMessage(page.error, "Não foi possível consultar os dados.")} onRetry={() => void page.refetch()} /> : null}
      {page.isLoading ? <ListSkeleton view="list" rows={5} /> : null}

      {page.data && !page.isError ? (
        page.data.rows.length === 0 ? (
          hasApplied ? (
            <ListEmptyState icon={Search} title="Nenhum registro com estes filtros" description="Mude ou limpe os filtros." action={<Button variant="outline" size="sm" onClick={clearFilters}>Limpar filtros</Button>} />
          ) : (
            <ListEmptyState icon={TableProperties} title="Nenhum registro neste conjunto" description="Quando houver dados, eles aparecem aqui." />
          )
        ) : (
          <div className="space-y-2" aria-busy={page.isFetching}>
            <ResultsTable
              page={page.data}
              columns={dataset.columns}
              sort={sort}
              onSort={(next) => {
                setSort(next)
                resetPosition()
              }}
              {...(dataset.canCancel ? { selection: { selected: selectedKeys, onChange: setSelectedKeys } } : {})}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Página {pageNumber} · {page.data.rows.length} registros · Horários no seu fuso; filtros de data no fuso da organização ({page.data.timeZone})</p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={pageNumber <= 1 || page.isFetching} onClick={() => changePage((current) => current.slice(0, -1))}>
                  <ChevronLeft data-icon="inline-start" /> Anterior
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!page.data.nextCursor || page.isFetching}
                  onClick={() => {
                    const next = page.data?.nextCursor
                    if (next) changePage((current) => [...current, next])
                  }}
                >
                  Próxima <ChevronRight data-icon="inline-end" />
                </Button>
              </div>
            </div>
          </div>
        )
      ) : null}

      {dataset.canCancel ? <CancellationsPanel dataset={dataset.code} onChanged={resetPosition} /> : null}
      {cancelScope ? (
        <CancelRecordsDialog
          scope={cancelScope}
          onClose={() => setCancelScope(null)}
          onCancelled={() => {
            setCancelScope(null)
            // Volta à primeira página: em "Só os ativos", a página atual pode ter ficado vazia.
            resetPosition()
          }}
        />
      ) : null}
    </>
  )
}
