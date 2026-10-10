import { EmployeeProfilePage } from "@/components/profile/employee-profile-page"
import { EmployeeProfileUnavailable } from "@/components/profile/employee-profile-unavailable"
import { fetchAnalyticsContextFromCookies } from "@/services/analytics/analytics-server"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"
import { fetchSupervisorOperatorFromCookies } from "@/services/supervisor"

export default async function Page({ params }: { params: Promise<{ operatorId: string }> }) {
  const { operatorId } = await params
  const [result, context, user] = await Promise.all([fetchSupervisorOperatorFromCookies(operatorId), fetchAnalyticsContextFromCookies(), getCurrentUserFromCookies()])

  if (result.status !== "ok") return <EmployeeProfileUnavailable status={result.status} />

  return <EmployeeProfilePage detail={result.data} context={context} capabilities={user?.access.capabilities} />
}
