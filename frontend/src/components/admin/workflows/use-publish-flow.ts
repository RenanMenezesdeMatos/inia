"use client"

import { useState } from "react"
import { toast } from "sonner"

import { AdminApiError } from "@/lib/admin/admin-api"
import { usePublishWorkflowMutation } from "@/queries/admin/use-workflow-queries"
import { goLiveImpactFromError, type GoLiveImpact } from "@/schemas/admin/workflow.schema"
import { fetchPublishImpact } from "@/services/admin/workflow-service"

/**
 * Publicar abre um diálogo quando há algo a mostrar ANTES de pôr no ar: configuração (gatilho/Abrangência/população)
 * mudando, impacto que exige confirmação, ou a primeira publicação de uma Agenda (quando ela dispara pela 1ª vez).
 * Republicar só o fluxo, sem mudança de configuração e sem impacto, publica direto.
 */
export function publishNeedsDialog(impact: GoLiveImpact): boolean {
  return impact.requiresConfirmation || impact.configurationChanges.length > 0 || (impact.firstPublication && impact.schedule !== null)
}

export type PublishDialogState = { impact: GoLiveImpact; impactChanged: boolean }

export function usePublishFlow(workflowId: string) {
  const publishMutation = usePublishWorkflowMutation(workflowId)
  const [checking, setChecking] = useState(false)
  const [dialog, setDialog] = useState<PublishDialogState | null>(null)

  async function publish(confirmation?: string): Promise<boolean> {
    try {
      await publishMutation.mutateAsync(confirmation ? { confirmation } : undefined)
      setDialog(null)
      return true
    } catch (error) {
      // 409 "confirme o impacto" (sem toast — useAdminMutation silencia o código): o diálogo mostra o impacto que o
      // backend calculou AGORA. Se já tinha uma confirmação, o impacto mudou entre a prévia e o clique.
      const impact = goLiveImpactFromError(error)
      if (impact) setDialog({ impact, impactChanged: Boolean(confirmation) })
      return false
    }
  }

  /** Clique em "Publicar": prévia do impacto (zero escrita) → diálogo quando há o que mostrar, senão publica direto. */
  async function start(): Promise<void> {
    setChecking(true)
    let impact: GoLiveImpact
    try {
      impact = await fetchPublishImpact(workflowId)
    } catch (error) {
      toast.error(error instanceof AdminApiError ? error.message : "Não foi possível calcular o impacto da publicação.")
      return
    } finally {
      setChecking(false)
    }
    if (publishNeedsDialog(impact)) {
      setDialog({ impact, impactChanged: false })
      return
    }
    await publish()
  }

  return {
    start,
    confirm: (fingerprint: string) => publish(fingerprint),
    close: () => setDialog(null),
    dialog,
    checking,
    isPending: publishMutation.isPending,
    isError: publishMutation.isError,
    error: publishMutation.error,
  }
}
