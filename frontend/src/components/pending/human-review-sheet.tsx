"use client"

import { useState } from "react"
import { CheckCircle2, ClipboardCheck, FileSearch, History, ShieldAlert, XCircle } from "lucide-react"
import { toast } from "sonner"

import { AnalyticsErrorState } from "@/components/analytics/analytics-states"
import { RichContent } from "@/components/rich-content/rich-content"
import { ReviewPresentationView } from "@/components/pending/review-presentation"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/api-client"
import { formatDateTime } from "@/lib/format/date"
import { useDecideHumanReviewMutation, useHumanReviewDetailQuery } from "@/queries/pending-actions/use-pending-actions"
import { DECISION_DONE_LABELS, DECISION_LABELS, PENDING_STATUS_LABELS, type HumanReviewDecision, type HumanReviewDetail } from "@/schemas/pending-actions/pending-actions.schema"

/**
 * Detalhe de uma Revisão Humana com contexto suficiente para decidir — instrução, conteúdo a
 * revisar, caso/evidências, resultados anteriores de Agent/Orchestrator e linha do tempo — e as
 * decisões que o workflow realmente prevê. A decisão é confirmada num AlertDialog do DS (nunca
 * `confirm()` nativo) e persiste pelo runtime real do motor.
 */
export function HumanReviewSheet({ reviewKey, onOpenChange, employeeHref }: { reviewKey: { enrollmentId: string; nodeId: string } | null; onOpenChange: (open: boolean) => void; employeeHref?: (personId: string) => string }) {
  const query = useHumanReviewDetailQuery(reviewKey?.enrollmentId ?? null, reviewKey?.nodeId ?? null)
  return (
    <Sheet open={reviewKey !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-2xl">
        {query.isPending ? <SheetSkeleton /> : null}
        {query.isError ? (
          <div className="p-6">
            <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : null}
        {query.data ? <ReviewBody detail={query.data} employeeHref={employeeHref} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function ReviewBody({ detail, employeeHref }: { detail: HumanReviewDetail; employeeHref?: (personId: string) => string }) {
  const [pendingDecision, setPendingDecision] = useState<HumanReviewDecision | null>(null)
  const decide = useDecideHumanReviewMutation()

  function confirmDecision() {
    if (!pendingDecision) return
    decide.mutate(
      { enrollmentId: detail.enrollmentId, nodeId: detail.nodeId, decision: pendingDecision },
      {
        onSuccess: (updated) => {
          setPendingDecision(null)
          toast.success(`Revisão ${DECISION_DONE_LABELS[updated.decision ?? pendingDecision].toLowerCase()}. O workflow continua a partir da sua decisão.`)
        },
        onError: (error) => {
          setPendingDecision(null)
          const message = error instanceof ApiError && error.code === "PENDING_ACTION_ALREADY_DECIDED" ? "Esta revisão já foi decidida por outra pessoa ou em outra aba." : error instanceof Error ? error.message : "Não foi possível registrar a decisão."
          toast.error(message)
        },
      },
    )
  }

  const operatorName = detail.operator?.name ?? "colaborador não identificado"
  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-0 bg-muted">Revisão humana</Badge>
          <StatusBadge detail={detail} />
        </div>
        <SheetTitle className="text-lg">{detail.nodeLabel}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Workflow: {detail.workflowName}</span>
          <span>Solicitada em {formatDateTime(detail.requestedAt)}</span>
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="space-y-6 p-4">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Colaborador</dt>
              <dd className="mt-0.5 font-medium">
                {detail.operator && employeeHref ? (
                  <a href={employeeHref(detail.operator.personId)} className="text-primary hover:underline">{detail.operator.name}</a>
                ) : (
                  operatorName
                )}
                {detail.operator?.teamName ? <span className="block text-xs font-normal text-muted-foreground">{detail.operator.teamName}{detail.operator.jobTitle ? ` · ${detail.operator.jobTitle}` : ""}</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Solicitado por</dt>
              <dd className="mt-0.5 font-medium">Workflow “{detail.workflowName}”</dd>
            </div>
          </dl>

          {detail.instruction ? (
            <Section icon={ClipboardCheck} title="O que você precisa avaliar">
              <p className="text-sm leading-6">{detail.instruction}</p>
            </Section>
          ) : null}

          <Section icon={FileSearch} title="Conteúdo a revisar">
            {detail.presentation ? (
              <div className="rounded-xl bg-muted/40 p-4">
                <ReviewPresentationView presentation={detail.presentation} technicalDetails={detail.content ? <RichContent text={detail.content} density="detail" className="rounded-xl border border-border p-3" /> : undefined} />
              </div>
            ) : detail.content ? (
              <RichContent text={detail.content} density="detail" className="rounded-xl bg-muted/40 p-4" />
            ) : (
              <p className="text-sm text-muted-foreground">Este ponto de revisão não anexou um conteúdo específico — avalie pela instrução e pelo contexto abaixo.</p>
            )}
          </Section>

          {detail.caseTitle || detail.evidences.length > 0 ? (
            <Section icon={ShieldAlert} title="Caso e evidências">
              {detail.caseTitle ? (
                <div className="rounded-xl border border-border p-3">
                  <p className="text-sm font-medium">{detail.caseTitle}</p>
                  {detail.caseSummary ? <RichContent text={detail.caseSummary} className="mt-1 text-muted-foreground" /> : null}
                </div>
              ) : null}
              {detail.evidences.length > 0 ? (
                <ul className="space-y-2">
                  {detail.evidences.map((evidence) => (
                    <li key={evidence.id} className="rounded-xl bg-muted/40 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="border-0">{evidence.type}</Badge>
                        <span className="font-medium break-words">{evidence.title}</span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(evidence.occurredAt)}</span>
                      </div>
                      {/* Transcrição é citação literal — nunca passa por Markdown; o resto (feedback, indicador) é texto rico. */}
                      {evidence.type === "TRANSCRIPT" ? <p className="mt-1 leading-6 whitespace-pre-wrap text-muted-foreground break-words">{evidence.description}</p> : <RichContent text={evidence.description} className="mt-1 text-muted-foreground" />}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Section>
          ) : null}

          {detail.previousOutputs.length > 0 ? (
            <Section icon={History} title="Resultados anteriores nesta execução">
              <div className="space-y-3">
                {detail.previousOutputs.map((output) => (
                  <details key={output.nodeId} className="rounded-xl border border-border p-3">
                    <summary className="cursor-pointer text-sm font-medium">{output.nodeLabel}</summary>
                    <RichContent text={output.text} className="mt-3" />
                  </details>
                ))}
              </div>
            </Section>
          ) : null}

          {detail.timeline.length > 0 ? (
            <Section icon={History} title="Linha do tempo da execução">
              <ol className="space-y-1 text-xs text-muted-foreground">
                {detail.timeline.map((event, index) => (
                  <li key={`${event.createdAt}-${index}`} className="flex flex-wrap gap-x-2">
                    <span className="tabular-nums">{formatDateTime(event.createdAt)}</span>
                    <span>{TIMELINE_LABELS[event.eventType] ?? event.eventType}</span>
                  </li>
                ))}
              </ol>
            </Section>
          ) : null}
        </div>
      </div>

      <div className="border-t p-4">
        {detail.status === "PENDING" ? (
          detail.allowedDecisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este ponto de revisão não tem decisões configuradas no workflow — fale com o administrador.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {detail.allowedDecisions.map((decision) => (
                <Button key={decision} variant={decision === "approved" ? "default" : decision === "rejected" ? "destructive" : "outline"} disabled={decide.isPending} onClick={() => setPendingDecision(decision)}>
                  {decision === "approved" ? <CheckCircle2 aria-hidden /> : decision === "rejected" ? <XCircle aria-hidden /> : <ShieldAlert aria-hidden />}
                  {DECISION_LABELS[decision]}
                </Button>
              ))}
              <span className="text-xs text-muted-foreground">A decisão retoma o workflow e não pode ser desfeita.</span>
            </div>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            {detail.status === "DECIDED" && detail.decision
              ? `${DECISION_DONE_LABELS[detail.decision]}${detail.reviewer ? ` por ${detail.reviewer.name}` : ""}${detail.decidedAt ? ` em ${formatDateTime(detail.decidedAt)}` : ""}.`
              : "Esta execução não está mais aguardando esta revisão."}
          </p>
        )}
      </div>

      <AlertDialog open={pendingDecision !== null} onOpenChange={(open) => (!open && !decide.isPending ? setPendingDecision(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDecision ? `${DECISION_LABELS[pendingDecision]} esta revisão?` : ""}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDecision ? CONFIRMATION_TEXT[pendingDecision] : ""} O workflow “{detail.workflowName}” continua a partir dessa decisão sobre {operatorName}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={decide.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction disabled={decide.isPending} onClick={(event) => { event.preventDefault(); confirmDecision() }}>
              {decide.isPending ? "Registrando…" : pendingDecision ? DECISION_LABELS[pendingDecision] : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

const CONFIRMATION_TEXT: Record<HumanReviewDecision, string> = {
  approved: "Você confirma que o conteúdo revisado está adequado.",
  rejected: "Você indica que o conteúdo revisado não deve seguir.",
  escalated: "Você encaminha esta revisão para o nível acima, conforme o workflow.",
}

const TIMELINE_LABELS: Record<string, string> = {
  enrolled: "Execução iniciada",
  human_review_requested: "Revisão solicitada",
  human_review_decision_submitted: "Decisão registrada",
  human_review_decided: "Workflow seguiu pela decisão",
  output_dispatched: "Resultado publicado",
  node_advanced: "Etapa concluída",
}

function StatusBadge({ detail }: { detail: HumanReviewDetail }) {
  if (detail.status === "PENDING") return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">{PENDING_STATUS_LABELS.PENDING}</Badge>
  if (detail.status === "DECIDED") return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{detail.decision ? DECISION_DONE_LABELS[detail.decision] : PENDING_STATUS_LABELS.DECIDED}</Badge>
  return <Badge variant="secondary">{PENDING_STATUS_LABELS.UNAVAILABLE}</Badge>
}

function Section({ icon: Icon, title, children }: { icon: typeof ClipboardCheck; title: string; children: React.ReactNode }) {
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
