"use client"

import type { ReactNode } from "react"

import { SURFACE_CARD } from "@/components/ui/surface"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TABLE_FRAME } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { Rate } from "@/schemas/inia-success/inia-success.schema"

import { BlockBody, type SuccessBlocks } from "./success-blocks"
import { DEFINITIONS, type Definition } from "./success-definitions"
import { formatCount, plural, rateBase, rateCompact, rateValue, rateWithBase } from "./success-format"
import { BarList, BlockState, InfoTip, Panel, StatRow } from "./success-ui"

/**
 * 5. Feedbacks e contestações — a mesma coorte (feedbacks disponibilizados no período) para todas as taxas. Ciência (leu), avaliação
 * (útil/não foi útil), contestação (regra da fila) e revisão humana (procedente / em parte / mantido) ficam separadas; pendentes à parte.
 */
function RateTile({ title, definition, rate, unit, note }: { title: string; definition: Definition; rate: Rate; unit: readonly [string, string]; note?: ReactNode }) {
  return (
    <div className={cn(SURFACE_CARD, "flex min-w-0 flex-col gap-1 p-4")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{title}</p>
        <InfoTip definition={definition} />
      </div>
      <p className={cn("text-2xl font-semibold tracking-tight tabular-nums", rate.status !== "OK" && "text-base text-muted-foreground")}>{rateValue(rate)}</p>
      <p className="text-xs text-muted-foreground tabular-nums">{rate.status === "NO_DATA" ? `Nenhum ${unit[0]}` : rateBase(rate, unit)}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  )
}

const KIND_LABELS = {
  INDICATOR: "Feedback de indicador",
  MONITORING: "Feedback de monitoria",
} as const

export function SuccessFeedback({ blocks }: { blocks: SuccessBlocks }) {
  return (
    <BlockBody block={blocks.feedback} name="feedback" lines={6}>
      {(data) => (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <RateTile
              title="Ciência confirmada"
              definition={DEFINITIONS.feedbackAcknowledgement}
              rate={data.acknowledgement}
              unit={["feedback disponibilizado", "feedbacks disponibilizados"]}
              note="Leu — não é concordância."
            />
            <RateTile title="Feedbacks avaliados" definition={DEFINITIONS.feedbackRating} rate={data.ratingRate} unit={["feedback disponibilizado", "feedbacks disponibilizados"]} />
            <RateTile title="Utilidade positiva" definition={DEFINITIONS.feedbackPositive} rate={data.positive} unit={["feedback avaliado", "feedbacks avaliados"]} />
            <RateTile title="Avaliação negativa" definition={DEFINITIONS.feedbackNegative} rate={data.negative} unit={["feedback avaliado", "feedbacks avaliados"]} note="Não é erro comprovado." />
            <RateTile title="Contestação" definition={DEFINITIONS.contestation} rate={data.contestation} unit={["feedback disponibilizado", "feedbacks disponibilizados"]} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel
              title="Revisão humana das contestações"
              definition={DEFINITIONS.procedence}
              description="“Procedente” = a contestação tinha razão (não é aprovação do feedback). O resultado das revisadas não se estende às pendentes nem a todos os feedbacks."
            >
              <div className="space-y-4">
                <BarList
                  items={[
                    {
                      key: "accepted",
                      label: data.decisionLabels.ACCEPTED ?? "Procedente",
                      count: data.counts.accepted,
                      share: data.procedence.accepted.status === "OK" ? data.procedence.accepted.value : null,
                    },
                    {
                      key: "partial",
                      label: data.decisionLabels.PARTIALLY_ACCEPTED ?? "Procedente em parte",
                      count: data.counts.partial,
                      share: data.procedence.partial.status === "OK" ? data.procedence.partial.value : null,
                    },
                    {
                      key: "rejected",
                      label: data.decisionLabels.REJECTED ?? "Feedback mantido",
                      count: data.counts.rejected,
                      share: data.procedence.rejected.status === "OK" ? data.procedence.rejected.value : null,
                    },
                  ].filter((item) => data.reviewed > 0 || item.count > 0)}
                  series="feedback"
                  unit={["contestação", "contestações"]}
                  emptyText="Nenhuma contestação revisada ainda."
                />
                <dl className="divide-y divide-border">
                  <StatRow label="Procedência entre as revisadas" value={rateWithBase(data.procedence.accepted, ["revisada", "revisadas"])} />
                  <StatRow label="Aguardando revisão" hint="Fora do denominador da procedência" value={plural(data.counts.pending, ["contestação", "contestações"])} />
                </dl>
              </div>
            </Panel>
            <Panel
              title="Motivos das contestações"
              description="O motivo que o colaborador escolheu ao marcar “não foi útil” (um por contestação). É o motivo da avaliação negativa — não o motivo da procura nem da chamada."
            >
              <BarList
                items={data.reasons.map((reason) => ({
                  key: reason.reason,
                  label: reason.label,
                  count: reason.count,
                  share: reason.share.status === "OK" ? reason.share.value : null,
                }))}
                series="feedback"
                unit={["contestação", "contestações"]}
                emptyText="Nenhuma contestação no período."
              />
            </Panel>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className={TABLE_FRAME}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Disponibilizados</TableHead>
                    <TableHead className="text-right">Contestação</TableHead>
                    <TableHead className="text-right">Utilidade positiva</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byKind.map((kind) => (
                    <TableRow key={kind.kind}>
                      <TableCell>{KIND_LABELS[kind.kind]}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCount(kind.counts.delivered)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rateCompact(kind.contestation)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rateCompact(kind.positive)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3">
              <BlockState kind="unavailable" message="Concordância explícita com o feedback ainda não tem registro próprio: ciência não é concordância e “útil” não é concordância." />
              <p className="text-xs text-muted-foreground">
                Histórico das avaliações: {plural(data.counts.withdrawn, ["avaliação retirada", "avaliações retiradas"])} e{" "}
                {plural(data.counts.changed, ["feedback com avaliação trocada", "feedbacks com avaliação trocada"])} — conta sempre a vigente.
              </p>
            </div>
          </div>
        </div>
      )}
    </BlockBody>
  )
}
