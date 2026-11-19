"use client"

import { CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/states"
import { cn } from "@/lib/utils"

/**
 * Filtro "Ciência" do Acompanhamento do colaborador: os feedbacks que ele já confirmou ter lido × os que ainda não. `null` = tudo.
 * Só feedback (publicado ou de atendimento) tem ciência: com o filtro ativo, comunicados, alinhamentos e leituras saem.
 */
export type FollowUpAckFilterValue = "PENDING" | "DONE"

const LABELS: Record<FollowUpAckFilterValue, string> = { PENDING: "Aguardando ciência", DONE: "Com ciência" }
const ALL = "ALL"

export function FollowUpAckFilter({ value, onChange }: { value: FollowUpAckFilterValue | null; onChange: (value: FollowUpAckFilterValue | null) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={`Filtrar os feedbacks pela ciência — ${value ? LABELS[value].toLowerCase() : "todos"}`} className={cn("font-normal text-muted-foreground", value && "text-primary dark:text-chart-4")} data-testid="follow-up-ack-filter">
          <CheckCircle2 aria-hidden />
          {value ? LABELS[value] : "Ciência"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuRadioGroup value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? null : (next as FollowUpAckFilterValue))}>
          <DropdownMenuRadioItem value={ALL}>Tudo</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value="PENDING">Feedbacks aguardando ciência</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="DONE">Feedbacks com ciência</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Feed vazio com o filtro de ciência: diz qual e volta a mostrar tudo. */
export function FollowUpAckEmpty({ value, onClear }: { value: FollowUpAckFilterValue; onClear: () => void }) {
  return (
    <div className="py-6">
      <EmptyState
        icon={CheckCircle2}
        title={value === "PENDING" ? "Nenhum feedback aguardando sua ciência" : "Nenhum feedback com ciência ainda"}
        description={value === "PENDING" ? "Você já confirmou a leitura de todos os feedbacks." : "Os feedbacks que você confirmar ter lido aparecem aqui."}
        action={<Button type="button" variant="outline" size="sm" onClick={onClear}>Ver tudo</Button>}
      />
    </div>
  )
}
