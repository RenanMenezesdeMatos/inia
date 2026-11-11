"use client"

import { AlertCircle, BookOpenCheck, CircleHelp, FileSearch, History, ListChecks, RefreshCw, Sparkles, Target } from "lucide-react"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { formatCivilDate, formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { CONDITION_STATUS_LABELS, OPERATIONAL_RESULT_LABELS, type ConditionStatus, type IntelligenceReport, type ReportView } from "@/schemas/interventions/intervention.schema"

/**
 * Relatório de inteligência — o FUNDAMENTO de uma avaliação: fatos, fontes, histórico, diagnóstico, incertezas, critérios e as
 * ações com justificativa individual. A parte estruturada é a fonte da verdade e aparece sempre; a narrativa da INIA, quando
 * existe, vem marcada como redação e cita os marcadores (F, S, D, U, A). Hipóteses ficam separadas dos fatos.
 */
const STATUS_TONE: Record<ConditionStatus, string> = {
  MET: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  NOT_MET: "border-muted-foreground/30 text-muted-foreground",
  INCONCLUSIVE: "border-amber-500/40 text-amber-700 dark:text-amber-400",
}

export function ConditionStatusBadge({ status }: { status: ConditionStatus }) {
  return (
    <Badge variant="outline" className={cn("shrink-0", STATUS_TONE[status])}>
      {CONDITION_STATUS_LABELS[status]}
    </Badge>
  )
}

function Section({ icon, title, children, description }: { icon: ReactNode; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </section>
  )
}

const Handle = ({ value }: { value: string }) => <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{value}</span>

type Props = {
  report: IntelligenceReport
  narrative?: ReportView["narrative"] | null
  onRetryNarrative?: (() => void) | undefined
  retrying?: boolean
  /** Destaca a ação desta intervenção (A#) quando o relatório é aberto a partir dela. */
  highlightInterventionId?: string | null
}

export function IntelligenceReportView({ report, narrative, onRetryNarrative, retrying = false, highlightInterventionId = null }: Props) {
  const ready = narrative?.status === "READY" ? narrative.current : null
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{report.policy.outcomeLabel}</Badge>
          <Badge variant="outline">
            {report.policy.name} · v{report.policy.version}
          </Badge>
          {report.situation.period ? <span className="text-xs text-muted-foreground">Período analisado: {report.situation.period}</span> : null}
        </div>
        <p className="text-sm">{report.situation.summary}</p>
        <p className="text-xs text-muted-foreground">Avaliação de {formatDateTime(report.asOf)}</p>
      </div>

      {ready ? (
        <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-primary">
            <Sparkles className="size-3.5" />
            Redigido pela INIA a partir dos fatos e fontes abaixo — os critérios e as ações não mudam por este texto
          </div>
          <p className="text-sm">
            {ready.situation.text} {ready.situation.refs.map((ref) => <Handle key={ref} value={ref} />)}
          </p>
          {ready.analysis.map((item, index) => (
            <p key={index} className="text-sm text-muted-foreground">
              {item.text} {item.refs.map((ref) => <Handle key={ref} value={ref} />)}
            </p>
          ))}
          {ready.hypotheses.length > 0 ? (
            <div className="space-y-1.5 rounded-md border border-dashed p-2">
              <p className="flex items-center gap-1 text-xs font-medium">
                <CircleHelp className="size-3.5" /> Hipóteses (não são fatos)
              </p>
              {ready.hypotheses.map((item, index) => (
                <div key={index} className="text-xs">
                  <p>
                    {item.text} {item.refs.map((ref) => <Handle key={ref} value={ref} />)}
                  </p>
                  <p className="text-muted-foreground">Para confirmar: {item.toConfirm}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : narrative?.status === "FAILED" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <span className="flex items-center gap-2">
            <AlertCircle className="size-3.5 text-amber-600" />A narrativa da INIA não pôde ser gerada ({narrative.attempts} tentativa{narrative.attempts > 1 ? "s" : ""}). Os fatos, critérios e ações abaixo continuam válidos.
          </span>
          {onRetryNarrative ? (
            <Button size="sm" variant="outline" onClick={onRetryNarrative} disabled={retrying}>
              <RefreshCw className={cn("size-3.5", retrying && "animate-spin")} /> Tentar novamente
            </Button>
          ) : null}
        </div>
      ) : null}

      <Section icon={<Target className="size-4" />} title="Indicadores e fatos considerados">
        {report.facts.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum fato atendido ou não atendido — veja as incertezas.</p> : null}
        <ul className="space-y-1.5">
          {report.facts.map((fact) => (
            <li key={fact.handle} className="flex items-start justify-between gap-2 text-sm">
              <span>
                <Handle value={fact.handle} /> {fact.statement}
              </span>
              <ConditionStatusBadge status={fact.status} />
            </li>
          ))}
        </ul>
      </Section>

      {report.uncertainties.length > 0 || report.missingData.length > 0 ? (
        <Section icon={<CircleHelp className="size-4" />} title="Incertezas e dados faltantes" description="Dado ausente ou insuficiente não é desempenho ruim: nada aqui foi tratado como resultado negativo.">
          <ul className="space-y-1 text-sm text-muted-foreground">
            {report.uncertainties.map((item) => (
              <li key={item.handle}>
                <Handle value={item.handle} /> {item.statement}
              </li>
            ))}
            {report.missingData
              .filter((item) => !report.uncertainties.some((uncertainty) => uncertainty.statement === item))
              .map((item) => (
                <li key={item}>• {item}</li>
              ))}
          </ul>
        </Section>
      ) : null}

      <Section icon={<FileSearch className="size-4" />} title="Diagnóstico sustentado">
        {report.diagnosis.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem diagnóstico sustentado no período — a causa não está estabelecida.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {report.diagnosis.map((item) => (
              <li key={item.handle}>
                <Handle value={item.handle} /> {item.indicatorCode} ({item.period}): {item.patterns.map((pattern) => pattern.title).join("; ")}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<History className="size-4" />} title="Intervenções anteriores">
        {report.priorInterventions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma nos últimos 180 dias.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {report.priorInterventions.map((item) => (
              <li key={item.id} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{item.typeName}</span>
                <span className="text-muted-foreground">
                  aberta em {formatCivilDate(item.openedAt.slice(0, 10))}
                  {item.closedAt ? ` · encerrada em ${formatCivilDate(item.closedAt.slice(0, 10))}` : " · em andamento"}
                  {item.operationalResult ? ` · resultado operacional: ${OPERATIONAL_RESULT_LABELS[item.operationalResult] ?? item.operationalResult}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<ListChecks className="size-4" />} title="Ações propostas e justificativa">
        <div className="space-y-2">
          {report.actions.map((action) => (
            <div key={action.handle} className={cn("space-y-1.5 rounded-lg border p-3", highlightInterventionId && action.interventionId === highlightInterventionId && "border-primary/50 bg-primary/5")}>
              <div className="flex flex-wrap items-center gap-2">
                <Handle value={action.handle} />
                <span className="text-sm font-medium">{action.typeName}</span>
                <Badge variant="outline">{action.statusLabel}</Badge>
                {action.dueAt ? <span className="text-xs text-muted-foreground">Prazo {formatCivilDate(action.dueAt)}</span> : null}
              </div>
              <p className="text-sm text-muted-foreground">{action.justification}</p>
              {action.supportingFacts.length > 0 ? <p className="text-xs text-muted-foreground">Sustentado por: {action.supportingFacts.join(" · ")}</p> : null}
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <p className="font-medium">Próximos passos</p>
                  <ul className="text-muted-foreground">
                    {action.nextSteps.map((step) => (
                      <li key={step}>• {step}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium">Critérios de resultado</p>
                  <ul className="text-muted-foreground">
                    {action.resultCriteria.length > 0 ? action.resultCriteria.map((item) => <li key={item}>• {item}</li>) : <li>—</li>}
                  </ul>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Responsável: {action.responsible?.name ?? "—"}
                {action.approver ? ` · Aprovação: ${action.approver.name}` : ""}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          <BookOpenCheck className="size-4" /> Critérios da política e fontes consultáveis
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-3">
          <p className="text-xs text-muted-foreground">
            {report.policy.matchStrategy === "FIRST_MATCH" ? "Vale a primeira regra atendida, pela prioridade." : "Valem todas as regras atendidas."} Vigente desde {formatDateTime(report.policy.effectiveFrom)}.
            {report.policy.blockedBy ? ` A regra “${report.policy.rules.find((rule) => rule.key === report.policy.blockedBy)?.name ?? report.policy.blockedBy}” ficou inconclusiva antes de qualquer regra atendida: as de prioridade menor não decidem por falta de dado.` : ""}
          </p>
          {report.policy.rules.map((rule) => (
            <div key={rule.key} className="space-y-1 rounded-md border p-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {rule.priority}. {rule.name}
                </span>
                <ConditionStatusBadge status={rule.status} />
              </div>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {rule.conditions.map((condition, index) => (
                  <li key={index} className="flex items-start justify-between gap-2">
                    <span>{condition.statement}</span>
                    <span className="shrink-0">{CONDITION_STATUS_LABELS[condition.status]}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {report.sources.map((source) => (
              <li key={source.handle}>
                <Handle value={source.handle} /> {source.label}
                {source.occurredAt ? ` · ${formatDateTime(source.occurredAt)}` : ""}
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
