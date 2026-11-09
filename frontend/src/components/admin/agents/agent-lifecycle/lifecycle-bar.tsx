"use client"

import { Send, Undo2 } from "lucide-react"

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

import { formatDateTime } from "@/lib/format/date"
import { useDiscardAgentDraftMutation } from "@/queries/admin/use-agent-queries"
import type { Agent } from "@/schemas/admin/agent.schema"

import { PublishAgentDialog } from "./publish-dialog"
import { RESTRICTED_DRAFT_REASON, RestrictedConfigNotice, UnavailableAction } from "./restricted-config"

/**
 * Situação do agente (PEN-002, com a revisão de 03/11/2026): versão vigente × rascunho, e as ações de publicar e descartar.
 * Salvar o rascunho nunca afeta produção; publicar usa o rascunho SALVO (com alterações na tela ainda não salvas, a ação pede
 * para salvar antes) e torna a versão nova a vigente para todos os consumidores. Publicar nunca reativa um agente inativo.
 * Rascunho de outro alcance: a barra diz isso, e publicar e descartar ficam indisponíveis (o servidor recusaria).
 */
export function AgentLifecycleBar({ agent, dirty, onConflict }: { agent: Agent; dirty: boolean; onConflict: (error: unknown) => void }) {
  const discardMutation = useDiscardAgentDraftMutation()
  const draftRestricted = agent.draft?.restricted === true
  const publishBlocked = draftRestricted
    ? RESTRICTED_DRAFT_REASON
    : dirty
      ? "Salve o rascunho antes de publicar: alterações não salvas não entram na versão."
      : !agent.hasDraft
        ? "Não há alterações em rascunho para publicar."
        : null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      {agent.published && agent.currentVersionNumber ? (
        <Badge>Versão {agent.currentVersionNumber} vigente</Badge>
      ) : (
        <Badge variant="outline">Não publicado</Badge>
      )}
      {!agent.active ? <Badge variant="secondary">Inativo — não aceita novas execuções</Badge> : null}
      <span className="text-muted-foreground">
        {agent.hasDraft
          ? `Rascunho com alterações não publicadas${agent.draftUpdatedByName ? ` · salvo por ${agent.draftUpdatedByName}` : ""}${agent.draftUpdatedAt ? ` em ${formatDateTime(agent.draftUpdatedAt)}` : ""}.`
          : agent.published
            ? "Sem alterações pendentes."
            : ""}
        {!agent.published ? " Agente não publicado: só pode ser testado; chat, voz, Workflows e orquestradores não o executam até a primeira publicação." : ""}
      </span>
      {draftRestricted ? <RestrictedConfigNotice detail="o rascunho em andamento não aparece para você" /> : null}
      <div className="ml-auto flex gap-2">
        {agent.hasDraft && agent.published && draftRestricted ? (
          <UnavailableAction reason={RESTRICTED_DRAFT_REASON}>
            <Button size="sm" variant="ghost" disabled>
              <Undo2 className="h-3.5 w-3.5" /> Descartar rascunho
            </Button>
          </UnavailableAction>
        ) : agent.hasDraft && agent.published ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" disabled={discardMutation.isPending}>
                <Undo2 className="h-3.5 w-3.5" /> Descartar rascunho
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Descartar o rascunho?</AlertDialogTitle>
                <AlertDialogDescription>As alterações não publicadas serão descartadas e o formulário volta à versão {agent.currentVersionNumber}. Nenhuma versão publicada muda.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <Button variant="destructive" onClick={() => discardMutation.mutateAsync({ id: agent.id, expectedDraftRevision: agent.draftRevision }).catch(onConflict)}>
                  Descartar
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
        {publishBlocked ? (
          <UnavailableAction reason={publishBlocked}>
            <Button size="sm" disabled>
              <Send className="h-3.5 w-3.5" /> Publicar
            </Button>
          </UnavailableAction>
        ) : (
          <PublishAgentDialog agent={agent} onConflict={onConflict} />
        )}
      </div>
    </div>
  )
}
