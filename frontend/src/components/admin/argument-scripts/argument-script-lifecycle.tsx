"use client"

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
import {
  useArchiveArgumentScriptMutation,
  useDeleteArgumentScriptMutation,
  useDiscardArgumentScriptDraftMutation,
  useReactivateArgumentScriptMutation,
} from "@/queries/admin/use-argument-script-queries"
import { RESTORE_NOTE } from "@/lib/admin/logical-delete"

export type ArgumentScriptLifecycleAction = "discard" | "archive" | "reactivate" | "delete"

/**
 * Descartar rascunho · Desativar · Reativar · Excluir — o mesmo diálogo na lista e no editor. Renderize só com uma ação aberta
 * (`action ? <… /> : null`): cada abertura nasce com as mutações limpas. O backend é a autoridade (403/409); o motivo aparece aqui.
 */
export function ArgumentScriptLifecycleDialog({
  target,
  action,
  onClose,
  onDeleted,
}: {
  target: { id: string; name: string; hasDraft: boolean }
  action: ArgumentScriptLifecycleAction
  onClose: () => void
  onDeleted?: () => void
}) {
  const discardMutation = useDiscardArgumentScriptDraftMutation()
  const archiveMutation = useArchiveArgumentScriptMutation()
  const reactivateMutation = useReactivateArgumentScriptMutation()
  const deleteMutation = useDeleteArgumentScriptMutation()

  const config = {
    discard: {
      title: "Descartar o rascunho?",
      description: "As alterações ainda não publicadas serão perdidas. A versão vigente não muda.",
      confirm: "Descartar rascunho",
      pending: "Descartando...",
      destructive: true,
      mutation: discardMutation,
      run: () => discardMutation.mutateAsync(target.id),
    },
    archive: {
      title: `Desativar "${target.name}"?`,
      description: "Ele deixa de valer a partir de agora. Chamadas anteriores continuam avaliadas pela versão da época e o histórico é preservado. Dá para reativar depois.",
      confirm: "Desativar",
      pending: "Desativando...",
      destructive: true,
      mutation: archiveMutation,
      run: () => archiveMutation.mutateAsync(target.id),
    },
    reactivate: {
      title: `Reativar "${target.name}"?`,
      description: `Ele volta a valer a partir de agora, como uma nova versão com o conteúdo da última publicada.${target.hasDraft ? " O rascunho em edição será descartado." : ""}`,
      confirm: "Reativar",
      pending: "Reativando...",
      destructive: false,
      mutation: reactivateMutation,
      run: () => reactivateMutation.mutateAsync(target.id),
    },
    delete: {
      title: `Excluir "${target.name}"?`,
      description:
        `Ele deixa de valer e sai das telas. Análises já feitas continuam mostrando a origem delas. ${RESTORE_NOTE}`,
      confirm: "Excluir",
      pending: "Excluindo...",
      destructive: true,
      mutation: deleteMutation,
      run: async () => {
        await deleteMutation.mutateAsync(target.id)
        onDeleted?.()
      },
    },
  } as const
  const current = config[action]

  return (
    <AlertDialog open onOpenChange={(open) => (open ? null : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{current.title}</AlertDialogTitle>
          <AlertDialogDescription>{current.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {current.mutation.isError ? <p className="text-sm text-destructive">{(current.mutation.error as Error).message}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant={current.destructive ? "destructive" : "default"}
            disabled={current.mutation.isPending}
            onClick={async () => {
              try {
                await current.run()
                onClose()
              } catch {
                // o motivo aparece acima (e no toast)
              }
            }}
          >
            {current.mutation.isPending ? current.pending : current.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
