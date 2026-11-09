"use client"

import { useId, useState } from "react"

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
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { AdminApiError } from "@/lib/admin/admin-api"
import { useArchiveKnowledgeMutation, useDiscardKnowledgeDraftMutation, usePublishKnowledgeMutation, useReactivateKnowledgeMutation, useRetryKnowledgeVersionMutation } from "@/queries/admin/use-knowledge-queries"

import { versionLabel } from "./knowledge-visuals"

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void }

export const CHANGE_SUMMARY_MAX_LENGTH = 500

export function ChangeSummaryField({ value, onChange, description }: { value: string; onChange: (value: string) => void; description?: string }) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Resumo da alteração (opcional)</Label>
      <Textarea id={id} value={value} rows={2} maxLength={CHANGE_SUMMARY_MAX_LENGTH} onChange={(event) => onChange(event.target.value)} placeholder="O que mudou e por quê" />
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  )
}

/** Aviso com confirmação explícita: reativar a base ou descartar o rascunho nunca acontece em silêncio. */
export function ConfirmationBox({ text, label, checked, onCheckedChange }: { text: string; label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  const id = useId()
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <p className="text-sm">{text}</p>
      <div className="mt-2 flex items-center gap-2">
        <Checkbox id={id} checked={checked} onCheckedChange={(next) => onCheckedChange(next === true)} />
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
      </div>
    </div>
  )
}

export const errorCodeOf = (error: unknown) => (error instanceof AdminApiError ? error.code : null)

/** Conflito (409) que a tela trata sozinha: fica escrito no diálogo em vez de virar toast. Os demais erros continuam no toast. */
export function DialogConflict({ error, codes }: { error: Error | null; codes: readonly string[] }) {
  const code = errorCodeOf(error)
  if (!error || code === null || !codes.includes(code)) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {error.message}
    </p>
  )
}

/**
 * Publicar pede a disponibilização do rascunho (PEN-008): vale para todos os agentes, Workflows e orquestradores que usam a base, sem
 * republicá-los, e só depois de pronta. Em base arquivada, publicar é também reativar: a tela diz isso no título e no botão, pede a
 * confirmação à parte, e sem ela nada acontece. O resumo já gravado no rascunho vem preenchido; deixar em branco mantém o que está lá.
 */
