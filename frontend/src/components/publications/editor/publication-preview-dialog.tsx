"use client"

import { CalendarClock, Eye, Users } from "lucide-react"

import { CommunicationEntry } from "@/components/communications/communication-entry"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { toneSurface } from "@/components/ui/surface"
import { sanitizeRichText } from "@/lib/security/sanitize-rich-text"
import type { AudienceOptions, Communication, EditorialCommunication, EditorialForm } from "@/schemas/communications/communication.schema"

import { audienceDescription, scheduleDescription } from "../publication-form"

/**
 * Prévia: a MESMA peça que o colaborador vê no Acompanhamento (`CommunicationEntry`, como quem recebeu), com o conteúdo como está
 * no editor (saneado). Acima, o público escolhido e as datas — o que precisa ser conferido antes de publicar.
 */
export function PublicationPreviewDialog({ form, saved, options, author, recipientCount }: {
  form: EditorialForm
  saved: EditorialCommunication | null
  options: AudienceOptions | undefined
  author: { personId: string; name: string; jobTitle: string | null }
  recipientCount: number | null
}) {
  const notice: Communication = {
    id: saved?.id ?? "previa",
    title: form.title.trim() || "Sem título",
    contentHtml: sanitizeRichText(form.contentHtml),
    plainText: form.plainText,
    tags: form.tags,
    audience: form.audience,
    author,
    recipientCount: null,
    authoredByViewer: false,
    publishedAt: saved?.publishedAt && !form.publishAt ? saved.publishedAt : form.publishAt ?? new Date().toISOString(),
    editedAt: null,
    summary: form.summary || null,
    featured: form.featured,
    displayUntil: form.displayUntil,
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline"><Eye data-icon="inline-start" />Pré-visualizar</Button>
      </DialogTrigger>
      <DialogContent className="w-[min(calc(100vw-2rem),46rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pré-visualização</DialogTitle>
          <DialogDescription>Como o colaborador verá a publicação no Acompanhamento.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70dvh] space-y-4 overflow-y-auto pr-1">
          <dl className={`${toneSurface("info")} grid gap-2 p-3 text-sm sm:grid-cols-2`}>
            <div className="flex items-start gap-2"><Users className="mt-0.5 size-4 shrink-0" aria-hidden /><div><dt className="font-medium">Público</dt><dd className="text-muted-foreground">{audienceDescription(form, options)}{recipientCount !== null ? ` · ${recipientCount.toLocaleString("pt-BR")} ${recipientCount === 1 ? "pessoa" : "pessoas"} hoje` : ""}</dd></div></div>
            <div className="flex items-start gap-2"><CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden /><div><dt className="font-medium">Datas</dt><dd className="text-muted-foreground">{scheduleDescription(form, saved)}</dd></div></div>
          </dl>
          {form.summary.trim() ? <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Resumo: </span>{form.summary.trim()}</p> : null}
          <div className="rounded-2xl bg-muted/30 px-3"><CommunicationEntry notice={notice} /></div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">Fechar</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
