"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { CalendarDays, ChartNoAxesCombined, ClipboardCheck, MessagesSquare, Network, UsersRound, type LucideIcon } from "lucide-react"

import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ProfileTab } from "@/hooks/use-analytics-url-state"
import { cn } from "@/lib/utils"
import type { IndicatorViewCapabilities } from "@/schemas/analytics/analytics.schema"

export type TabDefinition = { value: ProfileTab; label: string; icon: LucideIcon; badge?: number }

/** Abas do perfil derivadas das capabilities do backend — Operador: 3; Supervisor+: 4 ou 5, com o
 * rótulo "Equipe"/"Estrutura" e a existência de "Pendências" decididos pela política central,
 * não por `if role` aqui. O badge de Pendências é a contagem real de revisões aguardando decisão.
 * "Organograma" (posição na hierarquia, cadeia de liderança — chave interna `structure`) existe para todo papel e recebe
 * esse rótulo — e não "Estrutura" — porque a aba de gestão de Coordenador+ já se chama Estrutura. */
export function profileTabsFor(capabilities: IndicatorViewCapabilities, pendingActionCount = 0): TabDefinition[] {
  const tabs: TabDefinition[] = []
  for (const tab of capabilities.tabs) {
    if (tab === "FOLLOW_UP") tabs.push({ value: "followup", label: "Acompanhamento", icon: MessagesSquare })
    if (tab === "INDICATORS") tabs.push({ value: "indicators", label: "Indicadores", icon: ChartNoAxesCombined })
    if (tab === "PEOPLE") tabs.push({ value: "people", label: capabilities.peopleTabLabel ?? "Equipe", icon: UsersRound })
    if (tab === "CALENDAR") tabs.push({ value: "calendar", label: "Calendário", icon: CalendarDays })
    if (tab === "PENDING") tabs.push({ value: "pending", label: "Pendências", icon: ClipboardCheck, ...(pendingActionCount > 0 ? { badge: pendingActionCount } : {}) })
    if (tab === "STRUCTURE") tabs.push({ value: "structure", label: "Organograma", icon: Network })
  }
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
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="h-full shrink-0 gap-2 whitespace-nowrap rounded-t-md px-3 pb-0 text-[0.9375rem] font-medium hover:bg-muted/60 focus-visible:ring-inset data-[state=active]:font-semibold data-[state=active]:text-primary [&_svg]:size-[18px]"
            >
              <tab.icon aria-hidden />
              <span>{tab.label}</span>
              {tab.badge ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-xs font-semibold tabular-nums text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
                  {tab.badge > 99 ? "99+" : tab.badge}
                  <span className="sr-only"> {tab.badge === 1 ? "pendente" : "pendentes"}</span>
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </div>
  )
}
