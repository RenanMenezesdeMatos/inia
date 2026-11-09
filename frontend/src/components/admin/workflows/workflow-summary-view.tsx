"use client"

import { ListChecks } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"

import type { WorkflowSummary } from "./workflow-summary"

function Row({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{question}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

/** Quando começa, para quem roda, o que acontece, quem recebe e quando termina — no resumo do editor e no diálogo de publicar. */
export function WorkflowSummaryView({ summary }: { summary: WorkflowSummary }) {
  return (
    <dl className="space-y-2" data-testid="workflow-summary">
      <Row question="Quando começa">{summary.starts}</Row>
      <Row question="Para quem roda">{summary.who}</Row>
      <Row question="O que acontece">{summary.steps}</Row>
      <Row question="Quem recebe o resultado">
        {summary.recipients.length === 0 ? (
          "Ninguém: nenhuma etapa entrega resultado"
        ) : (
          <ul className="space-y-0.5">
            {summary.recipients.map((recipient) => (
              <li key={recipient}>{recipient}</li>
            ))}
          </ul>
        )}
      </Row>
      <Row question="Quando termina">{summary.ends}</Row>
      {summary.unreachable > 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {summary.unreachable === 1 ? "1 etapa não está ligada ao fluxo e não vai rodar." : `${summary.unreachable} etapas não estão ligadas ao fluxo e não vão rodar.`}
        </p>
      ) : null}
    </dl>
  )
}

export function WorkflowSummaryPopover({ summary }: { summary: WorkflowSummary }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="shrink-0">
          <ListChecks className="h-4 w-4" aria-hidden />
          Resumo
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))]">
        <PopoverHeader>
          <PopoverTitle>Resumo do rascunho</PopoverTitle>
          <PopoverDescription>Como este fluxo vai funcionar quando for publicado.</PopoverDescription>
        </PopoverHeader>
        <WorkflowSummaryView summary={summary} />
      </PopoverContent>
    </Popover>
  )
}
