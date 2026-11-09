"use client"

import { useAgentReferencesQuery } from "@/queries/admin/use-agent-queries"

/**
 * Versão do agente nesta etapa (revisão aprovada da PEN-002/PEN-076, 03/11/2026): o Workflow não fixa versão de agente — cada
 * execução usa a VIGENTE no momento em que começa e a registra. Publicar uma versão nova do agente vale nas próximas execuções,
 * sem republicar o Workflow. Aqui só a informação e os avisos: agente inativo (CA-009.12) e agente nunca publicado (PEN-047).
 */
export function AgentVersionField({ agentId }: { agentId: string }) {
  const referencesQuery = useAgentReferencesQuery(agentId ? [agentId] : [])
  const reference = referencesQuery.data?.find((candidate) => candidate.id === agentId)
  if (!agentId || !reference) return null

  return (
    <div className="space-y-1.5" data-testid="agent-version-field">
      {!reference.active ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
          O agente &quot;{reference.name}&quot; está inativo e não aceita novas execuções. Ao chegar a esta etapa, a execução fica &quot;Bloqueada — agente inativo&quot;: reative o agente ou substitua-o aqui.
        </p>
      ) : null}
      {!reference.published ? (
        <p className="text-xs text-destructive">Agente não publicado — publique-o antes de publicar o Workflow.</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Usa sempre a versão vigente do agente (versão {reference.currentVersionNumber}); uma versão nova vale nas próximas execuções, sem republicar o Workflow.
        </p>
      )}
    </div>
  )
}
