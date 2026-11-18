"use client"

import { ListFilter } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { EmptyState } from "@/components/ui/states"
import { cn } from "@/lib/utils"
import type { FollowUpType } from "@/schemas/analytics/analytics.schema"

/**
 * Filtro "Tipo" do Acompanhamento (operador e liderança): um ou vários tipos, `null` = todos. Discreto (botão leve com o ícone);
 * as caixas permitem "todos menos isso". Na liderança o recorte é do servidor (o feed é paginado lá); no colaborador, do navegador
 * sobre as fontes que o feed já junta. Ao menos um tipo fica marcado.
 */
export type { FollowUpType }

export const FOLLOW_UP_TYPE_LABELS: Record<FollowUpType, string> = {
  NOTICE: "Comunicados",
  ALIGNMENT: "Alinhamentos",
  MONITORING: "Feedbacks de monitoria",
  INDICATOR: "Feedbacks de indicador",
  WORKFLOW_OUTPUT: "Resultados de workflow",
  HUMAN_REVIEW: "Revisões pendentes",
  ESCALATION: "Escalonamentos",
  INTERVENTION: "Intervenções",
  REPORT: "Reports",
  OTHER: "Outros avisos",
}

/** O que aparece no Acompanhamento do próprio colaborador. */
export const OPERATOR_FOLLOW_UP_TYPES: FollowUpType[] = ["NOTICE", "ALIGNMENT", "MONITORING", "INDICATOR"]
/** O que aparece no Acompanhamento da estrutura (feedbacks dos liderados + avisos, reports e comunicados de quem lê). */
export const STRUCTURE_FOLLOW_UP_TYPES: FollowUpType[] = ["NOTICE", "ALIGNMENT", "MONITORING", "INDICATOR", "WORKFLOW_OUTPUT", "HUMAN_REVIEW", "ESCALATION", "INTERVENTION", "REPORT", "OTHER"]

export function FollowUpTypeFilter({ value, onChange, types }: { value: FollowUpType[] | null; onChange: (value: FollowUpType[] | null) => void; types: FollowUpType[] }) {
  const selected = value ?? types
  const filtered = value !== null
  const toggle = (type: FollowUpType, checked: boolean) => {
    const next = checked ? types.filter((item) => item === type || selected.includes(item)) : selected.filter((item) => item !== type)
    // Todos marcados = sem filtro (o rótulo e a consulta voltam ao padrão).
    onChange(next.length === types.length ? null : next)
  }
  const label = !filtered ? "Tipos" : selected.length === 1 ? FOLLOW_UP_TYPE_LABELS[selected[0]!] : `${selected.length} de ${types.length} tipos`
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={`Filtrar o Acompanhamento por tipo — ${filtered ? label : "todos os tipos"}`} className={cn("max-w-56 font-normal text-muted-foreground", filtered && "text-primary dark:text-chart-4")} data-testid="follow-up-type-filter">
          <ListFilter aria-hidden />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1.5">
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted">
          <Checkbox checked={filtered ? "indeterminate" : true} disabled={!filtered} onCheckedChange={() => onChange(null)} />
          Todos os tipos
        </label>
        <div className="my-1 h-px bg-border" aria-hidden />
        {types.map((type) => {
          const checked = selected.includes(type)
          const last = checked && selected.length === 1
          return (
            <label key={type} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted", last ? "cursor-default" : "cursor-pointer")}>
              <Checkbox checked={checked} disabled={last} onCheckedChange={(next) => toggle(type, next === true)} />
              {FOLLOW_UP_TYPE_LABELS[type]}
            </label>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

/** Feed vazio com tipos escolhidos: diz isso e volta a mostrar tudo. */
export function FollowUpTypeEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className="py-6">
      <EmptyState
        icon={ListFilter}
        title="Nada nos tipos escolhidos"
        description="Marque outros tipos ou volte a ver tudo."
        action={<Button type="button" variant="outline" size="sm" onClick={onClear}>Ver todos os tipos</Button>}
      />
    </div>
  )
}
