"use client"

import { Lock } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api/api-client"

/**
 * Erro de uma aba do painel. O 422 do servidor (`PERIOD_TOO_LONG` e validação) mostra a mensagem dele; 403 = sem o papel; o resto,
 * "tente de novo".
 */
export function PanelError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.status === 403) {
    return (
      <div role="alert" className="flex flex-col items-center rounded-xl border p-8 text-center">
        <Lock className="size-8 text-muted-foreground/60" aria-hidden />
        <p className="mt-3 text-sm font-medium">Sem acesso ao painel do apoio</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">Peça a um administrador o papel “Coordenador de Anjos”.</p>
      </div>
    )
  }
  if (error instanceof ApiError && error.status === 422) {
    return (
      <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {error.message}
      </p>
    )
  }
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
      <p className="text-sm text-destructive">Não foi possível carregar estes dados.</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  )
}
