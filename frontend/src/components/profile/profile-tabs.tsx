"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { CalendarClock, CalendarDays, ChartNoAxesCombined, ClipboardCheck, HeartHandshake, Headset, MessagesSquare, Network, UsersRound, type LucideIcon } from "lucide-react"

import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { presenceIcon } from "@/components/human-support/anjo/presence-icons"
import { PAUSE_REASON_LABELS, PRESENCE_STATUS_LABELS, type PauseReason, type PresenceStatus } from "@/schemas/human-support/catalogs.schema"
import type { ProfileTab } from "@/hooks/use-analytics-url-state"
import { cn } from "@/lib/utils"
import type { IndicatorViewCapabilities } from "@/schemas/analytics/analytics.schema"

/**
 * `badgeLabel` = o que o número significa para leitor de tela; `badgeTone` = cor do número; `dot` = algo pede atenção, sem número;
 * `status` = selo colorido com ícone ao lado do nome (o estado do Anjo na aba "Apoio"); `tooltip` = dica ao passar o mouse ou focar.
 */
export type TabDefinition = {
  value: ProfileTab
  label: string
  icon: LucideIcon
  badge?: number
  badgeLabel?: (count: number) => string
  badgeTone?: "pending" | "attention"
  dot?: string
  status?: { key: AnjoTabStatus; icon: LucideIcon; text: string }
  tooltip?: string
}

/**
 * O que a aba "Apoio" do Anjo sinaliza: o ESTADO dele (Disponível, Em atendimento, Em pausa com motivo, Indisponível — null enquanto não
 * foi lido), mensagens novas do operador (número) e atendimento sem resposta (ponto). `attendances` = atendimentos em andamento.
 */
export type AnjoTabSignal = {
  unread: number
  awaitingResponse: boolean
  attendances?: number
  presence?: { status: PresenceStatus; pauseReason: PauseReason | null; scheduled?: { status: "PAUSED" | "OFFLINE"; pauseReason: PauseReason | null } | null } | null
}

/**
 * Estado mostrado na aba "Apoio". "Em atendimento" = Disponível com atendimento em andamento — a mesma regra do painel "Situação dos
 * Anjos agora" (`anjo-now.ts`): em pausa, o Anjo continua "Em pausa", com os atendimentos abertos contados à parte.
 */
export type AnjoTabStatus = "AVAILABLE" | "IN_ATTENDANCE" | "PAUSED" | "OFFLINE"

/**
 * Cor do nome, do ícone e do selo da aba pelo estado do Anjo — verde (Disponível), azul (Em atendimento), amarelo (Em pausa), vermelho
 * (Indisponível) —, também com a aba aberta (o sublinhado continua marcando a ativa). No claro, tons escuros de cada cor para o texto
 * continuar legível sobre o branco (o amarelo claro quase some); no escuro, os tons claros. O azul fica longe do roxo da marca.
 */
const STATUS_STYLE: Record<AnjoTabStatus, { text: string; chip: string }> = {
  AVAILABLE: {
    text: "text-emerald-700 data-[state=active]:text-emerald-700 dark:text-emerald-400 dark:data-[state=active]:text-emerald-400",
    chip: "bg-emerald-50 text-emerald-800 ring-emerald-700/15 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-400/25",
  },
  IN_ATTENDANCE: {
    text: "text-sky-700 data-[state=active]:text-sky-700 dark:text-sky-400 dark:data-[state=active]:text-sky-400",
    chip: "bg-sky-50 text-sky-800 ring-sky-700/15 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-400/25",
  },
  PAUSED: {
    text: "text-yellow-700 data-[state=active]:text-yellow-700 dark:text-yellow-400 dark:data-[state=active]:text-yellow-400",
    chip: "bg-yellow-50 text-yellow-800 ring-yellow-700/20 dark:bg-yellow-500/15 dark:text-yellow-200 dark:ring-yellow-400/25",
  },
  OFFLINE: {
    text: "text-red-700 data-[state=active]:text-red-700 dark:text-red-400 dark:data-[state=active]:text-red-400",
    chip: "bg-red-50 text-red-800 ring-red-700/15 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-400/25",
  },
}

