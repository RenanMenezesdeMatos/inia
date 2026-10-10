"use client"

import { LoginFields } from "@/components/auth/login-fields"
import { Card, CardContent } from "../ui/card"
import { AuthCardHeader } from "./auth-card-header"
import { LoginFooter } from "./login-footer"

export { LoginFields } from "@/components/auth/login-fields"
export { ForgotPasswordFields } from "@/components/auth/forgot-password-fields"


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
