"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, BookOpenCheck, ChevronDown } from "lucide-react"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"

import { stepAnchorOf, type DemoNodeUse } from "./demo-catalog"
import type { NodeGuide } from "./node-guides"

/** A cena demonstrativa do nó: o que entra, o que sai e, quando há mais de um desfecho, um texto já escrito para cada um. */
function MiniScene({ name, scene }: { name: string; scene: NodeGuide["scene"] }) {
  const [chosen, setChosen] = useState(scene.outcomes?.[0]?.label ?? "")
  const legendId = useId()
  const outcome = scene.outcomes?.find((candidate) => candidate.label === chosen)
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3" data-slot="node-mini-scene">
      <div className="grid grid-cols-1 items-stretch gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_minmax(0,1fr)]">
        <p className="rounded-md bg-background p-2 ring-1 ring-border">
          <span className="block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Recebe</span>
          {scene.receives}
        </p>
        <ArrowRight className="hidden size-4 self-center text-muted-foreground sm:block" aria-hidden />
        <p className="self-center rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-center text-xs font-semibold">{name}</p>
        <ArrowRight className="hidden size-4 self-center text-muted-foreground sm:block" aria-hidden />
        <p className="rounded-md bg-background p-2 ring-1 ring-border">
          <span className="block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Produz</span>
          {scene.produces}
        </p>
      </div>
      {scene.outcomes ? (
        <div className="space-y-1.5">
          <p id={legendId} className="text-xs font-medium text-muted-foreground">Veja cada saída (dados fictícios):</p>
          <RadioGroup aria-labelledby={legendId} value={chosen} onValueChange={setChosen} className="flex flex-wrap gap-1.5">
            {scene.outcomes.map((option) => (
              <label
                key={option.label}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors motion-reduce:transition-none focus-within:ring-2 focus-within:ring-ring",
                  option.label === chosen ? "border-primary bg-primary/10" : "border-border bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                <RadioGroupItem value={option.label} className="size-3.5" />
                {option.label}
              </label>
            ))}
          </RadioGroup>
          <p key={chosen} aria-live="polite" className="rounded-md bg-background p-2 text-sm ring-1 ring-border animate-in fade-in-0 duration-200 motion-reduce:animate-none">{outcome?.text}</p>
        </div>
      ) : null}
    </div>
  )
}

/**
 * O guia prático dentro de cada nó da referência. É um `details` nativo: o conteúdo está no HTML (links conferidos pelos testes, leitura
 * sem JavaScript) e abre e fecha por teclado sem nada a mais.
 */
export function NodeGuidePanel({ name, guide, uses }: { name: string; guide: NodeGuide; uses: DemoNodeUse[] }) {
  return (
    <details className="group rounded-lg border border-border" data-slot="node-guide">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <BookOpenCheck className="size-4 text-primary" aria-hidden />
        Como usar na prática
        <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="space-y-3 border-t border-border p-3 text-sm">
        <p>
          <span className="font-medium">Situação real: </span>
          {guide.situation}
        </p>
        <p>
          <span className="font-medium">Onde encontrar: </span>
          {guide.where}
        </p>
        {guide.values.length > 0 ? (
          <div className="space-y-1">
            <p className="font-medium">Valores de exemplo</p>
            <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {guide.values.map((field) => (
                <div key={field.label} className="rounded-md bg-muted/40 px-2 py-1">
                  <dt className="text-xs text-muted-foreground">{field.label}</dt>
                  <dd className="font-medium break-words">
                    {field.value}
                    {field.illustrative ? <span className="ml-1.5 rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-800 dark:text-amber-200">exemplo</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
        <MiniScene name={name} scene={guide.scene} />
        {guide.caution ? (
          <p className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="font-semibold">Cuidado: </span>
              {guide.caution}
            </span>
          </p>
        ) : null}
        {uses.length > 0 ? (
          <p>
            <span className="font-medium">Veja na prática: </span>
            {uses.map((use, index) => (
              <span key={use.slug}>
                {index > 0 ? " · " : ""}
                <Link href={`/wiki/workflows/exemplos#${stepAnchorOf(use.slug, use.nodeId)}`} className="font-medium text-primary underline underline-offset-2">
                  {use.title}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </details>
  )
}
