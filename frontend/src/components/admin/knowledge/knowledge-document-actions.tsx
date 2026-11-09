"use client"

import { useState } from "react"
import Link from "next/link"
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Send, Trash2 } from "lucide-react"

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
import { useDeleteKnowledgeDocumentMutation } from "@/queries/admin/use-knowledge-queries"
import type { KnowledgeDocument } from "@/schemas/admin/knowledge.schema"

import { ArchiveKnowledgeDialog, PublishKnowledgeDialog, ReactivateKnowledgeDialog } from "./knowledge-lifecycle-dialogs"
import { versionLabel } from "./knowledge-visuals"
import { RESTORE_NOTE } from "@/lib/admin/logical-delete"

type ActionsProps = {
  document: Pick<KnowledgeDocument, "id" | "title" | "status" | "inUseVersion" | "draftVersion">
  // Depois de excluir a partir da página de detalhes não há mais o que mostrar — quem chama
  // decide para onde ir (a lista).
  onDeleted?: () => void
}

export function knowledgeEditHref(id: string) {
  return `/admin/knowledge/${id}/edit`
}

function DeleteDialog({ document, open, onOpenChange, onDeleted }: ActionsProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const deleteMutation = useDeleteKnowledgeDocumentMutation()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {document.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            O documento sai da biblioteca e deixa de ser consultado pelos agentes. {RESTORE_NOTE}
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

// Menu compacto ("⋯") para o card da lista: publicar o rascunho, arquivar ou reativar, editar e excluir à mão, sem espalhar botões em cada item.
export function KnowledgeDocumentMenu({ document, onDeleted }: ActionsProps) {
  const [dialog, setDialog] = useState<"publish" | "archive" | "reactivate" | "delete" | null>(null)
  const openChange = (name: NonNullable<typeof dialog>) => (open: boolean) => setDialog(open ? name : null)
  const archived = document.status === "ARCHIVED"

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`Ações de ${document.title}`} className="text-muted-foreground">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {document.draftVersion !== null ? (
            <DropdownMenuItem onSelect={() => setDialog("publish")}>
              <Send /> Publicar {versionLabel(document.draftVersion)}
            </DropdownMenuItem>
          ) : null}
          {document.inUseVersion !== null ? (
            <DropdownMenuItem onSelect={() => setDialog("archive")}>
              <Archive /> Arquivar
            </DropdownMenuItem>
          ) : null}
          {archived ? (
            <DropdownMenuItem onSelect={() => setDialog("reactivate")}>
              <ArchiveRestore /> Reativar
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link href={knowledgeEditHref(document.id)}>
              <Pencil /> Editar
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
            <Trash2 /> Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {document.draftVersion !== null ? (
        <PublishKnowledgeDialog
          document={{ id: document.id, draftVersion: document.draftVersion, inUseVersion: document.inUseVersion, archived }}
          open={dialog === "publish"}
          onOpenChange={openChange("publish")}
        />
      ) : null}
      <ArchiveKnowledgeDialog document={document} open={dialog === "archive"} onOpenChange={openChange("archive")} />
      <ReactivateKnowledgeDialog document={document} open={dialog === "reactivate"} onOpenChange={openChange("reactivate")} />
      <DeleteDialog document={document} open={dialog === "delete"} onOpenChange={openChange("delete")} onDeleted={onDeleted} />
    </>
  )
}

// Barra de ações da página de detalhes. Publicar e Descartar ficam junto do rascunho, no painel de situação. `canEdit` falso = a versão em
// edição vale para Grupos fora do escopo de quem lê: Editar sai, e o aviso do painel de situação diz por quê.
export function KnowledgeDocumentActionBar({ document, onDeleted, canEdit = true }: ActionsProps & { canEdit?: boolean }) {
  const [dialog, setDialog] = useState<"archive" | "reactivate" | "delete" | null>(null)
  const openChange = (name: NonNullable<typeof dialog>) => (open: boolean) => setDialog(open ? name : null)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit ? (
        <Button size="sm" variant="outline" asChild>
          <Link href={knowledgeEditHref(document.id)}>
            <Pencil /> Editar
          </Link>
        </Button>
      ) : null}
      {document.inUseVersion !== null ? (
        <Button size="sm" variant="outline" onClick={() => setDialog("archive")}>
          <Archive /> Arquivar
        </Button>
      ) : null}
      {document.status === "ARCHIVED" ? (
        <Button size="sm" variant="outline" onClick={() => setDialog("reactivate")}>
          <ArchiveRestore /> Reativar
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDialog("delete")}>
        <Trash2 /> Excluir
      </Button>
      <ArchiveKnowledgeDialog document={document} open={dialog === "archive"} onOpenChange={openChange("archive")} />
      <ReactivateKnowledgeDialog document={document} open={dialog === "reactivate"} onOpenChange={openChange("reactivate")} />
      <DeleteDialog document={document} open={dialog === "delete"} onOpenChange={openChange("delete")} onDeleted={onDeleted} />
    </div>
  )
}
