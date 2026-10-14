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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

/**
 * Ativar é direto; desativar pede confirmação (AlertDialog) explicando o efeito — desativar NUNCA apaga nada.
 * `onSetActive` é a mutação real; o erro (403/409) aparece na própria confirmação.
 */
export function ActiveStatusControl({
  active,
  name,
  disabled,
  pending,
  deactivateTitle,
  deactivateDescription,
  error,
  onSetActive,
}: {
  active: boolean
  name: string
  disabled?: boolean
  pending?: boolean
  deactivateTitle?: string
  deactivateDescription: string
  error?: string | null
  onSetActive: (active: boolean) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  if (!active) {
    return (
      <Button size="sm" variant="outline" disabled={disabled || pending} onClick={() => void onSetActive(true).catch(() => undefined)} aria-label={`Ativar ${name}`}>
        {pending ? "Ativando..." : "Ativar"}
      </Button>
    )
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled || pending} aria-label={`Desativar ${name}`}>
          Desativar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{deactivateTitle ?? `Desativar ${name}?`}</AlertDialogTitle>
          <AlertDialogDescription>{deactivateDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              try {
                await onSetActive(false)
                setOpen(false)
              } catch {
                // a mensagem do backend aparece acima
              }
            }}
          >
            {pending ? "Desativando..." : "Desativar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Confirmação de descarte do rascunho (volta para a última versão publicada). */
export function DiscardDraftButton({ disabled, pending, description, error, onConfirm }: { disabled?: boolean; pending?: boolean; description: string; error?: string | null; onConfirm: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled || pending}>
          Descartar rascunho
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Descartar rascunho?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              try {
                await onConfirm()
                setOpen(false)
              } catch {
                // a mensagem do backend aparece acima
              }
            }}
          >
            {pending ? "Descartando..." : "Descartar rascunho"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
