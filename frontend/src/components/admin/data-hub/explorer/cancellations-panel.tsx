"use client"

import { useState } from "react"
import { ChevronDown, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { AdminApiError } from "@/lib/admin/admin-api"
import { formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useCancellationsQuery, useReactivateRecordsMutation, useReactivationPreviewQuery } from "@/queries/admin/use-data-explorer-queries"
import type { CancellationItem } from "@/schemas/admin/data-explorer.schema"

import { formatCount } from "../data-hub-format"

const errorMessage = (error: unknown, fallback: string) => (error instanceof AdminApiError ? error.message : fallback)
const rowsLabel = (rows: number) => `${formatCount(rows)} ${rows === 1 ? "registro" : "registros"}`

/** Cada lote cancelado, com quem, quando e por quê. A lista só é pedida ao abrir, porque a maioria das consultas não precisa dela. */
export function CancellationsPanel({ dataset, onChanged }: { dataset: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [reactivating, setReactivating] = useState<CancellationItem | null>(null)
  const list = useCancellationsQuery(dataset, open)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-border">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Cancelamentos deste conjunto
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t border-border p-4">
        {list.isLoading ? <Skeleton className="h-16 w-full" /> : null}
        {list.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(list.error, "Não foi possível carregar os cancelamentos.")}
          </p>
        ) : null}
        {list.data?.items.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum registro deste conjunto foi cancelado.</p> : null}
        {list.data?.items.map((item) => (
          <article key={item.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3 text-sm" data-testid="cancellation-item">
            <div className="min-w-0 space-y-1">
              <p className="font-medium">
                {rowsLabel(item.rows)} em {formatDateTime(item.createdAt)}
                {item.cancelledBy ? ` por ${item.cancelledBy}` : ""}
              </p>
              <p className="whitespace-pre-wrap break-words text-muted-foreground">{item.reason}</p>
              <p className="text-xs text-muted-foreground">
                {item.remaining > 0 ? `${rowsLabel(item.remaining)} ainda ${item.remaining === 1 ? "cancelado" : "cancelados"}` : "Nenhum registro continua cancelado"}
                {item.reactivatedAt ? `. ${rowsLabel(item.reactivatedRows ?? 0)} reativados em ${formatDateTime(item.reactivatedAt)}${item.reactivatedBy ? ` por ${item.reactivatedBy}` : ""}` : ""}
                {item.remaining < item.rows - (item.reactivatedRows ?? 0) ? ". Parte voltou por uma carga nova" : ""}
              </p>
            </div>
            {item.remaining > 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setReactivating(item)}>
                <Undo2 data-icon="inline-start" /> Reativar
              </Button>
            ) : null}
          </article>
        ))}
        {list.data?.hasMore ? <p className="text-xs text-muted-foreground">Mostrando 50 lotes: primeiro os que ainda têm registros cancelados, depois os mais recentes.</p> : null}
      </CollapsibleContent>
      {reactivating ? <ReactivateDialog dataset={dataset} item={reactivating} onClose={() => setReactivating(null)} onReactivated={onChanged} /> : null}
    </Collapsible>
  )
}

function ReactivateDialog({ dataset, item, onClose, onReactivated }: { dataset: string; item: CancellationItem; onClose: () => void; onReactivated: () => void }) {
  const preview = useReactivationPreviewQuery(item.id, true)
  const reactivate = useReactivateRecordsMutation(dataset)
  const [failure, setFailure] = useState<string | null>(null)
  const data = preview.data

  async function submit() {
    if (!data) return
    setFailure(null)
    try {
      const result = await reactivate.mutateAsync({ id: item.id, expectedRows: data.rows })
      toast.success(`${rowsLabel(result.rows)} ${result.rows === 1 ? "reativado" : "reativados"}.`)
      onReactivated()
      onClose()
    } catch (error) {
      setFailure(errorMessage(error, "Não foi possível reativar. Nada foi alterado."))
      void preview.refetch()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reativar registros</DialogTitle>
          <DialogDescription>Desfaz este cancelamento. Só fica barrado se o indicador mudou depois dele.</DialogDescription>
        </DialogHeader>
        {preview.isLoading ? <Skeleton className="h-16 w-full" /> : null}
        {preview.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(preview.error, "Não foi possível conferir os registros.")}
          </p>
        ) : null}
        {data ? (
          <div className="space-y-3 text-sm">
            <p className="text-base font-medium">{rowsLabel(data.rows)}</p>
            {data.blockers.map((blocker) => (
              <p key={blocker.code} role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive">
                {blocker.message}
              </p>
            ))}
            {data.problems.length > 0 ? (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive">
                <p className="font-medium">Não dá para reativar este lote:</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {data.problems.map((problem) => (
                    <li key={problem.code}>
                      {rowsLabel(problem.count)}: {problem.message}.
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {data.canReactivate ? (
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {data.notices.map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
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
          <Button type="button" disabled={data?.canReactivate !== true || reactivate.isPending} onClick={() => void submit()}>
            {reactivate.isPending ? "Reativando…" : data?.canReactivate ? `Reativar ${rowsLabel(data.rows)}` : "Reativar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
