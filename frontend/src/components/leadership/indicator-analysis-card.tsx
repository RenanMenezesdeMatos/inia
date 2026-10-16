"use client"


import { QuartileDistributionBar } from "@/components/analytics/quartile-distribution"
import { Badge } from "@/components/ui/badge"
import { formatIndicatorValue, formatPercent, formatPp } from "@/lib/analytics/format"
import { cn } from "@/lib/utils"
import type { AnalysisMember, IndicatorAnalysisCard as Card } from "@/schemas/leadership/leadership.schema"

import { CardAnchor, CardLink, DataCard, Limitations, Methods, Stat } from "./card-parts"
import { indicatorHref, personHref } from "./leadership-links"

const PATTERN_LABELS = { CONCENTRATED: "Concentrado", DISSEMINATED: "Disseminado", MIXED: "Misto", NONE: "Sem desvio", UNDETERMINED: "Indeterminado" } as const
const DIRECTION_LABELS = { HIGHER: "maior é melhor", LOWER: "menor é melhor", TARGET: "na meta é melhor" } as const

/** Um indicador numa estrutura: % fora com a base, distribuição (quartis oficiais e decis), unidades e as pontas do ranking. */
export function IndicatorAnalysisCard({ card }: { card: Card }) {
  const { indicator, population, reference, previous } = card
  // Destaque só quando há "onde": desvio concentrado ou misto. Disseminado não tem unidade a destacar.
  const pattern = card.concentration?.pattern
  const focus = new Set(pattern === "CONCENTRATED" || pattern === "MIXED" ? card.concentration!.focusKeys : [])
  return (
    <DataCard label={`Análise de ${indicator.name}`} title={`${indicator.name} — dentro e fora da referência`} scope={`${card.structure.label}${card.structure.description ? ` · ${card.structure.description}` : ""}`} period={card.periodLabel}>
      <div className="grid grid-cols-2 gap-2">
        <Stat value={formatPercent(reference.belowPercent)} label="fora da referência" base={`${reference.below} de ${population.withReference} com referência`} tone={reference.below > 0 ? "attention" : "positive"} />
        <Stat value={formatPercent(card.averageAchievementPercent)} label="atingimento médio" base="média simples dos atingimentos" />
      </div>
      <p className="text-xs text-muted-foreground">
        {population.noData > 0 ? `${population.noData} sem dado (fora do denominador). ` : ""}
        {previous.belowPercent !== null ? `Em ${previous.periodLabel}: ${formatPercent(previous.belowPercent)} fora (${formatPp(previous.deltaPp)}). ` : ""}
        {DIRECTION_LABELS[indicator.direction]}.
      </p>

      {population.withReference > 0 ? <QuartileDistributionBar distribution={card.officialQuartiles} title="Quartis oficiais" /> : null}
      {card.deciles.reason === "OK" ? <DecileBars counts={card.deciles.counts} /> : null}

      {card.units.length > 0 ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">Por {card.unitsGroupByLabel?.toLowerCase() ?? "unidade"}</p>
            {card.concentration ? <Badge variant="outline">{PATTERN_LABELS[card.concentration.pattern]}</Badge> : null}
          </div>
          {card.concentration ? <p className="text-xs text-muted-foreground">{card.concentration.explanation}</p> : null}
          <ul className="divide-y rounded-lg border">
            {card.units.map((unit) => (
              <li key={unit.key} className={cn("flex items-center gap-2 px-2.5 py-1.5 text-xs", focus.has(unit.key) && "bg-amber-50/70 dark:bg-amber-950/40")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{unit.label}</p>
                  <p className="text-muted-foreground">
                    {unit.description ?? ""}
                    {unit.comparable ? "" : <span title={unit.comparabilityReasons.join("; ")}> · não comparável</span>}
                  </p>
                </div>
                <div className="text-right tabular-nums">
                  <p className="font-medium">
                    {unit.below} de {unit.withReference} · {formatPercent(unit.belowPercent)}
                  </p>
                  <p className="text-muted-foreground">{formatPercent(unit.shareOfDeviationsPercent)} dos fora</p>
                </div>
                {unit.subject ? (
                  <CardAnchor action href={indicatorHref(unit.subject, card.period, indicator.code)} className="shrink-0 font-medium text-primary hover:underline dark:text-chart-4" label={`Abrir ${unit.label} em ${indicator.name}`}>
                    Abrir
                  </CardAnchor>
                ) : null}
              </li>
            ))}
          </ul>
          {card.comparison.note ? <p className="text-xs text-muted-foreground">{card.comparison.note}</p> : null}
        </div>
      ) : null}

      {card.ranking.reason === "OK" ? (
        <div className="grid gap-3 @lg:grid-cols-2">
          {card.ranking.worst.length > 0 ? <RankingList title="Menores atingimentos" members={card.ranking.worst} unit={indicator.unit} period={card.period} /> : null}
          <RankingList title="Maiores atingimentos" members={card.ranking.best} unit={indicator.unit} period={card.period} />
        </div>
      ) : null}

      <Limitations items={card.limitations} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Methods items={card.methods} />
        <CardLink href={indicatorHref(card.structure.subject, card.period, indicator.code)}>Ver todas as pessoas</CardLink>
      </div>
    </DataCard>
  )
}

function RankingList({ title, members, unit, period }: { title: string; members: AnalysisMember[]; unit: string; period: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium">{title}</p>
      <ol className="space-y-1 text-xs">
        {members.map((member) => (
          <li key={member.personId} className="flex items-baseline gap-1.5">
            <span className="w-7 shrink-0 text-right tabular-nums text-muted-foreground">{member.position}º</span>
            <CardAnchor href={personHref(member.personId, period)} className="min-w-0 flex-1 truncate hover:underline">
              {member.name}
            </CardAnchor>
            <span className="tabular-nums" title={`Valor ${formatIndicatorValue(member.value, unit)}${member.targetValue !== null ? ` · meta ${formatIndicatorValue(member.targetValue, unit)}` : ""}`}>
              {formatPercent(member.achievementPercent)}
            </span>
            {member.decile ? <span className="text-muted-foreground">{member.decile}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Decis da estrutura (D1 = melhores 10%) — barras com a contagem escrita, legível sem depender de cor. */
function DecileBars({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts)
  const max = Math.max(1, ...entries.map(([, count]) => count))
  return (
    <div>
      <p className="text-sm font-medium">Decis na estrutura</p>
      <p className="text-xs text-muted-foreground">D1 = melhores 10% desta estrutura.</p>
      <div className="mt-2 flex h-16 items-end gap-1" role="img" aria-label={entries.map(([decile, count]) => `${decile}: ${count}`).join(", ")}>
        {entries.map(([decile, count]) => (
          <div key={decile} className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-[10px] tabular-nums text-muted-foreground">{count}</span>
            <span className="w-full rounded-sm bg-primary/70" style={{ height: `${Math.max(2, (count / max) * 40)}px` }} />
            <span className="text-[10px] text-muted-foreground">{decile}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
