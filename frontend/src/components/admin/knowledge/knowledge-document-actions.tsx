"use client"

import { useState } from "react"
import Link from "next/link"
import { Archive, MoreHorizontal, Pencil, Send, Trash2 } from "lucide-react"

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDeleteKnowledgeDocumentMutation, useSetKnowledgeDocumentStatusMutation } from "@/queries/admin/use-knowledge-queries"
import type { KnowledgeDocument } from "@/schemas/admin/knowledge.schema"

type ActionsProps = {
  document: Pick<KnowledgeDocument, "id" | "title" | "status">
  // Depois de excluir a partir da página de detalhes não há mais o que mostrar — quem chama
  // decide para onde ir (a lista).
  onDeleted?: () => void
}

export function knowledgeEditHref(id: string) {
  return `/admin/knowledge/${id}/edit`
}

function useStatusToggle(document: ActionsProps["document"]) {
  const setStatusMutation = useSetKnowledgeDocumentStatusMutation()
  const isPublished = document.status === "PUBLISHED"
  return {
    isPublished,
    pending: setStatusMutation.isPending,
    label: isPublished ? "Arquivar" : "Publicar",
    Icon: isPublished ? Archive : Send,
    toggle: () => setStatusMutation.mutate({ id: document.id, status: isPublished ? "ARCHIVED" : "PUBLISHED" }),
  }
}

function DeleteDialog({ document, open, onOpenChange, onDeleted }: ActionsProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const deleteMutation = useDeleteKnowledgeDocumentMutation()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {document.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            O documento sai da biblioteca e deixa de ser consultado pelos agentes, mas o registro é mantido no banco para auditoria.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={async () => {
              try {
                await deleteMutation.mutateAsync(document.id)
                onOpenChange(false)
                onDeleted?.()
              } catch {
                // erro já sinalizado pelo toast do useAdminMutation
              }
            }}
          >
            {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// Menu compacto ("⋯") para o card da lista — mantém publicar/arquivar, editar e excluir à mão
// sem espalhar três botões em cada item.
export function KnowledgeDocumentMenu({ document, onDeleted }: ActionsProps) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const status = useStatusToggle(document)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`Ações de ${document.title}`} className="text-muted-foreground">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem disabled={status.pending} onSelect={status.toggle}>
            <status.Icon /> {status.label}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={knowledgeEditHref(document.id)}>
              <Pencil /> Editar
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2 /> Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteDialog document={document} open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={onDeleted} />
    </>
  )
}

// Barra de ações da página de detalhes (artigo ou documento).
export function KnowledgeDocumentActionBar({ document, onDeleted }: ActionsProps) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const status = useStatusToggle(document)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={status.isPublished ? "outline" : "default"} disabled={status.pending} onClick={status.toggle}>
        <status.Icon /> {status.label}
      </Button>
      <Button size="sm" variant="outline" asChild>
        <Link href={knowledgeEditHref(document.id)}>
          <Pencil /> Editar
        </Link>
      </Button>
      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
        <Trash2 /> Excluir
      </Button>
      <DeleteDialog document={document} open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={onDeleted} />
    </div>
  )
}
