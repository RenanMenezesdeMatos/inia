"use client"

import { useMemo, useState, type FormEvent } from "react"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import { Check, Circle, LogOut } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { AuthCardHeader } from "@/components/auth/auth-card-header"
import { AuthFeedback } from "@/components/auth/auth-feedback"
import { PasswordInput } from "@/components/auth/password-input"
import { formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { loadSessionDocument } from "@/lib/auth/session-navigation"
import { passwordRules } from "@/schemas/auth/password-policy"
import { DefinePasswordError, defineFirstPassword, fetchCurrentUser, landingRouteFor, logout } from "@/services/auth/auth-service"

/**
 * PRIMEIRO ACESSO — a pessoa entrou com a senha temporária e precisa criar a própria antes de usar qualquer coisa (só isto ou
 * sair). O checklist ao vivo espelha a política; quem decide é o backend (que também recusa repetir a temporária).
 */
export function CreatePasswordForm({ name, email, temporaryPasswordExpiresAt }: { name: string; email: string; temporaryPasswordExpiresAt: string | null }) {
  const queryClient = useQueryClient()
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<{ message: string; details: string[]; sessionEnded: boolean } | null>(null)
  const rules = useMemo(() => passwordRules(newPassword, email), [newPassword, email])
  const rulesMet = rules.every((rule) => rule.met)
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!rulesMet) {
      setError({ message: "A nova senha ainda não atende a todos os requisitos.", details: [], sessionEnded: false })
      return
    }
    if (newPassword !== confirmPassword) {
      setError({ message: "A confirmação não é igual à nova senha.", details: [], sessionEnded: false })
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await defineFirstPassword({ newPassword, confirmPassword })
      const current = await fetchCurrentUser()
      toast.success("Senha criada. Seu acesso está liberado.")
      // Documento novo (lib/auth/session-navigation.ts): a plataforma abre do zero com a sessão já liberada.
      loadSessionDocument(current ? landingRouteFor(current) : "/auth/login", { replace: true })
    } catch (failure) {
      if (failure instanceof DefinePasswordError) {
        setError({ message: failure.message, details: failure.violations.map((violation) => violation.message), sessionEnded: failure.status === 401 })
      } else {
        setError({ message: "Não foi possível criar a senha. Tente novamente.", details: [], sessionEnded: false })
      }
      setSubmitting(false)
    }
  }

  async function handleSignOut() {
    setSigningOut(true)
    queryClient.clear()
    await logout().catch(() => undefined)
    loadSessionDocument("/auth/login", { replace: true })
  }

  return (
    <Card className="w-full max-w-md border-border/70 bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <AuthCardHeader title="Crie sua senha" description={`Olá, ${name}! Antes de continuar, defina a senha que você vai usar para entrar.`} />

      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit} aria-label="Criar senha">
          {/* Para o gerenciador de senhas salvar a nova senha no login certo. */}
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />

          <div className="space-y-2">
            <Label htmlFor="new-password">Nova senha</Label>
            <PasswordInput id="new-password" autoComplete="new-password" placeholder="Digite a nova senha" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} aria-describedby="password-rules" autoFocus />
            <ul id="password-rules" aria-label="Requisitos da senha" className="space-y-1 pt-1">
              {rules.map((rule) => (
                <li key={rule.code} className={cn("flex items-center gap-2 text-xs", rule.met ? "text-primary" : "text-muted-foreground")}>
                  {rule.met ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
                  <span>{rule.label}</span>
                  <span className="sr-only">{rule.met ? "(atendido)" : "(pendente)"}</span>
                </li>
              ))}
              <li className="flex items-center gap-2 text-xs text-muted-foreground">
                <Circle className="size-3.5" aria-hidden />
                <span>Diferente da senha temporária</span>
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirmar nova senha</Label>
            <PasswordInput id="confirm-password" autoComplete="new-password" placeholder="Digite a nova senha de novo" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} aria-invalid={mismatch ? true : undefined} aria-describedby={mismatch ? "confirm-password-hint" : undefined} />
            {mismatch ? <p id="confirm-password-hint" className="text-xs text-destructive">As senhas não conferem.</p> : null}
          </div>

          {error ? (
            <div role="alert" className="space-y-2">
              <AuthFeedback type="error" message={error.message} />
              {error.details.length > 0 ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-destructive">{error.details.map((detail) => <li key={detail}>{detail}</li>)}</ul> : null}
              {error.sessionEnded ? <Link href="/auth/login" className="text-sm font-medium text-primary hover:opacity-90">Voltar para o login</Link> : null}
            </div>
          ) : null}

          <Button type="submit" className="w-full" disabled={submitting || signingOut || error?.sessionEnded === true}>
            {submitting ? "Criando senha..." : "Criar senha e entrar"}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="flex flex-col items-start gap-3 pt-0">
        {temporaryPasswordExpiresAt ? (
          <p className="text-xs text-muted-foreground">
            A senha temporária vale até <time dateTime={temporaryPasswordExpiresAt} suppressHydrationWarning>{formatDateTime(temporaryPasswordExpiresAt)}</time>. Depois disso, peça uma nova ao administrador.
          </p>
        ) : null}
        <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => void handleSignOut()} disabled={signingOut}>
          <LogOut aria-hidden />
          Sair
        </Button>
      </CardFooter>
    </Card>
  )
}
