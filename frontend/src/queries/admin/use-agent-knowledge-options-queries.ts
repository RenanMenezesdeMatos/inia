import { useCallback, useEffect, useMemo, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { KnowledgeOption, KnowledgeOptionsFilter } from "@/schemas/admin/agent-knowledge-options.schema"
import { fetchKnowledgeOptionFacets, lookupKnowledgeOptions, searchKnowledgeOptions } from "@/services/admin/agent-knowledge-options-service"

import { adminQueryKeys } from "./admin-query-keys"

// Debaixo de `knowledge()`: criar, editar ou arquivar uma base invalida também o seletor do agente.
const optionsKey = (...parts: unknown[]) => [...adminQueryKeys.knowledge(), "agent-options", ...parts] as const

/** Uma página das bases disponíveis (posição opaca do servidor; a anterior fica na tela enquanto a próxima carrega). */
export function useKnowledgeOptionsQuery(filter: KnowledgeOptionsFilter, page: { cursor: string | undefined; limit: number }, enabled = true) {
  return useQuery({
    queryKey: optionsKey("search", filter, page),
    queryFn: () => searchKnowledgeOptions({ ...filter, ...(page.cursor ? { cursor: page.cursor } : {}), limit: page.limit }),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useKnowledgeOptionFacetsQuery(agentUniverse: string | undefined) {
  return useQuery({ queryKey: optionsKey("facets", agentUniverse ?? null), queryFn: () => fetchKnowledgeOptionFacets(agentUniverse) })
}

export type KnownKnowledgeOptions = {
  /** Linha conhecida de cada id (das páginas vistas ou da leitura das escolhidas). */
  byId: ReadonlyMap<string, KnowledgeOption>
  /** Ids escolhidos que o servidor não devolveu (fora do alcance de quem edita): mostrados só com o título que o agente traz. */
  unavailable: ReadonlySet<string>
  /** Guarda as linhas de uma página da lista (evita reler a escolhida pelo id). */
  remember: (rows: readonly KnowledgeOption[]) => void
}

/**
 * Linhas das bases ESCOLHIDAS: lê pelo id só as que ainda não são conhecidas (a lista de escolhidas muda a cada clique; reler tudo a cada
 * vez seria desperdício com centenas de bases). Arquivada, sem versão ou de outro universo voltam do servidor e nunca somem.
 */
export function useKnownKnowledgeOptions(selectedIds: readonly string[]): KnownKnowledgeOptions {
  const [byId, setById] = useState<ReadonlyMap<string, KnowledgeOption>>(() => new Map())
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(() => new Set())
  const missing = useMemo(() => selectedIds.filter((id) => !byId.has(id) && !unavailable.has(id)), [selectedIds, byId, unavailable])
  const missingKey = missing.join(",")

  const remember = useCallback((rows: readonly KnowledgeOption[]) => {
    if (rows.length === 0) return
    setById((current) => {
      if (rows.every((row) => current.get(row.id) === row)) return current
      const next = new Map(current)
      for (const row of rows) next.set(row.id, row)
      return next
    })
  }, [])

  useEffect(() => {
    if (!missingKey) return
    const ids = missingKey.split(",")
    let cancelled = false
    lookupKnowledgeOptions(ids)
      .then((rows) => {
        if (cancelled) return
        remember(rows)
        const found = new Set(rows.map((row) => row.id))
        const absent = ids.filter((id) => !found.has(id))
        if (absent.length) setUnavailable((current) => new Set([...current, ...absent]))
      })
      .catch(() => {
        // Falha de rede: tenta de novo na próxima mudança da escolha; a lista mostra o título que o agente traz.
      })
    return () => {
      cancelled = true
    }
  }, [missingKey, remember])

  return { byId, unavailable, remember }
}
