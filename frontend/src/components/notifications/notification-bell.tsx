"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Bell, CalendarDays, CalendarX2, CheckCheck, ClipboardCheck, Info, ListChecks, MessageSquareWarning, Send, Sparkles, type LucideIcon } from "lucide-react"

import { FEEDBACK_CONTESTATIONS_PATH } from "@/components/admin/feedback-contestations/feedback-contestations-route"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { formatShortDateTime } from "@/lib/format/date"
import { interventionHref } from "@/lib/interventions/intervention-href"
import { cn } from "@/lib/utils"
import { useMarkAllNotificationsReadMutation, useMarkNotificationReadMutation, useNotificationsQuery } from "@/queries/notifications/use-notifications"
import { NOTIFICATION_KIND_LABELS, type NotificationItem, type NotificationTarget } from "@/schemas/notifications/notifications.schema"

const KIND_ICONS: Record<NotificationItem["kind"], LucideIcon> = { HUMAN_REVIEW: ClipboardCheck, WORKFLOW_OUTPUT: Send, INIA_MESSAGE: Sparkles, ESCALATION: AlertTriangle, WORKDAY_RECONCILIATION: CalendarX2, CALENDAR_NOTICE: CalendarDays, INTERVENTION: ListChecks, FEEDBACK_CONTESTATION: MessageSquareWarning, OTHER: Info }

/** Destino de cada notificação — o backend diz O QUE abrir (revisão, pendência de produção, item do
 * Acompanhamento, Calendário da equipe, Calendário operacional); aqui só vira rota. `profileHref` é a
 * página de perfil do papel (Operador → /operator; demais → /supervisor). */
export function notificationHref(target: NotificationTarget, profileHref: string): string | null {
  switch (target.type) {
    case "PENDING_ACTION":
      return `${profileHref}?tab=pending&review=${encodeURIComponent(target.actionId)}`
    case "FOLLOW_UP":
      return `${profileHref}?tab=followup&item=${encodeURIComponent(target.itemId)}`
    case "TEAM_CALENDAR":
      return `${profileHref}?tab=calendar${target.date ? `&calendarDate=${encodeURIComponent(target.date)}` : ""}${target.operatorId ? `&calendarPerson=${encodeURIComponent(target.operatorId)}` : ""}`
    case "ADMIN_DATA_HUB":
      return "/admin/data-hub"
    case "ADMIN_CALENDAR":
      return "/admin/operational-calendar"
    case "ADMIN_AI_USAGE":
      return "/admin/ai"
    // Workflow Outputs V1 — o painel da INIA fica no Acompanhamento do próprio perfil: abre a conversa / destaca o convite.
    case "INIA_CONVERSATION":
      return `${profileHref}?tab=followup&iniaConversation=${encodeURIComponent(target.conversationId)}`
    case "INIA_AVATAR_DELIVERY":
      return `${profileHref}?tab=followup&iniaDelivery=${encodeURIComponent(target.deliveryId)}`
    case "INTERVENTION":
      return interventionHref(target.caseId, target.interventionId)
    case "ADMIN_FEEDBACK_CONTESTATION":
      return `${FEEDBACK_CONTESTATIONS_PATH}?contestation=${encodeURIComponent(target.contestationId)}`
    case "NONE":
      return null
  }
}

/**
 * SINO = "algo novo aconteceu": alertas reais endereçados ao viewer (revisões, resultados de
 * workflow, escalonamentos). Badge = não lidos. Ler ≠ resolver: abrir uma notificação só marca
 * como lida e leva ao contexto certo — a decisão de uma revisão acontece em Pendências.
 */
