import { redirect } from "next/navigation"

import { ErrorDiagnosticsPage } from "@/components/error-diagnostics/error-diagnostics-page"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/** Diagnóstico de erros — catálogo de códigos e ocorrências (a API confere `support.diagnostics.view` com escopo de organização). */
export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  if (!user.access.capabilities.canViewErrorDiagnostics) redirect("/admin")
  const params = await searchParams
  const initial = typeof params.q === "string" ? params.q.slice(0, 100) : ""
  return <ErrorDiagnosticsPage initialQuery={initial} />
}
