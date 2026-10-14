"use client"

import { AlertTriangle, CalendarClock, FileText, History, ShieldAlert, Target } from "lucide-react"
import type { ReactNode } from "react"

import { AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatCivilDate, formatDateTime } from "@/lib/format/date"
import { useInterventionQuery, useRetryNarrativeMutation } from "@/queries/interventions/use-intervention-queries"
import type { InterventionDetail } from "@/schemas/interventions/intervention.schema"

import { IntelligenceReportView } from "./intelligence-report-view"
import { InterventionActions } from "./intervention-panel/intervention-actions"
import { CompleteIntervention, InterventionHistory, InterventionItems, InterventionOutcome } from "./intervention-panel/intervention-items"
import { InterventionPlanSection } from "./intervention-panel/intervention-plan"

/**
 * A intervenção DENTRO do caso — o que o líder precisa para "entender o relatório → executar ou decidir → acompanhar → registrar
 * resultado": ação pedida, colaborador, responsável e prazo; motivo; relatório e evidências; controles conforme permissão e
 * estado; plano, tarefas e checkpoints; histórico. Detalhes de execução do Workflow ficam em "Auditoria", recolhidos.
 */
function whatToDo(detail: InterventionDetail): string {
  const can = (action: string) => detail.availableActions.includes(action)
  if (detail.sensitive && detail.status === "AWAITING_APPROVAL") return can("DECIDE_CONTINUITY") ? "Registre a decisão sobre a avaliação de continuidade, com justificativa." : "Aguarda a decisão de uma pessoa autorizada. A solicitação não é uma decisão sobre o colaborador."
  switch (detail.status) {
    case "PROPOSED":
      return can("ACCEPT") ? `Aceite (e complete o plano) ou descarte esta recomendação até ${formatCivilDate(detail.dueAt)}.` : `Aguarda ${detail.responsible.name} aceitar ou descartar.`
    case "AWAITING_APPROVAL":
      return can("APPROVE") ? "Aprove ou devolva o plano para ajuste." : `Aguarda a aprovação de ${detail.approver?.name ?? "quem aprova"}.`
    case "IN_PROGRESS":
      return can("COMPLETE") ? `Execute as tarefas e registre os checkpoints até ${formatCivilDate(detail.dueAt)}; depois registre o resultado.` : `Em execução por ${detail.responsible.name}, prazo ${formatCivilDate(detail.dueAt)}.`
    case "COMPLETED":
      return "Concluída — o resultado registrado está abaixo."
    case "CANCELLED":
      return "Cancelada."
  }
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  )
}

