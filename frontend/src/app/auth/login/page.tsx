import type { Metadata } from "next"

import { LoginForm } from "@/components/auth/login-form"

export const metadata: Metadata = {
  title: "Login | INIA",
  description: "Acesse a plataforma INIA",
}

/** Por que a pessoa voltou ao login (só os motivos conhecidos viram texto; qualquer outro valor é ignorado). */
const NOTICES: Record<string, string> = {
  inatividade: "Sua sessão foi encerrada por inatividade. Entre novamente para continuar.",
  "todos-os-aparelhos": "Você saiu de todos os aparelhos. Entre novamente para continuar.",
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const reason = (await searchParams).motivo
  const notice = typeof reason === "string" ? NOTICES[reason] : undefined
  return <LoginForm notice={notice} />
}
