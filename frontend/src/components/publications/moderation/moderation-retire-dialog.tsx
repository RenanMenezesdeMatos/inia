"use client"

import { useState } from "react"
import { Loader2, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { CharacterCounter } from "@/components/ui/character-counter"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useModerateRetireMutation } from "@/queries/communications/use-communications"

const REASON_LIMITS = { min: 10, max: 500 }

/**
 * Moderação (Administrador geral): retirar a publicação de outra pessoa pede MOTIVO — por isso é Dialog (confirmação com campo) e não
 * AlertDialog. Exclusão lógica: sai do Acompanhamento e do chat na hora e volta por Consultar dados › Itens excluídos. O texto da
 * publicação nunca é alterado; quem moderou, o autor e o motivo ficam na auditoria.
 */
export function ModerationRetireDialog({ id, title, authorName, open, onOpenChange, onRetired }: { id: string; title: string; authorName: string; open: boolean; onOpenChange: (open: boolean) => void; onRetired?: () => void }) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  const retire = useModerateRetireMutation()
  const valid = reason.trim().length >= REASON_LIMITS.min && reason.trim().length <= REASON_LIMITS.max

  function submit() {
    if (!valid) return setError(`Explique o motivo com pelo menos ${REASON_LIMITS.min} caracteres.`)
    retire.mutate({ id, reason: reason.trim() }, {
      onSuccess: () => {
        toast.success("Publicação retirada pela moderação.")
        setReason("")
        onOpenChange(false)
        onRetired?.()
      },
      onError: (failure) => setError(failure instanceof Error && failure.message ? failure.message : "Não foi possível retirar a publicação."),
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!retire.isPending) { onOpenChange(next); setError("") } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldAlert className="size-5 text-destructive" aria-hidden />Retirar publicação de {authorName}</DialogTitle>
          <DialogDescription>
            “{title}” sai do Acompanhamento de todos e deixa de ser usada pela INIA no chat. O texto não é alterado e o registro pode voltar por
            Consultar dados › Itens excluídos.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`moderation-reason-${id}`}>Motivo da retirada</Label>
          <Textarea id={`moderation-reason-${id}`} aria-describedby={`moderation-reason-count-${id}`} rows={3} maxLength={REASON_LIMITS.max} value={reason} placeholder="Ex.: orientação contrária ao procedimento oficial." onChange={(event) => { setReason(event.target.value); setError("") }} />
          <CharacterCounter id={`moderation-reason-count-${id}`} value={reason} limits={REASON_LIMITS} />
          <p className="text-xs text-muted-foreground">Fica registrado na auditoria com o seu nome.</p>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={retire.isPending} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" variant="destructive" disabled={retire.isPending || !valid} onClick={submit}>
            {retire.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}Retirar publicação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
