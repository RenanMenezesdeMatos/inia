"use client"

import { useState } from "react"
import { ChevronDown, Quote } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCivilDate } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useEvidenceCallQuery } from "@/queries/best-practices/use-best-practices"
import type { PatternEvidence } from "@/schemas/best-practices/best-practices.schema"

/**
 * Evidências de um padrão: falas LITERAIS de operadores do grupo de melhores resultados (nomes e dados pessoais mascarados; quem
 * atendeu aparece como "Operador A/B…"). "Ver a chamada" abre a transcrição mascarada com o turno citado em destaque — só quando o
 * backend autoriza (a chamada é de alguém do seu escopo, ou o dado é sintético).
 */
export function PatternEvidence({ evidence, synthetic }: { evidence: PatternEvidence[]; synthetic: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  if (evidence.length === 0) return <p className="text-sm text-muted-foreground">Sem trechos exibíveis nesta versão (os trechos com identificação pessoal não são mostrados).</p>
  return (
    <ul className="space-y-2">
      {evidence.map((item) => {
        const canOpen = synthetic || item.interactionId !== null
        return (
          <li key={item.id} className="rounded-lg border border-border bg-card/60 p-3">
            <p className="flex items-start gap-2 text-sm"><Quote className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden /><span>“{item.excerpt}”</span></p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{item.operatorLabel}</span>
              {item.context ? <span>{item.context}</span> : null}
              {item.occurredAt ? <span>{formatCivilDate(item.occurredAt)}</span> : null}
              {item.callRef ? <span>Chamada {item.callRef}</span> : null}
              {canOpen ? (
                <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setOpen(open === item.id ? null : item.id)} aria-expanded={open === item.id}>
                  {open === item.id ? "Fechar a chamada" : "Ver a chamada"} <ChevronDown className={cn("size-3 transition-transform", open === item.id && "rotate-180")} />
                </Button>
              ) : <span>Chamada fora do seu escopo</span>}
            </div>
            {open === item.id ? <EvidenceCall evidenceId={item.id} /> : null}
          </li>
        )
      })}
    </ul>
  )
}

function EvidenceCall({ evidenceId }: { evidenceId: string }) {
  const call = useEvidenceCallQuery(evidenceId)
  if (call.isPending) return <Skeleton className="mt-2 h-24 w-full" />
  if (call.isError || !call.data) return <p className="mt-2 text-xs text-destructive">Não foi possível abrir a chamada.</p>
  return (
    <ol className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-md border border-border bg-background p-2 text-sm">
      {call.data.turns.map((turn) => (
        <li key={turn.handle} className={cn("rounded px-2 py-1", turn.handle === call.data.turnRef && "bg-primary/10 ring-1 ring-primary/40")}>
          <span className="mr-1 text-xs font-medium uppercase text-muted-foreground">{turn.speaker === "OPERADOR" ? "Operador" : turn.speaker === "CLIENTE" ? "Cliente" : turn.speaker ?? ""}</span>
          {turn.text}
        </li>
      ))}
    </ol>
  )
}
