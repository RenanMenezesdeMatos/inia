import type { Metadata } from "next"

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const metadata: Metadata = {
  title: "Recuperar senha | INIA",
  description: "Recupere o acesso à plataforma INIA",
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />
}
