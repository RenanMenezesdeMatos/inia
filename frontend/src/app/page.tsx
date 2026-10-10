import { redirect } from "next/navigation"

import { landingRouteFor } from "@/services/auth/auth-service"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/**
 * A raiz não tem tela própria: é só a porta de entrada do endereço da plataforma (inclusive o endereço público do IIS).
 * Sem sessão → login; com sessão → a tela inicial da pessoa (primeiro acesso pendente cai na criação de senha).
 */
export default async function RootPage() {
  const user = await getCurrentUserFromCookies()
  redirect(user ? landingRouteFor(user) : "/auth/login")
}
