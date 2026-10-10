"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { FlaskConical } from "lucide-react"

import { FeedbackReviewView } from "@/components/feedback-review/feedback-review-view"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const OPEN_PARAM = "feedbackReview"

/** Fila + painel do QA de feedback com o item aberto na URL (`?feedbackReview=<id>`) — deep link e "voltar" funcionam. */
export function FeedbackQualityPanel() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  function openReview(reviewId: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (reviewId) params.set(OPEN_PARAM, reviewId)
    else params.delete(OPEN_PARAM)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }
  return <FeedbackReviewView openReviewId={searchParams.get(OPEN_PARAM)} onOpenReview={openReview} />
}

/**
 * QA Lab › Feedbacks fora da Administração (/qa-lab/feedbacks): quem tem a capability FEEDBACK_QUALITY_REVIEW — um
 * supervisor, a Qualidade — não precisa ser administrador. Administradores globais veem a mesma tela na aba "Feedbacks" do
 * QA Lab. A segurança é do backend (sem capability = 403; escopo pelas concessões).
 */
export function FeedbackQualityPage() {
  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" aria-hidden /> QA Lab
          </CardTitle>
          <CardDescription>Avaliação da qualidade do que a INIA produz.</CardDescription>
        </CardHeader>
        <CardContent>
          <FeedbackQualityPanel />
        </CardContent>
      </Card>
    </div>
  )
}
