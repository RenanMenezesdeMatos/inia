import { notFound, redirect } from "next/navigation"

import { ReportFormPage } from "@/components/reports/report-form"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/** Novo report — do zero ou a partir de uma proposta do chat (`?proposta=<id>`), que só vira recorrência depois de salvo. */
export default async function Page({ searchParams }: { searchParams: Promise<{ proposta?: string }> }) {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  if (!user.access.capabilities.canUseReports) notFound()
  const { proposta } = await searchParams
  return <ReportFormPage proposalId={proposta ?? null} />
}
