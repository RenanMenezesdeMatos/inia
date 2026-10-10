"use client"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { formatCount, formatPercent } from "@/lib/analytics/format"
import type { SubjectRef } from "@/lib/analytics/subject-params"
import type { IndicatorCapabilities, EmployeeIndicatorSummary, StructureIndicatorSummary } from "@/schemas/analytics/analytics.schema"

import { IndicatorHistoryChart } from "./indicator-history-chart"
import { IndicatorMembersTable } from "./indicator-members-table"
import { InsightPanel } from "./insight-panel"
import { OfficialVsOperationalPanel } from "./operational-trend"
import { QuartileDistributionBar } from "./quartile-distribution"
import { ReferenceStatusText, referenceStatusFrom, referenceStatusFromAchievement } from "./reference-status"
import { TrendIndicator } from "./trend-indicator"

/**
 * Detalhe do indicador em painel lateral (Sheet) — mantém o contexto da lista atrás, não recarrega
 * a página. Duas variantes sobre o mesmo esqueleto: pessoal (números do colaborador) e estrutura
 * (consolidado + distribuição + colaboradores relevantes).
 */
type DetailSheetProps = { open: boolean; onOpenChange: (open: boolean) => void; periodLabel: string }

/**
 * Ao abrir, o foco vai para o próprio painel, não para o primeiro botão: o primeiro focável é o "i" de um tooltip, e o Radix
 * abre tooltip em qualquer foco que não venha de clique — ele apareceria sozinho por cima do detalhe. Pelo teclado (Tab) o
 * tooltip continua abrindo normalmente.
 */
function focusPanelOnOpen(event: Event) {
  event.preventDefault()
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
}

function DetailFacts({ facts }: { facts: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt className="text-xs text-muted-foreground">{fact.label}</dt>
          <dd className="mt-0.5 font-medium">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

/** Capacidade do catálogo, em texto — o que a tela pode mostrar vem da metadata, não do código do indicador. */
function IndicatorCapabilityText({ capabilities }: { capabilities: IndicatorCapabilities | undefined }) {
  if (!capabilities) return null
  return <span className="text-xs text-muted-foreground">{capabilities.operationalEnabled ? "Medição operacional diária + fechamento oficial" : "Só fechamento oficial"}</span>
}

export function EmployeeIndicatorDetailSheet({ indicator, open, onOpenChange, periodLabel }: DetailSheetProps & { indicator: EmployeeIndicatorSummary | null }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-2xl" onOpenAutoFocus={focusPanelOnOpen}>
        {indicator ? (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="text-lg">{indicator.name}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{periodLabel}</span>
                <ReferenceStatusText status={referenceStatusFrom(indicator.withinTarget)} className="text-xs" />
                <IndicatorCapabilityText capabilities={indicator.capabilities} />
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <div className="space-y-6 p-4">
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-heading text-4xl font-semibold tracking-tight text-primary">{formatPercent(indicator.achievementPercent)}</span>
                  <span className="text-sm text-muted-foreground">de atingimento oficial</span>
                </p>
                <TrendIndicator trend={indicator.trend} deltaPp={indicator.deltaPp} size="md" />
                {/* Fechamento oficial × acompanhamento operacional lado a lado (o painel operacional só existe com medição diária). */}
                <OfficialVsOperationalPanel indicator={indicator} periodLabel={periodLabel} />
                <DetailSection title="Histórico mensal (fechamentos oficiais)">
                  <IndicatorHistoryChart points={indicator.history} title={indicator.name} compact />
                </DetailSection>
                <InsightPanel positives={indicator.positives} attentionPoints={indicator.attentionPoints} persisted={indicator.persistedInsights} compact />
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export function StructureIndicatorDetailSheet({ indicator, open, onOpenChange, periodLabel, subject, period, employeeHref }: DetailSheetProps & { indicator: StructureIndicatorSummary | null; subject: SubjectRef | null; period: string | null; employeeHref: (personId: string) => string }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-2xl" onOpenAutoFocus={focusPanelOnOpen}>
        {indicator ? (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="text-lg">{indicator.name}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{periodLabel}</span>
                <ReferenceStatusText status={referenceStatusFromAchievement(indicator.consolidatedAchievementPercent)} className="text-xs" />
                <IndicatorCapabilityText capabilities={indicator.capabilities} />
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <div className="space-y-6 p-4">
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-heading text-4xl font-semibold tracking-tight text-primary">{formatPercent(indicator.consolidatedAchievementPercent)}</span>
                  <span className="text-sm text-muted-foreground">de atingimento consolidado</span>
                </p>
                <TrendIndicator trend={indicator.trend} deltaPp={indicator.deltaPp} size="md" />
                <DetailFacts
                  facts={[
                    { label: "Com dado", value: formatCount(indicator.membersWithData, "colaborador", "colaboradores") },
                    { label: "Abaixo da referência", value: formatCount(indicator.membersBelowTarget, "colaborador", "colaboradores") },
                    { label: "Período anterior", value: formatPercent(indicator.previousConsolidatedAchievementPercent) },
                  ]}
                />
                <DetailSection title="Histórico mensal">
                  <IndicatorHistoryChart points={indicator.history} title={indicator.name} compact />
                </DetailSection>
                <QuartileDistributionBar distribution={indicator.distribution} title="Distribuição da equipe por quartil" />
                <InsightPanel positives={indicator.positives} attentionPoints={indicator.attentionPoints} compact />
                <DetailSection title="Colaboradores">
                  <IndicatorMembersTable subject={subject} period={period} code={indicator.code} employeeHref={employeeHref} />
                </DetailSection>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
