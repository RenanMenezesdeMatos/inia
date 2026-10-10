"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock3, Maximize2, Megaphone, MessageSquareText, Send, Target, type LucideIcon } from "lucide-react"

import { AnalyticsEmptyState, AnalyticsErrorState } from "@/components/analytics/analytics-states"
import { FollowUpDetailSheet } from "@/components/follow-up/follow-up-detail-sheet"
import { RichContent } from "@/components/rich-content/rich-content"
import { IniaFeed, IniaFeedItem } from "@/components/operator/inia-feed"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatDateTime } from "@/lib/format/date"
import type { SubjectRef } from "@/lib/analytics/subject-params"
import { sanitizeRichText } from "@/lib/security/sanitize-rich-text"
import { useFollowUpFeedQuery } from "@/queries/analytics/use-analytics-queries"
import type { FollowUpItem } from "@/schemas/analytics/analytics.schema"

/** Comunicado publicado pelo gestor nesta sessão (só local — o envio ainda não é persistido). */
export type LocalNotice = { id: string; title: string; contentHtml: string; audienceLabel: string; tags: string[]; time: string }

const CATEGORY_VISUALS: Record<FollowUpItem["category"], { label: string; icon: LucideIcon; className: string }> = {
  INDICATOR: { label: "Feedback de indicador", icon: Target, className: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" },
  MONITORING: { label: "Monitoria", icon: ClipboardCheck, className: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  WORKFLOW_OUTPUT: { label: "Resultado de workflow", icon: Send, className: "bg-primary/10 text-primary" },
  WORKFLOW_HUMAN_REVIEW: { label: "Revisão pendente", icon: ClipboardCheck, className: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
  WORKFLOW_ESCALATION: { label: "Escalonamento", icon: AlertTriangle, className: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  OTHER: { label: "Acompanhamento", icon: MessageSquareText, className: "bg-muted text-muted-foreground" },
}

const PAGE_SIZE = 8

/**
 * Surface Acompanhamento da estrutura sobre objetos JÁ persistidos: feedbacks publicados dos
 * colaboradores + outputs/revisões/escalonamentos endereçados ao gestor. Os mesmos objetos da
 * Surface do operador, filtrados pelo sujeito — sem armazenamento paralelo.
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
}

export function StructureFollowUpFeed({ subject, description, notices = [], employeeHref, unacknowledgedOnly = false, onUnacknowledgedOnlyChange, highlightItemId = null }: StructureFollowUpFeedProps) {
  const [page, setPage] = useState(1)
  // Item aberto no detalhe integral (Sheet) — o MESMO objeto do feed, sem request nem tabela extra.
  const [openItem, setOpenItem] = useState<FollowUpItem | null>(null)
  const query = useFollowUpFeedQuery(subject, page, PAGE_SIZE, unacknowledgedOnly)

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / PAGE_SIZE)) : 1
  const emptyDescription = unacknowledgedOnly ? "Nenhum feedback publicado aguardando ciência do colaborador." : "Feedbacks publicados, resultados de workflow e revisões pendentes da estrutura aparecem aqui."

  return (
    <IniaFeed title="Acompanhamento" description={description}>
      {onUnacknowledgedOnlyChange ? (
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <Button
            type="button"
            size="sm"
            variant={unacknowledgedOnly ? "default" : "outline"}
            aria-pressed={unacknowledgedOnly}
            onClick={() => {
              setPage(1)
              onUnacknowledgedOnlyChange(!unacknowledgedOnly)
            }}
          >
            <Clock3 aria-hidden />
            Só aguardando ciência
          </Button>
          <span className="text-xs text-muted-foreground">Feedbacks publicados que o colaborador ainda não confirmou ter lido.</span>
        </div>
      ) : null}
      {notices.map((notice) => (
        <div key={notice.id}>
          <IniaFeedItem timestamp={notice.time}>
            <article className="rounded-2xl bg-muted/55 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Megaphone className="size-4" aria-hidden />
                </span>
                <Badge variant="outline" className="border-0 bg-card">Comunicado</Badge>
                {notice.tags.map((tag) => (
                  <Badge variant="secondary" className="border-0" key={tag}>
                    {tag}
                  </Badge>
                ))}
                <span className="text-xs text-muted-foreground">{notice.audienceLabel}</span>
              </div>
              <h3 className="mt-3 text-base font-medium">{notice.title}</h3>
              <div className="inia-rich-content mt-2 text-sm leading-6 text-muted-foreground" dangerouslySetInnerHTML={{ __html: sanitizeRichText(notice.contentHtml) }} />
            </article>
          </IniaFeedItem>
          <Separator />
        </div>
      ))}

      {query.isPending ? <FeedSkeleton /> : null}
      {query.isError ? <div className="py-4"><AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /></div> : null}
      {query.data && query.data.total === 0 && notices.length === 0 ? (
        <div className="py-6">
          <AnalyticsEmptyState icon={MessageSquareText} title="Nenhum acompanhamento encontrado" description={emptyDescription} />
        </div>
      ) : null}
      {query.data?.items.map((item, index) => (
        <div key={item.id}>
          {index ? <Separator /> : null}
          <FollowUpEntry item={item} employeeHref={employeeHref} highlighted={highlightItemId === item.id} onOpenDetail={() => setOpenItem(item)} />
        </div>
      ))}
      <FollowUpDetailSheet item={openItem} categoryLabel={(entry) => CATEGORY_VISUALS[entry.category].label} onOpenChange={(open) => !open && setOpenItem(null)} employeeHref={employeeHref} />
      {query.data && query.data.total > PAGE_SIZE ? (
        <div className="flex items-center justify-between py-4 text-xs text-muted-foreground" aria-live="polite">
          <span>
            Página {page} de {totalPages} · {query.data.total} itens
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              Anterior
            </Button>
            <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>
              Próxima
            </Button>
          </div>
        </div>
      ) : null}
    </IniaFeed>
  )
}

function FollowUpEntry({ item, employeeHref, highlighted, onOpenDetail }: { item: FollowUpItem; employeeHref?: (personId: string) => string; highlighted: boolean; onOpenDetail: () => void }) {
  const visual = CATEGORY_VISUALS[item.category]
  const Icon = visual.icon
  const articleRef = useRef<HTMLElement>(null)
  // Deep link do sino: rola até o item e o destaca uma vez.
  useEffect(() => {
    if (highlighted) articleRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [highlighted])
  return (
    <IniaFeedItem timestamp={formatDateTime(item.createdAt)}>
      <article ref={articleRef} id={`follow-up-${item.id}`} className={`min-w-0 max-w-full rounded-2xl bg-muted/55 p-4 ${highlighted ? "ring-2 ring-primary/50" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`flex size-7 items-center justify-center rounded-full ${visual.className}`}>
            <Icon className="size-4" aria-hidden />
          </span>
          <Badge variant="outline" className="border-0 bg-card">{visual.label}</Badge>
          {item.severity === "HIGH" || item.severity === "CRITICAL" ? <Badge variant="destructive">{item.severity === "CRITICAL" ? "Crítico" : "Alta prioridade"}</Badge> : null}
          {item.operator ? (
            employeeHref ? (
              <Link href={employeeHref(item.operator.personId)} className="text-xs text-muted-foreground hover:underline">
                {item.operator.name}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">{item.operator.name}</span>
            )
          ) : null}
          {item.kind === "FEEDBACK" ? <AcknowledgementStatus acknowledgedAt={item.acknowledgedAt} /> : null}
        </div>
        <h3 className="mt-3 text-base font-medium break-words">{item.title}</h3>
        {item.subtitle ? <p className="text-xs text-muted-foreground">{item.subtitle}</p> : null}
        {/* Card compacto (3 linhas) — o conteúdo INTEIRO (síntese do Orquestrador, plano, padrões,
          * feedback com as 4 partes) abre no detalhe, nunca fica escondido atrás do clamp. */}
        <div className="mt-1 line-clamp-3 text-muted-foreground"><RichContent text={item.summary} /></div>
        <Button type="button" variant="ghost" size="sm" className="mt-2 -ml-2" onClick={onOpenDetail} aria-label={`${item.kind === "FEEDBACK" ? "Ver feedback completo" : "Ver análise completa"}: ${item.title}`}>
          <Maximize2 aria-hidden />
          {item.kind === "FEEDBACK" ? "Ver feedback completo" : "Ver análise completa"}
        </Button>
      </article>
    </IniaFeedItem>
  )
}

/** Ciência = confirmação formal do PRÓPRIO colaborador de que leu o feedback (feita no
 * Acompanhamento dele). O gestor só acompanha o estado. */
function AcknowledgementStatus({ acknowledgedAt }: { acknowledgedAt: string | null }) {
  if (acknowledgedAt) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-3.5" aria-hidden />
        Ciência em {formatDateTime(acknowledgedAt)}
      </span>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
          <Clock3 className="size-3.5" aria-hidden />
          Aguardando ciência do colaborador
        </span>
      </TooltipTrigger>
      <TooltipContent>O colaborador ainda não confirmou, no Acompanhamento dele, que leu este feedback.</TooltipContent>
    </Tooltip>
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
