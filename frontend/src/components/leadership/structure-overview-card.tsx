"use client"


import { formatPercent, formatPp } from "@/lib/analytics/format"
import type { PeopleCard as People, StructureOverviewCard as Overview } from "@/schemas/leadership/leadership.schema"

import { CardAnchor, CardLink, DataCard, Limitations, Methods, Stat } from "./card-parts"
import { AWAITING_ACK_HREF, indicatorHref, personHref, teamHref } from "./leadership-links"

const MAX_INDICATORS = 6

/** Visão geral: pessoas por situação, indicadores com mais pessoas fora e as unidades com maior proporção fora. */
export function StructureOverviewCard({ card }: { card: Overview }) {
  const { members } = card
  return (
    <DataCard label="Visão geral da estrutura" title="Visão geral da estrutura" scope={`${card.structure.label}${card.structure.description ? ` · ${card.structure.description}` : ""}`} period={card.periodLabel}>
      <div className="grid grid-cols-3 gap-2">
        <Stat value={String(members.belowReference)} label="com indicador fora" base={`de ${members.withData} com dado`} tone={members.belowReference > 0 ? "attention" : "positive"} />
        <Stat value={String(members.withinReference)} label="dentro" base={`${members.improving} em evolução`} />
        <Stat value={String(members.noData)} label="sem dado" base={`de ${members.total} pessoas`} />
      </div>
      {card.indicators.length > 0 ? (
        <div>
          <p className="mb-1 text-sm font-medium">Indicadores (mais pessoas fora primeiro)</p>
          <ul className="divide-y rounded-lg border text-xs">
            {card.indicators.slice(0, MAX_INDICATORS).map((indicator) => (
              <li key={indicator.code} className="flex items-center gap-2 px-2.5 py-1.5">
                <CardAnchor href={indicatorHref(card.structure.subject, card.period, indicator.code)} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {indicator.name}
                </CardAnchor>
                <span className="tabular-nums">
                  {indicator.below} de {indicator.withReference} · {formatPercent(indicator.belowPercent)}
                </span>
                {indicator.deltaPp !== null ? <span className="w-16 text-right tabular-nums text-muted-foreground" title="Variação da proporção fora contra o mês anterior">{formatPp(indicator.deltaPp)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {card.units.length > 0 ? (
        <div>
          <p className="mb-1 text-sm font-medium">Por {card.unitsGroupByLabel?.toLowerCase() ?? "unidade"}</p>
          <ul className="divide-y rounded-lg border text-xs">
            {card.units.map((unit) => (
              <li key={`${unit.subject.kind}:${unit.label}`} className="flex items-center gap-2 px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <CardAnchor href={teamHref(unit.subject, card.period)} className="block truncate font-medium hover:underline">
                    {unit.label}
                  </CardAnchor>
                  {unit.topAttentionIndicators.length > 0 ? <p className="truncate text-muted-foreground">{unit.topAttentionIndicators.map((indicator) => indicator.name).join(", ")}</p> : null}
                </div>
                <span className="tabular-nums">
                  {unit.belowReferenceCount} de {unit.membersWithData} · {formatPercent(unit.belowReferencePercent)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {card.operational ? (
        <div>
          <p className="text-sm font-medium">Mês corrente (medição diária, parcial)</p>
          <p className="text-xs text-muted-foreground">
            {card.operational.windowLabel} × {card.operational.previousWindowLabel} · sem meta oficial
          </p>
          {card.operational.indicators.some((indicator) => indicator.current !== "—") ? (
            <ul className="mt-1 divide-y rounded-lg border text-xs">
              {card.operational.indicators.map((indicator) => (
                <li key={indicator.code} className="flex items-center gap-2 px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{indicator.name}</span>
                  <span className="tabular-nums">
                    {indicator.current} <span className="text-muted-foreground">(antes {indicator.previous})</span>
                  </span>
                  <span className="w-16 text-right text-muted-foreground">{indicator.trend ?? "—"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Ainda não há medição diária no mês corrente para esta estrutura.</p>
          )}
        </div>
      ) : null}
      {card.awaitingAcknowledgement > 0 ? (
        <p className="text-xs">
          {card.awaitingAcknowledgement} {card.awaitingAcknowledgement === 1 ? "feedback aguardando" : "feedbacks aguardando"} ciência · <CardLink href={AWAITING_ACK_HREF}>ver</CardLink>
        </p>
      ) : null}
      <Limitations items={card.limitations} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Methods items={card.methods} />
        <CardLink href={teamHref(card.structure.subject, card.period)}>Abrir {card.units.length > 0 ? "estrutura" : "equipe"}</CardLink>
      </div>
    </DataCard>
  )
}

const SITUATION_LABELS = { BELOW_REFERENCE: "Fora da referência", NO_DATA: "Sem dado", IMPROVING: "Em evolução", WITHIN_REFERENCE: "Dentro da referência" } as const

/** Pessoas de um recorte — cada uma abre a ficha; o recorte completo abre filtrado no painel. */
export function PeopleCard({ card }: { card: People }) {
  const fullHref = card.filter.indicatorCode ? indicatorHref(card.structure.subject, card.period, card.filter.indicatorCode) : card.filter.pendingOnly ? AWAITING_ACK_HREF : teamHref(card.structure.subject, card.period, { situation: card.filter.situation })
  return (
    <DataCard label={card.filter.label} title={`${card.filter.label}: ${card.total} ${card.total === 1 ? "pessoa" : "pessoas"}`} scope={`${card.structure.label}${card.structure.description ? ` · ${card.structure.description}` : ""}`} period={card.periodLabel}>
      {card.members.length === 0 ? (
        <p className="text-xs text-muted-foreground">Ninguém neste recorte.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-xs">
          {card.members.map((member) => (
            <li key={member.personId} className="flex items-center gap-2 px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <CardAnchor href={personHref(member.personId, card.period)} className="block truncate font-medium hover:underline">
                  {member.name}
                </CardAnchor>
                <p className="truncate text-muted-foreground">
                  {member.indicator ? `atingimento ${formatPercent(member.indicator.achievementPercent)}` : member.attentionIndicators.length > 0 ? member.attentionIndicators.map((indicator) => indicator.name).join(", ") : SITUATION_LABELS[member.situation]}
                </p>
              </div>
              {member.awaitingAcknowledgement > 0 ? <span className="text-muted-foreground">{member.awaitingAcknowledgement} sem ciência</span> : null}
              {member.pendingReviews > 0 ? <span className="text-muted-foreground">{member.pendingReviews} revisão</span> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Methods items={card.methods} />
        {card.total > 0 ? <CardLink href={fullHref}>{card.total > card.members.length ? `Ver as ${card.total}` : "Abrir no painel"}</CardLink> : null}
      </div>
    </DataCard>
  )
}
