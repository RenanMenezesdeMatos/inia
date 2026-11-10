"use client"

import { useState } from "react"
import { Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatShortDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { EVALUATION_RESOLVED, EVALUATION_RESOLVED_LABELS, type EvaluationResolved } from "@/schemas/human-support/catalogs.schema"
import type { EvaluationCurrent, PendingEvaluation } from "@/schemas/human-support/state.schema"
import { evaluateSupportAttendance } from "@/services/human-support/human-support-service"
import { IconBadge } from "@/components/ui/surface"

/**
 * AVALIAÇÃO DO ATENDIMENTO pelo operador (design_draft.md seção 12): "Sua dúvida foi resolvida?" e as estrelas — opcionais,
 * independentes, alteráveis até 24 h depois do fim. Separada da avaliação do feedback e da avaliação da resposta da INIA.
 */
export function SupportEvaluation({ pending, onSaved }: { pending: PendingEvaluation; onSaved?: (current: EvaluationCurrent) => void }) {
  const [current, setCurrent] = useState<EvaluationCurrent>(pending.current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (input: { resolved?: EvaluationResolved; stars?: number }) => {
    setSaving(true)
    setError(null)
    try {
      const next = await evaluateSupportAttendance(pending.attendanceId, input)
      setCurrent(next)
      onSaved?.(next)
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Não foi possível salvar sua avaliação.")
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 text-sm shadow-xs" aria-label="Avaliação do atendimento">
      <div className="flex items-center gap-3">
        <IconBadge icon={Star} size="sm" />
        <div className="leading-tight">
          <p className="font-semibold">Como foi o atendimento?</p>
          <p className="text-xs text-muted-foreground">Opcional. Você pode mudar até {formatShortDateTime(pending.openUntil)}.</p>
        </div>
      </div>
      <div className="space-y-2">
        <p className="font-medium" id={`resolved-${pending.attendanceId}`}>Sua dúvida foi resolvida?</p>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`resolved-${pending.attendanceId}`}>
          {EVALUATION_RESOLVED.map((value) => (
            <Button key={value} type="button" size="sm" className="h-9 rounded-full px-4" variant={current.resolved === value ? "default" : "outline"} aria-pressed={current.resolved === value} disabled={saving} onClick={() => void save({ resolved: value })}>
              {EVALUATION_RESOLVED_LABELS[value]}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <p className="font-medium" id={`stars-${pending.attendanceId}`}>Avalie o atendimento de {pending.anjoName}</p>
        <div className="flex gap-1" role="group" aria-labelledby={`stars-${pending.attendanceId}`}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button key={value} type="button" className="rounded-full p-1 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50" aria-label={`${value} ${value === 1 ? "estrela" : "estrelas"}`} aria-pressed={current.stars === value} disabled={saving} onClick={() => void save({ stars: value })}>
              <Star className={cn("size-6", current.stars !== null && value <= current.stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/60")} />
            </button>
          ))}
        </div>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </section>
  )
}
