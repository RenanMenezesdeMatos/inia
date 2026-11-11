"use client"

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { ApiError } from "@/lib/api/api-client"
import { cn } from "@/lib/utils"

// Estados compartilhados das áreas de Indicadores e Equipe: carregando (skeleton local, nunca
// bloqueando a tela inteira), vazio (SEM DADOS é first-class) e erro (403 de escopo tem mensagem
// própria — não é "falha de rede").

export function AnalyticsCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <Card className={cn("border-0 bg-card shadow-none ring-0", className)}>
      <CardContent className="p-5 sm:p-6">{children}</CardContent>
    </Card>
  )
}

export function HeroSkeleton() {
  return (
    <AnalyticsCard>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between" aria-hidden>
        <div className="space-y-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-12 w-40" />
          <Skeleton className="h-4 w-52" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
    </AnalyticsCard>
  )
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-2" aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="h-32 w-full rounded-2xl" />
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  )
}

/** Vazio das análises — o `EmptyState` do kit (mesma API de sempre). */
export function AnalyticsEmptyState({ icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return <EmptyState icon={icon} title={title} description={description} action={action} />
}

/** Erro das análises — o `ErrorState` do kit; 403 de escopo tem mensagem própria (não é falha de rede). */
export function AnalyticsErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const isForbidden = error instanceof ApiError && error.status === 403
  const message = error instanceof Error ? error.message : "Não foi possível carregar os dados."
  return isForbidden ? (
    <ErrorState forbidden message="Sem acesso a esta estrutura" description="Você só pode consultar a sua própria estrutura e as pessoas ligadas a ela." />
  ) : (
    <ErrorState message={message} onRetry={onRetry} />
  )
}
