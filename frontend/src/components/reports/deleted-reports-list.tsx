"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Undo2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDateTime } from "@/lib/format/date"
import { reportKeys, useDeletedReportsQuery } from "@/queries/reports/use-reports"
import { restoreReport } from "@/services/reports/reports-service"

/** Os reports que a própria pessoa excluiu. Report é de quem o criou, então ela restaura aqui, sem precisar da Central de Dados. Voltar inativo não dispara nenhuma entrega, por isso não pede confirmação. */
export function DeletedReportsList() {
  const client = useQueryClient()
  const query = useDeletedReportsQuery()
  const restore = useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => restoreReport(id),
    onSuccess: (_result, { name }) => {
      toast.success(`"${name}" voltou inativo. Para retomar as entregas, ative em Meus reports.`)
      return client.invalidateQueries({ queryKey: reportKeys.all })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Não foi possível restaurar. Nada foi alterado.")
    },
  })

  if (query.isLoading) return <Skeleton className="h-24 w-full" />
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Não foi possível carregar os reports excluídos.
      </p>
    )
  }
  const items = query.data ?? []
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">Nenhum report excluído.</CardContent>
      </Card>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Restaurar traz o report de volta inativo, sem nova entrega. As entregas já feitas continuam com quem recebeu.</p>
      <ul className="space-y-2">
        {items.map((report) => (
          <li key={report.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3" data-testid="deleted-report">
            <div className="min-w-0">
              <p className="break-words font-medium">{report.name}</p>
              <p className="text-xs text-muted-foreground">Excluído em {formatDateTime(report.deletedAt)}</p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={restore.isPending} onClick={() => restore.mutate({ id: report.id, name: report.name })}>
              <Undo2 data-icon="inline-start" /> Restaurar
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
