"use client"

import { useState } from "react"
import Link from "next/link"
import { ExternalLink, Trash2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

import { useAgentDeletionCheckQuery, useDeleteAgentMutation, useToggleAgentActiveMutation } from "@/queries/admin/use-agent-queries"
import { AGENT_REFERENCE_KIND_LABELS, AGENT_REFERENCE_STATUS_LABELS, type Agent, type AgentDeletionCheck } from "@/schemas/admin/agent.schema"
import { RESTORE_NOTE } from "@/lib/admin/logical-delete"

function usageSentence(usage: AgentDeletionCheck["usage"]): string {
  const parts = [
    usage.runs ? `${usage.runs} ${usage.runs === 1 ? "execução ou teste registrado" : "execuções ou testes registrados"}` : null,
    usage.conversations ? `${usage.conversations} ${usage.conversations === 1 ? "conversa" : "conversas"} com a INIA` : null,
    usage.feedbackAnalyses ? `${usage.feedbackAnalyses} ${usage.feedbackAnalyses === 1 ? "análise de feedback" : "análises de feedback"}` : null,
  ].filter(Boolean)
  return parts.join(", ")
}

/** O motivo do bloqueio com as referências que a pessoa pode consultar e o aviso das que não pode (PEN-065, PEN-066). */
export function DeletionBlockExplanation({ check }: { check: AgentDeletionCheck }) {
  return (
    <div className="space-y-3 text-sm">
      {check.usage.runningRuns > 0 ? <p className="font-medium">Tem execução em andamento: aguarde terminar para excluir.</p> : null}
      {check.references.length > 0 ? (
        <div className="space-y-1.5">
          <p className="font-medium">É usado por:</p>
          <ul className="space-y-1.5">
            {check.references.map((reference) => (
              <li key={`${reference.kind}:${reference.id}`} className="rounded-md border px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{reference.name}</span>
                  <Badge variant="outline">{AGENT_REFERENCE_KIND_LABELS[reference.kind]}</Badge>
                  <Badge variant={reference.status === "ACTIVE" ? "secondary" : "outline"}>{AGENT_REFERENCE_STATUS_LABELS[reference.status]}</Badge>
                  <Link href={reference.link} className="ml-auto inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2">
                    Ver {reference.kind === "WORKFLOW" ? "Workflow" : "orquestrador"} <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {reference.kind === "WORKFLOW" ? "Etapa" : "Papel"}: {reference.usages.join(", ")}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Remova ou substitua o agente nessas referências e publique a alteração. A exclusão também depende de não haver histórico de uso.</p>
        </div>
      ) : null}
      {check.hasRestrictedReferences ? (
        <p className="rounded-md bg-muted px-2.5 py-2 text-xs">Existem dependências que você não tem permissão para consultar. Procure um administrador.</p>
      ) : null}
    </div>
  )
}

/**
 * Excluir agente (PEN-001): histórico de uso não barra, porque nada é apagado; só o que depende dele agora. Bloqueada, a tela explica o motivo
 * e, a quem pode, oferece desativar — que preserva execuções e conversas. A exclusão é lógica (migration 177), e as bases de conhecimento nunca são apagadas.
 */
export function DeleteAgentDialog({ agent, trigger }: { agent: Pick<Agent, "id" | "name" | "active">; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const checkQuery = useAgentDeletionCheckQuery(open ? agent.id : null)
  const deleteMutation = useDeleteAgentMutation()
  const deactivateMutation = useToggleAgentActiveMutation()
  const check = checkQuery.data

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {trigger ?? (
          <Button size="icon" variant="ghost" aria-label="Excluir agente">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{check && !check.deletable ? `${agent.name} não pode ser excluído` : `Excluir ${agent.name}?`}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {checkQuery.isLoading ? <Skeleton className="h-16 w-full" /> : null}
              {checkQuery.isError ? <p className="text-destructive">{(checkQuery.error as Error).message}</p> : null}
              {check?.deletable ? (
                <p>
                  {check.hasUsage ? `Ele tem histórico (${usageSentence(check.usage)}), que continua guardado e consultável. ` : ""}
                  {RESTORE_NOTE} As bases de conhecimento que ele consultava continuam existindo.
                </p>
              ) : null}
              {check && !check.deletable ? (
                <div className="space-y-3">
                  <DeletionBlockExplanation check={check} />
                  {check.active ? (
                    <p className="text-xs">Para que ele não seja mais usado, desative-o: execuções, conversas e o histórico continuam consultáveis.</p>
                  ) : (
                    <p className="text-xs">O agente já está inativo e continua assim.</p>
                  )}
                </div>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{check && !check.deletable ? "Fechar" : "Cancelar"}</AlertDialogCancel>
          {check && !check.deletable && check.canDeactivate ? (
            <Button
              variant="outline"
              disabled={deactivateMutation.isPending}
              onClick={async () => {
                await deactivateMutation.mutateAsync({ id: agent.id, active: false })
                setOpen(false)
              }}
            >
              {deactivateMutation.isPending ? "Desativando..." : "Desativar agente"}
            </Button>
          ) : null}
          {check?.deletable ? (
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={async () => {
                try {
                  await deleteMutation.mutateAsync(agent.id)
                  setOpen(false)
                } catch {
                  // Bloqueio surgido entre a conferência e a confirmação (ex.: um teste começou): a conferência é refeita.
                  await checkQuery.refetch()
                }
              }}
            >
              {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
            </Button>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
