"use client"

import { useState } from "react"
import { MessageSquareReply, ThumbsDown, ThumbsUp } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { startUsageAction } from "@/lib/usage/usage-provider"
import { useMyFeedbackRatingsQuery, useRateFeedbackMutation } from "@/queries/feedback-ratings/use-feedback-ratings"
import { feedbackSourceKey, type FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"
import { formatShortDateTime } from "@/lib/format/date"
import { CONTESTATION_DECISION_LABELS, DISLIKE_REASON_COPY, FEEDBACK_DISLIKE_REASONS, FEEDBACK_RATING_COMMENT_LIMITS, type FeedbackDislikeReason, type FeedbackRating as FeedbackRatingValue } from "@/schemas/feedback-ratings/feedback-rating.schema"

/**
 * "Este conteúdo foi útil?" de um item do Acompanhamento — persistido (migration 113), só do próprio destinatário.
 *   Curtir: grava na hora; clicar de novo retira.
 *   Descurtir: abre um questionário curto (Popover, nunca Sheet): 1) o motivo; 2) o colaborador descreve o que está errado.
 *   Com a avaliação "não foi útil" já gravada, o mesmo botão reabre o questionário preenchido (editar ou retirar).
 */
export function FeedbackRating({ source }: { source: FeedbackSourceRef }) {
  const ratings = useMyFeedbackRatingsQuery()
  const rate = useRateFeedbackMutation()
  const [open, setOpen] = useState(false)
  const key = feedbackSourceKey(source)
  const current = ratings.data?.find((item) => feedbackSourceKey(item.source) === key) ?? null

  // Monitoria de usabilidade: a avaliação é uma ação com resultado (iniciada → confirmada pelo servidor | falhou).
  const usageEntity = { "data-usage-entity-type": source.kind, "data-usage-entity-id": source.id }
  function toggleUp() {
    const action = startUsageAction("feedback.rate")
    rate.mutate(current?.value === "UP" ? { source, value: "NONE" } : { source, value: "UP" }, {
      onSuccess: () => action.succeed(),
      onError: () => {
        action.fail("RATE_FAILED")
        toast.error("Não foi possível registrar sua avaliação. Tente de novo.")
      },
    })
  }

  return (
    <div className="flex items-center gap-1" data-slot="feedback-rating" {...usageEntity}>
      <span className="mr-1 text-[11px] font-normal" aria-live="polite">{current?.review ? "Sua contestação foi respondida" : current ? "Obrigado pelo retorno!" : "Este conteúdo foi útil?"}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Conteúdo útil"
        aria-pressed={current?.value === "UP"}
        className="aria-pressed:bg-primary/10 aria-pressed:text-primary dark:aria-pressed:text-chart-4"
        onClick={toggleUp}
        data-usage-element="feedback.rating.up"
      >
        <ThumbsUp className={current?.value === "UP" ? "fill-current" : undefined} />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Conteúdo não foi útil"
            aria-pressed={current?.value === "DOWN"}
            className="aria-pressed:bg-destructive/10 aria-pressed:text-destructive"
            data-usage-element="feedback.rating.down"
          >
            <ThumbsDown className={current?.value === "DOWN" ? "fill-current" : undefined} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 gap-0 p-0" aria-label="Por que este feedback não foi útil?" data-usage-screen="feedback.rating_reason" {...usageEntity}>
          <FeedbackDislikeForm
            initial={current?.value === "DOWN" ? current : null}
            pending={rate.isPending}
            onCancel={() => setOpen(false)}
            onRemove={() => {
              const action = startUsageAction("feedback.rate")
              rate.mutate({ source, value: "NONE" }, {
                onSuccess: () => {
                  action.succeed()
                  setOpen(false)
                },
                onError: () => {
                  action.fail("RATE_FAILED")
                  toast.error("Não foi possível retirar sua avaliação. Tente de novo.")
                },
              })
            }}
            onSubmit={(reason, comment, onError) => {
              const action = startUsageAction("feedback.rate")
              rate.mutate(
                { source, value: "DOWN", reason, comment },
                {
                  onSuccess: () => {
                    action.succeed()
                    setOpen(false)
                    toast.success("Obrigado! Seu retorno ajuda a INIA a melhorar.")
                  },
                  onError: () => {
                    action.fail("RATE_FAILED")
                    onError()
                  },
                },
              )
            }}
          />
        </PopoverContent>
      </Popover>
      {current?.value === "DOWN" && current.review ? <ContestationReview review={current.review} /> : null}
    </div>
  )
}

/** Resposta de quem revisou a contestação — discreta, ao lado dos botões (Popover, nunca Sheet). */
function ContestationReview({ review }: { review: NonNullable<FeedbackRatingValue["review"]> }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="xs" className="text-[11px] text-primary" data-usage-element="feedback.rating.review">
          <MessageSquareReply className="size-3.5" aria-hidden />
          Ver resposta
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 text-sm" aria-label="Resposta à sua contestação">
        <p className="text-xs font-semibold text-foreground">{CONTESTATION_DECISION_LABELS[review.decision]}</p>
        <p className="whitespace-pre-line text-muted-foreground">{review.response}</p>
        <p className="text-[11px] text-muted-foreground">Respondida em {formatShortDateTime(review.respondedAt)}. O feedback continua no seu Acompanhamento.</p>
      </PopoverContent>
    </Popover>
  )
}

