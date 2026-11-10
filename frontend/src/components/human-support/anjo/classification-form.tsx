"use client"

import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { CharacterCounter } from "@/components/ui/character-counter"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api/api-client"
import { formatShortDateTime } from "@/lib/format/date"
import {
  CLASSIFICATION_DESCRIPTION_OPTIONAL,
  CLASSIFICATION_OUTCOME_LABELS,
  CLASSIFICATION_OUTCOMES,
  CLASSIFICATION_REASON_HINTS,
  CLASSIFICATION_REASON_LABELS,
  CLASSIFICATION_REASONS,
  CLASSIFICATION_TITLE_OPTIONAL,
  CLASSIFICATION_TITLE_REQUIRED,
  CLASSIFICATION_TOOL_REASONS,
  classificationFieldLabels,
  END_CAUSE_LABELS,
  HUMAN_SUPPORT_TEXT_LIMITS,
  type ClassificationOutcome,
  type ClassificationReason,
} from "@/schemas/human-support/catalogs.schema"
import type { AnjoView } from "@/schemas/human-support/state.schema"
import { classifySupportAttendance, type ClassificationInput } from "@/services/human-support/human-support-service"

/**
 * CLASSIFICAÇÃO DO ATENDIMENTO PELO ANJO (design_draft.md seção 12; `CLASSIFICATION_CATALOG_V2`). Uma por atendimento e definitiva
 * depois de enviada — a tela avisa antes. Duas perguntas separadas e obrigatórias: POR QUE o operador precisou do Anjo (motivo) e
 * COMO terminou (resultado) — nenhum motivo marca o resultado sozinho (um atendimento por falta de acesso pode terminar orientado,
 * encaminhado ou resolvido). Título do processo, sistema ou IA obrigatório quando a informação existia (FOUND_IN_PROCESS,
 * AVAILABLE_ELSEWHERE), opcional em pergunta mal formulada e não pedido nos demais; nos impedimentos operacionais (sem acesso,
 * ferramenta indisponível) o mesmo campo é a "Ferramenta ou sistema afetado" e a descrição vira "Detalhes", os dois opcionais; link
 * opcional, só http(s); descrição obrigatória em "Outro". As mesmas regras valem no servidor (422); 409
 * `HUMAN_SUPPORT_ALREADY_CLASSIFIED` mostra o aviso e atualiza as pendências.
 */
export type PendingClassification = AnjoView["pendingClassifications"][number]

type Draft = { reason: ClassificationReason | null; title: string; url: string; description: string; outcome: ClassificationOutcome | null }
type Field = "reason" | "title" | "url" | "description" | "outcome"
export type ClassificationErrors = Partial<Record<Field, string>>

const TITLE_LIMITS = HUMAN_SUPPORT_TEXT_LIMITS.classificationTitle
const DESCRIPTION_LIMITS = HUMAN_SUPPORT_TEXT_LIMITS.classificationDescription
const URL_PATTERN = /^https?:\/\/\S+$/i

export type DescriptionRule = "required" | "optional" | "hidden"
export function descriptionRuleFor(reason: ClassificationReason | null): DescriptionRule {
  if (reason === "OTHER") return "required"
  if (reason && CLASSIFICATION_DESCRIPTION_OPTIONAL.includes(reason)) return "optional"
  return "hidden"
}

export type TitleRule = "required" | "optional" | "hidden"
export function titleRuleFor(reason: ClassificationReason | null): TitleRule {
  if (reason && CLASSIFICATION_TITLE_REQUIRED.includes(reason)) return "required"
  if (reason && CLASSIFICATION_TITLE_OPTIONAL.includes(reason)) return "optional"
  return "hidden"
}

