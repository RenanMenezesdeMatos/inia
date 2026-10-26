"use client"

import { useState } from "react"
import { BarChart3, ChevronDown, ChevronRight, Cpu, MessageSquareText } from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import { RichContent } from "@/components/rich-content/rich-content"
import { ListDateRangeFilter, ListSearchInput, ListSelectFilter, ListToolbar, optionsFromLabels } from "@/components/admin/shared/list/list-filters"
import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { useAdminListState } from "@/hooks/use-admin-list-state"
import { formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useWorkflowDispatchDetailQuery, useWorkflowResultsPageQuery, useWorkflowResultsSummaryQuery } from "@/queries/admin/use-workflow-results-queries"
import { FEEDBACK_DISPOSITION_REASON_LABELS } from "@/schemas/admin/qa-lab.schema"
import { OUTPUT_SURFACE_LABELS, type OutputSurface } from "@/schemas/admin/workflow-graph.schema"
import { ENROLLMENT_STATUS_LABELS } from "@/schemas/admin/workflow.schema"
import { ExecutionFailureDetail } from "./execution-failure"
import {
  DISPATCH_STATUS_LABELS,
  RESULT_TRIGGER_KIND_LABELS,
  type DispatchRow,
  type DispatchStatus,
  type PersonResult,
  type ResultAiCall,
  type ResultFeedback,
  type ResultFindings,
  type ResultTriggerKind,
  type UsageTotals,
} from "@/schemas/admin/workflow-results.schema"
import type { DateRangeFilter } from "@/lib/admin/list-query"

/**
 * V1.5.13 — aba "Resultados": o que cada DISPARO do Workflow produziu (resultado de negócio + consumo de IA). A aba
 * "Execuções" continua sendo o diagnóstico do motor. Tudo vem do read model do backend (efeitos persistidos, artefato
 * confiável + QA, uso de IA correlacionado); a tela não reconstrói resultado nem estima tokens/custo.
 */

// ---------------------------------------------------------------------------------------------
// FORMATAÇÃO
// ---------------------------------------------------------------------------------------------

const ND = "N/D"
const formatInt = (value: number) => value.toLocaleString("pt-BR")
export function formatTokens(value: number | null, incomplete = false) {
  if (value === null) return ND
  return `${formatInt(value)}${incomplete ? "+" : ""}`
}
export function formatCost(usage: UsageTotals) {
  if (usage.costs.length === 0) return usage.calls > 0 ? "Indisponível" : "—"
  return usage.costs
    .map((cost) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: cost.currency, minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(cost.amount)))
    .join(" + ")
}
/** V1.7.1 — como o Orquestrador coordenou (nunca mostra chamada de IA que não houve). */
const ROUTING_LABELS = { DETERMINISTIC: "especialista definido pelo Workflow (sem IA)", MODEL: "especialista escolhido pela IA" } as const
const SYNTHESIS_LABELS = { PASSTHROUGH: "síntese dispensada (resultado do especialista)", MODEL: "síntese pela IA", NONE: "sem especialista acionado" } as const
/**
 * V1.7.1a — análise completa × feedback numa linha: nunca fingir que só existiam os publicados. As partes zeradas somem
 * (exceto detectados/confiáveis/no feedback).
 */
export function describeFindings(findings: ResultFindings): string {
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  const rest = [
    findings.heldForQa > 0 ? plural(findings.heldForQa, "aguardando QA", "aguardando QA") : null,
    findings.rejected > 0 ? plural(findings.rejected, "rejeitado no QA", "rejeitados no QA") : null,
    findings.blocked > 0 ? plural(findings.blocked, "bloqueado pela estrutura", "bloqueados pela estrutura") : null,
    findings.collapsedDuplicates > 0 ? plural(findings.collapsedDuplicates, "etapa repetida fundida", "etapas repetidas fundidas") : null,
    findings.notObservable > 0 ? plural(findings.notObservable, "não observável", "não observáveis") : null,
    findings.notApplicable > 0 ? plural(findings.notApplicable, "não aplicável", "não aplicáveis") : null,
    // V1.7.1c — etapas propostas fora do contrato: a análise foi PARCIAL (nunca se passa por completa).
    findings.outsideContract ? `${plural(findings.outsideContract, "etapa fora do contrato", "etapas fora do contrato")} (análise parcial)` : null,
    // V1.7.1l — trechos de objetivo/abrangência/conceitos citados como etapa: contexto do procedimento, não avaliados.
    findings.notCheckpoint ? plural(findings.notCheckpoint, "citação de contexto (não é etapa)", "citações de contexto (não são etapas)") : null,
  ].filter(Boolean)
  return `Achados: ${plural(findings.detected, "detectado", "detectados")} · ${plural(findings.reliable, "confiável", "confiáveis")} · ${findings.inFeedback} no feedback${rest.length > 0 ? ` · ${rest.join(" · ")}` : ""}`
}

