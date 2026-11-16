import { redirect } from "next/navigation"

import { landingRouteFor, myProfileHrefFor } from "@/services/auth/auth-service"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/** `/apoio` (endereço antigo da área do Anjo): leva à aba "Apoio" do próprio perfil. Sem o papel Anjo, à tela inicial da pessoa. */
export default async function Page() {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  if (!user.access.capabilities.canAttendHumanSupport) redirect(landingRouteFor(user))
  redirect(`${myProfileHrefFor(user)}?tab=apoio`)
}
