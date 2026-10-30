import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { caseVisibleTo, loadCaseVisibility } from "../../supervision-cases/application/case-visibility.js"
import { PublishFeedback } from "../application/publish-feedback.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

const notFound = () => new DomainError("Feedback não encontrado.", "FEEDBACK_NOT_FOUND", 404)

/**
 * Publicar um feedback APROVADO (rota legada — o motor publica pelo próprio fluxo). Antes bastava estar logado: qualquer
 * operador publicava feedback de qualquer pessoa (achado U-F5). Agora só quem enxerga o CASO do feedback — o líder do
 * colaborador, quem tem a visão ampliada de Indicadores ou administra Agents no Grupo dele — e só na própria organização.
 */
export function createFeedbackRouter(database: Database) {
  const router = Router()
  const publishFeedback = new PublishFeedback(database)
  router.post("/:id/publish", async (request, response) => {
    const id = z.string().uuid().safeParse(request.params.id)
    if (!id.success) throw notFound()
    const user = sessionUser(request)
    const owner = await database.query<{ operator_id: string; team_id: string | null; subteam_id: string | null }>(
      `select c.operator_id, c.team_id, p.subteam_id from feedbacks f join supervision_cases c on c.id = f.case_id join people p on p.id = c.operator_id
       where f.id = $1 and f.organization_id = $2`,
      [id.data, user.organizationId],
    )
    const row = owner.rows[0]
    if (!row || !caseVisibleTo(await loadCaseVisibility(database, user), { operatorId: row.operator_id, teamId: row.team_id, subteamId: row.subteam_id })) throw notFound()
    // O colaborador nunca publica o próprio feedback.
    if (row.operator_id === user.personId) throw notFound()
    response.json({ data: await publishFeedback.execute(id.data, { organizationId: user.organizationId }) })
  })
  // Ciência do colaborador: só com login e senha, em /api/v1/feedback-read-confirmations (não há rota de ciência sem credencial).
  return router
}
