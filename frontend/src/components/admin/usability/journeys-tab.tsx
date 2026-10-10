"use client"

import { Button } from "@/components/ui/button"
import { useUsabilityTabQuery } from "@/queries/admin/use-usability-queries"
import type { UsabilityJourneys } from "@/schemas/admin/usability.schema"
import type { UsabilityQuery } from "@/services/admin/usability-service"

import { SignalsCard } from "./overview-tab"
import { formatCount, formatDuration, formatInstant, formatPercent } from "./usability-format"
import { DataTable, ExportButton, Section, SubjectLink, usePanel } from "./usability-shared"
import { TabFrame } from "./usability-tab-frame"

type Stopped = { entityId: string; personId: string; personName: string | null; startedAt: string; lastStepAt: string; stoppedAfter: string }

export function JourneysTab({ query }: { query: UsabilityQuery }) {
  const result = useUsabilityTabQuery("journeys", query)
  return <TabFrame result={result}>{(data) => <JourneysContent data={data} />}</TabFrame>
}

function JourneysContent({ data }: { data: UsabilityJourneys }) {
  const { setFilters, timezone, can } = usePanel()
  const stopped = data.stoppedCases as unknown as Stopped[] | null
  const selected = data.meta.filters.segment ? String(data.meta.filters.segment) : null

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton table="funnels" label="Exportar funis" />
      </div>
      {data.funnels.map((funnel) => {
        const first = funnel.steps[0]?.reached ?? 0
        return (
          <Section key={funnel.key} title={funnel.label} description={`Correlação: ${funnel.correlation}. Janela: ${funnel.windowLabel}.`}>
            {first === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma jornada iniciada no período.</p>
            ) : (
              <ol className="space-y-2">
                {funnel.steps.map((step, index) => {
                  const segment = `${funnel.key}_S${index + 1}`
                  return (
                    <li key={step.key} className="grid gap-1 sm:grid-cols-[minmax(0,14rem)_1fr_auto] sm:items-center sm:gap-3">
                      <div>
                        <p className="text-sm font-medium">
                          {index + 1}. {step.label}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{step.source}</p>
                      </div>
                      <div className="space-y-1">
                        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <div className="h-full rounded-full bg-primary/70" style={{ width: step.reached ? `${Math.max(1, (step.reached / first) * 100)}%` : "0%" }} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatCount(step.reached)}
                          {step.conversionFromPrevious !== null ? ` · ${formatPercent(step.conversionFromPrevious)} da etapa anterior` : ""}
                          {step.conversionFromStart !== null ? ` · ${formatPercent(step.conversionFromStart)} do início` : ""}
                          {step.pending ? ` · ${formatCount(step.pending)} ainda na janela` : ""}
                          {step.timeFromStart?.median != null ? ` · mediana ${formatDuration(step.timeFromStart.median)} desde o início` : ""}
                        </p>
                      </div>
                      {step.stopped ? (
                        can.people ? (
                          <Button type="button" variant={selected === segment ? "secondary" : "ghost"} size="sm" onClick={() => setFilters({ segment: selected === segment ? undefined : segment })} data-usage-element="usability.drilldown">
                            {formatCount(step.stopped)} pararam aqui
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">{formatCount(step.stopped)} pararam aqui</span>
                        )
                      ) : (
                        <span />
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </Section>
        )
      })}

      {stopped ? (
        <Section title="Quem parou na etapa escolhida" description="Jornadas que pararam depois da etapa selecionada (o que veio depois não aconteceu dentro da janela).">
          <DataTable
            rows={stopped}
            rowKey={(row) => `${row.personId}|${row.entityId}`}
            empty="Ninguém parou nesta etapa."
            caption="Jornadas paradas"
            columns={[
              { key: "who", header: "Pessoa", cell: (row) => <SubjectLink personId={row.personId} name={row.personName} /> },
              { key: "started", header: "Início", cell: (row) => <span className="text-xs">{formatInstant(row.startedAt, timezone)}</span> },
              { key: "last", header: "Última etapa", cell: (row) => <span className="text-xs">{`${row.stoppedAfter} · ${formatInstant(row.lastStepAt, timezone)}`}</span> },
            ]}
          />
        </Section>
      ) : null}

      <div className="flex justify-end">
        <ExportButton table="signals" label="Exportar sinais" />
      </div>
      <SignalsCard signals={data.signals} />
    </div>
  )
}
