import { Card, CardContent } from "@/components/ui/card"

import { AuthCardHeader } from "@/components/auth/auth-card-header"
import { AuthFeedback } from "@/components/auth/auth-feedback"
import { LoginFooter } from "@/components/auth/login-footer"
import { LoginFields } from "@/components/auth/auth-form-client"

/** `notice`: por que a pessoa voltou ao login (sessão encerrada por inatividade, saiu de todos os aparelhos). */
/** `optionsUnavailable`: não foi possível conferir se o login é pela rede — a tela avisa e oferece a matrícula E o e-mail. */
export function LoginForm({ notice, returnTo, networkLogin = false, optionsUnavailable = false }: { notice?: string; returnTo?: string; networkLogin?: boolean; optionsUnavailable?: boolean }) {
  return (
    <Card className="w-full max-w-md border-border/70 bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <AuthCardHeader
        title="Entrar no INIA"
        description={networkLogin ? "Entre com a sua matrícula e a senha de rede." : optionsUnavailable ? "Entre com e-mail e senha ou com a matrícula de rede." : "Acesse sua área de trabalho com e-mail e senha."}
      />

      <CardContent className="space-y-5">
        {notice ? <AuthFeedback type="success" message={notice} /> : null}
        {optionsUnavailable ? (
          <AuthFeedback type="warning" message="Não foi possível conferir agora o tipo de login da sua organização. Se você entra com a matrícula de rede, use o link abaixo do botão Entrar." />
        ) : null}
        <LoginFields returnTo={returnTo} networkLogin={networkLogin} optionsUnavailable={optionsUnavailable} />
      </CardContent>

      <LoginFooter />
    </Card>
  )
}
