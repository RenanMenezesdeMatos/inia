"use client"

import { useId, useState } from "react"
import { CalendarX2, CheckCircle2, ClipboardCheck, Database, UserX, Wrench } from "lucide-react"
import { toast } from "sonner"

import { AnalyticsErrorState } from "@/components/analytics/analytics-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/api-client"
import { formatCivilDate, formatDateTime } from "@/lib/format/date"
import { useResolveWorkdayReconciliationMutation, useWorkdayReconciliationDetailQuery } from "@/queries/pending-actions/use-pending-actions"
import { PENDING_STATUS_LABELS, type JustifiedAbsenceReason, type WorkdayDecision, type WorkdayReconciliationDetail } from "@/schemas/pending-actions/pending-actions.schema"

/**
 * Pendência "Produção não identificada após o fechamento das fontes": o Supervisor CLASSIFICA o que
 * aconteceu num dia programado sem evidência de produção — só depois de os dados que poderiam explicar
 * o dia terem chegado. Quatro decisões — nunca uma falta automática, nunca produção fictícia:
 *   Falta injustificada → classificação revisável; o dia CONTINUA esperado (política por indicador);
 *   Ausência justificada (motivo) → classificação; o dia sai do cálculo (atestado = só o motivo);
 *   Trabalhou — dados não chegaram → o dia continua esperado; nenhum indicador é criado;
 *   Corrigir planejamento → override operacional "Ajuste de escala" (a escala de origem não é adulterada).
 */
