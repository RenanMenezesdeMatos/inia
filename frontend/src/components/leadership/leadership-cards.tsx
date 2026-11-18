"use client"

import { ChevronDown, Table2 } from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { LeadershipCard } from "@/schemas/leadership/leadership.schema"

import { LeadershipLinksContext } from "./card-parts"
import { IndicatorAnalysisCard } from "./indicator-analysis-card"
import { PrioritiesDataCard } from "./priorities-list"
import { QueryTableCard } from "./query-table-card"
import { PeopleCard, StructureOverviewCard } from "./structure-overview-card"

function cardTitle(card: LeadershipCard): string {
  switch (card.type) {
    case "INDICATOR_ANALYSIS":
      return card.indicator.name
    case "STRUCTURE_OVERVIEW":
      return "Visão geral"
    case "PEOPLE":
      return card.filter.label
    case "PRIORITIES":
      return "Onde atuar"
    case "QUERY_TABLE":
      return card.title
  }
}

/** Títulos sem repetição, na ordem; o repetido ganha "(n vezes)" — o título pode ter "×" (a mesma consulta pode rodar várias vezes num turno). */
function uniqueTitles(titles: string[]): string[] {
  const counts = new Map<string, number>()
  for (const title of titles) counts.set(title, (counts.get(title) ?? 0) + 1)
  return [...counts].map(([title, count]) => (count > 1 ? `${title} (${count} vezes)` : title))
}

/**
 * Cartões de dados de uma resposta da INIA (ferramentas da liderança), na ordem em que as ferramentas rodaram. No chat a resposta
 * em markdown já traz as tabelas: os cartões ficam RECOLHIDOS ("Dados e links") — números do sistema, método e links para aprofundar.
 */
export function LeadershipCards({ cards, onAsk, className, collapsible = false, readOnly = false }: { cards: LeadershipCard[] | undefined; onAsk?: (question: string) => void; className?: string; collapsible?: boolean; readOnly?: boolean }) {
  if (!cards || cards.length === 0) return null
  if (readOnly) {
    return (
      <LeadershipLinksContext.Provider value={false}>
        <LeadershipCards cards={cards} collapsible={collapsible} {...(className ? { className } : {})} />
      </LeadershipLinksContext.Provider>
    )
  }
  if (collapsible) {
    // A pílula fica curta (as consultas podem ser muitas e repetidas); o que tem dentro aparece no tooltip, sem repetição.
    const titles = uniqueTitles(cards.map(cardTitle))
    const summary = cards.length === 1 ? "1 consulta" : `${cards.length} consultas`
    return (
      <Collapsible className={className ?? "mt-2"}>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <CollapsibleTrigger className="group inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground" aria-label={`Dados e links — ${summary}: ${titles.join("; ")}`} data-testid="leadership-cards-trigger">
                <Table2 className="size-3.5" aria-hidden />
                Dados e links · {summary}
                <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
              </CollapsibleTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" className="max-w-80" data-testid="leadership-cards-tooltip">
              <ul className="space-y-0.5">
                {titles.map((title) => <li key={title}>{title}</li>)}
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <CollapsibleContent>
          <LeadershipCards cards={cards} {...(onAsk ? { onAsk } : {})} />
        </CollapsibleContent>
      </Collapsible>
    )
  }
  return (
    <div className={className ?? "mt-2 space-y-2"} data-testid="leadership-cards">
      {cards.map((card, index) => {
        const key = `${card.type}-${card.generatedAt}-${index}`
        switch (card.type) {
          case "INDICATOR_ANALYSIS":
            return <IndicatorAnalysisCard key={key} card={card} />
          case "STRUCTURE_OVERVIEW":
            return <StructureOverviewCard key={key} card={card} />
          case "PEOPLE":
            return <PeopleCard key={key} card={card} />
          case "PRIORITIES":
            return <PrioritiesDataCard key={key} card={card} {...(onAsk ? { onAsk } : {})} />
          case "QUERY_TABLE":
            return <QueryTableCard key={key} card={card} />
        }
      })}
    </div>
  )
}
