"use client"

import { Building2, Hash, Network, Unlink, UserRound, Users, type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { EntityCard, EntityCardIcon, EntityCardTag } from "@/components/admin/shared/list/entity-card"
import { formatCostByCurrency, formatCount, formatRate, formatTokens } from "@/lib/admin/ai-format"
import { cn } from "@/lib/utils"
import {
  AI_USAGE_RANKING_ENTITY_LABELS,
  unlinkedReasonLabel,
  type AiUsageRanking,
  type AiUsageRankingItem,
  type AiUsageRankingLevel,
  type AiUsageRankingMetrics,
} from "@/schemas/admin/ai-usage-ranking.schema"

import { MoneyList } from "../ai-shared"

/**
 * Corpo do ranking "Quem mais usa": a tabela (com a linha fixa "Sem vínculo" e o total do recorte) e os cards. Mesmos dados
 * nos dois modos; nada é recalculado aqui — participação, totais e motivos vêm prontos do backend.
 */

const LEVEL_ICONS: Record<AiUsageRankingLevel, LucideIcon> = {
  DIRECTOR: Building2,
  SENIOR_MANAGER: Building2,
  MANAGER: Network,
  TEAM: Users,
  SUBTEAM: Users,
  SUPERVISOR: UserRound,
}

const REMOVED_LABEL = "Removido do cadastro"

function secondaryOf(item: AiUsageRankingItem, level: AiUsageRankingLevel): string | null {
  if (level === "TEAM") return null
  if (level === "SUBTEAM") return item.teamName ? `Grupo ${item.teamName}` : null
  // Cargo que já cita o Grupo (comum na base do cliente) não repete o nome.
  if (item.jobTitle && item.teamName && item.jobTitle.includes(item.teamName)) return item.jobTitle
  return [item.jobTitle, item.teamName].filter(Boolean).join(" · ") || null
}

function sourceText(item: AiUsageRankingItem): string {
  const parts = [item.requestsBySource.REQUEST > 0 ? `Pedidos ${formatCount(item.requestsBySource.REQUEST)}` : null, item.requestsBySource.WORKFLOW > 0 ? `Workflow ${formatCount(item.requestsBySource.WORKFLOW)}` : null]
  return parts.filter(Boolean).join(" · ") || "—"
}

function reasonsText(unlinked: AiUsageRanking["unlinked"], level: AiUsageRankingLevel): string {
  if (unlinked.reasons.length === 0) return "Nenhum uso sem vínculo no recorte."
  return unlinked.reasons.map((reason) => `${unlinkedReasonLabel(reason.reason, level)}: ${formatCount(reason.requests)}`).join(" · ")
}

/** Chamadas + tooltip com tentativas e erros (fallback/repetição contam como tentativa, não como chamada). */
function RequestsCell({ metrics }: { metrics: AiUsageRankingMetrics }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default tabular-nums underline decoration-dotted underline-offset-4">{formatCount(metrics.requests)}</span>
      </TooltipTrigger>
      <TooltipContent>
        {formatCount(metrics.attempts)} tentativa(s) · {formatCount(metrics.errors)} com erro
      </TooltipContent>
    </Tooltip>
  )
}

function TokensCell({ metrics }: { metrics: AiUsageRankingMetrics }) {
  return (
    <span className="tabular-nums" title={metrics.tokens === null ? "O provider não informou tokens." : undefined}>
      {formatTokens(metrics.tokens)}
    </span>
  )
}

function CostCell({ metrics }: { metrics: AiUsageRankingMetrics }) {
  return (
    <div className="text-xs">
      <MoneyList costByCurrency={metrics.costByCurrency} />
      {metrics.unknownCostCalls > 0 ? <p className="text-muted-foreground">{formatCount(metrics.unknownCostCalls)} sem preço</p> : null}
    </div>
  )
}

