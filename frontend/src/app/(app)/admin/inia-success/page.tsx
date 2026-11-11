import { redirect } from "next/navigation"

import { IniaSuccessPage } from "@/components/inia-success/inia-success-page"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/**
 * Indicadores de sucesso da INIA — quem lê ao menos um bloco (`canViewIniaSuccess`). O backend confere a permissão de cada bloco e o
 * alcance de cada leitura; a tela só mostra o que ele devolve.
 */
export default async function Page() {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  if (!user.access.capabilities.canViewIniaSuccess) redirect("/admin")
  return <IniaSuccessPage />
}
