"use client"

import { useId, useRef, useState } from "react"
import { CheckCircle2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { PasswordInput } from "@/components/auth/password-input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useIsMobile } from "@/hooks/use-mobile"
import { ApiError } from "@/lib/api/api-client"
import { startUsageAction } from "@/lib/usage/usage-provider"
import { useFeedbackApplicationsQuery } from "@/queries/feedback-applications/use-feedback-applications"
import { useConfirmFeedbackReadingMutation } from "@/queries/feedback-read-confirmations/use-feedback-read-confirmation"
import { feedbackSourceKey, type FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"
import { CONTESTATION_REASON_COPY, type ReadAgreementInput } from "@/schemas/feedback-ratings/feedback-rating.schema"
import { readConfirmationErrorDetailsSchema, type ReadConfirmationAttempt, type ReadConfirmationEntryPoint, type ReadConfirmationResult } from "@/schemas/feedback-read-confirmations/feedback-read-confirmation.schema"
import { recordReadConfirmationEvent } from "@/services/feedback-read-confirmations/feedback-read-confirmations-service"

import { agreementFromDraft, AgreementStep, EMPTY_AGREEMENT_DRAFT, type AgreementDraft } from "./agreement-step"

/**
 * Diálogo da confirmação de ciência (central, nunca painel lateral), em duas etapas:
 *   1. "Você concorda com este feedback?" — escolha obrigatória, nada marcado; "Não concordo" pede motivo e justificativa.
 *   2. Login e senha da PRÓPRIA conta — a confirmação de sempre, com o resumo da escolha e "Alterar".
 * Ciência e escolha são gravadas juntas pelo backend. `purpose`:
 *   CONFIRM             confirmar a ciência (Acompanhamento ou sessão com a INIA);
 *   REGISTER_AGREEMENT  ciência anterior à escolha: registrar a escolha UMA vez (mesmas credenciais).
 * A escolha e a justificativa ficam aqui até o sucesso: fechar, cancelar, errar a senha ou cair na trava não apagam o texto.
 * Abrir, cancelar, errar e confirmar viram eventos de usabilidade no backend; o login digitado e a senha nunca são guardados.
 */
export type ReadingConfirmationPurpose = "CONFIRM" | "REGISTER_AGREEMENT"

type Props = {
  source: FeedbackSourceRef
  entryPoint: ReadConfirmationEntryPoint
  purpose: ReadingConfirmationPurpose
  /** Nome do feedback na descrição ("… que você leu “Rechamada”"). */
  title?: string | null | undefined
  /** Há uma conversa com a INIA em andamento sobre este feedback (confirmar a conclui). Ausente = pelo cache das aplicações. */
  applicationInProgress?: boolean | undefined
  /** O botão que abre o diálogo. */
  trigger: (openDialog: () => void) => React.ReactNode
  onBeforeConfirm?: (() => void) | undefined
  onConfirmed?: ((result: ReadConfirmationResult) => void) | undefined
}

type Step = "AGREEMENT" | "CREDENTIALS"

export function ReadingConfirmationDialog({ source, entryPoint, purpose, title, applicationInProgress, trigger, onBeforeConfirm, onConfirmed }: Props) {
  const mobile = useIsMobile()
  const mutation = useConfirmFeedbackReadingMutation()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>("AGREEMENT")
  const [draft, setDraft] = useState<AgreementDraft>(EMPTY_AGREEMENT_DRAFT)
  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const attemptRef = useRef<{ id: string; openedAt: number; done: boolean } | null>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const ids = useId()
  // Só com o elemento aberto (o cache costuma estar quente pelos botões "Ouvir/Continuar" do Acompanhamento).
  const applications = useFeedbackApplicationsQuery(open && applicationInProgress === undefined)
  const inProgress = applicationInProgress ?? Boolean(applications.data?.some((item) => feedbackSourceKey(item.source) === feedbackSourceKey(source) && item.status === "IN_PROGRESS"))
  const agreement = agreementFromDraft(draft)
  const pending = mutation.isPending

  const attemptOf = (): ReadConfirmationAttempt => {
    const attempt = attemptRef.current!
    return { source, entryPoint, attemptId: attempt.id, device: mobile ? "MOBILE" : "DESKTOP", elapsedMs: Math.round(performance.now() - attempt.openedAt) }
  }

  function openDialog() {
    attemptRef.current = { id: crypto.randomUUID(), openedAt: performance.now(), done: false }
    setStep("AGREEMENT")
    setLogin("")
    setPassword("")
    setError(null)
    mutation.reset()
    setOpen(true)
    // Registro de usabilidade: nunca bloqueia nem mostra erro.
    void recordReadConfirmationEvent({ ...attemptOf(), event: "OPENED" }).catch(() => undefined)
  }

  function handleOpenChange(next: boolean) {
    if (next || pending) return
    const attempt = attemptRef.current
    if (attempt && !attempt.done) void recordReadConfirmationEvent({ ...attemptOf(), event: "CANCELLED" }).catch(() => undefined)
    setPassword("")
    setOpen(false)
  }

  function goToCredentials() {
    if (!agreement) return
    setStep("CREDENTIALS")
    window.requestAnimationFrame(() => document.getElementById(`${ids}-login`)?.focus())
  }

  function backToAgreement() {
    setError(null)
    setStep("AGREEMENT")
    window.requestAnimationFrame(() => focusAgreement())
  }

  function focusAgreement() {
    const chosen = draft.value ? document.getElementById(`${ids}-agreement-${draft.value}`) : null
    ;(chosen ?? document.getElementById(`${ids}-agreement-AGREE`))?.focus()
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!agreement || !login.trim() || !password || pending) return
    setError(null)
    onBeforeConfirm?.()
    // Monitoria de usabilidade: a confirmação é uma ação com resultado do servidor (a credencial nunca entra no evento).
    const action = startUsageAction("feedback.confirm_reading", attemptRef.current?.id)
    const sent: ReadAgreementInput = agreement
    mutation.mutate(
      { ...attemptOf(), login: login.trim(), password, agreement: sent },
      {
        onSuccess: (result) => {
          action.succeed()
          if (attemptRef.current) attemptRef.current.done = true
          setPassword("")
          setOpen(false)
          setDraft(EMPTY_AGREEMENT_DRAFT)
          if (result.agreementDiffered) toast.info("Este feedback já tinha ciência confirmada. Vale a escolha registrada na primeira confirmação.")
          else if (result.agreement?.value === "DISAGREE") toast.success("Ciência confirmada. Sua discordância foi enviada para revisão.")
          onConfirmed?.(result)
        },
        onError: (failure) => {
          action.fail(failure instanceof ApiError && failure.code ? failure.code : "CONFIRMATION_FAILED")
          setPassword("")
          setError(messageOf(failure))
          window.requestAnimationFrame(() => passwordRef.current?.focus())
        },
      },
    )
  }

  const subject = title ? <>o feedback <span className="font-medium text-foreground">“{title}”</span></> : "este feedback"
  const canSubmit = agreement !== null && login.trim().length > 0 && password.length > 0 && !pending
  return (
    <>
      {trigger(openDialog)}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-md"
          data-testid="confirm-reading-dialog"
          data-step={step}
          data-usage-screen="feedback.confirm_reading"
          data-usage-entity-type={source.kind}
          data-usage-entity-id={source.id}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            focusAgreement()
          }}
        >
          {step === "AGREEMENT" ? (
            <>
              <DialogHeader>
                <p className="text-[11px] font-medium text-muted-foreground">Etapa 1 de 2</p>
                <DialogTitle>Você concorda com este feedback?</DialogTitle>
                <DialogDescription>
                  {purpose === "CONFIRM" ? <>Antes de confirmar que você leu {subject}, diga se concorda com ele.</> : <>Você já confirmou que leu {subject}. Diga se concorda com ele.</>}
                </DialogDescription>
              </DialogHeader>
              <AgreementStep draft={draft} onChange={setDraft} idPrefix={ids} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} data-usage-element="feedback.confirm_reading.cancel">
                  Cancelar
                </Button>
                <Button type="button" disabled={agreement === null} onClick={goToCredentials} data-usage-element="feedback.confirm_reading.continue">
                  Continuar
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <p className="text-[11px] font-medium text-muted-foreground">Etapa 2 de 2</p>
                <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary dark:text-chart-4" aria-hidden>
                  <ShieldCheck className="size-5" />
                </span>
                <DialogTitle>{purpose === "CONFIRM" ? "Confirmar ciência" : "Confirmar sua escolha"}</DialogTitle>
                <DialogDescription>
                  {purpose === "CONFIRM" ? <>Para registrar que você leu {subject}, entre com o seu login e senha.</> : <>Para registrar a sua escolha sobre {subject}, entre com o seu login e senha.</>}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-start justify-between gap-3 rounded-xl border bg-muted/30 px-3 py-2 text-sm" data-testid="agreement-summary">
                <p className="min-w-0">
                  {agreement?.value === "DISAGREE" ? (
                    <>
                      <span className="font-medium">Você não concorda com o feedback.</span>{" "}
                      <span className="text-muted-foreground">Motivo: {CONTESTATION_REASON_COPY[agreement.reason].label}</span>
                    </>
                  ) : (
                    <span className="font-medium">Você concorda com o feedback.</span>
                  )}
                </p>
                <Button type="button" variant="link" size="sm" className="h-auto shrink-0 px-0" onClick={backToAgreement} disabled={pending} data-usage-element="feedback.confirm_reading.change">
                  Alterar
                </Button>
              </div>
              <form id={`${ids}-form`} className="space-y-4" onSubmit={submit} noValidate>
                <div className="space-y-2">
                  <Label htmlFor={`${ids}-login`}>Login</Label>
                  <Input id={`${ids}-login`} type="email" inputMode="email" autoComplete="username" placeholder="Seu e-mail corporativo" value={login} onChange={(event) => setLogin(event.target.value)} disabled={pending} aria-invalid={error ? true : undefined} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${ids}-password`}>Senha</Label>
                  <PasswordInput ref={passwordRef} id={`${ids}-password`} autoComplete="current-password" placeholder="Sua senha" value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} aria-invalid={error ? true : undefined} />
                </div>
                {error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {purpose === "CONFIRM" ? <li>Seu gestor verá a data desta confirmação.</li> : null}
                  {inProgress ? <li>A conversa com a INIA sobre este feedback será concluída. Se surgir uma dúvida depois, você ainda poderá perguntar.</li> : null}
                </ul>
              </form>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending} data-usage-element="feedback.confirm_reading.cancel">
                  Cancelar
                </Button>
                <Button type="submit" form={`${ids}-form`} disabled={!canSubmit} data-usage-element="feedback.confirm_reading.submit">
                  <CheckCircle2 aria-hidden />
                  {pending ? "Confirmando…" : purpose === "CONFIRM" ? "Confirmar ciência" : "Confirmar escolha"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function messageOf(failure: unknown): string {
  if (!(failure instanceof ApiError)) return "Não foi possível confirmar agora. Verifique a conexão e tente de novo."
  const details = readConfirmationErrorDetailsSchema.parse(failure.details ?? {})
  if (failure.code === "READ_CONFIRMATION_INVALID_CREDENTIALS") {
    const remaining = details.remainingAttempts
    if (remaining === undefined) return "Login ou senha não conferem com a sua conta."
    if (remaining === 0) return "Login ou senha não conferem com a sua conta. A confirmação ficará bloqueada por alguns minutos."
    return `Login ou senha não conferem com a sua conta. ${remaining === 1 ? "Resta 1 tentativa" : `Restam ${remaining} tentativas`} antes de um bloqueio temporário.`
  }
  if (failure.code === "READ_CONFIRMATION_TOO_MANY_ATTEMPTS") {
    const time = details.retryAt ? new Date(details.retryAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null
    return time ? `Muitas tentativas com login ou senha incorretos. Tente de novo a partir das ${time}.` : failure.message
  }
  if (failure.code === "VALIDATION_ERROR") return "Confira a sua escolha e a justificativa e tente de novo. Se continuar, atualize a página."
  if (failure.code === "FEEDBACK_READ_AGREEMENT_CONFLICT") return "Não foi possível registrar agora. Atualize a página e confira o feedback."
  if (failure.status === 404) return "Este feedback não está mais disponível para confirmação."
  return "Não foi possível confirmar agora. Tente de novo."
}
