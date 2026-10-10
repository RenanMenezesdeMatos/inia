import { redirect } from "next/navigation"

import { QaLabPage } from "@/components/admin/qa-lab/qa-lab-page"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/**
 * QA Lab — exige `qa_lab.use` com escopo de ORGANIZAÇÃO (papel Administrador geral). Server component: valida o acesso ANTES
 * de renderizar ou disparar qualquer fetch. `canUseQaLab` vem calculado ao vivo pelo backend (/auth/me) a partir dos papéis;
 * a segurança de verdade continua no backend (todo endpoint /admin/qa-lab/* exige a mesma permissão).
 */
export default async function Page() {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  if (!user.access.capabilities.canUseQaLab) redirect("/admin")

  return <QaLabPage feedbackQaEnabled={user.features.interactionFeedbackQa} />
}
