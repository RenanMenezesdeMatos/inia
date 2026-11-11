import { Router } from "express"
import { DomainError } from "../../../shared/domain/domain-error.js"

/**
 * `/api/v1/feedback-ratings` — o antigo "Este conteúdo foi útil?" (migration 113). Desde 10/11/2026 a avaliação do feedback é a
 * concordância registrada na confirmação de ciência (`/api/v1/feedback-read-confirmations`, migration 186): nenhuma avaliação
 * nova é gravada por aqui, para nenhuma fonte, e as avaliações antigas ficam como histórico (lidas pelo item do Acompanhamento e
 * pela fila de contestações). A rota só responde 410 para a tela antiga que ainda estiver aberta.
 */
export function createFeedbackRatingsRouter() {
  const router = Router()
  router.post("/", () => {
    throw new DomainError("A avaliação deste feedback agora é feita ao confirmar a ciência. Atualize a página.", "FEEDBACK_RATING_REPLACED_BY_READ_CONFIRMATION", 410)
  })
  return router
}
