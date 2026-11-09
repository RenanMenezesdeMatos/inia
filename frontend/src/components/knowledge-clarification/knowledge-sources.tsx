"use client"

import Link from "next/link"
import { BookOpen, ChevronDown } from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { buildKnowledgeMaterialHref, buildKnowledgeMaterialPageHref } from "@/lib/knowledge/material-href"
import { groupSourcesByDocument, sourcePageLabel, sourcePartLabel, type ClarificationSource } from "@/schemas/knowledge-clarification/clarification.schema"

/**
 * Fontes de uma resposta pelas bases, com o título de cada base uma vez. No CHAT ficam recolhidas ("Fontes consultadas", fechado):
 * a conversa continua natural e quem quiser confere. Na AUDITORIA (Monitoramento › Conversas com a INIA) ficam abertas e numeradas
 * como os marcadores [1], [2]… do texto gravado. O link nasce do id real da base (a página do material decide o acesso ao abrir);
 * fonte que quem lê não pode mais abrir aparece como aviso neutro, sem título.
 */
export function KnowledgeSources({ sources, variant = "chat" }: { sources: ClarificationSource[]; variant?: "chat" | "audit" }) {
  if (sources.length === 0) return null
  const audit = variant === "audit"
  const list = (
    <ul className="space-y-1.5 text-xs" data-testid="knowledge-sources-list">
      {groupSourcesByDocument(sources).map((group) => (
        <li key={group.documentId} className="space-y-0.5 leading-snug">
          {group.available ? (
            <Link href={buildKnowledgeMaterialHref(group.documentId)} target="_blank" rel="noopener noreferrer" className="font-medium break-words text-primary underline-offset-2 hover:underline dark:text-chart-4" aria-label={`Abrir a base ${group.documentTitle} (abre em nova aba)`}>
              {group.documentTitle}
            </Link>
          ) : (
            <span className="text-muted-foreground">Fonte não disponível para você</span>
          )}
          <ul className="space-y-0.5 pl-3">
            {group.items.map(({ source, index }) => (
              <li key={`${source.documentId}-${source.chunkIndex}-${index}`} className="flex gap-1.5 text-muted-foreground">
                {audit ? <><span className="shrink-0 font-medium tabular-nums">[{index + 1}]</span>{" "}</> : null}
                <span className="min-w-0 break-words">
                  {sourcePartLabel(source)}
                  {source.pages && sourcePageLabel(source) ? (
                    <>
                      {" · "}
                      <Link href={buildKnowledgeMaterialPageHref(source.documentId, { page: source.pages.from, versionId: source.versionId })} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline dark:text-chart-4" aria-label={`Abrir ${group.documentTitle} na página ${source.pages.from} (abre em nova aba)`}>
                        {sourcePageLabel(source)}
                      </Link>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
  if (audit) {
    return (
      <section aria-label="Fontes da resposta" className="space-y-1.5" data-testid="knowledge-sources">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          <BookOpen className="size-3.5" aria-hidden />
          Fontes da resposta
        </h3>
        {list}
      </section>
    )
  }
  return (
    <Collapsible className="group/sources" data-testid="knowledge-sources">
      <CollapsibleTrigger className="inline-flex items-center gap-1 rounded-sm text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <BookOpen className="size-3.5" aria-hidden />
        Fontes consultadas ({groupSourcesByDocument(sources).length})
        <ChevronDown className="size-3.5 transition-transform group-data-[state=open]/sources:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1.5">{list}</CollapsibleContent>
    </Collapsible>
  )
}
