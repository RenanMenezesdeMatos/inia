import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { listMyAlignments, markMyAlignmentRead } from "../application/my-alignments.js"

/**
 * Alinhamentos da PRÓPRIA pessoa (Acompanhamento do operador, 18/11/2026). Pessoa e organização sempre da sessão — nenhum parâmetro
 * alcança outra pessoa.
 *   GET  /mine                                          — um item por alinhamento do público dela (em vigor, a começar, encerrados há até 12 meses);
 *   POST /:alignmentId/versions/:versionId/read         — "Li o alinhamento" (só a versão que ela vê e que ainda vale ou vai valer).
 */
const readParams = z.object({ alignmentId: z.string().uuid(), versionId: z.string().uuid() })

export function createMyOperationalAlignmentsRouter(db: Database) {
  const router = Router()
  router.get("/mine", async (request, response, next) => {
    try {
      const user = sessionUser(request)
      response.json({ data: { items: await listMyAlignments(db, { organizationId: user.organizationId, personId: user.personId }) } })
    } catch (error) {
      next(error)
    }
  })
  router.post("/:alignmentId/versions/:versionId/read", async (request, response, next) => {
    try {
      const user = sessionUser(request)
      const params = readParams.parse(request.params)
      response.json({ data: await markMyAlignmentRead(db, { organizationId: user.organizationId, personId: user.personId, ...params }) })
    } catch (error) {
      next(error)
    }
  })
  return router
}
