"use client"

import { FlaskConical } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { formatCivilDate, formatDateTime } from "@/lib/format/date"
import { DECISION_LABELS, OUTCOME_LABELS, type GroupTrace, type SimulationResult } from "@/schemas/admin/intervention-policy.schema"

import { ConditionStatusBadge, IntelligenceReportView } from "./intelligence-report-view"

/**
 * Resultado de uma SIMULAÇÃO (administração e painel do nó do Workflow): fatos considerados, cada condição atendida /
 * não atendida / inconclusiva, decisões por ação e a prévia do relatório — e o aviso explícito de que nada foi gravado.
 */
/** `leafBadges` falso: regra com uma condição só — o selo da regra já diz o resultado, repetir na condição é ruído. */
function TraceTree({ trace, depth = 0, leafBadges = true }: { trace: GroupTrace; depth?: number; leafBadges?: boolean }) {
  return (
    <ul className={depth > 0 ? "ml-4 border-l pl-3" : ""}>
      {trace.items.map((item) =>
        item.type === "GROUP" ? (
          <li key={item.path} className="space-y-1 py-1">
            <div className="flex items-center justify-between gap-2 text-xs font-medium">
              <span>Grupo: {item.operator === "ALL" ? "todas as condições" : "qualquer condição"}</span>
              <ConditionStatusBadge status={item.status} />
            </div>
            <TraceTree trace={item} depth={depth + 1} />
          </li>
        ) : (
          <li key={item.path} className="flex items-start justify-between gap-2 py-1 text-xs">
            <span className="text-muted-foreground">{item.outcome.summary}</span>
            {leafBadges ? <ConditionStatusBadge status={item.outcome.status} /> : null}
          </li>
        ),
      )}
    </ul>
  )
}

export function PolicySimulationView({ result }: { result: SimulationResult }) {
  const { evaluation } = result
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
        <FlaskConical className="size-3.5" />
        Simulação: nada foi gravado, nenhuma intervenção aberta, ninguém avisado.
        <span>
          {evaluation.person.name} · referência {formatDateTime(evaluation.asOf)} · {evaluation.policy.version ? `versão ${evaluation.policy.version}` : "rascunho"}
        </span>
      </div>
      {result.draftIssues.length > 0 ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
          <p className="font-medium">O rascunho ainda não pode ser publicado:</p>
          <ul className="text-muted-foreground">
            {result.draftIssues.map((issue) => (
              <li key={`${issue.path}:${issue.code}`}>• {issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{OUTCOME_LABELS[evaluation.outcome]}</Badge>
        {evaluation.notApplicableReason ? <span className="text-xs text-muted-foreground">Motivo: {evaluation.notApplicableReason}</span> : null}
        {evaluation.selection.blockedBy ? <span className="text-xs text-amber-700 dark:text-amber-400">A regra “{evaluation.rules.find((rule) => rule.key === evaluation.selection.blockedBy)?.name ?? evaluation.selection.blockedBy}” ficou inconclusiva antes de qualquer regra atendida.</span> : null}
      </div>
      <div className="space-y-2">
        {evaluation.rules
          .slice()
          .sort((a, b) => a.priority - b.priority)
          .map((rule) => (
            <div key={rule.key} className="rounded-md border p-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {rule.priority}. {rule.name}
                </span>
                <ConditionStatusBadge status={rule.status} />
              </div>
              <TraceTree trace={rule.trace} leafBadges={!(rule.trace.items.length === 1 && rule.trace.items[0]?.type === "CONDITION")} />
            </div>
          ))}
      </div>
      {evaluation.decisions.length > 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">Decisões por ação</p>
          <ul className="space-y-1 text-sm">
            {evaluation.decisions.map((decision) => (
              <li key={decision.typeKey} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{decision.typeName}</span>
                <Badge variant="outline">{DECISION_LABELS[decision.status] ?? decision.status}</Badge>
                {decision.mode === "INCONCLUSIVE" ? <Badge variant="outline">por dado insuficiente</Badge> : null}
                {decision.assignment?.responsible ? <span className="text-xs text-muted-foreground">Responsável: {decision.assignment.responsible.name}</span> : null}
                {decision.assignment?.approver ? <span className="text-xs text-muted-foreground">Aprovação: {decision.assignment.approver.name}</span> : null}
                {decision.assignment?.dueAt ? <span className="text-xs text-muted-foreground">Prazo {formatCivilDate(decision.assignment.dueAt)}</span> : null}
                {decision.assignment?.problem ? <span className="text-xs text-destructive">{decision.assignment.problem}</span> : null}
                {decision.note ? <span className="text-xs text-muted-foreground">{decision.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.report ? (
        <details className="rounded-md border p-2">
          <summary className="cursor-pointer text-sm font-medium">Prévia do relatório de inteligência</summary>
          <div className="mt-3">
            <IntelligenceReportView report={result.report} />
          </div>
        </details>
      ) : null}
    </div>
  )
}