function describeOrchestration(orchestrator: { routing: keyof typeof ROUTING_LABELS | null; synthesis: keyof typeof SYNTHESIS_LABELS | null }): string {
  return [orchestrator.routing ? ROUTING_LABELS[orchestrator.routing] : null, orchestrator.synthesis ? SYNTHESIS_LABELS[orchestrator.synthesis] : null].filter(Boolean).join(", ") || "não informado"
}

function formatDuration(ms: number | null) {
  if (ms === null) return null
  if (ms < 1000) return `${ms} ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes} min ${seconds % 60} s` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}
const reasonLabel = (code: string) => FEEDBACK_DISPOSITION_REASON_LABELS[code] ?? code
const surfaceLabel = (surface: string) => OUTPUT_SURFACE_LABELS[surface as OutputSurface] ?? surface

// O AccordionContent compartilhado fixa a altura no valor medido ao abrir; aqui o conteúdo chega DEPOIS (detalhe do disparo
// carregado sob demanda) e ainda abre accordions internos — altura natural, senão pessoas/feedback ficam cortados.
const NATURAL_HEIGHT = "h-auto [&_p:not(:last-child)]:mb-0"

const DISPATCH_TONE: Record<DispatchStatus, string> = {
  RUNNING: "bg-primary/10 text-primary",
  COMPLETED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  PARTIAL: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  FAILED: "bg-red-500/10 text-red-700 dark:text-red-400",
}

const DISPOSITION_LABELS: Record<ResultFeedback["disposition"], string> = {
  READY: "Pronto",
  HOLD_FOR_QA: "Aguardando QA",
  BLOCKED: "Bloqueado",
  REJECTED: "Rejeitado no QA",
  PENDING: "Em geração",
  FAILED: "Falhou",
  PUBLISHED: "Publicado",
  ABSTAINED: "Sem feedback",
}
const DISPOSITION_TONE: Record<ResultFeedback["disposition"], string> = {
  READY: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  PUBLISHED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  HOLD_FOR_QA: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  BLOCKED: "bg-red-500/10 text-red-700 dark:text-red-400",
  REJECTED: "bg-red-500/10 text-red-700 dark:text-red-400",
  FAILED: "bg-red-500/10 text-red-700 dark:text-red-400",
  PENDING: "bg-muted text-muted-foreground",
  ABSTAINED: "bg-muted text-muted-foreground",
}
// Motor de feedback: por que não houve mensagem (resultado válido — nunca espera de aprovação).
const ENGINE_REASON_LABELS: Record<string, string> = {
  NOTHING_MATERIAL: "Nada material a comunicar nesta análise",
  ALREADY_DELIVERED: "Os pontos desta análise já tinham sido comunicados",
  INSUFFICIENT_EVIDENCE: "Evidência insuficiente para concluir (ex.: transcrição incompleta, sem procedimento aplicável ou conclusões não confirmadas pela revisão)",
  NO_ACTIONABLE_DIAGNOSIS: "A investigação não sustentou um diagnóstico acionável",
  INVESTIGATION_INTERRUPTED_BY_BUDGET: "O limite de IA da execução acabou antes de a investigação responder o que estava em aberto — a próxima execução retoma",
  NOTHING_TO_INVESTIGATE: "Nada a investigar neste fechamento",
  NO_INTERACTION: "Sem interação associada ao disparo",
  ANALYSIS_NOT_FOUND: "Análise de origem não encontrada",
  INVESTIGATION_NOT_FOUND: "Investigação de origem não encontrada",
  NO_BRIEF: "Sem conteúdo para compor",
  NO_SAFE_MESSAGE: "Nenhuma mensagem útil, coerente e sustentada pôde ser escrita — a análise ficou registrada, nada foi enviado",
}
/** Motivos técnicos do detalhe da abstenção que têm leitura própria (os demais aparecem como vieram). */
const ENGINE_DETAIL_LABELS: Record<string, string> = {
  PRODUCT_NOT_ESTABLISHED: "o que havia para avaliar dependia de um produto que a gravação não estabeleceu — nada foi cobrado nem reconhecido",
  PRODUCT_DEPENDENT_POINTS_SUSPENDED: "pontos que dependiam do produto ficaram sem avaliação",
}
const engineDetailOf = (detail: string) => detail.split(",").map((code) => ENGINE_DETAIL_LABELS[code.trim()] ?? code.trim()).join("; ")
const TONE_LABELS: Record<string, string> = { RECOGNITION: "reconhecimento", DEVELOPMENT: "desenvolvimento", MIXED: "reconhecimento e desenvolvimento", INFORMATIVE: "informativo (sem causa sustentada)" }
const OUTPUT_STATUS_LABELS: Record<PersonResult["outputs"][number]["status"], string> = { SENT: "enviado", RECORDED_NOT_DELIVERED: "registrado, não entregue", NOT_EMITTED: "não emitido" }
const QA_LABELS: Record<ResultFeedback["items"][number]["qaStatus"], string | null> = {
  NOT_SELECTED_FOR_QA: null,
  PENDING_REVIEW: "Aguardando QA",
  APPROVED_UNCHANGED: "Aprovado no QA",
  APPROVED_EDITED: "Editado no QA",
  REJECTED: "Rejeitado no QA",
}
const FACT_ROLE_LABELS: Record<string, string> = { OPERADOR: "Operador", CLIENTE: "Cliente", EVENTO: "Evento da chamada", OUTRO: "Participante", DADO_OFICIAL: "Dado oficial", ANALISE: "Análise da amostra", REFERENCIA: "Grupo de referência (agregado)" }

