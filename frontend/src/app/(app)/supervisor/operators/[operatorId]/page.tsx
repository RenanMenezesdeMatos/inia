import { backLinkFor, forbiddenDescriptionFor } from "@/components/profile/employee-profile-exit"
import { EmployeeProfilePage } from "@/components/profile/employee-profile-page"
import { EmployeeProfileUnavailable } from "@/components/profile/employee-profile-unavailable"
import { fetchAnalyticsContextFromCookies } from "@/services/analytics/analytics-server"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"
import { fetchSupervisorOperatorFromCookies } from "@/services/supervisor"

export default async function Page({ params }: { params: Promise<{ operatorId: string }> }) {
  const { operatorId } = await params
  const [result, context, user] = await Promise.all([fetchSupervisorOperatorFromCookies(operatorId), fetchAnalyticsContextFromCookies(), getCurrentUserFromCookies()])

  // Sem pessoa visitada válida, a saída não foca ninguém. Só strings atravessam para o componente cliente.
  if (result.status !== "ok") return <EmployeeProfileUnavailable status={result.status} back={backLinkFor(context)} forbiddenDescription={forbiddenDescriptionFor(context)} />

  return <EmployeeProfilePage detail={result.data} context={context} capabilities={user?.access.capabilities} />
}
