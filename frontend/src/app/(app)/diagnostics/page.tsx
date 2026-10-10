import { notFound, redirect } from "next/navigation"

import { DiagnosticsPage } from "@/components/diagnostics/diagnostics-page"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/** Área Diagnóstico: só para quem lidera alguém ou tem `indicators.view` (a API aplica a mesma regra e recorta pelo escopo). */
export default async function Page() {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  if (!user.access.capabilities.canViewDiagnostics) notFound()
  return <DiagnosticsPage />
}