/** Regras da tela (as mesmas do servidor): devolve o corpo pronto para enviar ou os erros por campo. */
export function validateClassification(draft: Draft): { input: ClassificationInput | null; errors: ClassificationErrors } {
  const errors: ClassificationErrors = {}
  const titleRule = titleRuleFor(draft.reason)
  const descriptionRule = descriptionRuleFor(draft.reason)
  const title = draft.title.trim()
  const url = draft.url.trim()
  const description = draft.description.trim()
  if (!draft.reason) errors.reason = "Escolha o motivo do encaminhamento."
  if (titleRule === "required" && title.length === 0) errors.title = "Informe o título do processo, sistema ou IA."
  const titleName = draft.reason && CLASSIFICATION_TOOL_REASONS.includes(draft.reason) ? "O nome da ferramenta ou sistema" : "O título"
  if (titleRule !== "hidden" && title.length > 0 && (title.length < TITLE_LIMITS.min || title.length > TITLE_LIMITS.max)) errors.title = `${titleName} precisa ter de ${TITLE_LIMITS.min} a ${TITLE_LIMITS.max} caracteres.`
  if (url.length > 0 && !URL_PATTERN.test(url)) errors.url = "Use um endereço que comece com http:// ou https://."
  else if (url.length > HUMAN_SUPPORT_TEXT_LIMITS.url) errors.url = `O link pode ter até ${HUMAN_SUPPORT_TEXT_LIMITS.url} caracteres.`
  if (descriptionRule === "required" && description.length === 0) errors.description = "Descreva o motivo."
  else if (descriptionRule !== "hidden" && description.length > 0 && (description.length < DESCRIPTION_LIMITS.min || description.length > DESCRIPTION_LIMITS.max))
    errors.description = descriptionRule === "required" ? `A descrição precisa ter de ${DESCRIPTION_LIMITS.min} a ${DESCRIPTION_LIMITS.max} caracteres.` : `Os detalhes precisam ter de ${DESCRIPTION_LIMITS.min} a ${DESCRIPTION_LIMITS.max} caracteres.`
  if (!draft.outcome) errors.outcome = "Escolha o resultado do atendimento."
  if (Object.keys(errors).length > 0 || !draft.reason || !draft.outcome) return { input: null, errors }
  return {
    errors,
    input: {
      reason: draft.reason,
      outcome: draft.outcome,
      ...(titleRule !== "hidden" && title ? { referenceTitle: title } : {}),
      ...(url ? { referenceUrl: url } : {}),
      ...(descriptionRule !== "hidden" && description ? { otherDescription: description } : {}),
    },
  }
}

export type ClassificationFormProps = {
  pending: PendingClassification
  /** Depois de enviar (ou quando o servidor diz que já estava classificado): a área busca as pendências de novo. */
  onDone: () => void
}

