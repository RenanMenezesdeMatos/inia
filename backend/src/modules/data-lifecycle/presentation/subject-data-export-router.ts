import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { exportSubjectData } from "../application/subject-data-export.js"

/**
 * Pedido do titular — `/api/v1/admin/people/:personId/data-export` (montado atrás de `privacy.subject_data.export` na
 * organização inteira). Devolve um JSON para download com tudo o que a INIA guarda ligado à pessoa; a exportação fica auditada.
 */
export function createSubjectDataExportRouter(db: Database) {
  const router = Router()
  router.get("/:personId/data-export", async (request, response) => {
    const personId = z.string().uuid().parse(request.params.personId)
    const data = await exportSubjectData(db, { organizationId: request.user!.organizationId, personId, actorPersonId: request.user!.personId })
    response.set("Cache-Control", "no-store")
    response.attachment(`dados-pessoa-${personId}-${data.generatedAt.slice(0, 10)}.json`)
    response.type("application/json").send(JSON.stringify(data, null, 2))
  })
  return router
}
