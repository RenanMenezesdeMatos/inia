"use client"

import { Badge } from "@/components/ui/badge"
import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { useUsabilityTabQuery } from "@/queries/admin/use-usability-queries"
import type { PeopleRow, UsabilityPeople } from "@/schemas/admin/usability.schema"
import type { UsabilityQuery } from "@/services/admin/usability-service"
import { cn } from "@/lib/utils"

import { ACCOUNT_BADGE, ELIGIBILITY_BASIS_LABELS, formatCount, formatDecimal, formatDuration, formatInstant, formatPercent } from "./usability-format"
import { DataTable, EmptyNote, ExportButton, Section, SubjectLink, usePanel } from "./usability-shared"
import { TabFrame } from "./usability-tab-frame"

/** Ordem de exibição dos segmentos (agrupados por pergunta). */
const SEGMENT_GROUPS: { title: string; keys: string[] }[] = [
  { title: "Quem usou", keys: ["ALL", "ELIGIBLE", "ACTIVE", "ENGAGED", "FIRST_ACCESS"] },
  { title: "Quem não usou", keys: ["ELIGIBLE_INACTIVE", "NEVER_SINCE_ENABLED", "NO_RECORD_SINCE_COLLECTION", "INACTIVE_3", "INACTIVE_7", "INACTIVE_14", "INACTIVE_30"] },
  { title: "Voltou depois de parar", keys: ["RETURNED_7", "RETURNED_14", "RETURNED_30"] },
  { title: "Fora da base de acesso", keys: ["NO_ACCOUNT", "ACCOUNT_DISABLED", "AWAY", "TERMINATED"] },
]

export function PeopleTab({ query, segmentLabels }: { query: UsabilityQuery; segmentLabels: Record<string, string> }) {
  const result = useUsabilityTabQuery("people", query)
  return <TabFrame result={result}>{(data) => <PeopleContent data={data} segmentLabels={segmentLabels} fetching={result.isFetching} />}</TabFrame>
}

