import type { Metadata } from "next"

import { LoginForm } from "@/components/auth/login-form"
import { safeReturnPath } from "@/lib/auth/safe-return"
import { fetchLoginOptions } from "@/services/auth/auth-service"

export const dynamic = "force-dynamic"

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
  const params = await searchParams
  const reason = params.motivo
  const notice = typeof reason === "string" ? NOTICES[reason] : undefined
  // Volta para a tela de onde a pessoa saiu (tela de 401): só caminho interno, nunca outro site nem as telas de login.
  const returnTo = safeReturnPath(params.voltar) ?? undefined
  // Login pela rede ligado: a tela pede a matrícula de rede (o e-mail fica como "Entrar com e-mail (administrador)"). Sem
  // conseguir conferir (falha registrada no log do servidor), a tela avisa e oferece os dois caminhos.
  const { networkLogin, checked } = await fetchLoginOptions()
  return <LoginForm notice={notice} returnTo={returnTo} networkLogin={networkLogin} optionsUnavailable={!checked} />
}
