"use client"

import { useState } from "react"
import { CircleCheck, Send, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatShortDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { EVALUATION_RESOLVED, EVALUATION_RESOLVED_LABELS } from "@/schemas/human-support/catalogs.schema"
import type { EvaluationCurrent, PendingEvaluation } from "@/schemas/human-support/state.schema"
import { evaluateSupportAttendance } from "@/services/human-support/human-support-service"
import { IconBadge } from "@/components/ui/surface"

/**
 * AVALIAÇÃO DO ATENDIMENTO pelo operador (design_draft.md seção 12): "Sua dúvida foi resolvida?" e as estrelas — opcionais,
 * independentes, alteráveis até 24 h depois do fim. Separada da avaliação do feedback e da avaliação da resposta da INIA.
 * Escolher só marca; "Enviar avaliação" grava as duas respostas numa chamada e confirma (`onFinished` leva a tela de volta, na sala).
 * Já enviada, o botão vira "Atualizar avaliação" e só fica ativo quando algo mudou.
 */
export function SupportEvaluation({ pending, onSaved, onFinished }: { pending: PendingEvaluation; onSaved?: (current: EvaluationCurrent) => void; onFinished?: () => void }) {
  const [saved, setSaved] = useState<EvaluationCurrent>(pending.current)
  const [draft, setDraft] = useState<EvaluationCurrent>(pending.current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const alreadySent = saved.resolved !== null || saved.stars !== null
  const chosen = draft.resolved !== null || draft.stars !== null
  const changed = draft.resolved !== saved.resolved || draft.stars !== saved.stars
  const choose = (patch: Partial<EvaluationCurrent>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setSent(false)
    setError(null)
  }
  const send = async () => {
    if (!chosen || !changed || saving) return
    setSaving(true)
    setError(null)
    try {
      const next = await evaluateSupportAttendance(pending.attendanceId, { ...(draft.resolved ? { resolved: draft.resolved } : {}), ...(draft.stars !== null ? { stars: draft.stars } : {}) })
      setSaved(next)
      setDraft(next)
      setSent(true)
      onSaved?.(next)
      onFinished?.()
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Não foi possível enviar sua avaliação.")
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
            <Button key={value} type="button" size="sm" className="h-9 rounded-full px-4" variant={draft.resolved === value ? "default" : "outline"} aria-pressed={draft.resolved === value} disabled={saving} onClick={() => choose({ resolved: value })}>
              {EVALUATION_RESOLVED_LABELS[value]}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <p className="font-medium" id={`stars-${pending.attendanceId}`}>Avalie o atendimento de {pending.anjoName}</p>
        <div className="flex gap-1" role="group" aria-labelledby={`stars-${pending.attendanceId}`}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button key={value} type="button" className="rounded-full p-1 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50" aria-label={`${value} ${value === 1 ? "estrela" : "estrelas"}`} aria-pressed={draft.stars === value} disabled={saving} onClick={() => choose({ stars: value })}>
              <Star className={cn("size-6", draft.stars !== null && value <= draft.stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/60")} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button type="button" className="rounded-full" disabled={!chosen || !changed || saving} onClick={() => void send()}>
          <Send aria-hidden />
          {saving ? "Enviando…" : alreadySent ? "Atualizar avaliação" : "Enviar avaliação"}
        </Button>
        {sent && !changed ? (
          <p role="status" className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <CircleCheck className="size-4" aria-hidden />
            Avaliação enviada. Obrigado!
          </p>
        ) : !chosen ? (
          <p className="text-xs text-muted-foreground">Escolha uma resposta ou as estrelas para enviar.</p>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </section>
  )
}
