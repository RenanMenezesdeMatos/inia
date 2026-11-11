"use client"

import type { ReactNode } from "react"
import { FilterX, Search, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState, ErrorState } from "@/components/ui/states"
import type { ListViewMode } from "@/hooks/use-admin-list-state"
import { cn } from "@/lib/utils"
import { FailureSupport } from "@/components/error-states/support-details"

// Estados das listagens: carregando, erro, sem registro nenhum e sem resultado para os filtros.
// "Sem registros" e "sem resultados" são coisas diferentes para quem usa — o primeiro convida a
// cadastrar, o segundo a limpar filtros.

export function ListCardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-3", className)}>{children}</div>
}

export function ListSkeleton({ view, rows = 6 }: { view: ListViewMode; rows?: number }) {
  if (view === "cards") {
    return (
      <ListCardGrid aria-hidden>
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-52 w-full rounded-xl" />
        ))}
      </ListCardGrid>
    )
  }
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  )
}

/** Erro de lista — o `ErrorState` do kit (antes um bloco próprio, menor e sem ícone). */
/** `error` (opcional): o erro da consulta — mostra código e referência para o suporte quando houver. */
export function ListErrorState({ message, onRetry, error }: { message: string; onRetry: () => void; error?: unknown }) {
  return <ErrorState message={message} onRetry={onRetry} support={error === undefined ? undefined : <FailureSupport error={error} />} />
}

/** Lista sem nenhum registro — o `EmptyState` do kit (convida a cadastrar pela `action`). */
export function ListEmptyState({ icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return <EmptyState icon={icon} title={title} description={description} action={action} />
}

/** Filtros sem resultado — o `EmptyState` do kit com "Limpar filtros" (diferente de "sem registros": convida a limpar). */
export function ListNoResultsState({ title, onClear }: { title: string; onClear: () => void }) {
  return (
    <EmptyState
      icon={Search}
      title={title}
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          <FilterX /> Limpar filtros
        </Button>
      }
    />
  )
}
