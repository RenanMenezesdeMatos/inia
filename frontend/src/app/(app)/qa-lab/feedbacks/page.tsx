import { notFound, redirect } from "next/navigation"
import { Suspense } from "react"

import { FeedbackQualityPage } from "@/components/feedback-review/feedback-quality-page"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/** QA de feedback fora da Administração. Módulo desligado neste ambiente = a página não existe (404) — nunca "sem permissão";
 * com o módulo ligado, quem não tem o papel recebe o 403 real do backend ("Sem permissão de QA de feedback"). */
export default async function Page() {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  if (!user.features.interactionFeedbackQa) notFound()
  return (
    <Suspense>
      <FeedbackQualityPage />
    </Suspense>
  )
}