export function PublishKnowledgeDialog({
  document,
  open,
  onOpenChange,
}: DialogProps & {
  document: { id: string; draftVersion: number; inUseVersion: number | null; archived: boolean; changeSummary?: string | null; productsChanged?: boolean }
}) {
  const [changeSummary, setChangeSummary] = useState(document.changeSummary ?? "")
  const [reactivate, setReactivate] = useState(false)
  const [archivedMeanwhile, setArchivedMeanwhile] = useState(false)
  const publishMutation = usePublishKnowledgeMutation()
  const needsReactivation = document.archived || archivedMeanwhile
  const draft = versionLabel(document.draftVersion)

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      setReactivate(false)
      setArchivedMeanwhile(false)
      publishMutation.reset()
    }
  }

  async function handlePublish() {
    try {
      const summary = changeSummary.trim()
      await publishMutation.mutateAsync({ id: document.id, input: { ...(summary ? { changeSummary: summary } : {}), ...(reactivate ? { reactivate: true } : {}) } })
      handleOpenChange(false)
    } catch (error) {
      if (errorCodeOf(error) === "KNOWLEDGE_ARCHIVED_REACTIVATION_REQUIRED") setArchivedMeanwhile(true)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{needsReactivation ? `Publicar o rascunho ${draft} e reativar a base?` : `Publicar o rascunho ${draft}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            A {draft} passa a valer para todos os agentes, Workflows e orquestradores que usam esta base, sem republicá-los, e só depois de pronta.{" "}
            {needsReactivation
              ? "Até lá, e se o processamento falhar, a base continua arquivada e fora de uso pela IA."
              : document.inUseVersion !== null
                ? `Até lá, a IA continua usando a ${versionLabel(document.inUseVersion)}, e uma falha no processamento não muda isso.`
                : "Até lá, esta base continua sem versão disponível para a IA."}
            {document.productsChanged ? " Os produtos do rascunho (“Vale para”) passam a valer junto com ela." : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ChangeSummaryField value={changeSummary} onChange={setChangeSummary} />
        {needsReactivation ? (
          <ConfirmationBox
            text="Esta base está arquivada. Publicar não é só atualizar: faz a base voltar a valer para a IA. Para ela continuar arquivada, cancele; o rascunho fica salvo."
            label="Confirmo que a base volta a valer para a IA"
            checked={reactivate}
            onCheckedChange={setReactivate}
          />
        ) : null}
        <DialogConflict error={publishMutation.error} codes={["KNOWLEDGE_NOTHING_TO_PUBLISH"]} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button disabled={publishMutation.isPending || (needsReactivation && !reactivate)} onClick={handlePublish}>
            {publishMutation.isPending ? "Publicando..." : needsReactivation ? `Publicar ${draft} e reativar` : `Publicar ${draft}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Tentar de novo em base arquivada também é reativar: pede a mesma confirmação da publicação. */
export function RetryArchivedKnowledgeDialog({ document, open, onOpenChange }: DialogProps & { document: { id: string; versionId: string; version: number } }) {
  const [reactivate, setReactivate] = useState(false)
  const retryMutation = useRetryKnowledgeVersionMutation()
  const label = versionLabel(document.version)
  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      setReactivate(false)
      retryMutation.reset()
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Tentar de novo a {label} e reativar a base?</AlertDialogTitle>
          <AlertDialogDescription>A {label} passa pelo processamento de novo. Até ficar pronta, e se falhar outra vez, a base continua arquivada e fora de uso pela IA.</AlertDialogDescription>
        </AlertDialogHeader>
        <ConfirmationBox text="Esta base está arquivada. Se a versão ficar pronta, a base volta a valer para a IA." label="Confirmo que a base volta a valer para a IA" checked={reactivate} onCheckedChange={setReactivate} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            disabled={retryMutation.isPending || !reactivate}
            onClick={() => {
              retryMutation.mutateAsync({ id: document.id, versionId: document.versionId, reactivate: true }).then(
                () => handleOpenChange(false),
                () => undefined,
              )
            }}
          >
            {retryMutation.isPending ? "Tentando..." : "Tentar de novo e reativar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Arquivar tira a base de uso na hora. Não cria versão e mantém o rascunho; só o que estava em processamento é cancelado. */
export function ArchiveKnowledgeDialog({ document, open, onOpenChange }: DialogProps & { document: { id: string; title: string } }) {
  const archiveMutation = useArchiveKnowledgeMutation()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Arquivar {document.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            A IA deixa de consultar esta base em todos os agentes, Workflows e orquestradores que a usam. O rascunho, se houver, é mantido; uma atualização em processamento é cancelada. Dá para reativar depois.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            disabled={archiveMutation.isPending}
            onClick={() => {
              archiveMutation.mutateAsync(document.id).then(
                () => onOpenChange(false),
                () => undefined,
              )
            }}
          >
            {archiveMutation.isPending ? "Arquivando..." : "Arquivar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Reativar devolve a mesma versão: já pronta, vale na hora; arquivada sem nunca ter ficado pronta, passa antes pelo processamento. */
export function ReactivateKnowledgeDialog({ document, open, onOpenChange }: DialogProps & { document: { id: string; title: string } }) {
  const reactivateMutation = useReactivateKnowledgeMutation()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reativar {document.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            A versão arquivada volta a valer para todos os agentes, Workflows e orquestradores que usam esta base, com o mesmo conteúdo. Se ela nunca tiver ficado pronta, passa antes pelo processamento.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <DialogConflict error={reactivateMutation.error} codes={["KNOWLEDGE_NOT_ARCHIVED"]} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            disabled={reactivateMutation.isPending}
            onClick={() => {
              reactivateMutation.mutateAsync(document.id).then(
                () => onOpenChange(false),
                () => undefined,
              )
            }}
          >
            {reactivateMutation.isPending ? "Reativando..." : "Reativar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function DiscardKnowledgeDraftDialog({ document, open, onOpenChange }: DialogProps & { document: { id: string; draftVersion: number } }) {
  const discardMutation = useDiscardKnowledgeDraftMutation()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Descartar o rascunho {versionLabel(document.draftVersion)}?</AlertDialogTitle>
          <AlertDialogDescription>As alterações não publicadas são apagadas. O que a IA usa e as versões já publicadas não mudam.</AlertDialogDescription>
        </AlertDialogHeader>
        <DialogConflict error={discardMutation.error} codes={["KNOWLEDGE_DRAFT_ONLY", "KNOWLEDGE_NO_DRAFT"]} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={discardMutation.isPending}
            onClick={() => {
              discardMutation.mutateAsync(document.id).then(
                () => onOpenChange(false),
                () => undefined,
              )
            }}
          >
            {discardMutation.isPending ? "Descartando..." : "Descartar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
