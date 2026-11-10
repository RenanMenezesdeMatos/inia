import { redirect } from "next/navigation"

import { AnjoWorkspace } from "@/components/human-support/anjo/anjo-workspace"
import { landingRouteFor } from "@/services/auth/auth-service"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/** Área do Anjo (Apoio com Anjo): só para quem tem o papel Anjo em algum escopo. A API aplica a mesma regra em cada rota. */
export default async function Page() {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  if (!user.access.capabilities.canAttendHumanSupport) redirect(landingRouteFor(user))
  return <AnjoWorkspace />
}
