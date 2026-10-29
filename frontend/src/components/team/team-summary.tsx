import { AlertCircle, CheckCircle2, CircleDashed, ClipboardCheck, Clock3, TrendingUp, type LucideIcon } from "lucide-react"

import Link from "next/link"

import { formatCount } from "@/lib/analytics/format"
import type { MemberSituation, TeamSummaryCounts } from "@/schemas/analytics/analytics.schema"

import { AnalyticsCard } from "@/components/analytics/analytics-states"
import { cn } from "@/lib/utils"

type SummaryTile = { key: string; icon: LucideIcon; label: string; value: number; hint: string; situation?: MemberSituation; pending?: boolean; href?: string }

/**
 * Resumo da equipe por FATOS (não existe classificação oficial de "esperado"): dentro/abaixo da
 * referência, em evolução, sem dados, feedbacks aguardando ciência do colaborador e revisões que
 * aguardam a decisão do gestor. Cada tile é um atalho: filtro da lista ou destino direto
 * (Pendências). Semântica dos dois últimos:
 * - "Aguardando ciência": feedbacks PUBLICADOS que o próprio colaborador ainda não confirmou ter
 *   lido (ele confirma no Acompanhamento dele). Não é "lido/não lido" do gestor.
 * - "Revisões pendentes": revisões humanas de workflow endereçadas a VOCÊ e ainda sem decisão.
 */
export function TeamSummary({ title, subtitle, summary, onFilterSituation, onFilterPending, activeSituation, pendingActive, pendingActionsHref }: { title: string; subtitle: string; summary: TeamSummaryCounts; onFilterSituation?: (situation: MemberSituation | null) => void; onFilterPending?: (active: boolean) => void; activeSituation?: MemberSituation | null; pendingActive?: boolean; pendingActionsHref?: string }) {
  const tiles: SummaryTile[] = [
    { key: "within", icon: CheckCircle2, label: "Dentro da referência", value: summary.withinReference, hint: "Todos os indicadores com atingimento igual ou acima de 100%", situation: "WITHIN_REFERENCE" },
    { key: "below", icon: AlertCircle, label: "Abaixo da referência", value: summary.belowReference, hint: "Ao menos um indicador abaixo de 100% ou PRV no Q4", situation: "BELOW_REFERENCE" },
    { key: "improving", icon: TrendingUp, label: "Em evolução", value: summary.improving, hint: "Média de atingimento subiu 5 p.p. ou mais vs. período anterior", situation: "IMPROVING" },
    { key: "nodata", icon: CircleDashed, label: "Sem dados", value: summary.noData, hint: "Nenhum dado oficial no período", situation: "NO_DATA" },
    { key: "followups", icon: Clock3, label: "Aguardando ciência do colaborador", value: summary.unacknowledgedFollowUps, hint: "Feedbacks publicados que o colaborador ainda não confirmou ter lido (ele confirma no Acompanhamento dele). Clique para listar quem tem pendência.", pending: true },
    { key: "reviews", icon: ClipboardCheck, label: "Revisões aguardando sua decisão", value: summary.pendingReviews, hint: "Revisões humanas de workflow endereçadas a você e ainda sem decisão. Abre a aba Pendências.", ...(pendingActionsHref ? { href: pendingActionsHref } : {}) },
  ]

  return (
    <AnalyticsCard>
      <div className="flex flex-col gap-1">
        <p className="font-heading text-sm text-muted-foreground">{subtitle}</p>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{formatCount(summary.memberCount, "colaborador", "colaboradores")}</p>
      </div>
      <ul className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Resumo da equipe">
        {tiles.map((tile) => {
          const active = tile.situation ? activeSituation === tile.situation : tile.pending ? pendingActive : false
          const interactive = tile.href ? true : tile.situation ? Boolean(onFilterSituation) : Boolean(onFilterPending)
          const content = (
            <>
              <tile.icon className="size-4 text-muted-foreground" aria-hidden />
              <span className="mt-2 block font-heading text-2xl font-semibold tabular-nums">{tile.value}</span>
              <span className="block text-xs leading-4 text-muted-foreground">{tile.label}</span>
            </>
          )
          return (
            <li key={tile.key}>
              {tile.href ? (
                <Link href={tile.href} title={tile.hint} className="block w-full rounded-xl bg-muted/50 p-3 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  {content}
                </Link>
              ) : interactive ? (
                <button
                  type="button"
                  title={tile.hint}
                  aria-pressed={active}
                  onClick={() => (tile.situation ? onFilterSituation?.(active ? null : tile.situation) : onFilterPending?.(!active))}
                  className={cn("w-full rounded-xl p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", active ? "bg-primary/10 ring-1 ring-primary/40" : "bg-muted/50 hover:bg-muted")}
                >
                  {content}
                </button>
              ) : (
                <div title={tile.hint} className="rounded-xl bg-muted/50 p-3">
                  {content}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </AnalyticsCard>
  )
}
