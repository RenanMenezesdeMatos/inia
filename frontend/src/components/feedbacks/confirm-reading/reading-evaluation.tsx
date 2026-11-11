"use client"

import { useId, useState } from "react"
import { ChevronDown, Handshake, History, MessageSquareReply, MessageSquareWarning } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatShortDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useConfirmedReading } from "@/queries/feedback-read-confirmations/use-feedback-read-confirmation"
import type { FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"
import { CONTESTATION_DECISION_LABELS, CONTESTATION_REASON_COPY, type ContestationReason, type ContestationReview, type FeedbackEvaluation } from "@/schemas/feedback-ratings/feedback-rating.schema"
import type { ReadConfirmationEntryPoint } from "@/schemas/feedback-read-confirmations/feedback-read-confirmation.schema"

import { ReadingConfirmationDialog } from "./reading-confirmation-dialog"

type Props = {
  source: FeedbackSourceRef
  title?: string | null | undefined
  /** Ciência que veio do servidor (o mapa desta sessão do navegador cobre a confirmação feita agora). */
  acknowledgedAt: string | null
  /** Avaliação que veio do servidor; quando traz a escolha, vale ela (tem também a resposta da revisão). */
  evaluation: FeedbackEvaluation | null | undefined
  entryPoint?: ReadConfirmationEntryPoint
}

/**
 * Rodapé do item do Acompanhamento do PRÓPRIO colaborador — o que ele registrou sobre o feedback, sempre visível (mesmo com o
 * item fechado), no lugar do antigo "Este conteúdo foi útil?":
 *   - a escolha da ciência ("Você concordou…" / "Você não concordou…" + motivo, justificativa e a resposta da revisão);
 *   - ciência anterior à escolha: "Dizer se concorda" (registro único, mesmo diálogo, login e senha);
 *   - a avaliação "não foi útil" antiga, com ou sem ciência, e a resposta dela.
 * Textos do colaborador e da revisão são texto puro (nunca Markdown). Nada aqui é só de tela: tudo vem do backend.
 */
export function ReadingEvaluation({ source, title, acknowledgedAt, evaluation, entryPoint = "FOLLOW_UP_FEED" }: Props) {
  const confirmedHere = useConfirmedReading(source)
  const acknowledged = confirmedHere?.acknowledgedAt ?? acknowledgedAt
  const agreement = evaluation?.agreement ?? confirmedHere?.agreement ?? null
  const legacy = evaluation?.legacyContestation ?? null
  if (!agreement && !acknowledged && !legacy) return null

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5" data-slot="reading-evaluation" data-usage-entity-type={source.kind} data-usage-entity-id={source.id}>
      {agreement ? (
        agreement.value === "AGREE" ? (
          <p className="flex items-center gap-1.5" data-testid="agreement-line">
            <Handshake className="size-3.5 shrink-0" aria-hidden />
            Você concordou com o feedback.
          </p>
        ) : (
          <Contestation
            icon={<MessageSquareWarning className="size-3.5 shrink-0" aria-hidden />}
            summary="Você não concordou com o feedback."
            reason={agreement.reason!}
            textLabel="Sua justificativa"
            text={agreement.justification ?? ""}
            at={agreement.recordedAt}
            review={agreement.review}
            testId="agreement-line"
          />
        )
      ) : acknowledged ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5" data-testid="agreement-missing">
          <span>Você ainda não disse se concorda com este feedback.</span>
          <ReadingConfirmationDialog
            source={source}
            entryPoint={entryPoint}
            purpose="REGISTER_AGREEMENT"
            title={title}
            trigger={(openDialog) => (
              <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={openDialog} data-usage-element="feedback.evaluation.register">
                Dizer se concorda
              </Button>
            )}
          />
        </div>
      ) : null}
      {legacy ? (
        <Contestation
          icon={<History className="size-3.5 shrink-0" aria-hidden />}
          summary="Avaliação anterior: não foi útil."
          reason={legacy.reason}
          textLabel="Sua descrição"
          text={legacy.comment}
          at={legacy.contestedAt}
          review={legacy.review}
          testId="legacy-contestation"
        />
      ) : null}
    </div>
  )
}

/** Uma contestação (discordância ou "não foi útil" antigo): resumo + situação na linha; motivo, texto e resposta ao abrir. */
function Contestation({ icon, summary, reason, textLabel, text, at, review, testId }: { icon: React.ReactNode; summary: string; reason: ContestationReason; textLabel: string; text: string; at: string; review: ContestationReview | null; testId: string }) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {icon}
        <span>{summary}</span>
        <span aria-hidden className="text-muted-foreground/50">·</span>
        <span className={cn(review ? "text-primary dark:text-chart-4" : undefined)}>{review ? "Resposta da revisão disponível" : "Aguardando resposta da revisão"}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-6 gap-1 px-1.5 text-[11px]"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((current) => !current)}
          data-usage-element="feedback.evaluation.details"
        >
          {open ? "Ocultar detalhes" : "Ver detalhes"}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        </Button>
      </div>
      {open ? (
        <div id={detailsId} className="mt-1.5 space-y-2 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Motivo:</span> {CONTESTATION_REASON_COPY[reason].label}
          </p>
          <div>
            <p className="font-medium text-foreground">{textLabel}</p>
            <p className="whitespace-pre-line break-words">{text}</p>
            <p className="mt-0.5 text-[11px]">Enviada em {formatShortDateTime(at)}.</p>
          </div>
          {review ? (
            <div className="rounded-lg bg-background/70 p-2" data-testid="contestation-review">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <MessageSquareReply className="size-3.5" aria-hidden />
                Resposta da revisão · {CONTESTATION_DECISION_LABELS[review.decision]}
              </p>
              <p className="whitespace-pre-line break-words">{review.response}</p>
              <p className="mt-0.5 text-[11px]">Respondida em {formatShortDateTime(review.respondedAt)}. O feedback continua no seu Acompanhamento.</p>
            </div>
          ) : (
            <p>Quem revisa os feedbacks da sua equipe vai responder aqui. Você recebe um aviso quando a resposta chegar.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
