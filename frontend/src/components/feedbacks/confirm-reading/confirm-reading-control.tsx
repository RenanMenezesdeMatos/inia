"use client"

import { useId, useRef, useState } from "react"
import { CheckCircle2, ShieldCheck } from "lucide-react"

import { PasswordInput } from "@/components/auth/password-input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useIsMobile } from "@/hooks/use-mobile"
import { formatDateTime } from "@/lib/format/date"
import { ApiError } from "@/lib/api/api-client"
import { startUsageAction } from "@/lib/usage/usage-provider"
import { cn } from "@/lib/utils"
import { useFeedbackApplicationsQuery } from "@/queries/feedback-applications/use-feedback-applications"
import { useConfirmedReadingAt, useConfirmFeedbackReadingMutation } from "@/queries/feedback-read-confirmations/use-feedback-read-confirmation"
import { feedbackSourceKey, type FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"
import { readConfirmationErrorDetailsSchema, type ReadConfirmationAttempt, type ReadConfirmationEntryPoint, type ReadConfirmationResult } from "@/schemas/feedback-read-confirmations/feedback-read-confirmation.schema"
import { recordReadConfirmationEvent } from "@/services/feedback-read-confirmations/feedback-read-confirmations-service"

type Props = {
  source: FeedbackSourceRef
  /** Onde o botão está — vai para o registro de usabilidade. */
  entryPoint: ReadConfirmationEntryPoint
  /** Nome do feedback na descrição do elemento ("… que você leu “Rechamada”"). */
  title?: string | null
  /** Ciência que já veio do servidor (o mapa desta sessão do navegador tem precedência). */
  acknowledgedAt: string | null
  /** Há uma conversa com a INIA em andamento sobre este feedback — confirmar a conclui (o elemento avisa). Ausente = pelo estado
   * da aplicação no cache compartilhado (o mesmo dos botões "Ouvir/Continuar" do Acompanhamento). */
  applicationInProgress?: boolean
  disabled?: boolean
  /** Só o ícone (o texto fica para leitor de tela) — cabeçalho da sessão no celular. */
  compact?: boolean
  className?: string
  /** Estilo do estado "Ciência confirmada" quando o fundo pede outro tom (ex.: palco escuro da sessão). */
  confirmedClassName?: string
  /** Logo antes de enviar as credenciais (ex.: a sessão para a fala e a voz antes de encerrar a conversa). */
  onBeforeConfirm?: () => void
  onConfirmed?: (result: ReadConfirmationResult) => void
}

/**
 * "Confirmar ciência" — o MESMO botão e o MESMO elemento no Acompanhamento e dentro da sessão com a INIA. Ciência = o próprio
 * colaborador confirma, com o login e a senha da sua conta, que leu o feedback; é a conclusão do feedback (conclui também a conversa
 * da aplicação em andamento). O elemento é um diálogo central (nunca painel lateral). Abrir, cancelar, errar e confirmar viram
 * eventos de usabilidade no backend; o login digitado e a senha nunca são guardados.
 */
export function ConfirmReadingControl({ source, entryPoint, title, acknowledgedAt, applicationInProgress, disabled = false, compact = false, className, confirmedClassName, onBeforeConfirm, onConfirmed }: Props) {
  const confirmedHere = useConfirmedReadingAt(source)
  const confirmedAt = confirmedHere ?? acknowledgedAt
  const mobile = useIsMobile()
  const mutation = useConfirmFeedbackReadingMutation()
  const [open, setOpen] = useState(false)
  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const attemptRef = useRef<{ id: string; openedAt: number; done: boolean } | null>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const ids = useId()
  // Só com o elemento aberto (o cache costuma estar quente pelos botões "Ouvir/Continuar" do Acompanhamento).
  const applications = useFeedbackApplicationsQuery(open && applicationInProgress === undefined)
  const inProgress = applicationInProgress ?? Boolean(applications.data?.some((item) => feedbackSourceKey(item.source) === feedbackSourceKey(source) && item.status === "IN_PROGRESS"))

  if (confirmedAt) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300", confirmedClassName)} data-testid="reading-confirmed">
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
        <span className={compact ? "sr-only" : undefined}>Ciência confirmada em {formatDateTime(confirmedAt)}</span>
      </span>
    )
  }

  const attemptOf = (): ReadConfirmationAttempt => {
    const attempt = attemptRef.current!
    return { source, entryPoint, attemptId: attempt.id, device: mobile ? "MOBILE" : "DESKTOP", elapsedMs: Math.round(performance.now() - attempt.openedAt) }
  }

  function openDialog() {
    attemptRef.current = { id: crypto.randomUUID(), openedAt: performance.now(), done: false }
    setLogin("")
    setPassword("")
    setError(null)
    mutation.reset()
    setOpen(true)
    // Registro de usabilidade: nunca bloqueia nem mostra erro.
    void recordReadConfirmationEvent({ ...attemptOf(), event: "OPENED" }).catch(() => undefined)
  }

  function handleOpenChange(next: boolean) {
    if (next || mutation.isPending) return
    const attempt = attemptRef.current
    if (attempt && !attempt.done) void recordReadConfirmationEvent({ ...attemptOf(), event: "CANCELLED" }).catch(() => undefined)
    setPassword("")
    setOpen(false)
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!login.trim() || !password || mutation.isPending) return
    setError(null)
    onBeforeConfirm?.()
    // Monitoria de usabilidade: a confirmação é uma ação com resultado do servidor (a credencial nunca entra no evento).
    const action = startUsageAction("feedback.confirm_reading", attemptRef.current?.id)
    mutation.mutate(
      { ...attemptOf(), login: login.trim(), password },
      {
        onSuccess: (result) => {
          action.succeed()
          if (attemptRef.current) attemptRef.current.done = true
          setPassword("")
          setOpen(false)
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

  const pending = mutation.isPending
  const canSubmit = login.trim().length > 0 && password.length > 0 && !pending
  return (
    <>
      <Button type="button" size="sm" variant="outline" className={className} disabled={disabled} onClick={openDialog} data-usage-element="feedback.confirm_reading.open" data-usage-entity-type={source.kind} data-usage-entity-id={source.id} title="Confirma, com o seu login e senha, que você leu este feedback. Seu gestor vê essa confirmação." aria-label={compact ? "Confirmar ciência" : undefined}>
        <CheckCircle2 aria-hidden />
        <span className={compact ? "sr-only" : undefined}>Confirmar ciência</span>
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent showCloseButton={false} className="gap-5 sm:max-w-md" data-testid="confirm-reading-dialog" data-usage-screen="feedback.confirm_reading" data-usage-entity-type={source.kind} data-usage-entity-id={source.id} onOpenAutoFocus={(event) => { event.preventDefault(); document.getElementById(`${ids}-login`)?.focus() }}>
          <DialogHeader>
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary dark:text-chart-4" aria-hidden><ShieldCheck className="size-5" /></span>
            <DialogTitle>Confirmar ciência</DialogTitle>
            <DialogDescription>
              Para registrar que você leu {title ? <>o feedback <span className="font-medium text-foreground">“{title}”</span></> : "este feedback"}, entre com o seu login e senha.
            </DialogDescription>
          </DialogHeader>
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
              <li>Seu gestor verá a data desta confirmação.</li>
              {inProgress ? <li>A conversa com a INIA sobre este feedback será concluída. Se surgir uma dúvida depois, você ainda poderá perguntar.</li> : null}
            </ul>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending} data-usage-element="feedback.confirm_reading.cancel">Cancelar</Button>
            <Button type="submit" form={`${ids}-form`} disabled={!canSubmit} data-usage-element="feedback.confirm_reading.submit">
              <CheckCircle2 aria-hidden />
              {pending ? "Confirmando…" : "Confirmar ciência"}
            </Button>
          </DialogFooter>
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
  if (failure.status === 404) return "Este feedback não está mais disponível para confirmação."
  return "Não foi possível confirmar agora. Tente de novo."
}
