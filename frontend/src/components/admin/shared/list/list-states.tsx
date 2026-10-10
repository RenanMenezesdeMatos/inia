"use client"

import type { ReactNode } from "react"
import { FilterX, Search, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { ListViewMode } from "@/hooks/use-admin-list-state"
import { cn } from "@/lib/utils"

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

export function ListErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
      <p className="text-sm text-destructive">{message}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  )
}

export function ListEmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border p-10 text-center">
      <Icon className="size-8 text-muted-foreground/60" />
      <p className="mt-3 text-sm font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function ListNoResultsState({ title, onClear }: { title: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border p-10 text-center">
      <Search className="size-8 text-muted-foreground/60" />
      <p className="mt-3 text-sm font-medium">{title}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onClear}>
        <FilterX /> Limpar filtros
      </Button>
    </div>
  )
}
