"use client"

import type { ReactNode } from "react"
import { Clock, HeartHandshake, MessageSquareWarning, ThumbsUp, type LucideIcon } from "lucide-react"

import { IconBadge, SURFACE_CARD, type Tone } from "@/components/ui/surface"
import { cn } from "@/lib/utils"

import { BlockBody, measureOf, type SuccessBlocks } from "./success-blocks"
import { DEFINITIONS, type Definition } from "./success-definitions"
import { averageValue, formatSeconds, plural, rateBaseLine, rateValue, rateWithBase } from "./success-format"
import { BigNumber, BlockState, InfoTip } from "./success-ui"

/**
 * 1. Resumo — poucos números, cada um com a base logo abaixo. Nenhuma meta ou faixa de "bom/ruim": a tela não inventa referência.
 * "Assertividade segundo o Anjo" aparece como lacuna explicada (não há classificação de correção das respostas).
 */
function SummaryCard({ icon, tone = "info", title, definition, children }: { icon: LucideIcon; tone?: Tone; title: string; definition: Definition; children: ReactNode }) {
  return (
    <div className={cn(SURFACE_CARD, "flex min-w-0 flex-col gap-3 p-4")}>
      <div className="flex items-start gap-3">
        <IconBadge icon={icon} tone={tone} size="sm" />
        <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug">{title}</h3>
        <InfoTip definition={definition} />
      </div>
      {children}
    </div>
  )
}

export function SuccessSummary({ blocks }: { blocks: SuccessBlocks }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard icon={Clock} title="Tempo médio de resposta (texto)" definition={DEFINITIONS.responseTime}>
        <BlockBody block={blocks.responseTime} name="responseTime" lines={2}>
          {(data) => (
            <div className="space-y-2">
              <BigNumber value={averageValue(data.text.average)} muted={data.text.average.status !== "OK"} base={`média de ${plural(data.text.measured, ["resposta medida", "respostas medidas"])}`} />
              <p className="text-xs text-muted-foreground tabular-nums">
                {data.text.medianSeconds !== null ? `Mediana ${formatSeconds(data.text.medianSeconds)} · 90% em até ${formatSeconds(data.text.p90Seconds)} · ` : ""}
                Cobertura: {rateWithBase(data.text.coverage, ["pergunta", "perguntas"])}
              </p>
              <p className="text-xs text-muted-foreground">Voz: sem medida confiável ({plural(data.voice.answers, ["resposta", "respostas"])} no período).</p>
            </div>
          )}
        </BlockBody>
      </SummaryCard>

      <SummaryCard icon={ThumbsUp} title="Respostas úteis no chat" definition={DEFINITIONS.positiveReplies}>
        <BlockBody block={blocks.replies} name="replies" lines={2}>
          {(data) => {
            const positive = measureOf(data.funnel.measures, "M3")?.main
            const rated = measureOf(data.funnel.measures, "M2")?.main
            if (!positive || !rated) return <BlockState kind="empty" />
            return (
              <div className="space-y-2">
                <BigNumber
                  value={rateValue(positive)}
                  muted={positive.status !== "OK"}
                  base={rateBaseLine(positive, ["resposta avaliada", "respostas avaliadas"], "Nenhuma resposta avaliada no período")}
                />
                <p className="text-xs text-muted-foreground tabular-nums">Avaliadas: {rateWithBase(rated, ["resposta da INIA", "respostas da INIA"])}</p>
                <p className="text-xs text-muted-foreground">Opinião de quem avaliou — não prova que a resposta estava correta.</p>
              </div>
            )
          }}
        </BlockBody>
      </SummaryCard>

      <SummaryCard icon={MessageSquareWarning} tone="warning" title="Feedbacks contestados" definition={DEFINITIONS.contestation}>
        <BlockBody block={blocks.feedback} name="feedback" lines={2}>
          {(data) => (
            <div className="space-y-2">
              <BigNumber
                value={rateValue(data.contestation)}
                muted={data.contestation.status !== "OK"}
                base={`${plural(data.counts.contested, ["contestado", "contestados"])} de ${plural(data.counts.delivered, ["feedback disponibilizado", "feedbacks disponibilizados"])}`}
              />
              <p className="text-xs text-muted-foreground tabular-nums">
                Procedentes: {rateWithBase(data.procedence.accepted, ["contestação revisada", "contestações revisadas"])}
                {data.counts.partial > 0 ? ` · em parte: ${data.counts.partial}` : ""}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">{plural(data.counts.pending, ["contestação aguardando revisão", "contestações aguardando revisão"])}</p>
            </div>
          )}
        </BlockBody>
      </SummaryCard>

      <SummaryCard icon={HeartHandshake} tone="neutral" title="Assertividade e erro segundo o Anjo" definition={DEFINITIONS.anjoAssertiveness}>
        <BlockState
          kind="unavailable"
          message="O Anjo registra o motivo do pedido de apoio e o resultado do atendimento, não se a resposta da INIA estava certa. Os motivos estão em Qualidade das respostas."
        />
      </SummaryCard>
    </div>
  )
}
