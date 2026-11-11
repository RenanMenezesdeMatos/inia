import Link from "next/link"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

import { AuthFeedback } from "@/components/auth/auth-feedback"
import { PasswordInput } from "@/components/auth/password-input"
import { loadSessionDocument } from "@/lib/auth/session-navigation"
import { CREATE_PASSWORD_ROUTE, fetchCurrentUser, landingRouteFor, login } from "@/services/auth/auth-service"

/** `returnTo`: caminho interno já validado (`safeReturnPath`) para onde voltar depois de entrar. */
export function LoginFields({ returnTo }: { returnTo?: string } = {}) {

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{
    type: "error" | "success"
    message: string
  } | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setFeedback(null)

    try {
      const user = await login({ email, password })
      setFeedback({ type: "success", message: user.passwordChangeRequired ? "Senha temporária aceita. Agora crie a sua senha." : `Bem-vindo(a), ${user.name}.` })
      // Destino decidido pelo ACESSO da conta (/auth/me), nunca só pelo nível hierárquico (V1.5.8).
      const current = await fetchCurrentUser()
      // Documento novo (lib/auth/session-navigation.ts): nada que uma conta anterior abriu nesta aba sobrevive na sessão nova.
      // Primeiro acesso (senha temporária): a única tela possível é a de criar a senha.
      loadSessionDocument(current && !user.passwordChangeRequired ? returnTo ?? landingRouteFor(current) : current ? landingRouteFor(current) : user.passwordChangeRequired ? CREATE_PASSWORD_ROUTE : "/supervisor")
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível entrar.",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="email">E-mail corporativo</Label>
        <Input
          id="email"
          type="email"
          placeholder="voce@empresa.com"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={feedback?.type === "error" ? true : undefined}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="password">Senha</Label>
          <Link
            href="/auth/forgot-password"
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            Esqueci minha senha
          </Link>
        </div>

        <PasswordInput
          id="password"
          placeholder="Digite sua senha"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={feedback?.type === "error" ? true : undefined}
        />
      </div>

      {feedback ? (
        <AuthFeedback type={feedback.type} message={feedback.message} />
      ) : null}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Entrando..." : "Entrar"}
      </Button>

      <div className="my-6">
        <Separator />
      </div>

      <div className="rounded-xl border border-border/70 bg-muted/40 p-4">
        
      </div>
    </form>
  )
}