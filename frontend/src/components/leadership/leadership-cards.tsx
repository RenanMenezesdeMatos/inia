"use client"

import { ChevronDown, Table2 } from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
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
    const titles = cards.map(cardTitle)
    return (
      <Collapsible className={className ?? "mt-2"}>
        <CollapsibleTrigger className="group inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground" data-testid="leadership-cards-trigger">
          <Table2 className="size-3.5" aria-hidden />
          Dados e links: {titles.join(" · ")}
          <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        </CollapsibleTrigger>
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
