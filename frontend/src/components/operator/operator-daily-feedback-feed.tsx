"use client"

import { useEffect, useRef, useState } from "react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import type { OperatorIndicatorsData, OperatorIndicatorsHistoryKind } from "@/schemas/operator"
import { RichContent } from "@/components/rich-content/rich-content"
import { OperatorFeedbackDetail, type FeedbackAcknowledgement } from "./operator-feedback-detail"
import { FeedbackCard, FeedbackEntryHeader, FeedbackEntryWhen, type FeedbackEntryFamily } from "@/components/feedbacks/feedback-entry-header"
import { FeedbackRating } from "@/components/feedbacks/feedback-rating"
import { IniaFeed, IniaFeedItem } from "./inia-feed"
import { DeliveredFeedbackEntry } from "./delivered-feedback-entry"
import { useMyDeliveredFeedbackQuery } from "@/queries/feedback-delivery/use-delivered-feedback"
import { formatDateTime } from "@/lib/format/date"
import { buildFollowUpTimeline, followUpDayKey, followUpDayLabel, type FollowUpEntry } from "./follow-up-timeline"
import { FeedbackApplicationButton } from "./feedback-application/feedback-application-button"
import { useFeedbackWorkspace } from "./feedback-application/feedback-workspace-context"
import { feedbackSourceKey, type FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 4
/** Família do item quando o backend não mandou o motivo (feedback anterior ao campo) — o ícone cai no padrão da família. */
const familyOf: Record<OperatorIndicatorsHistoryKind, FeedbackEntryFamily> = {
  reading: "DAILY_READING",
  monitoria_feedback: "MONITORING",
  indicator_feedback: "INDICATOR",
}

export function OperatorDailyFeedbackFeed({ indicators }: { indicators: OperatorIndicatorsData }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [loading, setLoading] = useState(false)
  // Feedback de atendimento (V1.5.6): mais uma FONTE deste mesmo feed — entregas ao próprio colaborador (flag OFF = nenhuma).
  const delivered = useMyDeliveredFeedbackQuery()
  const loaderRef = useRef<HTMLDivElement>(null)
  // Uma timeline só, MAIS RECENTE PRIMEIRO (feedbacks publicados + entregas de atendimento); o "carregar mais" revela os
  // progressivamente mais antigos da lista já ordenada.
  const timeline = buildFollowUpTimeline(indicators.history, delivered.data ?? [])
  const hasMore = visibleCount < timeline.length
  // Aplicação de feedback: o item aberto no painel da INIA fica destacado; "Ler feedback" (convite) leva ao item e o abre.
  const workspace = useFeedbackWorkspace()
  const rootRef = useRef<HTMLDivElement>(null)
  const [openEntries, setOpenEntries] = useState<Record<string, boolean>>({})
  const [flashKey, setFlashKey] = useState<string | null>(null)
  const readTarget = workspace?.readTarget ?? null
  const readIndex = readTarget ? timeline.findIndex((entry) => entry.key === entryKeyOf(readTarget.key)) : -1
  const [handledRead, setHandledRead] = useState<number | null>(null)
  if (readTarget && readIndex >= 0 && handledRead !== readTarget.nonce) {
    // Ajuste de estado durante o render (padrão do React para estado derivado): revela até o item e o abre.
    setHandledRead(readTarget.nonce)
    if (readIndex >= visibleCount) setVisibleCount(readIndex + 1)
    setOpenEntries((current) => ({ ...current, [timeline[readIndex]!.key]: true }))
    setFlashKey(timeline[readIndex]!.key)
  }
  useEffect(() => {
    if (!flashKey) return
    const element = rootRef.current?.querySelector<HTMLElement>(`[data-entry-key="${CSS.escape(flashKey)}"]`)
    element?.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
    const timer = window.setTimeout(() => setFlashKey(null), 2600)
    return () => window.clearTimeout(timer)
  }, [flashKey])

  useEffect(() => {
    const target = loaderRef.current
    if (!target || !hasMore) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || loading) return
      setLoading(true)
      window.setTimeout(() => { setVisibleCount((count) => Math.min(count + PAGE_SIZE, timeline.length)); setLoading(false) }, 650)
    }, { threshold: 0.8 })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, timeline.length, loading])

  // O feed chega do servidor já renderizado; a ciência confirmada nesta sessão (aqui ou dentro da sessão com a INIA) vem do mapa
  // compartilhado do controle de confirmação até o próximo carregamento — a fonte de verdade é o backend (`acknowledged_at`).
  function acknowledgementFor(item: OperatorIndicatorsData["history"][number]): FeedbackAcknowledgement | undefined {
    if (item.acknowledgedAt === undefined) return undefined
    return { source: { kind: "PUBLISHED_FEEDBACK", id: item.id }, title: item.feedback?.view?.heading?.title ?? item.title, acknowledgedAt: item.acknowledgedAt }
  }

  const setEntryOpen = (key: string, open: boolean) => setOpenEntries((current) => ({ ...current, [key]: open }))

  function renderEntry(entry: FollowUpEntry) {
    // Avaliação "foi útil?" só onde ela é real: item com fonte (feedback publicado ou atendimento entregue), nunca "Leitura do dia".
    const source = sourceOfEntry(entry)
    const footer = source ? <FeedbackRating source={source}/> : undefined
    if (entry.source === "delivered") {
      const item = entry.item
      return <div data-testid="delivered-feedback"><IniaFeedItem timestamp={formatDateTime(item.deliveredAt)} meta={<FeedbackEntryWhen text={`Atendimento de ${item.interactionLabel}`}/>} footer={footer}><DeliveredFeedbackEntry item={item} expanded={openEntries[entry.key] ?? false} onExpandedChange={(open) => setEntryOpen(entry.key, open)} action={<FeedbackApplicationButton source={{ kind: "INTERACTION_FEEDBACK_DELIVERY", id: item.id }} title={item.title} periodLabel={`Atendimento de ${item.interactionLabel}`}/>}/></IniaFeedItem></div>
    }
    const item = entry.item
    const title = item.feedback?.view?.heading?.title ?? item.title
    const subtitle = item.feedback?.view?.heading?.subtitle ?? item.subtitle ?? null
    // Só feedback PUBLICADO (o que pode receber ciência) tem aplicação; "Leitura do dia" não.
    const action = item.acknowledgedAt !== undefined ? <FeedbackApplicationButton source={{ kind: "PUBLISHED_FEEDBACK", id: item.id }} title={title} periodLabel={subtitle}/> : undefined
    const origin = item.origin ? { family: item.origin.family, label: item.origin.label, iconKey: item.origin.iconKey } : { family: familyOf[item.kind], label: null, iconKey: null }
    return <IniaFeedItem timestamp={item.timestamp} meta={subtitle ? <FeedbackEntryWhen text={subtitle}/> : undefined} footer={footer}>
            <FeedbackCard usageEntity={item.acknowledgedAt !== undefined ? { type: "PUBLISHED_FEEDBACK", id: item.id } : undefined} header={<FeedbackEntryHeader origin={origin} title={title} action={action}/>}>{item.feedback?.view
              // Feedback por Flag V2: a narrativa de supervisor JÁ é o resumo — aparece direto, sem card textual antes nem "Ver feedback completo".
              ? <OperatorFeedbackDetail item={item} acknowledgement={acknowledgementFor(item)}/>
              : <><div className="line-clamp-2 text-muted-foreground"><RichContent text={item.message}/></div><Accordion type="single" collapsible value={openEntries[entry.key] ? "message" : ""} onValueChange={(value) => setEntryOpen(entry.key, value === "message")}><AccordionItem value="message" className="border-0"><AccordionTrigger className="justify-start gap-2 py-2 text-xs hover:no-underline" data-usage-element="feedback.open_detail">Ver feedback completo</AccordionTrigger><AccordionContent className="h-auto"><div data-usage-screen="feedback.detail"><OperatorFeedbackDetail item={item} acknowledgement={acknowledgementFor(item)}/></div></AccordionContent></AccordionItem></Accordion></>}</FeedbackCard>
        </IniaFeedItem>
  }

  return <div ref={rootRef} className="contents"><IniaFeed title="Acompanhamento" description="Feedbacks e monitorias da INIA">
      {delivered.isPending ? <div className="flex gap-3 py-5" aria-busy="true" aria-label="Carregando feedbacks de atendimento"><Skeleton className="size-9 shrink-0 rounded-full"/><div className="flex-1 space-y-2"><Skeleton className="h-4 w-40"/><Skeleton className="h-4 w-full"/></div></div> : null}
      {delivered.isError ? <p role="alert" className="py-4 text-sm text-muted-foreground">Não foi possível carregar os feedbacks de atendimento. <button type="button" className="underline" onClick={() => void delivered.refetch()}>Tentar de novo</button></p> : null}
      {delivered.isSuccess && timeline.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nenhum feedback por enquanto.</p> : null}
      {timeline.slice(0, visibleCount).map((entry, index, visible) => {
        const previous = visible[index - 1]
        const newDay = !previous || followUpDayKey(new Date(previous.at)) !== followUpDayKey(new Date(entry.at))
        const sourceKey = sourceKeyOfEntry(entry)
        const active = sourceKey !== null && workspace?.activeSourceKey === sourceKey
        return <div key={entry.key} data-testid="follow-up-entry" data-source={entry.source} data-entry-key={entry.key} data-active={active || undefined}>
          {newDay ? <p className="pb-1 pt-4 text-xs font-medium text-muted-foreground" data-testid="follow-up-day">{followUpDayLabel(entry.at)}</p> : <Separator/>}
          <div className={cn("-mx-3 rounded-2xl px-3 transition-[background-color,box-shadow] duration-500 motion-reduce:transition-none", active && "bg-primary/5 ring-1 ring-primary/30", flashKey === entry.key && "bg-primary/10 ring-2 ring-primary/50")}>{renderEntry(entry)}</div>
        </div>
      })}
      {hasMore ? <div ref={loaderRef} className="space-y-3 py-5" aria-live="polite"><div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="size-2 animate-pulse rounded-full bg-primary"/>Carregando feedbacks...</div><div className="flex gap-3"><Skeleton className="size-9 shrink-0 rounded-full"/><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32"/><Skeleton className="h-4 w-full"/><Skeleton className="h-4 w-3/4"/></div></div></div> : <p className="py-5 text-center text-xs text-muted-foreground">Fim dos feedbacks deste período.</p>}
  </IniaFeed></div>
}

/** Fonte da aplicação de um item do feed (o tipo faz parte da identidade); `null` = item sem aplicação ("Leitura do dia"). */
function sourceOfEntry(entry: FollowUpEntry): FeedbackSourceRef | null {
  if (entry.source === "delivered") return { kind: "INTERACTION_FEEDBACK_DELIVERY", id: entry.item.id }
  return entry.item.acknowledgedAt !== undefined ? { kind: "PUBLISHED_FEEDBACK", id: entry.item.id } : null
}
const sourceKeyOfEntry = (entry: FollowUpEntry) => {
  const source = sourceOfEntry(entry)
  return source ? feedbackSourceKey(source) : null
}
/** Chave do item na timeline a partir da chave da fonte (o feed usa `history:`/`delivered:`). */
function entryKeyOf(sourceKey: string): string {
  const [kind, id] = [sourceKey.slice(0, sourceKey.indexOf(":")), sourceKey.slice(sourceKey.indexOf(":") + 1)]
  return kind === "INTERACTION_FEEDBACK_DELIVERY" ? `delivered:${id}` : `history:${id}`
}