export function ClassificationForm({ pending, onDone }: ClassificationFormProps) {
  const id = useId()
  const [draft, setDraft] = useState<Draft>({ reason: null, title: "", url: "", description: "", outcome: null })
  const [showErrors, setShowErrors] = useState(false)
  const [sending, setSending] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const { input, errors } = validateClassification(draft)
  const visibleErrors = showErrors ? errors : {}
  const titleRule = titleRuleFor(draft.reason)
  const descriptionRule = descriptionRuleFor(draft.reason)
  const labels = classificationFieldLabels(draft.reason)
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const describedBy = (field: Field, extra?: string) => [extra, visibleErrors[field] ? `${id}-${field}-error` : null].filter(Boolean).join(" ") || undefined
  const fieldError = (field: Field) =>
    visibleErrors[field] ? (
      <p id={`${id}-${field}-error`} className="text-xs text-destructive">
        {visibleErrors[field]}
      </p>
    ) : null

  if (sent) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Classificação de {pending.protocol} enviada.
      </p>
    )
  }

  return (
    <form
      noValidate
      aria-label={`Classificar o atendimento ${pending.protocol}`}
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        setShowErrors(true)
        if (!input || sending) return
        setSending(true)
        setServerError(null)
        try {
          await classifySupportAttendance(pending.attendanceId, input)
          setSent(true)
          onDone()
        } catch (failure) {
          setServerError(failure instanceof Error && failure.message ? failure.message : "Não foi possível enviar a classificação. Tente de novo.")
          if (failure instanceof ApiError && failure.code === "HUMAN_SUPPORT_ALREADY_CLASSIFIED") onDone()
        } finally {
          setSending(false)
        }
      }}
    >
      <p className="text-xs text-muted-foreground">
        {pending.operatorName} · terminou {formatShortDateTime(pending.endedAt)} · {END_CAUSE_LABELS[pending.endCause] ?? pending.endCause}
      </p>

      <fieldset className="rounded-2xl border border-border bg-muted/30 p-4" aria-describedby={describedBy("reason")}>
        <legend className="float-left mb-1 w-full text-sm font-semibold">Motivo do encaminhamento</legend>
        <p className="clear-both mb-3 text-xs text-muted-foreground">Por que o operador precisou de você.</p>
        <RadioGroup className="grid gap-2 sm:grid-cols-2" value={draft.reason ?? ""} onValueChange={(value) => update({ reason: value as ClassificationReason })} aria-invalid={visibleErrors.reason ? true : undefined}>
          {CLASSIFICATION_REASONS.map((reason) => {
            const hint = CLASSIFICATION_REASON_HINTS[reason]
            return (
              <div key={reason} className="flex items-start gap-3 rounded-xl border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5">
                <RadioGroupItem id={`${id}-reason-${reason}`} value={reason} className="mt-0.5" aria-describedby={hint ? `${id}-reason-${reason}-hint` : undefined} />
                <div className="flex-1 space-y-0.5">
                  <Label htmlFor={`${id}-reason-${reason}`} className="cursor-pointer font-normal leading-snug">
                    {CLASSIFICATION_REASON_LABELS[reason]}
                  </Label>
                  {hint ? (
                    <p id={`${id}-reason-${reason}-hint`} className="text-xs text-muted-foreground">
                      {hint}
                    </p>
                  ) : null}
                </div>
              </div>
            )
          })}
        </RadioGroup>
        {fieldError("reason")}
      </fieldset>

      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-muted/30 p-4">
        <p className="text-sm font-semibold">{labels.section}</p>
        {titleRule !== "hidden" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-title`}>{titleRule === "required" ? labels.title : `${labels.title} (opcional)`}</Label>
            <Input id={`${id}-title`} className="bg-card" value={draft.title} required={titleRule === "required"} aria-invalid={visibleErrors.title ? true : undefined} aria-describedby={describedBy("title", `${id}-title-count`)} onChange={(event) => update({ title: event.target.value })} />
            <CharacterCounter id={`${id}-title-count`} value={draft.title} limits={titleRule === "required" ? TITLE_LIMITS : { min: 0, max: TITLE_LIMITS.max }} />
            {fieldError("title")}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-url`}>Link (opcional)</Label>
          <Input id={`${id}-url`} className="bg-card" type="url" inputMode="url" value={draft.url} placeholder="https://" aria-invalid={visibleErrors.url ? true : undefined} aria-describedby={describedBy("url", `${id}-url-hint`)} onChange={(event) => update({ url: event.target.value })} />
          <p id={`${id}-url-hint`} className="text-xs text-muted-foreground">
            Só endereços que começam com http:// ou https://, até {HUMAN_SUPPORT_TEXT_LIMITS.url} caracteres. O link é guardado como texto e exibido com aviso de link externo.
          </p>
          {fieldError("url")}
        </div>

        {descriptionRule !== "hidden" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-description`}>{descriptionRule === "required" ? "Descreva o motivo" : `${labels.description} (opcional)`}</Label>
            <Textarea
              id={`${id}-description`}
              className="bg-card"
              value={draft.description}
              rows={3}
              required={descriptionRule === "required"}
              placeholder={descriptionRule === "optional" ? "Ex.: mensagem de erro, desde quando, quem já foi avisado." : undefined}
              aria-invalid={visibleErrors.description ? true : undefined}
              aria-describedby={describedBy("description", `${id}-description-count`)}
              onChange={(event) => update({ description: event.target.value })}
            />
            <CharacterCounter id={`${id}-description-count`} value={draft.description} limits={descriptionRule === "required" ? DESCRIPTION_LIMITS : { min: 0, max: DESCRIPTION_LIMITS.max }} />
            {fieldError("description")}
          </div>
        ) : null}
      </div>

      <fieldset className="rounded-2xl border border-border bg-muted/30 p-4" aria-describedby={describedBy("outcome")}>
        <legend className="float-left mb-1 w-full text-sm font-semibold">Resultado</legend>
        <p className="clear-both mb-3 text-xs text-muted-foreground">Como o atendimento terminou — escolha à parte do motivo.</p>
        <RadioGroup className="grid gap-2 sm:grid-cols-2" value={draft.outcome ?? ""} onValueChange={(value) => update({ outcome: value as ClassificationOutcome })} aria-invalid={visibleErrors.outcome ? true : undefined}>
          {CLASSIFICATION_OUTCOMES.map((outcome) => (
            <div key={outcome} className="flex items-start gap-3 rounded-xl border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5">
              <RadioGroupItem id={`${id}-outcome-${outcome}`} value={outcome} className="mt-0.5" />
              <Label htmlFor={`${id}-outcome-${outcome}`} className="flex-1 cursor-pointer font-normal leading-snug">
                {CLASSIFICATION_OUTCOME_LABELS[outcome]}
              </Label>
            </div>
          ))}
        </RadioGroup>
        {fieldError("outcome")}
      </fieldset>

      {serverError ? (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">A classificação é definitiva: depois de enviada, não pode ser alterada.</p>
        <Button type="submit" className="h-10 w-fit rounded-full px-5" disabled={sending}>
          {sending ? "Enviando…" : "Enviar classificação"}
        </Button>
      </div>
    </form>
  )
}
