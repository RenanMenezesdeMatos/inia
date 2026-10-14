"use client"

import { useId, useState } from "react"
import { Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

import { localDateTimeToIso, nowAsLocalDateTime } from "../shared/helpers"

const isPast = (iso: string | null) => iso !== null && new Date(iso).getTime() < Date.now()

/**
 * Publicar uma versão com VIGÊNCIA: agora (padrão) ou a partir de uma data/hora futura — nunca no passado. A versão publicada
 * é imutável; avaliações anteriores continuam com a versão que estava em vigor na época.
 */
export function PublishPopover({ disabled, pending, dirty, onPublish }: { disabled?: boolean; pending?: boolean; dirty: boolean; onPublish: (effectiveFrom: string | null) => Promise<unknown> }) {
  const [open, setOpen] = useState(false)
  const [when, setWhen] = useState<"NOW" | "SCHEDULED">("NOW")
  const [value, setValue] = useState("")
  const inputId = useId()
  const [past, setPast] = useState(false)
  const iso = when === "SCHEDULED" ? localDateTimeToIso(value) : null
  const invalid = when === "SCHEDULED" && (iso === null || past)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" disabled={disabled || pending}>
          <Send /> Publicar…
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Publicar esta versão</PopoverTitle>
          <PopoverDescription>A versão publicada não muda mais. Avaliações a partir da vigência usam esta versão; as anteriores continuam com a da época.</PopoverDescription>
        </PopoverHeader>
        <RadioGroup value={when} onValueChange={(next) => setWhen(next as "NOW" | "SCHEDULED")} className="space-y-1" aria-label="Vigência">
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="NOW" /> Em vigor agora
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="SCHEDULED" /> A partir de uma data futura
          </label>
        </RadioGroup>
        {when === "SCHEDULED" ? (
          <div className="space-y-1">
            <Label htmlFor={inputId} className="text-xs">
              Vigência a partir de
            </Label>
            <Input id={inputId} type="datetime-local" min={nowAsLocalDateTime()} value={value} onChange={(event) => {
                setValue(event.target.value)
                setPast(isPast(localDateTimeToIso(event.target.value)))
              }} />
            {past ? <p className="text-xs text-destructive">A vigência não pode começar no passado.</p> : null}
          </div>
        ) : null}
        {dirty ? <p className="text-xs text-muted-foreground">As alterações não salvas são salvas no rascunho antes de publicar.</p> : null}
        <Button
          size="sm"
          disabled={pending || invalid}
          onClick={async () => {
            if (when === "SCHEDULED" && isPast(iso)) return setPast(true)
            // Sucesso ou pendências: fecha — as pendências aparecem junto do formulário, não dentro do popover.
            await onPublish(iso)
            setOpen(false)
          }}
        >
          {pending ? "Publicando..." : "Publicar versão"}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
