"use client"

import Link from "next/link"
import { ArrowUpDown, ClipboardCheck, Clock3, UserRound } from "lucide-react"

import { AnalyticsEmptyState, AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { TrendIndicator } from "@/components/analytics/trend-indicator"
import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { PersonAvatar } from "@/components/profile/person-avatar"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatPercent } from "@/lib/analytics/format"
import { MEMBER_SITUATION_LABELS, type MemberSituation, type TeamMembersPage, type TeamMemberSummary } from "@/schemas/analytics/analytics.schema"
import type { TeamMembersParams } from "@/services/analytics/analytics-service"
import { cn } from "@/lib/utils"

type Sort = NonNullable<TeamMembersParams["sort"]>
const SORT_LABELS: Record<Sort, string> = { situation: "Situação", name: "Nome", achievement: "Atingimento médio", prv: "PRV", delta: "Variação" }

const SITUATION_CLASS: Record<MemberSituation, string> = {
  WITHIN_REFERENCE: "text-emerald-700 dark:text-emerald-300",
  BELOW_REFERENCE: "text-amber-700 dark:text-amber-300",
  IMPROVING: "text-primary",
  NO_DATA: "text-muted-foreground",
}

/**
 * Lista rica (tabela) dos membros — em vez de dezenas de cards gigantes: uma linha enxuta por
 * pessoa com o que precisa pra decidir onde atuar; o detalhe fica na página do colaborador.
 */
export function TeamMemberTable({
  query,
  sort,
  order,
  onSortChange,
  onOrderToggle,
  onPageChange,
  onPageSizeChange,
  hasActiveFilters,
  onClearFilters,
  employeeHref,
}: {
  query: { data?: TeamMembersPage | undefined; isPending: boolean; isFetching: boolean; isError: boolean; error: unknown; refetch: () => unknown }
  sort: Sort
  order: "asc" | "desc"
  onSortChange: (sort: Sort) => void
  onOrderToggle: () => void
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  hasActiveFilters: boolean
  onClearFilters: () => void
  employeeHref: (personId: string) => string
}) {
  return (
    <section aria-label="Colaboradores" className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <Select value={sort} onValueChange={(value) => onSortChange(value as Sort)}>
          <SelectTrigger className="w-48 bg-card" aria-label="Ordenar por">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as Sort[]).map((option) => (
              <SelectItem key={option} value={option}>
                {SORT_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="icon" className="bg-card" aria-label={order === "asc" ? "Ordem crescente — alternar para decrescente" : "Ordem decrescente — alternar para crescente"} onClick={onOrderToggle}>
          <ArrowUpDown />
        </Button>
      </div>

      {query.isPending ? <TableSkeleton rows={6} /> : null}
      {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? (
        query.data.total === 0 ? (
          <AnalyticsEmptyState
            icon={UserRound}
            title={hasActiveFilters ? "Nenhum colaborador com esses filtros" : "Esta estrutura não possui colaboradores"}
            description={hasActiveFilters ? "Ajuste ou limpe os filtros para ver a equipe completa." : undefined}
            action={hasActiveFilters ? <Button variant="outline" size="sm" onClick={onClearFilters}>Limpar filtros</Button> : undefined}
          />
        ) : (
          <div className={TABLE_FRAME} aria-busy={query.isFetching}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">PRV</TableHead>
                  <TableHead className="text-right">Atingimento<br className="xl:hidden" /> médio</TableHead>
                  <TableHead>Tendência</TableHead>
                  <TableHead className="hidden xl:table-cell">Indicadores em atenção</TableHead>
                  <TableHead>Acompanhamentos e revisões</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Abrir</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((member) => (
                  <MemberRow key={member.personId} member={member} href={employeeHref(member.personId)} />
                ))}
              </TableBody>
            </Table>
            <div className="px-4 pb-3">
              <ListPagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} itemLabel={["colaborador", "colaboradores"]} isFetching={query.isFetching} />
            </div>
          </div>
        )
      ) : null}
      <p className="px-1 text-xs text-muted-foreground">Atingimento médio = média dos atingimentos oficiais dos indicadores do colaborador no período; não é o PRV. Situação e tendência derivam só de dados oficiais.</p>
    </section>
  )
}

function MemberRow({ member, href }: { member: TeamMemberSummary; href: string }) {
  const groupLabel = [member.teamName, member.subteamName].filter(Boolean).join(" · ")
  return (
    <TableRow>
      <TableCell className="max-w-60">
        <div className="flex items-center gap-3">
          <PersonAvatar name={member.name} avatarUrl={member.avatarUrl} alt="" className="size-9" fallbackClassName="text-xs" />
          <div className="min-w-0">
            <Link href={href} className="block truncate font-medium hover:underline">
              {member.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{[member.jobTitle, groupLabel].filter(Boolean).join(" · ") || "Operador"}</p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <span className={cn("text-xs font-medium", SITUATION_CLASS[member.situation])}>{MEMBER_SITUATION_LABELS[member.situation]}</span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatPercent(member.prvAchievementPercent)}
        {member.prvQuartile ? <span className="block text-[11px] text-muted-foreground">{member.prvQuartile}</span> : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatPercent(member.averageAchievementPercent)}
        {member.indicatorsWithData > 0 ? <span className="block text-[11px] text-muted-foreground">{member.indicatorsWithData} indicador{member.indicatorsWithData === 1 ? "" : "es"}</span> : null}
      </TableCell>
      <TableCell>
        <TrendIndicator trend={member.trend} deltaPp={member.deltaPp} compact />
      </TableCell>
      <TableCell className="hidden max-w-56 whitespace-normal xl:table-cell">
        {member.attentionIndicators.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <ul className="space-y-0.5 text-xs">
            {member.attentionIndicators.map((indicator) => (
              <li key={indicator.code}>
                {indicator.name} <span className="text-muted-foreground">({formatPercent(indicator.achievementPercent)})</span>
              </li>
            ))}
            {member.indicatorsBelowTarget > member.attentionIndicators.length ? <li className="text-muted-foreground">+{member.indicatorsBelowTarget - member.attentionIndicators.length}</li> : null}
          </ul>
        )}
      </TableCell>
      <TableCell className="whitespace-normal">
        <ul className="min-w-36 space-y-0.5 text-xs">
          <li className="tabular-nums text-muted-foreground">{member.followUps.total === 1 ? "1 acompanhamento" : `${member.followUps.total} acompanhamentos`}</li>
          {member.followUps.unacknowledged > 0 ? (
            <li>
              <Link href={`${href.split("?")[0]}?tab=followup&ack=pending`} className="inline-flex items-center gap-1 text-amber-700 hover:underline dark:text-amber-300" title="Feedbacks publicados que o colaborador ainda não confirmou ter lido. Abre o Acompanhamento dele filtrado.">
                <Clock3 className="size-3" aria-hidden />
                {member.followUps.unacknowledged} aguardando ciência
              </Link>
            </li>
          ) : null}
          {member.pendingReviews > 0 ? (
            <li>
              <Link href={`/supervisor?tab=pending&operator=${member.personId}`} className="inline-flex items-center gap-1 font-medium text-amber-700 hover:underline dark:text-amber-300" title="Revisões de workflow sobre este colaborador aguardando a sua decisão. Abre Pendências.">
                <ClipboardCheck className="size-3" aria-hidden />
                {member.pendingReviews} {member.pendingReviews === 1 ? "revisão aguarda você" : "revisões aguardam você"}
              </Link>
            </li>
          ) : null}
        </ul>
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="sm" className="text-primary" asChild>
          <Link href={href} aria-label={`Abrir perfil de ${member.name}`}>
            Abrir
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  )
}