/** Estado, ícone, texto e dica da aba "Apoio" (o que ele está e o que pode fazer). */
export function anjoStatusOf(presence: NonNullable<AnjoTabSignal["presence"]>, attendances = 0): { key: AnjoTabStatus; icon: LucideIcon; text: string; tooltip: string } {
  const key: AnjoTabStatus = presence.status === "AVAILABLE" && attendances > 0 ? "IN_ATTENDANCE" : presence.status
  const text =
    key === "IN_ATTENDANCE" ? "Em atendimento" : presence.status === "PAUSED" && presence.pauseReason ? `${PRESENCE_STATUS_LABELS.PAUSED} · ${PAUSE_REASON_LABELS[presence.pauseReason]}` : PRESENCE_STATUS_LABELS[presence.status]
  const scheduled = presence.scheduled
    ? ` Programado para depois dos atendimentos: ${presence.scheduled.status === "PAUSED" && presence.scheduled.pauseReason ? `pausa (${PAUSE_REASON_LABELS[presence.scheduled.pauseReason]})` : "indisponível"}.`
    : ""
  const counted = attendances === 1 ? "1 atendimento em andamento" : `${attendances} atendimentos em andamento`
  const next =
    key === "IN_ATTENDANCE"
      ? ` ${counted}.${presence.scheduled ? " Você não recebe novos atendimentos." : " Novos chegam enquanto houver vaga."}`
      : key === "AVAILABLE"
        ? " Você recebe novos atendimentos."
        : key === "PAUSED"
          ? ` Você não recebe novos atendimentos.${attendances > 0 ? ` ${counted}.` : ""}`
          : " Abra a aba para ficar disponível."
  const icon = key === "IN_ATTENDANCE" ? Headset : presenceIcon(presence.status, presence.pauseReason)
  return { key, icon, text, tooltip: `Apoio com Anjo: você está ${text}.${next}${scheduled}` }
}

/** Abas do perfil derivadas das capabilities do backend — Operador: 3; Supervisor+: 4 ou 5, com o
 * rótulo "Equipe"/"Estrutura" e a existência de "Pendências" decididos pela política central,
 * não por `if role` aqui. O badge de Pendências é a contagem real de revisões aguardando decisão.
 * "Organograma" (posição na hierarquia, cadeia de liderança — chave interna `structure`) existe para todo papel e recebe
 * esse rótulo — e não "Estrutura" — porque a aba de gestão de Coordenador+ já se chama Estrutura. */
export function profileTabsFor(capabilities: IndicatorViewCapabilities, pendingActionCount = 0, anjo: AnjoTabSignal | null = null): TabDefinition[] {
  const tabs: TabDefinition[] = []
  // "Apoio" (área do Anjo) só para quem tem o papel Anjo (`canAttendHumanSupport`, do backend), sempre a última aba.
  const status = anjo?.presence ? anjoStatusOf(anjo.presence, anjo.attendances ?? 0) : null
  const apoio: TabDefinition | null = anjo
    ? {
        value: "apoio",
        label: "Apoio",
        icon: HeartHandshake,
        ...(status ? { status: { key: status.key, icon: status.icon, text: status.text }, tooltip: status.tooltip } : {}),
        ...(anjo.unread > 0 ? { badge: anjo.unread, badgeTone: "attention" as const, badgeLabel: (count: number) => (count === 1 ? "mensagem nova" : "mensagens novas") } : {}),
        ...(anjo.unread === 0 && anjo.awaitingResponse ? { dot: "atendimento sem resposta" } : {}),
      }
    : null
  for (const tab of capabilities.tabs) {
    if (tab === "FOLLOW_UP") tabs.push({ value: "followup", label: "Acompanhamento", icon: MessagesSquare })
    if (tab === "JOURNEY") tabs.push({ value: "journey", label: "Minha jornada", icon: CalendarClock })
    if (tab === "INDICATORS") tabs.push({ value: "indicators", label: "Indicadores", icon: ChartNoAxesCombined })
    if (tab === "PEOPLE") tabs.push({ value: "people", label: capabilities.peopleTabLabel ?? "Equipe", icon: UsersRound })
    if (tab === "CALENDAR") tabs.push({ value: "calendar", label: "Calendário", icon: CalendarDays })
    if (tab === "PENDING") tabs.push({ value: "pending", label: "Pendências", icon: ClipboardCheck, ...(pendingActionCount > 0 ? { badge: pendingActionCount } : {}) })
    if (tab === "STRUCTURE") tabs.push({ value: "structure", label: "Organograma", icon: Network })
  }
  if (apoio) tabs.push(apoio)
  return tabs
}

/** Altura do cabeçalho global (56 px): a faixa de abas fica fixa logo abaixo dele. */
const GLOBAL_HEADER_OFFSET = "top-14"

