"use client"

import { useState } from "react"
import { Plus, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function TimeListEditor({ times, onChange, id }: { times: string[]; onChange: (next: string[]) => void; id?: string }) {
  const [draft, setDraft] = useState("09:00")

  function add() {
    if (!draft || times.includes(draft)) return
    onChange([...times, draft].sort())
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {times.map((time) => (
          <Badge key={time} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1 font-normal">
            {time}
            <button
              type="button"
              aria-label={`Remover horário ${time}`}
              className="rounded-full p-0.5 hover:bg-muted-foreground/20"
              onClick={() => onChange(times.filter((t) => t !== time))}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {times.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum horário adicionado ainda.</p> : null}
      </div>
      <div className="flex gap-2">
        <Input id={id} type="time" value={draft} onChange={(event) => setDraft(event.target.value)} className="w-32" />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-4 w-4" /> Adicionar horário
        </Button>
      </div>
    </div>
  )
}
