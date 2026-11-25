import Link from "next/link"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

import { AuthFeedback } from "@/components/auth/auth-feedback"
import { PasswordInput } from "@/components/auth/password-input"
import { loadSessionDocument } from "@/lib/auth/session-navigation"
import { loginInputSchema, looksLikeEmail, networkLoginInputSchema } from "@/schemas/auth/auth.schema"
import { fetchCurrentUser, landingRouteFor, login, sessionNotKeptMessage } from "@/services/auth/auth-service"

/**
 * `returnTo`: caminho interno já validado (`safeReturnPath`) para onde voltar depois de entrar. `optionsUnavailable`: não foi
 * possível conferir o tipo de login — começa no e-mail e oferece a matrícula de rede (e volta ao e-mail).
 */
export function LoginFields({ returnTo, networkLogin = false, optionsUnavailable = false }: { returnTo?: string; networkLogin?: boolean; optionsUnavailable?: boolean } = {}) {
  const canSwitch = networkLogin || optionsUnavailable
  // Login pela rede ligado: matrícula + senha de rede. O e-mail fica só para a conta de emergência do administrador.
  const [mode, setMode] = useState<"NETWORK" | "EMAIL">(networkLogin ? "NETWORK" : "EMAIL")
  const network = mode === "NETWORK"
  const [matricula, setMatricula] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{
    type: "error" | "success"
    message: string
  } | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Só o que o servidor também exige: nenhuma tentativa é gasta com campo vazio ou com o e-mail no lugar da matrícula.
    const input = network ? networkLoginInputSchema.safeParse({ matricula, password }) : loginInputSchema.safeParse({ email, password })
    const problem = network && looksLikeEmail(matricula) ? "Digite a sua matrícula de rede (a mesma do computador), não o e-mail." : input.success ? null : (input.error.issues[0]?.message ?? "Confira os dados.")
    if (problem !== null || !input.success) {
      setFeedback({ type: "error", message: problem ?? "Confira os dados." })
      return
    }
    setIsSubmitting(true)
    setFeedback(null)

    try {
      const user = await login(input.data)
      setFeedback({ type: "success", message: user.passwordChangeRequired ? "Senha temporária aceita. Agora crie a sua senha." : `Bem-vindo(a), ${user.name}.` })
      // Destino decidido pelo ACESSO da conta (/auth/me), nunca só pelo nível hierárquico (V1.5.8).
      const current = await fetchCurrentUser()
      // Senha aceita e sessão não guardada: sem isto a pessoa via "Bem-vindo" e voltava ao login sem explicação.
      if (!current) throw new Error(sessionNotKeptMessage())
      // Documento novo (lib/auth/session-navigation.ts): nada que uma conta anterior abriu nesta aba sobrevive na sessão nova.
      // Primeiro acesso (senha temporária): a única tela possível é a de criar a senha.
      loadSessionDocument(user.passwordChangeRequired ? landingRouteFor(current) : returnTo ?? landingRouteFor(current))
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
      {network ? (
        <div className="space-y-2">
          <Label htmlFor="matricula">Matrícula de rede</Label>
          <Input
            id="matricula"
            type="text"
            placeholder="Ex.: G0055350"
            autoComplete="username"
            autoCapitalize="characters"
            spellCheck={false}
            value={matricula}
            onChange={(event) => setMatricula(event.target.value)}
            aria-invalid={feedback?.type === "error" ? true : undefined}
            aria-describedby="matricula-help"
          />
          <p id="matricula-help" className="text-xs text-muted-foreground">A matrícula que você usa para entrar no computador.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="email">{networkLogin ? "E-mail da conta de emergência" : "E-mail corporativo"}</Label>
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
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="password">{network ? "Senha de rede" : "Senha"}</Label>
          {network ? null : (
            <Link
              href="/auth/forgot-password"
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              Esqueci minha senha
            </Link>
          )}
        </div>

        <PasswordInput
          id="password"
          placeholder={network ? "A mesma senha do computador" : "Digite sua senha"}
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

      {network ? (
        <p className="text-xs text-muted-foreground">
          Esqueceu a senha de rede? Troque pelo canal de suporte de TI. Várias senhas erradas seguidas bloqueiam a sua conta de rede.
        </p>
      ) : null}

      {canSwitch ? (
        <>
          <div className="my-6">
            <Separator />
          </div>
          <Button
            type="button"
            variant="link"
            className="h-auto w-full p-0 text-xs text-muted-foreground"
            onClick={() => {
              setMode(network ? "EMAIL" : "NETWORK")
              setPassword("")
              setFeedback(null)
            }}
          >
            {networkLogin
              ? network
                ? "Entrar com e-mail (administrador)"
                : "Voltar para o login com matrícula de rede"
              : network
                ? "Entrar com e-mail e senha"
                : "Entrar com a matrícula de rede"}
          </Button>
        </>
      ) : (
        <>
          <div className="my-6">
            <Separator />
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/40 p-4">

          </div>
        </>
      )}
    </form>
  )
}