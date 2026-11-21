"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { UniverseBadge } from "@/components/operating-universe/universe-badge"
import { cn } from "@/lib/utils"
import type { KnowledgeOption } from "@/schemas/admin/agent-knowledge-options.schema"

import { scopeSummary, STATE_HINTS, STATE_LABELS, type OptionProblem } from "./picker-rules"

const PROBLEM_LABELS: Record<OptionProblem, { label: string; hint: string }> = {
  OTHER_UNIVERSE: { label: "De outro universo", hint: "Base de outro universo de atuação: desligue para salvar o agente." },
  OTHER_GROUP: { label: "De outro Grupo", hint: "Base de outro Grupo: este agente só usa bases globais ou do Grupo dele. Desligue para salvar." },
}

/**
 * Uma base no seletor: caixa de marcar com o título (o nome acessível é o título), selos de universo, situação e problemas, e uma linha
 * com Grupos, assuntos e produtos. Clicar em qualquer ponto da linha liga ou desliga.
 */
export function KnowledgeOptionRow({ option, checked, onToggle, problems = [] }: { option: KnowledgeOption; checked: boolean; onToggle: () => void; problems?: OptionProblem[] }) {
  const id = `kb-option-${option.id}`
  const details = [scopeSummary(option), option.allSubjects ? "Todos os assuntos" : option.subjects.join(", "), option.products.join(", ")].filter(Boolean)
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-xl border bg-card px-3 py-2.5 transition-colors hover:border-primary/40",
        checked && "border-primary/40 bg-primary/5",
        problems.length > 0 && "border-destructive/40",
      )}
      data-testid="knowledge-option"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} className="mt-0.5" aria-describedby={`${id}-details`} />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium leading-snug">{option.title}</span>
          <UniverseBadge universe={option.operatingUniverse} />
          {option.state !== "IN_USE" ? (
            <Badge variant="outline" className="border-dashed text-muted-foreground" title={STATE_HINTS[option.state]}>
              {STATE_LABELS[option.state]}
            </Badge>
          ) : null}
          {problems.map((problem) => (
            <Badge key={problem} variant="outline" className="border-destructive/50 text-destructive" title={PROBLEM_LABELS[problem].hint}>
              {PROBLEM_LABELS[problem].label}
            </Badge>
          ))}
        </span>
        <span id={`${id}-details`} className="mt-0.5 block truncate text-xs text-muted-foreground" title={details.join(" · ")}>
          {details.join(" · ")}
        </span>
      </label>
    </li>
  )
}

/** Base ligada que quem edita não enxerga (fora do alcance dele): só o título que o agente traz, para poder desligar. */
export function UnavailableOptionRow({ id, title, onRemove }: { id: string; title: string; onRemove: () => void }) {
  const inputId = `kb-option-${id}`
  return (
    <li className="flex items-start gap-3 rounded-xl border border-dashed bg-card px-3 py-2.5" data-testid="knowledge-option">
      <Checkbox id={inputId} checked onCheckedChange={onRemove} className="mt-0.5" />
      <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer">
        <span className="text-sm font-medium">{title || "Base sem título"}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">Fora do seu alcance de administração: os detalhes não aparecem para você.</span>
      </label>
    </li>
  )
}
