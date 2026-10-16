"use client"

import { AlertCircle, CircleDot, Info, MessageCircleQuestion } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PrioritiesCard, PriorityItem } from "@/schemas/leadership/leadership.schema"

import { CardAnchor, DataCard, Limitations, Methods } from "./card-parts"
import { PRIORITY_ACTION_LABELS, priorityHref } from "./leadership-links"

const SEVERITY = {
  HIGH: { icon: AlertCircle, label: "Prioridade alta", className: "text-red-700 dark:text-red-300" },
  MEDIUM: { icon: CircleDot, label: "Prioridade média", className: "text-amber-700 dark:text-amber-300" },
  LOW: { icon: Info, label: "Para acompanhar", className: "text-muted-foreground" },
} as const

/**
 * Lista "Onde atuar hoje" — a mesma no cartão do Acompanhamento e na resposta do chat. Cada item: evidência numérica, link para a
 * tela que resolve e, quando faz sentido, a pergunta para aprofundar com a INIA (nada é enviado sozinho).
 */
export function PriorityItems({ items, onAsk, disabled }: { items: PriorityItem[]; onAsk?: (question: string) => void; disabled?: boolean }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma decisão pendente e nenhum desvio em destaque na competência.</p>
  return (
    <ol className="space-y-2">
      {items.map((item, index) => {
        const severity = SEVERITY[item.severity]
        const Icon = severity.icon
        return (
          <li key={`${item.kind}-${index}`} className="flex gap-2.5 rounded-lg bg-muted/50 px-3 py-2">
            <Icon className={cn("mt-0.5 size-4 shrink-0", severity.className)} aria-label={severity.label} role="img" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium leading-snug">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.evidence}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <CardAnchor action href={priorityHref(item.target)} className="text-xs font-medium text-primary hover:underline dark:text-chart-4">
                  {PRIORITY_ACTION_LABELS[item.target.kind]}
                </CardAnchor>
                {item.question && onAsk ? (
                  <Button type="button" variant="ghost" size="xs" className="h-auto px-0 py-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground" disabled={disabled} onClick={() => onAsk(item.question!)}>
                    <MessageCircleQuestion aria-hidden />
                    Perguntar à INIA
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function PrioritiesDataCard({ card, onAsk }: { card: PrioritiesCard; onAsk?: (question: string) => void }) {
  return (
    <DataCard label="Onde atuar" title="Onde atuar" scope={card.structure ? `${card.structure.label}${card.structure.description ? ` · ${card.structure.description}` : ""}` : "Suas decisões pendentes"} period={card.periodLabel}>
      <PriorityItems items={card.items} {...(onAsk ? { onAsk } : {})} />
      <Limitations items={card.limitations} />
      <Methods items={[card.method]} />
    </DataCard>
  )
}
