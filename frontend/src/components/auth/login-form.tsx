import { Card, CardContent } from "@/components/ui/card"

import { AuthCardHeader } from "@/components/auth/auth-card-header"
import { LoginFooter } from "@/components/auth/login-footer"
import { LoginFields } from "@/components/auth/auth-form-client"

export function LoginForm() {
  return (
    <Card className="w-full max-w-md border-border/70 bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <AuthCardHeader
        title="Entrar no INIA"
        description="Acesse sua área de trabalho com e-mail e senha."
      />

      <CardContent>
        <LoginFields />
      </CardContent>

      <LoginFooter />
    </Card>
  )
}