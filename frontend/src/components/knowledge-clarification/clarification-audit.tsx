"use client"

import { describeSource, openStepOf, type ClarificationView } from "@/schemas/knowledge-clarification/clarification.schema"
import { KnowledgeSources } from "./knowledge-sources"
import { ScenarioSummary } from "./scenario-summary"

const STATUS_LABELS: Record<ClarificationView["status"], string> = {
  OPEN: "pediu esclarecimento",
  ANSWERED: "respondeu pelas bases",
  INSUFFICIENT: "as bases não sustentam uma resposta",
  NOT_CONVERGED: "não chegou a um cenário documentado",
}

/**
 * TRILHA DE AUDITORIA de uma resposta do esclarecimento pelas bases, para quem monitora a conversa (somente leitura): a pergunta
 * original, o cenário considerado, as opções apresentadas com a base/seção que sustenta cada uma, as fontes numeradas como os
 * marcadores [1], [2]… do texto gravado, divergências e a cobertura da consulta. Fonte que quem lê não pode abrir vai sem título.
 */
export function ClarificationAudit({ view }: { view: ClarificationView }) {
  const open = openStepOf(view)
  const coverage = view.coverage
  return (
    <section aria-label="Auditoria do esclarecimento pelas bases" className="mt-2 space-y-2 rounded-lg border border-dashed border-border bg-background/60 p-3 text-xs" data-testid="clarification-audit">
      <p className="font-medium">Esclarecimento pelas bases · {STATUS_LABELS[view.status]}</p>
      <p className="text-muted-foreground break-words">Pergunta original: “{view.originalQuestion}”</p>
      <ScenarioSummary facts={view.scenario} variant="full" />
      {open ? (
        <div className="space-y-1">
          <p className="font-medium">Opções apresentadas e o que sustenta cada uma</p>
          <ul className="space-y-1">
            {open.options.map((option) => (
              <li key={option.id} className="break-words">
                <span className="font-medium">{option.label}</span>
                <span className="text-muted-foreground"> — {option.evidence.map(describeSource).join("; ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {view.status === "ANSWERED" ? <KnowledgeSources sources={view.sources} variant="audit" /> : null}
      {view.conflicts.length > 0 ? (
        <div className="space-y-0.5">
          <p className="font-medium">Divergência entre bases</p>
          {view.conflicts.map((conflict, index) => (
            <p key={index} className="text-muted-foreground break-words">{conflict.description} ({conflict.sources.map(describeSource).join("; ")})</p>
          ))}
        </div>
      ) : null}
      {view.notice ? <p className="text-muted-foreground break-words">Observação: {view.notice}</p> : null}
      <p className="text-muted-foreground">
        Bases listadas para a IA: {coverage.presentedDocuments} de {coverage.consideredDocuments} que a pessoa podia consultar
        {coverage.matchedDocuments > 0 ? ` · ${coverage.matchedDocuments} aberta${coverage.matchedDocuments === 1 ? "" : "s"}` : ""}
        {coverage.complete ? "" : " · lista cortada por tamanho"}
      </p>
    </section>
  )
}