export type FeedbackDislikeFormProps = {
  initial: FeedbackRatingValue | null
  pending: boolean
  onCancel: () => void
  onRemove: () => void
  onSubmit: (reason: FeedbackDislikeReason, comment: string, onError: () => void) => void
}

/** Questionário em duas etapas. Monta a cada abertura (o Popover desmonta o conteúdo ao fechar): começa da avaliação gravada. */
export function FeedbackDislikeForm({ initial, pending, onCancel, onRemove, onSubmit }: FeedbackDislikeFormProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [reason, setReason] = useState<FeedbackDislikeReason | null>(initial?.reason ?? null)
  const [comment, setComment] = useState(initial?.comment ?? "")
  const [error, setError] = useState<string | null>(null)
  const trimmed = comment.trim()
  const canSend = reason !== null && trimmed.length >= FEEDBACK_RATING_COMMENT_LIMITS.min && !pending

  if (step === 1 || reason === null) {
    return (
      <div className="flex flex-col">
        <div className="space-y-0.5 px-4 pt-4 pb-3">
          <p className="text-[11px] font-medium text-muted-foreground">Etapa 1 de 2</p>
          <p className="font-heading text-sm font-semibold">Por que este feedback não foi útil?</p>
        </div>
        <RadioGroup value={reason ?? ""} onValueChange={(value) => setReason(value as FeedbackDislikeReason)} aria-label="Motivo" className="gap-0 px-2">
          {FEEDBACK_DISLIKE_REASONS.map((option) => (
            <Label
              key={option}
              htmlFor={`dislike-reason-${option}`}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm font-normal hover:bg-muted has-data-[state=checked]:bg-muted"
            >
              <RadioGroupItem id={`dislike-reason-${option}`} value={option} />
              {DISLIKE_REASON_COPY[option].label}
            </Label>
          ))}
        </RadioGroup>
        <div className="mt-2 flex items-center gap-2 border-t px-4 py-3">
          {initial ? (
            <Button type="button" variant="link" size="sm" className="h-auto px-0 text-muted-foreground" disabled={pending} onClick={onRemove}>
              Retirar avaliação
            </Button>
          ) : null}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="button" size="sm" disabled={reason === null} onClick={() => setStep(2)}>
              Continuar
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const copy = DISLIKE_REASON_COPY[reason]
  return (
    <form
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSend) return
        setError(null)
        onSubmit(reason, trimmed, () => setError("Não foi possível enviar. Seu texto continua aqui — tente de novo."))
      }}
    >
      <div className="space-y-0.5 px-4 pt-4 pb-3">
        <p className="text-[11px] font-medium text-muted-foreground">Etapa 2 de 2 · {copy.label}</p>
        <Label htmlFor="dislike-comment" className="font-heading text-sm font-semibold">
          O que está errado?
        </Label>
      </div>
      <div className="px-4">
        <Textarea
          id="dislike-comment"
          autoFocus
          rows={4}
          value={comment}
          maxLength={FEEDBACK_RATING_COMMENT_LIMITS.max}
          placeholder={copy.prompt}
          className="min-h-24 resize-none"
          onChange={(event) => setComment(event.target.value)}
        />
        <p className="mt-1 text-right text-[11px] text-muted-foreground tabular-nums">
          {comment.length}/{FEEDBACK_RATING_COMMENT_LIMITS.max}
        </p>
        {error ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2 border-t px-4 py-3">
        <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => setStep(1)}>
          Voltar
        </Button>
        <Button type="submit" size="sm" className="ml-auto" disabled={!canSend} data-usage-element="feedback.rating.submit_reason">
          {pending ? "Enviando…" : "Enviar"}
        </Button>
      </div>
    </form>
  )
}
