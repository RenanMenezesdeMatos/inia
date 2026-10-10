"use client"

import { Badge } from "@/components/ui/badge"
import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { cn } from "@/lib/utils"
import { useUsabilityTabQuery } from "@/queries/admin/use-usability-queries"
import type { UsabilityFeedbacks } from "@/schemas/admin/usability.schema"
import type { UsabilityQuery } from "@/services/admin/usability-service"

import { DEVICE_LABELS, FEEDBACK_KIND_LABELS, FEEDBACK_SOURCE_LABELS, formatCount, formatDuration, formatInstant, formatPercent, formatRate } from "./usability-format"
import { BarList, DataTable, EmptyNote, ExportButton, Section, StatTile, SubjectLink, usePanel } from "./usability-shared"
import { TabFrame } from "./usability-tab-frame"

type Rate = { numerator: number; denominator: number; value: number | null }
type TimeTo = { median: number | null; p95: number | null; pending: number }
type Cohort = {
  available: number
  recipients: number
  counts: Record<string, number>
  exposureNotMeasured: number
  rates: Record<string, Rate>
  ratings: { up: number; down: number; withdrawn: number; notRated: number; changed: number; changeRate: number | null }
  timeTo: Record<"open" | "rating" | "application" | "ack", TimeTo>
  pendingAckAging: { key: string; label: string; count: number }[]
  byKindAndTeam: { feedbackKind: string; teamName: string | null; available: number; acked: number; up: number; down: number; useful: number | null }[]
}
type Confirmation = {
  attempts: number
  opened: number
  submitted: number
  failures: number
  withFailure: number
  recovered: number
  cancelled: number
  confirmedNew: number
  confirmedIdempotent: number
  completedApplication: number
  pending: number
  possibleAbandonment: number
  abandonmentWindowMinutes: number
  timeToFirstSubmit: { median: number | null; p95: number | null }
  timeToConfirm: { median: number | null; p95: number | null }
  byEntryPoint: Record<string, { attempts: number; confirmed: number }>
  byDevice: Record<string, number>
  failureReasons: { reason: string; count: number }[]
}
type Comment = { ratingId: string; reasonLabel: string; comment: string; createdAt: string; personId: string | null; personName: string | null; sourceKind: string }
type Item = {
  sourceKind: string
  sourceId: string
  recipientPersonId: string
  recipientName: string | null
  teamName: string | null
  feedbackKind: string | null
  availableAt: string
  mature: boolean
  exposureMeasured: boolean
  exposedAt: string | null
  openedAt: string | null
  openCount: number
  currentRating: string | null
  acknowledgedAt: string | null
  applicationStartedAt: string | null
  applicationCompletedAt: string | null
}

const FUNNEL_SEGMENTS = ["AVAILABLE", "EXPOSED", "OPENED", "RATED", "ACKED", "APPLICATION_STARTED", "APPLICATION_COMPLETED"]
const OTHER_SEGMENTS = ["NOT_EXPOSED", "EXPOSURE_NOT_MEASURED", "EXPOSED_NOT_OPENED", "OPENED_NOT_RATED", "RATED_WITHOUT_OPENING", "NOT_RATED", "PENDING_ACK", "ACK_OUTSIDE_APPLICATION"]
const ENTRY_POINT_LABELS: Record<string, string> = { FOLLOW_UP_FEED: "No Acompanhamento", FEEDBACK_SESSION: "Na sessão com a INIA" }
const FAILURE_LABELS: Record<string, string> = { WRONG_LOGIN: "Login de outra conta", WRONG_PASSWORD: "Senha incorreta", TOO_MANY_ATTEMPTS: "Bloqueio por tentativas" }

export function FeedbacksTab({ query, segmentLabels }: { query: UsabilityQuery; segmentLabels: Record<string, string> }) {
  const result = useUsabilityTabQuery("feedbacks", query)
  return <TabFrame result={result}>{(data) => <FeedbacksContent data={data} segmentLabels={segmentLabels} fetching={result.isFetching} />}</TabFrame>
}