export function WorkdayReconciliationSheet({ reconciliationId, onOpenChange, employeeHref }: { reconciliationId: string | null; onOpenChange: (open: boolean) => void; employeeHref?: (personId: string) => string }) {
  const query = useWorkdayReconciliationDetailQuery(reconciliationId)
  return (
    <Sheet open={reconciliationId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-xl" data-testid="workday-reconciliation-sheet">
        {query.isPending ? (
          <div className="space-y-3 p-6" aria-hidden>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : null}
        {query.isError ? (
          <div className="p-6">
            <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : null}
        {query.data ? <Body detail={query.data} employeeHref={employeeHref} /> : null}
      </SheetContent>
    </Sheet>
  )
}

type Choice = "UNJUSTIFIED_ABSENCE" | "JUSTIFIED_ABSENCE" | "WORKED_DATA_MISSING" | "SCHEDULE_CORRECTED"

function Body({ detail, employeeHref }: { detail: WorkdayReconciliationDetail; employeeHref?: (personId: string) => string }) {
  const [choice, setChoice] = useState<Choice | null>(null)
  const [reasonCode, setReasonCode] = useState<JustifiedAbsenceReason>(detail.justifiedReasons[0]?.code ?? "ATESTADO")
  const reasonLabelId = useId()
  const resolve = useResolveWorkdayReconciliationMutation()
  const pending = detail.status === "PENDING"

  function submit() {
    if (!choice) return
    const decision: WorkdayDecision = choice === "JUSTIFIED_ABSENCE" ? { resolution: "JUSTIFIED_ABSENCE", reasonCode } : { resolution: choice }
    resolve.mutate(
      { reconciliationId: detail.reconciliationId, decision },
      {
        onSuccess: (updated) => toast.success(`Pendência resolvida: ${updated.resolutionLabel ?? ""}.`),
        onError: (error) => toast.error(error instanceof ApiError && error.code === "PENDING_ACTION_ALREADY_DECIDED" ? "Esta pendência já foi resolvida por outra pessoa ou em outra aba." : error instanceof Error ? error.message : "Não foi possível registrar a decisão."),
      },
    )
  }

  const sources = [detail.evidenceSources.interactions ? "interações registradas" : null, detail.evidenceSources.indicatorCodes.length > 0 ? `indicador(es) ${detail.evidenceSources.indicatorCodes.join(", ")}` : null].filter(Boolean).join(" e ")
  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-0 bg-muted">Produção não identificada após o fechamento das fontes</Badge>
          {pending ? <Badge className="border-0 bg-amber-500/15 text-amber-800 dark:text-amber-200">{PENDING_STATUS_LABELS.PENDING}</Badge> : <Badge className="border-0 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200">{detail.resolutionLabel ?? PENDING_STATUS_LABELS.DECIDED}</Badge>}
        </div>
        <SheetTitle className="text-lg">{detail.operator?.name ?? "Colaborador"} · {formatCivilDate(detail.workday)}</SheetTitle>
        <SheetDescription>{detail.reason}</SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 p-4">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Colaborador</dt>
              <dd className="mt-0.5 font-medium">
                {detail.operator && employeeHref ? <a href={employeeHref(detail.operator.personId)} className="text-primary hover:underline">{detail.operator.name}</a> : (detail.operator?.name ?? "—")}
                {detail.operator?.teamName ? <span className="block text-xs font-normal text-muted-foreground">{detail.operator.teamName}</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Detectada em</dt>
              <dd className="mt-0.5 font-medium">{formatDateTime(detail.requestedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">O que estava planejado</dt>
              <dd className="mt-0.5 font-medium" data-testid="workday-plan">{detail.plan}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Fontes de evidência consultadas</dt>
              <dd className="mt-0.5 font-medium">{sources || "nenhuma"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Disponibilidade dos dados</dt>
              <dd className="mt-0.5 font-medium" data-testid="workday-availability">{detail.availability?.label ?? "Fontes fechadas na detecção"}</dd>
            </div>
          </dl>

          {pending ? (
            <section className="space-y-3 rounded-xl border border-border p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="size-4 text-muted-foreground" aria-hidden /> O que aconteceu?</h3>
              <RadioGroup value={choice ?? ""} onValueChange={(value) => setChoice(value as Choice)} className="space-y-3">
                <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-muted/60">
                  <RadioGroupItem value="UNJUSTIFIED_ABSENCE" id="workday-unjustified" className="mt-1" />
                  <span>
                    <span className="flex items-center gap-2 font-medium"><UserX className="size-4" aria-hidden /> Falta injustificada</span>
                    <span className="block text-xs text-muted-foreground">Confirma a falta sem justificativa conhecida. O dia CONTINUA esperado como dia de trabalho: indicadores de produção configurados com &quot;contribuição zero&quot; recebem 0 lógico; TMA, Qualidade e demais ficam sem amostra. Nenhuma medição é criada. Revisável a qualquer momento.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-muted/60">
                  <RadioGroupItem value="JUSTIFIED_ABSENCE" id="workday-justified" className="mt-1" />
                  <span>
                    <span className="flex items-center gap-2 font-medium"><CalendarX2 className="size-4" aria-hidden /> Ausência justificada</span>
                    <span className="block text-xs text-muted-foreground">Registra a justificativa (classificação auditável, não altera a escala). O dia sai dos cálculos operacionais.</span>
                  </span>
                </label>
                {choice === "JUSTIFIED_ABSENCE" ? (
                  <div className="ml-9 space-y-2" data-testid="workday-reason-options">
                    <Label id={reasonLabelId} className="text-xs text-muted-foreground">Motivo</Label>
                    <RadioGroup aria-labelledby={reasonLabelId} value={reasonCode} onValueChange={(value) => setReasonCode(value as JustifiedAbsenceReason)} className="grid grid-cols-2 gap-2">
                      {detail.justifiedReasons.map((option) => (
                        <label key={option.code} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
                          <RadioGroupItem value={option.code} id={`workday-code-${option.code}`} />
                          {option.label}
                        </label>
                      ))}
                    </RadioGroup>
                    {reasonCode === "ATESTADO" ? <p className="text-xs text-muted-foreground">Atestado é só um motivo operacional — a INIA não guarda diagnóstico, CID nem documento médico.</p> : null}
                  </div>
                ) : null}
                <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-muted/60">
                  <RadioGroupItem value="WORKED_DATA_MISSING" id="workday-data-missing" className="mt-1" />
                  <span>
                    <span className="flex items-center gap-2 font-medium"><Database className="size-4" aria-hidden /> Trabalhou — dados não chegaram</span>
                    <span className="block text-xs text-muted-foreground">Nenhuma produção é inventada: o dia continua esperado como trabalhado; sem medição, o indicador fica SEM DADOS. Quando o dado real chegar, a reconciliação é automática.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-muted/60">
                  <RadioGroupItem value="SCHEDULE_CORRECTED" id="workday-schedule-corrected" className="mt-1" />
                  <span>
                    <span className="flex items-center gap-2 font-medium"><Wrench className="size-4" aria-hidden /> Corrigir planejamento</span>
                    <span className="block text-xs text-muted-foreground">A pessoa não estava programada de fato: registra um ajuste de escala para a data (override operacional). A escala enviada pela fonte não é alterada — fica a rastreabilidade.</span>
                  </span>
                </label>
              </RadioGroup>
              <div className="flex justify-end">
                <Button onClick={submit} disabled={!choice || resolve.isPending} data-testid="workday-resolve">
                  {resolve.isPending ? "Registrando..." : "Confirmar"}
                </Button>
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-border p-4 text-sm" data-testid="workday-resolved">
              <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> {detail.classification?.label ?? detail.resolutionLabel ?? "Resolvida"}</p>
              <p className="mt-1 text-muted-foreground">
                {detail.decidedAt ? `Em ${formatDateTime(detail.decidedAt)}` : ""}
                {detail.reviewer ? ` por ${detail.reviewer.name}` : detail.resolution === "PRODUCTION_RECEIVED_AFTER_ALERT" || detail.resolution === "PLAN_UPDATED_AFTER_ALERT" || detail.resolution === "SOURCES_STILL_OPEN" || detail.resolution === "DATA_SOURCE_DELAYED" || detail.resolution === "STATUS_NON_PRODUCTIVE" ? " — automaticamente pela INIA (reavaliada pela regra atual)" : ""}
                {detail.resolutionException ? ` · exceção registrada: ${detail.resolutionException.label}` : ""}
              </p>
              {detail.resolution === "WORKED_DATA_MISSING" ? <p className="mt-2 text-xs text-muted-foreground">Confirmado pelo Supervisor. Nenhum indicador foi criado pela INIA — o dia continua esperado e recebe o dado real quando ele chegar.</p> : null}
              {detail.resolution === "UNJUSTIFIED_ABSENCE" ? <p className="mt-2 text-xs text-muted-foreground">O dia continua contando como dia esperado de trabalho. Indicadores com &quot;contribuição zero&quot; recebem 0 lógico; os demais ficam sem amostra. Nenhuma medição foi criada. A classificação pode ser revisada no Calendário da equipe.</p> : null}
              {detail.classification?.supersededReason ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{detail.classification.supersededReasonLabel} — a classificação ficou no histórico; o estado do dia hoje é o que a evidência/situação diz.</p> : null}
            </section>
          )}
        </div>
      </div>
    </>
  )
}
