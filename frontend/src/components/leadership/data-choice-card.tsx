"use client"

import { useId, useState } from "react"
import { ListFilter } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { DataChoiceCard as DataChoiceCardData } from "@/schemas/leadership/leadership.schema"

/**
 * Escolha da leitura dos dados, dentro do chat: o termo pedido aparece em mais de um campo (ex.: "contestação" no motivo, no
 * submotivo e como ocorrência). A pessoa escolhe uma leitura (com a contagem de cada uma) e a escolha volta como pergunta dela,
 * gravada na conversa. Sem `onAsk` (histórico, só leitura, chat ocupado) o cartão mostra as opções sem botão.
 */
export function DataChoiceCard({ card, onAsk }: { card: DataChoiceCardData; onAsk?: (question: string) => void }) {
  const baseId = useId()
  const [selected, setSelected] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const chosen = card.options.find((option) => option.id === selected) ?? null
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm" data-testid="data-choice-card">
      <div className="flex items-start gap-2">
        <ListFilter className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{card.title}</p>
          <p className="text-xs text-muted-foreground">{card.scopeNote}</p>
        </div>
      </div>
      <p className="mt-3 text-sm">{card.prompt}</p>
      <RadioGroup className="mt-2 gap-2" value={selected ?? ""} onValueChange={setSelected} disabled={!onAsk || sent} aria-label={card.prompt}>
        {card.options.map((option) => {
          const id = `${baseId}-${option.id}`
          return (
            <div key={option.id} className="flex items-start gap-2 rounded-lg border bg-background p-2.5">
              <RadioGroupItem value={option.id} id={id} className="mt-0.5" />
              <Label htmlFor={id} className="flex cursor-pointer flex-col items-start gap-0.5 font-normal">
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.detail}</span>
              </Label>
            </div>
          )
        })}
      </RadioGroup>
      {onAsk ? (
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            className="rounded-full"
            disabled={!chosen || sent}
            onClick={() => {
              if (!chosen) return
              setSent(true)
              onAsk(chosen.question)
            }}
          >
            {sent ? "Consultando…" : "Consultar"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
