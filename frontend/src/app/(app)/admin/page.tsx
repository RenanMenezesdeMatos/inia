import { redirect } from "next/navigation"

import { ASSISTANT_CONVERSATIONS_PATH } from "@/components/admin/assistant-conversations/assistant-conversations-route"
import { USABILITY_PATH } from "@/components/admin/usability/usability-route"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

export default async function AdminIndexPage() {
  const user = await getCurrentUserFromCookies()
  // Sem outra área administrativa, a entrada é a única que a conta pode abrir.
  if (user && !user.access.capabilities.canAccessAdministration && user.access.capabilities.canViewAssistantConversations) redirect(ASSISTANT_CONVERSATIONS_PATH)
  if (user && !user.access.capabilities.canAccessAdministration && user.access.capabilities.canViewUsability && user.features.usabilityPanel) redirect(USABILITY_PATH)
  // Quem só administra dados não tem a tela de bases: a entrada é a Central de Dados.
  if (user && user.access.capabilities.canManageDataHub && !user.access.capabilities.canManageKnowledge) redirect("/admin/data-hub")
  redirect("/admin/knowledge")
}
