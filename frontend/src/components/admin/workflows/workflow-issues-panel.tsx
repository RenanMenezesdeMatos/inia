"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import type { GraphIssue } from "@/schemas/admin/workflow-validation"

import type { PublishValidationStatus } from "./use-publish-validation"

/**
 * Resumo dos problemas de publicação no rodapé do editor — substitui a caixa vermelha que ficava
 * sobreposta à paleta e ao canvas (rodada de hardening dos Workflows-modelo, 2026-09-16). Nunca
 * esconde o erro: o rodapé diz "Não é possível publicar — N problemas" o tempo todo, e a lista
 * completa abre num Popover legível. Clicar num problema seleciona/centraliza o nó responsável
 * (`onSelectIssue`) — a mesma lista que o card e o painel de configuração já mostram por nó.
 */
export function WorkflowIssuesPanel({
  issues,
  status = "ready",
  nodeLabelById,
  onSelectIssue,
  onRevalidate,
}: {
  /** Problemas locais + o apontado pelo dry-run do backend (já combinados, sem duplicata). */
  issues: GraphIssue[]
  /** Estado da validação (use-publish-validation.ts). "Pronto para publicar" só em `ready`. */
  status?: PublishValidationStatus
  nodeLabelById: (nodeId: string) => string | undefined
  onSelectIssue: (nodeId: string) => void
  onRevalidate?: () => void
}) {
  // Fecha ao escolher um problema — o nó recém-centralizado precisa ficar visível, não atrás da lista.
  const [open, setOpen] = useState(false)
  if (issues.length === 0) {
    if (status === "stale") {
      return (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="workflow-issues-summary" data-status="stale">
          <CircleDashed className="h-4 w-4" aria-hidden />
          Alterações não salvas — salve o rascunho para validar a publicação.
        </p>
      )
    }
    if (status === "validating") {
      return (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="workflow-issues-summary" data-status="validating" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Validando no servidor…
        </p>
      )
    }
    if (status === "error") {
      return (
        <div className="flex min-w-0 items-center gap-2" data-testid="workflow-issues-summary" data-status="error">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <p className="truncate text-sm text-amber-700 dark:text-amber-300">Não foi possível validar no servidor.</p>
          <Button variant="outline" size="sm" className="shrink-0" onClick={onRevalidate}>
            <RefreshCw aria-hidden />
            Validar de novo
          </Button>
        </div>
      )
    }
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="workflow-issues-summary" data-status="ready">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        Pronto para publicar — validação local e do servidor sem problemas.
      </p>
    )
  }
  const count = issues.length
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="workflow-issues-summary" data-status={status === "invalid" ? "invalid" : "blocked_local"}>
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
      <p className="truncate text-sm font-medium text-destructive">
        Não é possível publicar — {count} {count === 1 ? "problema" : "problemas"}
      </p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0">
            Ver problemas
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-[min(32rem,calc(100vw-2rem))]">
          <PopoverHeader>
            <PopoverTitle>Problemas que impedem a publicação</PopoverTitle>
            <PopoverDescription>Clique em um problema para abrir o nó responsável.</PopoverDescription>
          </PopoverHeader>
          <ol className="max-h-72 space-y-1 overflow-y-auto" aria-label="Lista de problemas do grafo">
            {issues.map((issue, index) => {
              const label = issue.nodeId ? nodeLabelById(issue.nodeId) : undefined
              return (
                <li key={`${issue.nodeId}-${index}`}>
                  <button
                    type="button"
                    disabled={!issue.nodeId}
                    onClick={() => {
                      if (!issue.nodeId) return
                      setOpen(false)
                      onSelectIssue(issue.nodeId)
                    }}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    {label ? <span className="block text-xs font-medium text-muted-foreground">{label}</span> : issue.nodeId ? null : <span className="block text-xs font-medium text-muted-foreground">Workflow</span>}
                    <span className="block break-words">{issue.message}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </PopoverContent>
      </Popover>
    </div>
  )
}
