import { Suspense } from "react"

import { FeedbackContestationsPage } from "@/components/admin/feedback-contestations/feedback-contestations-page"

/** Contestações de feedback — o layout da Administração já exige `canReviewFeedbackContestations` ou acesso administrativo; o backend autoriza cada leitura. */
export default function Page() {
  return (
    <Suspense>
      <FeedbackContestationsPage />
    </Suspense>
  )
}