export function InterventionPanel({ interventionId }: { interventionId: string }) {
  const query = useInterventionQuery(interventionId)
  const retry = useRetryNarrativeMutation(interventionId)
  if (query.isPending) return <TableSkeleton rows={4} />
  if (query.isError) return <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} />
  const detail = query.data
  const origin = detail.origin === "WORKFLOW" ? `Aberta pela política "${detail.policy?.name ?? "—"}"${detail.policy?.version ? ` v${detail.policy.version}` : ""}` : "Aberta manualmente"

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{detail.statusLabel}</Badge>
          {detail.overdue ? (
            <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-3" /> Atrasada
            </Badge>
          ) : null}
          {detail.signalCount > 1 ? <Badge variant="outline">{detail.signalCount} sinais da política</Badge> : null}
        </div>
        <CardTitle className="text-lg">{detail.sensitive ? "Solicitação de avaliação de continuidade" : detail.type.name}</CardTitle>
        <CardDescription>{origin} · {formatDateTime(detail.createdAt)}</CardDescription>
        {detail.sensitive ? (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            Processo humano restrito: a INIA organiza o fundamento e pede uma decisão. Ela nunca decide, aprova automaticamente ou altera a situação funcional do colaborador.
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-primary/5 p-3 text-sm">
          <p className="text-xs font-medium text-primary">O que fazer agora</p>
          <p>{whatToDo(detail)}</p>
          {detail.availableActions.includes("ACCEPT") && detail.readiness.length > 0 ? (
            <div className="mt-2 space-y-0.5" data-testid="intervention-readiness">
              <p className="text-xs font-medium">Antes de aceitar, falta:</p>
              <ul className="text-xs text-muted-foreground">
                {detail.readiness.map((issue) => (
                  <li key={`${issue.code}:${issue.path}`}>• {issue.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact icon={<Target className="size-4" />} label="Colaborador">{detail.person.name}{detail.person.teamName ? <span className="text-muted-foreground"> · {detail.person.teamName}</span> : null}</Fact>
          <Fact icon={<Target className="size-4" />} label="Indicador">{detail.indicatorCode ?? "Geral"}</Fact>
          <Fact icon={<FileText className="size-4" />} label="Responsável">{detail.responsible.name}{detail.approver ? <span className="block text-xs text-muted-foreground">Aprovação: {detail.approver.name}</span> : null}</Fact>
          <Fact icon={<CalendarClock className="size-4" />} label="Prazo">{formatCivilDate(detail.dueAt)}</Fact>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Por que foi aberta</p>
          <p className="text-sm">{detail.reason}</p>
        </div>
        <InterventionActions detail={detail} />

        <Tabs defaultValue="work">
          <TabsList>
            <TabsTrigger value="work">Execução</TabsTrigger>
            <TabsTrigger value="report">Relatório</TabsTrigger>
            <TabsTrigger value="evidence">Evidências</TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>
          <TabsContent value="work" className="mt-4 space-y-4">
            <InterventionOutcome detail={detail} />
            <InterventionPlanSection key={`${detail.id}:${detail.revision}`} detail={detail} />
            <Separator />
            <InterventionItems detail={detail} />
            <CompleteIntervention key={`complete:${detail.revision}`} detail={detail} />
          </TabsContent>
          <TabsContent value="report" className="mt-4">
            {detail.report ? (
              <IntelligenceReportView report={detail.report.structured} narrative={detail.report.narrative} onRetryNarrative={() => retry.mutate(detail.report!.id)} retrying={retry.isPending} highlightInterventionId={detail.id} />
            ) : (
              <p className="text-sm text-muted-foreground">Intervenção aberta manualmente — sem relatório de política. O motivo e as evidências registradas estão nas outras abas.</p>
            )}
            {detail.laterReports.length > 0 ? <p className="mt-3 text-xs text-muted-foreground">{detail.laterReports.length} avaliação(ões) posterior(es) reforçaram esta intervenção — veja os relatórios no caso. O fundamento original não muda.</p> : null}
          </TabsContent>
          <TabsContent value="evidence" className="mt-4">
            {detail.evidence.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma evidência registrada.</p> : null}
            <ul className="space-y-1.5 text-sm">
              {detail.evidence.map((item) => (
                <li key={`${item.kind}:${item.ref}`} className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{item.kindLabel}</Badge>
                  {item.label}
                  {item.occurredAt ? <span className="text-xs text-muted-foreground">{formatDateTime(item.occurredAt)}</span> : null}
                  {item.addedBy ? <span className="text-xs text-muted-foreground">· incluída manualmente</span> : null}
                </li>
              ))}
            </ul>
          </TabsContent>
          <TabsContent value="history" className="mt-4 space-y-4">
            <InterventionHistory detail={detail} />
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                <History className="size-3.5" /> Auditoria (execução)
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                <p>Origem: {detail.audit.origin === "WORKFLOW" ? `Workflow ${detail.audit.workflowName ?? ""}` : "manual"}</p>
                {detail.audit.ruleKey ? <p>Regra da política: {detail.audit.ruleKey}</p> : null}
                {detail.audit.enrollmentId ? <p>Execução: {detail.audit.enrollmentId} · nó {detail.audit.nodeId}</p> : null}
                {detail.audit.evaluationId ? <p>Avaliação: {detail.audit.evaluationId}</p> : null}
                <p>Versão do tipo: {detail.audit.typeVersionId}{detail.audit.policyVersionId ? ` · versão da política: ${detail.audit.policyVersionId}` : ""}</p>
              </CollapsibleContent>
            </Collapsible>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
