"use client"

import { useState } from "react"
import { MessageSquareText, MousePointerClick, PenLine, Route, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { ScenarioFact } from "@/schemas/knowledge-clarification/clarification.schema"

type ScenarioSummaryProps = {
  facts: ScenarioFact[]
  /** Corrigir a escolha de uma etapa (só no esclarecimento mais recente da conversa). */
  onRevise?: (stepId: string) => void
  disabled?: boolean
  /** `compact` (chat): um chip pequeno por fato, só com o valor; o resto no tooltip e no popover. `full` (auditoria): tudo escrito. */
  variant?: "compact" | "full"
}

const ORIGINS: Record<ScenarioFact["origin"], { label: string; icon: LucideIcon }> = {
  QUESTION: { label: "da sua pergunta", icon: MessageSquareText },
  SELECTION: { label: "você escolheu", icon: MousePointerClick },
  TEXT: { label: "você escreveu", icon: PenLine },
}

/**
 * Cenário considerado: o que a pergunta já informava e cada escolha. No CHAT fica discreto — um ícone e um chip por fato com o
 * valor (cortado se for longo); passar o mouse mostra o que é e de onde veio, clicar abre o detalhe com "Alterar" nas escolhas
 * (corrigir refaz as etapas seguintes a partir dela). Na AUDITORIA, tudo escrito e sem "Alterar".
 */
export function ScenarioSummary({ facts, onRevise, disabled = false, variant = "compact" }: ScenarioSummaryProps) {
  if (facts.length === 0) return null
  // Um "Alterar" por etapa (a escolha e o complemento dela são a mesma etapa).
  const seenSteps = new Set<string>()
  const items = facts.map((fact) => {
    const canRevise = Boolean(onRevise && fact.stepId && fact.origin !== "QUESTION" && !seenSteps.has(fact.stepId))
    if (fact.stepId) seenSteps.add(fact.stepId)
    return { fact, onRevise: canRevise ? () => onRevise!(fact.stepId!) : null }
  })
  if (variant === "full") {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Cenário considerado" data-testid="clarification-scenario">
        <span className="text-muted-foreground">Cenário considerado:</span>{" "}
        {items.map(({ fact }, index) => (
          <span key={`${fact.dimension}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5">
            <span className="text-muted-foreground">{fact.dimension}:</span> <span className="font-medium break-words">{fact.value}</span>{" "}
            <span className="text-muted-foreground">({ORIGINS[fact.origin].label})</span>
          </span>
        ))}
      </div>
    )
  }
  return (
    <TooltipProvider>
      <div role="group" aria-label="Cenário considerado" className="flex flex-wrap items-center gap-1" data-testid="clarification-scenario">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex size-6 items-center justify-center text-muted-foreground">
              <Route className="size-3.5" aria-hidden />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">Cenário considerado</TooltipContent>
        </Tooltip>
        {items.map(({ fact, onRevise: revise }, index) => (
          <ScenarioChip key={`${fact.dimension}-${index}`} fact={fact} onRevise={revise} disabled={disabled} />
        ))}
      </div>
    </TooltipProvider>
  )
}

function ScenarioChip({ fact, onRevise, disabled }: { fact: ScenarioFact; onRevise: (() => void) | null; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const origin = ORIGINS[fact.origin]
  const Icon = origin.icon
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${fact.dimension}: ${fact.value} (${origin.label})`}
              className="inline-flex h-6 max-w-44 items-center gap-1 rounded-full border border-border bg-muted/40 px-2 text-[11px] font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-muted"
            >
              <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{fact.value}</span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {fact.dimension} · {origin.label}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-64 gap-1.5 p-3 text-xs">
        <p className="text-muted-foreground">{fact.dimension}</p>
        <p className="font-medium break-words">{fact.value}</p>
        <p className="flex items-center gap-1 text-muted-foreground">
          <Icon className="size-3" aria-hidden />
          {origin.label}
        </p>
        {onRevise ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="mt-1 self-start"
            disabled={disabled}
            aria-label={`Alterar ${fact.dimension}`}
            onClick={() => {
              setOpen(false)
              onRevise()
            }}
          >
            Alterar
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
