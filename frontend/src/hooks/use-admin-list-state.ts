"use client"

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"

import type { PageResult } from "@/lib/admin/list-query"

import { useDebouncedValue } from "./use-debounced-value"

export type ListViewMode = "list" | "cards"

export const LIST_PAGE_SIZE_OPTIONS = [10, 20, 50] as const
const VIEW_STORAGE_PREFIX = "inia.admin.list-view."

type BaseFilters = { search: string }

type Options<F extends BaseFilters> = {
  // Identifica a tela — a preferência lista/cards é guardada por tela, não globalmente.
  storageKey: string
  defaultFilters: F
  /** Filtros com que a tela abre quando outra tela a chama já filtrada; "Limpar filtros" continua voltando a `defaultFilters`. */
  initialFilters?: F
  defaultPageSize?: number
  defaultView?: ListViewMode
}

function isSameFilterValue(a: unknown, b: unknown) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => value === b[index])
  if (a && b && typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}

// Preferência lista/cards por tela, lida via useSyncExternalStore para não divergir entre o
// HTML do servidor (sempre o padrão) e o primeiro render no cliente. Sem localStorage (modo
// privado etc.) a escolha vive só em memória durante a sessão.
const memoryViews = new Map<string, ListViewMode>()
const viewListeners = new Set<() => void>()

function subscribeToViews(listener: () => void) {
  viewListeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    viewListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function readStoredView(storageKey: string): ListViewMode | null {
  const inMemory = memoryViews.get(storageKey)
  if (inMemory) return inMemory
  try {
    const stored = window.localStorage.getItem(`${VIEW_STORAGE_PREFIX}${storageKey}`)
    return stored === "list" || stored === "cards" ? stored : null
  } catch {
    return null
  }
}

function writeStoredView(storageKey: string, view: ListViewMode) {
  memoryViews.set(storageKey, view)
  try {
    window.localStorage.setItem(`${VIEW_STORAGE_PREFIX}${storageKey}`, view)
  } catch {
    // fica só em memória
  }
  for (const listener of viewListeners) listener()
}

// Estado comum das listagens administrativas: filtros (com busca debounced), página, tamanho da
// página e modo de visualização. Qualquer mudança de filtro ou de tamanho volta para a primeira
// página; trocar lista/cards não mexe em nada disso.
export function useAdminListState<F extends BaseFilters>({ storageKey, defaultFilters, initialFilters, defaultPageSize = 10, defaultView = "list" }: Options<F>) {
  const [filters, setFiltersState] = useState<F>(initialFilters ?? defaultFilters)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = useState(defaultPageSize)
  const view = useSyncExternalStore(
    subscribeToViews,
    () => readStoredView(storageKey) ?? defaultView,
    () => defaultView,
  )
  const setView = useCallback((next: ListViewMode) => writeStoredView(storageKey, next), [storageKey])

  const setFilter = useCallback(<K extends keyof F>(key: K, value: F[K]) => {
    setFiltersState((previous) => ({ ...previous, [key]: value }))
    setPage(1)
  }, [])

  const patchFilters = useCallback((patch: Partial<F>) => {
    setFiltersState((previous) => ({ ...previous, ...patch }))
    setPage(1)
  }, [])

  const resetFilters = useCallback(() => {
    setFiltersState(defaultFilters)
    setPage(1)
    // defaultFilters é um literal estável por tela; recriá-lo a cada render não muda o conteúdo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size)
    setPage(1)
  }, [])

  const debouncedSearch = useDebouncedValue(filters.search.trim(), 300)

  // Filtros opcionais (teamId, subjectId...) podem nem existir no default — compara a união das
  // chaves, senão um filtro de grupo ativo passaria batido.
  const hasActiveFilters = useMemo(
    () => [...new Set([...Object.keys(defaultFilters), ...Object.keys(filters)])].some((key) => !isSameFilterValue(filters[key as keyof F], defaultFilters[key as keyof F])),
    [filters, defaultFilters],
  )

  // O que vai para a query: filtros com a busca já debounced + paginação. É a query key inteira.
  const params = useMemo(() => ({ ...filters, search: debouncedSearch || undefined, page, pageSize }), [filters, debouncedSearch, page, pageSize])

  return {
    filters,
    setFilter,
    patchFilters,
    resetFilters,
    hasActiveFilters,
    isSearchPending: filters.search.trim() !== debouncedSearch,
    page,
    setPage,
    pageSize,
    setPageSize,
    view,
    setView,
    params,
  }
}

export type AdminListState<F extends BaseFilters> = ReturnType<typeof useAdminListState<F>>

// Depois de uma exclusão (ou de um filtro que encolheu o conjunto) a página atual pode ficar
// vazia enquanto ainda existem registros — volta para a última página válida.
export function useClampListPage(result: PageResult<unknown> | undefined, page: number, pageSize: number, setPage: (page: number) => void) {
  useEffect(() => {
    // Com keepPreviousData o resultado pode ser o da página anterior — só decide sobre o atual.
    if (!result || page === 1 || result.page !== page) return
    if (result.items.length > 0 || result.total === 0) return
    setPage(Math.max(1, Math.ceil(result.total / pageSize)))
  }, [result, page, pageSize, setPage])
}