function Tone({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", className)}>{children}</span>
}

// ---------------------------------------------------------------------------------------------
// CARDS DO PERÍODO
// ---------------------------------------------------------------------------------------------

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function SummaryCards({ workflowId, filters }: { workflowId: string; filters: ResultsQueryFilters }) {
  const summary = useWorkflowResultsSummaryQuery(workflowId, filters)
  if (summary.isLoading) return <Skeleton className="h-24 w-full" />
  if (summary.isError || !summary.data) return <p className="text-sm text-destructive">Não foi possível carregar o resumo do período.</p>
  const data = summary.data
  return (
    <section aria-label="Resumo do período" className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Período: {new Date(`${data.period.from}T12:00:00`).toLocaleDateString("pt-BR")} – {new Date(`${data.period.to}T12:00:00`).toLocaleDateString("pt-BR")}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryCard label="Disparos" value={formatInt(data.dispatches)} />
        <SummaryCard label="Pessoas processadas" value={formatInt(data.persons)} />
        <SummaryCard label="Feedbacks produzidos" value={formatInt(data.feedbacksProduced)} />
        <SummaryCard label="Feedbacks enviados" value={formatInt(data.feedbacksSent)} />
        <SummaryCard label="Aguardando QA" value={formatInt(data.awaitingQa)} />
        <SummaryCard label="Bloqueados" value={formatInt(data.blocked)} />
        <SummaryCard label="Tokens consumidos" value={formatTokens(data.usage.totalTokens, data.usage.incomplete)} hint={data.usage.incomplete ? "algumas chamadas sem tokens informados" : null} />
        <SummaryCard label="Custo de IA" value={formatCost(data.usage)} hint={data.usage.costUnknownCalls > 0 ? `${data.usage.costUnknownCalls} chamada(s) sem preço` : null} />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// PESSOA
// ---------------------------------------------------------------------------------------------

function WordingBlock({ label, text }: { label: string; text: string }) {
  // V1.6.0 — relevância/orientação vazias = sem fundamento: a seção não aparece (nunca "completada").
  if (!text.trim()) return null
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <RichContent text={text} />
    </div>
  )
}

/** Feedback que saiu por Avatar/Chat (Workflow Outputs V1) — "não emitido" seria falso: existe entrega registrada. */
function conversationalTitle(outputs: PersonResult["outputs"]): string | null {
  const avatar = outputs.find((output) => output.surface === "AVATAR" && output.status !== "NOT_EMITTED")
  if (avatar) return avatar.status === "SENT" ? "Feedback produzido — ouvido no Avatar" : "Feedback produzido — recado disponível no Avatar (ainda não ouvido)"
  const chat = outputs.find((output) => output.surface === "CHAT" && output.status !== "NOT_EMITTED")
  return chat ? "Feedback produzido — entregue no Chat da INIA" : null
}

function FeedbackView({ feedback, subjectName, outputs = [] }: { feedback: ResultFeedback; subjectName: string; outputs?: PersonResult["outputs"] }) {
  const conversational = !feedback.sent && feedback.disposition === "READY" ? conversationalTitle(outputs) : null
  const title = feedback.sent ? "Mensagem enviada" : feedback.disposition === "HOLD_FOR_QA" ? "Feedback produzido — aguardando QA" : conversational ?? (feedback.disposition === "READY" ? "Feedback produzido — não emitido" : feedback.disposition === "ABSTAINED" ? "Análise registrada — sem mensagem ao colaborador" : "Feedback")
  return (
    <div className="space-y-3 rounded-md border bg-background p-3" data-testid="result-feedback">
      <div className="flex flex-wrap items-center gap-2">
        <Tone className={DISPOSITION_TONE[feedback.disposition]}>{DISPOSITION_LABELS[feedback.disposition]}</Tone>
        <span className="text-sm font-medium">{title}</span>
        {feedback.label ? <span className="text-xs text-muted-foreground">· {feedback.label}</span> : null}
      </div>
      {feedback.sent ? (
        <p className="text-xs text-muted-foreground">
          Acompanhamento · para {subjectName}
          {feedback.emittedAt ? ` · emitido em ${formatDateTime(feedback.emittedAt)}` : ""}
        </p>
      ) : null}
      {feedback.reasons.length > 0 && feedback.disposition !== "READY" ? (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground" aria-label="Motivos">
          {feedback.reasons.map((reason) => (
            <li key={reason}>{feedback.kind === "ENGINE" ? (ENGINE_REASON_LABELS[reason] ?? reason) : reasonLabel(reason)}</li>
          ))}
        </ul>
      ) : null}
      {feedback.error ? <p className="text-xs text-destructive">Erro: {feedback.error}</p> : null}
      {feedback.findings ? <p className="text-xs text-muted-foreground" data-testid="result-findings">{describeFindings(feedback.findings)}</p> : null}
      {feedback.presentation ? (
        <div className="space-y-1" data-testid="result-presentation">
          <WordingBlock label={`Abertura${feedback.presentation.source === "SYSTEM" ? " (versão do sistema)" : ""}`} text={`${feedback.presentation.greeting} ${feedback.presentation.introduction}`} />
        </div>
      ) : null}
      {feedback.items.map((item, index) => (
        <div key={index} className="space-y-2 border-t pt-2 first:border-t-0 first:pt-0">
          <div className="flex flex-wrap items-center gap-2">
            {item.priorityRank ? <span className="text-xs tabular-nums text-muted-foreground">{item.priorityRank}.</span> : null}
            <Badge variant="outline">{item.sectionLabel}</Badge>
            {item.stepTitle ? <span className="text-xs font-medium">{item.stepTitle}</span> : null}
            {QA_LABELS[item.qaStatus] ? <Badge variant="secondary">{QA_LABELS[item.qaStatus]}</Badge> : null}
          </div>
          <WordingBlock label="O que aconteceu" text={item.wording.observed} />
          <WordingBlock label="Por que importa" text={item.wording.whyItMatters} />
          <WordingBlock label="O que você pode fazer" text={item.wording.whatYouCanDo} />
          <WordingBlock label="Exemplo de condução (sugestão, não é fala da chamada)" text={item.wording.suggestedResponse ?? ""} />
          {item.facts.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Evidências</p>
              <ul className="space-y-1 text-xs">
                {item.facts.map((fact, factIndex) => (
                  <li key={factIndex}>
                    <span className="text-muted-foreground">{FACT_ROLE_LABELS[fact.role] ?? fact.role}:</span> “{fact.text}
                    {fact.truncated ? "…" : ""}”
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ))}
      {feedback.presentation ? <WordingBlock label="Fechamento" text={feedback.presentation.closing} /> : null}
      {feedback.engine ? (
        <div className="space-y-2" data-testid="result-engine-message">
          {feedback.engine.tone ? <p className="text-xs text-muted-foreground">Tom: {TONE_LABELS[feedback.engine.tone] ?? feedback.engine.tone} · {feedback.engine.developments} ponto(s) de ajuste · {feedback.engine.strengths} ponto(s) forte(s)</p> : null}
          <WordingBlock label="Resumo" text={feedback.engine.card ?? ""} />
          <WordingBlock label="Mensagem" text={feedback.engine.narrative.join("\n\n")} />
          {feedback.engine.abstainDetail ? <p className="text-xs text-muted-foreground">Detalhe: {engineDetailOf(feedback.engine.abstainDetail)}</p> : null}
        </div>
      ) : null}
      {feedback.legacy ? (
        <div className="space-y-2">
          <WordingBlock label="Comportamento observado" text={feedback.legacy.observedBehavior} />
          <WordingBlock label="Recomendação" text={feedback.legacy.recommendation} />
          <WordingBlock label="Evidência" text={feedback.legacy.evidenceFound} />
        </div>
      ) : null}
    </div>
  )
}

function UsageLine({ call }: { call: ResultAiCall }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{call.actor ? `${call.useCaseLabel} · ${call.actor}` : call.useCaseLabel}</p>
        <p className="text-xs text-muted-foreground">
          {call.modelName}
          {call.nodeLabel ? ` · nó "${call.nodeLabel}"` : ""}
          {call.usage.calls > 1 ? ` · ${call.usage.calls} chamadas` : ""}
        </p>
      </div>
      <div className="text-right text-xs tabular-nums">
        <p className="text-sm font-medium">{formatTokens(call.usage.totalTokens, call.usage.incomplete)} tokens</p>
        <p className="text-muted-foreground">
          entrada {formatTokens(call.usage.inputTokens)} · saída {formatTokens(call.usage.outputTokens)} · {formatCost(call.usage)}
        </p>
      </div>
    </li>
  )
}

export function AiUsageSection({ calls, total }: { calls: ResultAiCall[]; total: UsageTotals }) {
  const [open, setOpen] = useState(false)
  if (calls.length === 0) return <p className="text-xs text-muted-foreground">Nenhum uso de IA correlacionado a esta execução.</p>
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-auto px-0 text-xs">
          {open ? <ChevronDown /> : <ChevronRight />} <Cpu /> Uso de IA · {formatTokens(total.totalTokens, total.incomplete)} tokens
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="divide-y rounded-md border bg-background px-3">
          {calls.map((call, index) => (
            <UsageLine key={index} call={call} />
          ))}
          <li className="flex justify-between py-1.5 text-sm font-semibold">
            <span>Total</span>
            <span className="tabular-nums">
              {formatTokens(total.totalTokens, total.incomplete)} tokens · {formatCost(total)}
            </span>
          </li>
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

function personHeadline(person: PersonResult): string {
  if (person.waitingForQa) return "Aguardando QA"
  const feedback = person.feedbacks[0]
  if (feedback) return DISPOSITION_LABELS[feedback.disposition]
  return ENROLLMENT_STATUS_LABELS[person.status]
}

export function PersonResultItem({ person }: { person: PersonResult }) {
  const structure = [person.person.teamName, person.person.subteamName].filter(Boolean).join(" · ")
  const sentOutputs = person.outputs.filter((output) => output.status === "SENT")
  return (
    <AccordionItem value={person.enrollmentId}>
      <AccordionTrigger className="py-2 hover:no-underline">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left">
          <span className="font-medium">{person.person.name}</span>
          <span className="text-xs text-muted-foreground">
            {personHeadline(person)}
            {sentOutputs.length > 0 ? ` · ${[...new Set(sentOutputs.map((output) => surfaceLabel(output.surface)))].join(", ")}` : ""}
          </span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{formatTokens(person.usage.totalTokens, person.usage.incomplete)} tokens</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className={cn(NATURAL_HEIGHT, "space-y-3 pb-4")}>
        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <div className="flex gap-1"><dt className="text-muted-foreground">Estrutura:</dt><dd>{structure || "—"}</dd></div>
          <div className="flex gap-1"><dt className="text-muted-foreground">Status:</dt><dd>{ENROLLMENT_STATUS_LABELS[person.status]}</dd></div>
          {person.agents.length > 0 ? <div className="flex gap-1"><dt className="text-muted-foreground">Agente:</dt><dd>{person.agents.map((agent) => agent.name).join(", ")}</dd></div> : null}
          {person.orchestrators.length > 0 ? <div className="flex gap-1"><dt className="text-muted-foreground">Orquestrador:</dt><dd>{person.orchestrators.map((orchestrator) => orchestrator.name).join(", ")}</dd></div> : null}
          {person.orchestrators.some((orchestrator) => orchestrator.routing || orchestrator.synthesis) ? (
            <div className="flex gap-1 sm:col-span-2"><dt className="text-muted-foreground">Coordenação:</dt><dd>{person.orchestrators.map(describeOrchestration).join(" · ")}</dd></div>
          ) : null}
          {formatDuration(person.durationMs) ? <div className="flex gap-1"><dt className="text-muted-foreground">Duração:</dt><dd>{formatDuration(person.durationMs)}</dd></div> : null}
          <div className="flex gap-1"><dt className="text-muted-foreground">Custo:</dt><dd>{formatCost(person.usage)}</dd></div>
        </dl>
        {person.error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">Erro: {person.error}</p> : null}
        {person.failure ? <ExecutionFailureDetail failure={person.failure} /> : null}

        {person.feedbacks.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum feedback produzido nesta execução.</p> : null}
        {person.feedbacks.map((feedback, index) => (
          <FeedbackView key={`${feedback.nodeId}-${index}`} feedback={feedback} subjectName={person.person.name} outputs={person.outputs} />
        ))}

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Outputs</p>
          {person.outputs.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum Output emitido.</p>
          ) : (
            <ul className="space-y-0.5 text-sm">
              {person.outputs.map((output, index) => (
                <li key={index} className={cn(output.status !== "SENT" && "text-muted-foreground")}>
                  {surfaceLabel(output.surface)} — {OUTPUT_STATUS_LABELS[output.status]}
                  <span className="text-xs text-muted-foreground">
                    {" "}· para {output.recipientName}
                    {output.emittedAt ? ` · ${formatDateTime(output.emittedAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <AiUsageSection calls={person.aiCalls} total={person.usage} />
      </AccordionContent>
    </AccordionItem>
  )
}

// ---------------------------------------------------------------------------------------------
// DISPARO
// ---------------------------------------------------------------------------------------------

const PERSON_PAGE_SIZE = 50

function DispatchPersons({ workflowId, dispatch }: { workflowId: string; dispatch: DispatchRow }) {
  const [page, setPage] = useState(1)
  const detail = useWorkflowDispatchDetailQuery(workflowId, dispatch.rootEnrollmentId, page, PERSON_PAGE_SIZE, true)
  if (detail.isLoading) return <Skeleton className="h-16 w-full" />
  if (detail.isError || !detail.data) return <p className="text-sm text-destructive">Não foi possível carregar as pessoas deste disparo.</p>
  const { persons, rootUsage } = detail.data
  return (
    <div className="space-y-3">
      {persons.items.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma pessoa processada neste disparo (no seu escopo).</p> : null}
      <Accordion type="multiple" className="rounded-md border px-3">
        {persons.items.map((person) => (
          <PersonResultItem key={person.enrollmentId} person={person} />
        ))}
      </Accordion>
      {persons.total > persons.pageSize ? (
        <ListPagination page={page} pageSize={persons.pageSize} total={persons.total} onPageChange={setPage} onPageSizeChange={() => undefined} itemLabel={["pessoa", "pessoas"]} isFetching={detail.isFetching} />
      ) : null}
      {rootUsage ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Consolidação do disparo (não pertence a uma pessoa)</p>
          <AiUsageSection calls={rootUsage.aiCalls} total={rootUsage.usage} />
        </div>
      ) : null}
    </div>
  )
}

function DispatchItem({ workflowId, dispatch, open }: { workflowId: string; dispatch: DispatchRow; open: boolean }) {
  return (
    <AccordionItem value={dispatch.rootEnrollmentId} className="rounded-lg border px-4 not-last:border-b">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{formatDateTime(dispatch.createdAt)}</span>
            <Tone className={DISPATCH_TONE[dispatch.status]}>{DISPATCH_STATUS_LABELS[dispatch.status]}</Tone>
            <span className="text-xs text-muted-foreground">
              {dispatch.trigger.label} · versão {dispatch.version.number}
              {dispatch.version.active ? " (publicada)" : ""}
            </span>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="dispatch-counters">
            {formatInt(dispatch.persons)} {dispatch.persons === 1 ? "pessoa" : "pessoas"} · {formatInt(dispatch.feedbacksSent)} {dispatch.feedbacksSent === 1 ? "enviado" : "enviados"} · {formatInt(dispatch.awaitingQa)} QA · {formatInt(dispatch.blocked)}{" "}
            {dispatch.blocked === 1 ? "bloqueado" : "bloqueados"} · {formatTokens(dispatch.usage.totalTokens, dispatch.usage.incomplete)} tokens · {formatCost(dispatch.usage)}
          </p>
        </div>
      </AccordionTrigger>
      <AccordionContent className={cn(NATURAL_HEIGHT, "pb-4")}>{open ? <DispatchPersons workflowId={workflowId} dispatch={dispatch} /> : null}</AccordionContent>
    </AccordionItem>
  )
}

// ---------------------------------------------------------------------------------------------
// ABA
// ---------------------------------------------------------------------------------------------

type ResultsFiltersState = { search: string; period: DateRangeFilter; status?: DispatchStatus | undefined; triggerKind?: ResultTriggerKind | undefined }
type ResultsQueryFilters = { period: DateRangeFilter; status?: DispatchStatus; triggerKind?: ResultTriggerKind; collaborator?: string }
const DEFAULT_FILTERS: ResultsFiltersState = { search: "", period: {} }
const STATUS_OPTIONS = optionsFromLabels(DISPATCH_STATUS_LABELS)
const TRIGGER_OPTIONS = optionsFromLabels(RESULT_TRIGGER_KIND_LABELS)

export function WorkflowResultsTab({ workflowId }: { workflowId: string }) {
  const list = useAdminListState({ storageKey: "workflow-results", defaultFilters: DEFAULT_FILTERS, defaultPageSize: 20 })
  const [openItems, setOpenItems] = useState<string[]>([])
  const filters: ResultsQueryFilters = {
    period: list.params.period,
    ...(list.params.status ? { status: list.params.status } : {}),
    ...(list.params.triggerKind ? { triggerKind: list.params.triggerKind } : {}),
    ...(list.params.search ? { collaborator: list.params.search } : {}),
  }
  const page = useWorkflowResultsPageQuery(workflowId, filters, list.page, list.pageSize)

  return (
    <div className="space-y-4">
      <ListToolbar
        search={<ListSearchInput value={list.filters.search} onChange={(value) => list.setFilter("search", value)} placeholder="Buscar colaborador" ariaLabel="Buscar colaborador" pending={list.isSearchPending} />}
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.resetFilters}
      >
        <ListDateRangeFilter label="Últimos 30 dias" value={list.filters.period} onChange={(value) => list.setFilter("period", value)} />
        <ListSelectFilter value={list.filters.status} onChange={(value) => list.setFilter("status", value)} options={STATUS_OPTIONS} allLabel="Todos os status" ariaLabel="Filtrar por status" />
        <ListSelectFilter value={list.filters.triggerKind} onChange={(value) => list.setFilter("triggerKind", value)} options={TRIGGER_OPTIONS} allLabel="Todos os gatilhos" ariaLabel="Filtrar por tipo de gatilho" />
      </ListToolbar>

      <SummaryCards workflowId={workflowId} filters={filters} />

      {page.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : page.isError || !page.data ? (
        <p className="text-sm text-destructive">Não foi possível carregar os disparos.</p>
      ) : page.data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
          <BarChart3 className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">{list.hasActiveFilters ? "Nenhum disparo corresponde aos filtros" : "Nenhum disparo no período"}</p>
          <p className="text-xs text-muted-foreground">
            <MessageSquareText className="mr-1 inline size-3" />
            Cada disparo do Workflow aparece aqui com as pessoas processadas, o feedback emitido e o consumo de IA.
          </p>
        </div>
      ) : (
        <>
          <Accordion type="multiple" value={openItems} onValueChange={setOpenItems} className="space-y-2">
            {page.data.items.map((dispatch) => (
              <DispatchItem key={dispatch.rootEnrollmentId} workflowId={workflowId} dispatch={dispatch} open={openItems.includes(dispatch.rootEnrollmentId)} />
            ))}
          </Accordion>
          <ListPagination page={list.page} pageSize={list.pageSize} total={page.data.total} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} itemLabel={["disparo", "disparos"]} isFetching={page.isFetching} />
        </>
      )}
    </div>
  )
}
