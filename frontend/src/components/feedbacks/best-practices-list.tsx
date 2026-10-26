"use client"

import { ChevronDown, MessageSquareQuote } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { FeedbackViewBestPractices } from "@/schemas/feedbacks/feedback-view.schema"
import { ProductTag } from "./product-tag"

type Practice = FeedbackViewBestPractices["items"][number]

/** O "como fazer" sem o detalhe técnico da verificação de obrigação (seções gravadas antes de `guidance` vir separado). */
const howToOf = (item: Practice) => item.guidance ?? item.howTo.replace(/\s*\(O diferencial é[^)]*\)\s*$/u, "").trim()
/** "Nas suas chamadas" só com evidência das chamadas da pessoa; sem análise delas, o aviso vai para "Por que esta sugestão". */
const hasOwnEvidence = (item: Practice) => item.youKind ? item.youKind !== "NOT_ANALYZED" : !/não estavam nesta análise/u.test(item.you)

/** O que o bloco traz, dito ao abrir o card: são sugestões, não regras do processo. */
export const BEST_PRACTICES_HINT = "Sugestões de quem tem os melhores resultados. São opcionais — não são regras do processo."

/**
 * Conteúdo de "Oportunidades inspiradas em boas práticas" (o card do bloco fica em `feedback-support-tiles.tsx`). Cada prática é um
 * cartão que se lê de cima para baixo: o que é (e a força da evidência), como fazer, o que dá para dizer (sugestão, nunca fala de uma
 * chamada) e o que as chamadas da pessoa mostram. Os números e o que vai além da etapa obrigatória (detalhe técnico da verificação de
 * obrigação) ficam em "Por que esta sugestão". A origem (`source`) e a nota da seção continuam na view, mas não aparecem: a frase do
 * bloco e a marca "Exemplo para experimentar" já dizem que é opcional e que a fala não é de uma chamada.
 */
export function BestPracticesList({ section }: { section: FeedbackViewBestPractices }) {
  return (
    <ul className="space-y-3">
      {section.items.map((item) => <PracticeCard key={item.patternId} item={item} />)}
    </ul>
  )
}

function PracticeCard({ item }: { item: Practice }) {
  const ownEvidence = hasOwnEvidence(item)
  return (
    <li className="min-w-0 space-y-3 rounded-md border border-border/60 bg-background/70 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <h5 className="m-0 min-w-0 flex-1 text-sm font-semibold leading-snug break-words">{item.name}</h5>
        <Badge variant="secondary" className="shrink-0 text-[11px] font-medium">Evidência {item.strength.toLowerCase()}</Badge>
      </div>
      {item.product ? <ProductTag product={item.product} prefix="Vale para" /> : null}
      <div className="space-y-1">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Como fazer</p>
        <p className="text-sm leading-6 break-words">{howToOf(item)}</p>
      </div>
      {item.suggestedPhrasing ? (
        <figure className="m-0 rounded-md border-l-2 border-primary/50 bg-primary/5 px-3 py-2">
          <figcaption className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            <MessageSquareQuote className="size-3.5" aria-hidden /> Você pode dizer
          </figcaption>
          <blockquote className="m-0 mt-1 text-sm leading-6 break-words">“{item.suggestedPhrasing}”</blockquote>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Exemplo para experimentar — não é fala de uma chamada.</p>
        </figure>
      ) : null}
      {item.howItHelps ? <p className="text-xs leading-5 break-words" data-slot="practice-how-it-helps"><span className="font-medium">Como ajuda em {item.indicatorName}:</span> {item.howItHelps}</p> : null}
      {item.notApplicableWhen ? <p className="text-xs leading-5 text-muted-foreground break-words">Não se aplica quando: {item.notApplicableWhen}</p> : null}
      {ownEvidence ? <p className="text-xs leading-5 break-words"><span className="font-medium">Nas suas chamadas:</span> {item.you.replace(/^Nas suas chamadas analisadas, /u, "")}</p> : null}
      <Collapsible className="group/why">
        <CollapsibleTrigger asChild>
          <Button variant="link" size="sm" className="h-auto gap-1 p-0 text-xs text-muted-foreground">
            Por que esta sugestão
            <ChevronDown className="size-3.5 transition-transform group-data-[state=open]/why:rotate-180" aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-1 pt-2 text-xs leading-5 text-muted-foreground">
          {item.differential ? <p className="break-words">Vai além da etapa obrigatória: {item.differential}</p> : null}
          <p className="break-words">{item.association}</p>
          {ownEvidence ? null : <p className="break-words">{item.you}</p>}
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}
