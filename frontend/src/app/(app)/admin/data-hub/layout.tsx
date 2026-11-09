import type { ReactNode } from "react"
import { redirect } from "next/navigation"

import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/**
 * Central de Dados — exige `data_hub.manage` com escopo de organização (Administrador geral e Administrador de dados). Quem abrir um
 * link antigo sem o papel volta para a Administração, sem carregar nada; a segurança de verdade continua nas rotas do backend.
 */
export default async function DataHubLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  if (!user.access.capabilities.canManageDataHub) redirect("/admin")
  return children
}
