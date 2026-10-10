"use client"

import { useState } from "react"
import { ArrowLeft, X } from "lucide-react"

import { AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { useAssessmentDetailQuery, useIndicatorInvestigationQuery } from "@/queries/diagnostics/use-diagnostics-memory"

import { CallAssessmentDetail } from "./call-assessment-detail"
import { InvestigationReport, type InvestigationCall } from "./investigation-report"
import { shortDate } from "./memory-labels"

/**
 * A INVESTIGAÇÃO de um indicador numa tela ampla (nunca um painel estreito): o relatório ocupa a tela; escolher uma chamada que
 * sustenta um padrão abre a avaliação dela AO LADO, sem empilhar outro painel — trocar de chamada troca o lado direito, fechar volta
 * ao relatório inteiro. No celular, uma coisa de cada vez, com "voltar". Esc fecha primeiro a chamada, depois a investigação.
 */
export function IndicatorInvestigationDialog({ investigationId, onClose }: { investigationId: string | null; onClose: () => void }) {
  const [call, setCall] = useState<InvestigationCall | null>(null)
  const close = () => {
    setCall(null)
    onClose()
  }
  return (
    <Dialog open={investigationId !== null} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (!call) return
          event.preventDefault()
          setCall(null)
        }}
        className="flex h-[92vh] max-h-[1000px] w-[96vw] max-w-[1400px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1400px] max-sm:h-[100svh] max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
      >
        {investigationId ? <InvestigationView key={investigationId} investigationId={investigationId} call={call} onCall={setCall} onClose={close} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function InvestigationView({ investigationId, call, onCall, onClose }: { investigationId: string; call: InvestigationCall | null; onCall: (call: InvestigationCall | null) => void; onClose: () => void }) {
  const isMobile = useIsMobile()
  const query = useIndicatorInvestigationQuery(investigationId)
  const official = (query.data?.official ?? {}) as { name?: string; periodLabel?: string }
  const showReport = !isMobile || call === null
  return (
    <>
      <header className="flex items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Investigação de indicador</p>
          {query.data ? (
            <>
              <DialogTitle className="text-lg leading-snug font-semibold">{official.name ?? "Indicador"}{official.periodLabel ? ` · ${official.periodLabel}` : ""}</DialogTitle>
              <DialogDescription className="text-sm">{query.data.personName} · investigada em {shortDate(query.data.createdAt)}<span className="max-sm:hidden"> · números oficiais como vieram da fonte; métricas de chamada são aproximações identificadas como tal.</span></DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle className="sr-only">Investigação de indicador</DialogTitle>
              <DialogDescription className="sr-only">Carregando a investigação.</DialogDescription>
              <Skeleton className="h-6 w-72" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar"><X /></Button>
      </header>

      <div className={cn("grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)]", call && "lg:grid-cols-[minmax(0,1fr)_minmax(440px,46%)]")}>
        {showReport ? (
          <div className="min-h-0 overflow-y-auto">
            <div className={cn("p-5 sm:p-6", !call && "mx-auto max-w-5xl")}>
              {query.isPending ? <TableSkeleton rows={8} /> : null}
              {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
              {query.data ? <InvestigationReport investigation={query.data} callAssessments={query.data.callAssessments} onOpenCall={onCall} activeInteractionId={call?.interactionId ?? null} /> : null}
            </div>
          </div>
        ) : null}
        {call ? (
          <section key={call.callAssessmentId} className="min-h-0 overflow-y-auto border-l bg-muted/20 max-lg:border-l-0" aria-label="Chamada escolhida">
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-5 py-3 backdrop-blur">
              {isMobile ? <Button variant="ghost" size="sm" className="-ml-2" onClick={() => onCall(null)}><ArrowLeft data-icon="inline-start" /> Voltar à investigação</Button> : (
                <>
                  <p className="flex-1 text-sm font-semibold">Chamada de {shortDate(call.localDate)}</p>
                  <Button variant="ghost" size="icon-sm" onClick={() => onCall(null)} aria-label="Fechar a chamada"><X /></Button>
                </>
              )}
            </div>
            <div className="p-5"><CallPane call={call} /></div>
          </section>
        ) : null}
      </div>
    </>
  )
}

/**
 * A chamada aberta ao lado, com o ponto do padrão em destaque. A ligação padrão → critério é só de APRESENTAÇÃO: a mesma regra
 * (chave) ou a mesma justificativa registrada; sem correspondência, a chamada abre sem destaque.
 */
function CallPane({ call }: { call: InvestigationCall }) {
  const query = useAssessmentDetailQuery(call.callAssessmentId)
  if (query.isPending) return <TableSkeleton rows={6} />
  if (query.isError) return <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} />
  const focus = query.data.criteria.find((criterion) => criterion.criterionKey === call.criterionKey) ?? (call.rationale ? query.data.criteria.find((criterion) => criterion.rationale === call.rationale) : undefined)
  return <CallAssessmentDetail detail={query.data} focusId={focus?.id ?? null} />
}
