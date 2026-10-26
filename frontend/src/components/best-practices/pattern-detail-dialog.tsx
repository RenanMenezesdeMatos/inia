"use client"

import { AlertTriangle, CheckCircle2, CircleSlash, History, Info, MessageSquareQuote, Scale } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCivilDate, formatShortDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { usePatternQuery } from "@/queries/best-practices/use-best-practices"
import type { ContextResult, PatternDetail } from "@/schemas/best-practices/best-practices.schema"

import { OBLIGATION_LABELS, OUTCOME_LABELS, percentLabel, REVIEW_ACTION_LABELS, REVIEW_LABELS, reviewBadgeVariant, STRENGTH_LABELS } from "./best-practice-labels"
import { PatternEvidence } from "./pattern-evidence"
import { PatternReviewActions } from "./pattern-review-actions"

/** Detalhe do padrão num diálogo amplo (nunca Sheet): o que é, os números por contexto e os critérios, a verificação de obrigação, as evidências, as limitações e o histórico. */
export function PatternDetailDialog({ patternId, onClose }: { patternId: string | null; onClose: () => void }) {
  const query = usePatternQuery(patternId)
  return (
    <Dialog open={patternId !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-4xl overflow-y-auto sm:max-w-4xl">
        {query.data ? <PatternDetailBody pattern={query.data} /> : (
          <>
            <DialogHeader><DialogTitle>Boa prática</DialogTitle><DialogDescription>Carregando…</DialogDescription></DialogHeader>
            {query.isError ? <p className="text-sm text-destructive">Não foi possível abrir o padrão.</p> : <Skeleton className="h-64 w-full" />}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Info; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-primary" aria-hidden />{title}</h3>
      {children}
    </section>
  )
}

export function PatternDetailBody({ pattern }: { pattern: PatternDetail }) {
  const current = pattern.current
  const check = current?.obligationCheck
  return (
    <div className="space-y-5">
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={reviewBadgeVariant(pattern.reviewStatus)}>{REVIEW_LABELS[pattern.reviewStatus]}</Badge>
          <Badge variant="outline">{pattern.indicatorName}{pattern.outcomeSource === "CALL_SIGNAL" ? " · sinal da chamada" : ""}</Badge>
          <Badge variant="outline">Força: {STRENGTH_LABELS[pattern.currentStrength]}</Badge>
          <Badge variant="outline">{OBLIGATION_LABELS[pattern.obligationStatus]}{pattern.obligationConfirmedByReview ? " · confirmado na revisão" : ""}</Badge>
          {pattern.dataOrigin === "SYNTHETIC" ? <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">Dados sintéticos — não é prova</Badge> : <Badge variant="outline">Dados reais · {pattern.teamName}{pattern.subteamName ? ` · Subgrupo ${pattern.subteamName}` : ""}</Badge>}
        </div>
        <DialogTitle className="text-xl">{pattern.name}</DialogTitle>
        <DialogDescription>{pattern.description}</DialogDescription>
      </DialogHeader>

      <div className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", pattern.available ? "border-primary/40 bg-primary/5" : "border-border bg-muted/40")}>
        {pattern.available ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /> : <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <div>
          <p className="font-medium">{pattern.available ? "Disponível para orientar operadores (chat, voz, feedback e diagnóstico)" : "Não orienta operadores agora"}</p>
          {pattern.unavailabilityReasons.length > 0 ? <ul className="list-disc pl-4 text-muted-foreground">{pattern.unavailabilityReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
        </div>
      </div>

      <Section title="Como aplicar" icon={MessageSquareQuote}>
        <p className="text-sm">{pattern.guidance}</p>
        {pattern.suggestedPhrasing ? <p className="rounded-md bg-muted/50 p-2 text-sm"><span className="block text-xs font-medium text-muted-foreground">Sugestão de fala — exemplo para experimentar, não é fala de nenhuma chamada</span>“{pattern.suggestedPhrasing}”</p> : null}
        <dl className="grid gap-1 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Como reconhecer na chamada</dt><dd>{pattern.observableDefinition}</dd></div>
          {pattern.appliesWhen ? <div><dt className="text-xs text-muted-foreground">Quando é possível</dt><dd>{pattern.appliesWhen}</dd></div> : null}
          {pattern.notApplicableWhen ? <div><dt className="text-xs text-muted-foreground">Não se aplica quando</dt><dd>{pattern.notApplicableWhen}</dd></div> : null}
        </dl>
        <div className="space-y-1 text-sm" data-slot="how-it-helps">
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Como isso ajuda no resultado
            {pattern.howItHelps && pattern.howItHelpsSource === "AI_DRAFT" && pattern.reviewStatus === "PENDING_REVIEW" ? <Badge variant="outline" className="text-[11px] font-normal">Rascunho da IA — confira antes de aprovar</Badge> : null}
          </p>
          {pattern.howItHelps ? <p className="break-words">{pattern.howItHelps}</p> : <p className="text-muted-foreground">Sem texto: o feedback não liga esta prática ao resultado.</p>}
        </div>
      </Section>

      {current ? (
        <Section title={`Comparação (versão ${current.version} · ${formatCivilDate(current.periodStart)} a ${formatCivilDate(current.periodEnd)} · ${current.callsAnalyzed} chamadas de ${current.operatorsAnalyzed} operadores)`} icon={Scale}>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contexto</TableHead>
                  <TableHead className="text-right">Melhores resultados</TableHead>
                  <TableHead className="text-right">Referência</TableHead>
                  <TableHead className="text-right">Diferença</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{current.contexts.map((context) => <ContextRow key={context.cellKey} context={context} />)}</TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">Frequência = média das taxas de cada operador nas próprias chamadas em que a situação existiu. Associação observada, nunca causa.</p>
          <Collapsible>
            <CollapsibleTrigger className="text-xs font-medium text-primary hover:underline">Ver os critérios de força por contexto</CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-3">
              {current.contexts.map((context) => (
                <div key={context.cellKey} className="text-xs">
                  <p className="font-medium">{context.label} — {context.assessment.explanation}</p>
                  <ul className="mt-1 space-y-0.5">{context.assessment.criteria.map((criterion) => <li key={criterion.key} className={cn(criterion.met ? "text-foreground" : "text-muted-foreground")}>{criterion.met ? "✓" : "✗"} {criterion.label} · {criterion.value}</li>)}</ul>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </Section>
      ) : null}

      {check ? (
        <Section title="Verificação de obrigação do processo" icon={Info}>
          <p className="text-sm"><span className="font-medium">{check.status ? OBLIGATION_LABELS[check.status] : "Não verificada"}</span>{check.explanation ? ` — ${check.explanation}` : check.reason ? ` — ${check.reason}` : ""}</p>
          {check.additionalBehavior ? <p className="text-sm">O que vai além do exigido: {check.additionalBehavior}</p> : null}
          {check.sources.length > 0 ? <ul className="space-y-1 text-xs text-muted-foreground">{check.sources.map((source) => <li key={source.handle}>{source.title}: “{source.text}”</li>)}</ul> : null}
          {check.consulted ? <p className="text-xs text-muted-foreground">Fontes consultadas: {check.consulted.documents} procedimento(s), {check.consulted.argumentScripts} argumentário(s), {check.consulted.practices} ponto(s) do processo{check.consulted.omitted.length > 0 ? `; fora pelo limite: ${check.consulted.omitted.join(", ")}` : ""}.</p> : null}
        </Section>
      ) : null}

      <Section title="Evidências" icon={MessageSquareQuote}>
        <PatternEvidence evidence={pattern.evidence} synthetic={pattern.dataOrigin === "SYNTHETIC"} />
      </Section>

      {current && current.limitations.length > 0 ? (
        <Section title="Limitações" icon={AlertTriangle}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{current.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
        </Section>
      ) : null}

      {pattern.canManage ? (
        <Section title="Revisão" icon={CheckCircle2}>
          <PatternReviewActions pattern={pattern} />
        </Section>
      ) : null}

      <Section title="Histórico" icon={History}>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {pattern.reviews.map((review) => (
            <li key={review.id}>{formatShortDateTime(review.createdAt)} · {REVIEW_ACTION_LABELS[review.action] ?? review.action}{review.actorName ? ` por ${review.actorName}` : ""}{review.reason ? ` — ${review.reason}` : ""}</li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function ContextRow({ context }: { context: ContextResult }) {
  const { top, reference, differencePp, outcome, strength } = context.assessment
  return (
    <TableRow>
      <TableCell className="whitespace-normal text-sm">{context.label}</TableCell>
      <TableCell className="text-right text-sm tabular-nums">{percentLabel(top.operatorRatePercent)}<span className="block text-xs text-muted-foreground">{top.operatorsApplicable} op. · {top.callsApplicable} cham. · {top.adopters} adotam</span></TableCell>
      <TableCell className="text-right text-sm tabular-nums">{percentLabel(reference.operatorRatePercent)}<span className="block text-xs text-muted-foreground">{reference.operatorsApplicable} op. · {reference.callsApplicable} cham.</span></TableCell>
      <TableCell className="text-right text-sm tabular-nums">{differencePp === null ? "—" : `${differencePp > 0 ? "+" : ""}${Math.round(differencePp)} p.p.`}</TableCell>
      <TableCell className="whitespace-normal text-sm">{OUTCOME_LABELS[outcome] ?? outcome}{outcome === "SUPPORTED" ? ` · ${STRENGTH_LABELS[strength].toLowerCase()}` : ""}</TableCell>
    </TableRow>
  )
}
