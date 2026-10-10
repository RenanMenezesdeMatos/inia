"use client"

import { BookOpen } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { KNOWLEDGE_TRACE_MODE_LABELS, type QaKnowledgeTrace } from "@/schemas/admin/qa-lab.schema"
import { formatNumber } from "./qa-lab-format"

/**
 * "Bases de conhecimento nesta request" — o que o Agent PODIA consultar (autorizadas) × o que
 * DE FATO entrou no prompt (trechos recuperados), com o custo em caracteres/tokens estimados e
 * quanto seria injetado sem retrieval. Só dado já registrado pela telemetria (nunca inferido
 * aqui); o texto integral dos trechos já aparece no "Prompt final" — aqui só o resumo.
 */
export function KnowledgeTracePanel({ trace }: { trace: QaKnowledgeTrace }) {
  const savedChars = Math.max(trace.authorizedChars - trace.injectedChars, 0)
  return (
    <section className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5" aria-label="Bases de conhecimento nesta request">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <BookOpen className="h-3.5 w-3.5 text-primary" aria-hidden /> Bases de conhecimento nesta request
        </p>
        <Badge variant="outline" className="font-normal">
          {KNOWLEDGE_TRACE_MODE_LABELS[trace.mode]}
        </Badge>
      </div>

      {trace.mode === "NONE" ? null : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Bases autorizadas</dt>
            <dd className="font-medium">{trace.authorizedDocuments.length}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Trechos recuperados</dt>
            <dd className="font-medium">{trace.retrieved.length}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Injetado no prompt</dt>
            <dd className="font-medium">
              {formatNumber(trace.injectedChars)} caracteres · ≈{formatNumber(trace.estimatedTokens)} tokens
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Sem retrieval seria</dt>
            <dd className="font-medium">
              {formatNumber(trace.authorizedChars)} caracteres{savedChars > 0 ? ` (−${formatNumber(savedChars)})` : ""}
            </dd>
          </div>
        </dl>
      )}

      {trace.authorizedDocuments.length > 0 ? (
        <div>
          <p className="text-xs text-muted-foreground">Autorizadas para o agente</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {trace.authorizedDocuments.map((document) => {
              const used = trace.retrieved.some((excerpt) => excerpt.documentId === document.id)
              return (
                <li key={document.id}>
                  <Badge variant={used ? "default" : "outline"} className="max-w-full font-normal" title={`${formatNumber(document.chars)} caracteres${used ? " · consultada" : " · não consultada nesta request"}`}>
                    <span className="truncate">{document.title}</span>
                  </Badge>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {trace.retrieved.length > 0 ? (
        <div>
          <p className="text-xs text-muted-foreground">Trechos efetivamente recuperados</p>
          <ul className="mt-1 space-y-1">
            {trace.retrieved.map((excerpt, index) => (
              <li key={`${excerpt.documentId}-${index}`} className="rounded border border-border bg-background px-2 py-1.5 text-xs">
                <p className="font-medium">
                  {excerpt.documentTitle}
                  {excerpt.heading ? <span className="text-muted-foreground"> · {excerpt.heading}</span> : null}
                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">score {excerpt.score}</span>
                </p>
                <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-muted-foreground">{excerpt.excerpt}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
