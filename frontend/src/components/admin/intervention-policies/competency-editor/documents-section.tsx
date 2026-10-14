"use client"

import { useId, useState } from "react"
import { Link2, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useEditorCatalogQuery } from "@/queries/admin/use-intervention-policy-queries"
import type { CompetencyView } from "@/schemas/admin/intervention-policy.schema"

import { Note } from "../shared/fields"

export type LinkedDocument = { id: string; title: string; published: boolean | null }

/**
 * Documentos da base de conhecimento ligados à competência (o conteúdo APROVADO que o treinamento usa). Título e "tem versão
 * publicada" vêm do catálogo do editor de políticas — vincular não exige a permissão de gerenciar a base (ler o conteúdo, sim).
 */
export function useLinkedDocuments(ids: string[], saved: CompetencyView["documents"]): LinkedDocument[] {
  const catalogQuery = useEditorCatalogQuery()
  return ids.map((id) => {
    const fromSaved = saved.find((document) => document.id === id)
    if (fromSaved) return { id, title: fromSaved.title, published: fromSaved.published }
    const fromBase = catalogQuery.data?.documents.find((document) => document.id === id)
    return { id, title: fromBase?.title ?? "Documento", published: fromBase ? fromBase.published : null }
  })
}

export function DocumentsSection({ ids, saved, disabled, onChange }: { ids: string[]; saved: CompetencyView["documents"]; disabled: boolean; onChange: (ids: string[]) => void }) {
  const catalogQuery = useEditorCatalogQuery()
  const linked = useLinkedDocuments(ids, saved)
  const searchId = useId()
  const [search, setSearch] = useState("")
  const term = search.trim().toLocaleLowerCase("pt-BR")
  const candidates = (catalogQuery.data?.documents ?? []).filter((document) => !ids.includes(document.id) && (!term || document.title.toLocaleLowerCase("pt-BR").includes(term))).slice(0, 8)

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
      {disabled ? null : catalogQuery.isError ? (
        <Note>Não foi possível carregar os documentos da base agora.</Note>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={searchId} className="text-xs">
            Vincular documento
          </Label>
          <Input id={searchId} type="search" value={search} placeholder="Buscar pelo título" onChange={(event) => setSearch(event.target.value)} />
          <ul className="space-y-1">
            {candidates.map((document) => (
              <li key={document.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {document.title}
                  {document.published ? null : <span className="ml-1 text-xs text-muted-foreground">(não publicado)</span>}
                </span>
                <Button type="button" size="sm" variant="ghost" disabled={ids.length >= 30} onClick={() => onChange([...ids, document.id])}>
                  <Link2 /> Vincular
                </Button>
              </li>
            ))}
            {catalogQuery.isSuccess && candidates.length === 0 ? <li className="text-xs text-muted-foreground">Nenhum documento encontrado.</li> : null}
          </ul>
        </div>
      )}
    </section>
  )
}
