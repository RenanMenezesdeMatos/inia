import { Suspense } from "react"

import { AssistantConversationsPage } from "@/components/admin/assistant-conversations/assistant-conversations-page"

/** Conversas com a INIA — o layout da Administração já exige `canViewAssistantConversations` ou acesso administrativo; o backend autoriza cada leitura. */
export default function Page() {
  return (
    <Suspense>
      <AssistantConversationsPage />
    </Suspense>
  )
}
