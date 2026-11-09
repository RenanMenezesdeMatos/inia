"use client"

import { useState } from "react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useRevertKnowledgeVersionMutation } from "@/queries/admin/use-knowledge-queries"
import { hasRestrictedDraft, type KnowledgeDocumentDetail, type KnowledgeVersionFullRow } from "@/schemas/admin/knowledge.schema"

import { ChangeSummaryField, ConfirmationBox, DialogConflict, errorCodeOf } from "../knowledge-lifecycle-dialogs"
import { versionLabel } from "../knowledge-visuals"

/**
 * Reverter publica o conteúdo de uma versão anterior como versão NOVA: nada é apagado e ela passa pelo processamento como qualquer
 * publicação. Descartar o rascunho e reativar a base só com a confirmação explícita de cada um; se a base mudou com o diálogo aberto, o 409
 * da API faz a confirmação aparecer aqui. Rascunho fora do alcance de quem lê só quem alcança o alcance dele descarta: aqui a confirmação
 * não é oferecida e a reversão fica bloqueada, com o motivo.
 */
export function RevertVersionDialog({ document, version, onClose }: { document: KnowledgeDocumentDetail; version: KnowledgeVersionFullRow; onClose: () => void }) {
  const [changeSummary, setChangeSummary] = useState("")
  const [discardDraft, setDiscardDraft] = useState(false)
  const [reactivate, setReactivate] = useState(false)
  const [draftAppeared, setDraftAppeared] = useState(false)
  const [archivedMeanwhile, setArchivedMeanwhile] = useState(false)
  const revertMutation = useRevertKnowledgeVersionMutation()
  const label = versionLabel(version.number)
  const needsDiscard = document.draft !== null || draftAppeared
  const needsReactivation = document.archived !== null || archivedMeanwhile
  const blocked = (needsDiscard && !discardDraft) || (needsReactivation && !reactivate)

  async function handleRevert() {
    try {
      const summary = changeSummary.trim()
      await revertMutation.mutateAsync({
        id: document.id,
        versionId: version.id,
        input: { ...(summary ? { changeSummary: summary } : {}), ...(discardDraft ? { discardDraft: true } : {}), ...(reactivate ? { reactivate: true } : {}) },
      })
      onClose()
    } catch (error) {
      const code = errorCodeOf(error)
      if (code === "KNOWLEDGE_DRAFT_PENDING") setDraftAppeared(true)
      if (code === "KNOWLEDGE_ARCHIVED_REACTIVATION_REQUIRED") setArchivedMeanwhile(true)
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Reverter para a {label}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                O conteúdo da {label} é publicado como uma versão nova, sem apagar nenhuma versão. Ela passa pelo processamento e só depois de pronta vale para todos os agentes, Workflows e orquestradores que usam esta base.
                {document.inUse ? ` Até lá, a IA continua usando a ${versionLabel(document.inUse.version)}.` : ""}
              </p>
              {version.hasConfig ? null : <p>A configuração da {label} não foi registrada: volta só o conteúdo, e título, tipo e alcance continuam os atuais.</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ChangeSummaryField value={changeSummary} onChange={setChangeSummary} description={`Em branco, fica “Reversão para a versão ${version.number}”.`} />
        {needsDiscard && document.draft && hasRestrictedDraft(document) ? (
          <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            {`Há um rascunho (${versionLabel(document.draft.version)}) preparado para Grupos fora do seu escopo. Reverter o descartaria, e só quem administra todos eles pode descartá-lo.`}
          </p>
        ) : needsDiscard ? (
          <ConfirmationBox
            text={`Há um rascunho em edição${document.draft ? ` (${versionLabel(document.draft.version)})` : ""}. Reverter descarta esse rascunho.`}
            label="Descartar o rascunho"
            checked={discardDraft}
            onCheckedChange={setDiscardDraft}
          />
        ) : null}
        {needsReactivation ? <ConfirmationBox text="Esta base está arquivada. Reverter faz com que ela volte a valer para a IA, quando a versão nova ficar pronta. Até lá, e se falhar, ela continua arquivada." label="Confirmo que a base volta a valer para a IA" checked={reactivate} onCheckedChange={setReactivate} /> : null}
        <DialogConflict error={revertMutation.error} codes={["KNOWLEDGE_VERSION_ALREADY_CURRENT", "KNOWLEDGE_VERSION_NOT_REVERTIBLE"]} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button disabled={blocked || revertMutation.isPending} onClick={handleRevert}>
            {revertMutation.isPending ? "Revertendo..." : needsReactivation ? "Publicar como versão nova e reativar" : "Publicar como versão nova"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
