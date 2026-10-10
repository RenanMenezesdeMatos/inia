import { Suspense } from "react"

import { AiManagementPage } from "@/components/admin/ai/ai-management-page"

export default function Page() {
  return (
    <Suspense>
      <AiManagementPage />
    </Suspense>
  )
}