/**
 * Faixa de abas do PERFIL — encaixada na base do card (`ProfileHeader attached`), fixa abaixo do cabeçalho global ao rolar.
 * Usa o `TabsList` compartilhado e o sublinhado ÚNICO dele (nenhum indicador próprio aqui); ícone e texto na mesma linha,
 * cada aba do tamanho do conteúdo. Sem espaço, a faixa rola na horizontal (nunca quebra linha nem vira só ícone), com um
 * esmaecimento indicando o que ficou fora — e a aba ativa sempre inteira à vista, inclusive ao abrir um link direto.
 */
export function ProfileTabsList({ tabs, active }: { tabs: TabDefinition[]; active: ProfileTab }) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ start: false, end: false })

  const measure = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const start = scroller.scrollLeft > 1
    const end = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1
    setOverflow((current) => (current.start === start && current.end === end ? current : { start, end }))
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    scroller.addEventListener("scroll", measure, { passive: true })
    return () => {
      observer.disconnect()
      scroller.removeEventListener("scroll", measure)
    }
  }, [measure])

  // Aba ativa inteira à vista (só rolagem HORIZONTAL da faixa — nunca mexe na rolagem da página).
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const trigger = scroller?.querySelector<HTMLElement>('[data-slot="tabs-trigger"][data-state="active"]')
    if (!scroller || !trigger) return
    const margin = 24
    const left = trigger.offsetLeft - margin
    const right = trigger.offsetLeft + trigger.offsetWidth + margin
    if (left < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, left)
    else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = right - scroller.clientWidth
    measure()
  }, [active, tabs.length, measure])

  const fade = overflow.start && overflow.end
    ? "linear-gradient(to right, transparent, black 2rem, black calc(100% - 2.5rem), transparent)"
    : overflow.end
      ? "linear-gradient(to right, black calc(100% - 2.5rem), transparent)"
      : overflow.start
        ? "linear-gradient(to right, transparent, black 2rem)"
        : undefined

  return (
    <div className={cn("sticky z-20 rounded-b-xl border-t border-border/60 bg-card", GLOBAL_HEADER_OFFSET)}>
      <div ref={scrollerRef} className="overflow-x-auto overscroll-x-contain px-2 [scrollbar-width:none] sm:px-4 [&::-webkit-scrollbar]:hidden" style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}>
        <TabsList aria-label="Seções do perfil" className="flex h-12 w-max min-w-full justify-start gap-1 border-b-0">
          {tabs.map((tab) => {
            const trigger = (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className={cn(
                  "h-full shrink-0 gap-2 whitespace-nowrap rounded-t-md px-3 pb-0 text-[0.9375rem] font-medium hover:bg-muted/60 focus-visible:ring-inset data-[state=active]:font-semibold data-[state=active]:text-primary [&_svg]:size-[18px]",
                  tab.status ? STATUS_STYLE[tab.status.key].text : null,
                )}
                data-status={tab.status?.key}
              >
                <tab.icon aria-hidden />
                <span>{tab.label}</span>
                {tab.status ? (
                  <span className={cn("inline-flex size-5 items-center justify-center rounded-full ring-1 ring-inset", STATUS_STYLE[tab.status.key].chip)} data-testid={`profile-tab-status-${tab.value}`}>
                    <tab.status.icon className="size-3!" aria-hidden />
                    <span className="sr-only">: {tab.status.text}</span>
                  </span>
                ) : null}
                {tab.badge ? (
                  <span
                    className={cn(
                      "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
                      tab.badgeTone === "attention" ? "bg-primary text-primary-foreground" : "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
                    )}
                    data-testid={`profile-tab-badge-${tab.value}`}
                  >
                    {tab.badge > 99 ? "99+" : tab.badge}
                    <span className="sr-only"> {tab.badgeLabel ? tab.badgeLabel(tab.badge) : tab.badge === 1 ? "pendente" : "pendentes"}</span>
                  </span>
                ) : null}
                {tab.dot ? (
                  <>
                    <span className="size-2 rounded-full bg-primary" aria-hidden data-testid={`profile-tab-dot-${tab.value}`} />
                    <span className="sr-only">: {tab.dot}</span>
                  </>
                ) : null}
              </TabsTrigger>
            )
            return tab.tooltip ? (
              <Tooltip key={tab.value}>
                {/* O gatilho da dica grava o próprio `data-state` (aberta/fechada): num invólucro, para não apagar o "active" da aba. */}
                <TooltipTrigger asChild>
                  <span className="inline-flex h-full shrink-0">{trigger}</span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="inia-tooltip-genie max-w-72 text-center">{tab.tooltip}</TooltipContent>
              </Tooltip>
            ) : (
              trigger
            )
          })}
        </TabsList>
      </div>
    </div>
  )
}
