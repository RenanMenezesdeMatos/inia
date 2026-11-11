"use client"

import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { CONTESTATION_REASON_COPY, CONTESTATION_REASONS, CONTESTATION_TEXT_LIMITS, type ContestationReason, type ReadAgreementInput } from "@/schemas/feedback-ratings/feedback-rating.schema"

/**
 * Primeira etapa da confirmação de ciência: "Você concorda com este feedback?" — nada vem marcado. "Não concordo" revela os
 * motivos; escolhido o motivo, aparece a justificativa (rótulo = a pergunta do motivo). Trocar o motivo mantém o texto. É só
 * apresentação: o rascunho fica com quem chama, até a confirmação dar certo.
 */
export type AgreementDraft = { value: "AGREE" | "DISAGREE" | null; reason: ContestationReason | null; justification: string }
export const EMPTY_AGREEMENT_DRAFT: AgreementDraft = { value: null, reason: null, justification: "" }

/** A escolha pronta para enviar, ou null enquanto a etapa não está completa (o backend valida de novo). */
export function agreementFromDraft(draft: AgreementDraft): ReadAgreementInput | null {
  if (draft.value === "AGREE") return { value: "AGREE" }
  if (draft.value !== "DISAGREE" || !draft.reason) return null
  const justification = draft.justification.trim()
  if (justification.length < CONTESTATION_TEXT_LIMITS.min || justification.length > CONTESTATION_TEXT_LIMITS.max) return null
  return { value: "DISAGREE", reason: draft.reason, justification }
}

const OPTIONS = [
  { value: "AGREE", label: "Concordo com o feedback", usage: "feedback.confirm_reading.agree" },
  { value: "DISAGREE", label: "Não concordo com o feedback", usage: "feedback.confirm_reading.disagree" },
] as const

export function AgreementStep({ draft, onChange, idPrefix, disabled = false }: { draft: AgreementDraft; onChange: (next: AgreementDraft) => void; idPrefix: string; disabled?: boolean }) {
  const reasonCopy = draft.reason ? CONTESTATION_REASON_COPY[draft.reason] : null
  const trimmed = draft.justification.trim().length
  return (
    <div className="space-y-4">
      <RadioGroup
        value={draft.value ?? ""}
        onValueChange={(value) => onChange({ ...draft, value: value as AgreementDraft["value"] })}
        aria-label="Você concorda com este feedback?"
        className="gap-2"
        disabled={disabled}
      >
        {OPTIONS.map((option) => (
          <Label
            key={option.value}
            htmlFor={`${idPrefix}-agreement-${option.value}`}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 sm:min-h-10"
          >
            <RadioGroupItem id={`${idPrefix}-agreement-${option.value}`} value={option.value} data-usage-element={option.usage} />
            {option.label}
          </Label>
        ))}
      </RadioGroup>

      {draft.value === "DISAGREE" ? (
        <div className="space-y-4 rounded-xl bg-muted/40 p-3">
          <div className="space-y-1.5">
            <p id={`${idPrefix}-reasons-label`} className="text-sm font-semibold">Por que você não concorda?</p>
            <RadioGroup
              value={draft.reason ?? ""}
              onValueChange={(value) => onChange({ ...draft, reason: value as ContestationReason })}
              aria-labelledby={`${idPrefix}-reasons-label`}
              className="gap-0"
              disabled={disabled}
            >
              {CONTESTATION_REASONS.map((reason) => (
                <Label
                  key={reason}
                  htmlFor={`${idPrefix}-reason-${reason}`}
                  className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-muted has-data-[state=checked]:bg-muted sm:min-h-8"
                >
                  <RadioGroupItem id={`${idPrefix}-reason-${reason}`} value={reason} />
                  {CONTESTATION_REASON_COPY[reason].label}
                </Label>
              ))}
            </RadioGroup>
          </div>

          {reasonCopy ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-justification`} className="text-sm font-semibold">
                {reasonCopy.prompt}
              </Label>
              <Textarea
                id={`${idPrefix}-justification`}
                rows={4}
                value={draft.justification}
                maxLength={CONTESTATION_TEXT_LIMITS.max}
                placeholder="Escreva sua justificativa"
                className="min-h-24 resize-none bg-background"
                disabled={disabled}
                aria-describedby={`${idPrefix}-justification-help`}
                onChange={(event) => onChange({ ...draft, justification: event.target.value })}
              />
              <p id={`${idPrefix}-justification-help`} className={cn("flex justify-between gap-2 text-[11px] text-muted-foreground")}>
                <span>{trimmed > 0 && trimmed < CONTESTATION_TEXT_LIMITS.min ? `Escreva pelo menos ${CONTESTATION_TEXT_LIMITS.min} caracteres.` : "Obrigatória."}</span>
                <span className="tabular-nums">
                  {draft.justification.length}/{CONTESTATION_TEXT_LIMITS.max}
                </span>
              </p>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Não concordar não impede a ciência. Seu motivo e sua justificativa vão para quem revisa os feedbacks da sua equipe (pode ser a
            sua liderança). A resposta aparece aqui, no feedback, e você recebe um aviso.
          </p>
        </div>
      ) : null}
    </div>
  )
}
