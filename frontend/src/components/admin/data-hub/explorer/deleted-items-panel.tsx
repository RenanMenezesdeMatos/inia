"use client"

import { useState, type FormEvent } from "react"
import { Search, Trash2, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { ListEmptyState, ListErrorState, ListSkeleton } from "@/components/admin/shared/list/list-states"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AdminApiError } from "@/lib/admin/admin-api"
import { formatDateTime } from "@/lib/format/date"
import { useDeletedItemsQuery, useRestorationPreviewQuery, useRestoreDeletedItemMutation } from "@/queries/admin/use-data-explorer-queries"
import type { DeletedItem, DeletedItemType } from "@/schemas/admin/data-explorer.schema"

const errorMessage = (error: unknown, fallback: string) => (error instanceof AdminApiError ? error.message : fallback)
const ALL_TYPES = "ALL"

/**
 * Itens excluídos: o único lugar onde um objeto excluído continua visível e de onde ele volta. O servidor só devolve os tipos que a pessoa pode gerenciar e só o que ela pode restaurar,
 * então a tela não precisa decidir nada. A busca sai quando a pessoa pede, porque cada consulta conta no limite por minuto e fica no registro.
 */
export function DeletedItemsPanel({ types }: { types: readonly DeletedItemType[] }) {
  const [type, setType] = useState(ALL_TYPES)
  const [searchDraft, setSearchDraft] = useState("")
  const [search, setSearch] = useState("")
  const [restoring, setRestoring] = useState<DeletedItem | null>(null)
  const list = useDeletedItemsQuery({ type: type === ALL_TYPES ? undefined : type, search: search || undefined })

  function submit(event: FormEvent) {
    event.preventDefault()
    setSearch(searchDraft.trim())
  }

  return (
    <div className="space-y-4" data-testid="deleted-items">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full space-y-1 sm:w-64">
          <label htmlFor="deleted-items-type" className="text-sm font-medium">
            Tipo
          </label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="deleted-items-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TYPES}>Todos os tipos</SelectItem>
              {types.map((entry) => (
                <SelectItem key={entry.type} value={entry.type}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <form onSubmit={submit} className="flex w-full flex-1 items-end gap-2 sm:w-auto sm:min-w-64">
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor="deleted-items-search" className="text-sm font-medium">
              Nome
            </label>
            <Input id="deleted-items-search" value={searchDraft} maxLength={200} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Buscar pelo nome" />
          </div>
          <Button type="submit" variant="outline">
            <Search data-icon="inline-start" /> Buscar
          </Button>
        </form>
      </div>

      {list.isLoading ? <ListSkeleton view="list" rows={4} /> : null}
      {list.isError ? <ListErrorState message={errorMessage(list.error, "Não foi possível carregar os itens excluídos.")} onRetry={() => void list.refetch()} /> : null}
      {list.data?.items.length === 0 ? <ListEmptyState icon={Trash2} title={search || type !== ALL_TYPES ? "Nenhum item excluído com estes filtros" : "Nenhum item excluído"} description="Quando alguém excluir um objeto que você administra, ele aparece aqui e pode ser restaurado." /> : null}
      {list.data && list.data.items.length > 0 ? (
        <div className={TABLE_FRAME}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead className="whitespace-nowrap">Excluído em</TableHead>
                <TableHead className="whitespace-nowrap">Excluído por</TableHead>
                <TableHead className="w-px">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((item) => (
                <TableRow key={`${item.type}:${item.id}`} data-testid="deleted-item">
                  <TableCell className="whitespace-nowrap text-muted-foreground">{item.typeLabel}</TableCell>
                  <TableCell className="max-w-44 truncate font-medium sm:max-w-md" title={item.name}>
                    {item.name}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(item.deletedAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">{item.deletedBy ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="outline" size="sm" onClick={() => setRestoring(item)}>
                      <Undo2 data-icon="inline-start" /> Restaurar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {list.data?.hasMore ? <p className="text-xs text-muted-foreground">Mostrando os 100 mais recentes. Use o tipo ou o nome para chegar aos outros.</p> : null}

      {restoring ? <RestoreDialog item={restoring} onClose={() => setRestoring(null)} /> : null}
    </div>
  )
}

function RestoreDialog({ item, onClose }: { item: DeletedItem; onClose: () => void }) {
  const preview = useRestorationPreviewQuery(item.type, item.id)
  const restore = useRestoreDeletedItemMutation()
  const [failure, setFailure] = useState<string | null>(null)
  const data = preview.data

  async function submit() {
    setFailure(null)
    try {
      await restore.mutateAsync({ type: item.type, id: item.id })
      toast.success(`"${item.name}" foi restaurado.`)
      onClose()
    } catch (error) {
      setFailure(errorMessage(error, "Não foi possível restaurar. Nada foi alterado."))
      void preview.refetch()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restaurar este item?</DialogTitle>
          <DialogDescription className="break-words">
            {item.typeLabel}: {item.name}
          </DialogDescription>
        </DialogHeader>
        {preview.isLoading ? <Skeleton className="h-16 w-full" /> : null}
        {preview.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(preview.error, "Não foi possível conferir este item.")}
          </p>
        ) : null}
        {data ? (
          <div className="space-y-3 text-sm">
            {data.problems.length > 0 ? (
              <ul role="alert" className="list-disc space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 pl-7 text-destructive">
                {data.problems.map((problem) => (
                  <li key={problem.code}>{problem.message}</li>
                ))}
              </ul>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {data.notices.map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
            )}
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
          <Button type="button" disabled={data?.canRestore !== true || restore.isPending} onClick={() => void submit()}>
            {restore.isPending ? "Restaurando…" : "Restaurar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
