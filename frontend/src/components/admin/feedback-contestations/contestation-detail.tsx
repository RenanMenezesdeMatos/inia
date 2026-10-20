"use client"

import { useState } from "react"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api/api-client"
import { formatShortDateTime } from "@/lib/format/date"
import { useContestationQuery, useReviewContestationMutation } from "@/queries/admin/use-feedback-contestation-queries"
import { CONTESTATION_RESPONSE_LIMITS, type ContestationDetail } from "@/schemas/admin/feedback-contestation.schema"
import { CONTESTATION_DECISION_LABELS, CONTESTATION_DECISIONS, DISLIKE_REASON_COPY, type ContestationDecision } from "@/schemas/feedback-ratings/feedback-rating.schema"

const DECISION_HELP: Record<ContestationDecision, string> = {
  ACCEPTED: "O colaborador tem razão: o feedback não condiz com o que aconteceu.",
  PARTIALLY_ACCEPTED: "Parte do que ele apontou procede; parte do feedback continua valendo.",
  REJECTED: "O feedback continua valendo; explique por quê.",
}

/** Uma contestação: o que o colaborador escreveu, o que a INIA disse no feedback e a resposta (ou o formulário para responder). */
export function ContestationDetailPanel({ contestationId, onBack }: { contestationId: string; onBack: () => void }) {
  const query = useContestationQuery(contestationId)
  if (query.isPending) return <div className="space-y-3 p-6" aria-label="Carregando contestação"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404
    return (
      <div className="space-y-3 p-6" role="alert">
        <BackButton onBack={onBack} />
        <p className="text-sm text-muted-foreground">{missing ? "Esta contestação não está no seu escopo ou o colaborador a retirou." : "Não foi possível carregar a contestação."}</p>
      </div>
    )
  }
  const item = query.data
  return (
    <article className="h-full space-y-5 overflow-y-auto p-4 sm:p-6" aria-label={`Contestação de ${item.collaborator.name}`}>
      <BackButton onBack={onBack} />
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{item.collaborator.name}</h2>
        <p className="text-sm text-muted-foreground">{[item.collaborator.teamName, item.collaborator.subteamName].filter(Boolean).join(" · ") || "Sem Grupo"} · contestou em {formatShortDateTime(item.contestedAt)}</p>
      </header>

      <section className="space-y-2" aria-labelledby="contestation-what">
        <h3 id="contestation-what" className="text-sm font-semibold">O que o colaborador disse</h3>
        <Badge variant="outline">{DISLIKE_REASON_COPY[item.reason].label}</Badge>
        <blockquote className="border-l-2 border-primary/40 pl-3 text-sm whitespace-pre-line">{item.comment}</blockquote>
      </section>

      <FeedbackContent item={item} />

      {item.review ? (
        <section className="space-y-2 rounded-lg border bg-muted/30 p-4" aria-labelledby="contestation-answer">
          <h3 id="contestation-answer" className="text-sm font-semibold">Resposta enviada</h3>
          <p className="text-sm font-medium">{CONTESTATION_DECISION_LABELS[item.review.decision]}</p>
          <p className="text-sm whitespace-pre-line text-muted-foreground">{item.review.response}</p>
          <p className="text-xs text-muted-foreground">{item.review.reviewerName} · {formatShortDateTime(item.review.respondedAt)}</p>
        </section>
      ) : (
        <ReviewForm contestationId={item.id} />
      )}
    </article>
  )
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" className="-ml-2 lg:hidden" onClick={onBack}>
      <ArrowLeft aria-hidden /> Voltar para a lista
    </Button>
  )
}

function FeedbackContent({ item }: { item: ContestationDetail }) {
  const candidates: { label: string; value: string | null }[] = item.content
    ? [
        { label: "Comportamento observado", value: item.content.observedBehavior },
        { label: "Evidência", value: item.content.evidenceFound },
        { label: "Procedimento", value: item.content.relatedProcedure },
        { label: "Recomendação", value: item.content.recommendation },
      ]
    : []
  const fields = candidates.flatMap((field) => (field.value?.trim() ? [[field.label, field.value] as const] : []))
  return (
    <section className="space-y-2" aria-labelledby="contestation-feedback">
      <h3 id="contestation-feedback" className="text-sm font-semibold">O que a INIA disse no feedback</h3>
      <p className="text-xs text-muted-foreground">
        {item.feedback.kind === "PUBLISHED_FEEDBACK" ? "Feedback publicado" : "Feedback de atendimento entregue"}
        {item.feedback.impactedIndicator ? ` · ${item.feedback.impactedIndicator}` : ""}
        {item.feedback.publishedAt ? ` · ${formatShortDateTime(item.feedback.publishedAt)}` : ""}
      </p>
      {fields.length > 0 ? (
        <dl className="space-y-2 rounded-lg border p-3 text-sm">
          {fields.map(([label, value]) => (
            <div key={label} className="space-y-0.5">
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd className="whitespace-pre-line">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">O texto deste feedback não está disponível aqui. Abra o Acompanhamento do colaborador para lê-lo.</p>
      )}
    </section>
  )
}

function ReviewForm({ contestationId }: { contestationId: string }) {
  const review = useReviewContestationMutation(contestationId)
  const [decision, setDecision] = useState<ContestationDecision | null>(null)
  const [response, setResponse] = useState("")
  const trimmed = response.trim()
  const canSend = decision !== null && trimmed.length >= CONTESTATION_RESPONSE_LIMITS.min && trimmed.length <= CONTESTATION_RESPONSE_LIMITS.max && !review.isPending

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!decision || !canSend) return
    review.mutate({ decision, response: trimmed }, {
      onSuccess: () => toast.success("Resposta enviada. O colaborador vai ver junto do feedback."),
      onError: (error) => toast.error(error instanceof ApiError && error.status === 409 ? error.message : "Não foi possível enviar a resposta. Tente de novo."),
    })
  }

  return (
    <form className="space-y-4 rounded-lg border p-4" onSubmit={submit} aria-labelledby="contestation-reply">
      <h3 id="contestation-reply" className="text-sm font-semibold">Responder ao colaborador</h3>
      <RadioGroup value={decision ?? ""} onValueChange={(value) => setDecision(value as ContestationDecision)} aria-label="Conclusão da revisão" className="gap-3">
        {CONTESTATION_DECISIONS.map((option) => (
          <div key={option} className="flex items-start gap-2">
            <RadioGroupItem value={option} id={`contestation-decision-${option}`} className="mt-0.5" />
            <Label htmlFor={`contestation-decision-${option}`} className="flex flex-col items-start gap-0.5 font-normal">
              <span className="font-medium">{CONTESTATION_DECISION_LABELS[option]}</span>
              <span className="text-xs text-muted-foreground">{DECISION_HELP[option]}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
      <div className="space-y-1.5">
        <Label htmlFor="contestation-response">Resposta</Label>
        <Textarea id="contestation-response" value={response} onChange={(event) => setResponse(event.target.value)} rows={5} maxLength={CONTESTATION_RESPONSE_LIMITS.max} placeholder="Explique ao colaborador o que você conferiu e a conclusão." />
        <p className="text-xs text-muted-foreground">A resposta é registrada com o seu nome e não altera o feedback.</p>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!canSend}>{review.isPending ? "Enviando…" : "Enviar resposta"}</Button>
      </div>
    </form>
  )
}
