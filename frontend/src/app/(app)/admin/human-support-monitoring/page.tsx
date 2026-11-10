import { redirect } from "next/navigation"

import { HumanSupportMonitoringPage } from "@/components/human-support/monitoring/human-support-monitoring-page"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/**
 * Painel do apoio — só quem tem `human_support.coordinate` (Coordenador de Anjos e Administrador geral). O layout da Administração abre
 * esta rota, isolada, para quem só tem o papel de Coordenador; o backend recorta cada leitura pelo escopo da atribuição.
 */
export default async function Page() {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  if (!user.access.capabilities.canCoordinateHumanSupport) redirect("/admin")
  return <HumanSupportMonitoringPage canFilterByScope={user.access.capabilities.canManageHumanSupport} />
}
