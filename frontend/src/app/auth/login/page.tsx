import type { Metadata } from "next"

import { LoginForm } from "@/components/auth/login-form"

export const metadata: Metadata = {
  title: "Login | INIA",
  description: "Acesse a plataforma INIA",
}

export default function LoginPage() {
  return <LoginForm />
}