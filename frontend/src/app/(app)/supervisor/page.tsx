import { redirect } from "next/navigation"

import { ProfileWorkspace } from "@/components/profile/profile-workspace"
import { fetchAnalyticsContextFromCookies } from "@/services/analytics/analytics-server"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"
import { buildProfileHeader } from "@/services/operator"
import { fetchMyProfileFromCookies } from "@/services/profile/profile-server"

/** Perfil de quem lidera uma estrutura (Supervisor, Coordenador, Gerente, Gerente Sênior,
 * Diretor) e de quem está fora da hierarquia operacional (ex.: administrador) — o mesmo shell do operador; o que muda vem
 * das capabilities do backend. É o destino de "Meu perfil" para toda conta que não é Operador. */
export default async function SupervisorPage() {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  if (user.role === "OPERATOR") redirect("/operator")
  const [context, myProfile] = await Promise.all([fetchAnalyticsContextFromCookies(), fetchMyProfileFromCookies()])
  return <ProfileWorkspace profile={buildProfileHeader(user)} initialMyProfile={myProfile} initialContext={context} operatorSurface={null} capabilities={user.access.capabilities} />
}
