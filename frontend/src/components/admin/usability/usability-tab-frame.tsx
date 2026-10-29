"use client"

import { useEffect, useState, type ReactNode } from "react"
import type { UseQueryResult } from "@tanstack/react-query"
import { Lock } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { ListErrorState } from "@/components/admin/shared/list/list-states"
import { AdminApiError } from "@/lib/admin/admin-api"
import type { UsabilityMeta } from "@/schemas/admin/usability.schema"
import { cn } from "@/lib/utils"

import { formatInstant } from "./usability-format"
import { CoverageBanner, usePanel } from "./usability-shared"

/**
 * Moldura de cada aba: carregando · erro (com o motivo do backend, ex.: filtro inválido) · sem permissão · dados. Nunca
 * mostra números de exemplo: sem resposta não há painel.
 */
export function TabFrame<T extends { meta: UsabilityMeta }>({ result, children }: { result: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (result.isPending) return <TabSkeleton />
  if (result.isError || !result.data) return <TabError error={result.error} onRetry={() => void result.refetch()} />
  return (
    <div className="space-y-4" aria-busy={result.isFetching}>
      <MetaLine meta={result.data.meta} fetching={result.isFetching} />
      <CoverageBanner coverage={result.data.meta.coverage} />
      {children(result.data)}
    </div>
  )
}

export function TabSkeleton() {
  return (
    <div className="space-y-4" aria-label="Carregando" role="status">
      <Skeleton className="h-4 w-72" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}

export function TabError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  // Recorte com menos de 5 pessoas para quem só vê agregados: não é falha — o filtro precisa ser ampliado (achado C18).
  if (error instanceof AdminApiError && error.code === "USABILITY_SMALL_COHORT") {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border px-4 py-10 text-center" role="status">
        <Lock className="size-6 text-muted-foreground" aria-hidden />
        <p className="font-medium">Recorte pequeno demais</p>
        <p className="max-w-md text-sm text-muted-foreground">{error.message}</p>
      </div>
    )
  }
  if (error instanceof AdminApiError && (error.code === "FORBIDDEN" || error.code === "USABILITY_PEOPLE_FORBIDDEN" || error.code === "USABILITY_EXPORT_FORBIDDEN")) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border px-4 py-10 text-center" role="alert">
        <Lock className="size-6 text-muted-foreground" aria-hidden />
        <p className="font-medium">Sem permissão para este recorte</p>
        <p className="max-w-md text-sm text-muted-foreground">{error.message}</p>
      </div>
    )
  }
  const details = error instanceof AdminApiError && Array.isArray(error.details) ? (error.details as { filter?: string; path?: string; reason?: string; message?: string }[]) : []
  return (
    <div className="space-y-2">
      <ListErrorState message={error instanceof Error ? error.message : "Não foi possível carregar a monitoria."} onRetry={onRetry} />
      {details.length > 0 ? (
        <ul className="mx-auto max-w-lg list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {details.map((detail, index) => (
            <li key={index}>{[detail.filter ?? detail.path, detail.reason ?? detail.message].filter(Boolean).join(": ")}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function MetaLine({ meta, fetching }: { meta: UsabilityMeta; fetching: boolean }) {
  const { timezone } = usePanel()
  const freshness = meta.freshness
  const lagging = freshness.lagSeconds > 120
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>
        <span className="font-medium text-foreground">{meta.period.label}</span>
        {meta.period.includesPartialToday ? " (hoje parcial)" : ""}
      </span>
      {meta.comparison ? <span>comparado a {meta.comparison.label}{meta.comparison.partialAligned ? " (mesmo corte do dia)" : ""}</span> : <span>sem comparação</span>}
      <span>fuso {meta.timezone}</span>
      <span className={lagging ? "text-amber-600" : undefined}>
        dados até {formatInstant(freshness.dataUpdatedUntil, timezone)}
        {lagging ? ` · processamento atrasado ${Math.round(freshness.lagSeconds / 60)} min` : ""}
      </span>
      {meta.structureBasis ? <span>{meta.structureBasis.label}</span> : null}
      <span>definições {meta.definitionsVersion}</span>
      {fetching ? <span aria-live="polite">atualizando…</span> : null}
    </p>
  )
}

/** Evita a corrida do ResponsiveContainer com a aba ainda montando (mesmo padrão dos gráficos da tela de IA). */
export function DeferredMount({ children, className = "h-56" }: { children: ReactNode; className?: string }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const timeout = window.setTimeout(() => setReady(true), 150)
    return () => window.clearTimeout(timeout)
  }, [])
  if (!ready) return <div className={cn(className, "w-full animate-pulse rounded-lg bg-muted/40")} aria-hidden />
  return <>{children}</>
}
