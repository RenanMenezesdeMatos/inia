"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarClock, ShieldAlert, Users } from "lucide-react"

import { ListErrorState } from "@/components/admin/shared/list/list-states"
import { Badge } from "@/components/ui/badge"
import { BackLink } from "@/components/ui/back-link"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusChip, SURFACE_CARD, toneSurface } from "@/components/ui/surface"
import { formatDateTime } from "@/lib/format/date"
import { sanitizeRichText } from "@/lib/security/sanitize-rich-text"
import { cn } from "@/lib/utils"
import { useModerationCommunicationQuery } from "@/queries/communications/use-communications"
import { COMMUNICATION_STATE_LABELS } from "@/schemas/communications/communication.schema"

import { STATE_TONES } from "../publication-form"
import { PUBLICATIONS_PATH } from "../publications-route"
import { ModerationRetireDialog } from "./moderation-retire-dialog"

const AUDIENCE_LABEL = { TEAM: "Equipe de quem publicou", ORGANIZATION: "Toda a empresa", SEGMENT: "Público específico" } as const

/**
 * Moderação — conferir a publicação de OUTRA pessoa (Administrador geral) e, se for o caso, retirá-la com motivo. Só leitura: a
 * moderação não edita o texto de ninguém. Rascunhos são privados do autor e não aparecem aqui.
 */
export function PublicationModerationPage({ id }: { id: string }) {
  const router = useRouter()
  const query = useModerationCommunicationQuery(id)
  const [retiring, setRetiring] = useState(false)

  if (query.isLoading) return <div className={cn(SURFACE_CARD, "space-y-4 p-6")} aria-busy="true" aria-label="Carregando a publicação"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40 w-full" /></div>
  if (query.isError || !query.data) {
    return (
      <div className="space-y-4">
        <BackLink href={PUBLICATIONS_PATH} label="Publicações" />
        <ListErrorState message="Não foi possível abrir a publicação. Ela pode já ter sido retirada." onRetry={() => query.refetch()} error={query.error ?? undefined} />
      </div>
    )
  }
  const item = query.data
  const author = item.author.jobTitle ? `${item.author.name} · ${item.author.jobTitle}` : item.author.name
  return (
    <div className="space-y-4">
      <BackLink href={PUBLICATIONS_PATH} label="Publicações" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={STATE_TONES[item.state]}>{COMMUNICATION_STATE_LABELS[item.state]}</StatusChip>
          <span className="text-sm text-muted-foreground">Conferência da moderação · só leitura</span>
        </div>
        <Button type="button" variant="destructive" onClick={() => setRetiring(true)}><ShieldAlert data-icon="inline-start" />Retirar publicação</Button>
      </div>
      <dl className={cn(toneSurface("info"), "grid gap-3 p-4 text-sm sm:grid-cols-3")}>
        <div><dt className="font-medium">Publicado por</dt><dd className="text-muted-foreground">{author}</dd></div>
        <div className="flex items-start gap-2"><Users className="mt-0.5 size-4 shrink-0" aria-hidden /><div><dt className="font-medium">Público</dt><dd className="text-muted-foreground">{AUDIENCE_LABEL[item.audience]} · {item.recipientCount.toLocaleString("pt-BR")} {item.recipientCount === 1 ? "pessoa" : "pessoas"}</dd></div></div>
        <div className="flex items-start gap-2"><CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden /><div><dt className="font-medium">Datas</dt><dd className="text-muted-foreground">{item.publishedAt ? formatDateTime(item.publishedAt) : "—"}{item.displayUntil ? ` até ${formatDateTime(item.displayUntil)}` : ""}</dd></div></div>
      </dl>
      <article className={cn(SURFACE_CARD, "space-y-4 p-6 sm:p-8")}>
        <div className="flex flex-wrap gap-1.5">{item.tags.map((tag) => <Badge key={tag} variant="secondary" className="border-0">{tag}</Badge>)}</div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{item.title}</h1>
        {item.summary ? <p className="text-base text-muted-foreground">{item.summary}</p> : null}
        <div className="inia-rich-content text-[0.9375rem] leading-7" dangerouslySetInnerHTML={{ __html: sanitizeRichText(item.contentHtml) }} />
      </article>
      <ModerationRetireDialog id={item.id} title={item.title} authorName={item.author.name} open={retiring} onOpenChange={setRetiring} onRetired={() => router.push(PUBLICATIONS_PATH)} />
    </div>
  )
}
