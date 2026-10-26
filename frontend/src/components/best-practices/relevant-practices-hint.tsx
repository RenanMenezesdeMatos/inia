"use client"

import Link from "next/link"
import { ChevronDown, Lightbulb } from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { useRelevantPracticesQuery } from "@/queries/best-practices/use-best-practices"

/**
 * Indicativo COMPACTO no Diagnóstico: só as boas práticas aprovadas e sustentadas que valem para ESTE caso (indicador e/ou contexto
 * da chamada; com a pessoa visível, o que as chamadas dela mostram). Fechado por padrão; sem prática relevante, nada aparece. O
 * detalhe completo fica na base (link).
 */
export function RelevantPracticesHint({ indicatorId, personId, interactionId, className }: { indicatorId?: string | null; personId?: string | null; interactionId?: string | null; className?: string }) {
  const query = useRelevantPracticesQuery({ indicatorId: indicatorId ?? null, personId: personId ?? null, interactionId: interactionId ?? null })
  const items = query.data ?? []
  if (items.length === 0) return null
  return (
    <Collapsible className={cn("rounded-lg border border-primary/30 bg-primary/5 px-3 py-2", className)}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 text-left text-sm font-medium">
        <Lightbulb className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="flex-1">Boas práticas observadas para este caso ({items.length})</span>
        <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3">
        <p className="text-xs text-muted-foreground">Comportamentos opcionais mais frequentes entre operadores com melhores resultados em chamadas comparáveis — associação, não causa; não é cumprimento de processo.</p>
        {items.map((item) => (
          <div key={item.patternId} className="space-y-1 text-sm">
            <p className="font-medium">{item.name} <span className="text-xs font-normal text-muted-foreground">· {item.indicatorName} · {item.contexts.join(" · ")} · força {item.strength.toLowerCase()}</span></p>
            <p className="text-xs text-muted-foreground">{item.association}</p>
            {personId || interactionId ? <p className="text-xs">{item.you}</p> : null}
            <p className="text-xs">Como aplicar: {item.howTo}</p>
            <Link href={`/best-practices?pattern=${encodeURIComponent(item.patternId)}`} className="text-xs font-medium text-primary hover:underline">Ver evidências e critérios</Link>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
