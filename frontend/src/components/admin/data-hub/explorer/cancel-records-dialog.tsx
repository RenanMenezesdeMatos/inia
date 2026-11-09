"use client"

import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { CharacterCounter, isWithinTextLimits } from "@/components/ui/character-counter"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { AdminApiError } from "@/lib/admin/admin-api"
import { useCancellationPreviewQuery, useCancelRecordsMutation } from "@/queries/admin/use-data-explorer-queries"
import type { CancellationScope } from "@/schemas/admin/data-explorer.schema"

import { formatCount } from "../data-hub-format"

const REASON_LIMITS = { min: 10, max: 500 }
const errorMessage = (error: unknown, fallback: string) => (error instanceof AdminApiError ? error.message : fallback)
const rowsLabel = (rows: number) => `${formatCount(rows)} ${rows === 1 ? "registro" : "registros"}`

/**
 * Cancelar registros: prévia calculada no servidor, motivo e confirmação. A confirmação manda a impressão digital do que a pessoa viu; se os registros mudaram, o servidor recusa e a prévia é refeita.
 * O botão principal diz o que faz e quantos alcança, porque "Cancelar" sozinho num diálogo de cancelar seria ambíguo.
 */
export function CancelRecordsDialog({ scope, onClose, onCancelled }: { scope: CancellationScope; onClose: () => void; onCancelled: () => void }) {
  const preview = useCancellationPreviewQuery(scope, true)
  const cancel = useCancelRecordsMutation(scope.dataset)
  const [reason, setReason] = useState("")
  const [failure, setFailure] = useState<string | null>(null)

  const data = preview.data
  const canSubmit = data?.canCancel === true && isWithinTextLimits(reason, REASON_LIMITS) && !cancel.isPending

  async function submit() {
    if (!data?.scopeFingerprint) return
    setFailure(null)
    try {
      const result = await cancel.mutateAsync({ ...scope, reason: reason.trim(), expectedFingerprint: data.scopeFingerprint })
      toast.success(`${rowsLabel(result.rows)} cancelado${result.rows === 1 ? "" : "s"}. O dado continua guardado e pode ser reativado.`)
      onCancelled()
    } catch (error) {
      setFailure(errorMessage(error, "Não foi possível cancelar os registros. Nada foi alterado."))
      void preview.refetch()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar registros</DialogTitle>
          <DialogDescription>{scope.keys ? "Vale para os registros marcados na tabela que ainda estão ativos." : "Vale para todos os registros ativos que atendem aos filtros aplicados, inclusive os de outras páginas."}</DialogDescription>
        </DialogHeader>

        {preview.isLoading ? <Skeleton className="h-24 w-full" /> : null}
        {preview.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(preview.error, "Não foi possível calcular a prévia.")}
          </p>
        ) : null}

        {data ? (
          <div className="space-y-3 text-sm">
            <p className="text-base font-medium" data-testid="cancel-preview-rows">
              {data.capped ? `Mais de ${rowsLabel(data.maxRows)}` : rowsLabel(data.rows)}
            </p>
            {data.blockers.map((blocker) => (
              <p key={blocker.code} role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive">
                {blocker.message}
              </p>
            ))}
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {data.notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
            {data.canCancel ? (
              <div className="space-y-1">
                <label htmlFor="cancel-reason" className="font-medium">
                  Motivo
                </label>
                <Textarea id="cancel-reason" value={reason} rows={3} aria-describedby="cancel-reason-count" onChange={(event) => setReason(event.target.value)} placeholder="Ex.: indicador cadastrado com a estratégia errada." />
                <p className="text-xs text-muted-foreground">Fica registrado junto do lote. Não escreva nomes, CPF ou outros dados pessoais.</p>
                <CharacterCounter id="cancel-reason-count" value={reason} limits={REASON_LIMITS} />
              </div>
            ) : null}
          </div>
        ) : null}

        {failure ? (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button type="button" variant="destructive" disabled={!canSubmit} onClick={() => void submit()}>
            {cancel.isPending ? "Cancelando…" : data?.canCancel ? `Cancelar ${rowsLabel(data.rows)}` : "Cancelar registros"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