function FeedbacksContent({ data, segmentLabels, fetching }: { data: UsabilityFeedbacks; segmentLabels: Record<string, string>; fetching: boolean }) {
  const { setFilters, timezone } = usePanel()
  const cohort = data.cohort as unknown as Cohort
  const confirmation = data.confirmation as unknown as Confirmation
  const comments = data.comments as unknown as Comment[] | null
  const items = data.items as unknown as Item[] | null
  const cohortWindow = String(data.meta.filters.cohortWindow ?? 7)
  const segmentButton = (key: string) => {
    const selected = data.segment === key
    return (
      <button
        key={key}
        type="button"
        aria-pressed={selected}
        onClick={() => setFilters({ segment: key === "AVAILABLE" ? undefined : key })}
        className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs hover:bg-muted", selected && "border-primary bg-primary/10")}
        data-usage-element="list.filter"
      >
        {segmentLabels[key] ?? key}
        <span className="tabular-nums text-muted-foreground">{formatCount(cohort.counts[key] ?? 0)}</span>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <Section
        title="Coorte de feedbacks disponibilizados"
        description={`${formatCount(cohort.available)} feedback(s) para ${formatCount(cohort.recipients)} pessoa(s), disponibilizados no período. Conversão ${data.meta.filters.conversionMode === "CUTOFF" ? "até o fim do período" : `em até ${cohortWindow} dia(s) após a entrega`}. Cada feedback conta uma vez por destinatário.`}
        metricId="feedback.available"
        actions={<ExportButton table="cohort" />}
      >
        <div className="space-y-4">
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Etapas do feedback">
            <FunnelStep label="Exposto (visto na tela)" rate={cohort.rates.exposure} metricId="feedback.exposure_rate" note={cohort.exposureNotMeasured ? `${formatCount(cohort.exposureNotMeasured)} sem medição de exposição` : undefined} />
            <FunnelStep label="Aberto" rate={cohort.rates.open} metricId="feedback.open_rate" note={`Entre os expostos: ${formatRate(cohort.rates.openAmongExposed)}`} />
            <FunnelStep label="Avaliado (entre abertos)" rate={cohort.rates.ratingAmongOpened} metricId="feedback.rating_among_opened" note={`Útil: ${formatRate(cohort.rates.useful)}`} />
            <FunnelStep label="Ciência confirmada" rate={cohort.rates.ack} metricId="feedback.ack_rate" note={`Aplicação com a INIA: ${formatRate(cohort.rates.applicationStarted)}`} />
          </ol>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Até abrir (mediana)" value={formatDuration(cohort.timeTo.open?.median)} hint={`p95 ${formatDuration(cohort.timeTo.open?.p95)} · ${formatCount(cohort.timeTo.open?.pending)} ainda não abertos`} metricId="feedback.time_to" />
            <StatTile label="Até avaliar (mediana)" value={formatDuration(cohort.timeTo.rating?.median)} hint={`p95 ${formatDuration(cohort.timeTo.rating?.p95)}`} />
            <StatTile label="Até aplicar com a INIA" value={formatDuration(cohort.timeTo.application?.median)} hint={`Conclusão: ${formatRate(cohort.rates.applicationCompletion)}`} metricId="feedback.application_rate" />
            <StatTile label="Até confirmar ciência" value={formatDuration(cohort.timeTo.ack?.median)} hint={`p95 ${formatDuration(cohort.timeTo.ack?.p95)}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">Avaliações vigentes no corte</p>
              <div className="grid grid-cols-3 gap-2">
                <StatTile label="Foi útil" value={formatCount(cohort.ratings.up)} metricId="feedback.useful_rate" />
                <StatTile label="Não foi útil" value={formatCount(cohort.ratings.down)} />
                <StatTile label="Retiradas" value={formatCount(cohort.ratings.withdrawn)} hint={`${formatCount(cohort.ratings.changed)} mudaram de avaliação`} />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Ciência pendente há</p>
              <BarList items={cohort.pendingAckAging.map((bucket) => ({ key: bucket.key, label: bucket.label, value: bucket.count }))} empty="Nenhuma ciência pendente." />
            </div>
          </div>
        </div>
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Por tipo e grupo" description="Disponibilizados, ciência e avaliações por tipo de feedback.">
          <DataTable
            rows={cohort.byKindAndTeam}
            rowKey={(row) => `${row.feedbackKind}|${row.teamName}`}
            caption="Por tipo e grupo"
            columns={[
              { key: "kind", header: "Tipo", cell: (row) => (row.feedbackKind ? (FEEDBACK_KIND_LABELS[row.feedbackKind] ?? row.feedbackKind) : "—") },
              { key: "team", header: "Grupo", cell: (row) => row.teamName ?? "—" },
              { key: "available", header: "Disponibilizados", align: "right", cell: (row) => formatCount(row.available) },
              { key: "acked", header: "Com ciência", align: "right", cell: (row) => formatCount(row.acked) },
              { key: "useful", header: "Útil", align: "right", cell: (row) => (row.up + row.down ? `${formatPercent(row.useful)} (${row.up}/${row.up + row.down})` : "Sem avaliação") },
            ]}
          />
        </Section>
        <Section title="Motivos de “não foi útil”" description="Avaliações negativas registradas no período (por motivo)." actions={<ExportButton table="reasons" />}>
          <BarList items={data.reasons.map((reason) => ({ key: reason.reason, label: reason.label, value: reason.count, display: `${formatCount(reason.count)}${reason.previous !== null ? ` · antes ${formatCount(reason.previous)}` : ""}` }))} empty="Nenhuma avaliação negativa no período." />
        </Section>
      </div>

      <ConfirmationCard confirmation={confirmation} />

      {comments ? (
        <Section title="Comentários das avaliações negativas" description="Texto escrito pelo colaborador. Visível só com a permissão de comentários." actions={<ExportButton table="comments" />}>
          <DataTable
            rows={comments}
            rowKey={(row) => row.ratingId}
            caption="Comentários"
            columns={[
              { key: "at", header: "Quando", cell: (row) => <span className="text-xs">{formatInstant(row.createdAt, timezone)}</span> },
              { key: "who", header: "Pessoa", cell: (row) => <SubjectLink personId={row.personId} name={row.personName} /> },
              { key: "reason", header: "Motivo", cell: (row) => row.reasonLabel },
              { key: "comment", header: "Comentário", cell: (row) => <p className="max-w-md whitespace-pre-wrap text-sm">{row.comment}</p> },
            ]}
          />
        </Section>
      ) : null}

      <Section title={data.segmentLabel} description="Escolha a etapa para ver os feedbacks que chegaram (ou pararam) nela." actions={data.identified ? <ExportButton table="items" label="Exportar feedbacks" /> : null}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">{FUNNEL_SEGMENTS.map(segmentButton)}</div>
          <div className="flex flex-wrap gap-1.5">{OTHER_SEGMENTS.map(segmentButton)}</div>
          {data.identified && items ? (
            <div className="space-y-3" aria-busy={fetching}>
              <DataTable
                rows={items}
                rowKey={(row) => `${row.sourceKind}|${row.sourceId}`}
                caption="Feedbacks"
                columns={[
                  {
                    key: "who",
                    header: "Destinatário",
                    cell: (row) => (
                      <div className="space-y-0.5">
                        <SubjectLink personId={row.recipientPersonId} name={row.recipientName} />
                        <p className="text-xs text-muted-foreground">{row.teamName ?? "—"}</p>
                      </div>
                    ),
                  },
                  { key: "kind", header: "Feedback", cell: (row) => <span className="text-xs">{[FEEDBACK_SOURCE_LABELS[row.sourceKind] ?? row.sourceKind, row.feedbackKind ? FEEDBACK_KIND_LABELS[row.feedbackKind] : null].filter(Boolean).join(" · ")}</span> },
                  { key: "available", header: "Disponível em", cell: (row) => <span className="text-xs">{formatInstant(row.availableAt, timezone)}</span> },
                  { key: "opened", header: "Aberto", cell: (row) => <span className="text-xs">{row.openedAt ? `${formatInstant(row.openedAt, timezone)}${row.openCount > 1 ? ` (${row.openCount}×)` : ""}` : row.exposureMeasured ? (row.exposedAt ? "Só visto" : "Não") : "Sem medição"}</span> },
                  { key: "rating", header: "Avaliação", cell: (row) => (row.currentRating === "UP" ? "Foi útil" : row.currentRating === "DOWN" ? "Não foi útil" : "—") },
                  { key: "ack", header: "Ciência", cell: (row) => <span className="text-xs">{row.acknowledgedAt ? formatInstant(row.acknowledgedAt, timezone) : "Pendente"}</span> },
                  {
                    key: "state",
                    header: "",
                    cell: (row) =>
                      row.mature ? null : (
                        <Badge variant="outline" className="font-normal" title="A janela da coorte ainda não terminou para este feedback.">
                          Em observação
                        </Badge>
                      ),
                  },
                ]}
              />
              <ListPagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                itemLabel={["feedback", "feedbacks"]}
                isFetching={fetching}
                onPageChange={(page) => setFilters({ page: page === 1 ? undefined : String(page) })}
                onPageSizeChange={(pageSize) => setFilters({ pageSize: pageSize === 25 ? undefined : String(pageSize), page: undefined })}
              />
            </div>
          ) : (
            <EmptyNote>{`${formatCount(data.total)} feedback(s) neste segmento. A lista com destinatários exige a permissão de ver pessoas identificadas.`}</EmptyNote>
          )}
        </div>
      </Section>
    </div>
  )
}

function FunnelStep({ label, rate, metricId, note }: { label: string; rate: Rate | undefined; metricId: string; note?: string | undefined }) {
  return (
    <li>
      <StatTile label={label} value={rate?.denominator ? formatPercent(rate.value) : "Sem base"} hint={`${rate ? `${formatCount(rate.numerator)} de ${formatCount(rate.denominator)}` : ""}${note ? ` · ${note}` : ""}`} metricId={metricId} />
    </li>
  )
}

function ConfirmationCard({ confirmation }: { confirmation: Confirmation }) {
  return (
    <Section title="Confirmação de ciência (login e senha)" description="Tentativas = cada abertura do formulário. O login digitado e a senha nunca são registrados." metricId="confirmation.attempts" actions={<ExportButton table="confirmation" />}>
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Tentativas abertas" value={formatCount(confirmation.attempts)} hint={`${formatCount(confirmation.submitted)} chegaram a enviar`} />
          <StatTile label="Confirmadas" value={formatCount(confirmation.confirmedNew)} hint={confirmation.confirmedIdempotent ? `+${formatCount(confirmation.confirmedIdempotent)} já estavam confirmadas` : undefined} />
          <StatTile label="Com erro" value={formatCount(confirmation.withFailure)} hint={`${formatCount(confirmation.recovered)} se recuperaram depois do erro`} />
          <StatTile label="Possível abandono" value={formatCount(confirmation.possibleAbandonment)} hint={`Sem envio nem cancelamento em ${confirmation.abandonmentWindowMinutes} min · ${formatCount(confirmation.cancelled)} cancelaram`} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Tempo</p>
            <p className="text-sm text-muted-foreground">
              Até o primeiro envio: {formatDuration(confirmation.timeToFirstSubmit.median)} (p95 {formatDuration(confirmation.timeToFirstSubmit.p95)})
            </p>
            <p className="text-sm text-muted-foreground">
              Até confirmar: {formatDuration(confirmation.timeToConfirm.median)} (p95 {formatDuration(confirmation.timeToConfirm.p95)})
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Onde confirmam</p>
            {Object.entries(confirmation.byEntryPoint).map(([key, value]) => (
              <p key={key} className="text-sm text-muted-foreground">
                {ENTRY_POINT_LABELS[key] ?? key}: {formatCount(value.confirmed)} de {formatCount(value.attempts)} tentativa(s)
              </p>
            ))}
            <p className="text-xs text-muted-foreground">{Object.entries(confirmation.byDevice).map(([device, count]) => `${DEVICE_LABELS[device] ?? device}: ${count}`).join(" · ")}</p>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Erros</p>
            <BarList items={confirmation.failureReasons.map((row) => ({ key: row.reason, label: FAILURE_LABELS[row.reason] ?? row.reason, value: row.count }))} empty="Nenhum erro no período." />
          </div>
        </div>
      </div>
    </Section>
  )
}