export function RankingTable({ data }: { data: AiUsageRanking }) {
  const level = data.level
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 text-right">#</TableHead>
            <TableHead>{AI_USAGE_RANKING_ENTITY_LABELS[level]}</TableHead>
            <TableHead className="text-right">Chamadas</TableHead>
            <TableHead className="text-right">% do total</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead>Custo</TableHead>
            <TableHead className="text-right">Pessoas</TableHead>
            <TableHead>Origem</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((item) => {
            const secondary = secondaryOf(item, level)
            return (
              <TableRow key={item.key} data-testid={`ranking-row-${item.position}`} className={cn(!item.active && "text-muted-foreground")}>
                <TableCell className="text-right font-medium tabular-nums">{item.position}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{item.name ?? REMOVED_LABEL}</span>
                    {item.active ? null : <Badge variant="outline">Inativo</Badge>}
                  </div>
                  {secondary ? <p className="text-xs text-muted-foreground">{secondary}</p> : null}
                </TableCell>
                <TableCell className="text-right">
                  <RequestsCell metrics={item} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatRate(item.share)}</TableCell>
                <TableCell className="text-right">
                  <TokensCell metrics={item} />
                </TableCell>
                <TableCell>
                  <CostCell metrics={item} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCount(item.people)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{sourceText(item)}</TableCell>
              </TableRow>
            )
          })}
          <TableRow data-testid="ranking-row-unlinked" className="bg-muted/40 hover:bg-muted/40">
            <TableCell className="text-right text-muted-foreground">—</TableCell>
            <TableCell className="whitespace-normal">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Unlink className="size-3.5 text-muted-foreground" aria-hidden /> Sem vínculo
              </span>
              <p className="max-w-md text-xs text-muted-foreground">{reasonsText(data.unlinked, level)}</p>
            </TableCell>
            <TableCell className="text-right">
              <RequestsCell metrics={data.unlinked} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatRate(data.unlinked.share)}</TableCell>
            <TableCell className="text-right">
              <TokensCell metrics={data.unlinked} />
            </TableCell>
            <TableCell>
              <CostCell metrics={data.unlinked} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatCount(data.unlinked.people)}</TableCell>
            <TableCell className="text-xs text-muted-foreground">Nunca atribuído a alguém</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow data-testid="ranking-row-total">
            <TableCell />
            <TableCell className="font-medium">Total do recorte</TableCell>
            <TableCell className="text-right">
              <RequestsCell metrics={data.totals} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatRate(data.totals.share)}</TableCell>
            <TableCell className="text-right">
              <TokensCell metrics={data.totals} />
            </TableCell>
            <TableCell>
              <CostCell metrics={data.totals} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatCount(data.totals.people)}</TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}

export function RankingCard({ item, level }: { item: AiUsageRankingItem; level: AiUsageRankingLevel }) {
  const secondary = secondaryOf(item, level)
  return (
    <EntityCard
      icon={<EntityCardIcon icon={LEVEL_ICONS[level]} />}
      kicker={
        <>
          <span className="font-semibold text-foreground">#{item.position}</span>
          <span aria-hidden>·</span>
          <span>{AI_USAGE_RANKING_ENTITY_LABELS[level]}</span>
          {item.active ? null : (
            <>
              <span aria-hidden>·</span>
              <span>Inativo</span>
            </>
          )}
        </>
      }
      title={item.name ?? REMOVED_LABEL}
      description={`${formatCount(item.requests)} chamada(s) · ${formatRate(item.share)} do total${secondary ? ` · ${secondary}` : ""}`}
      tags={
        <>
          <EntityCardTag icon={Users}>{formatCount(item.people)} pessoa(s)</EntityCardTag>
          <EntityCardTag icon={Hash}>{formatTokens(item.tokens)} tokens</EntityCardTag>
        </>
      }
      footerStart={<span>{sourceText(item)}</span>}
      footerEnd={<span className="text-xs text-muted-foreground">{formatCostByCurrency(item.costByCurrency)}</span>}
      muted={!item.active}
    />
  )
}

export function UnlinkedCard({ unlinked, level }: { unlinked: AiUsageRanking["unlinked"]; level: AiUsageRankingLevel }) {
  return (
    <EntityCard
      icon={<EntityCardIcon icon={Unlink} className="bg-muted text-muted-foreground" />}
      kicker={<span>Fora do ranking · nunca atribuído a alguém</span>}
      title="Sem vínculo"
      description={`${formatCount(unlinked.requests)} chamada(s) · ${formatRate(unlinked.share)} do total — ${reasonsText(unlinked, level)}`}
      footerEnd={<span className="text-xs text-muted-foreground">{formatCostByCurrency(unlinked.costByCurrency)}</span>}
      className="border-dashed"
    />
  )
}

