"use client"

import { Megaphone } from "lucide-react"

import { AnalyticsEmptyState } from "@/components/analytics/analytics-states"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { SURFACE_CARD } from "@/components/ui/surface"
import { formatDateTime } from "@/lib/format/date"
import { sanitizeRichText } from "@/lib/security/sanitize-rich-text"
import { cn } from "@/lib/utils"
import { useCommunicationQuery } from "@/queries/communications/use-communications"

/**
 * Leitura de um comunicado NO AR por quem o recebeu — o destino do link que a INIA cita no chat. O servidor confere a visibilidade
 * (`GET /communications/:id`, a mesma regra do Acompanhamento): fora do público, arquivado, encerrado ou retirado = "não disponível".
 */
export function PublicationReadingPage({ id }: { id: string }) {
  return <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10"><PublicationReading id={id} /></div>
}

function PublicationReading({ id }: { id: string }) {
  const query = useCommunicationQuery(id, true)
  if (query.isLoading) {
    return (
      <div className={cn(SURFACE_CARD, "space-y-4 p-6")} aria-busy="true" aria-label="Carregando o comunicado">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (query.isError || !query.data) {
    return <div><AnalyticsEmptyState icon={Megaphone} title="Comunicado não disponível" description="Ele pode ter sido arquivado, encerrado ou não ser para o seu público." /></div>
  }
  const notice = query.data
  const author = notice.author.jobTitle ? `${notice.author.name} · ${notice.author.jobTitle}` : notice.author.name
  return (
    <article className={cn(SURFACE_CARD, "space-y-4 p-6 sm:p-8")}>
      <header className="space-y-2">
        <div className="flex flex-wrap gap-1.5">{notice.tags.map((tag) => <Badge key={tag} variant="secondary" className="border-0">{tag}</Badge>)}</div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{notice.title}</h1>
        <p className="text-sm text-muted-foreground">
          {author} · {formatDateTime(notice.publishedAt)}{notice.editedAt ? ` · editado em ${formatDateTime(notice.editedAt)}` : ""}
        </p>
        {notice.summary ? <p className="text-base text-muted-foreground">{notice.summary}</p> : null}
      </header>
      <div className="inia-rich-content text-[0.9375rem] leading-7" dangerouslySetInnerHTML={{ __html: sanitizeRichText(notice.contentHtml) }} />
    </article>
  )
}
