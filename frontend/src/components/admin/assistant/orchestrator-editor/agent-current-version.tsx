"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type AgentCurrentVersionState = {
  agentId: string
  /** Versão vigente do agente agora — a que as próximas execuções deste orquestrador usam. */
  versionNumber: number | null
  active: boolean
  published: boolean
}

/**
 * Versão com que o agente roda neste orquestrador (revisão aprovada da PEN-002/PEN-076, 03/11/2026): sempre a VIGENTE — o
 * orquestrador não fixa versão de agente e publicar uma versão nova vale nas próximas execuções, sem regravar o orquestrador.
 * Agente nunca publicado não entra em uso (PEN-047) e agente inativo tem as chamadas impedidas até ser reativado ou substituído.
 */
export function AgentCurrentVersion({ state, className }: { state: AgentCurrentVersionState; className?: string }) {
  const { versionNumber, active, published } = state
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", className)} data-testid={`agent-version-${state.agentId}`}>
      {!published ? (
        <>
          <Badge variant="destructive">Não publicado</Badge>
          <span className="text-muted-foreground">Publique o agente antes de usá-lo num orquestrador.</span>
        </>
      ) : (
        <Badge variant="outline">{versionNumber ? `Versão vigente: ${versionNumber}` : "Versão vigente"}</Badge>
      )}
      {!active ? (
        <>
          <Badge variant="secondary">Agente inativo</Badge>
          <span className="text-muted-foreground">As chamadas a ele ficam impedidas: reative-o ou substitua-o.</span>
        </>
      ) : null}
    </div>
  )
}
