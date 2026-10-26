import { Suspense } from "react"
import { notFound, redirect } from "next/navigation"

import { BestPracticesPage } from "@/components/best-practices/best-practices-page"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/** Base de boas práticas: público do Diagnóstico ou quem administra a configuração (a API aplica a mesma regra e o escopo). */
export default async function Page() {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  if (!user.access.capabilities.canViewBestPractices) notFound()
  return (
    <Suspense>
      <BestPracticesPage />
    </Suspense>
  )
}
