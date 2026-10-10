import { ProfileWorkspace } from "@/components/profile/profile-workspace"
import { fetchAnalyticsContextFromCookies } from "@/services/analytics/analytics-server"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"
import { fetchOperatorSurface } from "@/services/operator"
import { fetchMyProfileFromCookies } from "@/services/profile/profile-server"

export default async function OperatorPage() {
  const [surface, context, user, myProfile] = await Promise.all([fetchOperatorSurface(), fetchAnalyticsContextFromCookies(), getCurrentUserFromCookies(), fetchMyProfileFromCookies()])
  return <ProfileWorkspace profile={surface.profile} initialMyProfile={myProfile} initialContext={context} operatorSurface={{ indicators: surface.indicators }} capabilities={user?.access.capabilities} />
}
