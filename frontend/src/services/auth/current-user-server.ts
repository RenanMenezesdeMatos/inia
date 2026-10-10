import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { currentUserSchema, type CurrentUser } from "@/schemas/auth/auth.schema"
import { CREATE_PASSWORD_ROUTE, SESSION_COOKIE_NAME } from "@/services/auth/auth-service"

const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

/**
 * Sessão lida AO VIVO do backend para as páginas de servidor. Com a troca de senha pendente (primeiro acesso), nenhuma página
 * da plataforma renderiza: a pessoa é levada para criar a senha — só essa tela pede `allowPasswordChangePending`.
 */
export async function getCurrentUserFromCookies(options: { allowPasswordChangePending?: boolean } = {}): Promise<CurrentUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null

  const response = await fetch(`${API_URL}/api/v1/auth/me`, {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    cache: "no-store",
  })
  if (!response.ok) return null
  const payload: unknown = await response.json()
  const user = currentUserSchema.parse((payload as { data: unknown }).data)
  if (user.passwordChangeRequired && !options.allowPasswordChangePending) redirect(CREATE_PASSWORD_ROUTE)
  return user
}
