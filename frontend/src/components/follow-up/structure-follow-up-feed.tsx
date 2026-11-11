"use client"

import { Fragment, useEffect, useRef } from "react"
import { Clock3, MessageSquareText } from "lucide-react"

import { AnalyticsEmptyState, AnalyticsErrorState } from "@/components/analytics/analytics-states"
import { FollowUpEntry } from "@/components/follow-up/follow-up-entry"
import { FeedbackCard, FeedbackEntryHeader } from "@/components/feedbacks/feedback-entry-header"
import { followUpDayKey, followUpDayLabel } from "@/components/operator/follow-up-timeline"
import { IniaFeed, IniaFeedItem } from "@/components/operator/inia-feed"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import type { SubjectRef } from "@/lib/analytics/subject-params"
import { sanitizeRichText } from "@/lib/security/sanitize-rich-text"
import { useFollowUpFeedQuery } from "@/queries/analytics/use-analytics-queries"

/** Comunicado publicado pelo gestor nesta sessão (só local — o envio ainda não é persistido). */
export type LocalNotice = { id: string; title: string; contentHtml: string; audienceLabel: string; tags: string[]; time: string }

const PAGE_SIZE = 8

/**
 * Surface Acompanhamento da estrutura sobre objetos JÁ persistidos: feedbacks publicados dos colaboradores + outputs/revisões/
 * escalonamentos endereçados ao gestor. Os mesmos objetos da Surface do operador, filtrados pelo sujeito — sem armazenamento
 * paralelo — e a MESMA apresentação: uma timeline só (mais recente primeiro, rótulo do dia), cada item no cartão com o
 * cabeçalho de tipo + motivo + título, conteúdo lido no próprio cartão e "carregar mais" ao chegar ao fim.
 */
export type StructureFollowUpFeedProps = {
  subject: SubjectRef | null
  description: string
  notices?: LocalNotice[]
  employeeHref?: (personId: string) => string
  /** Filtro "só aguardando ciência do colaborador" (deep link `ack=pending` vindo da Equipe). */
  unacknowledgedOnly?: boolean
  onUnacknowledgedOnlyChange?: (value: boolean) => void
  /** Item a destacar/rolar até (deep link `item=<id>` vindo do sino). */
  highlightItemId?: string | null
  /** Bloco no topo do feed (Acompanhamento do líder: "Onde atuar hoje"). */
  lead?: React.ReactNode
}

export function StructureFollowUpFeed({ subject, description, notices = [], employeeHref, unacknowledgedOnly = false, onUnacknowledgedOnlyChange, highlightItemId = null, lead = null }: StructureFollowUpFeedProps) {
  const query = useFollowUpFeedQuery(subject, PAGE_SIZE, unacknowledgedOnly)
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const loaderRef = useRef<HTMLDivElement>(null)
  // Na ficha de um colaborador o feed já é dele: "para Fulano" em cada item seria ruído.
  const showRecipient = subject?.kind !== "EMPLOYEE"
  const emptyDescription = unacknowledgedOnly ? "Nenhum feedback publicado aguardando ciência do colaborador." : "Feedbacks publicados, resultados de workflow e revisões pendentes da estrutura aparecem aqui."

  useEffect(() => {
    const target = loaderRef.current
    if (!target || !hasNextPage || isFetchNextPageError) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !isFetchingNextPage) void fetchNextPage()
    }, { threshold: 0.8 })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  return (
    <IniaFeed title="Acompanhamento" description={description}>
      {onUnacknowledgedOnlyChange ? (
        <div className="flex flex-wrap items-center gap-2 pt-2 pb-1">
          <Button type="button" size="sm" variant={unacknowledgedOnly ? "default" : "outline"} aria-pressed={unacknowledgedOnly} onClick={() => onUnacknowledgedOnlyChange(!unacknowledgedOnly)}>
            <Clock3 aria-hidden />
            Só aguardando ciência
          </Button>
          <span className="text-xs text-muted-foreground">Feedbacks publicados que o colaborador ainda não confirmou ter lido.</span>
        </div>
      ) : null}

      {lead}
      {notices.length > 0 ? <DayLabel>Hoje</DayLabel> : null}
      {notices.map((notice, index) => (
        <Fragment key={notice.id}>
          {index ? <Separator /> : null}
          <IniaFeedItem timestamp={notice.time} meta={<span className="truncate font-normal">{notice.audienceLabel}</span>}>
            <FeedbackCard
              header={
                <FeedbackEntryHeader
                  origin={{ family: "NOTICE", label: null, iconKey: null }}
                  title={notice.title}
                  badges={notice.tags.map((tag) => (
                    <Badge variant="secondary" className="border-0" key={tag}>
                      {tag}
                    </Badge>
                  ))}
                />
              }
            >
              <div className="inia-rich-content text-sm leading-6 text-muted-foreground" dangerouslySetInnerHTML={{ __html: sanitizeRichText(notice.contentHtml) }} />
            </FeedbackCard>
          </IniaFeedItem>
        </Fragment>
      ))}

      {query.isPending ? <FeedSkeleton /> : null}
      {query.isError ? (
        <div className="py-4">
          <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} />
        </div>
      ) : null}
      {query.isSuccess && items.length === 0 && notices.length === 0 ? (
        <div className="py-6">
          <AnalyticsEmptyState icon={MessageSquareText} title="Nenhum acompanhamento encontrado" description={emptyDescription} />
        </div>
      ) : null}
      {items.map((item, index) => {
        const at = instantOf(item.createdAt)
        const label = followUpDayLabel(at)
        // Comunicados desta sessão são de agora: o primeiro item de hoje não repete o rótulo "Hoje".
        const newDay = index > 0 ? dayOf(at) !== dayOf(instantOf(items[index - 1]!.createdAt)) : !(notices.length > 0 && label === "Hoje")
        return (
          <div key={item.id} data-testid="follow-up-entry" data-kind={item.kind}>
            {newDay ? <DayLabel>{label}</DayLabel> : <Separator />}
            <FollowUpEntry item={item} showRecipient={showRecipient} employeeHref={employeeHref} highlighted={highlightItemId === item.id} />
          </div>
        )
      })}

      {hasNextPage ? (
        isFetchNextPageError ? (
          <p role="alert" className="py-5 text-center text-xs text-muted-foreground">
            Não foi possível carregar mais itens.{" "}
            <button type="button" className="underline" onClick={() => void fetchNextPage()}>
              Tentar novamente
            </button>
          </p>
        ) : (
          <div ref={loaderRef} className="space-y-3 py-5" aria-live="polite">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-2 animate-pulse rounded-full bg-primary" />
              Carregando feedbacks...
            </div>
            <div className="flex gap-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          </div>
        )
      ) : items.length > 0 ? (
        <p className="py-5 text-center text-xs text-muted-foreground">Fim dos feedbacks deste período.</p>
      ) : null}
    </IniaFeed>
  )
}

const instantOf = (value: string) => {
  const at = Date.parse(value)
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at
}
const dayOf = (at: number) => (Number.isFinite(at) ? followUpDayKey(new Date(at)) : "")

/** O mesmo rótulo do dia do Acompanhamento do colaborador ("Hoje", "Ontem", "Segunda-feira, 28/09"). */
function DayLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-4 pb-1 text-xs font-medium text-muted-foreground" data-testid="follow-up-day">
      {children}
    </p>
  )
}

function FeedSkeleton() {
  return (
    <div className="space-y-4 py-5" aria-hidden>
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-20 w-full rounded-2xl" />
          </div>
        </div>
      ))}
    </div>
  )
}
