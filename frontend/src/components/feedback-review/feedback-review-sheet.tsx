"use client"

import { useId, useState } from "react"
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, FlaskConical, Gavel, Info, ListOrdered, MessageSquareQuote, MessageSquareText, PencilLine, ShieldAlert, XCircle } from "lucide-react"
import { toast } from "sonner"

import { AnalyticsErrorState } from "@/components/analytics/analytics-states"
import { RichContent } from "@/components/rich-content/rich-content"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api/api-client"
import { formatDateTime } from "@/lib/format/date"
import { feedbackReviewKeys } from "@/queries/feedback-review/feedback-review-query-keys"
import { useCheckFeedbackReviewEditMutation, useDecideFeedbackReviewMutation, useFeedbackReviewQuery } from "@/queries/feedback-review/use-feedback-reviews"
import { feedbackReviewDetailSchema, WORDING_FIELDS, type EditViolation, type FeedbackPreview, type FeedbackPreviewTechnical, type FeedbackReviewDetail, type ItemWording, type WordingFieldKey } from "@/schemas/feedback-review/feedback-review.schema"
import { cn } from "@/lib/utils"
import { useQueryClient } from "@tanstack/react-query"

const COMMENT_MAX = 2000

/**
 * Detalhe de UM item no QA de feedback (QA Lab › Feedbacks). V1.7.1e — a tela responde, NESTA ORDEM:
 *   1. O que a INIA quer dizer ao colaborador?   → o FEEDBACK COMPLETO, exatamente como ele receberia (mesmo renderizador da
 *                                                   publicação; pendentes aparecem como se aprovados sem edição);
 *   2. Por que a INIA acredita que pode dizer isso? → evidências de cada ponto ("Ver evidências", recolhido);
 *   3. O que eu preciso decidir?                  → por que este ponto está no QA (linguagem humana) e a decisão, com o
 *                                                   efeito real de aprovar/editar/rejeitar.
 * Os detalhes técnicos (tipo da evidência, aplicabilidade, confiabilidade, validações) existem, mas recolhidos. A avaliação é
 * POR PONTO (única; a mais nova vence em outra aba = 409) e nunca muda a disposição estrutural nem a evidência.
 */
