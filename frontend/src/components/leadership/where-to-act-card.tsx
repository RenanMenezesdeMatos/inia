"use client"

import { Target } from "lucide-react"
import { useState } from "react"

import { useFeedbackWorkspace } from "@/components/operator/feedback-application/feedback-workspace-context"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useLeadershipHomeQuery } from "@/queries/leadership/use-leadership-home"

import { Limitations, Methods } from "./card-parts"
import { PriorityItems } from "./priorities-list"

const INITIAL_ITEMS = 4

/**
 * "Onde atuar hoje" no topo do Acompanhamento de quem lidera: decisões que aguardam a pessoa e os maiores desvios da estrutura,
 * cada um com a evidência e o link para a tela que resolve. Determinístico (sem IA) — o mesmo cálculo que a INIA usa no chat;
 * "Perguntar à INIA" leva a pergunta ao painel ao lado, só no clique.
 */
export function WhereToActCard() {
  const home = useLeadershipHomeQuery()
  const workspace = useFeedbackWorkspace()
  const [expanded, setExpanded] = useState(false)

  if (home.isPending) {
    return (
      <div className="space-y-2 py-3" aria-label="Carregando onde atuar hoje">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
    )
  }
  if (home.isError) {
    return (
      <div className="flex items-center justify-between gap-2 py-3 text-sm text-muted-foreground" role="alert">
        Não foi possível carregar onde atuar hoje.
        <Button type="button" size="sm" variant="outline" onClick={() => void home.refetch()}>
          Tentar novamente
        </Button>
      </div>
    )
  }
  const priorities = home.data.enabled ? home.data.priorities : null
  if (!priorities) return null
  const items = expanded ? priorities.items : priorities.items.slice(0, INITIAL_ITEMS)
  const hidden = priorities.items.length - items.length
  const scope = priorities.structure ? `${priorities.structure.label}${priorities.periodLabel ? ` · ${priorities.periodLabel}` : ""}` : "Suas decisões pendentes"
  return (
    <section aria-labelledby="where-to-act-title" className="my-3 space-y-3 rounded-xl bg-muted/50 p-3 sm:p-4" data-testid="where-to-act">
      <header className="flex items-start gap-2">
        <Target className="mt-0.5 size-4 shrink-0 text-primary dark:text-chart-4" aria-hidden />
        <div className="min-w-0">
          <h2 id="where-to-act-title" className="text-sm font-semibold">
            Onde atuar hoje
          </h2>
          <p className="text-xs text-muted-foreground">{scope}</p>
        </div>
      </header>
      <PriorityItems items={items} {...(workspace?.askInia ? { onAsk: workspace.askInia } : {})} />
      {hidden > 0 ? (
        <Button type="button" variant="ghost" size="sm" className="h-auto px-0 text-xs" onClick={() => setExpanded(true)}>
          Mostrar mais {hidden}
        </Button>
      ) : null}
      <Limitations items={priorities.limitations} />
      <Methods items={[priorities.method]} />
    </section>
  )
}
