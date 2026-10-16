import { notFound, redirect } from "next/navigation"

import { ReportsPage } from "@/components/reports/reports-page"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/** Reports recorrentes: quem lidera (ou tem acesso de consulta) e o papel Report. A API aplica as mesmas regras. */
export default async function Page() {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  if (!user.access.capabilities.canUseReports) notFound()
  return <ReportsPage />
}
