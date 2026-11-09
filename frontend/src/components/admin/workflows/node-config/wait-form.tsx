"use client"

import { useId, useState } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { FlowNode } from "@/schemas/admin/workflow-graph.schema"

const DURATION_UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const

type DurationUnit = keyof typeof DURATION_UNIT_MS

function inferUnit(durationMs: number): DurationUnit {
  const minutes = durationMs / DURATION_UNIT_MS.minutes
  if (minutes > 0 && minutes % 1440 === 0) return "days"
  if (minutes > 0 && minutes % 60 === 0) return "hours"
  return "minutes"
}

export function WaitForm({ node, onChange }: { node: Extract<FlowNode, { type: "wait" }>; onChange: (next: FlowNode) => void }) {
  // A unidade é uma escolha de quem edita, não um cálculo: inferi-la a cada tecla fazia "605" minutos passar por "60" (vira 1 hora)
  // e terminar em 15 horas. Só a abertura do painel usa a inferência; outra etapa remonta o formulário (key no painel).
  const [unit, setUnit] = useState<DurationUnit>(() => inferUnit(node.config.durationMs))
  const amount = Math.max(1, Math.round(node.config.durationMs / DURATION_UNIT_MS[unit]))
  // Apagar o campo para digitar outro número não pode virar "1" no meio da digitação.
  const [typing, setTyping] = useState<string | null>(null)
  const fieldId = useId()

  function update(nextAmount: number, nextUnit: DurationUnit) {
    onChange({ ...node, config: { durationMs: Math.max(1, nextAmount) * DURATION_UNIT_MS[nextUnit] } })
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-amount`}>Duração</Label>
        <Input
          id={`${fieldId}-amount`}
          type="number"
          min={1}
          value={typing ?? amount}
          onChange={(event) => {
            setTyping(event.target.value)
            if (Number(event.target.value) >= 1) update(Number(event.target.value), unit)
          }}
          onBlur={() => setTyping(null)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-unit`}>Unidade</Label>
        <Select value={unit} onValueChange={(value) => {
          setUnit(value as DurationUnit)
          update(amount, value as DurationUnit)
        }}>
          <SelectTrigger id={`${fieldId}-unit`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="minutes">Minutos</SelectItem>
            <SelectItem value="hours">Horas</SelectItem>
            <SelectItem value="days">Dias</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
