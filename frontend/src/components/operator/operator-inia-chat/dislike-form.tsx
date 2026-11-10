"use client"

import { useState } from "react"
import { HeartHandshake, MessagesSquare, ThumbsDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useHumanSupportState } from "@/queries/human-support/use-human-support-state"
import {
  CHAT_DISLIKE_COMMENT_LIMITS,
  CHAT_DISLIKE_REASON_LABELS,
  CHAT_DISLIKE_REASONS,
  chatDislikeInputSchema,
  type ChatDislikeInput,
  type ChatDislikeReason,
  type ChatRatingDetails,
} from "@/schemas/operator/chat-rating.schema"

/**
 * DESCURTIDA DE UMA RESPOSTA DA INIA NO CHAT LIVRE (Apoio com Anjo, Parte A — design_draft.md seção 2). O polegar para baixo só ABRE
 * o formulário (Popover, nunca Sheet): motivo (lista própria do chat), comentário (obrigatório em "Outro") e "Você ainda precisa de
 * ajuda com isso?". "Enviar" grava tudo numa chamada e espera a confirmação; falha aparece no formulário; fechar sem enviar não grava
 * nada. Com a resposta já descurtida, o polegar reabre o formulário preenchido, com "Retirar avaliação". Depois de enviar com "Sim":
 * "Falar com um Anjo" quando o apoio está ligado para a pessoa (`onRequestSupport`); senão, o aviso de que ainda não está disponível.
 */
export type DislikeControlProps = {
  interactionId: string
  /** A resposta está descurtida agora (o polegar fica marcado e o formulário oferece "Retirar avaliação"). */
  disliked: boolean
  /** O motivo gravado na versão vigente (null = descurtida sem motivo, ou nenhuma). */
  initial: ChatRatingDetails | null
  /** Grava a descurtida com o motivo; devolve a versão gravada. Rejeita com a mensagem a mostrar. */
  onSubmit: (input: ChatDislikeInput) => Promise<{ ratingId: string | null }>
  /** Retira a avaliação (grava `NONE`). Rejeita com a mensagem a mostrar. */
  onRemove: () => Promise<void>
  /** Abre o pedido de apoio desta resposta (Parte B). Ausente = o apoio não está disponível para a pessoa. */
  onRequestSupport?: (interactionId: string, ratingId: string) => void
  disabled?: boolean
}

export function DislikeControl({ interactionId, disliked, initial, onSubmit, onRemove, onRequestSupport, disabled }: DislikeControlProps) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Resposta não foi útil"
          aria-pressed={disliked}
          className="aria-pressed:bg-destructive/10 aria-pressed:text-destructive"
          disabled={disabled}
        >
          <ThumbsDown className={disliked ? "fill-current" : undefined} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0" aria-label="Por que esta resposta não foi útil?">
        <DislikeForm
          initial={initial}
          removable={disliked}
          onSubmit={onSubmit}
          onRemove={onRemove}
          onClose={() => setOpen(false)}
          {...(onRequestSupport ? { onRequestSupport: (ratingId: string) => onRequestSupport(interactionId, ratingId) } : {})}
        />
      </PopoverContent>
    </Popover>
  )
}

export type DislikeFormProps = {
  initial: ChatRatingDetails | null
  removable: boolean
  onSubmit: (input: ChatDislikeInput) => Promise<{ ratingId: string | null }>
  onRemove: () => Promise<void>
  onClose: () => void
  onRequestSupport?: (ratingId: string) => void
}

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)

