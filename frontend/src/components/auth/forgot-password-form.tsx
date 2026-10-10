import { Card, CardContent, CardFooter } from "@/components/ui/card"

import { AuthCardHeader } from "@/components/auth/auth-card-header"
import { ForgotPasswordFields } from "@/components/auth/auth-form-client"

export function ForgotPasswordForm() {
  return (
    <Card className="w-full max-w-md border-border/70 bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <AuthCardHeader
        title="Esqueci minha senha"
        description="Informe seu e-mail para receber as instruções de redefinição."
        badge="R"
      />

      <CardContent>
        <ForgotPasswordFields />
      </CardContent>

      <CardFooter className="pt-0">
        <p className="text-xs text-muted-foreground">
          Fluxo de recuperação com feedback visual de teste.
        </p>
      </CardFooter>
    </Card>
  )
}
