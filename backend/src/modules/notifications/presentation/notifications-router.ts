import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { PgPendingActionsRepository, type PendingActionsRepository } from "../../pending-actions/application/pending-actions-repository.js"
import { buildNotificationSummary, markAllNotificationsRead, markNotificationRead } from "../application/build-notification-summary.js"
import { PgNotificationsRepository, type NotificationsRepository } from "../application/notifications-repository.js"

const idSchema = z.object({ id: z.string().uuid() })

/** Sino: GET /notifications, POST /notifications/:id/read, POST /notifications/read-all. */
export function createNotificationsRouter(database: Database, repository: NotificationsRepository = new PgNotificationsRepository(database), pendingActions: PendingActionsRepository = new PgPendingActionsRepository(database)) {
  const router = Router()

  router.get("/", async (request, response) => {
    const viewer = { personId: request.user!.personId, organizationId: request.user!.organizationId }
    response.json({ data: await buildNotificationSummary(repository, pendingActions, viewer) })
  })

  router.post("/read-all", async (request, response) => {
    const viewer = { personId: request.user!.personId, organizationId: request.user!.organizationId }
    response.json({ data: await markAllNotificationsRead(repository, viewer) })
  })

  router.post("/:id/read", async (request, response) => {
    const { id } = idSchema.parse(request.params)
    const viewer = { personId: request.user!.personId, organizationId: request.user!.organizationId }
    await markNotificationRead(repository, viewer, id)
    response.status(204).send()
  })

  return router
}