/** O formulário monta a cada abertura (o Popover desmonta o conteúdo ao fechar): começa do motivo gravado. */
export function DislikeForm({ initial, removable, onSubmit, onRemove, onClose, onRequestSupport }: DislikeFormProps) {
  const [reason, setReason] = useState<ChatDislikeReason | null>(initial?.reason ?? null)
  const [comment, setComment] = useState(initial?.comment ?? "")
  const [stillNeedsHelp, setStillNeedsHelp] = useState<boolean | null>(initial?.stillNeedsHelp ?? null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Enviado com "Sim": o formulário mostra o caminho para o apoio (ou o aviso de que ele ainda não existe para a equipe).
  const [sent, setSent] = useState<{ ratingId: string | null } | null>(null)
  const supportAlreadyOpen = Boolean(useHumanSupportState().operator?.openRequest)

  const input = reason !== null && stillNeedsHelp !== null ? { reason, comment, stillNeedsHelp } : null
  const validation = input ? chatDislikeInputSchema.safeParse(input) : null
  const commentIssue = validation && !validation.success ? (validation.error.issues.find((issue) => issue.path[0] === "comment")?.message ?? null) : null
  const commentRequired = reason === "OTHER"
  const trimmedLength = comment.trim().length
  const showCommentIssue = trimmedLength > 0 && trimmedLength < CHAT_DISLIKE_COMMENT_LIMITS.min
  const canSend = Boolean(validation?.success) && !pending

  if (sent) {
    return (
      <div className="flex flex-col gap-3 p-4" data-testid="dislike-sent">
        <p className="font-heading text-sm font-semibold">Obrigado pelo retorno.</p>
        {onRequestSupport && sent.ratingId ? (
          <>
            {/* Com pedido já aberto, o caminho é o pedido que existe (um por vez): quem chama abre a sala em vez da janela. */}
            <p className="text-sm text-muted-foreground">{supportAlreadyOpen ? "Você já tem um pedido de apoio." : "Um Anjo pode ajudar você com essa dúvida."}</p>
            <Button
              type="button"
              size="sm"
              variant={supportAlreadyOpen ? "outline" : "default"}
              className="h-9 w-fit rounded-full px-4"
              {...(supportAlreadyOpen ? {} : { "aria-haspopup": "dialog" as const })}
              onClick={() => {
                onRequestSupport(sent.ratingId!)
                onClose()
              }}
            >
              {supportAlreadyOpen ? <MessagesSquare /> : <HeartHandshake />}
              {supportAlreadyOpen ? "Ver pedido" : "Falar com um Anjo"}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">O apoio com Anjo ainda não está disponível para sua equipe.</p>
        )}
        <Button type="button" variant="ghost" size="sm" className="-ml-2 w-fit" onClick={onClose}>
          Fechar
        </Button>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault()
        if (!canSend || !validation?.success) return
        setPending(true)
        setError(null)
        try {
          const saved = await onSubmit(validation.data)
          if (validation.data.stillNeedsHelp) setSent(saved)
          else onClose()
        } catch (failure) {
          setError(errorText(failure, "Não foi possível enviar. Suas respostas continuam aqui — tente de novo."))
        } finally {
          setPending(false)
        }
      }}
    >
      <div className="px-4 pt-4 pb-2">
        <p className="font-heading text-sm font-semibold">Por que esta resposta não foi útil?</p>
      </div>
      <RadioGroup value={reason ?? ""} onValueChange={(value) => setReason(value as ChatDislikeReason)} aria-label="Motivo" className="gap-0 px-2">
        {CHAT_DISLIKE_REASONS.map((option) => (
          <Label
            key={option}
            htmlFor={`chat-dislike-reason-${option}`}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-muted has-data-[state=checked]:bg-muted"
          >
            <RadioGroupItem id={`chat-dislike-reason-${option}`} value={option} />
            {CHAT_DISLIKE_REASON_LABELS[option]}
          </Label>
        ))}
      </RadioGroup>
      <div className="space-y-1 px-4 pt-3">
        <Label htmlFor="chat-dislike-comment" className="text-xs font-medium">
          {commentRequired ? "Conte o que aconteceu" : "Comentário (opcional)"}
        </Label>
        <Textarea
          id="chat-dislike-comment"
          rows={3}
          value={comment}
          maxLength={CHAT_DISLIKE_COMMENT_LIMITS.max}
          aria-invalid={showCommentIssue || undefined}
          aria-describedby="chat-dislike-comment-count"
          className="min-h-16 resize-none"
          onChange={(event) => setComment(event.target.value)}
        />
        <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
          <span className={cn(showCommentIssue && "text-destructive")}>{showCommentIssue ? commentIssue : commentRequired && trimmedLength === 0 ? "Obrigatório quando o motivo é “Outro”." : null}</span>
          <span id="chat-dislike-comment-count" className="shrink-0 tabular-nums">
            {comment.length}/{CHAT_DISLIKE_COMMENT_LIMITS.max}
          </span>
        </div>
      </div>
      <div className="space-y-1.5 px-4 pt-2">
        <p id="chat-dislike-help-label" className="text-xs font-medium">
          Você ainda precisa de ajuda com isso?
        </p>
        <RadioGroup value={stillNeedsHelp === null ? "" : stillNeedsHelp ? "YES" : "NO"} onValueChange={(value) => setStillNeedsHelp(value === "YES")} aria-labelledby="chat-dislike-help-label" className="flex gap-4">
          {[
            { value: "YES", label: "Sim" },
            { value: "NO", label: "Não" },
          ].map((option) => (
            <Label key={option.value} htmlFor={`chat-dislike-help-${option.value}`} className="flex cursor-pointer items-center gap-2 text-sm font-normal">
              <RadioGroupItem id={`chat-dislike-help-${option.value}`} value={option.value} />
              {option.label}
            </Label>
          ))}
        </RadioGroup>
      </div>
      {error ? (
        <p role="alert" className="px-4 pt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex items-center gap-2 border-t px-4 py-3">
        {removable ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0 text-muted-foreground"
            disabled={pending}
            onClick={async () => {
              setPending(true)
              setError(null)
              try {
                await onRemove()
                onClose()
              } catch (failure) {
                setError(errorText(failure, "Não foi possível retirar a avaliação. Tente de novo."))
              } finally {
                setPending(false)
              }
            }}
          >
            Retirar avaliação
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={!canSend}>
            {pending ? "Enviando…" : "Enviar"}
          </Button>
        </div>
      </div>
    </form>
  )
}
