"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { Badge } from "@/components/ui/badge"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { useUsabilityTabQuery } from "@/queries/admin/use-usability-queries"
import type { UsabilityWorkflows } from "@/schemas/admin/usability.schema"
import type { UsabilityQuery } from "@/services/admin/usability-service"

import { formatCount, formatDuration, formatInstant, formatPercent, formatShortDate, WORKFLOW_STATUS_LABELS } from "./usability-format"
import { DataTable, EmptyNote, ExportButton, Section, StatTile, SubjectLink, usePanel } from "./usability-shared"
import { DeferredMount, TabFrame } from "./usability-tab-frame"

type Cost = { currency: string; total: string | null; tokens: number | null; unknownCostEvents: number; perRoot: string | null; perDeliveredResult: string | null }
type Ranking = {
  workflowId: string
  name: string
  active: boolean
  triggerKind: string
  consolidated: boolean
  roots: number
  sharePercent: number | null
  byOrigin: Record<string, number>
  children: number
  peopleReached: number
  completed: number
  failed: number
  waiting: number
  running: number
  failureRate: { numerator: number; denominator: number; value: number | null; pending: number }
  duration: { median: number | null; p95: number | null; oldestOpenSeconds: number | null }
  results: { feedbacksDelivered: number; feedbacksOpened: number; feedbacksAcked: number; outputsDelivered: number; outputsConsumed: number; delivered: number }
  cost: Cost[]
  manualRequesters: { personId: string; name: string; runs: number }[] | null
}
type Version = { workflowId: string; versionId: string | null; roots: number; completed: number; failed: number; failureRate: number | null }
type Failure = { nodeId: string | null; errorCode: string; events: number; rootsAffected: number }
type Item = { rootId: string; workflowId: string; workflowName: string; versionId: string | null; originLabel: string; status: string; createdAt: string; updatedAt: string; subjectPersonId: string | null; subjectName: string | null; requesterPersonId: string | null; requesterName: string | null; children: number; feedbacks: number; feedbacksOpened: number; outputs: number; outputsConsumed: number }

const TRIGGER_LABELS: Record<string, string> = { flag: "Flag", indicator: "Indicador", schedule: "Agenda", manual: "Manual" }
const ORIGIN_LABELS: Record<string, string> = { MANUAL: "Manual", INTERACTION: "Interação", INDICATOR: "Indicador", SCHEDULE: "Agenda" }
const SERIES_CONFIG = { roots: { label: "Disparos", color: "var(--chart-1)" }, completed: { label: "Concluídos no dia", color: "var(--chart-3)" } } satisfies ChartConfig

export function WorkflowsTab({ query }: { query: UsabilityQuery }) {
  const result = useUsabilityTabQuery("workflows", query)
  return <TabFrame result={result}>{(data) => <WorkflowsContent data={data} fetching={result.isFetching} />}</TabFrame>
}

