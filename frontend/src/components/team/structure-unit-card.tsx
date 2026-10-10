"use client"

import { ChevronRight } from "lucide-react"

import { ReferenceStatusText, referenceStatusFromAchievement } from "@/components/analytics/reference-status"
import { TrendIndicator } from "@/components/analytics/trend-indicator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatCount, formatPercent, initials } from "@/lib/analytics/format"
import { subjectToRef, type SubjectRef } from "@/lib/analytics/subject-params"
import { ROLE_LABELS, type PlatformRole } from "@/schemas/auth/auth.schema"
import type { StructureUnitSummary } from "@/schemas/analytics/analytics.schema"

/** Unidade subordinada (gestor ou grupo) na aba Estrutura — enxuta: quem, quantas pessoas,
 * atingimento, onde precisa atuar. Clique = drill-down. */
export function StructureUnitCard({ unit, onOpen }: { unit: StructureUnitSummary; onOpen: (subject: SubjectRef) => void }) {
  const roleLabel = unit.leader ? (ROLE_LABELS[unit.leader.role as PlatformRole] ?? unit.leader.role) : unit.description
  return (
    <Card className="border-0 bg-card shadow-none ring-0 transition-shadow hover:shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          {unit.leader ? (
            <Avatar className="size-11">
              <AvatarImage src={unit.leader.avatarUrl ?? undefined} alt="" />
              <AvatarFallback>{initials(unit.leader.name)}</AvatarFallback>
            </Avatar>
          ) : null}
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-medium">{unit.label}</h3>
            <p className="truncate text-xs text-muted-foreground">
              {roleLabel} · {formatCount(unit.memberCount, "colaborador", "colaboradores")}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <strong className="block text-lg leading-tight tabular-nums">{formatPercent(unit.consolidatedAchievementPercent)}</strong>
            {unit.consolidatedAchievementPercent === null ? <span className="text-[11px] text-muted-foreground">atingimento</span> : <ReferenceStatusText status={referenceStatusFromAchievement(unit.consolidatedAchievementPercent)} />}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-muted/50 py-2">
            <dd className="font-heading text-base font-semibold tabular-nums">{unit.attentionCount}</dd>
            <dt className="text-muted-foreground">em atenção</dt>
          </div>
          <div className="rounded-lg bg-muted/50 py-2">
            <dd className="font-heading text-base font-semibold tabular-nums">{unit.improvingCount}</dd>
            <dt className="text-muted-foreground">em evolução</dt>
          </div>
          <div className="rounded-lg bg-muted/50 py-2">
            <dd className="font-heading text-base font-semibold tabular-nums">{unit.noDataCount}</dd>
            <dt className="text-muted-foreground">sem dados</dt>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <TrendIndicator trend={unit.trend} deltaPp={unit.deltaPp} />
            {unit.pendingReviews > 0 ? <span>{formatCount(unit.pendingReviews, "revisão pendente", "revisões pendentes")}</span> : null}
            {unit.topAttentionIndicators[0] ? <span>Atenção: {unit.topAttentionIndicators[0].name}</span> : null}
          </div>
          <Button type="button" variant="ghost" size="sm" className="-mr-2 text-primary" onClick={() => onOpen(subjectToRef(unit.subject))} aria-label={`Abrir estrutura de ${unit.label}`}>
            Abrir <ChevronRight />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
