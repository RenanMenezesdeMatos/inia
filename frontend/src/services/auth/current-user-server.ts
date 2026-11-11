import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { currentUserSchema, type CurrentUser } from "@/schemas/auth/auth.schema"
import { readSessionCookie, sessionCookieHeader } from "@/lib/auth/session-cookie"
import { CREATE_PASSWORD_ROUTE } from "@/services/auth/auth-service"

const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

/**
 * Sessão lida AO VIVO do backend para as páginas de servidor. Com a troca de senha pendente (primeiro acesso), nenhuma página
 * da plataforma renderiza: a pessoa é levada para criar a senha — só essa tela pede `allowPasswordChangePending`.
 */
export async function getCurrentUserFromCookies(options: { allowPasswordChangePending?: boolean } = {}): Promise<CurrentUser | null> {
  const cookieStore = await cookies()
  const session = readSessionCookie(cookieStore)
  const token = session?.value
  if (!token) return null

  const response = await fetch(`${API_URL}/api/v1/auth/me`, {
    headers: { cookie: sessionCookieHeader(session) },
    cache: "no-store",
  })
  // API fora/falhando (5xx, inclusive o 502 do proxy) NÃO é "sem sessão": mandar ao login esconderia a falha e a pessoa cairia num
  // login que também falha. Vira erro de servidor da interface → tela 500 com o digest; o log da interface (instrumentation.ts)
  // guarda o digest junto com o código e a referência da API, que ligam os dois registros.
  if (response.status >= 500) {
    const failure = await response.json().then((payload: { error?: { code?: string; reference?: string } }) => payload?.error ?? null).catch(() => null)
    throw new Error(`Falha ao ler a sessão na API: status ${response.status}, código ${failure?.code ?? "sem corpo da API"}, referência ${failure?.reference ?? response.headers.get("x-request-id") ?? "—"}`)
  }
  if (!response.ok) return null
  const payload: unknown = await response.json()
  const user = currentUserSchema.parse((payload as { data: unknown }).data)
  if (user.passwordChangeRequired && !options.allowPasswordChangePending) redirect(CREATE_PASSWORD_ROUTE)
  return user
}