export function NotificationBell({ profileHref }: { profileHref: string }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const query = useNotificationsQuery()
  const unread = query.data?.unreadCount ?? 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" size="icon" className="relative h-10 w-10 rounded-full border border-topbar-foreground/25 bg-topbar-foreground/10 text-topbar-foreground hover:bg-topbar-foreground/20 focus-visible:ring-topbar-foreground/60" data-usage-element="notifications.bell" aria-label={unread > 0 ? `Notificações: ${unread} não lidas` : "Notificações"}>
          <Bell className="h-5 w-5" aria-hidden />
          {unread > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white" aria-hidden>
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="flex max-h-[min(36rem,80vh)] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border-border/70 p-0 shadow-xl" data-usage-screen="notifications.panel">
        <NotificationPanel
          profileHref={profileHref}
          onNavigate={(href) => {
            setOpen(false)
            router.push(href)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/** Conteúdo do sino (também testável fora do Popover): cabeçalho, atalho para Pendências e lista.
 * Abrir um item = marcar como lido + navegar; nunca decide nada. */
export function NotificationPanel({ profileHref, onNavigate }: { profileHref: string; onNavigate: (href: string) => void }) {
  const query = useNotificationsQuery()
  const markRead = useMarkNotificationReadMutation()
  const markAll = useMarkAllNotificationsReadMutation()
  const unread = query.data?.unreadCount ?? 0
  const pendingActions = query.data?.pendingActionCount ?? 0

  function openItem(item: NotificationItem) {
    if (item.readAt === null) markRead.mutate(item.id)
    const href = notificationHref(item.target, profileHref)
    if (href) onNavigate(href)
  }

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Notificações</p>
          <p className="text-xs text-muted-foreground">Revisões, resultados de workflow e escalonamentos endereçados a você</p>
        </div>
        {unread > 0 ? (
          <Button variant="ghost" size="xs" disabled={markAll.isPending} onClick={() => markAll.mutate()} aria-label="Marcar todas como lidas" data-usage-element="notifications.mark_all_read">
            <CheckCheck aria-hidden />
            Lidas
          </Button>
        ) : null}
      </div>

      {pendingActions > 0 ? (
        <button type="button" onClick={() => onNavigate(`${profileHref}?tab=pending`)} className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-amber-50 px-4 py-2 text-left text-xs font-medium text-amber-800 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-200 dark:hover:bg-amber-950">
          <ClipboardCheck className="size-3.5" aria-hidden />
          {pendingActions === 1 ? "1 pendência aguarda você" : `${pendingActions} pendências aguardam você`} · abrir Pendências
        </button>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <div className="space-y-2 p-3" aria-hidden>
            {[0, 1, 2].map((index) => <Skeleton key={index} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : null}
        {query.isError ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Não foi possível carregar as notificações.</p> : null}
        {query.data && query.data.items.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma notificação por enquanto.</p> : null}
        {query.data && query.data.items.length > 0 ? (
          <ul className="space-y-1.5 p-2">
            {query.data.items.map((item) => (
              <NotificationRow key={item.id} item={item} onOpen={() => openItem(item)} />
            ))}
          </ul>
        ) : null}
      </div>
    </>
  )
}

function NotificationRow({ item, onOpen }: { item: NotificationItem; onOpen: () => void }) {
  const Icon = KIND_ICONS[item.kind]
  const unread = item.readAt === null
  const kindLabel = item.kind === "HUMAN_REVIEW" && !item.actionable ? (item.resolved ? "Revisão concluída" : "Revisão") : NOTIFICATION_KIND_LABELS[item.kind]
  return (
    <li>
      <button type="button" onClick={onOpen} data-usage-element="notifications.item" data-usage-expose="notifications.item" data-usage-entity-type="ALERT" data-usage-entity-id={item.id} className={cn("flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", !unread && "opacity-80")}>
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", item.severity === "HIGH" || item.severity === "CRITICAL" ? "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : "bg-primary/10 text-primary")}>
          <Icon className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{kindLabel}</span>
            {unread ? <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Não lida" /> : null}
          </span>
          <span className="block truncate text-sm font-medium">{item.operator?.name ?? item.title}</span>
          <span className="line-clamp-2 block text-xs leading-5 text-muted-foreground break-words">{item.operator ? item.title : item.description}</span>
          <span className="mt-1 block text-[11px] text-muted-foreground">{formatShortDateTime(item.createdAt, { withWeekday: true })}</span>
        </span>
      </button>
    </li>
  )
}
