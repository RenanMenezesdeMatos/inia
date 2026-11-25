"use client"

import { Link2, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RemoteCombobox, RemoteComboboxTrigger, RemoteSelectionFooter, remoteListOf, useRemoteCombobox } from "@/components/ui/remote-combobox"
import { useEditorDocumentsByIdsQuery, useEditorDocumentsInfiniteQuery } from "@/queries/admin/use-intervention-policy-queries"
import type { CompetencyView } from "@/schemas/admin/intervention-policy.schema"

import { Note } from "../shared/fields"

const MAX_DOCUMENTS = 30

export type LinkedDocument = { id: string; title: string; published: boolean | null }

/**
 * Documentos da base de conhecimento ligados à competência (o conteúdo APROVADO que o treinamento usa). Título e "tem versão
 * publicada" vêm da própria área de políticas — vincular não exige a permissão de gerenciar a base (ler o conteúdo, sim).
 */
export function useLinkedDocuments(ids: string[], saved: CompetencyView["documents"]): LinkedDocument[] {
  // Só as que o registro salvo não traz (ligadas agora): título pelo id, mesmo fora do lote carregado no seletor.
  const missing = ids.filter((id) => !saved.some((document) => document.id === id))
  const found = useEditorDocumentsByIdsQuery(missing).data
  return ids.map((id) => {
    const fromSaved = saved.find((document) => document.id === id)
    if (fromSaved) return { id, title: fromSaved.title, published: fromSaved.published }
    const fromBase = found?.find((document) => document.id === id)
    return { id, title: fromBase?.title ?? "Documento", published: fromBase ? fromBase.published : null }
  })
}

export function DocumentsSection({ ids, saved, disabled, onChange }: { ids: string[]; saved: CompetencyView["documents"]; disabled: boolean; onChange: (ids: string[]) => void }) {
  const linked = useLinkedDocuments(ids, saved)
  const state = useRemoteCombobox()
  const list = remoteListOf(useEditorDocumentsInfiniteQuery(state.term, state.open))
  const full = ids.length >= MAX_DOCUMENTS

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-semibold">Conteúdos da base de conhecimento</h3>
        <p className="text-xs text-muted-foreground">O treinamento só usa conteúdo publicado. Até 30 documentos.</p>
      </div>
      {linked.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum documento vinculado.</p> : null}
      <ul className="space-y-1.5">
        {linked.map((document) => (
          <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm">
            <span>{document.title}</span>
            <span className="flex items-center gap-2">
              {document.published === null ? null : <Badge variant={document.published ? "secondary" : "outline"}>{document.published ? "Publicado" : "Não publicado"}</Badge>}
              {disabled ? null : (
                <Button type="button" size="icon-xs" variant="ghost" aria-label={`Desvincular ${document.title}`} onClick={() => onChange(ids.filter((id) => id !== document.id))}>
                  <X />
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {linked.some((document) => document.published === false) ? <Note tone="warning">Há documento sem versão publicada: ele não entra em treinamento até ser publicado na base.</Note> : null}
      {disabled ? null : (
        <RemoteCombobox
          state={state}
          list={list}
          multiple
          listLabel="Documentos da base"
          searchLabel="Buscar documento pelo título"
          searchPlaceholder="Buscar pelo título"
          emptyText="Nenhum documento na base."
          optionOf={(document) => ({ id: document.id, label: document.title, details: document.published ? null : "Não publicado", selected: ids.includes(document.id), disabledReason: full && !ids.includes(document.id) ? `Até ${MAX_DOCUMENTS} documentos` : null })}
          onSelect={(document) => onChange(ids.includes(document.id) ? ids.filter((id) => id !== document.id) : [...ids, document.id])}
          footer={<RemoteSelectionFooter count={ids.length} summary={ids.length === 1 ? "1 documento vinculado" : `${ids.length} documentos vinculados`} emptyText="Nenhum documento vinculado" onDone={() => state.setOpen(false)} />}
          trigger={<RemoteComboboxTrigger label={null} placeholder="Vincular documento" icon={<Link2 className="size-4" aria-hidden />} className="max-w-96" />}
        />
      )}
    </section>
  )
}
