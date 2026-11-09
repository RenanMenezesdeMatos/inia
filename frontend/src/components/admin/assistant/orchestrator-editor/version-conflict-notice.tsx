"use client"

import { Button } from "@/components/ui/button"

/**
 * PEN-050 no orquestrador: outra pessoa gravou depois que esta tela abriu. Nada foi gravado; o que a pessoa alterou continua na
 * tela e é reaplicado sobre a versão atual ao atualizar (nunca sobrescrita silenciosa, nunca trabalho perdido).
 */
export function VersionConflictNotice({ message, publishedByName, pending, onReload }: { message: string; publishedByName: string | null; pending: boolean; onReload: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <span className="min-w-0 flex-1">
        {message}
        {publishedByName ? ` Última gravação: ${publishedByName}.` : ""}
      </span>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onReload}>
        {pending ? "Atualizando…" : "Atualizar e reaplicar minhas alterações"}
      </Button>
    </div>
  )
}

/** Depois de atualizar: a tela está na versão em uso com as alterações da pessoa por cima, ainda não gravadas. */
export function ReappliedNotice({ versionNumber, onDismiss }: { versionNumber: number | null; onDismiss: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">
        A tela foi atualizada{versionNumber ? ` para a Versão ${versionNumber}` : ""} e suas alterações foram reaplicadas por cima. Revise e salve de novo.
      </span>
      <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
        Entendi
      </Button>
    </div>
  )
}
