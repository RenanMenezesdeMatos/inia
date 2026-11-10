import { redirect } from "next/navigation"

import { HumanSupportAdminPage } from "@/components/human-support/admin/human-support-admin-page"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/**
 * Apoio com Anjo › configuração — só quem tem `human_support.manage` com escopo de organização (Administrador geral). Valida antes de
 * renderizar; o backend exige a mesma permissão em cada rota.
 */
export default async function Page() {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  if (!user.access.capabilities.canManageHumanSupport) redirect("/admin")
  return <HumanSupportAdminPage canGrantRoles={user.access.capabilities.canOpenUsersAndAccess} />
}
