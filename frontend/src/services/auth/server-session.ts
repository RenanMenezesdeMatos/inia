import { redirect } from "next/navigation"

import { CREATE_PASSWORD_ROUTE } from "@/services/auth/auth-service"

/**
 * Resposta de uma chamada feita NO SERVIDOR (página) ao backend: sessão encerrada (desabilitada, revogada por nova senha
 * temporária, expirada) leva ao login; troca de senha pendente leva à tela de criar a senha — nunca a uma tela de erro.
 * Chame FORA de try/catch (o redirect do Next é uma exceção).
 */
export async function redirectIfSessionEnded(response: Response): Promise<void> {
  if (response.status === 401) redirect("/auth/login")
  if (response.status !== 403) return
  const code = await response.clone().json().then((payload: { error?: { code?: string } }) => payload?.error?.code ?? null).catch(() => null)
  if (code === "PASSWORD_CHANGE_REQUIRED") redirect(CREATE_PASSWORD_ROUTE)
}