function PeopleContent({ data, segmentLabels, fetching }: { data: UsabilityPeople; segmentLabels: Record<string, string>; fetching: boolean }) {
  const { setFilters } = usePanel()
  return (
    <div className="space-y-4">
      <Section
        title="Segmentos"
        description="Cada pessoa é contada pela mesma regra em todos os segmentos. “Nunca acessou” só aparece onde há medição desde a habilitação."
        metricId="activity.eligible_inactive"
        actions={<ExportButton table="segments" label="Exportar segmentos" />}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {SEGMENT_GROUPS.map((group) => (
            <fieldset key={group.title} className="space-y-1.5">
              <legend className="text-xs font-medium text-muted-foreground">{group.title}</legend>
              <div className="flex flex-wrap gap-1.5">
                {group.keys.map((key) => {
                  const selected = data.segment === key
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setFilters({ segment: key === "ALL" ? undefined : key })}
                      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted", selected && "border-primary bg-primary/10 text-foreground")}
                      data-usage-element="list.filter"
                    >
                      {segmentLabels[key] ?? key}
                      <span className="tabular-nums text-muted-foreground">{formatCount(data.counts[key] ?? 0)}</span>
                    </button>
                  )
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </Section>

      <Section
        title={data.segmentLabel}
        description={`${formatCount(data.total)} pessoa(s) no segmento.`}
        actions={data.identified ? <ExportButton table="people" label="Exportar pessoas" /> : null}
      >
        {data.identified && data.items ? (
          <div className="space-y-3" aria-busy={fetching}>
            <PeopleTable rows={data.items} />
            <ListPagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              itemLabel={["pessoa", "pessoas"]}
              isFetching={fetching}
              onPageChange={(page) => setFilters({ page: page === 1 ? undefined : String(page) })}
              onPageSizeChange={(pageSize) => setFilters({ pageSize: pageSize === 25 ? undefined : String(pageSize), page: undefined })}
            />
          </div>
        ) : (
          <EmptyNote>Você vê só os totais deste segmento. Nomes e o detalhe de cada pessoa exigem a permissão de ver pessoas identificadas.</EmptyNote>
        )}
      </Section>

      <RetentionCard retention={data.retention} />
    </div>
  )
}

function PeopleTable({ rows }: { rows: PeopleRow[] }) {
  const { timezone } = usePanel()
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.personId}
      caption="Pessoas do segmento"
      columns={[
        {
          key: "name",
          header: "Pessoa",
          cell: (row) => (
            <div className="min-w-44 space-y-0.5">
              <SubjectLink personId={row.personId} name={row.name} />
              <p className="text-xs text-muted-foreground">{[row.matricula, row.jobTitle].filter(Boolean).join(" · ")}</p>
            </div>
          ),
        },
        { key: "team", header: "Grupo", cell: (row) => <span className="text-xs">{[row.teamName, row.subteamName].filter(Boolean).join(" › ") || "—"}</span> },
        {
          key: "account",
          header: "Conta",
          cell: (row) => (
            <div className="flex flex-wrap gap-1">
              <Badge variant={row.accountStatus === "ENABLED" ? "secondary" : "outline"} className="font-normal">
                {ACCOUNT_BADGE[row.accountStatus]}
              </Badge>
              {!row.personActive ? (
                <Badge variant="outline" className="font-normal">
                  Desligada
                </Badge>
              ) : null}
            </div>
          ),
        },
        {
          key: "eligible",
          header: "Elegível desde",
          cell: (row) => (row.eligibleFrom ? <span className="text-xs" title={row.eligibilityBasis ? ELIGIBILITY_BASIS_LABELS[row.eligibilityBasis] : undefined}>{formatInstant(row.eligibleFrom, timezone)}</span> : <span className="text-xs text-muted-foreground">{row.eligibleNow ? "Sem registro" : "Não elegível"}</span>),
        },
        { key: "days", header: "Dias ativos", align: "right", cell: (row) => formatCount(row.activeDays) },
        { key: "sessions", header: "Acessos", align: "right", cell: (row) => formatCount(row.sessions) },
        { key: "perDay", header: "Acessos/dia", align: "right", cell: (row) => formatDecimal(row.sessionsPerActiveDay) },
        { key: "time", header: "Tempo ativo", align: "right", cell: (row) => formatDuration(row.activeSeconds) },
        {
          key: "last",
          header: "Último uso comprovado",
          cell: (row) => (
            <span className="text-xs">
              {row.lastObservedAt ? formatInstant(row.lastObservedAt, timezone) : row.legacyLastLoginAt ? `Login anterior à coleta: ${formatInstant(row.legacyLastLoginAt, timezone)}` : "Nenhum"}
            </span>
          ),
        },
      ]}
    />
  )
}

function RetentionCard({ retention }: { retention: UsabilityPeople["retention"] }) {
  return (
    <Section title="Retenção" description={`Coorte: ${retention.basis}. Só entram pessoas cuja janela já terminou (coorte madura).`} metricId="retention.d_n" actions={<ExportButton table="retention" />}>
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {retention.days.map((day) => (
            <div key={day.offset} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Voltaram em {day.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{day.matureCohort ? formatPercent(day.rate) : "Sem base"}</p>
              <p className="text-xs text-muted-foreground">
                {formatCount(day.returned)} de {formatCount(day.matureCohort)} madura(s){day.immature ? ` · ${formatCount(day.immature)} ainda em observação` : ""}
              </p>
            </div>
          ))}
        </div>
        {retention.weekly.length === 0 ? (
          <EmptyNote>Nenhuma coorte de primeiro acesso no período.</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Retenção por semana de primeiro acesso</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col" className="py-1 text-left font-normal">Semana de entrada</th>
                  <th scope="col" className="py-1 text-right font-normal">Pessoas</th>
                  {retention.weekly[0]?.weeks.map((week) => (
                    <th key={week.offset} scope="col" className="py-1 text-right font-normal">
                      Sem. {week.offset}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {retention.weekly.map((row) => (
                  <tr key={row.week} className="border-t">
                    <th scope="row" className="py-1.5 text-left font-normal">
                      {row.week}
                    </th>
                    <td className="py-1.5 text-right tabular-nums">{formatCount(row.size)}</td>
                    {row.weeks.map((week) => (
                      <td key={week.offset} className="py-1.5 text-right tabular-nums" style={week.mature && week.rate !== null ? { background: `color-mix(in oklab, var(--primary) ${Math.round(week.rate * 0.6)}%, transparent)` } : undefined}>
                        {week.mature ? formatPercent(week.rate) : <span className="text-xs text-muted-foreground">em curso</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  )
}
