import { Card, CardContent } from "@/components/ui/card"

import { AuthCardHeader } from "@/components/auth/auth-card-header"
import { AuthFeedback } from "@/components/auth/auth-feedback"
import { LoginFooter } from "@/components/auth/login-footer"
import { LoginFields } from "@/components/auth/auth-form-client"

/** `notice`: por que a pessoa voltou ao login (sessão encerrada por inatividade, saiu de todos os aparelhos). */
export function LoginForm({ notice }: { notice?: string }) {
  return (
    <Card className="w-full max-w-md border-border/70 bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <AuthCardHeader
        title="Entrar no INIA"
        description="Acesse sua área de trabalho com e-mail e senha."
      />

      <CardContent className="space-y-5">
        {notice ? <AuthFeedback type="success" message={notice} /> : null}
        <LoginFields />
      </CardContent>

      <LoginFooter />
    </Card>
  )
}