export function FeedbackReviewSheet({ reviewId, onOpenChange, onNavigate }: { reviewId: string | null; onOpenChange: (open: boolean) => void; onNavigate?: (reviewId: string) => void }) {
  const query = useFeedbackReviewQuery(reviewId)
  return (
    <Sheet open={reviewId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-3xl">
        {query.isPending && reviewId ? <SheetSkeleton /> : null}
        {query.isError ? (
          <div className="p-6">
            <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : null}
        {query.data ? <ReviewBody key={`${query.data.reviewId}:${query.data.status}`} detail={query.data} onNavigate={onNavigate} /> : null}
      </SheetContent>
    </Sheet>
  )
}

type Mode = { kind: "view" } | { kind: "confirm-approve" } | { kind: "edit" } | { kind: "reject" }

const DEFAULT_EFFECTS = {
  summary: "Você está avaliando a qualidade do feedback que a INIA pretende enviar. Aprovar não altera a evidência encontrada; apenas autoriza este texto a seguir.",
  approve: "Autoriza este ponto, como está.",
  edit: "Permite ajustar a redação sem alterar os fatos suportados.",
  reject: "Impede que este ponto seja enviado.",
}

function ReviewBody({ detail, onNavigate }: { detail: FeedbackReviewDetail; onNavigate?: (reviewId: string) => void }) {
  const [mode, setMode] = useState<Mode>({ kind: "view" })
  const decide = useDecideFeedbackReviewMutation()
  const queryClient = useQueryClient()
  const pending = detail.status === "PENDING_REVIEW"
  const effects = detail.decisionEffects ?? DEFAULT_EFFECTS
  const pointLabel = detail.findingLabel ?? detail.sectionLabel
  const explanations = detail.selection.explanations.length > 0 ? detail.selection.explanations : detail.selection.reasons

  function submit(input: Parameters<typeof decide.mutate>[0]["input"], onBlocked?: (violations: EditViolation[]) => void) {
    decide.mutate(
      { reviewId: detail.reviewId, input },
      {
        onSuccess: (updated) => {
          setMode({ kind: "view" })
          toast.success(`${updated.statusLabel}. ${updated.deliveryStateLabel}`)
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === "FEEDBACK_REVIEW_ALREADY_DECIDED") {
            const current = feedbackReviewDetailSchema.safeParse((error.details as { current?: unknown } | undefined)?.current)
            if (current.success) queryClient.setQueryData(feedbackReviewKeys.detail(detail.reviewId), current.data)
            setMode({ kind: "view" })
            toast.error("Este feedback já foi avaliado por outra pessoa ou em outra aba. O painel mostra a avaliação registrada.")
            return
          }
          if (error instanceof ApiError && error.code === "FEEDBACK_REVIEW_EDIT_BLOCKED" && onBlocked) {
            onBlocked(((error.details as { violations?: EditViolation[] } | undefined)?.violations ?? []))
            return
          }
          toast.error(error instanceof Error ? error.message : "Não foi possível registrar a avaliação.")
        },
      },
    )
  }

  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-0 bg-muted">QA de feedback</Badge>
          <StatusBadge detail={detail} />
        </div>
        <SheetTitle className="text-lg">{detail.collaborator.name}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {detail.team ? <span>{detail.team.name}</span> : null}
          {detail.collaborator.jobTitle ? <span>{detail.collaborator.jobTitle}</span> : null}
          <span>Atendimento: {detail.occurredAt ? formatDateTime(detail.occurredAt) : detail.interactionLabel}</span>
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="space-y-6 p-4">
          <p className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-sm" role="note">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{effects.summary}</span>
          </p>

          <Section icon={MessageSquareText} title="Feedback que será enviado">
            {detail.feedbackPreview ? (
              <FeedbackPreviewView preview={detail.feedbackPreview} onNavigate={onNavigate} />
            ) : (
              <div className="rounded-xl border border-border p-4">
                <WordingView wording={detail.finalWording ?? detail.proposedWording} optionalGuidance={detail.origin === "WORKFLOW"} example={detail.suggestedResponse} />
              </div>
            )}
          </Section>

          <Section icon={ShieldAlert} title="Por que precisa da sua avaliação">
            {explanations.length > 0 ? (
              <ul className="space-y-2 text-sm leading-6" aria-label="Motivos da avaliação">
                {explanations.map((text) => <li key={text} className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">{text}</li>)}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Selecionado para avaliação pela política de entrega.</p>
            )}
          </Section>

          <Section icon={Gavel} title={pending ? "Sua decisão" : "Decisão registrada"}>
            <p className="text-sm">
              Ponto em avaliação: <span className="font-medium">{pointLabel}</span> <span className="text-muted-foreground">({detail.sectionLabel.toLowerCase()})</span>
            </p>
            {detail.proposedIsFallback ? (
              <p className="text-xs text-muted-foreground">Texto deste ponto montado pelo texto de segurança (sem o redator automático).</p>
            ) : null}
            {mode.kind === "edit" && pending ? (
              <EditForm detail={detail} busy={decide.isPending} onCancel={() => setMode({ kind: "view" })} onSubmit={(input, onBlocked) => submit({ decision: "APPROVED_EDITED", ...input }, onBlocked)} />
            ) : detail.feedbackPreview ? (
              <div className="rounded-xl border border-border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Texto deste ponto (o que você aprova, edita ou rejeita)</p>
                <WordingView wording={detail.finalWording ?? detail.proposedWording} optionalGuidance={detail.origin === "WORKFLOW"} example={detail.suggestedResponse} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">O texto acima é o deste ponto — é ele que você aprova, edita ou rejeita.</p>
            )}
            {detail.status === "APPROVED_EDITED" ? (
              <details className="rounded-xl border border-border p-3 text-sm">
                <summary className="cursor-pointer text-muted-foreground">Ver o texto proposto antes da edição</summary>
                <div className="mt-3"><WordingView wording={detail.proposedWording} optionalGuidance={detail.origin === "WORKFLOW"} example={detail.suggestedResponse} /></div>
              </details>
            ) : null}
            {pending && mode.kind !== "edit" ? (
              <dl className="grid gap-2 text-sm sm:grid-cols-3" aria-label="O que cada decisão faz">
                <div className="rounded-xl bg-muted/40 p-3"><dt className="font-medium">Aprovar</dt><dd className="mt-1 text-muted-foreground">{effects.approve}</dd></div>
                <div className="rounded-xl bg-muted/40 p-3"><dt className="font-medium">Editar</dt><dd className="mt-1 text-muted-foreground">{effects.edit}</dd></div>
                <div className="rounded-xl bg-muted/40 p-3"><dt className="font-medium">Rejeitar</dt><dd className="mt-1 text-muted-foreground">{effects.reject}</dd></div>
              </dl>
            ) : null}
            {mode.kind === "reject" && pending ? <RejectForm detail={detail} busy={decide.isPending} onCancel={() => setMode({ kind: "view" })} onSubmit={(input) => submit({ decision: "REJECTED", ...input })} /> : null}
            {detail.decision ? <DecisionSummary detail={detail} /> : null}
          </Section>

          <TechnicalDetails detail={detail} />
        </div>
      </div>

      <div className="border-t p-4">
        {pending ? (
          mode.kind === "view" || mode.kind === "confirm-approve" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={decide.isPending} onClick={() => setMode({ kind: "confirm-approve" })}>
                <CheckCircle2 aria-hidden /> Aprovar
              </Button>
              <Button variant="outline" disabled={decide.isPending} onClick={() => setMode({ kind: "edit" })}>
                <PencilLine aria-hidden /> Editar
              </Button>
              <Button variant="outline" className="text-destructive" disabled={decide.isPending} onClick={() => setMode({ kind: "reject" })}>
                <XCircle aria-hidden /> Rejeitar
              </Button>
              <span className="text-xs text-muted-foreground">A avaliação é deste ponto e é única.</span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Preencha o formulário acima para concluir a avaliação.</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">{detail.deliveryStateLabel}</p>
        )}
      </div>

      <AlertDialog open={mode.kind === "confirm-approve"} onOpenChange={(open) => (!open && !decide.isPending ? setMode({ kind: "view" }) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar este ponto sem edição?</AlertDialogTitle>
            <AlertDialogDescription>{effects.approve} A avaliação de “{pointLabel}” para {detail.collaborator.name} não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={decide.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction disabled={decide.isPending} onClick={(event) => { event.preventDefault(); submit({ decision: "APPROVED_UNCHANGED" }) }}>
              {decide.isPending ? "Registrando…" : "Aprovar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

const PREVIEW_STATUS_STYLES: Record<string, string> = {
  PENDING_REVIEW: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  APPROVED_UNCHANGED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  APPROVED_EDITED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  READY: "bg-muted text-muted-foreground",
  REJECTED: "bg-muted text-muted-foreground line-through",
  BLOCKED: "bg-muted text-muted-foreground",
}

/**
 * V1.7.1e — o FEEDBACK COMPLETO como o colaborador receberia. Cada bloco de achado mostra o estado de QA dos seus pontos, o
 * atalho para avaliar os outros pontos pendentes e "Ver evidências" (detalhes técnicos daquele bloco, recolhidos).
 */
function FeedbackPreviewView({ preview, onNavigate }: { preview: FeedbackPreview; onNavigate?: (reviewId: string) => void }) {
  const byIndex = new Map(preview.items.map((item) => [item.itemIndex, item]))
  const outside = preview.items.filter((item) => !item.inPreview)
  const total = preview.items.filter((item) => item.reviewId !== null).length
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{preview.basisLabel}</p>
      {total > 0 ? (
        <p className="text-sm" role="status">
          {preview.pending === 0
            ? "Todos os pontos desta análise já foram avaliados."
            : `${preview.pending} de ${total} ${total === 1 ? "ponto aguarda" : "pontos aguardam"} avaliação — o feedback só segue depois que todos forem avaliados.`}
        </p>
      ) : null}
      <article className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-label="Prévia do feedback completo">
        {preview.parts.map((part, index) => {
          if (part.kind !== "FINDING") return <RichContent key={index} text={part.markdown} />
          const items = part.itemIndexes.map((itemIndex) => byIndex.get(itemIndex)).filter((item): item is FeedbackPreview["items"][number] => Boolean(item))
          const current = items.some((item) => item.isCurrent)
          return (
            <section key={index} className={current ? "space-y-2 rounded-xl border-2 border-primary/60 bg-primary/5 p-3" : "space-y-2 rounded-xl border border-border p-3"} aria-label={`Achado: ${part.label ?? "ponto"}`} data-current={current ? "true" : undefined}>
              <div className="flex flex-wrap items-center gap-1.5">
                {current ? <Badge className="bg-primary text-primary-foreground">Em avaliação agora</Badge> : null}
                {items.map((item) => (
                  <span key={item.itemIndex} className="inline-flex items-center gap-1">
                    <Badge variant="outline" className={cn("border-0", PREVIEW_STATUS_STYLES[item.status] ?? "bg-muted")}>{item.sectionLabel} · {item.statusLabel}</Badge>
                    {!item.isCurrent && item.status === "PENDING_REVIEW" && item.reviewId && onNavigate ? (
                      <Button type="button" variant="link" size="sm" className="h-auto px-1 py-0 text-xs" onClick={() => onNavigate(item.reviewId!)}>
                        Avaliar este ponto
                      </Button>
                    ) : null}
                  </span>
                ))}
              </div>
              <RichContent text={part.markdown} />
              <details className="rounded-lg border border-dashed border-border p-2 text-sm">
                <summary className="cursor-pointer text-muted-foreground">Ver evidências</summary>
                <div className="mt-2 space-y-3">{items.map((item) => <TechnicalItem key={item.itemIndex} item={item} />)}</div>
              </details>
            </section>
          )
        })}
      </article>
      {outside.length > 0 ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium">Fora do texto enviado</p>
          <ul className="space-y-1 text-muted-foreground">
            {outside.map((item) => <li key={item.itemIndex}>{item.label} — {item.statusLabel}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/** Detalhes técnicos de UM ponto: fala, regra, seção, documento, aplicabilidade, tipo da evidência, confiabilidade, validações. */
function TechnicalItem({ item }: { item: FeedbackPreview["items"][number] }) {
  const technical: FeedbackPreviewTechnical = item.technical
  const knowledge = technical.knowledge
  return (
    <div role="group" className="space-y-2 rounded-lg bg-muted/30 p-2" aria-label={`Evidências: ${item.label}`}>
      <p className="font-medium">{item.label} <span className="font-normal text-muted-foreground">· {item.sectionLabel} · {item.statusLabel}</span></p>
      {technical.facts.length > 0 ? (
        <ul className="space-y-1">
          {technical.facts.map((fact, index) => (
            <li key={index}>
              <span className="text-xs text-muted-foreground">{fact.speakerLabel}</span>
              {/* Citação literal da conversa — nunca Markdown. */}
              <p className="whitespace-pre-wrap break-words">“{fact.text}{fact.truncated ? "…" : ""}”</p>
            </li>
          ))}
        </ul>
      ) : null}
      {knowledge ? (
        <div className="space-y-1">
          {knowledge.operativeRule ? (
            <p><span className="text-xs text-muted-foreground">Regra usada para orientar{knowledge.operativeRule.reason ? ` (${knowledge.operativeRule.reason})` : ""}:</span><span className="block whitespace-pre-wrap break-words">“{knowledge.operativeRule.quote}”</span></p>
          ) : null}
          <p><span className="text-xs text-muted-foreground">Trecho citado · {knowledge.kindLabel}{knowledge.section ? ` · Seção: ${knowledge.section}` : ""}:</span><span className="block whitespace-pre-wrap break-words">“{knowledge.quote}”</span></p>
          {knowledge.detail ? <p><span className="text-xs text-muted-foreground">Trecho complementar · {knowledge.detail.kindLabel}{knowledge.detail.section ? ` · Seção: ${knowledge.detail.section}` : ""}:</span><span className="block whitespace-pre-wrap break-words">“{knowledge.detail.quote}”</span></p> : null}
          <a href={knowledge.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            {knowledge.documentTitle}{knowledge.version !== null ? ` (versão ${knowledge.version})` : ""}
            <ExternalLink className="size-3.5" aria-hidden />
            <span className="sr-only">(abre em nova aba)</span>
          </a>
          <p className="text-xs text-muted-foreground">Aplicabilidade: {knowledge.applicabilityLabel}</p>
        </div>
      ) : null}
      <dl className="grid gap-x-3 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-[auto_1fr]">
        {technical.internalStep ? <><dt>Etapa (nome interno)</dt><dd>{technical.internalStep}</dd></> : null}
        {technical.evidenceTypeLabel ? <><dt>Tipo da evidência</dt><dd>{technical.evidenceTypeLabel}</dd></> : null}
        <dt>Confiabilidade</dt><dd>{technical.reliability.dispositionLabel}</dd>
        {technical.wordingSourceLabel ? <><dt>Texto</dt><dd>{technical.wordingSourceLabel}</dd></> : null}
      </dl>
      {technical.validationWarnings.length > 0 ? (
        <div className="text-xs">
          <p className="text-muted-foreground">Avisos de validação do texto do redator:</p>
          <ul className="list-disc pl-5">{technical.validationWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      ) : null}
      {technical.completeness ? (
        <div className="text-xs">
          <p className="text-muted-foreground">Etapa composta — completude: {technical.completeness.statusLabel}</p>
          <ul className="list-disc pl-5">{technical.completeness.groups.map((group) => <li key={group.label}>{group.label}: {group.items.join("; ")}</li>)}</ul>
        </div>
      ) : null}
      {technical.analyticReadiness ? (
        <div className="text-xs">
          <p className="text-muted-foreground">Prontidão analítica: {technical.analyticReadiness.statusLabel} · {technical.analyticReadiness.eligibleLabel}</p>
          {technical.analyticReadiness.reasons.length > 0 ? <ul className="list-disc pl-5">{technical.analyticReadiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
        </div>
      ) : null}
      {technical.fieldValidation && technical.fieldValidation.length > 0 ? (
        <div className="text-xs">
          <p className="text-muted-foreground">Campos do redator ajustados:</p>
          <ul className="list-disc pl-5">{technical.fieldValidation.map((entry) => <li key={entry.field}>{entry.field}: {entry.action}{entry.reasons.length > 0 ? ` — ${entry.reasons.join(" ")}` : ""}</li>)}</ul>
        </div>
      ) : null}
    </div>
  )
}

/** Os detalhes técnicos do ponto em avaliação (antes eram a tela principal): recolhidos por padrão. */
function TechnicalDetails({ detail }: { detail: FeedbackReviewDetail }) {
  return (
    <details className="rounded-xl border border-border p-3" aria-label="Detalhes técnicos">
      <summary className="cursor-pointer text-sm font-medium">Detalhes técnicos</summary>
      <div className="mt-4 space-y-6">
          <Section icon={FileText} title="O que aconteceu">
            <p className="text-sm leading-6"><span className="font-medium">{detail.kindLabel}.</span> {capitalize(detail.meaning)}.</p>
            <p className="text-xs text-muted-foreground">{detail.guidanceLabel} · {capitalize(detail.uncertainty)}.</p>
          </Section>

          <Section icon={MessageSquareQuote} title="Evidência da conversa">
            {detail.evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum trecho exibível para este ponto.</p>
            ) : (
              <ul className="space-y-2">
                {detail.evidence.map((entry, index) => (
                  <li key={index} className="rounded-xl bg-muted/40 p-3 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">{entry.speakerLabel}</span>
                    {/* Citação literal da conversa — nunca Markdown. */}
                    <p className="mt-0.5 leading-6 whitespace-pre-wrap break-words">“{entry.text}{entry.truncated ? "…" : ""}”</p>
                  </li>
                ))}
              </ul>
            )}
            {detail.evidence.some((entry) => entry.masked) ? <p className="text-xs text-muted-foreground">Dados pessoais aparecem mascarados (ex.: [CPF], [PROTOCOLO]).</p> : null}
            {detail.evidenceWithheldCount > 0 ? <p className="text-xs text-muted-foreground">{detail.evidenceWithheldCount === 1 ? "1 trecho foi ocultado por privacidade." : `${detail.evidenceWithheldCount} trechos foram ocultados por privacidade.`}</p> : null}
          </Section>
          {detail.processBasis ? (
            <Section icon={FileText} title="Base do processo">
              <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
                {detail.processBasis.stepTitle || detail.processBasis.requirement ? <p><span className="font-medium">Etapa (nome interno):</span> {detail.processBasis.stepTitle ?? detail.processBasis.requirement}{detail.processBasis.statusLabel ? ` · ${detail.processBasis.statusLabel}` : ""}</p> : null}
                {detail.processBasis.evidenceTypeLabel ? <p><span className="font-medium">Evidência:</span> {detail.processBasis.evidenceTypeLabel}</p> : null}
                {/* Trecho literal da versão publicada do documento (abertura da lista + etapa + como cumprir) — nunca Markdown. */}
                <blockquote className="border-l-2 border-border pl-3 leading-6 whitespace-pre-wrap break-words text-muted-foreground">
                  “{detail.processBasis.leadIn ? `${detail.processBasis.leadIn} … ` : ""}{detail.processBasis.quote}”
                  {detail.processBasis.detail ? <span className="mt-1 block">“{detail.processBasis.detail}”</span> : null}
                </blockquote>
                {detail.processBasis.heading ? <p className="text-xs text-muted-foreground">Seção: {detail.processBasis.heading}</p> : null}
                <a href={detail.processBasis.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  {detail.processBasis.documentTitle}
                  <ExternalLink className="size-3.5" aria-hidden />
                  <span className="sr-only">(abre em nova aba)</span>
                </a>
                <p className={detail.processBasis.applicability === "VERIFIED" ? "text-xs text-muted-foreground" : "text-xs text-amber-700 dark:text-amber-300"}>{detail.processBasis.applicabilityLabel}</p>
              </div>
              {detail.groundingLabel ? <p className="text-xs text-muted-foreground">Origem da orientação: {detail.groundingLabel}</p> : null}
            </Section>
          ) : detail.groundingLabel ? (
            <p className="text-xs text-muted-foreground">Origem da orientação: {detail.groundingLabel}</p>
          ) : null}

          {detail.analysis ? (
            <Section icon={ListOrdered} title="Nesta análise">
              <p className="text-sm">Ponto {detail.analysis.position} de {detail.analysis.total}{detail.analysis.priorityLabels.length > 0 ? ` · ordem: ${detail.analysis.priorityLabels.join(", ")}` : ""}</p>
              {detail.analysis.others.length > 0 ? (
                <ul className="space-y-1 text-sm" aria-label="Outros pontos desta análise">
                  {detail.analysis.others.map((other) => (
                    <li key={other.position} className="flex flex-wrap gap-x-2 text-muted-foreground">
                      <span className="tabular-nums">{other.position}.</span>
                      <span>{other.sectionLabel}{other.stepTitle ? ` · ${other.stepTitle}` : ""}</span>
                      <span className="text-xs">({other.dispositionLabel})</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {detail.analysis.presentation ? (
                <p className="text-xs text-muted-foreground">Abertura e fechamento {detail.analysis.presentation.source === "SYSTEM" ? "do sistema" : "do redator"}. O nome vem do cadastro; na emissão, a abertura e o fechamento são conferidos de novo contra os pontos que realmente saem.</p>
              ) : null}
            </Section>
          ) : null}

          {detail.knowledgeRecommendations.length > 0 ? (
            <Section icon={FileText} title="Material relacionado (interno)">
              <ul className="space-y-2">
                {detail.knowledgeRecommendations.map((entry, index) => (
                  <li key={index} className="rounded-xl border border-border p-3 text-sm">
                    {entry.href ? (
                      <a href={entry.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                        {entry.documentTitle}
                        <ExternalLink className="size-3.5" aria-hidden />
                        <span className="sr-only">(abre em nova aba)</span>
                      </a>
                    ) : (
                      <span className="font-medium">{entry.documentTitle}</span>
                    )}
                    <span className="block text-xs text-muted-foreground">{entry.statusLabel}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section icon={FlaskConical} title="Política de entrega">
            <p className="text-sm">{detail.selection.dispositionLabel} · {detail.selection.policyLabel}</p>
            {detail.selection.reasons.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">{detail.selection.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            ) : null}
            <p className="text-xs text-muted-foreground">A avaliação mede a qualidade do texto da INIA. Ela não muda o que a estrutura permite entregar.</p>
          </Section>
      </div>
    </details>
  )
}

/** V1.6.0 — no feedback confiável, relevância e orientação só existem com fundamento; vazio = seção ausente (dito ao revisor).
 * V1.7.1a — EXEMPLO DE CONDUÇÃO: mostrado com o aviso de que é sugestão de formulação (não fala da chamada, não texto oficial). */
function WordingView({ wording, optionalGuidance = false, example }: { wording: ItemWording; optionalGuidance?: boolean; example?: FeedbackReviewDetail["suggestedResponse"] }) {
  const exampleText = (wording.suggestedResponse ?? "").trim()
  return (
    <dl className="space-y-3">
      {WORDING_FIELDS.map((field) =>
        wording[field.key].trim() ? (
          <div key={field.key} className="rounded-xl border border-border p-3">
            <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
            <dd className="mt-1 text-sm leading-6 whitespace-pre-wrap break-words">{wording[field.key]}</dd>
          </div>
        ) : optionalGuidance ? (
          <div key={field.key} className="rounded-xl border border-dashed border-border p-3">
            <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
            <dd className="mt-1 text-sm text-muted-foreground">{field.key === "whatYouCanDo" ? "Sem orientação fundamentada — este ponto não traz “o que fazer”." : "Sem regra da base que sustente — seção omitida."}</dd>
          </div>
        ) : null,
      )}
      {exampleText ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
          <dt className="text-xs font-medium text-muted-foreground">{example?.label ?? "Exemplo de condução"}</dt>
          <dd className="mt-1 text-sm leading-6 whitespace-pre-wrap break-words italic">“{exampleText}”</dd>
          <dd className="mt-1 text-xs text-muted-foreground">{example?.disclaimer ?? "Sugestão de formulação — não é fala da chamada nem texto oficial."}</dd>
        </div>
      ) : example && optionalGuidance ? (
        <div className="rounded-xl border border-dashed border-border p-3">
          <dt className="text-xs font-medium text-muted-foreground">{example.label}</dt>
          <dd className="mt-1 text-sm text-muted-foreground">{example.allowed ? "Sem exemplo de condução neste ponto." : example.notAllowedLabel ?? "Este ponto não admite exemplo de condução."}</dd>
        </div>
      ) : null}
    </dl>
  )
}

function ReasonPicker({ detail, value, onChange, error, legend }: { detail: FeedbackReviewDetail; value: string | null; onChange: (value: string) => void; error: string | null; legend: string }) {
  const errorId = useId()
  return (
    <fieldset className="space-y-2" aria-describedby={error ? errorId : undefined}>
      <legend className="text-sm font-medium">{legend}</legend>
      <RadioGroup value={value ?? ""} onValueChange={onChange} aria-invalid={error ? true : undefined} className="grid gap-1.5 sm:grid-cols-2">
        {detail.reasons.map((reason) => (
          <div key={reason.code} className="flex items-center gap-2">
            <RadioGroupItem value={reason.code} id={`reason-${reason.code}`} />
            <Label htmlFor={`reason-${reason.code}`} className="font-normal">{reason.label}</Label>
          </div>
        ))}
      </RadioGroup>
      {error ? <p id={errorId} className="text-sm text-destructive" role="alert">{error}</p> : null}
    </fieldset>
  )
}

function CommentField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Comentário (opcional)</Label>
      <Textarea id={id} value={value} maxLength={COMMENT_MAX} rows={2} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function EditForm({ detail, busy, onCancel, onSubmit }: { detail: FeedbackReviewDetail; busy: boolean; onCancel: () => void; onSubmit: (input: { finalWording: ItemWording; reasonCategory: string; comment: string | null }, onBlocked: (violations: EditViolation[]) => void) => void }) {
  const [wording, setWording] = useState<ItemWording>(detail.proposedWording)
  const [reason, setReason] = useState<string | null>(null)
  const [comment, setComment] = useState("")
  const [errors, setErrors] = useState<{ fields: Partial<Record<WordingFieldKey, string>>; reason: string | null; form: string | null }>({ fields: {}, reason: null, form: null })
  const [blocking, setBlocking] = useState<EditViolation[]>([])
  const [warnings, setWarnings] = useState<EditViolation[] | null>(null)
  const check = useCheckFeedbackReviewEditMutation()
  const baseId = useId()
  // V1.7.1a — o exemplo de condução só é editável quando o item o admite (ou já veio com um, para o revisor poder removê-lo).
  const exampleEditable = Boolean(detail.suggestedResponse?.allowed) || Boolean((detail.proposedWording.suggestedResponse ?? "").trim())
  const unchanged = WORDING_FIELDS.every((field) => wording[field.key].trim() === detail.proposedWording[field.key].trim()) && (wording.suggestedResponse ?? "").trim() === (detail.proposedWording.suggestedResponse ?? "").trim()

  function update(key: WordingFieldKey | "suggestedResponse", value: string) {
    setWording((current) => ({ ...current, [key]: value }))
    setWarnings(null)
    setBlocking([])
  }

  function validateLocally(): boolean {
    const fields: Partial<Record<WordingFieldKey, string>> = {}
    // V1.6.0 — feedback confiável: só "O que aconteceu" é obrigatório (relevância/orientação vazias = sem fundamento).
    for (const field of WORDING_FIELDS) if (!wording[field.key].trim() && (field.key === "observed" || detail.origin !== "WORKFLOW")) fields[field.key] = "Preencha este campo."
    const next = { fields, reason: reason ? null : "Escolha o motivo da edição.", form: unchanged ? "O texto não mudou — use Aprovar." : null }
    setErrors(next)
    return Object.keys(fields).length === 0 && !next.reason && !next.form
  }

  function send() {
    onSubmit({ finalWording: wording, reasonCategory: reason!, comment: comment.trim() || null }, (violations) => setBlocking(violations))
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!validateLocally()) return
    // Avisos já vistos → o revisor confirmou "Aprovar mesmo assim".
    if (warnings && warnings.length > 0) return send()
    check.mutate(
      { reviewId: detail.reviewId, wording },
      {
        onSuccess: (result) => {
          setBlocking(result.blocking)
          if (result.blocking.length > 0) return
          if (result.warnings.length > 0) { setWarnings(result.warnings); return }
          send()
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível verificar o texto."),
      },
    )
  }

  const working = busy || check.isPending
  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate aria-label="Editar o feedback">
      {WORDING_FIELDS.map((field) => {
        const id = `${baseId}-${field.key}`
        const error = errors.fields[field.key]
        return (
          <div key={field.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor={id}>{field.label}</Label>
              <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">{wording[field.key].length}/{detail.limits.maxChars}</span>
            </div>
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">{field.hint}{detail.origin === "WORKFLOW" && field.key !== "observed" ? " Opcional — só com base na regra do documento; deixe vazio se não houver." : ""}</p>
            <Textarea id={id} value={wording[field.key]} maxLength={detail.limits.maxChars} rows={3} aria-invalid={error ? true : undefined} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`} onChange={(event) => update(field.key, event.target.value)} />
            {error ? <p id={`${id}-error`} className="text-sm text-destructive" role="alert">{error}</p> : null}
          </div>
        )
      })}
      {exampleEditable ? (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor={`${baseId}-suggestedResponse`}>{detail.suggestedResponse?.label ?? "Exemplo de condução"}</Label>
            <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">{(wording.suggestedResponse ?? "").length}/{detail.limits.maxChars}</span>
          </div>
          <p id={`${baseId}-suggestedResponse-hint`} className="text-xs text-muted-foreground">A fala que o operador poderia ter dito ao cliente. {detail.suggestedResponse?.disclaimer ?? ""} Opcional — deixe vazio para não mostrar exemplo.</p>
          <Textarea id={`${baseId}-suggestedResponse`} value={wording.suggestedResponse ?? ""} maxLength={detail.limits.maxChars} rows={3} aria-describedby={`${baseId}-suggestedResponse-hint`} onChange={(event) => update("suggestedResponse", event.target.value)} />
        </div>
      ) : null}
      <ReasonPicker detail={detail} value={reason} onChange={(value) => { setReason(value); setErrors((current) => ({ ...current, reason: null })) }} error={errors.reason} legend="Motivo da edição (obrigatório)" />
      <CommentField value={comment} onChange={setComment} />
      {errors.form ? <p className="text-sm text-destructive" role="alert">{errors.form}</p> : null}
      {blocking.length > 0 ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">
          <p className="font-medium text-destructive">Corrija antes de aprovar:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{blocking.map((violation) => <li key={violation.code}>{violation.message}</li>)}</ul>
        </div>
      ) : null}
      {warnings && warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="alert">
          <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="size-4" aria-hidden /> Atenção antes de aprovar:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{warnings.map((violation) => <li key={violation.code}>{violation.message}</li>)}</ul>
          <p className="mt-1">Revise o texto ou aprove mesmo assim — o aviso fica registrado.</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={working}>{working ? "Verificando…" : warnings && warnings.length > 0 ? "Aprovar mesmo assim" : "Aprovar com edição"}</Button>
        <Button type="button" variant="ghost" disabled={working} onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  )
}

function RejectForm({ detail, busy, onCancel, onSubmit }: { detail: FeedbackReviewDetail; busy: boolean; onCancel: () => void; onSubmit: (input: { reasonCategory: string; comment: string | null }) => void }) {
  const [reason, setReason] = useState<string | null>(null)
  const [comment, setComment] = useState("")
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="space-y-4 rounded-xl border border-destructive/30 p-4"
      aria-label="Rejeitar o feedback"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (!reason) { setError("Escolha o motivo da rejeição."); return }
        onSubmit({ reasonCategory: reason, comment: comment.trim() || null })
      }}
    >
      <p className="text-sm">Um feedback rejeitado no QA não é entregue ao colaborador e continua registrado para auditoria.</p>
      <ReasonPicker detail={detail} value={reason} onChange={(value) => { setReason(value); setError(null) }} error={error} legend="Motivo da rejeição (obrigatório)" />
      <CommentField value={comment} onChange={setComment} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={busy}>{busy ? "Registrando…" : "Rejeitar feedback"}</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  )
}

function DecisionSummary({ detail }: { detail: FeedbackReviewDetail }) {
  const decision = detail.decision!
  return (
    <section className="space-y-2 rounded-xl bg-muted/40 p-4 text-sm" aria-label="Avaliação registrada">
      <p className="font-medium">{decision.statusLabel}{decision.reviewerName ? ` por ${decision.reviewerName}` : ""}{decision.reviewedAt ? ` em ${formatDateTime(decision.reviewedAt)}` : ""}.</p>
      {decision.reasonLabel ? <p><span className="text-muted-foreground">Motivo:</span> {decision.reasonLabel}</p> : null}
      {decision.comment ? <p className="whitespace-pre-wrap break-words"><span className="text-muted-foreground">Comentário:</span> {decision.comment}</p> : null}
      {decision.editWarnings.length > 0 ? (
        <div>
          <p className="text-muted-foreground">Avisos registrados na aprovação:</p>
          <ul className="list-disc pl-5">{decision.editWarnings.map((warning) => <li key={warning.code}>{warning.message}</li>)}</ul>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{detail.deliveryStateLabel}</p>
    </section>
  )
}

function StatusBadge({ detail }: { detail: FeedbackReviewDetail }) {
  if (detail.status === "PENDING_REVIEW") return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">{detail.statusLabel}</Badge>
  if (detail.status === "REJECTED") return <Badge variant="secondary">{detail.statusLabel}</Badge>
  return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{detail.statusLabel}</Badge>
}

function Section({ icon: Icon, title, children }: { icon: typeof FileText; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        {title}
      </h3>
      {children}
    </section>
  )
}

function SheetSkeleton() {
  return (
    <div className="space-y-4 p-6" aria-hidden>
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  )
}

const capitalize = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text)