function WorkflowsContent({ data, fetching }: { data: UsabilityWorkflows; fetching: boolean }) {
  const { setFilters, timezone } = usePanel()
  const ranking = data.ranking as unknown as Ranking[]
  const versions = data.versions as unknown as Version[]
  const failures = data.failures as unknown as Failure[]
  const items = data.items as unknown as Item[] | null
  const reviews = data.humanReviews as { requested: number; pending: number; decided: number; waitMedian: number | null; waitP95: number | null; oldestPendingSeconds: number | null }
  const timing = data.timing as { timeToStartMedian: number | null; timeToStartP95: number | null; manualAcceptMedian: number | null }
  const completions = data.completionsInPeriod as { completed: number; failed: number }
  const idle = data.withoutExecution as unknown as { workflowId: string; name: string; active: boolean; published: boolean; triggerKind: string }[]
  const byDay = new Map<string, { roots: number; completed: number }>()
  for (const point of data.series) {
    const current = byDay.get(point.day) ?? { roots: 0, completed: 0 }
    byDay.set(point.day, { roots: current.roots + point.roots, completed: current.completed + point.completedInDay })
  }
  const series = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ label: formatShortDate(day), ...value }))
  const nameOf = (id: string) => ranking.find((row) => row.workflowId === id)?.name ?? "Workflow"

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Disparos (execução raiz)" value={formatCount(data.totalRoots)} hint="Um disparo com fan-out para N pessoas conta uma vez" metricId="workflows.root_runs" />
        <StatTile label="Encerrados no período" value={formatCount(completions.completed + completions.failed)} hint={`${formatCount(completions.completed)} concluídos · ${formatCount(completions.failed)} com falha`} metricId="workflows.failure_rate" />
        <StatTile label="Até começar (mediana)" value={formatDuration(timing.timeToStartMedian)} hint={`p95 ${formatDuration(timing.timeToStartP95)}`} metricId="workflows.duration" />
        <StatTile label="Revisões humanas" value={formatCount(reviews.requested)} hint={`${formatCount(reviews.pending)} pendentes${reviews.oldestPendingSeconds ? ` · mais antiga há ${formatDuration(reviews.oldestPendingSeconds)}` : ""} · espera mediana ${formatDuration(reviews.waitMedian)}`} />
      </div>

      <Section title="Ranking de workflows" description="Ordenado por disparos raiz. Taxa de falha só entre os encerrados (em andamento ficam fora da base)." actions={<ExportButton table="ranking" />}>
        <DataTable
          rows={ranking}
          rowKey={(row) => row.workflowId}
          caption="Ranking de workflows"
          columns={[
            {
              key: "name",
              header: "Workflow",
              cell: (row) => (
                <div className="min-w-44 space-y-1">
                  <button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={() => setFilters({ workflowId: row.workflowId })} data-usage-element="usability.drilldown">
                    {row.name}
                  </button>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="font-normal">
                      {TRIGGER_LABELS[row.triggerKind] ?? row.triggerKind}
                    </Badge>
                    {!row.active ? (
                      <Badge variant="outline" className="font-normal">
                        Inativo
                      </Badge>
                    ) : null}
                    <a href={`/admin/workflows/${row.workflowId}`} className="text-xs text-primary underline-offset-2 hover:underline">
                      Abrir
                    </a>
                  </div>
                </div>
              ),
            },
            {
              key: "roots",
              header: "Disparos",
              align: "right",
              cell: (row) => (
                <div>
                  <p>{formatCount(row.roots)}</p>
                  <p className="text-xs text-muted-foreground">{formatPercent(row.sharePercent)}</p>
                </div>
              ),
            },
            {
              key: "origin",
              header: "Origem",
              cell: (row) => (
                <span className="text-xs">
                  {Object.entries(row.byOrigin)
                    .filter(([, count]) => count > 0)
                    .map(([origin, count]) => `${ORIGIN_LABELS[origin] ?? origin} ${count}`)
                    .join(" · ") || "—"}
                </span>
              ),
            },
            { key: "people", header: "Pessoas", align: "right", cell: (row) => `${formatCount(row.peopleReached)}${row.children ? ` (${formatCount(row.children)} ramos)` : ""}` },
            {
              key: "status",
              header: "Situação",
              cell: (row) => <span className="text-xs">{`${row.completed} ok · ${row.failed} falha · ${row.waiting + row.running} em andamento`}</span>,
            },
            { key: "failure", header: "Falha", align: "right", cell: (row) => (row.failureRate.denominator ? `${formatPercent(row.failureRate.value)} (${row.failureRate.numerator}/${row.failureRate.denominator})` : "Sem base") },
            { key: "duration", header: "Duração (mediana · p95)", align: "right", cell: (row) => <span className="text-xs">{`${formatDuration(row.duration.median)} · ${formatDuration(row.duration.p95)}`}</span> },
            {
              key: "results",
              header: "Resultados",
              cell: (row) => <span className="text-xs">{`${row.results.feedbacksDelivered} feedback(s) · ${row.results.feedbacksOpened} abertos · ${row.results.feedbacksAcked} com ciência${row.results.outputsDelivered ? ` · ${row.results.outputsDelivered} recados (${row.results.outputsConsumed} consumidos)` : ""}`}</span>,
            },
            {
              key: "cost",
              header: "Custo por disparo",
              align: "right",
              cell: (row) =>
                row.cost.length ? (
                  <span className="text-xs">{row.cost.map((item) => `${item.currency} ${item.perRoot ?? "—"}${item.unknownCostEvents ? ` (+${item.unknownCostEvents} sem preço)` : ""}`).join(" · ")}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Sem uso registrado</span>
                ),
            },
            {
              key: "requesters",
              header: "Quem disparou (manual)",
              cell: (row) =>
                row.manualRequesters === null ? (
                  <span className="text-xs text-muted-foreground">Restrito</span>
                ) : row.manualRequesters.length ? (
                  <span className="text-xs">{row.manualRequesters.map((requester) => `${requester.name} (${requester.runs})`).join(", ")}</span>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      </Section>

      <div className="grid gap-4 2xl:grid-cols-2">
        <Section title="Disparos por dia">
          {series.length === 0 ? (
            <EmptyNote>Nenhum disparo no período.</EmptyNote>
          ) : (
            <DeferredMount>
              <ChartContainer config={SERIES_CONFIG} className="aspect-auto h-56 w-full">
                <BarChart data={series} margin={{ left: 4, right: 12, top: 12, bottom: 0 }} accessibilityLayer>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Bar dataKey="roots" fill="var(--color-roots)" radius={3} isAnimationActive={false} />
                  <Bar dataKey="completed" fill="var(--color-completed)" radius={3} isAnimationActive={false} />
                </BarChart>
              </ChartContainer>
            </DeferredMount>
          )}
        </Section>
        <Section title="Onde falha" description="Por nó e código de erro (cada disparo afetado conta uma vez)." actions={<ExportButton table="failures" />}>
          <DataTable
            rows={failures}
            rowKey={(row) => `${row.nodeId}|${row.errorCode}`}
            empty="Nenhuma falha no período."
            caption="Falhas"
            columns={[
              { key: "node", header: "Nó", cell: (row) => <span className="font-mono text-xs">{row.nodeId ?? "—"}</span> },
              { key: "code", header: "Erro", cell: (row) => <span className="font-mono text-xs">{row.errorCode}</span> },
              { key: "events", header: "Ocorrências", align: "right", cell: (row) => formatCount(row.events) },
              { key: "roots", header: "Disparos afetados", align: "right", cell: (row) => formatCount(row.rootsAffected) },
            ]}
          />
        </Section>
      </div>

      <div className="grid gap-4 2xl:grid-cols-2">
        <Section title="Por versão publicada">
          <DataTable
            rows={versions}
            rowKey={(row) => `${row.workflowId}|${row.versionId}`}
            caption="Versões"
            columns={[
              { key: "workflow", header: "Workflow", cell: (row) => nameOf(row.workflowId) },
              {
                key: "version",
                header: "Versão",
                cell: (row) =>
                  row.versionId ? (
                    <button type="button" className="font-mono text-xs underline-offset-2 hover:underline" onClick={() => setFilters({ workflowId: row.workflowId, workflowVersionId: row.versionId ?? undefined })}>
                      {row.versionId.slice(0, 8)}
                    </button>
                  ) : (
                    "—"
                  ),
              },
              { key: "roots", header: "Disparos", align: "right", cell: (row) => formatCount(row.roots) },
              { key: "failure", header: "Falha", align: "right", cell: (row) => formatPercent(row.failureRate) },
            ]}
          />
        </Section>
        <Section title="Publicados sem nenhum disparo no período">
          <DataTable
            rows={idle}
            rowKey={(row) => row.workflowId}
            empty="Todo workflow publicado teve ao menos um disparo."
            caption="Workflows sem disparo"
            columns={[
              { key: "name", header: "Workflow", cell: (row) => <a href={`/admin/workflows/${row.workflowId}`} className="underline-offset-2 hover:underline">{row.name}</a> },
              { key: "trigger", header: "Gatilho", cell: (row) => TRIGGER_LABELS[row.triggerKind] ?? row.triggerKind },
              { key: "active", header: "Situação", cell: (row) => (row.active ? "Ativo" : "Inativo") },
            ]}
          />
        </Section>
      </div>

      <Section title="Disparos" description="Cada linha é uma execução raiz. Solicitante (quem clicou) ≠ sujeito (sobre quem o workflow rodou)." actions={data.identified ? <ExportButton table="items" label="Exportar disparos" /> : null}>
        {data.identified && items ? (
          <div className="space-y-3" aria-busy={fetching}>
            <DataTable
              rows={items}
              rowKey={(row) => row.rootId}
              caption="Disparos"
              columns={[
                { key: "when", header: "Quando", cell: (row) => <span className="text-xs">{formatInstant(row.createdAt, timezone)}</span> },
                { key: "workflow", header: "Workflow", cell: (row) => row.workflowName },
                { key: "origin", header: "Origem", cell: (row) => row.originLabel },
                { key: "status", header: "Situação", cell: (row) => WORKFLOW_STATUS_LABELS[row.status] ?? row.status },
                { key: "subject", header: "Sujeito", cell: (row) => <SubjectLink personId={row.subjectPersonId} name={row.subjectName} /> },
                { key: "requester", header: "Solicitante", cell: (row) => <SubjectLink personId={row.requesterPersonId} name={row.requesterName} /> },
                { key: "results", header: "Resultado", cell: (row) => <span className="text-xs">{`${row.feedbacks} feedback(s) · ${row.feedbacksOpened} abertos${row.outputs ? ` · ${row.outputs} recados` : ""}${row.children ? ` · ${row.children} ramos` : ""}`}</span> },
              ]}
            />
            <ListPagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.totalRoots}
              itemLabel={["disparo", "disparos"]}
              isFetching={fetching}
              onPageChange={(page) => setFilters({ page: page === 1 ? undefined : String(page) })}
              onPageSizeChange={(pageSize) => setFilters({ pageSize: pageSize === 25 ? undefined : String(pageSize), page: undefined })}
            />
          </div>
        ) : (
          <EmptyNote>A lista de disparos com sujeito e solicitante exige a permissão de ver pessoas identificadas.</EmptyNote>
        )}
      </Section>
    </div>
  )
}
