import { Router, type Request } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { PgPendingActionsRepository, type PendingActionsRepository } from "../../pending-actions/application/pending-actions-repository.js"
import { buildNotificationSummary, markAllNotificationsRead, markNotificationRead } from "../application/build-notification-summary.js"
import { PgNotificationsRepository, type NotificationsRepository } from "../application/notifications-repository.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { getManageableScopes } from "../../auth/application/manageable-scopes.js"

const idSchema = z.object({ id: z.string().uuid() })

/** Sino: GET /notifications, POST /notifications/:id/read, POST /notifications/read-all. */
export function createNotificationsRouter(database: Database, repository: NotificationsRepository = new PgNotificationsRepository(database), pendingActions: PendingActionsRepository = new PgPendingActionsRepository(database)) {
  const router = Router()
  // Permissão atual de quem lê: a mesma de quem abre a aba Execuções.
  const workflowScopesOf = (request: Request) => () => getManageableScopes(database, sessionUser(request), "workflows.manage")

  router.get("/", async (request, response) => {
    const viewer = { personId: sessionUser(request).personId, organizationId: sessionUser(request).organizationId }
    response.json({ data: await buildNotificationSummary(repository, pendingActions, viewer, workflowScopesOf(request)) })
  })

  router.post("/read-all", async (request, response) => {
    const viewer = { personId: sessionUser(request).personId, organizationId: sessionUser(request).organizationId }
    response.json({ data: await markAllNotificationsRead(repository, viewer, workflowScopesOf(request)) })
  })

  router.post("/:id/read", async (request, response) => {
    const { id } = idSchema.parse(request.params)
    const viewer = { personId: sessionUser(request).personId, organizationId: sessionUser(request).organizationId }
    await markNotificationRead(repository, viewer, id, workflowScopesOf(request))
    response.status(204).send()
  })

  return router
}
