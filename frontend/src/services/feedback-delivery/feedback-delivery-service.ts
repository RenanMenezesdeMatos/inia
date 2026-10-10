import { ApiError, apiGet } from "@/lib/api/api-client"
import { deliveredFeedbackListSchema, type DeliveredFeedback } from "@/schemas/feedback-delivery/feedback-delivery.schema"

const BASE = "/api/v1/feedback-deliveries"

/** Feedbacks de atendimento entregues à pessoa da sessão. Rota inexistente (flag OFF) = nenhum. */
export async function fetchMyDeliveredFeedback(): Promise<DeliveredFeedback[]> {
  try {
    return deliveredFeedbackListSchema.parse(await apiGet<unknown>(`${BASE}/mine`))
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return []
    throw error
  }
}
