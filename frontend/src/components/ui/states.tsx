"use client"

import type { ReactNode } from "react"
import { AlertTriangle, Lock, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { IconBadge } from "@/components/ui/surface"
import { cn } from "@/lib/utils"

/**
 * ESTADOS DE CONTEÚDO do app — um visual só (decisão do responsável em 2026-11-10; antes havia duas famílias paralelas, a das
 * análises e a das listas, mais blocos feitos à mão em cada tela):
 *  - `EmptyState`: nada para mostrar — cartão tracejado, ícone num círculo tingido, título e, se houver, a descrição e uma ação;
 *  - `ErrorState`: falhou — vermelho claro, ícone de alerta e "Tentar novamente"; `forbidden` = cinza com cadeado (sem acesso não é
 *    falha de rede e não oferece nova tentativa);
 *  - `InlineError`: a mesma falha numa linha, para dentro de um cartão pequeno (indicador, campo, painel lateral);
 *  - `LoadingState`: carregando — linhas de esqueleto no lugar do conteúdo (nunca só a palavra "Carregando…"), com o rótulo para
 *    leitor de tela.
 * `AnalyticsEmptyState`/`AnalyticsErrorState` e `List*State` continuam existindo com a mesma API, desenhados por estes.
 */
export const RETRY_LABEL = "Tentar novamente"

export function EmptyState({ icon, title, description, action, className }: { icon: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center", className)}>
      <IconBadge icon={icon} tone="info" size="lg" />
      <p className="mt-3 text-sm font-semibold">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function ErrorState({ message, description, onRetry, forbidden = false, className }: { message: ReactNode; description?: ReactNode; onRetry?: (() => void) | undefined; forbidden?: boolean; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center rounded-2xl border p-8 text-center", forbidden ? "border-border bg-card" : "border-destructive/30 bg-destructive/5", className)}>
      <IconBadge icon={forbidden ? Lock : AlertTriangle} tone={forbidden ? "neutral" : "danger"} size="lg" />
      <p className={cn("mt-3 text-sm", forbidden ? "font-medium" : "text-destructive")}>{message}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {!forbidden && onRetry ? (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          {RETRY_LABEL}
        </Button>
      ) : null}
    </div>
  )
}

export function InlineError({ message, onRetry, className }: { message: ReactNode; onRetry?: (() => void) | undefined; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-wrap items-center gap-2 text-sm text-destructive", className)}>
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span>{message}</span>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {RETRY_LABEL}
        </Button>
      ) : null}
    </div>
  )
}

export function LoadingState({ label = "Carregando…", rows = 3, className }: { label?: string; rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy className={cn("space-y-2", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className={cn("h-10 w-full rounded-lg", index === rows - 1 && rows > 1 && "w-2/3")} aria-hidden />
      ))}
    </div>
  )
}
